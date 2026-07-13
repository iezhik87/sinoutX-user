import { useEffect, useRef, useState } from 'react'
import { SLASH_COMMANDS, type SlashCommandItem } from './extensions/SlashCommand'
import { cn } from '@/lib/utils'
import { useLanguageStore } from '@/stores/languageStore'
import { useT } from '@/i18n/useT'
import { renderIcon } from '@/components/common/EmojiPicker'

interface SlashCommandMenuProps {
  query: string
  position: { x: number; y: number }
  onSelect: (item: SlashCommandItem) => void
  onClose: () => void
}

export function SlashCommandMenu({ query, position, onSelect, onClose }: SlashCommandMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const { language } = useLanguageStore()
  const t = useT()

  const getTitle = (cmd: SlashCommandItem) =>
    language === 'be' ? (cmd.title_be ?? cmd.title) :
    language === 'en' ? (cmd.title_en ?? cmd.title) :
    cmd.title
  const getDesc = (cmd: SlashCommandItem) =>
    language === 'be' ? (cmd.description_be ?? cmd.description) :
    language === 'en' ? (cmd.description_en ?? cmd.description) :
    cmd.description

  const filtered = SLASH_COMMANDS.filter(
    (cmd) =>
      getTitle(cmd).toLowerCase().includes(query.toLowerCase()) ||
      getDesc(cmd).toLowerCase().includes(query.toLowerCase()),
  )

  // Reset selection when query changes
  useEffect(() => setActiveIndex(0), [query])

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[activeIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setActiveIndex((i) => (i + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (filtered[activeIndex]) onSelect(filtered[activeIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler, true) // capture phase
    return () => document.removeEventListener('keydown', handler, true)
  }, [filtered, activeIndex, onSelect, onClose])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  if (filtered.length === 0) return null

  // Не выходим за правый край экрана
  const menuWidth = 256
  const safeLeft = Math.min(position.x, window.innerWidth - menuWidth - 8)

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left: safeLeft, top: position.y }}
      className="z-50 w-64 bg-surface-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-fade-in"
    >
      <div className="px-3 py-2 border-b border-slate-800">
        <p className="text-xs text-slate-500">{t.editor.commands} {query && <span className="text-primary-400">— {query}</span>}</p>
      </div>
      <div ref={listRef} className="max-h-72 overflow-y-auto p-1">
        {filtered.map((cmd, i) => (
          <button
            key={cmd.title}
            onClick={() => onSelect(cmd)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
              i === activeIndex ? 'bg-primary-600/20 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
            )}
          >
            <span className="w-8 h-8 flex-shrink-0 bg-slate-800 rounded-md flex items-center justify-center text-xs font-mono text-slate-300">
              {cmd.icon.startsWith('lucide:') ? renderIcon(cmd.icon, 15, 'text-slate-300') : cmd.icon}
            </span>
            <div>
              <p className="text-sm font-medium leading-none">{getTitle(cmd)}</p>
              <p className="text-xs text-slate-500 mt-0.5">{getDesc(cmd)}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
