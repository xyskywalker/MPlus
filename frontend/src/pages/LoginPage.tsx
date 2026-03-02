/**
 * 登录页（单用户）
 */

import { FormEvent, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { login } from '../services/api'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'

interface LocationState {
  from?: string
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setAuthState } = useAuthStore()
  const { showToast } = useAppStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const redirectTo = useMemo(() => {
    const state = location.state as LocationState | null
    return state?.from || '/'
  }, [location.state])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await login(username.trim(), password)
      setAuthState(true, data.username)
      showToast('success', '登录成功')
      navigate(redirectTo, { replace: true })
    } catch {
      setError('登录失败')
      showToast('error', '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-dark-900 px-4">
      <div className="w-full max-w-md card shadow-lg">
        <div className="text-center mb-6">
          <img src="/mplus_icon.png" alt="MPlus" className="w-14 h-14 mx-auto rounded-xl mb-3" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">登录 MPlus</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            请输入用户名和密码
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              用户名
            </label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={loading}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              密码
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}
