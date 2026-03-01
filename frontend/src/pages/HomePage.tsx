/**
 * 首页组件
 * 显示功能入口和状态概览
 */

import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getSystemStatus, getSessions, getPlatforms, type SystemStatus, type Session, type Platform } from '../services/api'
import { PageLoading } from '../components/Loading'
import { PlatformIcon } from '../components/PlatformIcons'

export default function HomePage() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusData, sessionsData, platformsData] = await Promise.all([
          getSystemStatus(),
          getSessions(5, 0),
          getPlatforms()
        ])
        setStatus(statusData)
        setSessions(sessionsData.items)
        setPlatforms(platformsData)
      } catch (err) {
        console.error('获取数据失败:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  if (loading) {
    return <PageLoading text="加载中..." />
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

  // 获取平台信息
  const getPlatformInfo = (code: string) => {
    return platforms.find((p) => p.code === code) || { name: '未知', icon: '📱', color: '#6366F1', code: '' }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero 区域 - 使用主视觉图片作为背景 */}
      <div 
        className="text-center py-12 rounded-2xl relative overflow-hidden"
        style={{
          backgroundImage: 'url(/main_visual.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center bottom',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {/* 半透明遮罩层，确保文字可读性 */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/90 via-white/70 to-white/50 dark:from-dark-800/90 dark:via-dark-800/70 dark:to-dark-800/50" />
        
        {/* 内容区域 */}
        <div className="relative z-10">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            ✨ 欢迎使用 百万加 MPlus
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
            AI驱动的自媒体选题和模拟预测智能体，助您打造爆款内容
          </p>
          <Link to="/brainstorm" className="btn-primary px-8 py-3 text-lg">
            开始头脑风暴
          </Link>
        </div>
      </div>

      {/* 系统状态 */}
      {status && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">系统状态</h3>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center">
              <span
                className={`w-2.5 h-2.5 rounded-full mr-2 ${
                  status.model_configured ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                模型服务:{' '}
                {status.model_configured
                  ? `已配置 ${status.model_count} 个${status.default_model_name ? ` (${status.default_model_name})` : ''}`
                  : '未配置'}
              </span>
            </div>
            <div className="flex items-center">
              <span
                className={`w-2.5 h-2.5 rounded-full mr-2 ${
                  status.search_configured ? 'bg-green-500' : 'bg-yellow-500'
                }`}
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                联网搜索: {status.search_configured ? '已配置' : '未配置（推荐开启）'}
              </span>
            </div>
          </div>
          {!status.model_configured && (
            <Link
              to="/settings"
              className="inline-block mt-4 text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              → 前往配置模型
            </Link>
          )}
        </div>
      )}

      {/* 快捷入口 */}
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">快捷入口</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link to="/brainstorm" className="card-hover group">
            <div className="text-4xl mb-4">💡</div>
            <h4 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 mb-2">
              头脑风暴
            </h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              与 AI 对话，打磨你的选题创意
            </p>
          </Link>

          <Link to="/topics" className="card-hover group">
            <div className="text-4xl mb-4">📋</div>
            <h4 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 mb-2">
              选题管理
            </h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              管理已创建的选题，运行模拟预测
            </p>
          </Link>

          <Link to="/settings" className="card-hover group">
            <div className="text-4xl mb-4">⚙️</div>
            <h4 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 mb-2">
              系统设置
            </h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              配置模型、联网搜索等系统参数
            </p>
          </Link>
        </div>
      </div>

      {/* 最近会话 */}
      {sessions.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">最近会话</h3>
            <Link
              to="/brainstorm"
              className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              查看全部 →
            </Link>
          </div>
          <div className="card divide-y divide-gray-100 dark:divide-dark-700">
            {sessions.map((session) => (
              <Link
                key={session.id}
                to={`/brainstorm/${session.id}`}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0 hover:bg-gray-50 dark:hover:bg-dark-700/50 -mx-4 px-4 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-xl">💬</span>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {session.title}
                    </p>
                    <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                      {session.platform_code && (
                        <span className="inline-flex items-center gap-1">
                          <PlatformIcon platformCode={session.platform_code} size={14} />
                          <span>{getPlatformInfo(session.platform_code).name}</span>
                        </span>
                      )}
                      <span>{formatTime(session.updated_at)}</span>
                    </div>
                  </div>
                </div>
                <span className="text-gray-400">→</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
