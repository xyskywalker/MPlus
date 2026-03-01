/**
 * WebSocket 对话 Hook
 * 管理与后端的实时头脑风暴对话连接
 *
 * 支持：
 * - 自动连接/重连
 * - 流式消息接收
 * - 联网搜索状态
 * - 选题提取
 * - 会话重置
 */

import { useState, useRef, useCallback, useEffect } from 'react'

// 消息类型定义
// 选题就绪度信息
export interface TopicReadiness {
  level: 'low' | 'medium' | 'high'
  summary: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  searchResults?: SearchResultItem[]
  // 选题就绪度（仅 assistant 消息会有）
  topicReadiness?: TopicReadiness
}

// 搜索结果条目
export interface SearchResultItem {
  title: string
  snippet: string
  url: string
}

// 提取的选题
export interface ExtractedTopic {
  id: string
  title: string
  description: string
  target_platform?: string
  metadata?: Record<string, unknown>
}

// Hook 内部状态
interface ChatState {
  messages: ChatMessage[]
  isConnected: boolean
  isStreaming: boolean
  isSearching: boolean
  isEvaluating: boolean       // 正在评估选题就绪度（complete 和 topic_readiness 之间）
  searchQuery: string
  searchResults: SearchResultItem[]
  topicReadiness: TopicReadiness | null  // 最新的全局就绪度结果
}

// Hook 配置
interface UseChatOptions {
  sessionId: string
  onError?: (error: string) => void
  onTopicExtracted?: (topics: ExtractedTopic[], recommendation: string) => void
  onTitleGenerated?: (title: string) => void
}

export function useChat({ sessionId, onError, onTopicExtracted, onTitleGenerated }: UseChatOptions) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isConnected: false,
    isStreaming: false,
    isSearching: false,
    isEvaluating: false,
    searchQuery: '',
    searchResults: [],
    topicReadiness: null,
  })

  const wsRef = useRef<WebSocket | null>(null)
  const currentMessageRef = useRef<string>('')
  const reconnectTimerRef = useRef<number | null>(null)
  const sessionIdRef = useRef<string>(sessionId)

  // 更新 sessionId ref
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  // 处理服务端消息
  const handleMessage = useCallback((data: Record<string, unknown>) => {
    switch (data.type) {
      case 'connected':
        setState(s => ({ ...s, isConnected: true }))
        break

      case 'searching':
        setState(s => ({
          ...s,
          isSearching: true,
          searchQuery: (data.query as string) || '',
        }))
        break

      case 'search_result': {
        const results = (data.results as SearchResultItem[]) || []
        setState(s => {
          // 搜索结果立即绑定到最后一条 assistant 消息上，避免 complete 时切换区域导致抖动
          const messages = [...s.messages]
          const lastMsg = messages[messages.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            messages[messages.length - 1] = {
              ...lastMsg,
              searchResults: results,
            }
          }
          return {
            ...s,
            messages,
            isSearching: false,
            searchResults: results,
          }
        })
        break
      }

      case 'search_failed':
        setState(s => ({ ...s, isSearching: false }))
        break

      case 'stream': {
        const content = data.content as string
        if (content) {
          currentMessageRef.current += content
          setState(s => {
            const messages = [...s.messages]
            const lastMsg = messages[messages.length - 1]
            if (lastMsg && lastMsg.role === 'assistant') {
              // 更新最后一条助手消息的内容
              messages[messages.length - 1] = {
                ...lastMsg,
                content: currentMessageRef.current,
              }
            }
            return { ...s, messages, isStreaming: true }
          })
        }
        break
      }

      case 'complete':
        currentMessageRef.current = ''
        // 搜索结果已在 search_result 事件中绑定到消息上，此处只清空全局状态
        setState(s => ({
          ...s,
          isStreaming: false,
          isSearching: false,
          isEvaluating: true,  // 开始评估就绪度（呼吸动画）
          searchResults: [],
          searchQuery: '',
        }))
        break

      case 'topic_readiness': {
        // 更新全局就绪度状态，并关闭评估中动画
        const readinessLevel = data.level as TopicReadiness['level']
        const readinessSummary = data.summary as string
        const newReadiness: TopicReadiness = {
          level: readinessLevel || 'low',
          summary: readinessSummary || '',
        }
        setState(s => ({
          ...s,
          isEvaluating: false,
          topicReadiness: newReadiness,
        }))
        break
      }

      case 'reset_complete':
        setState(s => ({
          ...s,
          messages: [],
          isStreaming: false,
          isSearching: false,
          isEvaluating: false,
          searchResults: [],
          searchQuery: '',
          topicReadiness: null,
        }))
        break

      case 'title_generated': {
        // 后端通过快速任务模型自动生成的会话标题
        const title = data.title as string
        if (title && onTitleGenerated) {
          onTitleGenerated(title)
        }
        break
      }

      case 'topic_extracted':
        if (onTopicExtracted) {
          onTopicExtracted(
            (data.topics as ExtractedTopic[]) || [],
            (data.recommendation as string) || ''
          )
        }
        break

      case 'error':
        setState(s => ({ ...s, isStreaming: false, isSearching: false }))
        onError?.((data.message as string) || '未知错误')
        break
    }
  }, [onError, onTopicExtracted, onTitleGenerated])

  // 连接 WebSocket
  const connect = useCallback(() => {
    // 如果已连接，不重复连接
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    // 如果正在连接中，也不重复
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return

    if (!sessionIdRef.current) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/chat/${sessionIdRef.current}`

    const ws = new WebSocket(wsUrl)

    // 关键修复：所有事件处理器都检查当前 ws 是否仍是活跃连接
    // 防止旧 WebSocket 的事件（尤其是 onclose）干扰新连接的状态
    ws.onopen = () => {
      if (wsRef.current !== ws) return // 已被替换，忽略
      console.log('[useChat] WebSocket 连接成功')
    }

    ws.onclose = (event) => {
      if (wsRef.current !== ws) {
        // 旧 WebSocket 的 close 事件，忽略以避免干扰当前连接
        console.log('[useChat] 旧 WebSocket close 事件已忽略, code:', event.code)
        return
      }
      console.log('[useChat] WebSocket 连接断开, code:', event.code)
      setState(s => ({ ...s, isConnected: false }))

      // 非正常关闭时尝试重连（正常关闭 1000/1001 不重连）
      if (event.code !== 1000 && event.code !== 1001) {
        reconnectTimerRef.current = window.setTimeout(() => {
          if (wsRef.current !== ws) return // 连接已被替换，不再重连
          console.log('[useChat] 尝试重连...')
          connect()
        }, 3000)
      }
    }

    ws.onerror = () => {
      if (wsRef.current !== ws) return // 已被替换，忽略
      console.error('[useChat] WebSocket 错误')
    }

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return // 已被替换，忽略
      try {
        const data = JSON.parse(event.data)
        handleMessage(data)
      } catch (e) {
        console.error('[useChat] 解析消息失败:', e)
      }
    }

    wsRef.current = ws
  }, [handleMessage])

  // 断开连接
  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close(1000)
      wsRef.current = null
    }
  }, [])

  // 发送消息
  const sendMessage = useCallback((content: string, enableSearch: boolean = false) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      onError?.('未连接到服务器')
      return
    }

    // 添加用户消息到本地列表
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
    }

    // 预创建 AI 消息占位
    const aiMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    }

    currentMessageRef.current = ''

    setState(s => ({
      ...s,
      messages: [...s.messages, userMessage, aiMessage],
      isStreaming: true,
    }))

    // 发送到服务端
    wsRef.current.send(JSON.stringify({
      type: 'message',
      content,
      enable_search: enableSearch,
    }))
  }, [onError])

  // 重置会话
  const resetSession = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reset' }))
    }
  }, [])

  // 提取选题
  const extractTopic = useCallback((enhanced: boolean = false) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'extract_topic',
        enhanced,
      }))
    }
  }, [])

  // 设置历史消息（从 API 加载）
  const setMessages = useCallback((messages: ChatMessage[]) => {
    setState(s => ({ ...s, messages }))
  }, [])

  // 设置选题就绪度（从外部缓存恢复时使用）
  const setTopicReadiness = useCallback((readiness: TopicReadiness | null) => {
    setState(s => ({ ...s, topicReadiness: readiness }))
  }, [])

  // 会话切换时重置聊天状态（防止旧消息残留到新会话）
  // 注意：topicReadiness 不在此处重置，由 BrainstormPage 负责缓存和恢复
  useEffect(() => {
    setState(s => ({
      ...s,
      messages: [],
      isConnected: false,
      isStreaming: false,
      isSearching: false,
      isEvaluating: false,
      searchQuery: '',
      searchResults: [],
    }))
  }, [sessionId])

  // 自动连接和清理
  useEffect(() => {
    if (sessionId) {
      connect()
    }
    return () => {
      disconnect()
    }
  }, [sessionId, connect, disconnect])

  return {
    messages: state.messages,
    isConnected: state.isConnected,
    isStreaming: state.isStreaming,
    isSearching: state.isSearching,
    isEvaluating: state.isEvaluating,
    topicReadiness: state.topicReadiness,
    searchQuery: state.searchQuery,
    searchResults: state.searchResults,
    sendMessage,
    resetSession,
    extractTopic,
    setMessages,
    setTopicReadiness,
    connect,
    disconnect,
  }
}
