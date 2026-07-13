import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MermaidBlockView } from './MermaidView'

export const MermaidBlockExtension = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      code: {
        default: 'flowchart TD\n    A["Начало"] --> B["Конец"]',
      },
      height: {
        default: 300,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'mermaid' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidBlockView as unknown as Parameters<typeof ReactNodeViewRenderer>[0])
  },

  addCommands() {
    return {
      insertMermaidBlock:
        (code?: string) =>
        ({ commands }: { commands: { insertContent: (c: Record<string, unknown>) => boolean } }) => {
          return commands.insertContent({
            type: 'mermaidBlock',
            attrs: { code: code ?? 'flowchart TD\n    A["Начало"] --> B["Конец"]' },
          })
        },
    } as Record<string, unknown>
  },
})
