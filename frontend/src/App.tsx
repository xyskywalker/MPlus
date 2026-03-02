/**
 * MPlus 前端主应用组件
 * 提供路由配置和全局布局
 */

import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import BrainstormPage from './pages/BrainstormPage'
import TopicsPage from './pages/TopicsPage'
import SimulationPage from './pages/SimulationPage'
import AccountsPage from './pages/AccountsPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import Toast from './components/Toast'
import { PageLoading } from './components/Loading'
import { getAuthStatus } from './services/api'
import { useAuthStore } from './stores/authStore'

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated } = useAuthStore()
  const location = useLocation()

  if (!isAuthenticated) {
    const from = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from }} />
  }
  return children
}

function App() {
  const { isAuthenticated, authInitialized, setAuthState } = useAuthStore()

  useEffect(() => {
    let alive = true
    getAuthStatus()
      .then((status) => {
        if (!alive) return
        setAuthState(status.logged_in, status.username)
      })
      .catch(() => {
        if (!alive) return
        setAuthState(false, null)
      })
    return () => {
      alive = false
    }
  }, [setAuthState])

  if (!authInitialized) {
    return <PageLoading text="正在检查登录状态..." />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
        />

        <Route
          path="/"
          element={(
            <RequireAuth>
              <Layout />
            </RequireAuth>
          )}
        >
          <Route index element={<HomePage />} />
          <Route path="brainstorm" element={<BrainstormPage />} />
          <Route path="brainstorm/:sessionId" element={<BrainstormPage />} />
          <Route path="topics" element={<TopicsPage />} />
          <Route path="simulation" element={<SimulationPage />} />
          <Route path="simulation/:topicId" element={<SimulationPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to={isAuthenticated ? "/" : "/login"} replace />} />
      </Routes>
      <Toast />
    </BrowserRouter>
  )
}

export default App
