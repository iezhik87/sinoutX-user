import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { SvgBlockView } from './SvgView'

export const SvgBlockExtension = Node.create({
  name: 'svgBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      code: {
        default: '',
      },
      height: {
        default: 300,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="svg-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'svg-block' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SvgBlockView as unknown as Parameters<typeof ReactNodeViewRenderer>[0])
  },

  addCommands() {
    return {
      insertSvgBlock:
        (code?: string) =>
        ({ commands }: { commands: { insertContent: (c: Record<string, unknown>) => boolean } }) => {
          return commands.insertContent({
            type: 'svgBlock',
            attrs: { code: code ?? '' },
          })
        },
    } as Record<string, unknown>
  },
})
