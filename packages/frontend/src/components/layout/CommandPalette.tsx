import { useState, useEffect, useRef, useCallback } from 'react'
import { stripLeadingEmoji } from '@/lib/displayText'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Search, FileText, CheckSquare, StickyNote, Loader2, ArrowRight, Hash,
  LayoutDashboard, FolderOpen, LayoutTemplate, Settings, Sparkles, PenLine,
} from 'lucide-react'
import { searchApi, projectApi, type SearchResult } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { projectDisplayName } from '@/lib/projectName'
import { useLanguageStore } from '@/stores/languageStore'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

const TYPE_ICON: Record<SearchResult['type'], typeof FileText> = {
  page: FileText,
  task: CheckSquare,
  note: StickyNote,
}

// Подсветка совпадений в сниппете (маркеры ==текст==)
function HighlightedSnippet({ text }: { text: string }) {
  const parts = text.split(/(==.+?==)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('==') && part.endsWith('==')
          ? <mark key={i} className="bg-primary-500/30 text-primary-200 rounded-sm px-0.5 not-italic font-medium">{part.slice(2, -2)}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { language } = useLanguageStore()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { currentWorkspaceId } = useWorkspaceStore()
  const t = useT()

  const TYPE_LABEL: Record<SearchResult['type'], string> = {
    page: t.search.page,
    task: t.search.task,
    note: t.search.note,
  }

  const QUICK_ACTIONS: Array<{ id: string; label: string; icon: typeof Hash; to: string }> = [
    { id: 'dashboard', label: t.sidebar.dashboard, icon: LayoutDashboard, to: '/' },
    { id: 'graph', label: t.search.openGraph, icon: Hash, to: '/graph' },
    { id: 'files', label: t.sidebar.files, icon: FolderOpen, to: '/files' },
    { id: 'growth', label: t.sidebar.growth, icon: Sparkles, to: '/growth' },
    { id: 'canvas', label: t.sidebar.canvas, icon: PenLine, to: '/canvas' },
    { id: 'templates', label: t.sidebar.templates, icon: LayoutTemplate, to: '/templates' },
    { id: 'settings', label: t.sidebar.settings, icon: Settings, to: '/settings' },
  ]

  const { data: projects } = useQuery({
    queryKey: ['projects', currentWorkspaceId],
    queryFn: () => projectApi.listByWorkspace(currentWorkspaceId!),
    enabled: !!currentWorkspaceId,
    staleTime: 60_000,
  })
  const projectName = (id?: string) => id ? projectDisplayName(projects?.find((p) => p.id === id), language) : ''

  // Debounced поиск — только если есть запрос
  const { data, isFetching } = useQuery({
    queryKey: ['search', query, currentWorkspaceId],
    queryFn: () =>
      searchApi.search({
        q: query,
        workspaceId: currentWorkspaceId ?? undefined,
        limit: 20,
      }),
    enabled: open && query.trim().length >= 2,
    staleTime: 5_000,
  })

  const results = data?.results ?? []
  const q = query.trim().toLowerCase()
  const showQuickActions = q.length < 2

  // Quick actions are always available — when typing, filter them by label so
  // the palette doubles as a command launcher alongside content search.
  const matchedActions = showQuickActions
    ? QUICK_ACTIONS
    : QUICK_ACTIONS.filter((a) => a.label.toLowerCase().includes(q))

  type Item = { id: string; label: string; icon?: typeof Hash; type?: SearchResult['type']; snippet?: string; projectId?: string; action: () => void }
  const allItems: Item[] = [
    ...matchedActions.map((a) => ({
      id: `action:${a.id}`,
      label: a.label,
      icon: a.icon,
      action: () => { navigate(a.to); onClose() },
    })),
    ...(showQuickActions
      ? []
      : results.map((r) => ({
          id: r.id,
          label: stripLeadingEmoji(r.title),
          type: r.type,
          snippet: r.snippet,
          projectId: r.projectId,
          action: () => {
            if (r.type === 'page') navigate(`/pages/${r.id}`)
            else if (r.type === 'task') navigate(`/projects/${r.projectId}/tasks?taskId=${r.id}`)
            else if (r.type === 'note') navigate(`/workspaces/${r.workspaceId}/notes?noteId=${r.id}`)
            onClose()
          },
        }))),
    // Omnibox fallback: whatever was typed can always be handed to the assistant,
    // which interprets it (a question, a dated task, a note) and acts. Kept last so
    // it never hijacks the Enter default from search results / quick actions.
    ...(q.length >= 2
      ? [{
          id: 'ask-agent',
          label: t.search.askAgent.replace('{query}', query.trim()),
          icon: Sparkles,
          action: () => {
            document.dispatchEvent(new CustomEvent('ai:open', { detail: { prompt: query.trim() } }))
            onClose()
          },
        }]
      : []),
  ]

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => setActiveIndex(0), [query])

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => (i + 1) % Math.max(allItems.length, 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => (i - 1 + Math.max(allItems.length, 1)) % Math.max(allItems.length, 1)) }
      if (e.key === 'Enter' && allItems[activeIndex]) { allItems[activeIndex].action() }
    },
    [open, allItems, activeIndex, onClose],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-4 bg-surface-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          {isFetching ? (
            <Loader2 size={16} className="text-slate-400 animate-spin flex-shrink-0" />
          ) : (
            <Search size={16} className="text-slate-400 flex-shrink-0" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search.placeholder}
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto py-1">
          {showQuickActions && (
            <p className="px-4 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {t.search.quickActions}
            </p>
          )}

          {!showQuickActions && allItems.length === 0 && !isFetching && (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              {t.search.noResults.replace('{query}', query)}
            </p>
          )}

          {allItems.map((item, i) => {
            const Icon = item.type ? TYPE_ICON[item.type] : (item.icon ?? Hash)
            return (
              <button
                key={item.id}
                onClick={item.action}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  i === activeIndex ? 'bg-primary-600/20 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
                )}
              >
                <div className="flex-shrink-0">
                  <Icon size={15} className={cn(i === activeIndex ? 'text-primary-400' : 'text-slate-500')} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm truncate block text-slate-100">{item.label}</span>
                  {item.snippet && (
                    <span className="text-xs text-slate-500 truncate block mt-0.5">
                      <HighlightedSnippet text={item.snippet} />
                    </span>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.type && (
                      <span className="text-[10px] text-slate-600">{TYPE_LABEL[item.type]}</span>
                    )}
                    {item.projectId && projectName(item.projectId) && (
                      <span className="text-[10px] text-slate-600">· {projectName(item.projectId)}</span>
                    )}
                  </div>
                </div>
                <ArrowRight size={13} className={cn('flex-shrink-0 transition-opacity', i === activeIndex ? 'opacity-100' : 'opacity-0')} />
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-800 flex items-center gap-4 text-xs text-slate-600">
          <span><kbd className="bg-slate-800 px-1 rounded">↑↓</kbd> {t.search.navHint}</span>
          <span><kbd className="bg-slate-800 px-1 rounded">Enter</kbd> {t.search.selectHint}</span>
          <span><kbd className="bg-slate-800 px-1 rounded">ESC</kbd> {t.search.closeHint}</span>
        </div>
      </div>
    </div>
  )
}

/** Хук для глобального Ctrl+K */
export function useCommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return { open, setOpen }
}
