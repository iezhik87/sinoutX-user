import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { AudioBlockView } from './AudioBlockView'

export const AudioBlockExtension = Node.create({
  name: 'audioBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src:   { default: null },
      title: { default: 'Audio' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-audio-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { 'data-audio-block': 'true' },
      ['audio', { src: HTMLAttributes.src, controls: 'true' }],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioBlockView as unknown as Parameters<typeof ReactNodeViewRenderer>[0])
  },

  addCommands() {
    return {
      insertAudioBlock:
        (attrs: { src: string; title?: string }) =>
        (props: { commands: { insertContent: (c: Record<string, unknown>) => boolean } }) => {
          return props.commands.insertContent({ type: this.name, attrs })
        },
    } as Record<string, unknown>
  },
})
