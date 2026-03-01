/**
 * 设置页面组件
 * 包含模型配置和联网搜索配置（均为真实可用功能）
 * 注意：模型类型信息、URL 示例等配置从全局 Store 获取（后端 YAML 配置文件）
 */

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  getModelConfigs,
  createModelConfig,
  updateModelConfig,
  deleteModelConfig,
  setDefaultModelConfig,
  setFastTaskModelConfig,
  testModelConfig,
  getSearchConfig,
  updateSearchConfig,
  testSearchConfig,
  deleteSearchConfig,
  type ModelConfig,
  type ModelConfigCreate,
  type SearchConfig,
} from '../services/api'
import Modal from '../components/Modal'
import { Spinner } from '../components/Loading'
import { useAppStore } from '../stores/appStore'

export default function SettingsPage() {
  const { showToast, appOptions } = useAppStore()
  
  // 从全局配置获取选项
  const MODEL_TYPE_INFO = appOptions.model_types
  const URL_EXAMPLES = appOptions.url_examples
  const [configs, setConfigs] = useState<ModelConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<ModelConfig | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  // ==================== 联网搜索配置状态 ====================
  const [searchConfig, setSearchConfig] = useState<SearchConfig | null>(null)
  const [searchApiKey, setSearchApiKey] = useState('')
  const [searchLoading, setSearchLoading] = useState(true)
  const [searchSaving, setSearchSaving] = useState(false)
  const [searchTesting, setSearchTesting] = useState(false)
  const [searchEditing, setSearchEditing] = useState(false)

  // 获取联网搜索配置
  const fetchSearchConfig = async () => {
    try {
      const data = await getSearchConfig()
      setSearchConfig(data)
    } catch (err) {
      console.error('获取联网搜索配置失败:', err)
    } finally {
      setSearchLoading(false)
    }
  }

  // 保存联网搜索配置
  const handleSearchSave = async () => {
    if (!searchApiKey.trim()) {
      showToast('error', '请输入 API Key')
      return
    }
    setSearchSaving(true)
    try {
      await updateSearchConfig(searchApiKey.trim())
      showToast('success', 'API Key 保存成功')
      setSearchApiKey('')
      setSearchEditing(false)
      fetchSearchConfig()
    } catch (err: any) {
      showToast('error', err.message || '保存失败')
    } finally {
      setSearchSaving(false)
    }
  }

  // 删除联网搜索配置
  const handleSearchDelete = async () => {
    if (!confirm('确定要删除联网搜索配置吗？删除后系统将无法使用联网搜索功能。')) return
    try {
      await deleteSearchConfig()
      showToast('success', '联网搜索配置已删除')
      setSearchApiKey('')
      setSearchEditing(false)
      fetchSearchConfig()
    } catch (err: any) {
      showToast('error', err.message || '删除失败')
    }
  }

  // 测试联网搜索配置
  const handleSearchTest = async () => {
    setSearchTesting(true)
    try {
      // 如果输入框中有 key，测试输入的 key；否则测试数据库中已保存的 key
      const result = searchApiKey.trim()
        ? await testSearchConfig(searchApiKey.trim())
        : await testSearchConfig()
      
      if (result.status === 'success') {
        showToast('success', `${result.message}${result.result_count !== undefined ? `（返回 ${result.result_count} 条结果）` : ''}`)
      } else {
        showToast('error', result.message || '测试失败')
      }
    } catch (err: any) {
      showToast('error', err.message || '测试失败')
    } finally {
      setSearchTesting(false)
    }
  }

  // 表单状态
  const [formData, setFormData] = useState<ModelConfigCreate>({
    name: '',
    model_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    model_name: '',
    is_default: false,
    is_fast_task: false,
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // 获取配置列表
  const fetchConfigs = async () => {
    try {
      const data = await getModelConfigs()
      setConfigs(data)
    } catch (err) {
      console.error('获取模型配置失败:', err)
      showToast('error', '获取模型配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfigs()
    fetchSearchConfig()
  }, [])

  // 打开添加模态框
  const handleAdd = () => {
    setEditingConfig(null)
    // 首个模型自动设为默认和快速任务模型
    const isFirst = configs.length === 0
    setFormData({
      name: '',
      model_type: 'openai',
      base_url: 'https://api.openai.com/v1',
      api_key: '',
      model_name: '',
      is_default: isFirst,
      is_fast_task: isFirst,
    })
    setFormErrors({})
    setIsModalOpen(true)
  }

  // 打开编辑模态框
  const handleEdit = (config: ModelConfig) => {
    setEditingConfig(config)
    setFormData({
      name: config.name,
      model_type: config.model_type,
      base_url: config.base_url,
      api_key: '', // 不回显 API Key
      model_name: config.model_name,
      is_default: config.is_default,
      is_fast_task: config.is_fast_task,
    })
    setFormErrors({})
    setIsModalOpen(true)
  }

  // 验证表单
  const validateForm = () => {
    const errors: Record<string, string> = {}
    
    if (!formData.name.trim()) {
      errors.name = '请输入配置名称'
    }
    if (!formData.base_url.trim()) {
      errors.base_url = '请输入 API 终结点地址'
    }
    if (!formData.api_key.trim() && !editingConfig) {
      errors.api_key = '请输入 API Key'
    }
    if (!formData.model_name.trim()) {
      errors.model_name = '请输入模型名称'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  // 保存配置
  const handleSave = async () => {
    if (!validateForm()) return

    setSaving(true)
    try {
      if (editingConfig) {
        // 更新
        const updateData: Partial<ModelConfigCreate> = {
          name: formData.name,
          model_type: formData.model_type,
          base_url: formData.base_url,
          model_name: formData.model_name,
          is_default: formData.is_default,
          is_fast_task: formData.is_fast_task,
        }
        // 如果输入了新的 API Key，则更新
        if (formData.api_key.trim()) {
          updateData.api_key = formData.api_key
        }
        await updateModelConfig(editingConfig.id, updateData)
        showToast('success', '更新成功')
      } else {
        // 创建
        await createModelConfig(formData)
        showToast('success', '创建成功')
      }
      setIsModalOpen(false)
      fetchConfigs()
    } catch (err: any) {
      showToast('error', err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 删除配置
  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个模型配置吗？')) return

    try {
      await deleteModelConfig(id)
      showToast('success', '删除成功')
      fetchConfigs()
    } catch (err: any) {
      showToast('error', err.message || '删除失败')
    }
  }

  // 设为默认
  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultModelConfig(id)
      showToast('success', '设置成功')
      fetchConfigs()
    } catch (err: any) {
      showToast('error', err.message || '设置失败')
    }
  }

  // 设为快速任务模型
  const handleSetFastTask = async (id: string) => {
    try {
      await setFastTaskModelConfig(id)
      showToast('success', '设置成功')
      fetchConfigs()
    } catch (err: any) {
      showToast('error', err.message || '设置失败')
    }
  }

  // 测试连接
  const handleTest = async (id: string) => {
    setTestingId(id)
    try {
      const result = await testModelConfig(id)
      if (result.status === 'success') {
        showToast('success', '连接测试成功')
      } else {
        showToast('error', result.message)
      }
    } catch (err: any) {
      showToast('error', err.message || '测试失败')
    } finally {
      setTestingId(null)
    }
  }

  // 获取类型信息
  const getTypeInfo = (type: string) => {
    return MODEL_TYPE_INFO[type as keyof typeof MODEL_TYPE_INFO] || MODEL_TYPE_INFO.openai
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">⚙️ 系统设置</h1>

      {/* 模型配置 - 真实功能 */}
      <div className="card mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            🤖 模型配置
          </h2>
          <button onClick={handleAdd} className="btn-primary whitespace-nowrap">
            + 添加模型
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
          配置 AI 模型服务，支持多个模型配置灵活切换
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
          <span className="inline-flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"></span><span className="text-amber-600 dark:text-amber-400 font-medium">快速任务模型</span></span>
          {' '}— 用于会话标题生成、选题完整度评估等简单任务，推荐配置轻量快速的模型
        </p>

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : configs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400 mb-2">暂未配置任何模型</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              支持 OpenAI、Claude、Azure-OpenAI 等多种模型类型
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {configs.map((config) => {
              const typeInfo = getTypeInfo(config.model_type)
              const hasHighlight = config.is_default || config.is_fast_task
              return (
                <div
                  key={config.id}
                  className={`border rounded-lg p-4 transition-colors ${
                    hasHighlight
                      ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/10'
                      : 'border-gray-200 dark:border-dark-700'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {config.name}
                        </span>
                        {!!config.is_default && (
                          <span className="text-xs bg-primary-500 text-white px-2 py-0.5 rounded">
                            默认
                          </span>
                        )}
                        {!!config.is_fast_task && (
                          <span className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded">
                            快速任务
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded ${typeInfo.bg_color} ${typeInfo.text_color}`}>
                          {typeInfo.label}
                        </span>
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {config.model_name}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">
                        {config.base_url}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTest(config.id)}
                        disabled={testingId === config.id}
                        className="btn-text text-sm"
                      >
                        {testingId === config.id ? <Spinner size="sm" /> : '测试'}
                      </button>
                      <button
                        onClick={() => handleEdit(config)}
                        className="btn-text text-sm"
                      >
                        编辑
                      </button>
                      {!config.is_default && (
                        <button
                          onClick={() => handleSetDefault(config.id)}
                          className="btn-text text-sm text-primary-600 dark:text-primary-400"
                        >
                          设为默认
                        </button>
                      )}
                      {!config.is_fast_task && (
                        <button
                          onClick={() => handleSetFastTask(config.id)}
                          className="btn-text text-sm text-amber-600 dark:text-amber-400"
                        >
                          设为快速任务
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(config.id)}
                        className="btn-text text-sm text-red-600 dark:text-red-400"
                      >
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

      {/* 联网搜索配置 - 真实功能 */}
      <div className="card mb-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center">
              🔍 联网搜索配置
              {searchConfig?.configured ? (
                <span className="ml-2 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded">
                  已配置
                </span>
              ) : (
                <span className="ml-2 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded">
                  推荐开启
                </span>
              )}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              配置 Anspire Open API Key 以启用联网搜索功能，为 AI 提供实时互联网信息
            </p>
          </div>
          <a
            href="https://open.anspire.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-text text-sm text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap"
          >
            获取 API Key →
          </a>
        </div>

        {searchLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size="lg" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* 已配置状态显示 */}
            {searchConfig?.configured && !searchEditing ? (
              <div className="border rounded-lg p-4 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        Anspire Open API
                      </span>
                      <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded">
                        已启用
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      API Key: {searchConfig.api_key_masked}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSearchTest}
                      disabled={searchTesting}
                      className="btn-text text-sm"
                    >
                      {searchTesting ? <Spinner size="sm" /> : '测试连接'}
                    </button>
                    <button
                      onClick={() => setSearchEditing(true)}
                      className="btn-text text-sm"
                    >
                      修改
                    </button>
                    <button
                      onClick={handleSearchDelete}
                      className="btn-text text-sm text-red-600 dark:text-red-400"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* 编辑/首次配置状态 */
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    API Key <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={searchApiKey}
                    onChange={(e) => setSearchApiKey(e.target.value)}
                    placeholder={searchConfig?.configured ? '输入新的 API Key（留空取消修改）' : '请输入 Anspire Open API Key（以 sk- 开头）'}
                    className="input"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchApiKey.trim()) {
                        handleSearchSave()
                      }
                    }}
                  />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    前往{' '}
                    <a
                      href="https://open.anspire.cn/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-500 hover:underline"
                    >
                      Anspire Open 开放平台
                    </a>
                    {' '}注册并获取 API Key
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSearchSave}
                    disabled={searchSaving || !searchApiKey.trim()}
                    className="btn-primary"
                  >
                    {searchSaving ? <Spinner size="sm" /> : '保存'}
                  </button>
                  <button
                    onClick={() => {
                      handleSearchTest()
                    }}
                    disabled={searchTesting || !searchApiKey.trim()}
                    className="btn-secondary"
                  >
                    {searchTesting ? <Spinner size="sm" /> : '测试连接'}
                  </button>
                  {searchEditing && (
                    <button
                      onClick={() => {
                        setSearchEditing(false)
                        setSearchApiKey('')
                      }}
                      className="btn-text text-sm"
                    >
                      取消
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 平台账号管理 - 链接到独立页面 */}
      <div className="card">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              👤 平台账号管理
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              管理各平台自媒体账号信息，获得更精准的模拟预测
            </p>
          </div>
          <Link to="/accounts" className="btn-secondary">
            前往管理 →
          </Link>
        </div>
      </div>

      {/* 添加/编辑模型配置模态框 */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingConfig ? '编辑模型配置' : '添加模型配置'}
        size="lg"
      >
        <div className="space-y-4">
          {/* 配置名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              配置名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="如：GPT-4o 主力模型"
              className="input"
            />
            {formErrors.name && (
              <p className="text-red-500 text-sm mt-1">{formErrors.name}</p>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              自定义名称，便于识别不同配置
            </p>
          </div>

          {/* 模型类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              模型类型 <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(MODEL_TYPE_INFO).map(([type, info]) => (
                <button
                  key={type}
                  onClick={() => {
                    setFormData({
                      ...formData,
                      model_type: type as ModelConfigCreate['model_type'],
                      base_url: info.default_url,
                    })
                  }}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    formData.model_type === type
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-dark-600 hover:border-gray-300 dark:hover:border-dark-500'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full ${info.color} mx-auto mb-2`} />
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {info.label}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              {getTypeInfo(formData.model_type).description}
            </p>
          </div>

          {/* API 终结点地址 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              API 终结点地址 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.base_url}
              onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="input"
            />
            {formErrors.base_url && (
              <p className="text-red-500 text-sm mt-1">{formErrors.base_url}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              {URL_EXAMPLES.map((example) => (
                <button
                  key={example.url}
                  onClick={() => setFormData({ ...formData, base_url: example.url })}
                  className="text-xs px-2 py-1 bg-gray-100 dark:bg-dark-700 rounded hover:bg-gray-200 dark:hover:bg-dark-600 transition-colors"
                >
                  {example.label}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              API Key <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={formData.api_key}
              onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
              placeholder={editingConfig ? '留空则不修改' : '请输入 API Key'}
              className="input"
            />
            {formErrors.api_key && (
              <p className="text-red-500 text-sm mt-1">{formErrors.api_key}</p>
            )}
          </div>

          {/* 模型名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              模型名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.model_name}
              onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
              placeholder="如：gpt-4o"
              className="input"
            />
            {formErrors.model_name && (
              <p className="text-red-500 text-sm mt-1">{formErrors.model_name}</p>
            )}
          </div>

          {/* 模型角色设置 */}
          <div className="space-y-3">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_default"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <label htmlFor="is_default" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                设为默认模型
              </label>
            </div>
            <div className="flex items-start">
              <input
                type="checkbox"
                id="is_fast_task"
                checked={formData.is_fast_task}
                onChange={(e) => setFormData({ ...formData, is_fast_task: e.target.checked })}
                className="w-4 h-4 mt-0.5 text-amber-500 border-gray-300 rounded focus:ring-amber-400"
              />
              <div className="ml-2">
                <label htmlFor="is_fast_task" className="text-sm text-gray-700 dark:text-gray-300">
                  设为快速任务模型
                </label>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  快速任务指会话标题生成、选题完整度评估等简单快速任务，推荐使用轻量快速的模型
                </p>
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-dark-700">
            <button
              onClick={() => setIsModalOpen(false)}
              className="btn-secondary"
              disabled={saving}
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="btn-primary"
              disabled={saving}
            >
              {saving ? <Spinner size="sm" /> : '保存'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
