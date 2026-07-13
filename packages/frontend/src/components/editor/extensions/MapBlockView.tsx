import { NodeViewWrapper } from '@tiptap/react'
import { Trash2, Map } from 'lucide-react'

export function MapBlockView({
  node,
  deleteNode,
}: {
  node: { attrs: { src: string; provider: string; label: string; height: string } }
  deleteNode: () => void
}) {
  return (
    <NodeViewWrapper className="my-3 group/map relative" contentEditable={false}>
      <div className="rounded-xl overflow-hidden border border-slate-700 hover:border-slate-600 transition-colors">
        {/* Header bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80 border-b border-slate-800">
          <div className="flex items-center gap-1.5">
            <Map size={12} className="text-slate-500" />
            <span className="text-xs text-slate-400">{node.attrs.label || 'Карта'}</span>
          </div>
          <button
            onMouseDown={(e) => { e.preventDefault(); deleteNode() }}
            className="p-1 text-slate-600 hover:text-red-400 transition-colors"
            title="Удалить карту"
          >
            <Trash2 size={12} />
          </button>
        </div>
        <iframe
          src={node.attrs.src}
          width="100%"
          height={node.attrs.height || '400'}
          frameBorder="0"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="block"
        />
      </div>
    </NodeViewWrapper>
  )
}
