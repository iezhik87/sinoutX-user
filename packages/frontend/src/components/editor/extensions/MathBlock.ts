import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MathBlockView } from './MathView'

export const MathBlockExtension = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      formula: {
        default: 'E = mc^2',
      },
      display: {
        default: true,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'math' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView as unknown as Parameters<typeof ReactNodeViewRenderer>[0])
  },

  addCommands() {
    return {
      insertMathBlock:
        (formula?: string) =>
        ({ commands }: { commands: { insertContent: (c: Record<string, unknown>) => boolean } }) => {
          return commands.insertContent({
            type: 'mathBlock',
            attrs: { formula: formula ?? 'E = mc^2' },
          })
        },
    } as Record<string, unknown>
  },
})
