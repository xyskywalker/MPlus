/**
 * Markdown 渲染组件
 * 支持流式输出的实时渲染，使用 react-markdown + remark-gfm
 * 适配亮色/暗色主题，提供代码块复制功能
 */

import { memo, useMemo, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

interface MarkdownRendererProps {
  /** Markdown 文本内容 */
  content: string
  /** 是否为用户消息（影响配色主题） */
  isUser?: boolean
}

/**
 * 代码块复制按钮组件
 */
function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 降级：使用旧版 API
      const textarea = document.createElement('textarea')
      textarea.value = code
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [code])

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded text-xs
                 bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white
                 transition-all duration-200 opacity-0 group-hover:opacity-100"
      title="复制代码"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          已复制
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          复制
        </>
      )}
    </button>
  )
}

/**
 * 提取代码块子元素的纯文本内容
 */
function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return extractTextFromChildren((children as React.ReactElement).props.children)
  }
  return String(children ?? '')
}

/**
 * Markdown 渲染器主组件
 * 使用 memo 避免父组件无关更新导致的重渲染
 */
const MarkdownRenderer = memo(function MarkdownRenderer({ content, isUser = false }: MarkdownRendererProps) {
  // 缓存 remark 插件数组，避免每次渲染重新创建导致 react-markdown 重解析
  const remarkPlugins = useMemo(() => [remarkGfm], [])

  // 自定义渲染组件 — 根据消息类型适配不同配色
  const components = useMemo<Components>(() => ({
    // 代码块 & 行内代码
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      const isBlock = match || (typeof children === 'string' && children.includes('\n'))

      if (isBlock) {
        // 多行代码块
        const codeText = extractTextFromChildren(children).replace(/\n$/, '')
        return (
          <div className="group relative my-3 rounded-lg overflow-hidden">
            {/* 语言标签 */}
            {match && (
              <div className="flex items-center justify-between px-4 py-1.5 bg-gray-700 dark:bg-gray-900 text-gray-400 text-xs">
                <span>{match[1]}</span>
              </div>
            )}
            <pre className="bg-gray-800 dark:bg-gray-900 p-4 overflow-x-auto text-sm leading-relaxed">
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
            <CopyButton code={codeText} />
          </div>
        )
      }

      // 行内代码
      return (
        <code
          className={`px-1.5 py-0.5 rounded text-[0.85em] font-mono ${
            isUser
              ? 'bg-white/20 text-white'
              : 'bg-gray-200 dark:bg-dark-600 text-primary-600 dark:text-primary-400'
          }`}
          {...props}
        >
          {children}
        </code>
      )
    },

    // 段落 — 防止嵌套 <p> 导致 hydration 警告
    p({ children }) {
      return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
    },

    // 标题
    h1({ children }) {
      return <h1 className="text-lg font-bold mt-4 mb-2 first:mt-0">{children}</h1>
    },
    h2({ children }) {
      return <h2 className="text-base font-bold mt-3 mb-2 first:mt-0">{children}</h2>
    },
    h3({ children }) {
      return <h3 className="text-sm font-bold mt-3 mb-1.5 first:mt-0">{children}</h3>
    },
    h4({ children }) {
      return <h4 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h4>
    },

    // 列表
    ul({ children }) {
      return <ul className="list-disc list-outside pl-5 mb-2 space-y-0.5">{children}</ul>
    },
    ol({ children }) {
      return <ol className="list-decimal list-outside pl-5 mb-2 space-y-0.5">{children}</ol>
    },
    li({ children }) {
      return <li className="leading-relaxed">{children}</li>
    },

    // 引用块
    blockquote({ children }) {
      return (
        <blockquote
          className={`border-l-3 pl-3 my-2 italic ${
            isUser
              ? 'border-white/40 text-white/80'
              : 'border-primary-300 dark:border-primary-600 text-gray-600 dark:text-gray-400'
          }`}
        >
          {children}
        </blockquote>
      )
    },

    // 分割线
    hr() {
      return (
        <hr
          className={`my-3 border-t ${
            isUser ? 'border-white/20' : 'border-gray-200 dark:border-dark-600'
          }`}
        />
      )
    },

    // 链接
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`underline decoration-1 underline-offset-2 ${
            isUser
              ? 'text-white hover:text-white/80'
              : 'text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300'
          } transition-colors`}
        >
          {children}
        </a>
      )
    },

    // 加粗
    strong({ children }) {
      return <strong className="font-semibold">{children}</strong>
    },

    // 表格
    table({ children }) {
      return (
        <div className="my-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-dark-600">
          <table className="min-w-full text-sm">{children}</table>
        </div>
      )
    },
    thead({ children }) {
      return (
        <thead className={`${
          isUser ? 'bg-white/10' : 'bg-gray-50 dark:bg-dark-700'
        }`}>
          {children}
        </thead>
      )
    },
    th({ children }) {
      return (
        <th className="px-3 py-2 text-left font-semibold border-b border-gray-200 dark:border-dark-600">
          {children}
        </th>
      )
    },
    td({ children }) {
      return (
        <td className="px-3 py-2 border-b border-gray-100 dark:border-dark-700">
          {children}
        </td>
      )
    },
  }), [isUser])

  // 内容为空时不渲染
  if (!content) return null

  return (
    <div className={`markdown-body text-sm ${isUser ? 'markdown-user' : 'markdown-assistant'}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownRenderer
