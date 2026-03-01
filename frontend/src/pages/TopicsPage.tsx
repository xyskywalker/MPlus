/**
 * 选题管理页面组件
 * 显示选题列表和管理功能
 * 支持查看、编辑、删除选题，AI 生成详细内容，AI 迁移选题
 * 编辑界面禁止修改平台，显示关联账号信息
 */

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  getTopics,
  getPlatforms,
  deleteTopic,
  updateTopic,
  createTopic,
  getTopicSimulations,
  getSimulation,
  generateTopicContent,
  aiGenerateTopicInfo,
  aiGenerateContentDraft,
  migrateTopic,
  getAccounts,
  type Topic,
  type Platform,
  type Simulation,
  type AccountProfile,
} from '../services/api'
import { PageLoading, Spinner } from '../components/Loading'
import Modal from '../components/Modal'
import SimulationResultModal from '../components/SimulationResultModal'
import PlatformSelect from '../components/PlatformSelect'
import { PlatformIcon } from '../components/PlatformIcons'
import { useAppStore } from '../stores/appStore'

// 编辑表单数据结构
interface TopicEditForm {
  title: string
  description: string
  target_platform: string
  content: string
  audience: string
  tone: string
  format: string
  tags: string
  status: 'draft' | 'simulated' | 'archived'
}

// 状态筛选选项
const STATUS_OPTIONS = [
  { value: '', label: '全部', icon: '📋' },
  { value: 'draft', label: '草稿', icon: '📝' },
  { value: 'simulated', label: '已模拟', icon: '✅' },
  { value: 'archived', label: '已归档', icon: '🗄️' },
]

// 格式化粉丝数
const formatFollowers = (count: number): string => {
  if (!count || count <= 0) return '0'
  if (count >= 10000) return `${(count / 10000).toFixed(1)}w`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return count.toString()
}

export default function TopicsPage() {
  const { showToast } = useAppStore()
  const [topics, setTopics] = useState<Topic[]>([])
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => {
    const match = document.cookie.match(/(?:^|;\s*)topics_view=(card|list)/)
    return (match ? match[1] : 'card') as 'card' | 'list'
  })
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null)
  
  // 模拟结果查看状态
  const [resultModalOpen, setResultModalOpen] = useState(false)
  const [viewingTopic, setViewingTopic] = useState<Topic | null>(null)
  const [viewingSimulation, setViewingSimulation] = useState<Simulation | null>(null)
  const [loadingResult, setLoadingResult] = useState(false)

  // 编辑状态
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null)
  const [editForm, setEditForm] = useState<TopicEditForm>({
    title: '',
    description: '',
    target_platform: '',
    content: '',
    audience: '',
    tone: '',
    format: '',
    tags: '',
    status: 'draft',
  })
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // AI 生成详细内容状态
  const [generatingContent, setGeneratingContent] = useState(false)

  // 新增选题状态
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createForm, setCreateForm] = useState<Omit<TopicEditForm, 'status'>>({
    title: '',
    description: '',
    target_platform: '',
    content: '',
    audience: '',
    tone: '',
    format: '',
    tags: '',
  })
  const [createAccountId, setCreateAccountId] = useState('')
  const [createAccounts, setCreateAccounts] = useState<AccountProfile[]>([])
  const [loadingCreateAccounts, setLoadingCreateAccounts] = useState(false)
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [generatingInfo, setGeneratingInfo] = useState(false)
  const [generatingDraftContent, setGeneratingDraftContent] = useState(false)

  // AI 迁移状态
  const [migrateModalOpen, setMigrateModalOpen] = useState(false)
  const [migratingTopic, setMigratingTopic] = useState<Topic | null>(null)
  const [migratePlatform, setMigratePlatform] = useState('')
  const [migrateAccountId, setMigrateAccountId] = useState('')
  const [migrateAccounts, setMigrateAccounts] = useState<AccountProfile[]>([])
  const [loadingMigrateAccounts, setLoadingMigrateAccounts] = useState(false)
  const [migrating, setMigrating] = useState(false)

  // 获取数据（不传 status 筛选，全量拉取后客户端过滤）
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [topicsData, platformsData] = await Promise.all([
          getTopics({ platform: platformFilter || undefined, limit: 100 }),
          getPlatforms(),
        ])
        setTopics(topicsData.items)
        setPlatforms(platformsData)
      } catch (err) {
        console.error('获取数据失败:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [platformFilter])

  // 获取平台信息
  const getPlatformInfo = (code: string) => {
    return platforms.find((p) => p.code === code) || { name: '未知', icon: '📱', color: '#6366F1' }
  }

  // 判断选题是否有已完成的模拟（兼顾 status 和 simulation_count）
  const hasSimulation = (t: Topic) =>
    t.status === 'simulated' || (t.simulation_count != null && t.simulation_count > 0)

  // 获取状态标签样式
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'draft':
        return 'tag-gray'
      case 'simulated':
        return 'tag-success'
      case 'archived':
        return 'tag-warning'
      default:
        return 'tag-gray'
    }
  }

  // 获取状态显示文本
  const getStatusText = (status: string) => {
    switch (status) {
      case 'draft':
        return '草稿'
      case 'simulated':
        return '已模拟'
      case 'archived':
        return '已归档'
      default:
        return status
    }
  }

  // 格式化时间
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(hours / 24)

    if (hours < 1) return '刚刚'
    if (hours < 24) return `${hours}小时前`
    if (days < 7) return `${days}天前`
    return date.toLocaleDateString()
  }

  // 导出选题为 Markdown 文件
  const handleExport = (topic: Topic) => {
    const platformInfo = getPlatformInfo(topic.target_platform || '')
    const meta = topic.metadata || {}
    const lines: string[] = []

    lines.push(`# ${topic.title}`)
    lines.push('')

    // 基本信息表格
    lines.push('## 基本信息')
    lines.push('')
    lines.push(`| 项目 | 内容 |`)
    lines.push(`| --- | --- |`)
    lines.push(`| 目标平台 | ${platformInfo.name || '未指定'} |`)
    if (topic.account_summary) {
      lines.push(`| 关联账号 | @${topic.account_summary.account_name}${topic.account_summary.main_category ? ' · ' + topic.account_summary.main_category : ''}${topic.account_summary.followers_count ? ' · ' + formatFollowers(topic.account_summary.followers_count) + '粉丝' : ''} |`)
    } else {
      lines.push(`| 关联账号 | 通用模式 |`)
    }
    lines.push(`| 状态 | ${getStatusText(topic.status)} |`)
    if (meta.audience) lines.push(`| 目标受众 | ${meta.audience} |`)
    if (meta.tone) lines.push(`| 内容调性 | ${meta.tone} |`)
    if (meta.format) lines.push(`| 内容形式 | ${meta.format} |`)
    lines.push(`| 创建时间 | ${new Date(topic.created_at).toLocaleString()} |`)
    lines.push(`| 更新时间 | ${new Date(topic.updated_at).toLocaleString()} |`)
    lines.push('')

    // 描述
    if (topic.description) {
      lines.push('## 选题描述')
      lines.push('')
      lines.push(topic.description)
      lines.push('')
    }

    // 标签
    if (meta.tags && meta.tags.length > 0) {
      lines.push('## 标签')
      lines.push('')
      lines.push(meta.tags.map(t => `\`${t}\``).join(' '))
      lines.push('')
    }

    // 详细内容
    if (topic.content) {
      lines.push('## 详细内容')
      lines.push('')
      lines.push(topic.content)
      lines.push('')
    }

    // 模拟数据
    if (topic.latest_metrics) {
      const m = topic.latest_metrics
      lines.push('## 模拟数据')
      lines.push('')
      lines.push(`| 指标 | 数值 |`)
      lines.push(`| --- | --- |`)
      lines.push(`| 曝光量 | ${m.impressions.toLocaleString()} |`)
      lines.push(`| 点赞 | ${m.likes.toLocaleString()} |`)
      lines.push(`| 评论 | ${m.comments.toLocaleString()} |`)
      lines.push(`| 收藏 | ${m.favorites.toLocaleString()} |`)
      lines.push(`| 互动率 | ${m.engagement_rate}% |`)
      lines.push('')
    }

    lines.push('---')
    lines.push(`> 导出自 MPlus 百万加 · ${new Date().toLocaleString()}`)

    const content = lines.join('\n')
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `选题_${topic.title.slice(0, 20).replace(/[/\\?%*:|"<>]/g, '_')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('success', '导出成功')
  }

  // 删除选题
  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个选题吗？')) return

    try {
      await deleteTopic(id)
      setTopics((prev) => prev.filter((t) => t.id !== id))
      showToast('success', '删除成功')
    } catch (err) {
      showToast('error', '删除失败')
    }
  }

  // 查看模拟结果（先获取列表，再加载最新一条的完整数据）
  const handleViewResult = async (topic: Topic) => {
    setViewingTopic(topic)
    setResultModalOpen(true)
    setLoadingResult(true)
    setViewingSimulation(null)

    try {
      const list = await getTopicSimulations(topic.id, 1)
      if (list.items && list.items.length > 0) {
        const fullSim = await getSimulation(list.items[0].id)
        setViewingSimulation(fullSim)
      }
    } catch (err) {
      console.error('获取模拟结果失败:', err)
      showToast('error', '获取模拟结果失败')
    } finally {
      setLoadingResult(false)
    }
  }

  // 关闭模拟结果对话框
  const handleCloseResultModal = () => {
    setResultModalOpen(false)
    setViewingTopic(null)
    setViewingSimulation(null)
  }

  // 打开编辑对话框
  const handleOpenEdit = (topic: Topic) => {
    setEditingTopic(topic)
    setEditForm({
      title: topic.title,
      description: topic.description || '',
      target_platform: topic.target_platform || '',
      content: topic.content || '',
      audience: topic.metadata?.audience || '',
      tone: topic.metadata?.tone || '',
      format: topic.metadata?.format || '',
      tags: topic.metadata?.tags?.join(', ') || '',
      status: topic.status,
    })
    setEditErrors({})
    setEditModalOpen(true)
    // 如果是从详情弹窗打开，先关闭详情弹窗
    setSelectedTopic(null)
  }

  // 关闭编辑对话框
  const handleCloseEdit = () => {
    setEditModalOpen(false)
    setEditingTopic(null)
    setEditErrors({})
  }

  // 验证编辑表单
  const validateEditForm = () => {
    const errors: Record<string, string> = {}
    if (!editForm.title.trim()) {
      errors.title = '请输入选题标题'
    }
    setEditErrors(errors)
    return Object.keys(errors).length === 0
  }

  // 执行保存（内部逻辑，可复用）
  // silent=true 时不弹 toast、不关闭弹窗，返回保存后的 Topic
  const doSaveEdit = async (silent = false): Promise<Topic | null> => {
    if (!editingTopic || !validateEditForm()) return null

    setSaving(true)
    try {
      const tagsArray = editForm.tags
        .split(/[,，]/)
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0)

      const updateData: Partial<Topic> = {
        title: editForm.title,
        description: editForm.description || null,
        content: editForm.content || null,
        metadata: {
          audience: editForm.audience || undefined,
          tone: editForm.tone || undefined,
          format: editForm.format || undefined,
          tags: tagsArray.length > 0 ? tagsArray : undefined,
        },
        status: editForm.status,
      }

      const updatedTopic = await updateTopic(editingTopic.id, updateData)
      setTopics(prev => prev.map(t => t.id === updatedTopic.id ? updatedTopic : t))

      if (!silent) {
        showToast('success', '保存成功')
        handleCloseEdit()
      }
      return updatedTopic
    } catch (err) {
      console.error('保存失败:', err)
      showToast('error', '保存失败')
      return null
    } finally {
      setSaving(false)
    }
  }

  // 保存编辑（用户点击保存按钮）
  const handleSaveEdit = () => doSaveEdit(false)

  // ==================== 手动新增选题 ====================

  // 加载新增选题时目标平台下的账号列表
  const loadCreateAccounts = useCallback(async (platformCode: string) => {
    if (!platformCode) {
      setCreateAccounts([])
      return
    }
    setLoadingCreateAccounts(true)
    try {
      const data = await getAccounts(platformCode)
      setCreateAccounts(Array.isArray(data) ? data : (data as any).items || [])
    } catch (err) {
      console.error('加载账号失败:', err)
      setCreateAccounts([])
    } finally {
      setLoadingCreateAccounts(false)
    }
  }, [])

  // 打开新增选题弹窗
  const handleOpenCreate = () => {
    setCreateForm({
      title: '',
      description: '',
      target_platform: '',
      content: '',
      audience: '',
      tone: '',
      format: '',
      tags: '',
    })
    setCreateAccountId('')
    setCreateAccounts([])
    setCreateErrors({})
    setCreateModalOpen(true)
  }

  // 新增选题平台变更时加载账号
  const handleCreatePlatformChange = (code: string) => {
    setCreateForm(prev => ({ ...prev, target_platform: code }))
    setCreateAccountId('')
    loadCreateAccounts(code)
  }

  // 验证新增表单
  const validateCreateForm = () => {
    const errors: Record<string, string> = {}
    if (!createForm.title.trim()) {
      errors.title = '请输入选题标题'
    }
    setCreateErrors(errors)
    return Object.keys(errors).length === 0
  }

  // AI 一键生成选题信息（基于标题生成描述、受众、调性、形式、标签）
  const handleAIGenerateInfo = async () => {
    if (!createForm.title.trim()) {
      setCreateErrors({ title: '请先输入选题标题' })
      return
    }
    setGeneratingInfo(true)
    try {
      const result = await aiGenerateTopicInfo({
        title: createForm.title.trim(),
        target_platform: createForm.target_platform || undefined,
        account_profile_id: createAccountId || undefined,
      })
      setCreateForm(prev => ({
        ...prev,
        description: result.description || prev.description,
        audience: result.audience || prev.audience,
        tone: result.tone || prev.tone,
        format: result.format || prev.format,
        tags: (result.tags || []).join(', ') || prev.tags,
      }))
      showToast('success', 'AI 已自动生成选题信息')
    } catch (err: any) {
      console.error('AI 生成选题信息失败:', err)
      const msg = err?.response?.data?.detail || err?.message || '生成失败，请重试'
      showToast('error', msg)
    } finally {
      setGeneratingInfo(false)
    }
  }

  // AI 生成详细内容（用于新增选题场景，不依赖已保存的选题）
  const handleAIGenerateDraftContent = async () => {
    if (!createForm.title.trim()) {
      setCreateErrors({ title: '请先输入选题标题' })
      return
    }
    setGeneratingDraftContent(true)
    try {
      const tagsArray = createForm.tags
        .split(/[,，]/)
        .map(t => t.trim())
        .filter(Boolean)
      const result = await aiGenerateContentDraft({
        title: createForm.title.trim(),
        description: createForm.description.trim() || undefined,
        target_platform: createForm.target_platform || undefined,
        account_profile_id: createAccountId || undefined,
        metadata: {
          audience: createForm.audience.trim() || undefined,
          tone: createForm.tone.trim() || undefined,
          format: createForm.format.trim() || undefined,
          tags: tagsArray.length > 0 ? tagsArray : undefined,
        },
      })
      setCreateForm(prev => ({ ...prev, content: result.content }))
      showToast('success', 'AI 已生成详细内容')
    } catch (err: any) {
      console.error('AI 生成详细内容失败:', err)
      const msg = err?.response?.data?.detail || err?.message || '生成失败，请重试'
      showToast('error', msg)
    } finally {
      setGeneratingDraftContent(false)
    }
  }

  // 执行新增选题
  const handleConfirmCreate = async () => {
    if (!validateCreateForm()) return

    setCreating(true)
    try {
      const tagsArray = createForm.tags
        .split(/[,，]/)
        .map(t => t.trim())
        .filter(Boolean)

      const newTopic = await createTopic({
        title: createForm.title.trim(),
        description: createForm.description.trim() || undefined,
        target_platform: createForm.target_platform || undefined,
        content: createForm.content.trim() || undefined,
        metadata: {
          audience: createForm.audience.trim() || undefined,
          tone: createForm.tone.trim() || undefined,
          format: createForm.format.trim() || undefined,
          tags: tagsArray.length > 0 ? tagsArray : undefined,
        },
        account_profile_id: createAccountId || undefined,
      })

      setTopics(prev => [newTopic, ...prev])
      showToast('success', '选题创建成功')
      setCreateModalOpen(false)
    } catch (err: any) {
      console.error('创建选题失败:', err)
      const msg = err?.response?.data?.detail || err?.message || '创建失败，请重试'
      showToast('error', msg)
    } finally {
      setCreating(false)
    }
  }

  // ==================== AI 生成详细内容 ====================
  const handleGenerateContent = async () => {
    if (!editingTopic) return

    setGeneratingContent(true)
    try {
      const result = await generateTopicContent(editingTopic.id)
      setEditForm(prev => ({ ...prev, content: result.content }))
      showToast('success', 'AI 已生成详细内容')
    } catch (err: any) {
      console.error('AI 生成失败:', err)
      const msg = err?.response?.data?.detail || err?.message || '生成失败，请重试'
      showToast('error', msg)
    } finally {
      setGeneratingContent(false)
    }
  }

  // ==================== AI 迁移选题 ====================

  // 加载目标平台下的账号列表
  const loadMigrateAccounts = useCallback(async (platformCode: string) => {
    if (!platformCode) {
      setMigrateAccounts([])
      return
    }
    setLoadingMigrateAccounts(true)
    try {
      const data = await getAccounts(platformCode)
      setMigrateAccounts(Array.isArray(data) ? data : (data as any).items || [])
    } catch (err) {
      console.error('加载账号失败:', err)
      setMigrateAccounts([])
    } finally {
      setLoadingMigrateAccounts(false)
    }
  }, [])

  // 打开迁移弹窗
  const handleOpenMigrate = (topic: Topic) => {
    setMigratingTopic(topic)
    setMigratePlatform('')
    setMigrateAccountId('')
    setMigrateAccounts([])
    setMigrateModalOpen(true)
    // 关闭详情/编辑弹窗
    setSelectedTopic(null)
    setEditModalOpen(false)
  }

  // 目标平台变化时加载账号
  const handleMigratePlatformChange = (code: string) => {
    setMigratePlatform(code)
    setMigrateAccountId('')
    loadMigrateAccounts(code)
  }

  // 判断迁移目标是否和当前一致
  const isMigrateTargetSame = (): boolean => {
    if (!migratingTopic) return true
    const samePlatform = migratePlatform === (migratingTopic.target_platform || '')
    const sameAccount = (migrateAccountId || '') === (migratingTopic.account_profile_id || '')
    return samePlatform && sameAccount
  }

  // 执行迁移
  const handleConfirmMigrate = async () => {
    if (!migratingTopic || !migratePlatform || isMigrateTargetSame()) return

    setMigrating(true)
    try {
      const newTopic = await migrateTopic(migratingTopic.id, {
        target_platform: migratePlatform,
        target_account_profile_id: migrateAccountId || undefined,
      })
      // 将新选题加入列表头部
      setTopics(prev => [newTopic, ...prev])
      showToast('success', '选题迁移成功')
      setMigrateModalOpen(false)
    } catch (err: any) {
      console.error('迁移失败:', err)
      const msg = err?.response?.data?.detail || err?.message || '迁移失败，请重试'
      showToast('error', msg)
    } finally {
      setMigrating(false)
    }
  }

  // 统计数据（始终基于全量 topics）
  const stats = {
    total: topics.length,
    draft: topics.filter((t) => t.status === 'draft').length,
    simulated: topics.filter((t) => t.status === 'simulated').length,
    archived: topics.filter((t) => t.status === 'archived').length,
  }

  // 客户端状态过滤（展示用）
  const displayedTopics = statusFilter
    ? topics.filter((t) => t.status === statusFilter)
    : topics

  if (loading) {
    return <PageLoading text="加载选题列表..." />
  }

  return (
    <div className="animate-fade-in">
      {/* 页面标题 */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">📋 选题管理</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleOpenCreate}
            className="btn-secondary"
          >
            + 手动新增
          </button>
          <Link to="/brainstorm" className="btn-primary">
            🧠 AI 头脑风暴
          </Link>
        </div>
      </div>

      {/* 免责声明提示 */}
      <div className="mb-4 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/40 text-sm text-amber-700 dark:text-amber-400 leading-relaxed">
        <span className="font-medium">⚠️ 提示：</span>所有通过 AI 生成的选题及相关内容仅供参考，发布前请务必依据各平台的社区规范与内容规则自行审核与修改。严禁发布任何违反法律法规的内容，因违规使用所产生的一切后果由使用者自行承担。
      </div>

      <div className="flex gap-6">
        {/* 左侧筛选栏 */}
        <div className="w-56 flex-shrink-0 space-y-4">
          {/* 状态筛选 */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">状态筛选</h3>
            <div className="space-y-1">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setStatusFilter(option.value)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    statusFilter === option.value
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                      : 'hover:bg-gray-100 dark:hover:bg-dark-700 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <span>
                    {option.icon} {option.label}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {option.value === ''
                      ? stats.total
                      : option.value === 'draft'
                      ? stats.draft
                      : option.value === 'simulated'
                      ? stats.simulated
                      : stats.archived}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 平台筛选 */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">平台筛选</h3>
            <div className="space-y-1">
              <button
                onClick={() => setPlatformFilter('')}
                className={`w-full flex items-center px-3 py-2 rounded-lg text-sm transition-colors ${
                  platformFilter === ''
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                    : 'hover:bg-gray-100 dark:hover:bg-dark-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                📱 全部平台
              </button>
              {platforms.slice(0, -1).map((platform) => (
                <button
                  key={platform.code}
                  onClick={() => setPlatformFilter(platform.code)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    platformFilter === platform.code
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                      : 'hover:bg-gray-100 dark:hover:bg-dark-700 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <PlatformIcon platformCode={platform.code} size={16} />
                  {platform.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧内容区 */}
        <div className="flex-1">
          {/* 工具栏 */}
          <div className="flex justify-between items-center mb-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              共 {displayedTopics.length} 个选题
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => { setViewMode('card'); document.cookie = 'topics_view=card; path=/; max-age=31536000; SameSite=Lax' }}
                className={`p-2 rounded ${
                  viewMode === 'card'
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600'
                    : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-700'
                }`}
                title="卡片视图"
              >
                ▣
              </button>
              <button
                onClick={() => { setViewMode('list'); document.cookie = 'topics_view=list; path=/; max-age=31536000; SameSite=Lax' }}
                className={`p-2 rounded ${
                  viewMode === 'list'
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600'
                    : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-700'
                }`}
                title="列表视图"
              >
                ≡
              </button>
            </div>
          </div>

          {/* 选题列表 */}
          {displayedTopics.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                {statusFilter ? '当前筛选条件下暂无选题' : '暂无选题'}
              </p>
              {!statusFilter && (
                <Link to="/brainstorm" className="btn-primary">
                  开始头脑风暴
                </Link>
              )}
            </div>
          ) : viewMode === 'card' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {displayedTopics.map((topic) => {
                const platformInfo = getPlatformInfo(topic.target_platform || '')
                return (
                  <div key={topic.id} className="card-hover">
                    {/* 标题行：平台 + 账号 + 状态 */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded"
                          style={{
                            backgroundColor: `${platformInfo.color}20`,
                            color: platformInfo.color,
                          }}
                        >
                          <PlatformIcon platformCode={topic.target_platform || ''} size={14} />
                          {platformInfo.name}
                        </span>
                        {/* 账号标签 */}
                        {topic.account_summary ? (
                          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                            @{topic.account_summary.account_name}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500">通用</span>
                        )}
                      </div>
                      <span className={getStatusStyle(topic.status)}>
                        {getStatusText(topic.status)}
                        {topic.status === 'simulated' && topic.simulation_count != null && topic.simulation_count > 1 && ` (${topic.simulation_count})`}
                      </span>
                      {hasSimulation(topic) && topic.status !== 'simulated' && (
                        <span className="tag-success">
                          已模拟{topic.simulation_count != null && topic.simulation_count > 1 ? ` (${topic.simulation_count})` : ''}
                        </span>
                      )}
                    </div>

                    {/* 标题 */}
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 line-clamp-2">
                      {topic.title}
                    </h3>

                    {/* 描述 */}
                    {topic.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">
                        {topic.description}
                      </p>
                    )}

                    {/* 标签 */}
                    {topic.metadata?.tags && topic.metadata.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {topic.metadata.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="tag-gray text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 模拟数据 */}
                    {topic.latest_metrics && (
                      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-3 p-2 bg-gray-50 dark:bg-dark-700/50 rounded">
                        <span>👁 {(topic.latest_metrics.impressions / 1000).toFixed(1)}k</span>
                        <span>❤️ {topic.latest_metrics.likes}</span>
                        <span>💬 {topic.latest_metrics.comments}</span>
                        <span className="text-green-600 dark:text-green-400">
                          📈 {topic.latest_metrics.engagement_rate}%
                        </span>
                      </div>
                    )}

                    {/* 底部 */}
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-dark-700">
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {formatTime(topic.updated_at)}
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setSelectedTopic(topic)}
                          className="btn-text text-xs"
                        >
                          查看
                        </button>
                        <button
                          onClick={() => handleOpenEdit(topic)}
                          className="btn-text text-xs"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleOpenMigrate(topic)}
                          className="btn-text text-xs text-indigo-600 dark:text-indigo-400"
                          title="AI 迁移到其他平台/账号"
                        >
                          迁移
                        </button>
                        <button
                          onClick={() => handleExport(topic)}
                          className="btn-text text-xs text-gray-500 dark:text-gray-400"
                          title="导出为 Markdown"
                        >
                          导出
                        </button>
                        {hasSimulation(topic) && (
                          <button
                            onClick={() => handleViewResult(topic)}
                            className="btn-text text-xs text-green-600 dark:text-green-400"
                          >
                            结果
                          </button>
                        )}
                        <Link
                          to={`/simulation/${topic.id}`}
                          className="btn-text text-xs text-primary-600 dark:text-primary-400"
                        >
                          模拟
                        </Link>
                        <button
                          onClick={() => handleDelete(topic.id)}
                          className="btn-text text-xs text-red-600 dark:text-red-400"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            // 列表视图 — 每行两行布局：元信息 + 标题
            <div className="card divide-y divide-gray-100 dark:divide-dark-700">
              {displayedTopics.map((topic) => {
                const platformInfo = getPlatformInfo(topic.target_platform || '')
                return (
                  <div key={topic.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-4">
                      {/* 左侧内容区 */}
                      <div className="flex-1 min-w-0">
                        {/* 第一行：平台 · 账号 · 状态 · 时间 · 互动率 */}
                        <div className="flex items-center gap-2 mb-1 text-xs flex-wrap">
                          <span className="inline-flex items-center gap-1 flex-shrink-0">
                            <PlatformIcon platformCode={topic.target_platform || ''} size={14} />
                            <span className="text-gray-500 dark:text-gray-400">{platformInfo.name}</span>
                          </span>
                          {topic.account_summary && (
                            <span className="text-blue-600 dark:text-blue-400 flex-shrink-0">
                              @{topic.account_summary.account_name}
                            </span>
                          )}
                          <span className={`${getStatusStyle(topic.status)} flex-shrink-0`}>
                            {getStatusText(topic.status)}
                          </span>
                          <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">
                            {formatTime(topic.updated_at)}
                          </span>
                          {topic.latest_metrics && (
                            <span className="text-green-600 dark:text-green-400 flex-shrink-0">
                              📈 {topic.latest_metrics.engagement_rate}%
                            </span>
                          )}
                        </div>
                        {/* 第二行：标题（最多显示两行） */}
                        <h4 className="font-medium text-sm text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug">
                          {topic.title}
                        </h4>
                      </div>
                      {/* 右侧操作按钮 */}
                      <div className="flex items-center space-x-1.5 flex-shrink-0 pt-1">
                        <button onClick={() => setSelectedTopic(topic)} className="btn-text text-xs">
                          查看
                        </button>
                        <button onClick={() => handleOpenEdit(topic)} className="btn-text text-xs">
                          编辑
                        </button>
                        <button onClick={() => handleOpenMigrate(topic)} className="btn-text text-xs text-indigo-600 dark:text-indigo-400">
                          迁移
                        </button>
                        <button onClick={() => handleExport(topic)} className="btn-text text-xs text-gray-500 dark:text-gray-400">
                          导出
                        </button>
                        {hasSimulation(topic) && (
                          <button onClick={() => handleViewResult(topic)} className="btn-text text-xs text-green-600 dark:text-green-400">
                            结果
                          </button>
                        )}
                        <Link to={`/simulation/${topic.id}`} className="btn-primary text-xs py-1 px-2.5">
                          模拟
                        </Link>
                        <button onClick={() => handleDelete(topic.id)} className="btn-text text-xs text-red-600 dark:text-red-400">
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ==================== 选题详情弹窗 ==================== */}
      <Modal
        isOpen={!!selectedTopic}
        onClose={() => setSelectedTopic(null)}
        title="选题详情"
        size="5xl"
      >
        {selectedTopic && (
          <div className="space-y-4">
            {/* 平台、账号和状态 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded"
                style={{
                  backgroundColor: `${getPlatformInfo(selectedTopic.target_platform || '').color}20`,
                  color: getPlatformInfo(selectedTopic.target_platform || '').color,
                }}
              >
                <PlatformIcon platformCode={selectedTopic.target_platform || ''} size={14} />
                {getPlatformInfo(selectedTopic.target_platform || '').name}
              </span>
              {selectedTopic.account_summary ? (
                <span className="inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                  @{selectedTopic.account_summary.account_name}
                  {selectedTopic.account_summary.main_category && (
                    <span className="text-xs opacity-70">· {selectedTopic.account_summary.main_category}</span>
                  )}
                </span>
              ) : (
                <span className="text-sm text-gray-400 dark:text-gray-500">通用模式</span>
              )}
              <span className={getStatusStyle(selectedTopic.status)}>
                {getStatusText(selectedTopic.status)}
              </span>
            </div>

            {/* 标题 */}
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {selectedTopic.title}
            </h3>

            {/* 描述 */}
            {selectedTopic.description && (
              <p className="text-gray-600 dark:text-gray-400">{selectedTopic.description}</p>
            )}

            {/* 详细内容 */}
            {selectedTopic.content && (
              <div>
                <span className="text-sm text-gray-500 dark:text-gray-400 block mb-2">详细内容</span>
                <div className="p-3 bg-gray-50 dark:bg-dark-700/50 rounded-lg text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {selectedTopic.content}
                </div>
              </div>
            )}

            {/* 元数据 */}
            {selectedTopic.metadata && (
              <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-dark-700/50 rounded-lg">
                {selectedTopic.metadata.audience && (
                  <div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">目标受众</span>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {selectedTopic.metadata.audience}
                    </p>
                  </div>
                )}
                {selectedTopic.metadata.tone && (
                  <div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">内容调性</span>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {selectedTopic.metadata.tone}
                    </p>
                  </div>
                )}
                {selectedTopic.metadata.format && (
                  <div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">内容形式</span>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {selectedTopic.metadata.format}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 标签 */}
            {selectedTopic.metadata?.tags && selectedTopic.metadata.tags.length > 0 && (
              <div>
                <span className="text-sm text-gray-500 dark:text-gray-400 block mb-2">标签</span>
                <div className="flex flex-wrap gap-2">
                  {selectedTopic.metadata.tags.map((tag) => (
                    <span key={tag} className="tag-primary">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-dark-700">
              <button onClick={() => setSelectedTopic(null)} className="btn-secondary">
                关闭
              </button>
              <button
                onClick={() => handleOpenEdit(selectedTopic)}
                className="btn-secondary"
              >
                编辑
              </button>
              <button
                onClick={() => handleOpenMigrate(selectedTopic)}
                className="btn-secondary"
              >
                AI 迁移
              </button>
              <button
                onClick={() => handleExport(selectedTopic)}
                className="btn-secondary"
              >
                📥 导出
              </button>
              {hasSimulation(selectedTopic) && (
                <button
                  onClick={() => {
                    setSelectedTopic(null)
                    handleViewResult(selectedTopic)
                  }}
                  className="btn-secondary"
                >
                  查看结果
                </button>
              )}
              <Link
                to={`/simulation/${selectedTopic.id}`}
                className="btn-primary"
                onClick={() => setSelectedTopic(null)}
              >
                运行模拟
              </Link>
            </div>
          </div>
        )}
      </Modal>

      {/* 模拟结果对话框 */}
      <SimulationResultModal
        isOpen={resultModalOpen}
        onClose={handleCloseResultModal}
        simulation={viewingSimulation}
        topic={viewingTopic}
        platform={platforms.find(p => p.code === (viewingSimulation?.platform || viewingTopic?.target_platform))}
        loading={loadingResult}
        topicId={viewingTopic?.id}
      />

      {/* ==================== 手动新增选题对话框 ==================== */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="手动新增选题"
        size="5xl"
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 平台和账号选择 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                目标平台
              </label>
              <PlatformSelect
                platforms={platforms}
                value={createForm.target_platform}
                onChange={handleCreatePlatformChange}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                关联账号
              </label>
              {!createForm.target_platform ? (
                <select className="select w-full" disabled>
                  <option>请先选择平台</option>
                </select>
              ) : loadingCreateAccounts ? (
                <div className="flex items-center gap-2 h-[38px] px-3 text-sm text-gray-400">
                  <Spinner size="sm" />
                  <span>加载账号中...</span>
                </div>
              ) : (
                <select
                  value={createAccountId}
                  onChange={(e) => setCreateAccountId(e.target.value)}
                  className="select w-full"
                >
                  <option value="">通用模式（不关联账号）</option>
                  {createAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      @{acc.account_name}
                      {acc.main_category ? ` · ${acc.main_category}` : ''}
                      {acc.followers_count ? ` · ${formatFollowers(acc.followers_count)}粉` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* 选题标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              选题标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={createForm.title}
              onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
              placeholder="输入选题标题"
              className="input"
            />
            {createErrors.title && (
              <p className="text-red-500 text-sm mt-1">{createErrors.title}</p>
            )}
          </div>

          {/* AI 一键生成按钮 */}
          <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/10 dark:to-purple-900/10 border border-violet-200 dark:border-violet-800/30 rounded-lg">
            <button
              onClick={handleAIGenerateInfo}
              disabled={generatingInfo || !createForm.title.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg
                bg-gradient-to-r from-violet-500 to-purple-500 text-white
                hover:from-violet-600 hover:to-purple-600
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all shadow-sm"
            >
              {generatingInfo ? (
                <><Spinner size="sm" /><span>AI 生成中...</span></>
              ) : (
                <><span>✨</span><span>AI 一键生成</span></>
              )}
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              基于标题{createForm.target_platform ? '和平台特征' : ''}{createAccountId ? '、账号画像及历史数据' : ''}自动生成以下所有信息（不含详细内容）
            </span>
          </div>

          {/* 选题描述 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              选题描述
            </label>
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              placeholder="简要描述选题的核心内容和卖点"
              rows={3}
              className="input"
            />
          </div>

          {/* 内容调性和形式 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                内容调性
              </label>
              <input
                type="text"
                value={createForm.tone}
                onChange={(e) => setCreateForm({ ...createForm, tone: e.target.value })}
                placeholder="如：轻松幽默、专业严肃"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                内容形式
              </label>
              <input
                type="text"
                value={createForm.format}
                onChange={(e) => setCreateForm({ ...createForm, format: e.target.value })}
                placeholder="如：图文、短视频、直播"
                className="input"
              />
            </div>
          </div>

          {/* 目标受众 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              目标受众
            </label>
            <input
              type="text"
              value={createForm.audience}
              onChange={(e) => setCreateForm({ ...createForm, audience: e.target.value })}
              placeholder="如：职场新人、宝妈群体"
              className="input"
            />
          </div>

          {/* 标签 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              标签
            </label>
            <input
              type="text"
              value={createForm.tags}
              onChange={(e) => setCreateForm({ ...createForm, tags: e.target.value })}
              placeholder="多个标签用逗号分隔，如：职场, 成长, 干货"
              className="input"
            />
            <p className="text-xs text-gray-400 mt-1">多个标签用逗号分隔</p>
          </div>

          {/* 详细内容（带 AI 生成按钮） */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                详细内容
              </label>
              <button
                onClick={handleAIGenerateDraftContent}
                disabled={generatingDraftContent || !createForm.title.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md
                  bg-gradient-to-r from-violet-500 to-purple-500 text-white
                  hover:from-violet-600 hover:to-purple-600
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all shadow-sm"
                title="基于选题信息和平台/账号画像自动生成详细内容"
              >
                {generatingDraftContent ? (
                  <><Spinner size="sm" /><span>AI 生成中...</span></>
                ) : (
                  <><span>✨</span><span>AI 生成</span></>
                )}
              </button>
            </div>
            <textarea
              value={createForm.content}
              onChange={(e) => setCreateForm({ ...createForm, content: e.target.value })}
              placeholder="选题的详细内容、大纲或脚本... 点击右上角「AI 生成」可自动生成"
              rows={8}
              className="input font-mono text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              AI 生成将基于选题信息、平台画像{createAccountId ? '和关联账号画像' : ''}自动创作内容
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-dark-700">
            <button
              onClick={() => setCreateModalOpen(false)}
              className="btn-secondary"
              disabled={creating}
            >
              取消
            </button>
            <button
              onClick={handleConfirmCreate}
              className="btn-primary"
              disabled={creating}
            >
              {creating ? <><Spinner size="sm" /> 创建中...</> : '创建选题'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ==================== 编辑选题对话框 ==================== */}
      <Modal
        isOpen={editModalOpen}
        onClose={handleCloseEdit}
        title="编辑选题"
        size="5xl"
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 平台和账号信息（只读展示） */}
          <div className="p-3 bg-gray-50 dark:bg-dark-700/50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">平台：</span>
                {editForm.target_platform ? (
                  <span
                    className="inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded font-medium"
                    style={{
                      backgroundColor: `${getPlatformInfo(editForm.target_platform).color}20`,
                      color: getPlatformInfo(editForm.target_platform).color,
                    }}
                  >
                    <PlatformIcon platformCode={editForm.target_platform} size={14} />
                    {getPlatformInfo(editForm.target_platform).name}
                  </span>
                ) : (
                  <span className="text-sm text-gray-400">未指定</span>
                )}
              </div>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">账号：</span>
                {editingTopic?.account_summary ? (
                  <span className="inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                    @{editingTopic.account_summary.account_name}
                    {editingTopic.account_summary.main_category && (
                      <span className="text-xs opacity-70">· {editingTopic.account_summary.main_category}</span>
                    )}
                    {editingTopic.account_summary.followers_count ? (
                      <span className="text-xs opacity-70">· {formatFollowers(editingTopic.account_summary.followers_count)}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-sm text-gray-400">通用模式</span>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              如需更换平台或账号，请使用「AI 迁移」功能
            </p>
          </div>

          {/* 选题标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              选题标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              placeholder="输入选题标题"
              className="input"
            />
            {editErrors.title && (
              <p className="text-red-500 text-sm mt-1">{editErrors.title}</p>
            )}
          </div>

          {/* 选题描述 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              选题描述
            </label>
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              placeholder="简要描述选题的核心内容和卖点"
              rows={3}
              className="input"
            />
          </div>

          {/* 内容调性和形式 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                内容调性
              </label>
              <input
                type="text"
                value={editForm.tone}
                onChange={(e) => setEditForm({ ...editForm, tone: e.target.value })}
                placeholder="如：轻松幽默、专业严肃"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                内容形式
              </label>
              <input
                type="text"
                value={editForm.format}
                onChange={(e) => setEditForm({ ...editForm, format: e.target.value })}
                placeholder="如：图文、短视频、直播"
                className="input"
              />
            </div>
          </div>

          {/* 目标受众 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              目标受众
            </label>
            <input
              type="text"
              value={editForm.audience}
              onChange={(e) => setEditForm({ ...editForm, audience: e.target.value })}
              placeholder="如：职场新人、宝妈群体"
              className="input"
            />
          </div>

          {/* 标签 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              标签
            </label>
            <input
              type="text"
              value={editForm.tags}
              onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
              placeholder="多个标签用逗号分隔，如：职场, 成长, 干货"
              className="input"
            />
            <p className="text-xs text-gray-400 mt-1">多个标签用逗号分隔</p>
          </div>

          {/* 详细内容（带 AI 生成按钮） */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                详细内容
              </label>
              <button
                onClick={handleGenerateContent}
                disabled={generatingContent || saving}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md
                  bg-gradient-to-r from-violet-500 to-purple-500 text-white 
                  hover:from-violet-600 hover:to-purple-600 
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all shadow-sm"
                title="基于选题信息和平台/账号画像自动生成详细内容"
              >
                {generatingContent ? (
                  <>
                    <Spinner size="sm" />
                    <span>AI 生成中...</span>
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    <span>AI 生成</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              value={editForm.content}
              onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
              placeholder="选题的详细内容、大纲或脚本... 点击右上角「AI 生成」可自动生成"
              rows={8}
              className="input font-mono text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              AI 生成将基于选题信息、平台画像{editingTopic?.account_summary ? '和关联账号画像' : ''}自动创作内容
            </p>
          </div>

          {/* 状态 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              状态
            </label>
            <select
              value={editForm.status}
              onChange={(e) => setEditForm({ ...editForm, status: e.target.value as TopicEditForm['status'] })}
              className="select w-full"
            >
              <option value="draft">📝 草稿</option>
              <option value="simulated">✅ 已模拟</option>
              <option value="archived">🗄️ 已归档</option>
            </select>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-dark-700">
            <button
              onClick={async () => {
                if (!editingTopic) return
                // 先静默保存当前编辑内容，再打开迁移弹窗
                const saved = await doSaveEdit(true)
                if (saved) {
                  showToast('success', '已自动保存')
                  handleOpenMigrate(saved)
                }
              }}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg
                border border-indigo-300 dark:border-indigo-600 
                text-indigo-600 dark:text-indigo-400
                hover:bg-indigo-50 dark:hover:bg-indigo-900/20
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors"
              title="自动保存后复制选题到其他平台/账号"
            >
              {saving ? <><Spinner size="sm" /> 保存中...</> : '🔄 AI 迁移'}
            </button>
            <div className="flex space-x-3">
              <button
                onClick={handleCloseEdit}
                className="btn-secondary"
                disabled={saving}
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                className="btn-primary"
                disabled={saving}
              >
                {saving ? <Spinner size="sm" /> : '保存'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ==================== AI 迁移弹窗 ==================== */}
      <Modal
        isOpen={migrateModalOpen}
        onClose={() => setMigrateModalOpen(false)}
        title="AI 迁移选题"
        size="lg"
      >
        {migratingTopic && (
          <div className="space-y-5">
            {/* 源选题信息 */}
            <div className="p-3 bg-gray-50 dark:bg-dark-700/50 rounded-lg">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">原始选题</p>
              <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">{migratingTopic.title}</p>
              <div className="flex items-center gap-2 text-sm">
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: `${getPlatformInfo(migratingTopic.target_platform || '').color}20`,
                    color: getPlatformInfo(migratingTopic.target_platform || '').color,
                  }}
                >
                  <PlatformIcon platformCode={migratingTopic.target_platform || ''} size={12} />
                  {getPlatformInfo(migratingTopic.target_platform || '').name}
                </span>
                {migratingTopic.account_summary ? (
                  <span className="text-blue-600 dark:text-blue-400">
                    @{migratingTopic.account_summary.account_name}
                  </span>
                ) : (
                  <span className="text-gray-400">通用模式</span>
                )}
              </div>
            </div>

            {/* 目标平台选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                目标平台 <span className="text-red-500">*</span>
              </label>
              <PlatformSelect
                platforms={platforms}
                value={migratePlatform}
                onChange={handleMigratePlatformChange}
              />
            </div>

            {/* 目标账号选择 */}
            {migratePlatform && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  目标账号
                </label>
                {loadingMigrateAccounts ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
                    <Spinner size="sm" /> 加载账号列表...
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {/* 不选择账号选项 */}
                    <label
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        migrateAccountId === ''
                          ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-gray-200 dark:border-dark-600 hover:border-gray-300 dark:hover:border-dark-500'
                      }`}
                    >
                      <input
                        type="radio"
                        name="migrate-account"
                        checked={migrateAccountId === ''}
                        onChange={() => setMigrateAccountId('')}
                        className="text-primary-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">不指定账号（通用模式）</p>
                        <p className="text-xs text-gray-400">仅适配平台风格，不针对特定账号</p>
                      </div>
                    </label>

                    {/* 账号列表 */}
                    {migrateAccounts.map((account) => (
                      <label
                        key={account.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          migrateAccountId === account.id
                            ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
                            : 'border-gray-200 dark:border-dark-600 hover:border-gray-300 dark:hover:border-dark-500'
                        }`}
                      >
                        <input
                          type="radio"
                          name="migrate-account"
                          checked={migrateAccountId === account.id}
                          onChange={() => setMigrateAccountId(account.id)}
                          className="text-primary-600"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {account.account_name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {account.main_category || '未分类'}
                            {account.followers_count ? ` · ${formatFollowers(account.followers_count)}粉丝` : ''}
                          </p>
                        </div>
                      </label>
                    ))}

                    {migrateAccounts.length === 0 && (
                      <p className="text-sm text-gray-400 dark:text-gray-500 py-2 text-center">
                        该平台暂无已配置的账号
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 迁移目标和源一致的提示 */}
            {migratePlatform && isMigrateTargetSame() && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  ⚠️ 迁移目标与当前选题的平台和账号相同，请选择不同的目标
                </p>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-dark-700">
              <button
                onClick={() => setMigrateModalOpen(false)}
                className="btn-secondary"
                disabled={migrating}
              >
                取消
              </button>
              <button
                onClick={handleConfirmMigrate}
                disabled={!migratePlatform || isMigrateTargetSame() || migrating}
                className="btn-primary"
              >
                {migrating ? (
                  <span className="flex items-center gap-2">
                    <Spinner size="sm" />
                    AI 迁移中...
                  </span>
                ) : (
                  '🔄 确认迁移'
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
