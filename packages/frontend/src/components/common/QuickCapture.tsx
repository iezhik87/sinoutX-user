import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Loader2, StickyNote, CheckSquare, X, Zap, FolderKanban, Sparkles } from 'lucide-react'
import { noteApi, taskApi, projectApi } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUIStore } from '@/stores/uiStore'
import { toast } from '@/stores/toastStore'
import { useT } from '@/i18n'
import { systemProjectName } from '@/lib/projectName'
import { useLanguageStore } from '@/stores/languageStore'

type Mode = 'note' | 'task' | 'ask'

export function QuickCapture() {
  const { language } = useLanguageStore()
  const { quickCaptureOpen, setQuickCaptureOpen } = useUIStore()
  const { currentWorkspaceId, currentProjectId } = useWorkspaceStore()
  const qc = useQueryClient()
  const t = useT()

  const [mode, setMode] = useState<Mode>('note')
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: currentProject } = useQuery({
    queryKey: ['project', currentProjectId],
    queryFn: () => projectApi.getById(currentProjectId!),
    enabled: !!currentProjectId,
    staleTime: 60_000,
  })

  // Fallback so a task never gets blocked for lack of an open project: when none
  // is active it lands in the workspace's system "Inbox".
  const { data: wsProjects } = useQuery({
    queryKey: ['projects', currentWorkspaceId],
    queryFn: () => projectApi.listByWorkspace(currentWorkspaceId!),
    enabled: !!currentWorkspaceId && quickCaptureOpen,
    staleTime: 60_000,
  })
  const inboxProject = wsProjects?.find((p) => p.isSystem)
  const taskProjectId = currentProjectId ?? inboxProject?.id ?? null

  useEffect(() => {
    if (quickCaptureOpen) {
      setText('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [quickCaptureOpen])

  const createNote = useMutation({
    mutationFn: () =>
      noteApi.create({
        workspaceId: currentWorkspaceId!,
        projectId: currentProjectId ?? undefined,
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
        tags: ['quick-capture'],
        pinned: false,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] })
      toast.success(t.common.success)
      setQuickCaptureOpen(false)
    },
    onError: () => toast.error(t.common.error),
  })

  const createTask = useMutation({
    mutationFn: () =>
      taskApi.create({
        projectId: taskProjectId!,
        title: text,
        status: 'TODO',
        priority: 'MEDIUM',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['tasks-calendar'] })
      toast.success(t.common.success)
      setQuickCaptureOpen(false)
    },
    onError: () => toast.error(t.common.error),
  })

  const isPending = createNote.isPending || createTask.isPending

  // "Ask" hands the raw text to the assistant, which parses dates/intent and files
  // it into the right place — no manual note/task/project decision required.
  function askAgent() {
    document.dispatchEvent(new CustomEvent('ai:open', { detail: { prompt: text.trim() } }))
    setQuickCaptureOpen(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    if (mode === 'ask') {
      askAgent()
    } else if (mode === 'note') {
      if (!currentWorkspaceId) { toast.error(t.quickCapture.noWorkspace); return }
      createNote.mutate()
    } else {
      if (!taskProjectId) { toast.error(t.quickCapture.noProject); return }
      createTask.mutate()
    }
  }

  if (!quickCaptureOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm px-4 animate-fade-in"
      onClick={() => setQuickCaptureOpen(false)}
    >
      <div
        className="w-full max-w-md bg-surface-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: title row + a full-width segmented mode switch below, so all
            three modes stay legible even on a narrow phone modal. */}
        <div className="px-4 pt-3 pb-2.5 border-b border-slate-800">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-primary-400" />
              <span className="text-sm font-medium text-slate-200">{t.quickCapture.title}</span>
            </div>
            <button
              onClick={() => setQuickCaptureOpen(false)}
              className="text-slate-500 hover:text-slate-200 transition-colors p-1 -mr-1"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center gap-1 p-0.5 bg-surface-950 rounded-lg">
            {([
              { m: 'note' as Mode, icon: StickyNote, label: t.quickCapture.noteMode },
              { m: 'task' as Mode, icon: CheckSquare, label: t.quickCapture.taskMode },
              { m: 'ask' as Mode, icon: Sparkles, label: t.quickCapture.askMode },
            ]).map(({ m, icon: Icon, label }) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === m
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent) }
              if (e.key === 'Escape') setQuickCaptureOpen(false)
            }}
            placeholder={mode === 'note' ? t.quickCapture.notePlaceholder : mode === 'task' ? t.quickCapture.taskPlaceholder : t.quickCapture.askPlaceholder}
            rows={mode === 'task' ? 1 : 3}
            className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm
                       text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500
                       resize-none"
          />

          <div className="flex items-center justify-between mt-3">
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] text-slate-600">
                {mode === 'note'
                  ? currentWorkspaceId ? t.quickCapture.noteHint : t.quickCapture.noWorkspace
                  : mode === 'ask'
                    ? t.quickCapture.askHint
                    : taskProjectId ? t.quickCapture.taskHint : t.quickCapture.noProject
                }
              </p>
              {mode === 'task' && currentProject && (
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <FolderKanban size={10} className="text-slate-600" />
                  {currentProject.isSystem ? systemProjectName(language) : currentProject.name}
                </span>
              )}
              {mode === 'task' && !currentProjectId && inboxProject && (
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <FolderKanban size={10} className="text-slate-600" />
                  {t.quickCapture.toInbox}
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={!text.trim() || isPending}
              className="btn-primary text-xs h-8 px-3"
            >
              {isPending ? <Loader2 size={12} className="animate-spin" /> : mode === 'note' ? t.quickCapture.save : mode === 'ask' ? t.quickCapture.send : t.quickCapture.createTask}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
