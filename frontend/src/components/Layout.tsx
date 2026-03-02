/**
 * 全局布局组件
 * 包含导航栏和主内容区
 * 负责加载全局配置（应用选项）
 */

import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { getAppOptions, logout } from '../services/api'
import { useAppStore } from '../stores/appStore'
import { useAuthStore } from '../stores/authStore'
import { APP_VERSION, APP_NAME, APP_TAGLINE, GITHUB_URL, LICENSE_URL, LICENSE_NAME, RIPPLE_URL } from '../config'

// 读取 cookie 中保存的主题偏好
function getThemeFromCookie(): boolean {
  const match = document.cookie.match(/(?:^|;\s*)theme=(dark|light)/)
  return match ? match[1] === 'dark' : false
}

// 将主题偏好写入 cookie（有效期 365 天）
function setThemeCookie(isDark: boolean) {
  const value = isDark ? 'dark' : 'light'
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `theme=${value}; path=/; expires=${expires}; SameSite=Lax`
}

export default function Layout() {
  const navigate = useNavigate()
  const [isDark, setIsDark] = useState(() => {
    // 初始化时从 cookie 读取主题偏好
    const saved = getThemeFromCookie()
    // 同步 DOM 状态，确保首次渲染就应用正确主题
    if (saved) {
      document.documentElement.classList.add('dark')
    }
    return saved
  })
  const { setAppOptions, appOptionsLoaded, showToast } = useAppStore()
  const { username, clearAuthState } = useAuthStore()

  // 加载应用选项配置
  useEffect(() => {
    if (!appOptionsLoaded) {
      getAppOptions()
        .then(setAppOptions)
        .catch((err) => {
          console.error('加载应用选项配置失败:', err)
          // 失败时使用默认配置（已在 Store 中设置）
        })
    }
  }, [appOptionsLoaded, setAppOptions])

  // 切换主题并持久化到 cookie
  const toggleTheme = () => {
    const newDark = !isDark
    setIsDark(newDark)
    setThemeCookie(newDark)
    document.documentElement.classList.toggle('dark')
  }

  // 导航链接样式
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium px-3 py-2 rounded-lg transition-colors ${
      isActive
        ? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20'
        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-800'
    }`

  const handleLogout = async () => {
    try {
      await logout()
    } catch (err) {
      console.error('注销失败:', err)
    } finally {
      clearAuthState()
      showToast('info', '已注销')
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-dark-900 overflow-hidden">
      {/* 顶部导航栏 — 固定 */}
      <header className="flex-shrink-0 bg-white/80 dark:bg-dark-800/80 backdrop-blur-md border-b border-gray-200 dark:border-dark-700 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo - 使用项目主视觉 icon */}
            <NavLink to="/" className="flex items-center space-x-2">
              <img src="/mplus_icon.png" alt="MPlus" className="w-8 h-8 rounded-lg" />
              <span className="text-xl font-bold bg-gradient-to-r from-primary-600 to-purple-600 bg-clip-text text-transparent">
                百万加 MPlus
              </span>
            </NavLink>

            {/* 导航链接 */}
            <nav className="hidden md:flex items-center space-x-1">
              <NavLink to="/" className={navLinkClass} end>
                首页
              </NavLink>
              <NavLink to="/brainstorm" className={navLinkClass}>
                头脑风暴
              </NavLink>
              <NavLink to="/topics" className={navLinkClass}>
                选题管理
              </NavLink>
              <NavLink to="/simulation" className={navLinkClass}>
                模拟预测
              </NavLink>
              <NavLink to="/accounts" className={navLinkClass}>
                平台账号
              </NavLink>
              <NavLink to="/settings" className={navLinkClass}>
                设置
              </NavLink>
            </nav>

            {/* 右侧工具栏 */}
            <div className="flex items-center space-x-1">
              <span className="hidden lg:inline text-sm text-gray-500 dark:text-gray-400 mr-1">
                {username || ''}
              </span>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-800 transition-colors"
                title="注销登录"
              >
                注销
              </button>
              {/* Ripple 模拟引擎链接 */}
              <a
                href={RIPPLE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-800 transition-colors"
                title="模拟引擎 Ripple（涟漪）"
              >
                <span className="text-base leading-none">🌊</span>
              </a>
              {/* GitHub 仓库链接 */}
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-800 transition-colors"
                title={`GitHub · ${LICENSE_NAME}`}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
              </a>
              {/* 主题切换 */}
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-800 transition-colors"
                title="切换主题"
              >
                {isDark ? '☀️' : '🌙'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 主内容区 — 中间滚动 */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Outlet />
        </div>
      </main>

      {/* 底部 — 固定 */}
      <footer className="flex-shrink-0 bg-white dark:bg-dark-800 border-t border-gray-200 dark:border-dark-700 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            {APP_NAME} {APP_VERSION} - {APP_TAGLINE}
            <span className="mx-1.5">·</span>
            <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-primary-500 transition-colors">
              {LICENSE_NAME}
            </a>
            <span className="mx-1.5">·</span>
            模拟引擎来自
            <a href={RIPPLE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-primary-500 transition-colors">
              Ripple（涟漪）
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}
