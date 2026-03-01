/**
 * 平台选择组件
 * 显示平台图标+文字选择器
 */

import { PlatformIcon } from './PlatformIcons'

interface Platform {
  code: string
  name: string
  icon: string
  color: string
}

interface PlatformSelectProps {
  platforms: Platform[]
  value: string
  onChange: (code: string) => void
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  disabled?: boolean
}

const iconSizes = {
  sm: 20,
  md: 24,
  lg: 28,
}

export default function PlatformSelect({ 
  platforms, 
  value, 
  onChange, 
  size = 'md',
  showLabel = true,
  disabled = false,
}: PlatformSelectProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {platforms.map((platform) => (
        <button
          key={platform.code}
          onClick={() => !disabled && onChange(platform.code)}
          disabled={disabled}
          className={`
            px-3 py-2 rounded-lg flex items-center gap-2
            transition-all duration-200
            ${disabled
              ? value === platform.code
                ? 'bg-primary-100 dark:bg-primary-900/30 ring-2 ring-primary-500 opacity-80 cursor-not-allowed'
                : 'hidden'
              : value === platform.code
                ? 'bg-primary-100 dark:bg-primary-900/30 ring-2 ring-primary-500'
                : 'bg-gray-100 dark:bg-dark-700 hover:bg-gray-200 dark:hover:bg-dark-600'
            }
          `}
          title={platform.name}
        >
          <PlatformIcon platformCode={platform.code} size={iconSizes[size]} />
          {showLabel && (
            <span className={`text-sm font-medium ${
              value === platform.code 
                ? 'text-primary-700 dark:text-primary-400' 
                : 'text-gray-700 dark:text-gray-300'
            }`}>
              {platform.name}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// 紧凑型平台标签（带图标+文字）
export function PlatformTag({ platform }: { platform: Platform }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium gap-1"
      style={{ backgroundColor: `${platform.color}20`, color: platform.color }}
    >
      <PlatformIcon platformCode={platform.code} size={14} />
      {platform.name}
    </span>
  )
}

// 带图标+文字的平台显示组件（用于各页面统一显示）
export function PlatformDisplay({ 
  platformCode, 
  platformName, 
  platformColor,
  size = 'md' 
}: { 
  platformCode: string
  platformName: string
  platformColor: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizes = {
    sm: { icon: 16, text: 'text-xs' },
    md: { icon: 20, text: 'text-sm' },
    lg: { icon: 24, text: 'text-base' },
  }
  
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded gap-1.5 ${sizes[size].text} font-medium`}
      style={{ backgroundColor: `${platformColor}20`, color: platformColor }}
    >
      <PlatformIcon platformCode={platformCode} size={sizes[size].icon} />
      {platformName}
    </span>
  )
}
