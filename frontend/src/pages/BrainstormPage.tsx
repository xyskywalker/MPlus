/**
 * 头脑风暴页面组件
 * 基于 WebSocket 的实时 AI 对话功能
 * 支持联网搜索增强、选题提取、会话管理
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  getSessions, createSession, updateSession, deleteSession,
  getPlatforms, getModelConfigs, getConversations, getSession,
  getAccounts,
  type Session, type Platform, type ModelConfig, type AccountProfile,
} from '../services/api'
import { useChat, type ChatMessage, type SearchResultItem, type ExtractedTopic } from '../hooks/useChat'
import { LoadingDots } from '../components/Loading'
import { PlatformIcon } from '../components/PlatformIcons'
import ModelSelect from '../components/ModelSelect'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useAppStore } from '../stores/appStore'

export default function BrainstormPage() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { showToast, extractingSessionId, extractingSessionTitle, startExtraction, finishExtraction } = useAppStore()

  const [sessions, setSessions] = useState<Session[]>([])
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState('xiaohongshu')
  const [showPlatformDropdown, setShowPlatformDropdown] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [enableSearch, setEnableSearch] = useState(true)

  // 新建会话弹窗相关状态
  const [showNewSessionModal, setShowNewSessionModal] = useState(false)
  const [newSessionPlatform, setNewSessionPlatform] = useState('xiaohongshu')
  const [newSessionAccountId, setNewSessionAccountId] = useState<string | null>(null)
  const [platformAccounts, setPlatformAccounts] = useState<AccountProfile[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  // 会话编辑/删除相关状态
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  // 专用选题提取 WebSocket 引用（独立于会话 WebSocket，确保会话切换时不断开）
  const extractionWsRef = useRef<WebSocket | null>(null)

  // 全局选题提取状态派生值
  const isCurrentExtracting = extractingSessionId === sessionId
  const isOtherExtracting = extractingSessionId !== null && extractingSessionId !== sessionId
  const isAnyExtracting = extractingSessionId !== null

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // WebSocket 对话 Hook — 选题提取回调（已迁移到独立 WebSocket，此处仅为空实现）
  const handleTopicExtracted = useCallback((_topics: ExtractedTopic[], _recommendation: string) => {
    // 选题提取现在通过独立 WebSocket 处理，不再经过 useChat 回调
  }, [])

  const handleChatError = useCallback((error: string) => {
    showToast('error', error)
  }, [showToast])

  // 快速任务模型自动生成标题后更新会话列表
  const handleTitleGenerated = useCallback((title: string) => {
    if (sessionId) {
      setSessions(prev =>
        prev.map(s => s.id === sessionId ? { ...s, title } : s)
      )
    }
  }, [sessionId])

  const {
    messages,
    isConnected,
    isStreaming,
    isSearching,
    isEvaluating,
    topicReadiness,
    searchQuery,
    sendMessage,
    setMessages,
    setTopicReadiness,
  } = useChat({
    sessionId: sessionId || '',
    onError: handleChatError,
    onTopicExtracted: handleTopicExtracted,
    onTitleGenerated: handleTitleGenerated,
  })

  // 组件卸载时清理独立提取 WebSocket
  useEffect(() => {
    return () => {
      if (extractionWsRef.current) {
        extractionWsRef.current.close()
        extractionWsRef.current = null
        useAppStore.getState().finishExtraction()
      }
    }
  }, [])

  // 获取初始数据
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sessionsData, platformsData, modelConfigs] = await Promise.all([
          getSessions(10, 0),
          getPlatforms(),
          getModelConfigs(),
        ])
        setSessions(sessionsData.items)
        setPlatforms(platformsData)

        // 获取默认模型 ID
        const defaultModel = modelConfigs.find((c: ModelConfig) => c.is_default)
        const defId = defaultModel?.id || modelConfigs[0]?.id || null
        setDefaultModelId(defId)
        if (!sessionId) {
          setSelectedModelId(defId)
        }
      } catch (err) {
        console.error('获取数据失败:', err)
      }
    }
    fetchData()
  }, [])

  // 切换会话时恢复模型选择和加载历史消息
  useEffect(() => {
    if (sessionId && sessions.length > 0) {
      const currentSession = sessions.find((s) => s.id === sessionId)
      if (currentSession?.model_config_id) {
        setSelectedModelId(currentSession.model_config_id)
      } else if (defaultModelId) {
        setSelectedModelId(defaultModelId)
      }
      // 更新选中的平台
      if (currentSession?.platform_code) {
        setSelectedPlatform(currentSession.platform_code)
      }
    }
  }, [sessionId, sessions, defaultModelId])

  // 加载会话数据（历史消息 + 持久化的评估结果）
  useEffect(() => {
    if (!sessionId) return

    // 切换会话时立即清空消息和评估状态，避免短暂显示上一个会话的内容
    setMessages([])
    setTopicReadiness(null)

    const loadSessionData = async () => {
      try {
        // 并行加载会话详情和对话历史
        const [sessionData, convData] = await Promise.all([
          getSession(sessionId),
          getConversations(sessionId),
        ])

        // 恢复持久化的选题评估结果（从数据库加载）
        if (sessionData.topic_readiness_level) {
          setTopicReadiness({
            level: sessionData.topic_readiness_level as 'low' | 'medium' | 'high',
            summary: sessionData.topic_readiness_summary || '',
          })
        }

        // 恢复对话历史（含搜索结果）
        if (convData.items.length > 0) {
          const historyMessages: ChatMessage[] = convData.items.map((conv) => {
            const msg: ChatMessage = {
              id: conv.id,
              role: conv.role as 'user' | 'assistant',
              content: conv.content,
              timestamp: new Date(conv.created_at),
            }
            // 从 metadata 中恢复搜索结果（assistant 消息）
            const metadata = conv.metadata as Record<string, unknown> | undefined
            if (metadata?.search_results && Array.isArray(metadata.search_results)) {
              msg.searchResults = metadata.search_results as ChatMessage['searchResults']
            }
            return msg
          })
          setMessages(historyMessages)
        }
      } catch (err) {
        // 静默处理 - 加载失败不影响使用
        console.error('加载会话数据失败:', err)
      }
    }
    loadSessionData()
  }, [sessionId, setMessages, setTopicReadiness])

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // AI 回答完毕后自动聚焦输入框，方便用户继续提问
  useEffect(() => {
    if (!isStreaming && sessionId && isConnected) {
      inputRef.current?.focus()
    }
  }, [isStreaming, sessionId, isConnected])

  // 发送消息
  const handleSend = async () => {
    const content = inputValue.trim()
    if (!content || isStreaming) return

    sendMessage(content, enableSearch)
    setInputValue('')
  }

  // 处理键盘事件（兼容中文输入法 IME 组合输入状态）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME 组合输入中（如中文输入法选词/输入英文候选）时不触发发送
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 处理选题生成 — 通过独立 WebSocket 发送（会话切换时不中断）
  const handleStartExtraction = useCallback(() => {
    if (!sessionId || isAnyExtracting) return

    const currentSession = sessions.find(s => s.id === sessionId)
    const title = currentSession?.title || '当前会话'

    console.log('[选题提取] 开始, session:', sessionId, 'title:', title)

    // 设置全局提取状态
    startExtraction(sessionId, title)

    // 关闭之前可能残留的提取 WebSocket
    if (extractionWsRef.current) {
      console.log('[选题提取] 关闭残留的旧连接')
      extractionWsRef.current.close(1000)
      extractionWsRef.current = null
    }

    // 创建独立 WebSocket 连接（不受会话切换影响）
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/chat/${sessionId}`
    console.log('[选题提取] 连接 URL:', wsUrl)
    const ws = new WebSocket(wsUrl)

    // 超时保护：如果 60 秒内未收到 connected，视为连接失败
    let connectTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      console.error('[选题提取] 连接超时（60s）')
      finishExtraction()
      showToast('error', '选题生成连接超时，请重试')
      ws.close()
      extractionWsRef.current = null
    }, 60000)

    // 标记该 WebSocket 是否已接收到结果（防止 onclose 重复处理）
    let resultReceived = false

    ws.onopen = () => {
      console.log('[选题提取] WebSocket 已打开, readyState:', ws.readyState)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('[选题提取] 收到消息:', data.type)

        if (data.type === 'connected') {
          // 连接就绪，清除连接超时，发送提取请求
          if (connectTimeout) {
            clearTimeout(connectTimeout)
            connectTimeout = null
          }
          console.log('[选题提取] 发送 extract_topic 请求')
          ws.send(JSON.stringify({ type: 'extract_topic', enhanced: false }))
        } else if (data.type === 'topic_extracted') {
          resultReceived = true
          const topics = (data.topics as ExtractedTopic[]) || []
          console.log('[选题提取] 提取完成, topics:', topics.length)
          finishExtraction()
          if (topics.length > 0) {
            showToast('success', `成功生成 ${topics.length} 个选题方案`)
          } else {
            showToast('warning', '未能提取到选题，请继续对话以补充更多信息')
          }
          ws.close(1000)
          extractionWsRef.current = null
        } else if (data.type === 'error') {
          resultReceived = true
          console.error('[选题提取] 服务端返回错误:', data.message)
          finishExtraction()
          showToast('error', (data.message as string) || '选题生成失败')
          ws.close(1000)
          extractionWsRef.current = null
        }
      } catch (e) {
        console.error('[选题提取] 消息解析失败:', e)
      }
    }

    ws.onerror = (event) => {
      console.error('[选题提取] WebSocket 连接异常:', event)
      if (connectTimeout) {
        clearTimeout(connectTimeout)
        connectTimeout = null
      }
      if (!resultReceived) {
        finishExtraction()
        showToast('error', '选题生成连接异常，请检查网络后重试')
      }
      extractionWsRef.current = null
    }

    ws.onclose = (event) => {
      console.log('[选题提取] WebSocket 关闭, code:', event.code, 'reason:', event.reason)
      if (connectTimeout) {
        clearTimeout(connectTimeout)
        connectTimeout = null
      }
      // 非正常关闭且仍在提取中且尚未收到结果，重置状态
      if (!resultReceived && event.code !== 1000 && useAppStore.getState().extractingSessionId) {
        finishExtraction()
        showToast('warning', '选题生成连接中断，请重试')
      }
      extractionWsRef.current = null
    }

    extractionWsRef.current = ws
  }, [sessionId, sessions, isAnyExtracting, startExtraction, finishExtraction, showToast])

  // 点击"生成选题"按钮的确认弹窗
  const handleExtractClick = useCallback(() => {
    if (!topicReadiness || !sessionId) return

    const baseMsg = topicReadiness.level === 'low'
      ? '当前选题信息完成度较低，生成的选题效果可能不够理想。\n建议继续与 AI 交流以补充更多信息。\n\n是否仍然继续生成？'
      : '是否确认基于当前对话信息生成选题？'
    const hint = '\n\n提示：生成过程耗时较长，请耐心等待。过程中可以继续与当前会话交互，也可以新建或切换到其他会话。'

    if (!window.confirm(baseMsg + hint)) return
    handleStartExtraction()
  }, [topicReadiness, sessionId, handleStartExtraction])

  // 打开新建会话弹窗
  const handleOpenNewSession = () => {
    setNewSessionPlatform(selectedPlatform)
    setNewSessionAccountId(null)
    setPlatformAccounts([])
    setShowNewSessionModal(true)
    // 加载当前平台下的账号
    loadAccountsForPlatform(selectedPlatform)
  }

  // 加载指定平台的账号列表
  const loadAccountsForPlatform = async (platformCode: string) => {
    setLoadingAccounts(true)
    setPlatformAccounts([])
    setNewSessionAccountId(null)
    try {
      const data = await getAccounts(platformCode)
      setPlatformAccounts(data.items)
    } catch (err) {
      console.error('加载账号列表失败:', err)
    } finally {
      setLoadingAccounts(false)
    }
  }

  // 弹窗中切换平台
  const handleNewSessionPlatformChange = (platformCode: string) => {
    setNewSessionPlatform(platformCode)
    loadAccountsForPlatform(platformCode)
  }

  // 确认新建会话
  const handleConfirmNewSession = async () => {
    setShowNewSessionModal(false)
    try {
      const session = await createSession({
        title: '新会话',
        platform_code: newSessionPlatform,
        model_config_id: selectedModelId || undefined,
        account_profile_id: newSessionAccountId || undefined,
      })
      setSessions((prev) => [session, ...prev])
      setMessages([])
      setSelectedModelId(defaultModelId)
      setSelectedPlatform(newSessionPlatform)
      navigate(`/brainstorm/${session.id}`)
      showToast('success', '新建会话成功')
    } catch (err) {
      showToast('error', '新建会话失败')
    }
  }

  // 格式化粉丝数为简写
  const formatFollowers = (count: number) => {
    if (count >= 10000) return `${(count / 10000).toFixed(1)}w`
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
    return String(count)
  }

  // 切换模型选择
  const handleModelChange = async (modelId: string) => {
    setSelectedModelId(modelId)
    if (sessionId) {
      try {
        await updateSession(sessionId, { model_config_id: modelId })
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, model_config_id: modelId } : s))
        )
      } catch (err) {
        console.error('保存模型选择失败:', err)
      }
    }
  }

  // 会话编辑相关函数
  const handleStartEdit = (session: Session) => {
    setEditingSessionId(session.id)
    setEditingTitle(session.title)
    setMenuSessionId(null)
    setTimeout(() => editInputRef.current?.focus(), 50)
  }

  const handleSaveEdit = async () => {
    if (!editingSessionId) return
    const newTitle = editingTitle.trim()
    if (!newTitle) {
      setEditingSessionId(null)
      return
    }
    try {
      await updateSession(editingSessionId, { title: newTitle })
      setSessions((prev) =>
        prev.map((s) => (s.id === editingSessionId ? { ...s, title: newTitle } : s))
      )
      showToast('success', '会话名称已更新')
    } catch (err) {
      showToast('error', '更新会话名称失败')
    }
    setEditingSessionId(null)
  }

  const handleCancelEdit = () => {
    setEditingSessionId(null)
    setEditingTitle('')
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  const handleDeleteSession = async (id: string) => {
    setMenuSessionId(null)
    if (!window.confirm('确定要删除这个会话吗？删除后不可恢复。')) return
    try {
      await deleteSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (sessionId === id) {
        navigate('/brainstorm')
        setMessages([])
        setTopicReadiness(null)
      }
      showToast('success', '会话已删除')
    } catch (err) {
      showToast('error', '删除会话失败')
    }
  }

  const handleToggleMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (menuSessionId === id) {
      setMenuSessionId(null)
      return
    }
    const btn = e.currentTarget as HTMLElement
    const rect = btn.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 4,
      left: rect.right - 120,
    })
    setMenuSessionId(id)
  }

  // 格式化时间
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  // 获取平台信息
  const getPlatformInfo = (code: string) => {
    return platforms.find((p) => p.code === code) || { name: '未知', icon: '📱', color: '#6366F1', code: '' }
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] gap-4 animate-fade-in">
      {/* 左侧边栏 */}
      <div className="w-64 flex-shrink-0 flex flex-col">
        <div className="card flex-1 overflow-hidden flex flex-col">
          {/* 顶部标题栏 */}
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">会话列表</h3>
          </div>

          {/* 平台下拉框 + 新建按钮 */}
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <button
                onClick={() => setShowPlatformDropdown(!showPlatformDropdown)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-dark-600 bg-white dark:bg-dark-700 hover:border-primary-400 dark:hover:border-primary-500 transition-colors text-sm"
              >
                <PlatformIcon platformCode={selectedPlatform} size={18} />
                <span className="flex-1 text-left text-gray-700 dark:text-gray-300 truncate">
                  {getPlatformInfo(selectedPlatform).name}
                </span>
                <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showPlatformDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showPlatformDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowPlatformDropdown(false)} />
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-dark-700 border border-gray-200 dark:border-dark-600 rounded-lg shadow-lg z-20 py-1 max-h-60 overflow-y-auto">
                    {platforms.map((platform) => (
                      <button
                        key={platform.code}
                        onClick={() => {
                          setSelectedPlatform(platform.code)
                          setShowPlatformDropdown(false)
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                          selectedPlatform === platform.code
                            ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-dark-600'
                        }`}
                      >
                        <PlatformIcon platformCode={platform.code} size={18} />
                        <span>{platform.name}</span>
                        {selectedPlatform === platform.code && (
                          <svg className="w-4 h-4 ml-auto text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={handleOpenNewSession}
              className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors"
              title="新建头脑风暴会话"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新建
            </button>
          </div>

          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto space-y-1 -mx-4 px-4">
            {sessions.map((session) => (
              <div key={session.id} className="group">
                {editingSessionId === session.id ? (
                  <div className="p-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 ring-1 ring-primary-300 dark:ring-primary-700">
                    <div className="flex items-center space-x-2 mb-1.5">
                      <PlatformIcon platformCode={session.platform_code || ''} size={16} />
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {getPlatformInfo(session.platform_code || '').name}
                      </span>
                    </div>
                    <input
                      ref={editInputRef}
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      onBlur={handleSaveEdit}
                      className="w-full text-sm px-2 py-1 rounded border border-primary-300 dark:border-primary-600 bg-white dark:bg-dark-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      maxLength={50}
                    />
                  </div>
                ) : (
                  <Link
                    to={`/brainstorm/${session.id}`}
                    className={`block p-2 rounded-lg transition-colors ${
                      sessionId === session.id
                        ? 'bg-primary-100 dark:bg-primary-900/30'
                        : 'hover:bg-gray-100 dark:hover:bg-dark-700'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <PlatformIcon platformCode={session.platform_code || ''} size={16} />
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {getPlatformInfo(session.platform_code || '').name}
                        {session.account_summary && (
                          <span className="ml-1 text-primary-500 dark:text-primary-400">
                            · {session.account_summary.account_name}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center mt-1">
                      <div className="text-sm text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
                        {session.title}
                      </div>
                      <button
                        onClick={(e) => handleToggleMenu(e, session.id)}
                        className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-dark-600 transition-opacity ${
                          menuSessionId === session.id
                            ? 'opacity-100 text-gray-600 dark:text-gray-300'
                            : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                        </svg>
                      </button>
                    </div>
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 三点菜单 */}
        {menuSessionId && (
          <>
            <div className="fixed inset-0 z-[9998]" onClick={() => setMenuSessionId(null)} />
            <div
              className="fixed z-[9999] bg-white dark:bg-dark-700 border border-gray-200 dark:border-dark-600 rounded-lg shadow-xl py-1 w-[120px]"
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              <button
                onClick={() => {
                  const s = sessions.find((s) => s.id === menuSessionId)
                  if (s) handleStartEdit(s)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-600"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                重命名
              </button>
              <button
                onClick={() => handleDeleteSession(menuSessionId)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                删除
              </button>
            </div>
          </>
        )}
      </div>

      {/* 右侧对话区 */}
      <div className="flex-1 flex flex-col card p-0 overflow-hidden">
        {/* 消息区域（含固定背景 + 可滚动内容） */}
        <div className="flex-1 relative overflow-hidden">
          {/* 背景图层 - absolute 定位在消息区域内，不受滚动影响 */}
          <div
            className="absolute inset-0 pointer-events-none z-0 opacity-[0.08] dark:opacity-[0.12] dark:bg-dark-800 dark:bg-blend-multiply"
            style={{
              backgroundImage: 'url(/main_visual.png)',
              backgroundSize: '85%',
              backgroundPosition: 'left bottom',
              backgroundRepeat: 'no-repeat',
            }}
          />
          {/* 消息列表 - 独立滚动 */}
          <div className="absolute inset-0 overflow-y-auto p-4 space-y-4 z-[1] flex flex-col">

          {/* 当前会话的上下文指示栏（平台 + 关联账号） */}
          {sessionId && (() => {
            const currentSession = sessions.find(s => s.id === sessionId)
            if (!currentSession) return null
            const platformInfo = getPlatformInfo(currentSession.platform_code || '')
            const accountSummary = currentSession.account_summary
            return (
              <div className="relative z-10 flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-gray-50/80 dark:bg-dark-700/60 border border-gray-100 dark:border-dark-600 text-xs">
                <PlatformIcon platformCode={currentSession.platform_code || ''} size={16} />
                <span className="font-medium text-gray-700 dark:text-gray-300">{platformInfo.name}</span>
                {accountSummary ? (
                  <>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="text-primary-600 dark:text-primary-400">
                      关联账号: {accountSummary.account_name}
                    </span>
                    <span className="text-gray-400 dark:text-gray-500">
                      {accountSummary.main_category} · 粉丝 {formatFollowers(accountSummary.followers_count)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="text-gray-400 dark:text-gray-500">通用模式</span>
                  </>
                )}
              </div>
            )
          })()}

          {/* 无消息时的欢迎提示 */}
          {messages.length === 0 && !sessionId && (
            <div className="flex flex-col items-center justify-center flex-1 min-h-0 text-center relative z-10">
              <p className="text-lg text-gray-600 dark:text-gray-300 mb-2">
                选择或新建一个会话开始头脑风暴
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                告诉我你想做什么方向的内容
              </p>
            </div>
          )}

          {messages.length === 0 && sessionId && (
            <div className="flex flex-col items-center justify-center flex-1 min-h-0 text-center relative z-10">
              <p className="text-lg text-gray-600 dark:text-gray-300 mb-2">
                开始你的选题头脑风暴
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                告诉我你想做什么方向的内容，我会帮你打磨出高质量选题
              </p>
              {/* 连接状态指示 */}
              <div className={`mt-4 flex items-center gap-2 text-xs px-3 py-1.5 rounded-full ${
                isConnected
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                  : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'
                }`} />
                {isConnected ? 'AI 就绪' : '正在连接...'}
              </div>
            </div>
          )}

          {/* 消息列表 */}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} relative z-10`}
            >
              <div className={`max-w-[80%] flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                {/* 消息气泡 */}
                <div
                  className={`rounded-2xl p-4 w-full ${
                    message.role === 'user'
                      ? 'bg-gradient-to-r from-primary-500 to-purple-500 text-white'
                      : 'bg-gray-100 dark:bg-dark-700 text-gray-900 dark:text-gray-100'
                  }`}
                >
                  {/* 消息内容 — 使用 Markdown 渲染（支持流式输出实时渲染） */}
                  <div className="text-sm">
                    {message.content ? (
                      <MarkdownRenderer
                        content={message.content}
                        isUser={message.role === 'user'}
                      />
                    ) : (
                      message.role === 'assistant' && isStreaming && (
                        <span className="inline-flex items-center gap-1 text-gray-400">
                          <LoadingDots />
                        </span>
                      )
                    )}
                  </div>

                  {/* 时间 */}
                  <div
                    className={`text-xs mt-2 ${
                      message.role === 'user' ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    {formatTime(message.timestamp)}
                  </div>
                </div>

                {/* 搜索结果（气泡外部下方，持久保留在消息上） */}
                {message.searchResults && message.searchResults.length > 0 && (
                  <div className="mt-2 w-full p-2.5 bg-blue-50/80 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30">
                    <div className="flex items-center gap-1.5 text-xs text-blue-500 dark:text-blue-400 mb-1.5">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      参考来源（{message.searchResults.length}）
                    </div>
                    <ul className="text-xs space-y-1">
                      {message.searchResults.map((item: SearchResultItem, i: number) => (
                        <li key={i} className="flex items-start gap-1">
                          <span className="text-blue-300 dark:text-blue-600 mt-px flex-shrink-0">•</span>
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 hover:underline underline-offset-2 transition-colors truncate"
                              title={item.url}
                            >
                              {item.title}
                            </a>
                          ) : (
                            <span className="text-blue-600 dark:text-blue-400 truncate">{item.title}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* 搜索状态 */}
          {isSearching && (
            <div className="flex justify-start relative z-10">
              <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                正在搜索: {searchQuery}
              </div>
            </div>
          )}

          {/* 搜索结果现在直接绑定在 assistant 消息下方展示，无需浮动面板 */}

          <div ref={messagesEndRef} />
        </div>
        </div>{/* 关闭消息区域 wrapper */}

        {/* 输入区域 */}
        <div className="border-t border-gray-200 dark:border-dark-700 p-4 bg-white dark:bg-dark-800">
          {/* 工具栏 */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-4">
              {/* 模型选择 */}
              <ModelSelect
                value={selectedModelId}
                onChange={handleModelChange}
                size="sm"
              />
              <div className="w-px h-4 bg-gray-200 dark:bg-dark-600" />
              {/* 联网搜索 */}
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableSearch}
                  onChange={(e) => setEnableSearch(e.target.checked)}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  联网搜索
                  {enableSearch && (
                    <span className="ml-1 text-xs text-green-600 dark:text-green-400">推荐</span>
                  )}
                </span>
              </label>
              {/* 连接状态 */}
              {sessionId && (
                <div className={`flex items-center gap-1.5 text-xs ${
                  isConnected ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    isConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'
                  }`} />
                  {isConnected ? '已连接' : '连接中'}
                </div>
              )}
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {inputValue.length}/2000
            </span>
          </div>

          {/* 输入框 + 发送按钮 + 选题完成度 */}
          <div className="flex space-x-3 items-stretch">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value.slice(0, 2000))}
              onKeyDown={handleKeyDown}
              placeholder={sessionId ? '输入你的想法...（Enter 发送，Shift+Enter 换行）' : '请先新建或选择一个会话'}
              className="input flex-1 resize-none"
              rows={3}
              disabled={!sessionId || !isConnected || isStreaming}
            />
            {/* 右侧：发送按钮 + 生成选题按钮（上下对齐文本框） */}
            <div className="flex flex-col gap-2 items-stretch justify-between w-[120px] flex-shrink-0">
              {/* 发送按钮 — 固定宽度防止文字切换时抖动 */}
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || !isConnected || isStreaming || !sessionId}
                className="btn-primary w-full"
              >
                {isStreaming ? '生成中...' : '发送'}
              </button>

              {/* 生成选题按钮（与发送按钮等宽等高） */}
              {isCurrentExtracting ? (
                /* 当前会话正在提取选题 — 旋转动画 */
                <span className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-sm font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  生成中...
                </span>
              ) : isOtherExtracting ? (
                /* 其他会话正在提取，禁用当前按钮 */
                <span
                  className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-sm font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-dark-600 cursor-not-allowed opacity-60"
                  title="当前已有选题正在生成中，请等待"
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  生成选题
                </span>
              ) : isEvaluating ? (
                /* 正在评估就绪度 — 呼吸动画 */
                <span className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-sm font-medium text-gray-400 dark:text-gray-500 animate-pulse">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
                  </svg>
                  评估中...
                </span>
              ) : topicReadiness ? (
                /* 评估完成 — 显示就绪度 + 可点击生成选题 */
                <button
                  onClick={handleExtractClick}
                  title={topicReadiness.summary}
                  className={`flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-sm font-medium transition-all hover:shadow-sm ${
                    topicReadiness.level === 'high'
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 ring-1 ring-green-200 dark:ring-green-800'
                      : topicReadiness.level === 'medium'
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 ring-1 ring-blue-200 dark:ring-blue-800'
                        : 'bg-gray-50 dark:bg-dark-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-500 ring-1 ring-gray-200 dark:ring-dark-500'
                  }`}
                >
                  {topicReadiness.level === 'low' && (
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  )}
                  {topicReadiness.level === 'medium' && (
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M8 1.5A6.5 6.5 0 0 1 8 14.5V1.5Z" fill="currentColor" />
                    </svg>
                  )}
                  {topicReadiness.level === 'high' && (
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="7" fill="currentColor" />
                    </svg>
                  )}
                  生成选题
                </button>
              ) : (
                /* 尚无评估结果 — 灰色占位 */
                <span className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-sm font-medium text-gray-300 dark:text-gray-600 ring-1 ring-gray-100 dark:ring-dark-600 cursor-default select-none">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  生成选题
                </span>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* 全局选题生成状态指示器 — 固定在页面右下角 */}
      {isAnyExtracting && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-white dark:bg-dark-700 rounded-xl shadow-lg border border-purple-200 dark:border-purple-800 animate-pulse">
          <svg className="w-5 h-5 text-purple-500 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">选题生成中...</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">会话：{extractingSessionTitle}</p>
          </div>
        </div>
      )}

      {/* 新建会话弹窗 */}
      {showNewSessionModal && (
        <>
          {/* 遮罩层 */}
          <div
            className="fixed inset-0 z-[9998] bg-black/30 dark:bg-black/50 backdrop-blur-sm"
            onClick={() => setShowNewSessionModal(false)}
          />
          {/* 弹窗主体 */}
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div
              className="bg-white dark:bg-dark-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-dark-600 w-full max-w-md overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 标题栏 */}
              <div className="px-6 pt-5 pb-3">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  新建头脑风暴会话
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  选择目标平台，可选关联已有账号以获得更精准的选题建议
                </p>
              </div>

              <div className="px-6 pb-5 space-y-4">
                {/* 平台选择 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    目标平台
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {platforms.map((platform) => (
                      <button
                        key={platform.code}
                        onClick={() => handleNewSessionPlatformChange(platform.code)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all border ${
                          newSessionPlatform === platform.code
                            ? 'border-primary-400 dark:border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400 ring-1 ring-primary-200 dark:ring-primary-800'
                            : 'border-gray-200 dark:border-dark-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-dark-500 hover:bg-gray-50 dark:hover:bg-dark-700'
                        }`}
                      >
                        <PlatformIcon platformCode={platform.code} size={18} />
                        <span className="truncate">{platform.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 关联账号选择 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    关联账号
                    <span className="font-normal text-gray-400 dark:text-gray-500 ml-1">（可选）</span>
                  </label>
                  <div className="border border-gray-200 dark:border-dark-600 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                    {/* 默认选项：不参考已有账号 */}
                    <button
                      onClick={() => setNewSessionAccountId(null)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors border-b border-gray-100 dark:border-dark-700 ${
                        newSessionAccountId === null
                          ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-dark-700'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        newSessionAccountId === null
                          ? 'border-primary-500 dark:border-primary-400'
                          : 'border-gray-300 dark:border-dark-500'
                      }`}>
                        {newSessionAccountId === null && (
                          <div className="w-2 h-2 rounded-full bg-primary-500 dark:bg-primary-400" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-gray-700 dark:text-gray-300">不参考已有账号</div>
                        <div className="text-xs text-gray-400 dark:text-gray-500">通用模式，适合探索新方向</div>
                      </div>
                    </button>

                    {/* 加载中 */}
                    {loadingAccounts && (
                      <div className="px-4 py-4 text-center text-sm text-gray-400 dark:text-gray-500">
                        <LoadingDots /> 加载账号列表...
                      </div>
                    )}

                    {/* 账号列表 */}
                    {!loadingAccounts && platformAccounts.map((account) => (
                      <button
                        key={account.id}
                        onClick={() => setNewSessionAccountId(account.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors border-b border-gray-50 dark:border-dark-700 last:border-b-0 ${
                          newSessionAccountId === account.id
                            ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-dark-700'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          newSessionAccountId === account.id
                            ? 'border-primary-500 dark:border-primary-400'
                            : 'border-gray-300 dark:border-dark-500'
                        }`}>
                          {newSessionAccountId === account.id && (
                            <div className="w-2 h-2 rounded-full bg-primary-500 dark:bg-primary-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-800 dark:text-gray-200 truncate">
                            {account.account_name}
                          </div>
                          <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                            {account.main_category}
                            {account.content_style && ` · ${account.content_style}`}
                            {' · '}粉丝 {formatFollowers(account.followers_count)}
                          </div>
                        </div>
                      </button>
                    ))}

                    {/* 空状态 */}
                    {!loadingAccounts && platformAccounts.length === 0 && (
                      <div className="px-4 py-4 text-center">
                        <p className="text-sm text-gray-400 dark:text-gray-500">该平台暂无已配置的账号</p>
                        <Link
                          to="/accounts"
                          className="inline-block mt-1 text-xs text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300"
                          onClick={() => setShowNewSessionModal(false)}
                        >
                          前往"账号管理"添加 →
                        </Link>
                      </div>
                    )}
                  </div>
                </div>

                {/* 提示信息 */}
                <div className="flex items-start gap-2 px-3 py-2 bg-blue-50/60 dark:bg-blue-900/10 rounded-lg">
                  <svg className="w-4 h-4 text-blue-400 dark:text-blue-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed">
                    关联账号后，AI 将参考账号定位、内容风格和受众特征，给出更贴合你账号调性的选题建议。
                  </p>
                </div>

                {/* 底部按钮 */}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setShowNewSessionModal(false)}
                    className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-700 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmNewSession}
                    className="px-5 py-2 rounded-lg text-sm font-medium bg-primary-500 hover:bg-primary-600 text-white transition-colors shadow-sm"
                  >
                    开始头脑风暴
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
