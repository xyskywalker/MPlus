/**
 * 加载状态组件
 * 显示各种加载动画
 */

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
}

// 旋转加载器
export function Spinner({ size = 'md' }: LoadingProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  }

  return (
    <div
      className={`${sizeClasses[size]} border-2 border-gray-200 dark:border-dark-600 border-t-primary-500 rounded-full animate-spin`}
    />
  )
}

// 跳动点加载器
export function LoadingDots() {
  return (
    <span className="loading-dots text-primary-500">
      <span />
      <span />
      <span />
    </span>
  )
}

// 页面级加载
export function PageLoading({ text = '加载中...' }: LoadingProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Spinner size="lg" />
      <p className="mt-4 text-gray-500 dark:text-gray-400">{text}</p>
    </div>
  )
}

// 骨架屏
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-gray-200 dark:bg-dark-700 rounded animate-pulse ${className}`}
    />
  )
}

// 卡片骨架屏
export function CardSkeleton() {
  return (
    <div className="card">
      <Skeleton className="h-4 w-1/4 mb-4" />
      <Skeleton className="h-6 w-3/4 mb-2" />
      <Skeleton className="h-4 w-1/2 mb-4" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-16" />
      </div>
    </div>
  )
}

export default function Loading({ size = 'md', text }: LoadingProps) {
  return (
    <div className="flex items-center space-x-2">
      <Spinner size={size} />
      {text && <span className="text-gray-500 dark:text-gray-400">{text}</span>}
    </div>
  )
}
