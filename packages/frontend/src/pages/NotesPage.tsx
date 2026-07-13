import { useState, useRef, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pin, Trash2, Loader2, StickyNote, Layers } from 'lucide-react'
import { noteApi } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { Header } from '@/components/layout/Header'
import { BlockEditor } from '@/components/editor/BlockEditor'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/i18n/dateLocale'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }
const NOTE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', null]

export function NotesPage() {
  const { projectId } = useParams<{ projectId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentWorkspaceId } = useWorkspaceStore()
  const { setPending } = useCanvasStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const t = useT()
  const { language } = useLanguageStore()

  const [activeNoteId, setActiveNoteId] = useState<string | null>(searchParams.get('noteId'))
  const [filterPinned, setFilterPinned] = useState(false)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear URL param after opening note
  useEffect(() => {
    if (searchParams.get('noteId')) setSearchParams({}, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['notes', currentWorkspaceId, projectId, filterPinned],
    queryFn: () => noteApi.list({
      workspaceId: currentWorkspaceId!,
      projectId: projectId ?? undefined,
      pinned: filterPinned || undefined,
    }),
    enabled: !!currentWorkspaceId,
  })

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null

  const createNote = useMutation({
    mutationFn: () =>
      noteApi.create({
        workspaceId: currentWorkspaceId!,
        projectId: projectId ?? undefined,
        content: EMPTY_DOC,
        pinned: false,
      }),
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ['notes'] })
      setActiveNoteId(note.id)
    },
  })

  const updateNote = useMutation({
    mutationFn: (data: { id: string; content?: Record<string, unknown>; pinned?: boolean; color?: string | null }) =>
      noteApi.update(data.id, { content: data.content, pinned: data.pinned, color: data.color }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  })

  const deleteNote = useMutation({
    mutationFn: (id: string) => noteApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] })
      setActiveNoteId(null)
    },
  })

  const scheduleAutosave = (id: string, content: Record<string, unknown>) => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => updateNote.mutate({ id, content }), 1200)
  }

  function getPreview(content: Record<string, unknown>): string {
    const parts: string[] = []
    function walk(node: Record<string, unknown>) {
      if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text)
      if (Array.isArray(node.content)) {
        for (const c of node.content as Record<string, unknown>[]) walk(c)
      }
    }
    walk(content)
    return parts.join(' ').slice(0, 120) || t.notes.emptyNote
  }

  if (!currentWorkspaceId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-500">{t.common.selectWorkspace}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t.notes.title}
        actions={
          <button onClick={() => createNote.mutate()} disabled={createNote.isPending} className="btn-primary">
            {createNote.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {t.notes.newNote}
          </button>
        }
      />
    <div className="flex flex-1 min-h-0">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-slate-800 flex flex-col bg-surface-900">
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-200">{t.notes.list}</h2>
            <button
              onClick={() => setFilterPinned((v) => !v)}
              className={cn('p-1 rounded-md transition-colors', filterPinned ? 'text-primary-400 bg-primary-600/20' : 'text-slate-500 hover:text-slate-300')}
              title={t.notes.pinned}
            >
              <Pin size={13} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={16} className="animate-spin text-primary-500" />
            </div>
          ) : notes.length === 0 ? (
            <div className="text-center py-10 px-3">
              <StickyNote size={28} className="mx-auto text-slate-700 mb-2" />
              <p className="text-xs text-slate-600">{t.notes.noNotes}</p>
            </div>
          ) : (
            notes.map((note) => (
              <button
                key={note.id}
                onClick={() => setActiveNoteId(note.id)}
                className={cn(
                  'w-full text-left px-3 py-2.5 border-b border-slate-800/50 hover:bg-slate-800 transition-colors',
                  activeNoteId === note.id && 'bg-slate-800',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  {note.color && (
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: note.color }} />
                  )}
                  {note.pinned && <Pin size={10} className="text-primary-400 flex-shrink-0" />}
                  <span className="text-xs text-slate-500 ml-auto">
                    {formatDistanceToNow(new Date(note.updatedAt), { locale: getDateLocale(language), addSuffix: true })}
                  </span>
                </div>
                <p className="text-xs text-slate-300 line-clamp-2">{getPreview(note.content)}</p>
                {note.tags.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {note.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="text-[10px] px-1 py-0.5 bg-slate-800 text-slate-500 rounded">{tag}</span>
                    ))}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeNote ? (
          <>
            {/* Note toolbar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-surface-950">
              <div className="flex items-center gap-1">
                {NOTE_COLORS.map((color) => (
                  <button
                    key={color ?? 'none'}
                    onClick={() => updateNote.mutate({ id: activeNote.id, color })}
                    className={cn('w-4 h-4 rounded-full border-2 transition-transform hover:scale-110', activeNote.color === color ? 'border-white' : 'border-transparent')}
                    style={{ backgroundColor: color ?? '#475569' }}
                  />
                ))}
              </div>
              <div className="flex-1" />
              <button
                onClick={() => {
                  setPending({
                    node: {
                      type: 'note',
                      data: {
                        entityId: activeNote.id,
                        preview: getPreview(activeNote.content),
                        color: activeNote.color ?? '#fef08a',
                      },
                    },
                  })
                  navigate('/canvas')
                }}
                className="btn-ghost p-1.5 text-xs text-primary-400 hover:text-primary-300"
                title={t.canvas.sendToCanvas}
              >
                <Layers size={14} />
              </button>
              <button
                onClick={() => updateNote.mutate({ id: activeNote.id, pinned: !activeNote.pinned })}
                className={cn('btn-ghost p-1.5', activeNote.pinned && 'text-primary-400')}
                title={activeNote.pinned ? t.notes.unpin : t.notes.pin}
              >
                <Pin size={14} />
              </button>
              <button
                onClick={() => { if (confirm(t.notes.deleteConfirm)) deleteNote.mutate(activeNote.id) }}
                className="btn-danger p-1.5"
                disabled={deleteNote.isPending}
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Editor */}
            <div className="flex-1 overflow-y-auto p-6">
              <BlockEditor
                key={activeNote.id}
                content={activeNote.content}
                onChange={(content) => scheduleAutosave(activeNote.id, content)}
                editable={true}
                placeholder={t.notes.placeholder}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <StickyNote size={40} className="text-slate-700" />
            <p className="text-slate-500">{t.notes.selectOrCreate}</p>
            <button onClick={() => createNote.mutate()} className="btn-primary">
              <Plus size={14} /> {t.notes.newNote}
            </button>
          </div>
        )}
      </div>
    </div>
    </div>
  )
}
