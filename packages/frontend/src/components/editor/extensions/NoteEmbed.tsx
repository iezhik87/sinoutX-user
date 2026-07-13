import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { noteApi } from '@/api/client'
import { ExternalLink, Trash2, StickyNote } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { renderTiptapText } from '@/lib/renderTiptapText'
import { useT } from '@/i18n'

const HEIGHT_PRESETS = ['120', '200', '320', '500'] as const

function NoteEmbedView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const t = useT()
  const noteId: string = node.attrs.noteId ?? ''
  const height: number = node.attrs.height ?? 200
  const navigate = useNavigate()

  const containerRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState(false)
  const startY = useRef(0)
  const startH = useRef(0)

  const { data: note, isLoading, isError } = useQuery({
    queryKey: ['note-embed', noteId],
    queryFn: () => noteApi.getById(noteId),
    enabled: !!noteId,
    staleTime: 30_000,
  })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startY.current = e.clientY
    startH.current = height
    setResizing(true)

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY.current
      const newH = Math.max(80, startH.current + delta)
      updateAttributes({ height: Math.round(newH) })
    }
    const onUp = () => {
      setResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [height, updateAttributes])

  const previewText = note ? renderTiptapText(note.content) : ''

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div
        ref={containerRef}
        className={`relative rounded-xl border transition-colors overflow-hidden ${selected ? 'border-primary-500 ring-2 ring-primary-500/30' : 'border-slate-700 hover:border-slate-600'}`}
        style={{ height: `${height}px`, background: '#0f1623' }}
      >
        {/* Toolbar */}
        {selected && (
          <div
            style={{
              position: 'absolute', top: 6, right: 6, display: 'flex', alignItems: 'center',
              gap: '2px', background: '#1e2130', border: '1px solid #334155',
              borderRadius: '8px', padding: '3px 6px', zIndex: 300,
            }}
          >
            {HEIGHT_PRESETS.map((h) => (
              <button
                key={h}
                onMouseDown={(e) => { e.preventDefault(); updateAttributes({ height: parseInt(h) }) }}
                style={{
                  fontSize: '10px', padding: '2px 5px', borderRadius: '4px', border: 'none',
                  cursor: 'pointer',
                  background: height === parseInt(h) ? '#6366f1' : 'transparent',
                  color: height === parseInt(h) ? '#fff' : '#94a3b8',
                }}
              >{h}px</button>
            ))}
            <span style={{ width: '1px', height: '14px', background: '#334155', margin: '0 4px' }} />
            <button
              title={t.embed.openNote}
              onMouseDown={(e) => { e.preventDefault(); navigate(`/notes/${noteId}`) }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '2px 4px' }}
            ><ExternalLink size={12} /></button>
            <button
              title={t.embed.deleteBlock}
              onMouseDown={(e) => { e.preventDefault(); deleteNode() }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '2px 4px' }}
            ><Trash2 size={12} /></button>
          </div>
        )}

        {/* Content */}
        <div className="h-full overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <StickyNote size={14} />
              <span>{t.embed.loadingNote}</span>
            </div>
          )}
          {isError && (
            <div className="text-red-400 text-sm flex items-center gap-2">
              <StickyNote size={14} />
              <span>{t.embed.noteLoadFail}</span>
            </div>
          )}
          {note && (
            <>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800">
                <StickyNote size={13} className="text-primary-400 flex-shrink-0" />
                <span className="text-xs font-semibold text-slate-300 truncate">
                  {note.tags.length > 0 ? note.tags.join(', ') : t.embed.note}
                </span>
                <span className="text-[10px] text-slate-600 ml-auto flex-shrink-0">
                  {new Date(note.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-wrap line-clamp-[20]">
                {previewText || <span className="text-slate-600 italic">{t.embed.emptyNote}</span>}
              </p>
            </>
          )}
        </div>

        {/* Resize handle */}
        {selected && (
          <div
            onMouseDown={onMouseDown}
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: '8px',
              cursor: resizing ? 'row-resize' : 's-resize',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(99,102,241,0.15)', zIndex: 300,
            }}
          >
            <div style={{ width: '32px', height: '3px', borderRadius: '2px', background: '#6366f1', opacity: 0.7 }} />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const NoteEmbedExtension = Node.create({
  name: 'noteEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      noteId: { default: '' },
      height: {
        default: 200,
        parseHTML: (el) => parseInt(el.getAttribute('data-height') ?? '200'),
        renderHTML: (attrs) => ({ 'data-height': attrs.height }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-note-embed]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-note-embed': HTMLAttributes.noteId })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteEmbedView)
  },

  addCommands() {
    return {
      insertNoteEmbed: (attrs: { noteId: string; height?: number }) => ({ commands }: { commands: { insertContent: (c: Record<string, unknown>) => boolean } }) =>
        commands.insertContent({ type: 'noteEmbed', attrs }),
    } as Record<string, unknown>
  },
})
