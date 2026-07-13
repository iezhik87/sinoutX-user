import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BrainCircuit, Loader2, Trash2 } from 'lucide-react'
import { pageApi } from '@/api/client'
import { Header } from '@/components/layout/Header'
import { BlockEditor } from '@/components/editor/BlockEditor'
import { useT } from '@/i18n'

const EMPTY_DOC = { type: 'doc', content: [] }

export function ProjectMemoryPage() {
  const t = useT()
  const qc = useQueryClient()
  const { projectId } = useParams<{ projectId: string }>()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editingRef = useRef(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastStampRef = useRef<string | null>(null)
  const [editorKey, setEditorKey] = useState(0)

  const { data: page, isLoading } = useQuery({
    queryKey: ['memory-page', projectId],
    queryFn: () => pageApi.getMemoryPage(projectId!),
    enabled: !!projectId,
    // Don't refetch on focus — that would reset the editor and silently drop
    // manual edits. External updates (e.g. the Telegram assistant) arrive via
    // the realtime WS, which invalidates this query; the effect below remounts
    // the editor with the new content unless the user is actively editing.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })

  // Reflect external updates: when the page changes (new updatedAt) and the user
  // isn't mid-edit, remount the editor so the fresh content shows immediately.
  useEffect(() => {
    const stamp = (page as { updatedAt?: string } | undefined)?.updatedAt ?? null
    if (!stamp) return
    if (lastStampRef.current === null) { lastStampRef.current = stamp; return }
    if (stamp !== lastStampRef.current) {
      lastStampRef.current = stamp
      if (!editingRef.current) setEditorKey((k) => k + 1)
    }
  }, [page])

  const saveMutation = useMutation({
    mutationFn: (content: Record<string, unknown>) =>
      pageApi.update(page!.id, { content }),
  })

  const clearMutation = useMutation({
    mutationFn: () => pageApi.update(page!.id, { content: EMPTY_DOC }),
    onSuccess: () => {
      qc.setQueryData(['memory-page', projectId], (p: typeof page) => p ? { ...p, content: EMPTY_DOC } : p)
      setEditorKey((k) => k + 1) // remount the editor with the cleared content
    },
  })

  const scheduleAutosave = useCallback((content: Record<string, unknown>) => {
    // Mark active editing so an incoming external update won't remount and
    // clobber what the user is typing; clear the flag after a short idle.
    editingRef.current = true
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => { editingRef.current = false }, 5000)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveMutation.mutate(content)
    }, 1500)
  }, [page?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      <Header
        actions={
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {page && (
              <button
                onClick={() => { if (confirm(t.projectMemory.clearConfirm)) clearMutation.mutate() }}
                disabled={clearMutation.isPending}
                className="flex items-center gap-1.5 text-slate-500 hover:text-red-400 transition-colors"
                title={t.projectMemory.clear}
              >
                {clearMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {t.projectMemory.clear}
              </button>
            )}
            <BrainCircuit size={14} />
            <span>{t.projectMemory.badge}</span>
            {saveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
          </div>
        }
      />

      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-slate-500" />
        </div>
      )}

      {page && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">
            <div className="flex items-center gap-3 mb-6">
              <BrainCircuit size={28} className="text-primary-400" />
              <h1 className="text-2xl font-bold text-slate-100">{t.projectMemory.title}</h1>
            </div>
            <p className="text-sm text-slate-500 mb-6">
              {t.projectMemory.description}
            </p>
            <BlockEditor
              key={editorKey}
              content={page.content as Record<string, unknown>}
              editable
              onChange={scheduleAutosave}
            />
          </div>
        </div>
      )}
    </div>
  )
}
