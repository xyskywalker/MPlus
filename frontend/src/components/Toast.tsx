/**
 * Toast 通知组件
 * 显示操作反馈消息
 */

import { useAppStore } from '../stores/appStore'

const iconMap = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
}

const colorMap = {
  success: 'bg-green-500',
  error: 'bg-red-500',
  warning: 'bg-yellow-500',
  info: 'bg-blue-500',
}

export default function Toast() {
  const { toast, hideToast } = useAppStore()

  if (!toast) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
      <div className={`flex items-center space-x-3 px-4 py-3 rounded-lg shadow-lg text-white ${colorMap[toast.type]}`}>
        <span className="text-lg">{iconMap[toast.type]}</span>
        <span className="text-sm font-medium">{toast.message}</span>
        <button
          onClick={hideToast}
          className="ml-2 hover:opacity-80 transition-opacity"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
