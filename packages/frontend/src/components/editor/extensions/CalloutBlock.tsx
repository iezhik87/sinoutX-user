import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type CalloutColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple'

const COLORS: Record<CalloutColor, { bg: string; border: string; fold: string }> = {
  yellow: { bg: '#fefce8', border: '#fde047', fold: '#facc15' },
  blue:   { bg: '#eff6ff', border: '#93c5fd', fold: '#60a5fa' },
  green:  { bg: '#f0fdf4', border: '#86efac', fold: '#4ade80' },
  pink:   { bg: '#fdf2f8', border: '#f0abfc', fold: '#e879f9' },
  purple: { bg: '#faf5ff', border: '#c4b5fd', fold: '#a78bfa' },
}

const FOLD = 26

function CalloutView({
  node,
  updateAttributes,
  deleteNode,
}: {
  node: { attrs: { color: CalloutColor } }
  updateAttributes: (a: Record<string, unknown>) => void
  deleteNode: () => void
}) {
  const color = (node.attrs.color ?? 'yellow') as CalloutColor
  const { bg, border, fold } = COLORS[color]

  return (
    <NodeViewWrapper className="my-3 group/callout" style={{ position: 'relative', display: 'block' }}>
      <div
        style={{
          position: 'relative',
          background: bg,
          border: `1.5px solid ${border}`,
          borderRadius: '3px 10px 3px 10px',
          padding: `10px ${FOLD + 10}px 12px 14px`,
          boxShadow: '2px 3px 10px rgba(0,0,0,0.10)',
          minHeight: 52,
        }}
      >
        {/* Folded corner */}
        <div
          contentEditable={false}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 0,
            height: 0,
            borderStyle: 'solid',
            borderWidth: `${FOLD}px ${FOLD}px 0 0`,
            borderColor: `${fold} transparent transparent transparent`,
            filter: 'drop-shadow(-1px 1px 2px rgba(0,0,0,0.15))',
          }}
        />

        {/* Controls: hidden until hover */}
        <div
          contentEditable={false}
          className={cn(
            'absolute bottom-2 right-2 flex items-center gap-1',
            'opacity-0 group-hover/callout:opacity-100 transition-opacity duration-150',
          )}
          style={{ zIndex: 10, pointerEvents: 'none' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.pointerEvents = 'auto' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.pointerEvents = 'none' }}
        >
          {(Object.keys(COLORS) as CalloutColor[]).map((c) => (
            <button
              key={c}
              onMouseDown={(e) => { e.preventDefault(); updateAttributes({ color: c }) }}
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: COLORS[c].fold,
                border: c === color ? '2px solid #475569' : '1.5px solid rgba(0,0,0,0.15)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            />
          ))}
          <div style={{ width: 1, height: 10, background: 'rgba(0,0,0,0.15)', margin: '0 1px' }} />
          <button
            onMouseDown={(e) => { e.preventDefault(); deleteNode() }}
            style={{ color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <Trash2 size={10} />
          </button>
        </div>

        {/* Editable content */}
        <NodeViewContent
          style={{
            color: '#1e293b',
            fontSize: '0.88rem',
            lineHeight: 1.65,
            minHeight: 24,
            outline: 'none',
          }}
        />
      </div>
    </NodeViewWrapper>
  )
}

export const CalloutBlockExtension = Node.create({
  name: 'calloutBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      color: { default: 'yellow' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'callout' }, HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView as unknown as Parameters<typeof ReactNodeViewRenderer>[0])
  },

  addCommands() {
    return {
      insertCallout:
        (color = 'yellow') =>
        ({ commands }: { commands: { insertContent: (c: Record<string, unknown>) => boolean } }) =>
          commands.insertContent({
            type: 'calloutBlock',
            attrs: { color },
            content: [{ type: 'paragraph' }],
          }),
    } as Record<string, unknown>
  },
})
