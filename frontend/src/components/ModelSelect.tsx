/**
 * 模型选择下拉组件
 * 用于头脑风暴和模拟预测页面选择 LLM 模型
 * 默认选中系统设置的默认模型，支持用户切换
 */

import { useState, useEffect, useRef } from 'react'
import { getModelConfigs, type ModelConfig } from '../services/api'
import { useAppStore } from '../stores/appStore'

interface ModelSelectProps {
  /** 当前选中的模型配置 ID */
  value: string | null
  /** 选择变更回调 */
  onChange: (configId: string) => void
  /** 尺寸 */
  size?: 'sm' | 'md'
  /** 自定义类名 */
  className?: string
}

export default function ModelSelect({
  value,
  onChange,
  size = 'sm',
  className = '',
}: ModelSelectProps) {
  const { appOptions } = useAppStore()
  const MODEL_TYPE_INFO = appOptions.model_types

  const [configs, setConfigs] = useState<ModelConfig[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 })

  // 获取模型类型的样式信息
  const getTypeInfo = (type: string) => {
    return MODEL_TYPE_INFO[type as keyof typeof MODEL_TYPE_INFO] || MODEL_TYPE_INFO.openai
  }

  // 加载模型配置列表
  useEffect(() => {
    const fetchConfigs = async () => {
      try {
        const data = await getModelConfigs()
        setConfigs(data)

        // 如果当前没有选中值，自动选中默认模型
        if (!value && data.length > 0) {
          const defaultConfig = data.find((c) => c.is_default)
          if (defaultConfig) {
            onChange(defaultConfig.id)
          } else {
            onChange(data[0].id)
          }
        }
      } catch (err) {
        console.error('获取模型配置失败:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchConfigs()
  }, [])

  // 打开菜单时计算位置
  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 220),
      })
    }
    setOpen(true)
  }

  // 当前选中的模型
  const selectedConfig = configs.find((c) => c.id === value)

  // 尺寸样式
  const sizeStyles = {
    sm: 'px-2.5 py-1.5 text-sm',
    md: 'px-3 py-2 text-sm',
  }

  // 无模型配置时的提示
  if (!loading && configs.length === 0) {
    return (
      <div className={`flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 ${className}`}>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <span>未配置模型</span>
      </div>
    )
  }

  return (
    <>
      {/* 选择按钮 */}
      <button
        ref={btnRef}
        onClick={handleOpen}
        disabled={loading}
        className={`flex items-center gap-2 rounded-lg border border-gray-200 dark:border-dark-600 bg-white dark:bg-dark-700 hover:border-primary-400 dark:hover:border-primary-500 transition-colors ${sizeStyles[size]} ${className}`}
      >
        {loading ? (
          <span className="text-gray-400">加载中...</span>
        ) : selectedConfig ? (
          <>
            {/* 模型类型指示点 */}
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getTypeInfo(selectedConfig.model_type).color}`} />
            {/* 模型名称 */}
            <span className="text-gray-700 dark:text-gray-300 truncate">
              {selectedConfig.name}
            </span>
            {/* 默认标识 */}
            {!!selectedConfig.is_default && (
              <span className="text-[10px] px-1 py-0 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 flex-shrink-0">
                默认
              </span>
            )}
          </>
        ) : (
          <span className="text-gray-400">选择模型</span>
        )}
        <svg className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 下拉菜单 - fixed 定位避免被裁切 */}
      {open && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[9999] bg-white dark:bg-dark-700 border border-gray-200 dark:border-dark-600 rounded-lg shadow-xl py-1 max-h-64 overflow-y-auto"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          >
            {configs.map((config) => {
              const typeInfo = getTypeInfo(config.model_type)
              return (
                <button
                  key={config.id}
                  onClick={() => {
                    onChange(config.id)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                    value === config.id
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-dark-600'
                  }`}
                >
                  {/* 模型类型指示点 */}
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${typeInfo.color}`} />
                  {/* 模型信息 */}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{config.name}</span>
                      {!!config.is_default && (
                        <span className="text-[10px] px-1 py-0 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 flex-shrink-0">
                          默认
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {typeInfo.label} · {config.model_name}
                    </div>
                  </div>
                  {/* 选中勾号 */}
                  {value === config.id && (
                    <svg className="w-4 h-4 text-primary-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
