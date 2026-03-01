/**
 * 平台账号管理页面
 * 功能：账号 CRUD、三步向导创建、AI 智能分析、历史内容管理
 * 配置项（认证状态、内容类型、分类、风格）从全局 Store 获取
 */

import { useState, useEffect, useCallback } from 'react'
import {
  getAccounts,
  getPlatforms,
  createAccount,
  updateAccount,
  deleteAccount,
  analyzeAccount,
  addPostPerformance,
  updatePostPerformance,
  deletePostPerformance,
  type AccountProfile,
  type Platform,
  type PostPerformance,
  type PostPerformanceCreate,
} from '../services/api'
import Modal from '../components/Modal'
import { PageLoading, Spinner } from '../components/Loading'
import { PlatformIcon } from '../components/PlatformIcons'
import TagInput from '../components/TagInput'
import { useAppStore } from '../stores/appStore'

// ==================== 辅助函数 ====================

/** 格式化数字（1.2w / 5k 等） */
const formatNumber = (num: number) => {
  if (num >= 10000) return (num / 10000).toFixed(1) + 'w'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k'
  return num.toString()
}

/** 解析数字简写输入（支持 5.2w、52k、5.2万） */
const parseNumberInput = (val: string): number => {
  const s = val.trim().toLowerCase()
  if (s.endsWith('w') || s.endsWith('万')) {
    const n = parseFloat(s.replace(/[w万]/g, ''))
    return isNaN(n) ? 0 : Math.round(n * 10000)
  }
  if (s.endsWith('k')) {
    const n = parseFloat(s.replace(/k/g, ''))
    return isNaN(n) ? 0 : Math.round(n * 1000)
  }
  return parseInt(s) || 0
}

/** 计算互动率 */
const calcEngagementRate = (views: number, likes: number, comments: number, favorites: number, shares: number) => {
  if (!views || views === 0) return '0.00'
  return (((likes + comments + favorites + shares) / views) * 100).toFixed(2)
}

/** 计算运营月数 */
const calcOperationMonths = (startedAt?: string) => {
  if (!startedAt) return null
  const start = new Date(startedAt)
  const now = new Date()
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  return Math.max(0, months)
}

/** 计算完善度百分比 */
const calcCompleteness = (account: AccountProfile): number => {
  let score = 0
  if (account.bio) score += 10
  if (account.content_style) score += 15
  if (account.target_audience) score += 15
  if (account.sub_categories && account.sub_categories.length > 0) score += 5
  if (account.followers_count > 0) score += 10
  if (account.posts_count > 0) score += 5
  if (account.verification_status && account.verification_status !== 'none') score += 5
  if (account.started_at) score += 5
  const postCount = account.post_performances?.length || 0
  if (postCount >= 1) score += 10
  if (postCount >= 3) score += 10
  if (account.post_performances?.some((p) => p.is_top)) score += 10
  return score
}

/** 获取完善度提示文案 */
const getCompletenessHint = (account: AccountProfile): string | null => {
  if (!account.content_style) return '补充「内容风格」可让 AI 推荐更匹配你调性的选题'
  if (!account.target_audience) return '补充「目标受众」可提升模拟预测的准确度'
  const postCount = account.post_performances?.length || 0
  if (postCount < 3) return '添加 3-5 条代表性历史内容，让预测更有参考依据'
  if (account.followers_count === 0) return '补充粉丝数，让 AI 预估更贴近真实曝光'
  return null
}

/** 数据是否过时（超过30天） */
const isStatsStale = (statsUpdatedAt?: string): boolean => {
  if (!statsUpdatedAt) return false
  const updated = new Date(statsUpdatedAt)
  const now = new Date()
  return (now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24) > 30
}

// ==================== 组件 ====================

export default function AccountsPage() {
  const { showToast, appOptions, systemStatus: _systemStatus } = useAppStore()

  // 从全局配置获取选项
  const VERIFICATION_STATUSES = appOptions.verification_statuses
  const POST_TYPES = appOptions.post_types
  const CATEGORY_OPTIONS = appOptions.category_options
  const CONTENT_STYLES = appOptions.content_styles

  // 数据状态
  const [accounts, setAccounts] = useState<AccountProfile[]>([])
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPlatform, setSelectedPlatform] = useState<string>('')

  // 账号创建向导状态
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiSuggested, setAiSuggested] = useState(false)

  // 账号编辑弹窗状态
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<AccountProfile | null>(null)

  // 账号表单数据
  const [accountForm, setAccountForm] = useState({
    platform_code: '',
    account_name: '',
    account_id: '',
    bio: '',
    main_category: '',
    sub_categories: [] as string[],
    content_style: '',
    target_audience: '',
    followers_count: '',
    posts_count: '',
    verification_status: 'none',
    started_at: '',
    extra_metrics: null as Record<string, unknown> | null,
  })
  const [accountFormErrors, setAccountFormErrors] = useState<Record<string, string>>({})
  const [savingAccount, setSavingAccount] = useState(false)

  // 自定义主分类输入模式
  const [customCategoryMode, setCustomCategoryMode] = useState(false)
  const [customCategoryInput, setCustomCategoryInput] = useState('')

  // 自定义内容风格输入模式
  const [customStyleMode, setCustomStyleMode] = useState(false)
  const [customStyleInput, setCustomStyleInput] = useState('')

  // 历史内容弹窗状态
  const [isPostModalOpen, setIsPostModalOpen] = useState(false)
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null)
  const [editingPost, setEditingPost] = useState<PostPerformance | null>(null)
  const [postForm, setPostForm] = useState<PostPerformanceCreate>({
    title: '', content: '', post_type: '图文', tags: [], is_top: false,
    post_url: '', publish_time: '',
  })
  const [postFormErrors, setPostFormErrors] = useState<Record<string, string>>({})
  const [savingPost, setSavingPost] = useState(false)

  // 获取当前平台支持的内容类型
  const getAvailablePostTypes = useCallback(() => {
    if (!currentAccountId) return POST_TYPES
    const account = accounts.find((a) => a.id === currentAccountId)
    if (!account) return POST_TYPES
    const platform = platforms.find((p) => p.code === account.platform_code)
    if (!platform?.content_forms || platform.content_forms.length === 0) return POST_TYPES
    return POST_TYPES.filter((t) => platform.content_forms!.includes(t))
  }, [currentAccountId, accounts, platforms, POST_TYPES])

  // ==================== 数据加载 ====================

  const fetchData = useCallback(async () => {
    try {
      const [accountsData, platformsData] = await Promise.all([
        getAccounts(selectedPlatform || undefined),
        getPlatforms(),
      ])
      setAccounts(accountsData.items)
      setPlatforms(platformsData)
    } catch (err) {
      console.error('获取数据失败:', err)
      showToast('error', '获取数据失败')
    } finally {
      setLoading(false)
    }
  }, [selectedPlatform, showToast])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const getPlatformInfo = (code: string) => {
    return platforms.find((p) => p.code === code) || { name: '未知', icon: '📱', color: '#6366F1' }
  }

  // 获取当前主分类的子分类推荐
  const getSubSuggestions = (mainCategory: string): string[] => {
    const cat = CATEGORY_OPTIONS.find((c) => c.value === mainCategory)
    return cat?.sub_suggestions || []
  }

  // ==================== 账号创建向导 ====================

  const handleOpenWizard = () => {
    setAccountForm({
      platform_code: selectedPlatform || (platforms[0]?.code || ''),
      account_name: '', account_id: '', bio: '',
      main_category: '', sub_categories: [],
      content_style: '', target_audience: '',
      followers_count: '', posts_count: '',
      verification_status: 'none', started_at: '',
      extra_metrics: null,
    })
    setAccountFormErrors({})
    setWizardStep(1)
    setAiSuggested(false)
    setCustomCategoryMode(false)
    setCustomStyleMode(false)
    setIsWizardOpen(true)
  }

  // AI 内容定位分析（手动触发，向导第二步和编辑弹窗共用）
  const handleAIAnalyze = async () => {
    if (!accountForm.account_name.trim()) {
      showToast('warning', '请先填写账号名称')
      return
    }
    if (!accountForm.bio.trim()) {
      showToast('warning', '请先填写账号简介，AI 将据此分析内容定位')
      return
    }
    setAnalyzing(true)
    try {
      const result = await analyzeAccount({
        platform_code: accountForm.platform_code,
        account_name: accountForm.account_name,
        bio: accountForm.bio,
      })
      setAccountForm((prev) => ({
        ...prev,
        main_category: result.main_category || prev.main_category,
        sub_categories: result.sub_categories || prev.sub_categories,
        content_style: result.content_style || prev.content_style,
        target_audience: result.target_audience || prev.target_audience,
      }))
      // 检查 AI 返回的主分类是否在预设中
      const isPreset = CATEGORY_OPTIONS.some((c) => c.value === result.main_category)
      if (isPreset) {
        setCustomCategoryMode(false)
        setCustomCategoryInput('')
      } else if (result.main_category) {
        setCustomCategoryMode(true)
        setCustomCategoryInput(result.main_category)
      }
      // 检查内容风格是否在预设中
      const isPresetStyle = CONTENT_STYLES.includes(result.content_style)
      if (isPresetStyle) {
        setCustomStyleMode(false)
        setCustomStyleInput('')
      } else if (result.content_style) {
        setCustomStyleMode(true)
        setCustomStyleInput(result.content_style)
      }
      setAiSuggested(true)
      showToast('success', 'AI 分析完成，请确认或修改')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI 分析失败'
      showToast('error', msg)
    } finally {
      setAnalyzing(false)
    }
  }

  // 向导验证
  const validateWizardStep = (step: number) => {
    const errors: Record<string, string> = {}
    if (step === 1) {
      if (!accountForm.platform_code) errors.platform_code = '请选择平台'
      if (!accountForm.account_name.trim()) errors.account_name = '请输入账号名称'
    } else if (step === 2) {
      const category = customCategoryMode ? customCategoryInput : accountForm.main_category
      if (!category.trim()) errors.main_category = '请选择或输入主要分类'
    }
    setAccountFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  // 向导下一步
  const handleWizardNext = () => {
    if (!validateWizardStep(wizardStep)) return
    setWizardStep((s) => Math.min(s + 1, 3))
  }

  // 保存账号（向导完成 / 编辑保存）
  const handleSaveAccount = async (isEdit = false) => {
    if (!isEdit && !validateWizardStep(2)) return
    setSavingAccount(true)
    try {
      const mainCategory = customCategoryMode ? customCategoryInput : accountForm.main_category
      const contentStyle = customStyleMode ? customStyleInput : accountForm.content_style
      const payload = {
        platform_code: accountForm.platform_code,
        account_name: accountForm.account_name.trim(),
        account_id: accountForm.account_id || undefined,
        bio: accountForm.bio || undefined,
        main_category: mainCategory.trim(),
        sub_categories: accountForm.sub_categories.length > 0 ? accountForm.sub_categories : undefined,
        content_style: contentStyle || undefined,
        target_audience: accountForm.target_audience || undefined,
        followers_count: parseNumberInput(accountForm.followers_count),
        posts_count: parseNumberInput(accountForm.posts_count),
        verification_status: accountForm.verification_status,
        started_at: accountForm.started_at || undefined,
        extra_metrics: accountForm.extra_metrics || undefined,
      }

      if (isEdit && editingAccount) {
        await updateAccount(editingAccount.id, payload)
        showToast('success', '更新成功')
        setIsEditModalOpen(false)
      } else {
        await createAccount(payload)
        showToast('success', '创建成功')
        setIsWizardOpen(false)
      }
      fetchData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '保存失败'
      showToast('error', msg)
    } finally {
      setSavingAccount(false)
    }
  }

  // ==================== 账号编辑 ====================

  const handleEditAccount = (account: AccountProfile) => {
    setEditingAccount(account)
    const isPreset = CATEGORY_OPTIONS.some((c) => c.value === account.main_category)
    const isPresetStyle = CONTENT_STYLES.includes(account.content_style || '')
    setCustomCategoryMode(!isPreset)
    setCustomCategoryInput(!isPreset ? account.main_category : '')
    setCustomStyleMode(!isPresetStyle && !!account.content_style)
    setCustomStyleInput(!isPresetStyle ? (account.content_style || '') : '')
    setAccountForm({
      platform_code: account.platform_code,
      account_name: account.account_name,
      account_id: account.account_id || '',
      bio: account.bio || '',
      main_category: isPreset ? account.main_category : '',
      sub_categories: account.sub_categories || [],
      content_style: isPresetStyle ? (account.content_style || '') : '',
      target_audience: account.target_audience || '',
      followers_count: account.followers_count > 0 ? String(account.followers_count) : '',
      posts_count: account.posts_count > 0 ? String(account.posts_count) : '',
      verification_status: account.verification_status || 'none',
      started_at: account.started_at || '',
      extra_metrics: (account.extra_metrics as Record<string, unknown>) || null,
    })
    setAccountFormErrors({})
    setIsEditModalOpen(true)
  }

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('确定要删除这个账号配置吗？删除后将无法恢复，历史内容也会一并删除。')) return
    try {
      await deleteAccount(id)
      showToast('success', '删除成功')
      fetchData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除失败'
      showToast('error', msg)
    }
  }

  // ==================== 历史内容管理 ====================

  const handleAddPost = (accountId: string) => {
    setCurrentAccountId(accountId)
    setEditingPost(null)
    const availableTypes = getAvailablePostTypes()
    setPostForm({
      title: '', content: '', post_type: availableTypes[0] || '图文', tags: [], is_top: false,
      post_url: '', publish_time: '',
    })
    setPostFormErrors({})
    setIsPostModalOpen(true)
  }

  const handleEditPost = (accountId: string, post: PostPerformance) => {
    setCurrentAccountId(accountId)
    setEditingPost(post)
    setPostForm({
      title: post.title,
      content: post.content || '',
      post_type: post.post_type || '图文',
      tags: post.tags || [],
      is_top: post.is_top || false,
      post_url: post.post_url || '',
      publish_time: post.publish_time || '',
      views: post.views || undefined,
      likes: post.likes || undefined,
      comments: post.comments || undefined,
      favorites: post.favorites || undefined,
      shares: post.shares || undefined,
    })
    setPostFormErrors({})
    setIsPostModalOpen(true)
  }

  const handleSavePost = async () => {
    const errors: Record<string, string> = {}
    if (!postForm.title?.trim()) errors.title = '请输入内容标题'
    setPostFormErrors(errors)
    if (Object.keys(errors).length > 0) return
    if (!currentAccountId) return

    // 保存前：空值的数据指标转为 0
    const submitData: PostPerformanceCreate = {
      ...postForm,
      views: postForm.views ?? 0,
      likes: postForm.likes ?? 0,
      comments: postForm.comments ?? 0,
      favorites: postForm.favorites ?? 0,
      shares: postForm.shares ?? 0,
    }

    setSavingPost(true)
    try {
      if (editingPost) {
        await updatePostPerformance(editingPost.id, submitData)
        showToast('success', '更新成功')
      } else {
        await addPostPerformance(currentAccountId, submitData)
        showToast('success', '添加成功')
      }
      setIsPostModalOpen(false)
      fetchData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '保存失败'
      showToast('error', msg)
    } finally {
      setSavingPost(false)
    }
  }

  const handleDeletePost = async (postId: string) => {
    if (!confirm('确定要删除这条历史内容吗？')) return
    try {
      await deletePostPerformance(postId)
      showToast('success', '删除成功')
      fetchData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除失败'
      showToast('error', msg)
    }
  }

  // ==================== 渲染：分类与风格选择器 ====================

  /** 主分类选择区域（预设 + 自定义） */
  const renderCategorySelector = () => (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        主要分类 <span className="text-red-500">*</span>
      </label>
      {!customCategoryMode ? (
        <div className="grid grid-cols-3 gap-2">
          {CATEGORY_OPTIONS.map((cat) => (
            <button key={cat.value} type="button"
              onClick={() => setAccountForm((f) => ({ ...f, main_category: cat.value }))}
              className={`px-3 py-2 rounded-lg text-sm transition-all text-left ${
                accountForm.main_category === cat.value
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 ring-2 ring-primary-500'
                  : 'bg-gray-100 dark:bg-dark-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-dark-600'
              }`}
            >
              {cat.label}
            </button>
          ))}
          <button type="button"
            onClick={() => { setCustomCategoryMode(true); setAccountForm((f) => ({ ...f, main_category: '' })) }}
            className="px-3 py-2 rounded-lg text-sm bg-gray-100 dark:bg-dark-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-600 border-2 border-dashed border-gray-300 dark:border-dark-600"
          >
            ✏️ 自定义
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input type="text" value={customCategoryInput}
            onChange={(e) => { setCustomCategoryInput(e.target.value); setAccountForm((f) => ({ ...f, main_category: e.target.value })) }}
            placeholder="输入自定义分类名称"
            className="input flex-1"
          />
          <button type="button"
            onClick={() => { setCustomCategoryMode(false); setCustomCategoryInput(''); setAccountForm((f) => ({ ...f, main_category: '' })) }}
            className="btn-secondary text-sm whitespace-nowrap"
          >
            返回预设
          </button>
        </div>
      )}
      {accountFormErrors.main_category && (
        <p className="text-red-500 text-sm mt-1">{accountFormErrors.main_category}</p>
      )}
    </div>
  )

  /** 内容风格选择区域 */
  const renderStyleSelector = () => (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">内容风格</label>
      {!customStyleMode ? (
        <div className="flex flex-wrap gap-2">
          {CONTENT_STYLES.map((style) => (
            <button key={style} type="button"
              onClick={() => setAccountForm((f) => ({ ...f, content_style: f.content_style === style ? '' : style }))}
              className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                accountForm.content_style === style
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 ring-2 ring-primary-500'
                  : 'bg-gray-100 dark:bg-dark-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-dark-600'
              }`}
            >
              {style}
            </button>
          ))}
          <button type="button"
            onClick={() => { setCustomStyleMode(true); setAccountForm((f) => ({ ...f, content_style: '' })) }}
            className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-dark-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-600 border-2 border-dashed border-gray-300 dark:border-dark-600"
          >
            ✏️ 自定义
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input type="text" value={customStyleInput}
            onChange={(e) => { setCustomStyleInput(e.target.value); setAccountForm((f) => ({ ...f, content_style: e.target.value })) }}
            placeholder="输入自定义风格描述" className="input flex-1"
          />
          <button type="button"
            onClick={() => { setCustomStyleMode(false); setCustomStyleInput(''); setAccountForm((f) => ({ ...f, content_style: '' })) }}
            className="btn-secondary text-sm whitespace-nowrap"
          >
            返回预设
          </button>
        </div>
      )}
    </div>
  )

  /** 内容定位表单块（向导第二步 / 编辑弹窗中共用） */
  const renderPositioningFields = () => (
    <div className="space-y-4">
      {/* AI 内容定位分析按钮 */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleAIAnalyze}
          disabled={analyzing || !accountForm.account_name.trim() || !accountForm.bio.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
            bg-gradient-to-r from-blue-500 to-purple-500 text-white
            hover:from-blue-600 hover:to-purple-600 active:from-blue-700 active:to-purple-700
            disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-blue-500 disabled:hover:to-purple-500
            shadow-sm hover:shadow-md"
        >
          {analyzing ? (
            <><Spinner size="sm" /> <span>AI 分析中...</span></>
          ) : (
            <><span>🤖</span> <span>AI 内容定位分析</span></>
          )}
        </button>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {!accountForm.account_name.trim() || !accountForm.bio.trim()
            ? '请先填写账号名称和个人简介'
            : '根据账号信息自动生成以下定位'}
        </span>
      </div>
      {/* AI 分析结果提示 */}
      {aiSuggested && (
        <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm text-green-600 dark:text-green-400">
          <span>✨</span> AI 已生成定位建议，可直接修改或重新分析
        </div>
      )}
      {renderCategorySelector()}
      {/* 子分类标签 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">子分类标签</label>
        <TagInput
          value={accountForm.sub_categories}
          onChange={(tags) => setAccountForm((f) => ({ ...f, sub_categories: tags }))}
          suggestions={getSubSuggestions(customCategoryMode ? '' : accountForm.main_category)}
          placeholder="输入标签后回车添加..."
          maxTags={10}
        />
      </div>
      {renderStyleSelector()}
      {/* 目标受众 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">目标受众</label>
        <input type="text" value={accountForm.target_audience}
          onChange={(e) => setAccountForm((f) => ({ ...f, target_audience: e.target.value }))}
          placeholder="如：22-30岁职场新人及求职者"
          className="input"
        />
      </div>
    </div>
  )

  /** 账号数据表单块（向导第三步 / 编辑弹窗中共用） */
  const renderStatsFields = () => (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">以下信息为选填，后续可随时补充完善</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">粉丝数</label>
          <input type="text" value={accountForm.followers_count}
            onChange={(e) => setAccountForm((f) => ({ ...f, followers_count: e.target.value }))}
            onBlur={(e) => {
              const n = parseNumberInput(e.target.value)
              if (n > 0) setAccountForm((f) => ({ ...f, followers_count: String(n) }))
            }}
            placeholder="如 5.2w 或 52000" className="input"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">作品数</label>
          <input type="text" value={accountForm.posts_count}
            onChange={(e) => setAccountForm((f) => ({ ...f, posts_count: e.target.value }))}
            onBlur={(e) => {
              const n = parseNumberInput(e.target.value)
              if (n > 0) setAccountForm((f) => ({ ...f, posts_count: String(n) }))
            }}
            placeholder="总作品数" className="input"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">认证状态</label>
          <select value={accountForm.verification_status}
            onChange={(e) => setAccountForm((f) => ({ ...f, verification_status: e.target.value }))}
            className="select w-full"
          >
            {VERIFICATION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">开始运营日期</label>
          <input type="month" value={accountForm.started_at ? accountForm.started_at.substring(0, 7) : ''}
            onChange={(e) => setAccountForm((f) => ({ ...f, started_at: e.target.value ? e.target.value + '-01' : '' }))}
            className="input"
          />
        </div>
      </div>
    </div>
  )

  // ==================== 页面渲染 ====================

  if (loading) return <PageLoading text="加载账号列表..." />

  return (
    <div className="animate-fade-in">
      {/* 页面标题 */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">平台账号管理</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            管理各平台自媒体账号，配置账号信息和历史内容以获得更精准的 AI 推荐与模拟预测
          </p>
        </div>
        <button onClick={handleOpenWizard} className="btn-primary">+ 添加账号</button>
      </div>

      {/* 平台筛选 */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500 dark:text-gray-400">筛选平台:</span>
          <button onClick={() => setSelectedPlatform('')}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              selectedPlatform === ''
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                : 'bg-gray-100 dark:bg-dark-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-600'
            }`}
          >
            全部
          </button>
          {platforms.filter(p => p.code !== 'generic').map((platform) => (
            <button key={platform.code} onClick={() => setSelectedPlatform(platform.code)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors inline-flex items-center gap-1.5 ${
                selectedPlatform === platform.code
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                  : 'bg-gray-100 dark:bg-dark-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-600'
              }`}
            >
              <PlatformIcon platformCode={platform.code} size={16} />
              {platform.name}
            </button>
          ))}
        </div>
      </div>

      {/* 账号列表 */}
      {accounts.length === 0 ? (
        <div className="card text-center py-16">
          <div className="text-5xl mb-4">👤</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">暂无账号配置</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">添加你的自媒体账号信息，获得更精准的 AI 推荐与模拟预测</p>
          <button onClick={handleOpenWizard} className="btn-primary">添加第一个账号</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {accounts.map((account) => {
            const platformInfo = getPlatformInfo(account.platform_code)
            const completeness = calcCompleteness(account)
            const hint = getCompletenessHint(account)
            const operationMonths = calcOperationMonths(account.started_at)
            const stale = isStatsStale(account.stats_updated_at)
            const verLabel = VERIFICATION_STATUSES.find((v) => v.value === account.verification_status)?.label

            return (
              <div key={account.id} className="card">
                {/* 数据过时提示 */}
                {stale && (
                  <div className="flex items-center gap-2 mb-3 p-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg text-xs text-orange-600 dark:text-orange-400">
                    <span>⚠️</span> 账号数据已超过 30 天未更新，建议点击编辑刷新
                  </div>
                )}

                {/* 头部 */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: `${platformInfo.color}20` }}>
                      <PlatformIcon platformCode={account.platform_code} size={28} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{account.account_name}</span>
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
                          style={{ backgroundColor: `${platformInfo.color}20`, color: platformInfo.color }}>
                          <PlatformIcon platformCode={account.platform_code} size={12} />
                          {platformInfo.name}
                        </span>
                        {verLabel && account.verification_status !== 'none' && (
                          <span className="tag-primary text-xs">{verLabel}</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        {account.main_category}
                        {account.content_style && ` · ${account.content_style}`}
                        {account.account_id && ` · @${account.account_id}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleEditAccount(account)} className="btn-text text-sm">编辑</button>
                    <button onClick={() => handleDeleteAccount(account.id)} className="btn-text text-sm text-red-600 dark:text-red-400">删除</button>
                  </div>
                </div>

                {/* 简介 */}
                {account.bio && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">{account.bio}</p>
                )}

                {/* 子分类标签 */}
                {account.sub_categories && account.sub_categories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {account.sub_categories.map((cat) => (
                      <span key={cat} className="tag-gray text-xs">{cat}</span>
                    ))}
                  </div>
                )}

                {/* 核心数据 */}
                <div className="grid grid-cols-3 gap-4 p-3 bg-gray-50 dark:bg-dark-700/50 rounded-lg mb-3">
                  <div className="text-center">
                    <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatNumber(account.followers_count)}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">粉丝</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatNumber(account.posts_count)}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">作品</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {operationMonths !== null ? operationMonths : '-'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">运营月</div>
                  </div>
                </div>

                {/* 历史内容 */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      历史内容
                      {account.post_performances && account.post_performances.length > 0 && (
                        <span className="ml-1 text-gray-400">({account.post_performances.length})</span>
                      )}
                    </span>
                    <button onClick={() => handleAddPost(account.id)}
                      className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      + 添加
                    </button>
                  </div>
                  {account.post_performances && account.post_performances.length > 0 ? (
                    <div className="space-y-1.5">
                      {account.post_performances.slice(0, 3).map((post) => (
                        <div key={post.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-dark-700/50 rounded-lg group">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                              {!!post.is_top && <span className="text-yellow-500 mr-1">★</span>}
                              {post.title}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              <span>👁 {formatNumber(post.views)}</span>
                              <span>❤️ {formatNumber(post.likes)}</span>
                              <span>💬 {post.comments}</span>
                              <span className="text-green-600 dark:text-green-400">📈 {post.engagement_rate}%</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 ml-2 shrink-0">
                            <button onClick={() => handleEditPost(account.id, post)} className="text-primary-600 dark:text-primary-400 hover:underline text-xs">编辑</button>
                            <button onClick={() => handleDeletePost(post.id)} className="text-red-500 hover:underline text-xs">删除</button>
                          </div>
                        </div>
                      ))}
                      {account.post_performances.length > 3 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                          还有 {account.post_performances.length - 3} 条内容
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-4 bg-gray-50 dark:bg-dark-700/50 rounded-lg">
                      <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">暂无历史内容</p>
                      <button onClick={() => handleAddPost(account.id)}
                        className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        添加第一条 →
                      </button>
                    </div>
                  )}
                </div>

                {/* 完善度 */}
                <div className="pt-3 border-t border-gray-200 dark:border-dark-700">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 h-1.5 bg-gray-200 dark:bg-dark-600 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${completeness}%`,
                          backgroundColor: completeness >= 80 ? '#10B981' : completeness >= 50 ? '#F59E0B' : '#6366F1',
                        }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{completeness}%</span>
                  </div>
                  {hint && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">💡 {hint}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ==================== 三步向导弹窗 ==================== */}
      <Modal isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)}
        title={`添加账号 (${wizardStep}/3)`} size="lg">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 步骤条 */}
          <div className="flex items-center gap-2 mb-2">
            {['基础信息', '内容定位', '账号数据'].map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                  wizardStep > i + 1 ? 'bg-green-500 text-white' :
                  wizardStep === i + 1 ? 'bg-primary-500 text-white' :
                  'bg-gray-200 dark:bg-dark-600 text-gray-500'
                }`}>
                  {wizardStep > i + 1 ? '✓' : i + 1}
                </div>
                <span className={`text-xs ${wizardStep === i + 1 ? 'text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-400'}`}>
                  {label}
                </span>
                {i < 2 && <div className="flex-1 h-px bg-gray-200 dark:bg-dark-600" />}
              </div>
            ))}
          </div>

          {/* 第一步：基础信息 */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              {/* 平台选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  选择平台 <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {platforms.filter(p => p.code !== 'generic').map((platform) => (
                    <button key={platform.code} type="button"
                      onClick={() => setAccountForm((f) => ({ ...f, platform_code: platform.code }))}
                      className={`px-4 py-2 rounded-lg border-2 transition-all inline-flex items-center gap-2 ${
                        accountForm.platform_code === platform.code
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-gray-200 dark:border-dark-600 hover:border-gray-300 dark:hover:border-dark-500'
                      }`}
                    >
                      <PlatformIcon platformCode={platform.code} size={20} />
                      <span className="text-sm">{platform.name}</span>
                    </button>
                  ))}
                </div>
                {accountFormErrors.platform_code && <p className="text-red-500 text-sm mt-1">{accountFormErrors.platform_code}</p>}
              </div>
              {/* 账号名称 + ID */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    账号名称 <span className="text-red-500">*</span>
                  </label>
                  <input type="text" value={accountForm.account_name}
                    onChange={(e) => setAccountForm((f) => ({ ...f, account_name: e.target.value }))}
                    placeholder="如：职场小达人" className="input"
                  />
                  {accountFormErrors.account_name && <p className="text-red-500 text-sm mt-1">{accountFormErrors.account_name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">账号 ID</label>
                  <input type="text" value={accountForm.account_id}
                    onChange={(e) => setAccountForm((f) => ({ ...f, account_id: e.target.value }))}
                    placeholder="平台号（选填）" className="input"
                  />
                </div>
              </div>
              {/* 个人简介 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">个人简介</label>
                <textarea value={accountForm.bio}
                  onChange={(e) => setAccountForm((f) => ({ ...f, bio: e.target.value }))}
                  placeholder="粘贴你的账号简介/签名，AI 将据此分析内容定位" rows={3} className="input"
                />
              </div>
              {/* 操作按钮 */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-dark-700">
                <button onClick={() => setIsWizardOpen(false)} className="btn-secondary">取消</button>
                <button onClick={handleWizardNext} className="btn-primary"
                  disabled={!accountForm.platform_code || !accountForm.account_name.trim()}>
                  下一步
                </button>
              </div>
            </div>
          )}

          {/* 第二步：内容定位 */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              {renderPositioningFields()}
              <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-dark-700">
                <button onClick={() => setWizardStep(1)} className="btn-secondary">上一步</button>
                <button onClick={handleWizardNext} className="btn-primary">下一步</button>
              </div>
            </div>
          )}

          {/* 第三步：账号数据 */}
          {wizardStep === 3 && (
            <div className="space-y-4">
              {renderStatsFields()}
              <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-dark-700">
                <button onClick={() => setWizardStep(2)} className="btn-secondary">上一步</button>
                <div className="flex gap-3">
                  <button onClick={() => handleSaveAccount(false)} className="btn-secondary" disabled={savingAccount}>
                    跳过，稍后完善
                  </button>
                  <button onClick={() => handleSaveAccount(false)} className="btn-primary" disabled={savingAccount}>
                    {savingAccount ? <Spinner size="sm" /> : '保存'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ==================== 编辑账号弹窗 ==================== */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)}
        title="编辑账号" size="lg">
        <div className="space-y-5 max-h-[75vh] overflow-y-auto">
          {/* 基础信息组 */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">基础信息</h3>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${getPlatformInfo(accountForm.platform_code).color}20` }}>
                <PlatformIcon platformCode={accountForm.platform_code} size={24} />
              </div>
              <span className="text-sm text-gray-500">{getPlatformInfo(accountForm.platform_code).name}（不可修改）</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">账号名称 <span className="text-red-500">*</span></label>
                <input type="text" value={accountForm.account_name}
                  onChange={(e) => setAccountForm((f) => ({ ...f, account_name: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">账号 ID</label>
                <input type="text" value={accountForm.account_id}
                  onChange={(e) => setAccountForm((f) => ({ ...f, account_id: e.target.value }))}
                  className="input"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">个人简介</label>
              <textarea value={accountForm.bio}
                onChange={(e) => setAccountForm((f) => ({ ...f, bio: e.target.value }))}
                rows={2} className="input"
              />
            </div>
          </div>

          {/* 内容定位组 */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">内容定位</h3>
            {renderPositioningFields()}
          </div>

          {/* 账号数据组 */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">账号数据</h3>
            {renderStatsFields()}
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-dark-700">
            <button onClick={() => setIsEditModalOpen(false)} className="btn-secondary" disabled={savingAccount}>取消</button>
            <button onClick={() => handleSaveAccount(true)} className="btn-primary" disabled={savingAccount}>
              {savingAccount ? <Spinner size="sm" /> : '保存'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ==================== 历史内容弹窗 ==================== */}
      <Modal isOpen={isPostModalOpen} onClose={() => setIsPostModalOpen(false)}
        title={editingPost ? '编辑历史内容' : '添加历史内容'} size="lg">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              内容标题 <span className="text-red-500">*</span>
            </label>
            <input type="text" value={postForm.title}
              onChange={(e) => setPostForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="如：职场新人必看的10个避坑指南" className="input"
            />
            {postFormErrors.title && <p className="text-red-500 text-sm mt-1">{postFormErrors.title}</p>}
          </div>

          {/* 内容详情（可选） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              内容详情 <span className="text-xs text-gray-400 font-normal">（可选，内容原文或简介）</span>
            </label>
            <textarea
              value={postForm.content || ''}
              onChange={(e) => setPostForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="可粘贴内容原文、笔记正文或简要描述，便于 AI 更准确地分析内容风格和受众偏好"
              rows={3}
              className="input resize-y min-h-[72px]"
            />
          </div>

          {/* 类型 + 发布时间 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">内容类型</label>
              <div className="flex flex-wrap gap-2">
                {getAvailablePostTypes().map((type) => (
                  <button key={type} type="button"
                    onClick={() => setPostForm((f) => ({ ...f, post_type: type }))}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                      postForm.post_type === type
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 ring-2 ring-primary-500'
                        : 'bg-gray-100 dark:bg-dark-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-dark-600'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">发布日期</label>
              <input type="date" value={postForm.publish_time || ''}
                onChange={(e) => setPostForm((f) => ({ ...f, publish_time: e.target.value }))}
                className="input"
              />
            </div>
          </div>

          {/* 内容标签 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">内容标签</label>
            <TagInput
              value={postForm.tags || []}
              onChange={(tags) => setPostForm((f) => ({ ...f, tags }))}
              placeholder="输入标签后回车添加..."
              maxTags={10}
            />
          </div>

          {/* 内容链接 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">内容链接</label>
            <input type="url" value={postForm.post_url || ''}
              onChange={(e) => setPostForm((f) => ({ ...f, post_url: e.target.value }))}
              placeholder="https://..." className="input"
            />
          </div>

          {/* 数据指标 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">数据指标</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { key: 'views', label: '👁 阅读/播放' },
                { key: 'likes', label: '❤️ 点赞' },
                { key: 'comments', label: '💬 评论' },
                { key: 'favorites', label: '⭐ 收藏' },
                { key: 'shares', label: '🔄 转发' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
                  <input type="number"
                    value={(() => {
                      const v = (postForm as unknown as Record<string, unknown>)[key]
                      if (v == null) return ''
                      if (typeof v === 'number') return v
                      if (typeof v === 'string') return v
                      return ''
                    })()}
                    onChange={(e) => {
                      const val = e.target.value
                      setPostForm((f) => ({ ...f, [key]: val === '' ? undefined : parseInt(val) || 0 }))
                    }}
                    min={0} placeholder="0" className="input"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">📈 互动率</label>
                <div className="input bg-gray-100 dark:bg-dark-600 cursor-not-allowed text-gray-700 dark:text-gray-300">
                  {calcEngagementRate(
                    postForm.views || 0, postForm.likes || 0,
                    postForm.comments || 0, postForm.favorites || 0, postForm.shares || 0
                  )}%
                </div>
              </div>
            </div>
          </div>

          {/* 代表作标记 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={postForm.is_top || false}
              onChange={(e) => setPostForm((f) => ({ ...f, is_top: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">★ 标记为代表作（AI 将优先参考）</span>
          </label>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-dark-700">
            <button onClick={() => setIsPostModalOpen(false)} className="btn-secondary" disabled={savingPost}>取消</button>
            <button onClick={handleSavePost} className="btn-primary" disabled={savingPost}>
              {savingPost ? <Spinner size="sm" /> : editingPost ? '保存' : '添加'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
