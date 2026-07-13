import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { IframeView } from './IframeView'

export const IframeExtension = Node.create({
  name: 'iframe',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: '100%' },
      height: { default: '360' },
    }
  },

  parseHTML() {
    return [{ tag: 'iframe' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { class: 'my-3 rounded-lg overflow-hidden' },
      ['iframe', { ...HTMLAttributes, frameborder: '0', allowfullscreen: 'true', style: 'width:100%;display:block' }],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(IframeView as unknown as Parameters<typeof ReactNodeViewRenderer>[0])
  },

  addCommands() {
    return {
      insertIframe:
        (attrs: { src: string; height?: string }) =>
        (props: { commands: { insertContent: (c: Record<string, unknown>) => boolean } }) => {
          return props.commands.insertContent({ type: this.name, attrs })
        },
    } as Record<string, unknown>
  },
})
