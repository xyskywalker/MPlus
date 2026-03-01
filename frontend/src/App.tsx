/**
 * MPlus 前端主应用组件
 * 提供路由配置和全局布局
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import BrainstormPage from './pages/BrainstormPage'
import TopicsPage from './pages/TopicsPage'
import SimulationPage from './pages/SimulationPage'
import AccountsPage from './pages/AccountsPage'
import SettingsPage from './pages/SettingsPage'
import Toast from './components/Toast'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="brainstorm" element={<BrainstormPage />} />
          <Route path="brainstorm/:sessionId" element={<BrainstormPage />} />
          <Route path="topics" element={<TopicsPage />} />
          <Route path="simulation" element={<SimulationPage />} />
          <Route path="simulation/:topicId" element={<SimulationPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toast />
    </BrowserRouter>
  )
}

export default App
