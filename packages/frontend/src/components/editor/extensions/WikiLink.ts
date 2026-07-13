import { Mark, mergeAttributes } from '@tiptap/core'

// WikiLink extension: [[Page Title]] → кликабельная ссылка на страницу
export const WikiLink = Mark.create({
  name: 'wikiLink',

  addOptions() {
    return {
      HTMLAttributes: {},
      onNavigate: (_id: string) => {},
    }
  },

  addAttributes() {
    return {
      pageId: { default: null },
      pageTitle: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-wiki-link]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-wiki-link': true,
        class: 'wiki-link',
      }),
      0,
    ]
  },
})
