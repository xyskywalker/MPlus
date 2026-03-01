/**
 * 模拟预测页面组件
 * 核心功能：
 * 1. 同一时刻只允许一个模拟运行
 * 2. 模拟由后端服务独立运行，关闭浏览器不终止
 * 3. 实时展示模拟进度、动态指标、用户行为日志
 * 4. 支持随时查看进度和取消模拟
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  getTopic,
  getTopics,
  getPlatforms,
  createSimulation,
  getTopicSimulations,
  getRunningSimulation,
  cancelSimulation,
  getSimulation,
  deleteSimulation,
  type Topic,
  type Platform,
  type Simulation,
  type SimulationProgress,
} from '../services/api'
import { PageLoading, Spinner } from '../components/Loading'
import PlatformSelect from '../components/PlatformSelect'
import ModelSelect from '../components/ModelSelect'
import SimulationResultModal from '../components/SimulationResultModal'
import { PlatformIcon } from '../components/PlatformIcons'
import { useAppStore } from '../stores/appStore'

// 轮询间隔（毫秒）
const POLL_INTERVAL = 3000

/** 格式化秒数为时:分:秒 */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 格式化数字为简写形式 */
function formatNumber(num: number): string {
  if (num >= 10000) return `${(num / 10000).toFixed(1)}w`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return String(num)
}

export default function SimulationPage() {
  const { topicId } = useParams()
  const navigate = useNavigate()
  const { showToast } = useAppStore()

  // ===== 基础状态 =====
  const [topic, setTopic] = useState<Topic | null>(null)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [loading, setLoading] = useState(true)

  // ===== 模拟运行状态 =====
  const [simulationProgress, setSimulationProgress] = useState<SimulationProgress | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  // ===== 确认对话框状态 =====
  const [showStartConfirm, setShowStartConfirm] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  // ===== 选题选择状态 =====
  const [showTopicSelector, setShowTopicSelector] = useState(false)
  const [availableTopics, setAvailableTopics] = useState<Topic[]>([])
  const [loadingTopics, setLoadingTopics] = useState(false)

  // ===== 历史模拟记录 =====
  const [simulationHistory, setSimulationHistory] = useState<Simulation[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ===== 结果对话框 =====
  const [resultModalOpen, setResultModalOpen] = useState(false)
  const [currentSimulation, setCurrentSimulation] = useState<Simulation | null>(null)
  const [loadingSimDetail, setLoadingSimDetail] = useState(false)

  // ===== 模拟配置 =====
  const [selectedPlatform, setSelectedPlatform] = useState('xiaohongshu')
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [durationHours, setDurationHours] = useState(48)

  // 轮询定时器引用
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 活动日志容器引用（自动滚动）
  const activityLogRef = useRef<HTMLDivElement>(null)

  // ===== 工具函数 =====
  const getPlatformInfo = (code: string) => {
    return platforms.find((p) => p.code === code) || { name: '未知', icon: '📱', color: '#6366F1' }
  }

  // 是否正在模拟中（包含 running 状态）
  const isSimulationRunning = simulationProgress?.status === 'running'

  // 加载选题的历史模拟记录（轻量列表）
  const loadSimulationHistory = useCallback(async (tid: string) => {
    setLoadingHistory(true)
    try {
      const result = await getTopicSimulations(tid, 20)
      setSimulationHistory(result.items || [])
    } catch {
      setSimulationHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  // ===== 轮询逻辑 =====
  const pollProgress = useCallback(async () => {
    try {
      const data = await getRunningSimulation()
      if (data) {
        setSimulationProgress(data)

        // 模拟完成时停止轮询
        if (data.status === 'completed') {
          stopPolling()
          // 获取完整的模拟结果
          try {
            const simulation = await getSimulation(data.simulation_id)
            setCurrentSimulation(simulation)
            setResultModalOpen(true)
            showToast('success', '模拟完成！预测报告已生成')
          } catch {
            showToast('success', '模拟完成')
          }
          // 刷新历史列表
          if (topic?.id) loadSimulationHistory(topic.id)
        } else if (data.status === 'cancelled') {
          stopPolling()
          showToast('info', '模拟已取消')
          // 延迟清除进度状态
          setTimeout(() => setSimulationProgress(null), 2000)
        } else if (data.status === 'failed') {
          stopPolling()
          showToast('error', `模拟失败: ${data.error_message || '未知错误'}`)
          setTimeout(() => setSimulationProgress(null), 3000)
        }
      } else {
        // 没有运行中的模拟
        if (simulationProgress?.status === 'running') {
          // 之前还在运行，说明可能已完成或异常退出
          setSimulationProgress(null)
        }
      }
    } catch (err) {
      console.error('轮询模拟进度失败:', err)
    }
  }, [simulationProgress?.status, showToast, topic?.id, loadSimulationHistory])

  const startPolling = useCallback(() => {
    stopPolling()
    pollTimerRef.current = setInterval(pollProgress, POLL_INTERVAL)
    // 立即执行一次
    pollProgress()
  }, [pollProgress])

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => stopPolling()
  }, [])

  // ===== 初始化：检查是否有运行中的模拟 =====
  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        // 并行加载平台列表和检查运行中的模拟
        const [platformsData, runningData] = await Promise.all([
          getPlatforms(),
          getRunningSimulation(),
        ])
        setPlatforms(platformsData)

        if (runningData && runningData.status === 'running') {
          // 有运行中的模拟，显示进度界面
          setSimulationProgress(runningData)
          startPolling()
        }
      } catch (err) {
        console.error('初始化失败:', err)
      }
      setLoading(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ===== 加载选题数据 =====
  useEffect(() => {
    if (!topicId) {
      setTopic(null)
      setSimulationHistory([])
      return
    }

    const fetchTopic = async () => {
      try {
        const topicData = await getTopic(topicId)
        setTopic(topicData)
        if (topicData.target_platform) {
          setSelectedPlatform(topicData.target_platform)
        }
        // 始终加载模拟历史（不依赖 topic.status）
        loadSimulationHistory(topicId)
      } catch (err) {
        console.error('获取选题失败:', err)
        showToast('error', '获取选题失败')
        setTopic(null)
      }
    }
    fetchTopic()
  }, [topicId, showToast, loadSimulationHistory])

  // ===== 活动日志自动滚动到底部 =====
  useEffect(() => {
    if (activityLogRef.current) {
      activityLogRef.current.scrollTop = activityLogRef.current.scrollHeight
    }
  }, [simulationProgress?.recent_activities])

  // ===== 操作函数 =====

  // 加载可选择的选题列表
  const loadAvailableTopics = async () => {
    setLoadingTopics(true)
    try {
      const result = await getTopics({ limit: 50 })
      setAvailableTopics(result.items)
    } catch {
      showToast('error', '获取选题列表失败')
    } finally {
      setLoadingTopics(false)
    }
  }

  const handleOpenTopicSelector = () => {
    setShowTopicSelector(true)
    loadAvailableTopics()
  }

  const handleSelectTopic = async (selectedTopic: Topic) => {
    setShowTopicSelector(false)
    // 同步更新 URL，用 replace 避免产生多余的历史记录
    navigate(`/simulation/${selectedTopic.id}`, { replace: true })
  }

  // 点击启动模拟 → 弹出确认对话框
  const handleRunSimulation = () => {
    if (!topic) return
    if (isSimulationRunning) {
      showToast('warning', '已有模拟正在运行中')
      return
    }
    setShowStartConfirm(true)
  }

  // 确认启动模拟
  const handleConfirmStart = async () => {
    if (!topic) return
    setShowStartConfirm(false)

    setIsStarting(true)
    try {
      await createSimulation({
        topic_id: topic.id,
        platform: selectedPlatform,
        model_config_id: selectedModelId || undefined,
        config: {
          duration_hours: durationHours,
        },
      })

      showToast('success', '模拟任务已启动')
      // 开始轮询进度
      startPolling()
    } catch (err: any) {
      if (err?.response?.status === 409) {
        showToast('warning', '已有模拟任务正在运行，请等待完成或取消')
        // 有运行中的模拟，开始轮询
        startPolling()
      } else {
        showToast('error', '启动模拟失败')
      }
    } finally {
      setIsStarting(false)
    }
  }

  // 点击终止模拟 → 弹出确认对话框
  const handleCancelSimulation = () => {
    if (!simulationProgress?.simulation_id) return
    setShowCancelConfirm(true)
  }

  // 确认终止模拟
  const handleConfirmCancel = async () => {
    if (!simulationProgress?.simulation_id) return
    setShowCancelConfirm(false)

    setIsCancelling(true)
    try {
      await cancelSimulation(simulationProgress.simulation_id)
      showToast('info', '模拟已终止')
    } catch {
      showToast('error', '终止模拟失败')
    } finally {
      setIsCancelling(false)
    }
  }

  // 查看历史模拟结果（先获取完整详情再打开弹窗）
  const handleViewHistoryResult = async (sim: Simulation) => {
    setLoadingSimDetail(true)
    try {
      const fullSim = await getSimulation(sim.id)
      setCurrentSimulation(fullSim)
      setResultModalOpen(true)
    } catch {
      showToast('error', '获取模拟结果失败')
    } finally {
      setLoadingSimDetail(false)
    }
  }

  // 删除历史模拟记录
  const handleDeleteHistory = async (simId: string) => {
    if (!confirm('确定要删除这条模拟记录吗？删除后不可恢复。')) return
    setDeletingId(simId)
    try {
      await deleteSimulation(simId)
      setSimulationHistory(prev => prev.filter(s => s.id !== simId))
      showToast('success', '已删除模拟记录')
    } catch {
      showToast('error', '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const handleCloseResultModal = () => {
    setResultModalOpen(false)
  }

  if (loading) {
    return <PageLoading text="加载中..." />
  }

  // ===== 渲染：模拟运行中的进度界面 =====
  const renderProgressView = () => {
    if (!simulationProgress) return null
    const { progress, current_stage, time, live_metrics, stages, recent_activities, status } = simulationProgress

    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        {/* 状态头部 */}
        <div className="card overflow-hidden">
          {/* 顶部渐变条 */}
          <div className="h-1.5 bg-gray-200 dark:bg-dark-600 -mx-6 -mt-6 mb-6">
            <div
              className="h-full bg-gradient-to-r from-primary-500 via-purple-500 to-pink-500 transition-all duration-1000 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              {status === 'running' ? (
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                    <div className="w-5 h-5 rounded-full bg-primary-500 animate-pulse" />
                  </div>
                  <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-dark-800" />
                </div>
              ) : status === 'completed' ? (
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-xl">
                  ✅
                </div>
              ) : status === 'cancelled' ? (
                <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-xl">
                  ⏹️
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-xl">
                  ❌
                </div>
              )}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {status === 'running' ? '模拟进行中...' :
                   status === 'completed' ? '模拟已完成' :
                   status === 'cancelled' ? '模拟已取消' :
                   '模拟失败'}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {current_stage.name} - {current_stage.description}
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-primary-600 dark:text-primary-400">
                {progress.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* 时间信息 */}
          <div className="mb-4">
            <div className="p-3 bg-gray-50 dark:bg-dark-700/50 rounded-lg inline-flex items-center space-x-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">已运行</span>
              <span className="text-lg font-mono font-semibold text-gray-900 dark:text-gray-100">
                {formatDuration(time.elapsed_seconds)}
              </span>
            </div>
          </div>

          {/* 取消按钮 */}
          {status === 'running' && (
            <div className="flex justify-end">
              <button
                onClick={handleCancelSimulation}
                disabled={isCancelling}
                className="btn-secondary text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                {isCancelling ? (
                  <><Spinner size="sm" /> 取消中...</>
                ) : (
                  '⏹ 终止模拟'
                )}
              </button>
            </div>
          )}
        </div>

        {/* 实时指标面板 */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">
            📊 实时状态
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: '当前阶段', value: live_metrics.current_phase || '-', icon: '🔄', isText: true },
              { label: '当前 Wave', value: live_metrics.total_waves ? `${live_metrics.current_wave}/${live_metrics.total_waves}` : `${live_metrics.current_wave || '-'}`, icon: '🌊', isText: true },
              { label: '已激活 Agent', value: live_metrics.agents_activated || 0, icon: '🤖', isText: false },
              { label: '已运行', value: formatDuration(time.elapsed_seconds), icon: '⏱', isText: true },
            ].map((metric) => (
              <div
                key={metric.label}
                className="p-3 bg-gray-50 dark:bg-dark-700/50 rounded-lg text-center transition-all duration-500"
              >
                <div className="text-lg mb-1">{metric.icon}</div>
                <div className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                  {metric.isText ? metric.value : formatNumber(metric.value as number)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{metric.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 阶段进度 */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">
            🔄 模拟阶段
          </h3>
          <div className="space-y-2">
            {stages.map((stage, idx) => (
              <div
                key={stage.name}
                className={`flex items-center space-x-3 p-2.5 rounded-lg transition-all duration-300 ${
                  idx === current_stage.index && status === 'running'
                    ? 'bg-primary-50 dark:bg-primary-900/20 ring-1 ring-primary-200 dark:ring-primary-800'
                    : stage.completed
                    ? 'bg-gray-50 dark:bg-dark-700/30'
                    : ''
                }`}
              >
                {/* 阶段状态图标 */}
                <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
                  {stage.completed ? (
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : idx === current_stage.index && status === 'running' ? (
                    <div className="w-6 h-6 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                  ) : (
                    <div className="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-dark-600" />
                  )}
                </div>

                {/* 阶段信息 */}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${
                    stage.completed
                      ? 'text-gray-500 dark:text-gray-400'
                      : idx === current_stage.index
                      ? 'text-primary-700 dark:text-primary-300'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}>
                    {stage.name}
                  </div>
                  {idx === current_stage.index && status === 'running' && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {stage.description}
                    </div>
                  )}
                </div>

                {/* 阶段内进度 */}
                {idx === current_stage.index && status === 'running' && (
                  <div className="text-xs font-mono text-primary-600 dark:text-primary-400">
                    {stage.progress}%
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 实时活动日志 */}
        {recent_activities.length > 0 && (
          <div className="card">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">
              📝 实时活动日志
            </h3>
            <div
              ref={activityLogRef}
              className="max-h-48 overflow-y-auto space-y-1.5 scroll-smooth"
            >
              {recent_activities.map((activity, idx) => (
                <div
                  key={idx}
                  className={`flex items-start space-x-2 text-sm py-1 px-2 rounded ${
                    idx === recent_activities.length - 1
                      ? 'bg-primary-50 dark:bg-primary-900/10'
                      : ''
                  }`}
                >
                  <span className="text-xs text-gray-400 dark:text-gray-500 font-mono flex-shrink-0 mt-0.5">
                    {activity.time}
                  </span>
                  <span className="text-gray-600 dark:text-gray-400">
                    {activity.content}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ===== 渲染：配置界面（无运行中的模拟时） =====
  const renderConfigView = () => (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 选题信息 / 选题选择 */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">选题信息</h2>
          <button onClick={handleOpenTopicSelector} className="btn-text text-sm">
            {topic ? '更换选题' : '选择选题'}
          </button>
        </div>

        {topic ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded"
                style={{
                  backgroundColor: `${getPlatformInfo(topic.target_platform || '').color}20`,
                  color: getPlatformInfo(topic.target_platform || '').color,
                }}
              >
                <PlatformIcon platformCode={topic.target_platform || ''} size={14} />
                {getPlatformInfo(topic.target_platform || '').name}
              </span>
              {(topic.status === 'simulated' || simulationHistory.length > 0) && (
                <span className="tag-success">已模拟 ({simulationHistory.length})</span>
              )}
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              {topic.title}
            </h3>
            {topic.description && (
              <p className="text-sm text-gray-500 dark:text-gray-400">{topic.description}</p>
            )}
            {topic.metadata?.tags && (
              <div className="flex flex-wrap gap-2">
                {topic.metadata.tags.map((tag) => (
                  <span key={tag} className="tag-gray">{tag}</span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 bg-gray-50 dark:bg-dark-700/50 rounded-lg">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              请先选择一个选题进行模拟预测
            </p>
            <button onClick={handleOpenTopicSelector} className="btn-primary">
              选择选题
            </button>
          </div>
        )}
      </div>

      {/* 历史模拟记录 */}
      {topic && (loadingHistory || simulationHistory.length > 0) && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">
              历史模拟记录
              {simulationHistory.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-400">
                  共 {simulationHistory.length} 次
                </span>
              )}
            </h2>
          </div>

          {loadingHistory ? (
            <div className="flex justify-center py-6"><Spinner size="md" /></div>
          ) : (
            <div className="space-y-2">
              {simulationHistory.map((sim) => {
                const isCompleted = sim.status === 'completed'
                const isFailed = sim.status === 'failed'
                const isRunning = sim.status === 'running'
                const statusLabel = isCompleted ? '已完成' : isFailed ? '失败' : isRunning ? '运行中' : sim.status === 'cancelled' ? '已取消' : sim.status
                const statusColor = isCompleted
                  ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                  : isFailed
                  ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                  : isRunning
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50'

                return (
                  <div
                    key={sim.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-dark-700 hover:bg-gray-50 dark:hover:bg-dark-700/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded ${statusColor}`}>
                        {isRunning && <span className="w-1.5 h-1.5 mr-1 rounded-full bg-blue-500 animate-pulse" />}
                        {statusLabel}
                      </span>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        <span className="font-mono">
                          {new Date(sim.created_at).toLocaleString('zh-CN', {
                            month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                        {sim.completed_at && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
                            耗时 {formatDuration(
                              (new Date(sim.completed_at).getTime() - new Date(sim.created_at).getTime()) / 1000
                            )}
                          </span>
                        )}
                      </div>
                      {sim.platform && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          <PlatformIcon platformCode={sim.platform} size={12} />
                        </span>
                      )}
                      {sim.model_display_name && (
                        <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-dark-600 text-gray-500 dark:text-gray-400 font-mono">
                          {sim.model_display_name}
                        </span>
                      )}
                      {isFailed && sim.error_message && (
                        <span className="text-xs text-red-500 truncate max-w-48" title={sim.error_message}>
                          {sim.error_message}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isCompleted && (
                        <button
                          onClick={() => handleViewHistoryResult(sim)}
                          disabled={loadingSimDetail}
                          className="btn-text text-xs text-primary-600 dark:text-primary-400"
                        >
                          {loadingSimDetail ? <Spinner size="sm" /> : '查看结果'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteHistory(sim.id)}
                        disabled={deletingId === sim.id || isRunning}
                        className="btn-text text-xs text-red-500 dark:text-red-400 disabled:opacity-40"
                        title={isRunning ? '运行中的模拟无法删除' : '删除此记录'}
                      >
                        {deletingId === sim.id ? <Spinner size="sm" /> : '删除'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 模拟配置 */}
      {topic && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">模拟配置</h2>

          {/* 目标平台 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              目标平台
            </label>
            <PlatformSelect
              platforms={platforms}
              value={selectedPlatform}
              onChange={setSelectedPlatform}
              disabled={!!topic?.target_platform}
            />
            {topic?.target_platform && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                平台由选题决定，如需更改请编辑选题
              </p>
            )}
          </div>

          {/* AI 模型选择 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              AI 模型
            </label>
            <ModelSelect
              value={selectedModelId}
              onChange={setSelectedModelId}
              size="md"
              className="w-full"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              选择用于驱动模拟智能体的 LLM 模型
            </p>
          </div>

          {/* 模拟时长 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              模拟时间跨度
            </label>
            <select
              value={durationHours}
              onChange={(e) => setDurationHours(Number(e.target.value))}
              className="select w-full"
            >
              <option value={24}>24 小时</option>
              <option value={48}>48 小时 (推荐)</option>
              <option value={72}>72 小时</option>
            </select>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Ripple 引擎将按此时间跨度模拟内容传播过程
            </p>
          </div>

          {/* 提示信息 */}
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg mb-6">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              💡 模拟由 <strong>Ripple CAS 引擎</strong>驱动，通常需要 <strong>30 分钟以上</strong>完成模拟 + 1～3 分钟生成解读报告。
              模拟期间可随时关闭页面，回来后可继续查看进度。
            </p>
          </div>

          {/* 开始模拟按钮 */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-dark-700">
            <Link to="/topics" className="btn-secondary">
              取消
            </Link>
            <button
              onClick={handleRunSimulation}
              disabled={isStarting || !topic}
              className="btn-primary px-8"
            >
              {isStarting ? (
                <><Spinner size="sm" /> 启动中...</>
              ) : simulationHistory.length > 0 ? (
                '再次模拟'
              ) : (
                '开始模拟'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="animate-fade-in">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <Link
            to="/topics"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ← 返回
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">📊 模拟预测</h1>
          {isSimulationRunning && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
              <span className="w-1.5 h-1.5 mr-1.5 rounded-full bg-green-500 animate-pulse" />
              运行中
            </span>
          )}
        </div>
      </div>

      {/* 根据状态切换视图 */}
      {simulationProgress && simulationProgress.status === 'running'
        ? renderProgressView()
        : renderConfigView()
      }

      {/* 选题选择对话框 */}
      {showTopicSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
          <div className="w-full max-w-2xl bg-white dark:bg-dark-800 rounded-xl shadow-xl animate-slide-up max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-dark-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">选择选题</h3>
              <button
                onClick={() => setShowTopicSelector(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {loadingTopics ? (
                <div className="flex justify-center py-12">
                  <Spinner size="lg" />
                </div>
              ) : availableTopics.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 dark:text-gray-400 mb-4">暂无可用选题</p>
                  <Link to="/brainstorm" className="btn-primary">
                    去创建选题
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {availableTopics.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTopic(t)}
                      className={`w-full text-left p-4 border rounded-lg transition-colors hover:border-primary-500 ${
                        topic?.id === t.id
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-gray-200 dark:border-dark-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className="inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded"
                          style={{
                            backgroundColor: `${getPlatformInfo(t.target_platform || '').color}20`,
                            color: getPlatformInfo(t.target_platform || '').color,
                          }}
                        >
                          <PlatformIcon platformCode={t.target_platform || ''} size={14} />
                          {getPlatformInfo(t.target_platform || '').name}
                        </span>
                        {(t.status === 'simulated' || (t.simulation_count != null && t.simulation_count > 0)) && (
                          <span className="tag-success text-xs">
                            已模拟{t.simulation_count != null && t.simulation_count > 1 ? ` (${t.simulation_count})` : ''}
                          </span>
                        )}
                      </div>
                      <h4 className="font-medium text-gray-900 dark:text-gray-100 line-clamp-1">
                        {t.title}
                      </h4>
                      {t.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-1">
                          {t.description}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 dark:border-dark-700">
              <button
                onClick={() => setShowTopicSelector(false)}
                className="btn-secondary w-full"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 启动模拟确认对话框 */}
      {showStartConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
          <div className="w-full max-w-md bg-white dark:bg-dark-800 rounded-xl shadow-xl animate-slide-up">
            <div className="p-6">
              {/* 图标 */}
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-amber-100 dark:bg-amber-900/30">
                <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              {/* 标题 */}
              <h3 className="text-lg font-semibold text-center text-gray-900 dark:text-gray-100 mb-2">
                确认启动模拟
              </h3>
              {/* 警告内容 */}
              <div className="space-y-3 mb-6">
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <span className="text-amber-500 mt-0.5 flex-shrink-0">⏱</span>
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      模拟过程可能持续<strong>半小时甚至更长</strong>，期间可随时关闭页面，回来后可继续查看进度。
                    </p>
                  </div>
                </div>
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <span className="text-amber-500 mt-0.5 flex-shrink-0">💰</span>
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      模拟将<strong>消耗大量大模型 Token</strong>，请确保 API 账户余额充足，避免因余额不足导致模拟中断。
                    </p>
                  </div>
                </div>
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <span className="text-red-500 mt-0.5 flex-shrink-0">🖥</span>
                    <p className="text-sm text-red-800 dark:text-red-200">
                      模拟依赖后台服务运行，<strong>切勿关闭后台服务</strong>，否则会导致模拟任务异常中断且无法恢复。
                    </p>
                  </div>
                </div>
              </div>
              {/* 操作按钮 */}
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowStartConfirm(false)}
                  className="btn-secondary flex-1"
                >
                  再想想
                </button>
                <button
                  onClick={handleConfirmStart}
                  className="btn-primary flex-1"
                >
                  确认启动
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 终止模拟确认对话框 */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
          <div className="w-full max-w-md bg-white dark:bg-dark-800 rounded-xl shadow-xl animate-slide-up">
            <div className="p-6">
              {/* 图标 */}
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30">
                <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              {/* 标题 */}
              <h3 className="text-lg font-semibold text-center text-gray-900 dark:text-gray-100 mb-2">
                确认终止模拟
              </h3>
              {/* 警告内容 */}
              <div className="space-y-3 mb-6">
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <span className="text-red-500 mt-0.5 flex-shrink-0">🗑</span>
                    <p className="text-sm text-red-800 dark:text-red-200">
                      终止后，<strong>本次模拟的所有中间数据将被丢弃</strong>，已消耗的 Token 不会退还。
                    </p>
                  </div>
                </div>
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <span className="text-red-500 mt-0.5 flex-shrink-0">🔄</span>
                    <p className="text-sm text-red-800 dark:text-red-200">
                      如需获得预测结果，需要<strong>重新启动完整的模拟流程</strong>，无法从中断处继续。
                    </p>
                  </div>
                </div>
              </div>
              {/* 操作按钮 */}
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="btn-secondary flex-1"
                >
                  继续模拟
                </button>
                <button
                  onClick={handleConfirmCancel}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                >
                  确认终止
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 模拟结果对话框 */}
      <SimulationResultModal
        isOpen={resultModalOpen}
        onClose={handleCloseResultModal}
        simulation={currentSimulation}
        topic={topic}
        platform={platforms.find(p => p.code === (currentSimulation?.platform || topic?.target_platform))}
        onRerun={handleRunSimulation}
        topicId={topic?.id}
      />
    </div>
  )
}
