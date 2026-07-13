import { NodeViewWrapper } from '@tiptap/react'
import { Trash2 } from 'lucide-react'
import { tokenizeAttachmentUrl } from '@/api/client'

export function IframeView({
  node,
  deleteNode,
}: {
  node: { attrs: { src: string; width: string; height: string } }
  deleteNode: () => void
}) {
  return (
    <NodeViewWrapper className="my-3 group/iframe relative" contentEditable={false}>
      <div className="rounded-lg overflow-hidden border border-slate-700 hover:border-slate-600 transition-colors relative">
        <button
          onMouseDown={(e) => { e.preventDefault(); deleteNode() }}
          className="absolute top-2 right-2 z-10 p-1 bg-slate-900/80 rounded text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover/iframe:opacity-100"
          title="Удалить"
        >
          <Trash2 size={12} />
        </button>
        <iframe
          src={tokenizeAttachmentUrl(node.attrs.src)}
          width={node.attrs.width || '100%'}
          height={node.attrs.height || '360'}
          frameBorder="0"
          allowFullScreen
          style={{ width: '100%', display: 'block' }}
        />
      </div>
    </NodeViewWrapper>
  )
}
