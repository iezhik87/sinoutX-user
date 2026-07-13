import { Image, type ImageOptions } from '@tiptap/extension-image'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlignLeft, AlignRight, AlignCenter, Maximize2, FolderInput, Loader2 } from 'lucide-react'
import { tokenizeAttachmentUrl, uploadApi } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { toast } from '@/stores/toastStore'
import { useT } from '@/i18n/useT'

// ── NodeView component ────────────────────────────────────────────────────────

function ImageNodeView({ node, updateAttributes, selected, extension }: NodeViewProps) {
  const src: string = node.attrs.src ?? ''
  const alt: string = node.attrs.alt ?? ''
  const width: string = node.attrs.width ?? 'auto'
  const float: string = node.attrs.float ?? 'none'
  const containerRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState(false)
  const [savingSource, setSavingSource] = useState(false)
  const startX = useRef(0)
  const startW = useRef(0)
  const t = useT()
  const qc = useQueryClient()
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const projectId = (extension.options as { projectId?: string }).projectId

  // Live check whether this image is already saved as a source: fetched only
  // while the image is selected (react-query dedupes the shared key). Reflects
  // additions/deletions on the sources page without a reload.
  const { data: sources } = useQuery({
    queryKey: ['attachments', workspaceId],
    queryFn: () => uploadApi.list({ workspaceId: workspaceId! }),
    enabled: selected && !!workspaceId,
    staleTime: 10_000,
  })

  const originSrc = (node.attrs.originSrc as string | null) ?? null
  const attId = src.match(/\/attachments\/([^/?#]+)\/content/)?.[1]
  const isAttachmentSrc = !!attId
  const matchedInSources = !!sources?.some((a) => (a.metadata as { sourceUrl?: string })?.sourceUrl === src)

  // If this image points at a source attachment that no longer exists (deleted
  // on the sources page), fall back to the original network URL so the image
  // isn't broken — and the "Save to sources" button becomes available again.
  useEffect(() => {
    if (!selected || !sources || !attId || !originSrc) return
    if (!sources.some((a) => a.id === attId)) {
      updateAttributes({ src: originSrc, originSrc: null })
    }
  }, [selected, sources, attId, originSrc, updateAttributes])

  const alreadyStored = src.startsWith('data:') || isAttachmentSrc || matchedInSources

  async function saveToSources(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (savingSource || alreadyStored) return
    if (!workspaceId) { toast.error(t.editor.image.saveError); return }
    setSavingSource(true)
    try {
      const att = await uploadApi.fromUrl(src, workspaceId, { projectId, description: alt || undefined })
      // Serve the image from the stored source from now on; remember the
      // original URL so we can restore it if the source is later deleted.
      updateAttributes({ src: `/api/v1/attachments/${att.id}/content`, originSrc: src })
      await qc.invalidateQueries({ queryKey: ['attachments', workspaceId] })
      toast.success(t.editor.image.savedToSources)
    } catch {
      toast.error(t.editor.image.saveError)
    } finally {
      setSavingSource(false)
    }
  }

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const img = containerRef.current?.querySelector('img')
    if (!img) return
    startX.current = e.clientX
    startW.current = img.getBoundingClientRect().width
    setResizing(true)

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX.current
      const newW = Math.max(80, startW.current + delta)
      updateAttributes({ width: `${Math.round(newW)}px` })
    }
    const onUp = () => {
      setResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [updateAttributes])

  const containerStyle: React.CSSProperties = float === 'left'
    ? { float: 'left', marginRight: '1rem', marginBottom: '0.5rem', display: 'inline-block', maxWidth: '60%' }
    : float === 'right'
    ? { float: 'right', marginLeft: '1rem', marginBottom: '0.5rem', display: 'inline-block', maxWidth: '60%' }
    : { display: 'block', clear: 'both', marginLeft: 'auto', marginRight: 'auto' }

  return (
    <NodeViewWrapper
      as="span"
      style={{ display: float !== 'none' ? 'inline' : 'block' }}
    >
      <span
        ref={containerRef}
        style={{ ...containerStyle, position: 'relative', lineHeight: 0, width: float !== 'none' ? width : undefined }}
        className={`image-resize-wrapper${selected ? ' ring-2 ring-primary-500 ring-offset-1 rounded-lg' : ''}`}
      >
        <img
          src={tokenizeAttachmentUrl(src)}
          alt={alt ?? ''}
          draggable={false}
          style={{
            width: float !== 'none' ? '100%' : width,
            display: 'block',
            borderRadius: '0.5rem',
          }}
        />

        {/* Toolbar shown when selected */}
        {selected && (
          <span
            contentEditable={false}
            style={{
              position: 'absolute',
              top: '-2.5rem',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              background: '#1e2130',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '3px 6px',
              zIndex: 300,
              whiteSpace: 'nowrap',
            }}
          >
            {/* Width presets */}
            {(['25%', '50%', '75%', '100%'] as const).map((w) => (
              <button
                key={w}
                onMouseDown={(e) => { e.preventDefault(); updateAttributes({ width: w }) }}
                style={{
                  fontSize: '10px',
                  padding: '2px 5px',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  background: width === w ? '#6366f1' : 'transparent',
                  color: width === w ? '#fff' : '#94a3b8',
                }}
              >{w}</button>
            ))}

            <span style={{ width: '1px', height: '14px', background: '#334155', margin: '0 4px' }} />

            {/* Auto size */}
            <button
              title="Original size"
              onMouseDown={(e) => { e.preventDefault(); updateAttributes({ width: 'auto' }) }}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: width === 'auto' ? '#6366f1' : '#94a3b8', padding: '2px 4px',
              }}
            >
              <Maximize2 size={12} />
            </button>

            <span style={{ width: '1px', height: '14px', background: '#334155', margin: '0 4px' }} />

            {/* Float options */}
            <button
              title="Float left"
              onMouseDown={(e) => { e.preventDefault(); updateAttributes({ float: 'left' }) }}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: float === 'left' ? '#6366f1' : '#94a3b8', padding: '2px 4px',
              }}
            >
              <AlignLeft size={12} />
            </button>
            <button
              title="No wrap"
              onMouseDown={(e) => { e.preventDefault(); updateAttributes({ float: 'none' }) }}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: float === 'none' ? '#6366f1' : '#94a3b8', padding: '2px 4px',
              }}
            >
              <AlignCenter size={12} />
            </button>
            <button
              title="Float right"
              onMouseDown={(e) => { e.preventDefault(); updateAttributes({ float: 'right' }) }}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: float === 'right' ? '#6366f1' : '#94a3b8', padding: '2px 4px',
              }}
            >
              <AlignRight size={12} />
            </button>

            {/* Save to project sources — only for not-yet-stored images */}
            {!alreadyStored && (
              <>
                <span style={{ width: '1px', height: '14px', background: '#334155', margin: '0 4px' }} />
                <button
                  title={t.editor.image.saveToSources}
                  onMouseDown={saveToSources}
                  disabled={savingSource}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    background: 'transparent', border: 'none', cursor: savingSource ? 'default' : 'pointer',
                    color: '#a5b4fc', padding: '2px 6px', fontSize: '11px', whiteSpace: 'nowrap',
                  }}
                >
                  {savingSource ? <Loader2 size={12} className="animate-spin" /> : <FolderInput size={12} />}
                  {t.editor.image.saveToSources}
                </button>
              </>
            )}
          </span>
        )}

        {/* Resize handle (bottom-right) */}
        {selected && (
          <span
            contentEditable={false}
            onMouseDown={onMouseDown}
            style={{
              position: 'absolute',
              bottom: '4px',
              right: '4px',
              width: '14px',
              height: '14px',
              background: '#6366f1',
              borderRadius: '3px',
              cursor: resizing ? 'ew-resize' : 'se-resize',
              zIndex: 300,
            }}
          />
        )}
      </span>
    </NodeViewWrapper>
  )
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const ImageResize = Image.extend<ImageOptions & { projectId?: string }>({
  addOptions() {
    return {
      ...this.parent?.(),
      // Project the editor belongs to — used when saving an image to sources.
      projectId: undefined as string | undefined,
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: 'auto',
        parseHTML: (el) => el.getAttribute('data-width') ?? el.style.width ?? 'auto',
        renderHTML: (attrs) => ({ 'data-width': attrs.width, style: `width:${attrs.width}` }),
      },
      float: {
        default: 'none',
        parseHTML: (el) => el.getAttribute('data-float') ?? 'none',
        renderHTML: (attrs) => ({ 'data-float': attrs.float }),
      },
      // Original (network) URL kept after the image is saved to sources, so the
      // embedded image can be restored if that source attachment is deleted.
      originSrc: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-origin-src'),
        renderHTML: (attrs) => (attrs.originSrc ? { 'data-origin-src': attrs.originSrc } : {}),
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },
})
