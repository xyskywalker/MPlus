/**
 * API 服务模块
 * 封装所有后端 API 调用
 */

import axios from 'axios'

// 创建 axios 实例
const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// AI 类长耗时请求专用实例（超时 120 秒）
const aiApi = axios.create({
  baseURL: '/api',
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 响应拦截器（通用）
const setupInterceptors = (instance: typeof api) => {
  instance.interceptors.response.use(
    (response) => {
      const data = response.data
      if (data.code === 0) {
        return data.data
      }
      return Promise.reject(new Error(data.message || '请求失败'))
    },
    (error) => {
      console.error('API Error:', error)
      return Promise.reject(error)
    }
  )
}
setupInterceptors(api)
setupInterceptors(aiApi)

// ==================== 应用选项配置 ====================

export interface CategoryOption {
  value: string
  label: string
}

export interface ModelTypeInfo {
  label: string
  color: string
  text_color: string
  bg_color: string
  description: string
  default_url: string
}

export interface UrlExample {
  label: string
  url: string
}

export interface AppOptions {
  verification_statuses: { value: string; label: string }[]
  post_types: string[]
  category_options: (CategoryOption & { sub_suggestions?: string[] })[]
  content_styles: string[]
  model_types: Record<string, ModelTypeInfo>
  url_examples: UrlExample[]
}

export const getAppOptions = (): Promise<AppOptions> => {
  return api.get('/app-options')
}

// ==================== 系统状态 ====================

export interface SystemStatus {
  model_configured: boolean
  model_count: number
  default_model: string | null
  default_model_name: string | null
  search_configured: boolean
}

export const getSystemStatus = (): Promise<SystemStatus> => {
  return api.get('/settings/status')
}

// ==================== 模型配置 ====================

export interface ModelConfig {
  id: string
  name: string
  model_type: 'openai' | 'claude' | 'azure-openai'
  base_url: string
  model_name: string
  api_key_masked?: string
  is_default: boolean
  is_fast_task: boolean
  created_at: string
  updated_at: string
}

export interface ModelConfigCreate {
  name: string
  model_type: 'openai' | 'claude' | 'azure-openai'
  base_url: string
  api_key: string
  model_name: string
  is_default?: boolean
  is_fast_task?: boolean
}

export const getModelConfigs = (): Promise<ModelConfig[]> => {
  return api.get('/model-configs')
}

export const createModelConfig = (data: ModelConfigCreate): Promise<ModelConfig> => {
  return api.post('/model-configs', data)
}

export const updateModelConfig = (id: string, data: Partial<ModelConfigCreate>): Promise<ModelConfig> => {
  return api.put(`/model-configs/${id}`, data)
}

export const deleteModelConfig = (id: string): Promise<void> => {
  return api.delete(`/model-configs/${id}`)
}

export const setDefaultModelConfig = (id: string): Promise<void> => {
  return api.put(`/model-configs/${id}/default`)
}

export const setFastTaskModelConfig = (id: string): Promise<void> => {
  return api.put(`/model-configs/${id}/fast-task`)
}

export interface TestResult {
  status: 'success' | 'failed'
  message: string
}

export const testModelConfig = (id: string): Promise<TestResult> => {
  return api.post(`/model-configs/${id}/test`)
}

// ==================== 联网搜索配置 ====================

export interface SearchConfig {
  configured: boolean
  api_key_masked: string | null
}

export interface SearchTestResult {
  status: 'success' | 'failed'
  message: string
  result_count?: number
}

export const getSearchConfig = (): Promise<SearchConfig> => {
  return api.get('/search-config')
}

export const updateSearchConfig = (api_key: string): Promise<{ configured: boolean }> => {
  return api.put('/search-config', { api_key })
}

export const testSearchConfig = (api_key?: string): Promise<SearchTestResult> => {
  return api.post('/search-config/test', api_key ? { api_key } : undefined)
}

export const deleteSearchConfig = (): Promise<{ configured: boolean }> => {
  return api.delete('/search-config')
}

// ==================== 会话 ====================

// 账号摘要信息（会话列表中展示用，避免额外请求）
export interface AccountSummary {
  account_name: string
  main_category: string
  followers_count: number
}

export interface Session {
  id: string
  title: string
  platform_code: string | null
  model_config_id: string | null
  account_profile_id?: string | null       // 关联的账号画像 ID
  account_summary?: AccountSummary | null   // 账号摘要（服务端 JOIN 返回）
  created_at: string
  updated_at: string
  message_count?: number
  // 选题就绪度评估（持久化到数据库，页面刷新后可恢复）
  topic_readiness_level?: string | null
  topic_readiness_summary?: string | null
}

export interface SessionListResponse {
  items: Session[]
  total: number
}

export const getSessions = (limit = 20, offset = 0): Promise<SessionListResponse> => {
  return api.get('/sessions', { params: { limit, offset } })
}

export const createSession = (data: {
  title?: string
  platform_code?: string
  model_config_id?: string
  account_profile_id?: string
}): Promise<Session> => {
  return api.post('/sessions', data)
}

export const getSession = (id: string): Promise<Session> => {
  return api.get(`/sessions/${id}`)
}

export const updateSession = (id: string, data: { title?: string; platform_code?: string; model_config_id?: string }): Promise<Session> => {
  return api.put(`/sessions/${id}`, data)
}

export const deleteSession = (id: string): Promise<void> => {
  return api.delete(`/sessions/${id}`)
}

// ==================== 对话历史 ====================

export interface Conversation {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface ConversationListResponse {
  items: Conversation[]
  total: number
}

export const getConversations = (sessionId: string, limit = 50, offset = 0): Promise<ConversationListResponse> => {
  return api.get(`/sessions/${sessionId}/conversations`, { params: { limit, offset } })
}

// ==================== 选题 ====================

export interface TopicMetadata {
  audience?: string
  tone?: string
  format?: string
  tags?: string[]
}

export interface Topic {
  id: string
  session_id: string | null
  title: string
  description: string | null
  target_platform: string | null
  content: string | null
  metadata: TopicMetadata
  account_profile_id?: string | null        // 关联的账号画像 ID
  account_summary?: AccountSummary | null    // 账号摘要
  status: 'draft' | 'simulated' | 'archived'
  created_at: string
  updated_at: string
  simulation_count?: number
  latest_metrics?: {
    impressions: number
    likes: number
    comments: number
    favorites: number
    engagement_rate: number
  }
}

export interface TopicListResponse {
  items: Topic[]
  total: number
}

export const getTopics = (params?: {
  session_id?: string
  status?: string
  platform?: string
  limit?: number
  offset?: number
}): Promise<TopicListResponse> => {
  return api.get('/topics', { params })
}

export const createTopic = (data: {
  title: string
  session_id?: string
  description?: string
  target_platform?: string
  content?: string
  metadata?: TopicMetadata
  account_profile_id?: string
}): Promise<Topic> => {
  return api.post('/topics', data)
}

export const getTopic = (id: string): Promise<Topic> => {
  return api.get(`/topics/${id}`)
}

export const updateTopic = (id: string, data: Partial<Topic>): Promise<Topic> => {
  return api.put(`/topics/${id}`, data)
}

export const deleteTopic = (id: string): Promise<void> => {
  return api.delete(`/topics/${id}`)
}

// AI 生成选题详细内容（使用长超时实例）
export const generateTopicContent = (topicId: string): Promise<{ content: string }> => {
  return aiApi.post(`/topics/${topicId}/generate-content`)
}

// AI 一键生成选题信息（基于标题生成描述、受众、调性、形式、标签）
export const aiGenerateTopicInfo = (data: {
  title: string
  target_platform?: string
  account_profile_id?: string
}): Promise<{
  description: string
  audience: string
  tone: string
  format: string
  tags: string[]
}> => {
  return aiApi.post('/topics/ai-generate-info', data)
}

// AI 生成选题详细内容（不依赖已保存的选题，用于新增选题场景）
export const aiGenerateContentDraft = (data: {
  title: string
  description?: string
  target_platform?: string
  account_profile_id?: string
  metadata?: TopicMetadata
}): Promise<{ content: string }> => {
  return aiApi.post('/topics/ai-generate-content-draft', data)
}

// AI 迁移选题到目标平台/账号（使用长超时实例）
export const migrateTopic = (topicId: string, data: {
  target_platform: string
  target_account_profile_id?: string
}): Promise<Topic> => {
  return aiApi.post(`/topics/${topicId}/migrate`, data)
}

// ==================== 模拟 ====================

export interface SimulationConfig {
  user_count?: number
  duration_hours?: number
  enable_search?: boolean
  model_config_id?: string
  engine?: string
  max_waves?: number
  max_llm_calls?: number
  ensemble_runs?: number
  deliberation_rounds?: number
  simulation_hours?: number
}

/** 模拟进度阶段信息 */
export interface SimulationStage {
  name: string
  description: string
  completed: boolean
  progress: number
}

/** 实时指标（Ripple 模式） */
export interface LiveMetrics {
  current_phase: string
  current_wave: number
  total_waves: number
  agents_activated: number
  [key: string]: string | number
}

/** 活动日志 */
export interface ActivityLog {
  time: string
  content: string
}

/** 模拟实时进度数据（轮询接口返回） */
export interface SimulationProgress {
  simulation_id: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  progress: number
  current_stage: {
    index: number
    name: string
    description: string
  }
  time: {
    started_at: string
    elapsed_seconds: number
  }
  live_metrics: LiveMetrics
  stages: SimulationStage[]
  recent_activities: ActivityLog[]
  error_message: string | null
  engine?: string
}

/** Ripple 预测结果 */
export interface RipplePrediction {
  impact?: string
  verdict?: string
  estimate?: Record<string, unknown>
  confidence?: string
  confidence_reasoning?: string
  simulation_horizon?: string
}

/** Ripple 智能体洞察 */
export interface AgentInsight {
  role?: string
  description?: string
  key_insight?: string
  best_strategy?: string
  [key: string]: unknown
}

/** 合议庭评分 */
export interface TribunalScores {
  role_scores?: Record<string, Record<string, number>>
  dimension_averages?: Record<string, number>
  overall_average?: number
  converged?: boolean
  consensus_points?: string[]
  dissent_points?: string[]
}

/** 可下载文件信息 */
export interface SimulationFile {
  name: string
  path: string
  type: 'json' | 'md' | 'report'
  label: string
  size: number
  size_display: string
}

/** Ripple 引擎结果 */
export interface RippleResults {
  engine?: 'ripple'
  prediction?: RipplePrediction
  timeline?: Array<Record<string, unknown>>
  bifurcation_points?: Array<Record<string, unknown>>
  agent_insights?: Record<string, AgentInsight | AgentInsight[]>
  observation?: Record<string, unknown>
  deliberation?: Record<string, unknown>
  ensemble_stats?: Record<string, unknown>
  meta?: {
    total_waves?: number
    run_id?: string
    wave_records_count?: number
    disclaimer?: string
    engine?: string
    engine_version?: string
  }
  output_file?: string
  compact_log_file?: string
  report_markdown?: string | null
  key_metrics?: {
    agent_count?: { stars?: number; seas?: number; star_names?: string[]; sea_names?: string[] }
    dynamic_parameters?: Record<string, unknown>
    estimated_waves?: number
    seed_energy?: number
    tribunal_scores?: TribunalScores
    agent_peak_energies?: Record<string, number>
    actual_waves?: number
    termination_reason?: string
  }
}

/** Mock 引擎结果（向后兼容） */
export interface MockResults {
  engine?: 'mock'
  metrics: {
    impressions: number
    likes: number
    comments: number
    favorites: number
    engagement_rate: number
    shares?: number
  }
  relative_performance?: {
    platform_avg_engagement: number
    percentile: number
    category_rank: string
  }
  viral_probability?: {
    level2_pool: number
    level3_pool: number
    viral: number
  }
  timeline?: Array<{ hour: number; impressions: number; likes: number }>
  suggestions?: Array<{ type: string; title: string; content: string }>
}

export interface Simulation {
  id: string
  topic_id: string
  platform: string
  model_config_id: string | null
  model_display_name?: string | null
  config: SimulationConfig
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  error_message?: string | null
  results?: RippleResults | MockResults
  progress_detail?: SimulationProgress
  created_at: string
  completed_at?: string
  cancelled_at?: string
}

/** 启动模拟 */
export const createSimulation = (data: {
  topic_id: string
  platform: string
  model_config_id?: string
  config?: SimulationConfig
}): Promise<Simulation> => {
  return api.post('/simulations', data)
}

/** 获取模拟详情 */
export const getSimulation = (id: string): Promise<Simulation> => {
  return api.get(`/simulations/${id}`)
}

/** 获取选题的模拟历史（轻量列表，不含 results） */
export const getTopicSimulations = (topicId: string, limit = 20): Promise<{ items: Simulation[]; total: number }> => {
  return api.get(`/topics/${topicId}/simulations`, { params: { limit, include_results: false } })
}

/** 获取选题的模拟历史（含完整 results） */
export const getTopicSimulationsWithResults = (topicId: string, limit = 1): Promise<{ items: Simulation[]; total: number }> => {
  return api.get(`/topics/${topicId}/simulations`, { params: { limit, include_results: true } })
}

/** 删除模拟记录 */
export const deleteSimulation = (simulationId: string): Promise<void> => {
  return api.delete(`/simulations/${simulationId}`)
}

/** 获取当前运行中的模拟状态和进度（轮询接口） */
export const getRunningSimulation = (): Promise<SimulationProgress | null> => {
  return api.get('/simulations/running')
}

/** 取消模拟 */
export const cancelSimulation = (simulationId: string): Promise<{ simulation_id: string; status: string }> => {
  return api.post(`/simulations/${simulationId}/cancel`)
}

/** 获取模拟进度详情 */
export const getSimulationProgress = (simulationId: string): Promise<SimulationProgress> => {
  return api.get(`/simulations/${simulationId}/progress`)
}

/** 获取模拟可下载文件列表 */
export const getSimulationFiles = (simulationId: string): Promise<{ items: SimulationFile[]; total: number }> => {
  return api.get(`/simulations/${simulationId}/files`)
}

/** 获取模拟文件下载 URL */
export const getSimulationDownloadUrl = (simulationId: string, fileType: string): string => {
  return `/api/simulations/${simulationId}/download/${fileType}`
}

// ==================== 平台 ====================

export interface Platform {
  code: string
  name: string
  icon: string
  color: string
  type: string
  description: string
  content_forms?: string[]
  user_profile?: {
    age_distribution: Array<{ range: string; percentage: number }>
    gender_ratio: { female: number; male: number }
    city_distribution: { tier1: number; tier2: number; other: number }
  }
  algorithm?: Record<string, unknown>
  peak_hours?: string[]
  interests?: Array<{ name: string; percentage: number }>
}

export const getPlatforms = (): Promise<Platform[]> => {
  return api.get('/platforms')
}

export const getPlatform = (code: string): Promise<Platform> => {
  return api.get(`/platforms/${code}`)
}

// ==================== 账号配置 ====================

/** 历史内容表现 */
export interface PostPerformance {
  id: string
  account_profile_id: string
  title: string
  content?: string                         // 内容原文或简介
  post_type: string
  tags?: string[]
  is_top: boolean
  post_url?: string
  publish_time?: string
  metrics_captured_at?: string
  views: number
  likes: number
  comments: number
  favorites: number
  shares: number
  engagement_rate: number
  extra_metrics?: Record<string, unknown>
  created_at?: string
}

/** 账号配置 */
export interface AccountProfile {
  id: string
  platform_code: string
  account_name: string
  account_id?: string
  bio?: string
  main_category: string
  sub_categories?: string[]
  content_style?: string
  target_audience?: string
  followers_count: number
  posts_count: number
  verification_status: string
  started_at?: string
  stats_updated_at?: string
  extra_metrics?: Record<string, unknown>
  created_at: string
  updated_at: string
  post_performances?: PostPerformance[]
}

/** 创建/更新历史内容请求 */
export interface PostPerformanceCreate {
  title: string
  content?: string                         // 内容原文或简介
  post_type?: string
  tags?: string[]
  is_top?: boolean
  post_url?: string
  publish_time?: string
  metrics_captured_at?: string
  views?: number
  likes?: number
  comments?: number
  favorites?: number
  shares?: number
  extra_metrics?: Record<string, unknown>
}

/** AI 分析账号定位请求 */
export interface AccountAnalyzeRequest {
  platform_code: string
  account_name: string
  bio: string
}

/** AI 分析账号定位响应 */
export interface AccountAnalyzeResult {
  main_category: string
  sub_categories: string[]
  content_style: string
  target_audience: string
}

// 账号管理 API
export const getAccounts = (platform_code?: string): Promise<{ items: AccountProfile[]; total: number }> => {
  return api.get('/accounts', { params: { platform_code } })
}

export const getAccount = (id: string): Promise<AccountProfile> => {
  return api.get(`/accounts/${id}`)
}

export const createAccount = (data: Partial<AccountProfile>): Promise<AccountProfile> => {
  return api.post('/accounts', data)
}

export const updateAccount = (id: string, data: Partial<AccountProfile>): Promise<AccountProfile> => {
  return api.put(`/accounts/${id}`, data)
}

export const deleteAccount = (id: string): Promise<void> => {
  return api.delete(`/accounts/${id}`)
}

/** AI 智能分析账号定位 */
export const analyzeAccount = (data: AccountAnalyzeRequest): Promise<AccountAnalyzeResult> => {
  return api.post('/accounts/analyze', data)
}

// 历史内容管理 API
export const addPostPerformance = (accountId: string, data: PostPerformanceCreate): Promise<PostPerformance> => {
  return api.post(`/accounts/${accountId}/posts`, data)
}

export const updatePostPerformance = (postId: string, data: PostPerformanceCreate): Promise<PostPerformance> => {
  return api.put(`/accounts/posts/${postId}`, data)
}

export const deletePostPerformance = (postId: string): Promise<void> => {
  return api.delete(`/accounts/posts/${postId}`)
}

export default api
