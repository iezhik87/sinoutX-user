import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { toMapEmbedUrl } from './MapBlock'

export interface SlashCommandItem {
  title: string
  description: string
  title_en?: string
  description_en?: string
  title_be?: string
  description_be?: string
  icon: string
  command: (editor: ReturnType<typeof import('@tiptap/react').useEditor>) => void
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    title: '\u0422\u0435\u043a\u0441\u0442',
    description: '\u041e\u0431\u044b\u0447\u043d\u044b\u0439 \u0430\u0431\u0437\u0430\u0446',
    title_en: 'Text',
    description_en: 'Plain paragraph',
    title_be: '\u0422\u044d\u043a\u0441\u0442',
    description_be: '\u0417\u0432\u044b\u0447\u0430\u0439\u043d\u044b \u0430\u0431\u0437\u0430\u0446',
    icon: '\u00b6',
    command: (editor) => editor?.chain().focus().setParagraph().run(),
  },
  {
    title: '\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a 1',
    description: '\u041a\u0440\u0443\u043f\u043d\u044b\u0439 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a',
    title_en: 'Heading 1',
    description_en: 'Large heading',
    title_be: 'Загаловак 1',
    description_be: 'Буйны загаловак',
    icon: 'H1',
    command: (editor) => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: '\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a 2',
    description: '\u0421\u0440\u0435\u0434\u043d\u0438\u0439 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a',
    title_en: 'Heading 2',
    description_en: 'Medium heading',
    title_be: 'Загаловак 2',
    description_be: 'Сярэдні загаловак',
    icon: 'H2',
    command: (editor) => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: '\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a 3',
    description: '\u041c\u0430\u043b\u044b\u0439 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a',
    title_en: 'Heading 3',
    description_en: 'Small heading',
    title_be: 'Загаловак 3',
    description_be: 'Малы загаловак',
    icon: 'H3',
    command: (editor) => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: '\u041c\u0430\u0440\u043a\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439 \u0441\u043f\u0438\u0441\u043e\u043a',
    description: '\u0421\u043f\u0438\u0441\u043e\u043a \u0441 \u043f\u0443\u043d\u043a\u0442\u0430\u043c\u0438',
    title_en: 'Bullet list',
    description_en: 'Unordered list',
    title_be: '\u041c\u0430\u0440\u043a\u0456\u0440\u0430\u0432\u0430\u043d\u044b \u0441\u043f\u0456\u0441',
    description_be: '\u0421\u043f\u0456\u0441 \u0437 \u043a\u0440\u043e\u043f\u043a\u0430\u043c\u0456',
    icon: '\u2022',
    command: (editor) => editor?.chain().focus().toggleBulletList().run(),
  },
  {
    title: '\u041d\u0443\u043c\u0435\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439 \u0441\u043f\u0438\u0441\u043e\u043a',
    description: '\u0421\u043f\u0438\u0441\u043e\u043a \u0441 \u043d\u043e\u043c\u0435\u0440\u0430\u043c\u0438',
    title_en: 'Numbered list',
    description_en: 'Ordered list',
    title_be: 'Нумараваны спіс',
    description_be: 'Спіс з нумарамі',
    icon: '1.',
    command: (editor) => editor?.chain().focus().toggleOrderedList().run(),
  },
  {
    title: '\u0421\u043f\u0438\u0441\u043e\u043a \u0437\u0430\u0434\u0430\u0447',
    description: '\u0427\u0435\u043a\u0431\u043e\u043a\u0441\u044b',
    title_en: 'Task list',
    description_en: 'Checkboxes',
    title_be: '\u0421\u043f\u0456\u0441 \u0437\u0430\u0434\u0430\u0447',
    description_be: '\u0421\u0446\u044f\u0436\u043a\u0456',
    icon: '\u2611',
    command: (editor) => editor?.chain().focus().toggleTaskList().run(),
  },
  {
    title: '\u0411\u043b\u043e\u043a \u043a\u043e\u0434\u0430',
    description: '\u041c\u043e\u043d\u043e\u0448\u0438\u0440\u0438\u043d\u043d\u044b\u0439 \u043a\u043e\u0434 \u0441 \u043f\u043e\u0434\u0441\u0432\u0435\u0442\u043a\u043e\u0439',
    title_en: 'Code block',
    description_en: 'Monospace code with highlighting',
    title_be: 'Блок кода',
    description_be: 'Монашырынны код з падсветкай',
    icon: '<>',
    command: (editor) => editor?.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: '\u0426\u0438\u0442\u0430\u0442\u0430',
    description: '\u0411\u043b\u043e\u043a \u0446\u0438\u0442\u0430\u0442\u044b',
    title_en: 'Quote',
    description_en: 'Blockquote',
    title_be: '\u0426\u044b\u0442\u0430\u0442\u0430',
    description_be: '\u0426\u044b\u0442\u0430\u0442\u0430 \u0437 \u0430\u043a\u0446\u044d\u043d\u0442\u0430\u043c',
    icon: '\u201c',
    command: (editor) => editor?.chain().focus().toggleBlockquote().run(),
  },
  {
    title: '\u0420\u0430\u0437\u0434\u0435\u043b\u0438\u0442\u0435\u043b\u044c',
    description: '\u0413\u043e\u0440\u0438\u0437\u043e\u043d\u0442\u0430\u043b\u044c\u043d\u0430\u044f \u043b\u0438\u043d\u0438\u044f',
    title_en: 'Divider',
    description_en: 'Horizontal rule',
    title_be: '\u0420\u0430\u0437\u0434\u0437\u044f\u043b\u044f\u043b\u044c\u043d\u0456\u043a',
    description_be: '\u0413\u0430\u0440\u044b\u0437\u0430\u043d\u0442\u0430\u043b\u044c\u043d\u0430\u044f \u043b\u0456\u043d\u0456\u044f',
    icon: '\u2014',
    command: (editor) => {
      if (!editor) return
      const { state, view } = editor
      const { $from } = state.selection
      const start = $from.before($from.depth)
      const end = $from.after($from.depth)
      const hr = state.schema.nodes.horizontalRule?.create()
      const para = state.schema.nodes.paragraph?.create()
      if (!hr || !para) { editor.chain().focus().setHorizontalRule().run(); return }
      const tr = state.tr.replaceWith(start, end, [hr, para])
      const paraPos = start + hr.nodeSize + 1
      if (paraPos <= tr.doc.content.size) tr.setSelection(TextSelection.create(tr.doc, paraPos))
      tr.scrollIntoView()
      view.dispatch(tr)
    },
  },
  {
    title: '\u0417\u0430\u043c\u0435\u0442\u043a\u0430',
    description: '\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u043c\u0435\u0442\u043a\u0443 \u043f\u0440\u043e\u0435\u043a\u0442\u0430 \u0438 \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443',
    title_en: 'Note',
    description_en: 'Create note and insert link',
    title_be: 'Нататка',
    description_be: 'Стварыць нататку і ўставіць спасылку',
    icon: 'lucide:StickyNote',
    command: () => document.dispatchEvent(new CustomEvent('editor:create-entity', { detail: { type: 'note' } })),
  },
  {
    title: '\u0421\u0442\u0438\u043a\u0435\u0440',
    description: '\u0411\u043b\u043e\u043a \u0441 \u0437\u0430\u0433\u043d\u0443\u0442\u044b\u043c \u0443\u0433\u043e\u043b\u043a\u043e\u043c',
    title_en: 'Callout',
    description_en: 'Sticky note block',
    title_be: '\u0421\u0442\u044b\u043a\u0435\u0440',
    description_be: '\u0411\u043b\u043e\u043a \u0437 \u0432\u044b\u043b\u0443\u0447\u0430\u043d\u044b\u043c \u0432\u0443\u0433\u043b\u043e\u043c',
    icon: '\u25ad',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    command: (editor) => (editor?.chain().focus() as any).insertCallout('yellow').run(),
  },
  {
    title: '\u0421\u0441\u044b\u043b\u043a\u0430',
    description: '\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0433\u0438\u043f\u0435\u0440\u0441\u0441\u044b\u043b\u043a\u0443',
    title_en: 'Link',
    description_en: 'Insert hyperlink',
    title_be: 'Спасылка',
    description_be: 'Уставіць гіперспасылку',
    icon: '\ud83d\udd17',
    command: (editor) => {
      const url = window.prompt('URL \u0441\u0441\u044b\u043b\u043a\u0438:')
      if (!url?.trim()) return
      const label = window.prompt('\u0422\u0435\u043a\u0441\u0442 \u0441\u0441\u044b\u043b\u043a\u0438 (Enter \u2014 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c URL):', '') || url
      editor?.chain().focus().insertContent([{
        type: 'text',
        text: label,
        marks: [{ type: 'link', attrs: { href: url, target: '_blank' } }],
      }]).run()
    },
  },
  {
    title: '\u0418\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435',
    description: '\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0438\u043b\u0438 \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043f\u043e URL',
    title_en: 'Image',
    description_en: 'Upload or insert by URL',
    title_be: 'Выява',
    description_be: 'Уставіць малюнак',
    icon: '\ud83d\uddbc',
    command: (editor) => {
      if (editor) document.dispatchEvent(new CustomEvent('editor:insert-image'))
    },
  },
  {
    title: '\u0412\u0438\u0434\u0435\u043e',
    description: '\u0412\u0441\u0442\u0440\u043e\u0438\u0442\u044c YouTube / Vimeo',
    title_en: 'Video',
    description_en: 'Embed YouTube / Vimeo',
    title_be: 'Відэа',
    description_be: 'Укладзенае відэа',
    icon: '\u25b6',
    command: (editor) => {
      const url = window.prompt('\u0421\u0441\u044b\u043b\u043a\u0430 \u043d\u0430 \u0432\u0438\u0434\u0435\u043e (YouTube / Vimeo):')
      if (!url) return
      const embedUrl = url
        .replace('youtube.com/watch?v=', 'youtube.com/embed/')
        .replace('youtu.be/', 'youtube.com/embed/')
        .replace('vimeo.com/', 'player.vimeo.com/video/')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(editor?.chain().focus() as any).insertIframe({ src: embedUrl }).run()
    },
  },
  {
    title: '\u0422\u0430\u0431\u043b\u0438\u0446\u0430',
    description: '\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0442\u0430\u0431\u043b\u0438\u0446\u0443 3\u00d73',
    title_en: 'Table',
    description_en: 'Insert 3\u00d73 table',
    title_be: '\u0422\u0430\u0431\u043b\u0456\u0446\u0430',
    description_be: '\u0421\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430\u0432\u0430\u043d\u0430\u044f \u0442\u0430\u0431\u043b\u0456\u0446\u0430',
    icon: '\u25a6',
    command: (editor) => {
      editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
  },
  {
    title: '\u0422\u0430\u0431\u043b\u0438\u0446\u0430 \u0438\u0437 Excel',
    description: '\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c .xlsx \u0444\u0430\u0439\u043b \u043a\u0430\u043a \u0442\u0430\u0431\u043b\u0438\u0446\u0443',
    title_en: 'Table from Excel',
    description_en: 'Insert .xlsx file as table',
    title_be: 'Табліца з Excel',
    description_be: 'Уставіць .xlsx файл як табліцу',
    icon: '\ud83d\udcca',
    command: () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.xlsx,.xls,.csv'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const buffer = await file.arrayBuffer()
        let rows: string[][]
        if (file.name.endsWith('.csv')) {
          const text = new TextDecoder().decode(buffer)
          rows = text.split('\n').filter(Boolean).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')))
        } else {
          const ExcelJS = await import('exceljs')
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load(buffer)
          const ws = workbook.worksheets[0]
          rows = []
          ws?.eachRow((row) => {
            const cells = (row.values as (unknown)[]).slice(1)
            rows.push(cells.map((c) => {
              if (c === null || c === undefined) return ''
              if (typeof c === 'object' && c !== null && 'text' in c) return String((c as { text: unknown }).text)
              return String(c)
            }))
          })
        }
        if (!rows.length) return
        document.dispatchEvent(new CustomEvent('editor:insert-table', { detail: { rows } }))
      }
      input.click()
    },
  },
  {
    title: '\u041a\u0430\u0440\u0442\u0430',
    description: 'Google Maps / \u042f\u043d\u0434\u0435\u043a\u0441 / OpenStreetMap',
    title_en: 'Map',
    description_en: 'Google Maps / Yandex / OpenStreetMap',
    title_be: 'Карта',
    description_be: 'Укладзены Google Maps',
    icon: '\ud83d\uddfa\ufe0f',
    command: (editor) => {
      const input = window.prompt('\u0410\u0434\u0440\u0435\u0441, \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b \u0438\u043b\u0438 \u0441\u0441\u044b\u043b\u043a\u0430 \u043d\u0430 \u043a\u0430\u0440\u0442\u0443:')
      if (!input?.trim()) return
      const { url, provider, label } = toMapEmbedUrl(input.trim())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(editor?.chain().focus() as any).insertMapBlock({ src: url, provider, label }).run()
    },
  },
  {
    title: '\u0420\u0438\u0441\u043e\u0432\u0430\u043d\u0438\u0435',
    description: '\u0412\u0441\u0442\u0440\u043e\u0435\u043d\u043d\u044b\u0439 \u0445\u043e\u043b\u0441\u0442 \u0434\u043b\u044f \u0440\u0438\u0441\u043e\u0432\u0430\u043d\u0438\u044f',
    title_en: 'Drawing',
    description_en: 'Built-in canvas for drawing',
    title_be: 'Малюнак',
    description_be: 'Убудаваны палатно для малявання',
    icon: '\u270f\ufe0f',
    command: (editor) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(editor?.chain().focus() as any).insertDrawingBlock().run()
    },
  },
  {
    title: '\u0414\u0438\u0430\u0433\u0440\u0430\u043c\u043c\u0430',
    description: 'Mermaid \u2014 \u0431\u043b\u043e\u043a-\u0441\u0445\u0435\u043c\u0430, \u0433\u0440\u0430\u0444, sequence \u0438 \u0434\u0440.',
    title_en: 'Diagram',
    description_en: 'Mermaid \u2014 flowchart, graph, sequence, etc.',
    title_be: '\u0421\u0445\u0435\u043c\u0430',
    description_be: '\u0414\u044b\u044f\u0433\u0440\u0430\u043c\u0430 Mermaid',
    icon: 'lucide:GitBranch',
    command: (editor) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(editor?.chain().focus() as any).insertMermaidBlock().run()
    },
  },
  {
    title: '\u0424\u043e\u0440\u043c\u0443\u043b\u0430',
    description: 'LaTeX / KaTeX \u2014 \u043c\u0430\u0442\u0435\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0444\u043e\u0440\u043c\u0443\u043b\u044b \u0438 \u0440\u0430\u0441\u0447\u0451\u0442\u044b',
    title_en: 'Formula',
    description_en: 'LaTeX / KaTeX \u2014 math formulas and calculations',
    title_be: '\u0424\u043e\u0440\u043c\u0443\u043b\u0430',
    description_be: '\u041c\u0430\u0442\u044d\u043c\u0430\u0442\u044b\u0447\u043d\u0430\u044f \u0444\u043e\u0440\u043c\u0443\u043b\u0430 LaTeX',
    icon: 'lucide:Sigma',
    command: (editor) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(editor?.chain().focus() as any).insertMathBlock().run()
    },
  },
  {
    title: 'SVG-\u0441\u0445\u0435\u043c\u0430',
    description: '\u0422\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0441\u0445\u0435\u043c\u044b, \u0447\u0435\u0440\u0442\u0435\u0436\u0438, \u0434\u0438\u0430\u0433\u0440\u0430\u043c\u043c\u044b \u0432 SVG',
    title_en: 'SVG drawing',
    description_en: 'Technical schematics, drawings and diagrams in SVG',
    title_be: 'SVG-схема',
    description_be: 'Тэхнічныя схемы і дыяграмы ў SVG',
    icon: 'lucide:PenTool',
    command: (editor) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(editor?.chain().focus() as any).insertSvgBlock().run()
    },
  },
  {
    title: '\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0438\u0437 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0430',
    description: '\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a \u043f\u0440\u043e\u0435\u043a\u0442\u0430 \u0438 \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443',
    title_en: 'Insert from source',
    description_en: 'Pick a project source and insert link',
    title_be: 'Уставіць з крыніцы',
    description_be: 'Выбраць крыніцу і ўставіць спасылку',
    icon: 'lucide:Paperclip',
    command: () => {
      document.dispatchEvent(new CustomEvent('editor:insert-source'))
    },
  },
  {
    title: 'AI: \u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c',
    description: '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0442\u0435\u043a\u0441\u0442 \u0441 \u043f\u043e\u043c\u043e\u0449\u044c\u044e AI',
    title_en: 'AI: Continue',
    description_en: 'Continue writing with AI',
    title_be: 'AI: Працягнуць',
    description_be: 'Працягнуць тэкст з дапамогай AI',
    icon: 'lucide:Sparkles',
    command: () => document.dispatchEvent(new CustomEvent('editor:ai-write', { detail: { action: 'continue' } })),
  },
  // improve / summarize / shorter / longer / translate moved to the text-
  // selection "AI" dropdown — removed here to keep the slash menu uncluttered.
  {
    title: 'AI \u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f \u043a\u0430\u0440\u0442\u0438\u043d\u043a\u0438',
    description: '\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435 \u043f\u043e \u0442\u0435\u043a\u0441\u0442\u043e\u0432\u043e\u043c\u0443 \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u044e',
    title_en: 'AI image',
    description_en: 'Generate image from text prompt',
    title_be: 'AI генерацыя малюнка',
    description_be: 'Стварыць малюнак па апісанні',
    icon: 'lucide:ImagePlus',
    command: () => {
      document.dispatchEvent(new CustomEvent('editor:ai-image'))
    },
  },
  {
    title: '\u0410\u0443\u0434\u0438\u043e \u0444\u0430\u0439\u043b',
    description: '\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0430\u0443\u0434\u0438\u043e \u0444\u0430\u0439\u043b \u0441 \u043f\u043b\u0435\u0435\u0440\u043e\u043c',
    title_en: 'Audio file',
    description_en: 'Insert an audio file with player',
    title_be: 'Аўдыёфайл',
    description_be: 'Уставіць аўдыёфайл з прайгравальнікам',
    icon: 'lucide:Music',
    command: () => {
      document.dispatchEvent(new CustomEvent('editor:ai-audio'))
    },
  },
  {
    title: '\u0417\u0430\u0434\u0430\u0447\u0430',
    description: '\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u0434\u0430\u0447\u0443 \u0438 \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443',
    title_en: 'Task',
    description_en: 'Create task and insert link',
    title_be: 'Задача',
    description_be: 'Стварыць задачу і ўставіць спасылку',
    icon: 'lucide:CheckSquare',
    command: () => {
      document.dispatchEvent(new CustomEvent('editor:create-entity', { detail: { type: 'task' } }))
    },
  },
  {
    title: '\u0418\u043a\u043e\u043d\u043a\u0430 / \u042d\u043c\u043e\u0434\u0437\u0438',
    description: '\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0438\u043a\u043e\u043d\u043a\u0443 \u0438\u043b\u0438 \u044d\u043c\u043e\u0434\u0437\u0438',
    title_en: 'Icon / Emoji',
    description_en: 'Insert icon or emoji',
    title_be: 'Іконка / Эмодзі',
    description_be: 'Уставіць іконку або эмодзі',
    icon: 'lucide:Smile',
    command: (editor) => {
      const EMOJI_LIST = [
        '\u2705','\u274c','\u26a0\ufe0f','\ud83d\udca1','\ud83d\udd25','\u2b50','\ud83d\udccc','\ud83c\udfaf','\ud83d\ude80','\ud83d\udcdd',
        '\ud83d\udcac','\ud83d\udd17','\ud83d\udcce','\ud83d\uddc2\ufe0f','\ud83d\udcc5','\u23f0','\u270f\ufe0f','\ud83d\uddd1\ufe0f','\ud83d\udd12','\ud83d\udd13',
        '\ud83d\udc4d','\ud83d\udc4e','\u2764\ufe0f','\ud83c\udf89','\ud83e\udd14','\ud83d\udcaa','\ud83c\udf1f','\ud83c\udfc6','\ud83c\udfa8','\u26a1',
        '\ud83d\udcca','\ud83d\udcc8','\ud83d\udcc9','\ud83d\udcb0','\ud83c\udf10','\ud83d\udce7','\ud83d\udcf1','\ud83d\udcbb','\ud83d\udda5\ufe0f','\ud83d\udda8\ufe0f',
      ]
      const picker = document.createElement('div')
      picker.style.cssText = `
        position: fixed; z-index: 9999; background: #0f172a; border: 1px solid #334155;
        border-radius: 12px; padding: 12px; display: flex; flex-wrap: wrap; gap: 4px;
        max-width: 280px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        top: 50%; left: 50%; transform: translate(-50%, -50%);
      `
      EMOJI_LIST.forEach((emoji) => {
        const btn = document.createElement('button')
        btn.textContent = emoji
        btn.style.cssText = 'font-size: 20px; padding: 4px; border-radius: 6px; cursor: pointer; background: transparent; border: none; transition: background 0.1s;'
        btn.onmouseenter = () => { btn.style.background = '#1e293b' }
        btn.onmouseleave = () => { btn.style.background = 'transparent' }
        btn.onclick = () => {
          editor?.chain().focus().insertContent(emoji).run()
          document.body.removeChild(picker)
        }
        picker.appendChild(btn)
      })
      const close = document.createElement('div')
      close.style.cssText = 'width: 100%; text-align: right; margin-top: 4px;'
      const closeBtn = document.createElement('button')
      closeBtn.textContent = '\u2715 \u0417\u0430\u043a\u0440\u044b\u0442\u044c'
      closeBtn.style.cssText = 'font-size: 11px; color: #64748b; cursor: pointer; background: transparent; border: none;'
      closeBtn.onclick = () => document.body.removeChild(picker)
      close.appendChild(closeBtn)
      picker.appendChild(close)
      document.body.appendChild(picker)
      setTimeout(() => {
        const outsideClick = (e: MouseEvent) => {
          if (!picker.contains(e.target as Node)) {
            if (document.body.contains(picker)) document.body.removeChild(picker)
            document.removeEventListener('mousedown', outsideClick)
          }
        }
        document.addEventListener('mousedown', outsideClick)
      }, 100)
    },
  },
  {
    title: 'Таблица из Markdown',
    description: 'Выдели текст с | и конвертируй в таблицу',
    title_en: 'Table from Markdown',
    description_en: 'Select pipe-table text and convert to table',
    title_be: 'Табліца з Markdown',
    description_be: 'Выдзелі тэкст з | і канвертуй у табліцу',
    icon: '⇥',
    command: () => {
      document.dispatchEvent(new CustomEvent('editor:convert-md-table'))
    },
  },
  {
    title: 'QR-код',
    description: 'Сгенерировать и вставить QR-код',
    title_en: 'QR code',
    description_en: 'Generate and insert a QR code',
    title_be: 'QR-код',
    description_be: 'Сканаваны QR-код',
    icon: 'lucide:QrCode',
    command: () => {
      document.dispatchEvent(new CustomEvent('editor:barcode', { detail: { tab: 'qr' } }))
    },
  },
  {
    title: 'Штрихкод',
    description: 'Сгенерировать и вставить штрихкод',
    title_en: 'Barcode',
    description_en: 'Generate and insert a barcode',
    title_be: 'Штрыхкод',
    description_be: 'Сканаваны штрыхкод',
    icon: 'lucide:Barcode',
    command: () => {
      document.dispatchEvent(new CustomEvent('editor:barcode', { detail: { tab: 'barcode' } }))
    },
  },
  {
    title: 'Ссылка на страницу',
    description: 'Найти и вставить ссылку на другую страницу',
    title_en: 'Page link',
    description_en: 'Search and insert link to another page',
    title_be: 'Спасылка на старонку',
    description_be: 'Знайсці і ўставіць спасылку на іншую старонку',
    icon: 'lucide:FileText',
    command: () => {
      document.dispatchEvent(new CustomEvent('editor:page-link'))
    },
  },
  {
    title: 'Встроить заметку',
    description: 'Вставить заметку как встроенный блок с превью',
    title_en: 'Embed note',
    description_en: 'Insert a note as a resizable embedded preview',
    title_be: 'Убудаваць нататку',
    description_be: 'Уставіць нататку як убудаваны блок',
    icon: 'lucide:StickyNote',
    command: () => {
      document.dispatchEvent(new CustomEvent('editor:note-embed'))
    },
  },
  {
    title: 'Встроить страницу',
    description: 'Вставить страницу как встроенный блок с превью',
    title_en: 'Embed page',
    description_en: 'Insert a page as a resizable embedded preview',
    title_be: 'Убудаваць старонку',
    description_be: 'Уставіць старонку як убудаваны блок',
    icon: 'lucide:FileCode',
    command: () => {
      document.dispatchEvent(new CustomEvent('editor:page-embed'))
    },
  },
]

export const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addKeyboardShortcuts() {
    return {}
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('slashCommand'),
      }),
    ]
  },
})
