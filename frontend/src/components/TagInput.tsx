/**
 * 标签输入组件
 * 支持自由输入新标签、从候选列表中选择、删除已有标签
 * 支持粘贴自媒体格式标签（如 #标签1 #标签2）自动解析
 * 用于子分类、内容标签等场景
 */

import { useState, useRef, useEffect, useCallback } from 'react'

interface TagInputProps {
  /** 当前已选择的标签列表 */
  value: string[]
  /** 标签变更回调 */
  onChange: (tags: string[]) => void
  /** 候选推荐标签（下拉显示） */
  suggestions?: string[]
  /** 输入框占位文字 */
  placeholder?: string
  /** 最大标签数量限制 */
  maxTags?: number
  /** 是否禁用 */
  disabled?: boolean
}

/**
 * 解析粘贴文本中的标签
 * 支持多种格式：
 *   - #标签1 #标签2 #标签3（自媒体格式）
 *   - 标签1, 标签2, 标签3（逗号分隔）
 *   - 标签1 标签2 标签3（空格分隔，仅当无 # 和逗号时）
 * 返回去重后的标签数组
 */
function parsePastedTags(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  let raw: string[] = []

  // 检测是否包含 # 号（自媒体标签格式）
  if (trimmed.includes('#')) {
    // 匹配所有 #xxx 形式的标签（支持中英文、数字、下划线等）
    const matches = trimmed.match(/#([^\s#]+)/g)
    if (matches) {
      raw = matches.map((m) => m.replace(/^#/, '').trim())
    }
  } else if (trimmed.includes(',') || trimmed.includes('，')) {
    // 逗号分隔（中英文逗号都支持）
    raw = trimmed.split(/[,，]/).map((s) => s.trim())
  } else {
    // 普通空格分隔
    raw = trimmed.split(/\s+/).map((s) => s.trim())
  }

  // 去掉空字符串、去重
  return [...new Set(raw.filter(Boolean))]
}

export default function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = '输入标签后回车添加，支持粘贴 #标签 格式',
  maxTags = 20,
  disabled = false,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  // 粘贴成功后的提示信息
  const [pasteHint, setPasteHint] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 过滤候选标签：排除已选择的，匹配输入内容
  const filteredSuggestions = suggestions.filter(
    (s) => !value.includes(s) && (inputValue === '' || s.includes(inputValue))
  )

  // 批量添加标签（返回实际新增数量）
  const addTags = useCallback((tags: string[]): number => {
    const remaining = maxTags - value.length
    if (remaining <= 0) return 0

    // 去掉每个标签的 # 前缀（以防万一）、去重、排除已有
    const newTags = tags
      .map((t) => t.replace(/^#/, '').trim())
      .filter((t) => t && !value.includes(t))
    // 去重
    const unique = [...new Set(newTags)]
    // 截取剩余可添加数量
    const toAdd = unique.slice(0, remaining)
    if (toAdd.length === 0) return 0

    onChange([...value, ...toAdd])
    return toAdd.length
  }, [value, maxTags, onChange])

  // 添加单个标签
  const addTag = (tag: string) => {
    const trimmed = tag.replace(/^#/, '').trim()
    if (!trimmed) return
    if (value.includes(trimmed)) return
    if (value.length >= maxTags) return

    onChange([...value, trimmed])
    setInputValue('')
    setShowDropdown(false)
    inputRef.current?.focus()
  }

  // 删除标签
  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  // 粘贴事件处理：拦截粘贴内容，自动解析标签
  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return

    // 检测是否包含多个标签的特征（# 号、逗号、多个空格分隔的词）
    const hasHashtags = text.includes('#')
    const hasComma = text.includes(',') || text.includes('，')
    const wordCount = text.trim().split(/\s+/).length

    // 只有当看起来像批量标签时才拦截粘贴行为
    if (hasHashtags || hasComma || wordCount >= 3) {
      e.preventDefault()
      const parsed = parsePastedTags(text)
      if (parsed.length > 0) {
        const added = addTags(parsed)
        setInputValue('')
        // 显示粘贴结果提示
        if (added > 0) {
          const skipped = parsed.length - added
          const msg = skipped > 0
            ? `已添加 ${added} 个标签，${skipped} 个重复/超出`
            : `已添加 ${added} 个标签`
          setPasteHint(msg)
        } else {
          setPasteHint('标签已存在或已达上限')
        }
      }
    }
    // 如果只是普通单词粘贴，不拦截，让默认行为处理
  }

  // 粘贴提示自动消失
  useEffect(() => {
    if (!pasteHint) return
    const timer = setTimeout(() => setPasteHint(''), 3000)
    return () => clearTimeout(timer)
  }, [pasteHint])

  // 键盘事件处理
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag(inputValue)
    } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
      // 输入框为空时按退格键删除最后一个标签
      removeTag(value.length - 1)
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    }
  }

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      {/* 标签容器 + 输入框 */}
      <div
        className={`flex flex-wrap items-center gap-1.5 p-2 min-h-[42px] rounded-lg border transition-colors
          ${disabled ? 'bg-gray-100 dark:bg-dark-700 cursor-not-allowed' : 'bg-white dark:bg-dark-800 cursor-text'}
          border-gray-300 dark:border-dark-600 focus-within:border-primary-500 dark:focus-within:border-primary-500`}
        onClick={() => !disabled && inputRef.current?.focus()}
      >
        {/* 已选标签 */}
        {value.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-sm
              bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removeTag(index)
                }}
                className="hover:text-primary-900 dark:hover:text-primary-200 text-xs leading-none"
              >
                ×
              </button>
            )}
          </span>
        ))}

        {/* 输入框 */}
        {!disabled && value.length < maxTags && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value)
              setShowDropdown(true)
            }}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={value.length === 0 ? placeholder : '继续添加...'}
            className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm
              text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
          />
        )}
      </div>

      {/* 粘贴结果提示 */}
      {pasteHint && (
        <div className="flex items-center gap-1.5 mt-1 text-xs text-green-600 dark:text-green-400 animate-pulse">
          <span>✅</span> {pasteHint}
        </div>
      )}

      {/* 候选标签下拉 */}
      {showDropdown && filteredSuggestions.length > 0 && !disabled && (
        <div className="absolute z-50 w-full mt-1 py-1 bg-white dark:bg-dark-800 border border-gray-200 dark:border-dark-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          <div className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500">推荐标签</div>
          {filteredSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addTag(suggestion)}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300
                hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* 底部信息栏 */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          支持粘贴 #标签1 #标签2 格式，自动识别
        </span>
        {value.length > 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {value.length}/{maxTags}
          </span>
        )}
      </div>
    </div>
  )
}
