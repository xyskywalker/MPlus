/**
 * 模拟结果对话框组件
 * 支持 Ripple 引擎（6 Tab）和 Mock 引擎（简化展示）两种结果格式
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import Modal from './Modal'
import { Spinner } from './Loading'
import { PlatformIcon } from './PlatformIcons'
import type {
  Simulation,
  Topic,
  Platform,
  RippleResults,
  SimulationFile,
} from '../services/api'
import { getSimulationFiles, getSimulationDownloadUrl, getTopicSimulations, getSimulation } from '../services/api'

// 判断是否为 Ripple 引擎结果
function isRippleResult(results: unknown): results is RippleResults {
  if (!results || typeof results !== 'object') return false
  const r = results as Record<string, unknown>
  return r.engine === 'ripple' || !!r.prediction || !!r.report_markdown
}

interface SimulationResultModalProps {
  isOpen: boolean
  onClose: () => void
  simulation: Simulation | null
  topic?: Topic | null
  platform?: Platform | null
  loading?: boolean
  onRerun?: () => void
  topicId?: string | null
}

// Ripple Tab 定义
const RIPPLE_TABS = [
  { id: 'prediction', label: '传播预测' },
  { id: 'report', label: '解读报告' },
  { id: 'agents', label: '智能体洞察' },
  { id: 'tribunal', label: '合议庭评审' },
  { id: 'dynamics', label: '传播动力学' },
  { id: 'download', label: '日志下载' },
]

export default function SimulationResultModal({
  isOpen,
  onClose,
  simulation: externalSimulation,
  topic,
  platform,
  loading: externalLoading = false,
  onRerun,
  topicId: externalTopicId,
}: SimulationResultModalProps) {
  const [activeTab, setActiveTab] = useState('prediction')
  const [files, setFiles] = useState<SimulationFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)

  // 模拟记录切换相关状态
  const [historyList, setHistoryList] = useState<Simulation[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [currentSimulation, setCurrentSimulation] = useState<Simulation | null>(null)
  const [switchingSimulation, setSwitchingSimulation] = useState(false)

  // 实际使用的 simulation 和 loading
  const simulation = currentSimulation ?? externalSimulation
  const loading = externalLoading || switchingSimulation

  // 解析 topicId：优先外部传入，否则从 simulation 或 topic 中取
  const topicId = externalTopicId || simulation?.topic_id || topic?.id || null

  // 格式化持续时间
  const formatSimDuration = (sim: Simulation) => {
    if (!sim.completed_at) return ''
    const sec = (new Date(sim.completed_at).getTime() - new Date(sim.created_at).getTime()) / 1000
    if (sec <= 0) return ''
    const m = Math.floor(sec / 60)
    const s = Math.round(sec % 60)
    return m > 0 ? `${m}分${s}秒` : `${s}秒`
  }

  // 弹窗打开时加载该选题的全部模拟记录
  const loadHistory = useCallback(async (tid: string) => {
    setLoadingHistory(true)
    try {
      const res = await getTopicSimulations(tid, 50)
      const completed = (res.items || []).filter((s: Simulation) => s.status === 'completed')
      setHistoryList(completed)
    } catch {
      setHistoryList([])
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  // 切换模拟记录
  const handleSwitchSimulation = useCallback(async (simId: string) => {
    if (simId === simulation?.id) return
    setSwitchingSimulation(true)
    setFiles([])
    setActiveTab('prediction')
    try {
      const fullSim = await getSimulation(simId)
      setCurrentSimulation(fullSim)
    } catch {
      // 切换失败时保持当前
    } finally {
      setSwitchingSimulation(false)
    }
  }, [simulation?.id])

  // 切换到下载 Tab 时加载文件列表
  useEffect(() => {
    if (activeTab === 'download' && simulation?.id && files.length === 0) {
      setLoadingFiles(true)
      getSimulationFiles(simulation.id)
        .then((data) => setFiles(data.items || []))
        .catch(() => {})
        .finally(() => setLoadingFiles(false))
    }
  }, [activeTab, simulation?.id, files.length])

  // 重新打开时重置，并加载历史列表
  useEffect(() => {
    if (isOpen) {
      setActiveTab('prediction')
      setFiles([])
      setCurrentSimulation(null)
      if (topicId) {
        loadHistory(topicId)
      }
    } else {
      setHistoryList([])
    }
  }, [isOpen, topicId, loadHistory])

  if (!isOpen) return null

  const results = simulation?.results
  const ripple = isRippleResult(results) ? results : null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="📊 模拟预测结果" size="5xl">
      <div className="max-h-[80vh] overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Spinner size="lg" />
            <p className="mt-4 text-gray-500 dark:text-gray-400">正在加载模拟结果...</p>
          </div>
        ) : !simulation || !results ? (
          <div className="text-center py-20">
            <p className="text-gray-500 dark:text-gray-400">暂无模拟结果</p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* 模拟记录切换栏 */}
            {historyList.length > 1 && (
              <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-dark-700/50 rounded-lg">
                <span className="text-sm text-gray-500 dark:text-gray-400 flex-shrink-0">模拟记录</span>
                <select
                  value={simulation.id}
                  onChange={(e) => handleSwitchSimulation(e.target.value)}
                  className="select text-sm flex-1"
                  disabled={switchingSimulation}
                >
                  {historyList.map((sim, idx) => (
                    <option key={sim.id} value={sim.id}>
                      第 {historyList.length - idx} 次 · {new Date(sim.created_at).toLocaleString('zh-CN', {
                        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                      {formatSimDuration(sim) ? ` · 耗时${formatSimDuration(sim)}` : ''}
                      {sim.model_display_name ? ` · ${sim.model_display_name}` : ''}
                    </option>
                  ))}
                </select>
                {loadingHistory && <Spinner size="sm" />}
              </div>
            )}

            {/* 结果头部 */}
            <ResultHeader
              simulation={simulation}
              topic={topic}
              platform={platform}
              onRerun={onRerun ? () => { onClose(); onRerun() } : undefined}
            />

            {ripple ? (
              <>
                {/* Ripple 结果 Tab 栏 */}
                <TabBar tabs={RIPPLE_TABS} active={activeTab} onChange={setActiveTab} />

                {/* Tab 内容 */}
                <div className="min-h-[300px]">
                  {activeTab === 'prediction' && <PredictionTab result={ripple} />}
                  {activeTab === 'report' && <ReportTab result={ripple} />}
                  {activeTab === 'agents' && <AgentsTab result={ripple} />}
                  {activeTab === 'tribunal' && <TribunalTab result={ripple} />}
                  {activeTab === 'dynamics' && <DynamicsTab result={ripple} />}
                  {activeTab === 'download' && (
                    <DownloadTab
                      simulationId={simulation.id}
                      result={ripple}
                      files={files}
                      loading={loadingFiles}
                    />
                  )}
                </div>
              </>
            ) : (
              <MockResultView results={results as Record<string, unknown>} />
            )}

            {/* 底部操作 */}
            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-dark-700">
              <button className="btn-secondary" onClick={onClose}>
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ===== 通用子组件 =====

function ResultHeader({
  simulation,
  topic,
  platform,
  onRerun,
}: {
  simulation: Simulation
  topic?: Topic | null
  platform?: Platform | null
  onRerun?: () => void
}) {
  const engineLabel = isRippleResult(simulation.results) ? 'Ripple CAS' : 'Mock'

  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-dark-700/50 rounded-lg">
      <div className="flex items-center space-x-3">
        <PlatformIcon platformCode={simulation.platform} size={32} />
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            {platform?.name || simulation.platform} · {engineLabel} 引擎
          </h3>
          {topic && (
            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1">{topic.title}</p>
          )}
        </div>
      </div>
      {onRerun && (
        <button onClick={onRerun} className="btn-secondary text-sm">
          重新模拟
        </button>
      )}
    </div>
  )
}

function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="border-b border-gray-200 dark:border-dark-700">
      <div className="flex space-x-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`py-2.5 px-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              active === tab.id
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">{children}</h3>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-12">
      <p className="text-gray-400 dark:text-gray-500">{text}</p>
    </div>
  )
}

// ===== Tab 1: 传播预测 =====

function PredictionTab({ result }: { result: RippleResults }) {
  const pred = result.prediction
  const meta = result.meta
  const metrics = result.key_metrics

  if (!pred) return <EmptyState text="暂无预测数据" />

  const estimate = pred.estimate || {}
  const confidenceColor =
    pred.confidence === 'high'
      ? 'text-green-600 bg-green-50 dark:bg-green-900/20'
      : pred.confidence === 'medium'
        ? 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20'
        : 'text-red-600 bg-red-50 dark:bg-red-900/20'
  const confidenceLabel =
    pred.confidence === 'high' ? '高' : pred.confidence === 'medium' ? '中' : '低'

  return (
    <div className="space-y-6">
      {/* 核心结论 */}
      {pred.verdict && (
        <div className="p-4 bg-gradient-to-r from-primary-50 to-purple-50 dark:from-primary-900/20 dark:to-purple-900/20 rounded-lg">
          <div className="flex items-start space-x-3">
            <span className="text-2xl flex-shrink-0">🎯</span>
            <div>
              <p className="text-gray-900 dark:text-gray-100 font-medium">{pred.verdict}</p>
              {pred.impact && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  综合影响力: {pred.impact}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 置信度 */}
      <div className="flex items-center space-x-3">
        <span className="text-sm text-gray-500 dark:text-gray-400">预测置信度:</span>
        <span className={`px-2 py-0.5 rounded text-sm font-medium ${confidenceColor}`}>
          {confidenceLabel}
        </span>
        {pred.confidence_reasoning && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            — {pred.confidence_reasoning}
          </span>
        )}
      </div>

      {/* 预测指标 */}
      {Object.keys(estimate).length > 0 && (
        <div>
          <SectionTitle>预测指标</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(estimate)
              .filter(([k]) => !['confidence', 'confidence_reasoning', 'simulation_horizon'].includes(k))
              .map(([key, val]) => {
                const display = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')
                return (
                  <div
                    key={key}
                    className="p-3 bg-gray-50 dark:bg-dark-700/50 rounded-lg"
                  >
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {translateMetricKey(key)}
                    </div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {display}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* 元数据 */}
      {meta && (
        <div className="p-3 bg-gray-50 dark:bg-dark-700/50 rounded-lg text-sm text-gray-500 dark:text-gray-400 space-y-1">
          <div>
            引擎: {meta.engine} v{meta.engine_version} | 总波次: {meta.total_waves} |
            模拟时间跨度: {pred.simulation_horizon || '-'}
          </div>
          {metrics?.termination_reason && (
            <div>终止原因: {metrics.termination_reason}</div>
          )}
          {meta.disclaimer && <div className="text-xs italic mt-2">{meta.disclaimer}</div>}
        </div>
      )}
    </div>
  )
}

// ===== Tab 2: 解读报告 =====

/** 报告专用 Markdown 自定义渲染组件 */
function useReportMarkdownComponents(): Components {
  return useMemo<Components>(() => ({
    h1({ children }) {
      return (
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-50 mt-8 mb-4 first:mt-0 pb-2.5 border-b-2 border-primary-200 dark:border-primary-800">
          {children}
        </h1>
      )
    },
    h2({ children }) {
      return (
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-7 mb-3 first:mt-0 pb-1.5 border-b border-gray-200 dark:border-dark-600">
          {children}
        </h2>
      )
    },
    h3({ children }) {
      return (
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mt-5 mb-2 first:mt-0 flex items-center gap-1.5">
          <span className="inline-block w-1 h-4 rounded-full bg-primary-500 dark:bg-primary-400 flex-shrink-0" />
          {children}
        </h3>
      )
    },
    h4({ children }) {
      return (
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mt-4 mb-1.5 first:mt-0">
          {children}
        </h4>
      )
    },
    p({ children }) {
      return (
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-[1.85] mb-3 last:mb-0">
          {children}
        </p>
      )
    },
    strong({ children }) {
      return <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>
    },
    em({ children }) {
      return <em className="text-gray-600 dark:text-gray-400 not-italic font-medium">{children}</em>
    },
    ul({ children }) {
      return <ul className="list-disc list-outside pl-5 mb-3 space-y-1.5 text-sm text-gray-700 dark:text-gray-300">{children}</ul>
    },
    ol({ children }) {
      return <ol className="list-decimal list-outside pl-5 mb-3 space-y-1.5 text-sm text-gray-700 dark:text-gray-300">{children}</ol>
    },
    li({ children }) {
      return <li className="leading-[1.8] pl-0.5">{children}</li>
    },
    blockquote({ children }) {
      return (
        <blockquote className="border-l-3 border-primary-300 dark:border-primary-600 bg-primary-50/50 dark:bg-primary-900/10 pl-4 pr-3 py-2.5 my-3 rounded-r-lg text-sm text-gray-600 dark:text-gray-400 italic">
          {children}
        </blockquote>
      )
    },
    hr() {
      return <hr className="my-6 border-t border-gray-200 dark:border-dark-600" />
    },
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-600 dark:text-primary-400 underline decoration-1 underline-offset-2 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
        >
          {children}
        </a>
      )
    },
    code({ className, children, ...props }) {
      const isBlock = /language-(\w+)/.test(className || '') || (typeof children === 'string' && children.includes('\n'))
      if (isBlock) {
        return (
          <pre className="bg-gray-800 dark:bg-gray-900 rounded-lg p-4 my-3 overflow-x-auto text-sm leading-relaxed">
            <code className={className} {...props}>{children}</code>
          </pre>
        )
      }
      return (
        <code className="px-1.5 py-0.5 rounded text-[0.85em] font-mono bg-gray-100 dark:bg-dark-600 text-primary-600 dark:text-primary-400" {...props}>
          {children}
        </code>
      )
    },
    table({ children }) {
      return (
        <div className="my-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-dark-600">
          <table className="min-w-full text-sm">{children}</table>
        </div>
      )
    },
    thead({ children }) {
      return <thead className="bg-gray-50 dark:bg-dark-700">{children}</thead>
    },
    th({ children }) {
      return (
        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider border-b border-gray-200 dark:border-dark-600">
          {children}
        </th>
      )
    },
    td({ children }) {
      return (
        <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-dark-700">
          {children}
        </td>
      )
    },
  }), [])
}

function ReportTab({ result }: { result: RippleResults }) {
  if (!result.report_markdown) {
    return <EmptyState text="解读报告尚未生成" />
  }

  const components = useReportMarkdownComponents()

  return (
    <div className="px-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {result.report_markdown}
      </ReactMarkdown>
    </div>
  )
}

// ===== Tab 3: 智能体洞察 =====

interface ParsedAgent {
  id: string
  type: 'star' | 'sea'
  data: Record<string, unknown>
}

/**
 * 将 agent_insights 展平为统一列表
 * 兼容三种数据结构:
 *   1. { stars: { [id]: {...} }, seas: { [id]: {...} } }  — Ripple 引擎标准格式
 *   2. { stars: [...], seas: [...] }                      — 数组格式
 *   3. { star_xxx: {...}, sea_xxx: {...} }                — 扁平格式
 */
function flattenAgentInsights(insights: Record<string, unknown>): ParsedAgent[] {
  const list: ParsedAgent[] = []

  function pushGroup(group: unknown, type: 'star' | 'sea') {
    if (Array.isArray(group)) {
      group.forEach((item, i) => {
        const rec = item as Record<string, unknown>
        list.push({ id: String(rec.id || `${type}_${i}`), type, data: rec })
      })
    } else if (group && typeof group === 'object') {
      for (const [agentId, agentData] of Object.entries(group as Record<string, unknown>)) {
        if (agentData && typeof agentData === 'object') {
          list.push({ id: agentId, type, data: agentData as Record<string, unknown> })
        }
      }
    }
  }

  if ('stars' in insights || 'seas' in insights) {
    pushGroup(insights.stars, 'star')
    pushGroup(insights.seas, 'sea')
  } else {
    for (const [key, value] of Object.entries(insights)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const type = key.startsWith('star') ? 'star' : key.startsWith('sea') ? 'sea' : 'star'
        list.push({ id: key, type, data: value as Record<string, unknown> })
      }
    }
  }

  return list
}

function AgentsTab({ result }: { result: RippleResults }) {
  const insights = result.agent_insights
  const peaks = result.key_metrics?.agent_peak_energies
  const nameMap = useMemo(() => buildAgentNameMap(result), [result])

  if (!insights || Object.keys(insights).length === 0) {
    return <EmptyState text="暂无智能体洞察数据" />
  }

  const agentList = flattenAgentInsights(insights as Record<string, unknown>)

  if (agentList.length === 0) {
    return (
      <pre className="text-xs bg-gray-50 dark:bg-dark-700 p-4 rounded-lg overflow-auto max-h-[400px] text-gray-700 dark:text-gray-300">
        {JSON.stringify(insights, null, 2)}
      </pre>
    )
  }

  const stars = agentList.filter(a => a.type === 'star')
  const seas = agentList.filter(a => a.type === 'sea')

  return (
    <div className="space-y-6">
      {/* 星 Agent（KOL / 关键传播者） */}
      {stars.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">⭐</span>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              星 Agent（关键传播者）
            </h3>
            <span className="text-xs text-gray-400 dark:text-gray-500">{stars.length} 个</span>
          </div>
          <div className="space-y-3">
            {stars.map(agent => (
              <AgentCard key={agent.id} agent={agent} peaks={peaks} nameMap={nameMap} />
            ))}
          </div>
        </div>
      )}

      {/* 海 Agent（受众群体） */}
      {seas.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🌊</span>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              海 Agent（受众群体）
            </h3>
            <span className="text-xs text-gray-400 dark:text-gray-500">{seas.length} 个</span>
          </div>
          <div className="space-y-3">
            {seas.map(agent => (
              <AgentCard key={agent.id} agent={agent} peaks={peaks} nameMap={nameMap} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AgentCard({
  agent,
  peaks,
  nameMap,
}: {
  agent: ParsedAgent
  peaks?: Record<string, number>
  nameMap: Record<string, string>
}) {
  const d = agent.data
  const displayName = String(d.role || d.description || nameMap[agent.id] || agent.id)
  const peakEnergy = peaks?.[agent.id]
  const insightText = (d.insight ?? d.key_insight) as string | undefined
  const strategyText = (d.best_leverage ?? d.best_strategy) as string | undefined

  const borderColor = agent.type === 'star'
    ? 'border-yellow-200 dark:border-yellow-800/60'
    : 'border-blue-200 dark:border-blue-800/60'
  const bgColor = agent.type === 'star'
    ? 'bg-yellow-50/50 dark:bg-yellow-900/10'
    : 'bg-blue-50/50 dark:bg-blue-900/10'

  return (
    <div className={`p-4 rounded-lg border ${borderColor} ${bgColor}`}>
      {/* 名称与峰值能量 */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
          {displayName}
        </span>
        {peakEnergy != null && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-dark-600 text-gray-600 dark:text-gray-300">
            峰值能量 {peakEnergy}
          </span>
        )}
      </div>

      {/* 关键洞察 — 兼容 insight / key_insight */}
      {insightText != null && (
        <div className="text-sm mb-1.5">
          <span className="font-medium text-gray-700 dark:text-gray-300">关键洞察：</span>
          <span className="text-gray-600 dark:text-gray-400">{insightText}</span>
        </div>
      )}

      {/* 最佳利用方式 — 兼容 best_leverage / best_strategy */}
      {strategyText != null && (
        <div className="text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-300">最佳策略：</span>
          <span className="text-gray-600 dark:text-gray-400">{strategyText}</span>
        </div>
      )}

      {/* 描述信息（如果 role 已作为名称，则显示 description） */}
      {d.role != null && d.description != null && (
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2 leading-relaxed">
          {String(d.description)}
        </p>
      )}
    </div>
  )
}

// ===== Tab 4: 合议庭评审 =====

function TribunalTab({ result }: { result: RippleResults }) {
  const delib = result.deliberation
  const scores = result.key_metrics?.tribunal_scores

  if (!delib && !scores) {
    return <EmptyState text="暂无合议庭评审数据" />
  }

  const dimensions = scores?.dimension_averages || {}
  const roleScores = scores?.role_scores || {}

  return (
    <div className="space-y-6">
      {/* 总体评分 */}
      {scores?.overall_average != null && (
        <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-gray-900 dark:text-gray-100">合议庭综合评分</span>
            <span className="text-3xl font-bold text-primary-600">{scores.overall_average}</span>
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {scores.converged ? '✅ 合议庭达成共识' : '⚠️ 合议庭未完全收敛'}
          </div>
        </div>
      )}

      {/* 各维度评分 */}
      {Object.keys(dimensions).length > 0 && (
        <div>
          <SectionTitle>五维评分</SectionTitle>
          <div className="space-y-3">
            {Object.entries(dimensions).map(([dim, avg]) => (
              <div key={dim}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600 dark:text-gray-400">{translateDimension(dim)}</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{avg}/10</span>
                </div>
                <div className="h-2 bg-gray-200 dark:bg-dark-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary-500 to-purple-500 rounded-full transition-all"
                    style={{ width: `${(Number(avg) / 10) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 各角色评分详情 */}
      {Object.keys(roleScores).length > 0 && (
        <div>
          <SectionTitle>角色评分详情</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-dark-700">
                  <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400">角色</th>
                  {Object.keys(Object.values(roleScores)[0] || {}).map((dim) => (
                    <th key={dim} className="text-center py-2 px-2 text-gray-500 dark:text-gray-400">
                      {translateDimension(dim)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(roleScores).map(([role, sc]) => (
                  <tr key={role} className="border-b border-gray-100 dark:border-dark-700/50">
                    <td className="py-2 pr-4 font-medium text-gray-700 dark:text-gray-300">{translateRole(role)}</td>
                    {Object.values(sc).map((v, i) => (
                      <td key={i} className="text-center py-2 px-2 text-gray-600 dark:text-gray-400">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 共识与分歧 */}
      {(scores?.consensus_points?.length || scores?.dissent_points?.length) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scores?.consensus_points && scores.consensus_points.length > 0 && (
            <div>
              <SectionTitle>✅ 共识点</SectionTitle>
              <ul className="space-y-2">
                {scores.consensus_points.map((point, i) => (
                  <li key={i} className="text-sm text-gray-600 dark:text-gray-400 pl-4 relative before:absolute before:left-0 before:top-2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-green-500">
                    {translateDimension(point)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {scores?.dissent_points && scores.dissent_points.length > 0 && (
            <div>
              <SectionTitle>⚠️ 分歧点</SectionTitle>
              <ul className="space-y-2">
                {scores.dissent_points.map((point, i) => (
                  <li key={i} className="text-sm text-gray-600 dark:text-gray-400 pl-4 relative before:absolute before:left-0 before:top-2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-yellow-500">
                    {translateDimension(point)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {/* 原始数据 fallback */}
      {delib && Object.keys(delib).length > 0 && !scores && (
        <div>
          <SectionTitle>评审原始数据</SectionTitle>
          <pre className="text-xs bg-gray-50 dark:bg-dark-700 p-4 rounded-lg overflow-auto max-h-[300px] text-gray-700 dark:text-gray-300">
            {JSON.stringify(delib, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ===== Tab 5: 传播动力学 =====

/** 将 phase_vector 值翻译为中文 */
function translatePhaseValue(key: string, value: string): string {
  const map: Record<string, Record<string, string>> = {
    heat: { growth: '增长', peak: '峰值', decay: '衰减', stable: '平稳', dormant: '沉寂' },
    sentiment: { unified: '一致', polarized: '分化', mixed: '混合', positive: '正面', negative: '负面' },
    coherence: { ordered: '有序', chaotic: '混沌', fragmented: '碎片化', clustered: '聚集' },
  }
  return map[key]?.[value] || value
}
function translatePhaseKey(key: string): string {
  const map: Record<string, string> = { heat: '热度', sentiment: '情绪', coherence: '传播秩序' }
  return map[key] || key
}

/**
 * 解析全局观测数据
 * 兼容两种结构: 直接 { phase_vector, ... } 或嵌套 { content: { phase_vector, ... } }
 */
function resolveObservation(obs: Record<string, unknown>): Record<string, unknown> {
  if (obs.phase_vector || obs.emergence_events || obs.topology_recommendations) return obs
  if (obs.content && typeof obs.content === 'object') return obs.content as Record<string, unknown>
  return obs
}

function DynamicsTab({ result }: { result: RippleResults }) {
  const timeline = result.timeline
  const bifurcation = result.bifurcation_points
  const observation = result.observation
  const nameMap = useMemo(() => buildAgentNameMap(result), [result])
  const L = (text: string) => localizeAgentText(text, nameMap)

  if (!timeline?.length && !bifurcation?.length && !observation) {
    return <EmptyState text="暂无传播动力学数据" />
  }

  const obs = observation ? resolveObservation(observation as Record<string, unknown>) : null
  const phaseVector = obs?.phase_vector as Record<string, string> | undefined
  const emergenceEvents = obs?.emergence_events as Array<{ description: string; evidence?: string }> | undefined
  const topoRecs = obs?.topology_recommendations as string[] | undefined
  const phaseTransition = obs?.phase_transition_detected as boolean | undefined
  const transitionDesc = obs?.transition_description as string | undefined

  return (
    <div className="space-y-6">
      {/* ── 传播时间线 ── */}
      {timeline && timeline.length > 0 && (
        <div>
          <SectionTitle>传播时间线</SectionTitle>
          <div className="relative pl-6 border-l-2 border-primary-200 dark:border-primary-800 space-y-4">
            {timeline.map((entry, i) => {
              const wave = entry.wave ?? entry.label ?? (i + 1)
              const timeRange = entry.time_from_publish ?? entry.time_window ?? ''
              const event = entry.event ?? entry.description ?? entry.summary ?? ''
              const drivers = entry.drivers as string[] | undefined
              return (
                <div key={i} className="relative">
                  {/* 时间轴圆点 */}
                  <div className="absolute -left-[calc(1.5rem+5px)] w-3 h-3 rounded-full bg-primary-500 dark:bg-primary-400 ring-4 ring-white dark:ring-dark-800" />
                  <div className="p-3.5 bg-gray-50 dark:bg-dark-700/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300">
                        Wave {String(wave)}
                      </span>
                      {timeRange && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {String(timeRange)}
                        </span>
                      )}
                    </div>
                    {event && (
                      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                        {L(String(event))}
                      </p>
                    )}
                    {drivers && drivers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {drivers.map((d, j) => (
                          <span
                            key={j}
                            className="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-dark-600 text-gray-600 dark:text-gray-400"
                          >
                            {L(d)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 传播分叉点 ── */}
      {bifurcation && bifurcation.length > 0 && (
        <div>
          <SectionTitle>传播分叉点</SectionTitle>
          <div className="space-y-3">
            {bifurcation.map((bp, i) => {
              const title = L(String(bp.turning_point ?? bp.label ?? bp.event ?? `分叉点 ${i + 1}`))
              const waveInfo = bp.wave_range ?? (bp.wave != null ? `Wave ${bp.wave}` : '')
              const counterfactual = L(String(bp.counterfactual ?? bp.description ?? ''))
              return (
                <div
                  key={i}
                  className="p-4 border border-orange-200 dark:border-orange-800/60 bg-orange-50/50 dark:bg-orange-900/10 rounded-lg"
                >
                  <div className="flex items-start gap-2 mb-2">
                    <span className="text-orange-500 mt-0.5">⚡</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                          {title}
                        </span>
                        {waveInfo && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
                            {String(waveInfo)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {counterfactual && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed ml-6">
                      {counterfactual}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 全局观测 ── */}
      {obs && (
        <div>
          <SectionTitle>全局观测</SectionTitle>
          <div className="space-y-4">

            {/* 传播相位 */}
            {phaseVector && Object.keys(phaseVector).length > 0 && (
              <div className="flex flex-wrap gap-3">
                {Object.entries(phaseVector).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-dark-700/50 border border-gray-200 dark:border-dark-600"
                  >
                    <span className="text-xs text-gray-500 dark:text-gray-400">{translatePhaseKey(k)}</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {translatePhaseValue(k, v)}
                    </span>
                  </div>
                ))}
                {phaseTransition != null && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-dark-700/50 border border-gray-200 dark:border-dark-600">
                    <span className="text-xs text-gray-500 dark:text-gray-400">相变</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {phaseTransition ? '已发生' : '未发生'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 相变描述 */}
            {transitionDesc && (
              <p className="text-sm text-gray-700 dark:text-gray-300 p-3 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800/60 rounded-lg">
                {L(transitionDesc)}
              </p>
            )}

            {/* 涌现事件 */}
            {emergenceEvents && emergenceEvents.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2.5 flex items-center gap-1.5">
                  <span className="inline-block w-1 h-4 rounded-full bg-purple-500 flex-shrink-0" />
                  涌现事件
                </h4>
                <div className="space-y-3">
                  {emergenceEvents.map((evt, i) => (
                    <div
                      key={i}
                      className="p-3.5 bg-purple-50/50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800/60 rounded-lg"
                    >
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                        {L(evt.description)}
                      </p>
                      {evt.evidence && (
                        <p className="text-xs text-gray-500 dark:text-gray-500 leading-relaxed">
                          {L(evt.evidence)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 拓扑建议 */}
            {topoRecs && topoRecs.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2.5 flex items-center gap-1.5">
                  <span className="inline-block w-1 h-4 rounded-full bg-green-500 flex-shrink-0" />
                  传播拓扑优化建议
                </h4>
                <div className="space-y-2">
                  {topoRecs.map((rec, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-xs font-medium text-green-700 dark:text-green-400 mt-0.5">
                        {i + 1}
                      </span>
                      <p className="leading-relaxed">{L(rec)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ===== Tab 6: 日志下载 =====

function DownloadTab({
  simulationId,
  result,
  files,
  loading: loadingFiles,
}: {
  simulationId: string
  result: RippleResults
  files: SimulationFile[]
  loading: boolean
}) {
  const meta = result.meta

  return (
    <div className="space-y-6">
      {/* 模拟参数摘要 */}
      {meta && (
        <div>
          <SectionTitle>模拟参数</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: '引擎版本', value: `${meta.engine} v${meta.engine_version}` },
              { label: '总波次', value: meta.total_waves },
              { label: '运行 ID', value: meta.run_id?.slice(0, 8) || '-' },
              { label: '波次记录数', value: meta.wave_records_count },
            ]
              .filter((item) => item.value)
              .map((item) => (
                <div key={item.label} className="p-3 bg-gray-50 dark:bg-dark-700/50 rounded-lg">
                  <div className="text-xs text-gray-500 dark:text-gray-400">{item.label}</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {item.value}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 文件下载 */}
      <div>
        <SectionTitle>文件下载</SectionTitle>
        {loadingFiles ? (
          <div className="flex justify-center py-8">
            <Spinner size="md" />
          </div>
        ) : files.length > 0 ? (
          <div className="space-y-3">
            {files.map((file) => (
              <div
                key={file.name}
                className="flex items-center justify-between p-4 border border-gray-200 dark:border-dark-700 rounded-lg"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-xl">
                    {file.type === 'json' ? '📄' : file.type === 'report' ? '📝' : '📋'}
                  </span>
                  <div>
                    <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                      {file.label}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {file.name} · {file.size_display}
                    </div>
                  </div>
                </div>
                <a
                  href={getSimulationDownloadUrl(simulationId, file.type)}
                  download={file.name}
                  className="btn-secondary text-sm"
                >
                  下载
                </a>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 dark:text-gray-500 text-sm">暂无可下载文件</p>
        )}
      </div>
    </div>
  )
}

// ===== Mock 结果展示（向后兼容） =====

function MockResultView({ results }: { results: Record<string, unknown> }) {
  const metrics = results.metrics as Record<string, number> | undefined
  const suggestions = results.suggestions as Array<{ type: string; title: string; content: string }> | undefined

  return (
    <div className="space-y-6">
      <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
        <p className="text-sm text-yellow-700 dark:text-yellow-300">
          此结果由 Mock 引擎生成（开发测试用），数据为随机模拟。
        </p>
      </div>

      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(metrics).map(([key, val]) => (
            <div key={key} className="p-4 bg-gray-50 dark:bg-dark-700/50 rounded-lg text-center">
              <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {typeof val === 'number' ? val.toLocaleString() : val}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">{translateMetricKey(key)}</div>
            </div>
          ))}
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div>
          <SectionTitle>优化建议</SectionTitle>
          <div className="space-y-3">
            {suggestions.map((s, i) => (
              <div key={i} className="p-4 border border-gray-200 dark:border-dark-700 rounded-lg">
                <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-1">{s.title}</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">{s.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ===== 工具函数 =====

function translateMetricKey(key: string): string {
  const map: Record<string, string> = {
    // Ripple 引擎相对预测指标
    vs_baseline: '对照基准',
    views_relative: '浏览量（相对基准）',
    engagements_relative: '互动量（相对基准）',
    favorites_relative: '收藏量（相对基准）',
    comments_relative: '评论量（相对基准）',
    shares_relative: '分享/转发量（相对基准）',
    follows_relative: '新增关注（相对基准）',
    // Ripple 引擎锚定预测指标
    views_anchored: '预估浏览量',
    engagements_anchored: '预估互动量',
    favorites_anchored: '预估收藏量',
    comments_anchored: '预估评论量',
    shares_anchored: '预估分享量',
    follows_anchored: '预估新增关注',
    // 通用指标
    impressions: '曝光量',
    likes: '点赞',
    comments: '评论',
    favorites: '收藏',
    shares: '转发/分享',
    engagement_rate: '互动率',
    followers_gain: '涨粉',
    viral_probability: '爆款概率',
    reach: '触达人数',
    exposure_range: '曝光区间',
    interaction_range: '互动区间',
    save_range: '收藏区间',
    comment_range: '评论区间',
    share_range: '分享区间',
    follower_gain_range: '涨粉区间',
  }
  return map[key] || key
}

function translateDimension(dim: string): string {
  const map: Record<string, string> = {
    reach_realism: '触达真实性',
    decay_realism: '衰减真实性',
    virality_plausibility: '爆款合理性',
    audience_activation: '受众激活度',
    timeline_realism: '时间线真实性',
  }
  return map[dim] || dim
}

/**
 * 从模拟结果中动态构建 Agent 英文 ID → 中文简称的映射表
 * 数据来源优先级: key_metrics.agent_count 的名称数组 > agent_insights 的 role/description
 */
function buildAgentNameMap(result: RippleResults): Record<string, string> {
  const map: Record<string, string> = {}

  const parsePairs: [string[] | undefined, 'star' | 'sea'][] = [
    [result.key_metrics?.agent_count?.star_names, 'star'],
    [result.key_metrics?.agent_count?.sea_names, 'sea'],
  ]
  for (const [names, type] of parsePairs) {
    if (!Array.isArray(names)) continue
    for (const entry of names) {
      const match = /^(.+?)\((.+)\)$/.exec(String(entry))
      if (!match) continue
      const [, id, desc] = match
      const prefix = type === 'star' ? '星-' : '海-'
      map[id] = prefix + desc.split(/[，,]/)[0]
    }
  }

  const insights = result.agent_insights as Record<string, unknown> | undefined
  if (insights) {
    const processGroup = (group: unknown, type: 'star' | 'sea') => {
      if (!group || typeof group !== 'object' || Array.isArray(group)) return
      for (const [id, data] of Object.entries(group as Record<string, unknown>)) {
        if (map[id] || !data || typeof data !== 'object') continue
        const rec = data as Record<string, unknown>
        const raw = rec.role ?? rec.description ?? rec.core_motivation
        if (raw) {
          const prefix = type === 'star' ? '星-' : '海-'
          map[id] = prefix + String(raw).split(/[，,]/)[0]
        }
      }
    }
    if ('stars' in insights || 'seas' in insights) {
      processGroup(insights.stars, 'star')
      processGroup(insights.seas, 'sea')
    }
  }

  return map
}

/**
 * 将文本中嵌入的 Agent 英文 ID 替换为中文名
 * 替换后用「」包裹以保持可读性，与解读报告格式一致
 */
function localizeAgentText(text: string, nameMap: Record<string, string>): string {
  if (!text || Object.keys(nameMap).length === 0) return text
  const sortedIds = Object.keys(nameMap).sort((a, b) => b.length - a.length)
  let result = text
  for (const id of sortedIds) {
    if (result.includes(id)) {
      result = result.replaceAll(id, `「${nameMap[id]}」`)
    }
  }
  return result
}

function translateRole(role: string): string {
  const map: Record<string, string> = {
    PropagationDynamicist: '传播动力学家',
    PlatformEcologist: '平台生态学家',
    DevilsAdvocate: '魔鬼代言人',
    AudienceAnalyst: '受众分析师',
    ContentStrategist: '内容策略师',
    TrendForecaster: '趋势预测师',
    DataScientist: '数据科学家',
    SentimentAnalyst: '情感分析师',
    ViralMechanic: '病毒传播机制师',
    NarrativeDesigner: '叙事设计师',
  }
  return map[role] || role
}
