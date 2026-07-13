import { NodeViewWrapper } from '@tiptap/react'
import { Music, Trash2 } from 'lucide-react'

export function AudioBlockView({
  node,
  deleteNode,
}: {
  node: { attrs: { src: string; title: string } }
  deleteNode: () => void
}) {
  return (
    <NodeViewWrapper className="my-3 group/audio" contentEditable={false}>
      <div className="rounded-xl overflow-hidden border border-slate-700 hover:border-slate-600 transition-colors bg-slate-800/40">
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80 border-b border-slate-700/50">
          <div className="flex items-center gap-1.5">
            <Music size={12} className="text-teal-400" />
            <span className="text-[11px] text-slate-400 font-medium">{node.attrs.title || 'Audio'}</span>
          </div>
          <button
            onMouseDown={(e) => { e.preventDefault(); deleteNode() }}
            className="p-1 text-slate-600 hover:text-red-400 transition-colors rounded opacity-0 group-hover/audio:opacity-100"
            title="Удалить"
          >
            <Trash2 size={12} />
          </button>
        </div>
        <div className="px-3 py-3">
          <audio
            controls
            src={node.attrs.src}
            className="w-full h-10"
            style={{ colorScheme: 'dark' }}
          />
        </div>
      </div>
    </NodeViewWrapper>
  )
}
