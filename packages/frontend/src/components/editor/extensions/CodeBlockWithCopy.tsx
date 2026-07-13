import { useState } from 'react'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Copy, Check } from 'lucide-react'
import type { createLowlight } from 'lowlight'

function CodeBlockView({ node }: NodeViewProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(node.textContent).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <NodeViewWrapper className="relative group">
      <button
        contentEditable={false}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-slate-200"
        title="Скопировать"
      >
        {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
      </button>
      <pre><NodeViewContent as="code" /></pre>
    </NodeViewWrapper>
  )
}

export function createCodeBlockWithCopy(lowlight: ReturnType<typeof createLowlight>) {
  return CodeBlockLowlight.extend({
    addNodeView() {
      return ReactNodeViewRenderer(
        CodeBlockView as Parameters<typeof ReactNodeViewRenderer>[0],
        {
          stopEvent: ({ event }) => {
            // Only intercept mousedown on the copy button itself
            // Let ProseMirror handle everything else (clicks to move cursor, etc.)
            if (event.type === 'mousedown') {
              return (event.target as HTMLElement).closest('button') !== null
            }
            return false
          },
        },
      )
    },
  }).configure({ lowlight })
}
