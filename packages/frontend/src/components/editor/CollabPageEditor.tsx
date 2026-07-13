import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { BlockEditor } from './BlockEditor'
import { useAuthStore } from '@/stores/authStore'

interface CollabPageEditorProps {
  pageId: string
  content: Record<string, unknown>
  editable?: boolean
  projectId?: string
  onRequestEntityCreate?: (type: 'task' | 'note' | 'budget') => void
  insertEntity?: { id: string; label: string; type: 'task' | 'note' | 'budget' } | null
  onInsertEntityDone?: () => void
  onRequestSourceInsert?: () => void
  insertSource?: { filename: string; url: string } | null
  onInsertSourceDone?: () => void
  onAttachmentClick?: (attachmentId: string) => void
  onChange?: (content: Record<string, unknown>) => void
  onCollabUsers?: (users: Array<{ name: string; color: string }>) => void
}

const CURSOR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6']
function colorFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return CURSOR_COLORS[h % CURSOR_COLORS.length]
}

// Connect timeout — if the collab server doesn't sync within this, fall back to
// a plain (non-collab) editor so editing still works (last-write-wins autosave).
const CONNECT_TIMEOUT_MS = 4000

// Real-time collaborative editor over the Hocuspocus collab-server (/collab).
// Resilient: if the server is unreachable, degrades to the normal editor.
export function CollabPageEditor({ pageId, onCollabUsers, content, onChange, ...editorProps }: CollabPageEditorProps) {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const [phase, setPhase] = useState<'connecting' | 'collab' | 'fallback'>('connecting')

  const { doc, provider } = useMemo(() => {
    const doc = new Y.Doc()
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const provider = new HocuspocusProvider({
      url: `${proto}://${window.location.host}/collab`,
      name: pageId,
      document: doc,
      token: token ?? undefined,
    })
    return { doc, provider }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId])

  useEffect(() => () => { provider.destroy(); doc.destroy() }, [provider, doc])

  // Decide collab vs fallback based on whether the provider syncs in time
  useEffect(() => {
    let settled = false
    const onSynced = () => { if (!settled) { settled = true; setPhase('collab') } }
    // already synced (race)
    if ((provider as unknown as { isSynced?: boolean }).isSynced) { onSynced() }
    provider.on('synced', onSynced)
    const timer = setTimeout(() => { if (!settled) { settled = true; setPhase('fallback') } }, CONNECT_TIMEOUT_MS)
    return () => { provider.off('synced', onSynced); clearTimeout(timer) }
  }, [provider])

  // Report presence to the parent
  useEffect(() => {
    if (!onCollabUsers || phase !== 'collab') return
    const awareness = provider.awareness
    if (!awareness) return
    const update = () => {
      const users: Array<{ name: string; color: string }> = []
      for (const state of awareness.getStates().values()) if (state.user) users.push(state.user)
      onCollabUsers(users)
    }
    awareness.on('update', update)
    update()
    return () => awareness.off('update', update)
  }, [provider, onCollabUsers, phase])

  if (phase === 'connecting') {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-slate-500">
        <span className="animate-pulse">…</span>
      </div>
    )
  }

  if (phase === 'fallback') {
    // Collab server unreachable — plain editor (content + autosave still work)
    return <BlockEditor content={content} onChange={onChange} {...editorProps} />
  }

  const collabUser = { name: user?.name ?? 'Аноним', color: colorFor(user?.name ?? 'anon') }
  // Pass content too: the editor seeds an empty shared doc from it (the server
  // returns an empty doc for pages never collab-edited).
  return <BlockEditor collab={{ doc, provider, user: collabUser }} content={content} {...editorProps} />
}
