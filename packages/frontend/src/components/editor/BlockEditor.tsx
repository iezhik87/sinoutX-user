import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import { stripLeadingEmoji } from '@/lib/displayText'
import { useQuery } from '@tanstack/react-query'
import { pageApi, noteApi, type PageMeta, type Note } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import { ImageResize } from './extensions/ImageResize'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { FontSizeExtension } from './extensions/FontSize'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { common, createLowlight } from 'lowlight'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import type * as Y from 'yjs'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bold, Italic, Strikethrough, Code, Link as LinkIcon, ExternalLink, Sparkles,
  AlignLeft, AlignCenter, AlignRight, Highlighter,
  List, ListOrdered, CheckSquare, Heading1, Heading2, Heading3,
  Quote, Minus, Pencil, Trash2, Check, X,
  Table as TableIcon, MapPin, RowsIcon, Columns3,
  Merge, Split, Trash, Copy, Telescope, HelpCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n/useT'
import { SlashCommandMenu } from './SlashCommandMenu'
import { AiWritingPanel, type AiWriteAction } from './AiWritingPanel'
import { AiImageModal } from './AiImageModal'
import { ImageInsertModal } from './ImageInsertModal'
import { AiAudioModal } from './AiAudioModal'
import { BarcodeModal } from './BarcodeModal'
import { AudioBlockExtension } from './extensions/AudioBlock'
import { IframeExtension } from './extensions/IframeExtension'
import { DrawingBlockExtension } from './extensions/DrawingBlock'
import { EntityRefExtension } from './extensions/EntityRef'
import { MapBlockExtension, toMapEmbedUrl } from './extensions/MapBlock'
import { MermaidBlockExtension } from './extensions/MermaidBlock'
import { MathBlockExtension } from './extensions/MathBlock'
import { SvgBlockExtension } from './extensions/SvgBlock'
import { CalloutBlockExtension } from './extensions/CalloutBlock'
import { NoteEmbedExtension } from './extensions/NoteEmbed'
import { PageEmbedExtension } from './extensions/PageEmbed'
import { useLanguageStore } from '@/stores/languageStore'

const lowlight = createLowlight(common)

// URL regex — matches http/https URLs, avoids trailing punctuation
const URL_REGEX = /https?:\/\/[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9@:%_+.~#?&/=]*/g

// Recursively drop empty text nodes ({type:'text', text:''}). ProseMirror throws
// on them during Node.fromJSON, which makes setContent fail and the whole page
// render blank — older AI-generated pages (empty table cells) hit this.
function sanitizeDocContent(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(sanitizeDocContent).filter((n) => n !== null)
  }
  if (node && typeof node === 'object') {
    const n = node as Record<string, unknown>
    if (n.type === 'text' && (typeof n.text !== 'string' || n.text.length === 0)) return null
    if (Array.isArray(n.content)) {
      return { ...n, content: (n.content as unknown[]).map(sanitizeDocContent).filter((c) => c !== null) }
    }
    return n
  }
  return node
}

// ─── Markdown table parser ────────────────────────────────────────────────────

function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } | null {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length < 2) return null

  const isTableLine = (l: string) => l.includes('|')
  if (!isTableLine(lines[0])) return null

  // Separator row must be at index 1 (---|--- pattern)
  const isSeparator = (l: string) => /^\|?[\s:|-]+\|[\s:|-]*\|?$/.test(l)
  if (!isSeparator(lines[1])) return null

  const splitRow = (l: string): string[] => {
    const parts = l.split('|')
    // trim ends — table lines may start/end with |
    const start = parts[0].trim() === '' ? 1 : 0
    const end = parts[parts.length - 1].trim() === '' ? parts.length - 1 : parts.length
    return parts.slice(start, end).map((c) => c.trim())
  }

  const headers = splitRow(lines[0])
  if (headers.length === 0) return null
  const rows = lines.slice(2).map(splitRow)
  return { headers, rows }
}

/** Insert a parsed markdown table as TipTap table nodes via ProseMirror */
function insertMarkdownTableNode(
  view: { state: { schema: { nodes: Record<string, { create: (...a: unknown[]) => unknown }> }; tr: { replaceSelectionWith: (n: unknown) => unknown } }; dispatch: (tr: unknown) => void },
  parsed: { headers: string[]; rows: string[][] },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = (view.state as any).schema
  const buildCell = (text: string, isHeader: boolean) => {
    const type = isHeader ? schema.nodes.tableHeader : schema.nodes.tableCell
    const para = schema.nodes.paragraph.create({}, text ? [schema.text(text)] : [])
    return type.create({ colspan: 1, rowspan: 1 }, para)
  }
  const headerRow = schema.nodes.tableRow.create({}, parsed.headers.map((h) => buildCell(h, true)))
  const dataRows = parsed.rows
    .filter((r) => r.length > 0)
    .map((row) =>
      schema.nodes.tableRow.create(
        {},
        Array.from({ length: parsed.headers.length }, (_, i) => buildCell(row[i] ?? '', false)),
      ),
    )
  const tableNode = schema.nodes.table.create({}, [headerRow, ...dataRows])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tr = (view.state as any).tr.replaceSelectionWith(tableNode)
  view.dispatch(tr)
}

/** Scan all text nodes and apply link marks to bare URLs */
function linkifyDocument(editor: ReturnType<typeof useEditor>) {
  if (!editor) return
  const { state } = editor
  const linkType = state.schema.marks['link']
  if (!linkType) return
  const { tr } = state
  let modified = false

  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    URL_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = URL_REGEX.exec(node.text)) !== null) {
      const from = pos + match.index
      const to = from + match[0].length
      // Skip if already has a link mark
      if (state.doc.rangeHasMark(from, to, linkType)) continue
      tr.addMark(from, to, linkType.create({ href: match[0] }))
      modified = true
    }
  })

  if (modified) editor.view.dispatch(tr)
}

interface BlockEditorProps {
  content?: Record<string, unknown>
  onChange?: (content: Record<string, unknown>) => void
  editable?: boolean
  placeholder?: string
  showToolbar?: boolean
  projectId?: string
  onRequestEntityCreate?: (type: 'task' | 'note' | 'budget') => void
  insertEntity?: { id: string; label: string; type: 'task' | 'note' | 'budget' } | null
  onInsertEntityDone?: () => void
  onRequestSourceInsert?: () => void
  insertSource?: { filename: string; url: string } | null
  onInsertSourceDone?: () => void
  onAttachmentClick?: (attachmentId: string) => void
  /** When present, the editor binds to a shared Yjs document (real-time co-editing). */
  collab?: { doc: Y.Doc; provider: HocuspocusProvider; user: { name: string; color: string } }
}

/** Determine whether href is an internal app link (React Router) */
function isInternalLink(href: string): boolean {
  if (href.startsWith('/api/')) return false   // API proxy — open in new tab
  if (href.startsWith('/')) return true
  try {
    const url = new URL(href)
    return url.origin === window.location.origin && !url.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

/** Extract pathname+search+hash from href for React Router */
function toLocalPath(href: string): string {
  if (href.startsWith('/')) return href
  try {
    const url = new URL(href)
    return url.pathname + url.search + url.hash
  } catch {
    return href
  }
}

export function BlockEditor({
  content,
  onChange,
  editable = true,
  placeholder,
  showToolbar = true,
  projectId,
  onRequestEntityCreate,
  insertEntity,
  onInsertEntityDone,
  onRequestSourceInsert,
  insertSource,
  onInsertSourceDone,
  onAttachmentClick,
  collab,
}: BlockEditorProps) {
  const navigate = useNavigate()
  const t = useT()
  const { language } = useLanguageStore()
  const { currentWorkspaceId: workspaceId } = useWorkspaceStore()

  const [slashMenu, setSlashMenu] = useState<{ open: boolean; query: string; pos: { x: number; y: number } }>({
    open: false,
    query: '',
    pos: { x: 0, y: 0 },
  })
  const [aiWrite, setAiWrite] = useState<{ action: AiWriteAction; contextText: string; replaceFrom: number; replaceTo: number } | null>(null)
  const [aiImageOpen, setAiImageOpen] = useState(false)
  const [imageInsertOpen, setImageInsertOpen] = useState(false)
  const [aiAudioOpen, setAiAudioOpen] = useState(false)
  const [barcodeOpen, setBarcodeOpen] = useState(false)
  const [barcodeInitTab, setBarcodeInitTab] = useState<'qr' | 'barcode'>('qr')
  const [pageLinkOpen, setPageLinkOpen] = useState(false)
  const [noteEmbedOpen, setNoteEmbedOpen] = useState(false)
  const [pageEmbedOpen, setPageEmbedOpen] = useState(false)
  const savedPosRef = useRef<number | null>(null)
  const [selectionBtn, setSelectionBtn] = useState<{ text: string; x: number; y: number } | null>(null)
  const [aiMenuOpen, setAiMenuOpen] = useState(false)

  // Run an AI writing action straight on the current selection (replaces it).
  function runAiOnSelection(action: AiWriteAction) {
    if (!editor || !selectionBtn) return
    const { from, to } = editor.state.selection
    setAiWrite({ action, contextText: selectionBtn.text, replaceFrom: from, replaceTo: to })
    setAiMenuOpen(false)
    setSelectionBtn(null)
  }

  // AI research on the selection → hand off to the agentic AI panel, which can
  // web-search and create new page(s) via its tools. Reuses ai:open so we get
  // the full agent (search + create_page) instead of a one-shot rewrite.
  function runResearchOnSelection() {
    if (!selectionBtn) return
    const topic = selectionBtn.text.trim()
    const prompt = language === 'en'
      ? `Research this topic in depth and create one or more new pages in the current project with the findings (well-structured, with headings and sources where relevant). Topic:\n\n"${topic}"`
      : language === 'be'
        ? `Правядзі глыбокае даследаванне па гэтай тэме і стварыдзі адну ці некалькі новых старонак у бягучым праекце з вынікамі (добра структураваных, з загалоўкамі і крыніцамі дзе дарэчна). Тэма:\n\n"${topic}"`
        : `Проведи глубокое исследование по этой теме и создай одну или несколько новых страниц в текущем проекте с результатами (хорошо структурированных, с заголовками и источниками где уместно). Тема:\n\n"${topic}"`
    document.dispatchEvent(new CustomEvent('ai:open', { detail: { prompt } }))
    setAiMenuOpen(false)
    setSelectionBtn(null)
  }

  // Link input state (shown in toolbar when editing a link)
  const [linkInput, setLinkInput] = useState<{ open: boolean; value: string }>({ open: false, value: '' })
  const linkInputRef = useRef<HTMLInputElement>(null)
  const [isTableActive, setIsTableActive] = useState(false)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const colorPickerRef = useRef<HTMLDivElement>(null)

  /** Navigate to href — internal via router, external in new tab */
  const followLink = useCallback((href: string) => {
    if (!href) return
    // Attachment content links — open in FileViewer
    const attachMatch = href.match(/\/api\/v1\/attachments\/([^/]+)\/content/)
    if (attachMatch) {
      onAttachmentClick?.(attachMatch[1])
      return
    }
    if (isInternalLink(href)) {
      navigate(toLocalPath(href))
    } else {
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }, [navigate, onAttachmentClick])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        // Collaboration brings its own (Yjs) undo/redo — the built-in history
        // must be off, otherwise they conflict.
        ...(collab ? { history: false } : {}),
      }),
      Placeholder.configure({ placeholder: placeholder ?? t.editorToolbar.placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          class: 'link-mark',
          rel: 'noopener noreferrer',
        },
      }),
      ImageResize.configure({ projectId }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      CodeBlockLowlight.configure({ lowlight }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
      FontSizeExtension,
      IframeExtension,
      DrawingBlockExtension,
      EntityRefExtension,
      MapBlockExtension,
      MermaidBlockExtension,
      MathBlockExtension,
      SvgBlockExtension,
      AudioBlockExtension,
      CalloutBlockExtension,
      NoteEmbedExtension,
      PageEmbedExtension,
      ...(collab
        ? [
            Collaboration.configure({ document: collab.doc, field: 'default' }),
            CollaborationCursor.configure({ provider: collab.provider, user: collab.user }),
          ]
        : []),
    ],
    // In collab mode the Yjs document is the source of truth — don't seed
    // initial content (it would duplicate on top of the synced doc).
    content: collab ? undefined : content,
    editable,
    onCreate({ editor }) {
      // Retroactively linkify plain-text URLs in loaded content
      setTimeout(() => linkifyDocument(editor), 0)
    },
    onUpdate({ editor }) {
      linkifyDocument(editor)
      onChange?.(editor.getJSON() as Record<string, unknown>)
      setIsTableActive(editor.isActive('table'))
    },
    onSelectionUpdate({ editor }) {
      setIsTableActive(editor.isActive('table'))
      if (!editable) return
      const { from, to } = editor.state.selection
      if (from === to) { setSelectionBtn(null); setAiMenuOpen(false); return }
      const text = editor.state.doc.textBetween(from, to, '\n').trim()
      if (!text || editor.isActive('link') || editor.isActive('codeBlock')) { setSelectionBtn(null); setAiMenuOpen(false); return }
      const coords = editor.view.coordsAtPos(to)
      setSelectionBtn({ text, x: coords.left, y: coords.bottom + 6 })
      setAiMenuOpen(false)
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none',
      },
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement
        const anchor = target.closest('a[href]') as HTMLAnchorElement | null
        if (!anchor) return false
        const href = anchor.getAttribute('href')
        if (!href) return false
        event.preventDefault()
        followLink(href)
        return true
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain') ?? ''
        const parsed = parseMarkdownTable(text)
        if (!parsed) return false
        event.preventDefault()
        insertMarkdownTableNode(view as Parameters<typeof insertMarkdownTableNode>[0], parsed)
        return true
      },
      handleKeyDown(view, event) {
        if (event.key === '/') {
          const { from } = view.state.selection
          const coords = view.coordsAtPos(from)
          const menuHeight = 320
          const spaceBelow = window.innerHeight - coords.bottom
          const y = spaceBelow < menuHeight
            ? coords.top - menuHeight - 4
            : coords.bottom + 8
          setSlashMenu({ open: true, query: '', pos: { x: coords.left, y } })
        } else if (event.key === 'Escape') {
          setSlashMenu((s) => ({ ...s, open: false }))
          return false
        } else if (slashMenu.open) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
            return true
          }
          if (event.key === 'Backspace') {
            setSlashMenu((s) => {
              const q = s.query.slice(0, -1)
              return q === '' ? { ...s, open: false, query: '' } : { ...s, query: q }
            })
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            setSlashMenu((s) => ({ ...s, query: s.query + event.key }))
          }
        }
        return false
      },
    },
  })

  useEffect(() => {
    // In collab mode content is driven by Yjs, never by the prop.
    if (collab) return
    if (!editor || editor.isFocused) return
    // Sanitize first: an empty text node anywhere makes ProseMirror reject the
    // whole doc, so the page renders blank. Comparing against the sanitized copy
    // (not the raw content) keeps the effect from looping.
    const safe = sanitizeDocContent(content ?? { type: 'doc', content: [] }) as Record<string, unknown>
    const current = JSON.stringify(editor.getJSON())
    const incoming = JSON.stringify(safe)
    if (current !== incoming) {
      try {
        editor.commands.setContent(safe, false)
      } catch { /* leave the editor as-is rather than crash */ }
    }
  }, [content, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Collab seeding: when a page is opened in collab mode for the first time the
  // shared Yjs doc is empty (the server doesn't seed). The first client fills it
  // from page.content with the full editor schema (preserves all custom nodes).
  const seededRef = useRef(false)
  useEffect(() => {
    if (!collab || !editor || seededRef.current) return
    const trySeed = () => {
      if (seededRef.current || !editor.isEmpty) return
      const body = (content?.content as unknown[] | undefined) ?? []
      const hasBody = body.length > 1 || (body.length === 1 && JSON.stringify(body[0]).length > 40)
      if (!hasBody) return
      const meta = collab.doc.getMap('_seed')
      if (meta.get('done')) return
      meta.set('done', true)
      seededRef.current = true
      try {
        editor.commands.setContent(sanitizeDocContent(content) as Record<string, unknown>, false)
      } catch { /* ignore */ }
    }
    // The provider is already synced by the time collab mode renders, but guard anyway.
    trySeed()
    collab.provider.on('synced', trySeed)
    return () => { collab.provider.off('synced', trySeed) }
  }, [collab, editor, content])


  useEffect(() => {
    if (!onRequestEntityCreate) return
    const handler = (e: Event) => {
      const type = (e as CustomEvent).detail?.type as 'task' | 'note' | 'budget'
      if (type) onRequestEntityCreate(type)
    }
    document.addEventListener('editor:create-entity', handler)
    return () => document.removeEventListener('editor:create-entity', handler)
  }, [onRequestEntityCreate])

  // editor:insert-source from slash command → call parent callback
  useEffect(() => {
    if (!onRequestSourceInsert) return
    const handler = () => onRequestSourceInsert()
    document.addEventListener('editor:insert-source', handler)
    return () => document.removeEventListener('editor:insert-source', handler)
  }, [onRequestSourceInsert])

  // editor:insert-image from slash command → save cursor pos and open upload/URL modal
  useEffect(() => {
    const handler = () => {
      if (editor) savedPosRef.current = editor.state.selection.from
      setImageInsertOpen(true)
    }
    document.addEventListener('editor:insert-image', handler)
    return () => document.removeEventListener('editor:insert-image', handler)
  }, [editor])

  // editor:ai-image from slash command → save cursor pos and open modal
  useEffect(() => {
    const handler = () => {
      if (editor) savedPosRef.current = editor.state.selection.from
      setAiImageOpen(true)
    }
    document.addEventListener('editor:ai-image', handler)
    return () => document.removeEventListener('editor:ai-image', handler)
  }, [editor])


  // editor:ai-audio from slash command → save cursor pos and open modal
  useEffect(() => {
    const handler = () => {
      if (editor) savedPosRef.current = editor.state.selection.from
      setAiAudioOpen(true)
    }
    document.addEventListener('editor:ai-audio', handler)
    return () => document.removeEventListener('editor:ai-audio', handler)
  }, [editor])

  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab ?? 'qr'
      if (editor) savedPosRef.current = editor.state.selection.from
      setBarcodeInitTab(tab)
      setBarcodeOpen(true)
    }
    document.addEventListener('editor:barcode', handler)
    return () => document.removeEventListener('editor:barcode', handler)
  }, [editor])

  // editor:page-link from slash command → save cursor pos and open picker
  useEffect(() => {
    const handler = () => {
      if (editor) savedPosRef.current = editor.state.selection.from
      setPageLinkOpen(true)
    }
    document.addEventListener('editor:page-link', handler)
    return () => document.removeEventListener('editor:page-link', handler)
  }, [editor])

  // editor:note-embed from slash command → open note picker for embed block
  useEffect(() => {
    const handler = () => {
      if (editor) savedPosRef.current = editor.state.selection.from
      setNoteEmbedOpen(true)
    }
    document.addEventListener('editor:note-embed', handler)
    return () => document.removeEventListener('editor:note-embed', handler)
  }, [editor])

  // editor:page-embed from slash command → open page picker for embed block
  useEffect(() => {
    const handler = () => {
      if (editor) savedPosRef.current = editor.state.selection.from
      setPageEmbedOpen(true)
    }
    document.addEventListener('editor:page-embed', handler)
    return () => document.removeEventListener('editor:page-embed', handler)
  }, [editor])

  // editor:ai-write from slash command → capture context and open AI writing panel
  useEffect(() => {
    const handler = (e: Event) => {
      if (!editor) return
      const action = (e as CustomEvent<{ action: AiWriteAction }>).detail?.action
      if (!action) return
      const { state } = editor
      const { from } = state.selection
      let contextText = ''
      let replaceFrom = from
      let replaceTo = from

      if (action === 'continue') {
        contextText = state.doc.textBetween(0, from, '\n').trim()
      } else {
        // No selection (slash-triggered) — use the current block as context.
        const { $from } = state.selection
        const start = $from.start($from.depth)
        const end = $from.end($from.depth)
        contextText = state.doc.textBetween(start, end, '\n').trim()
        replaceFrom = start
        replaceTo = end
      }

      if (!contextText) return
      setAiWrite({ action, contextText, replaceFrom, replaceTo })
    }
    document.addEventListener('editor:ai-write', handler)
    return () => document.removeEventListener('editor:ai-write', handler)
  }, [editor])

  // insertSource prop → insert image / PDF / link depending on file type
  useEffect(() => {
    if (!editor || !insertSource) return
    const ext = insertSource.filename.split('.').pop()?.toLowerCase() ?? ''
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)
    const isPdf = ext === 'pdf'
    if (isImage) {
      editor.chain().focus().insertContent({ type: 'image', attrs: { src: insertSource.url, alt: insertSource.filename } }).run()
    } else if (isPdf) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(editor.chain().focus() as any).insertIframe({ src: insertSource.url, height: '500' }).run()
    } else {
      editor.chain().focus().insertContent({
        type: 'text',
        marks: [{ type: 'link', attrs: { href: insertSource.url, target: '_blank' } }],
        text: insertSource.filename,
      }).run()
    }
    onInsertSourceDone?.()
  }, [insertSource]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle Excel table insertion from slash command
  useEffect(() => {
    if (!editor) return
    const handler = (e: Event) => {
      const rows = (e as CustomEvent).detail?.rows as string[][] | undefined
      if (!rows?.length) return
      const content = rows.map((row, ri) => ({
        type: 'tableRow',
        content: row.map((cell) => ({
          type: ri === 0 ? 'tableHeader' : 'tableCell',
          attrs: {},
          content: [{ type: 'paragraph', content: [{ type: 'text', text: String(cell ?? '') }] }],
        })),
      }))
      editor.chain().focus().insertContent({
        type: 'table',
        content,
      }).run()
    }
    document.addEventListener('editor:insert-table', handler)
    return () => document.removeEventListener('editor:insert-table', handler)
  }, [editor])

  // Convert selected markdown table text to native TipTap table
  useEffect(() => {
    if (!editor) return
    const handler = () => {
      const { from, to } = editor.state.selection
      const selectedText = from === to
        ? editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n')
        : editor.state.doc.textBetween(from, to, '\n')
      const parsed = parseMarkdownTable(selectedText)
      if (!parsed) {
        alert(t.editorToolbar.tableParseError)
        return
      }
      // Build table via insertContent to use TipTap's command system
      const tableContent = {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: parsed.headers.map((h) => ({
              type: 'tableHeader',
              attrs: { colspan: 1, rowspan: 1 },
              content: [{ type: 'paragraph', content: h ? [{ type: 'text', text: h }] : [] }],
            })),
          },
          ...parsed.rows
            .filter((r) => r.length > 0)
            .map((row) => ({
              type: 'tableRow',
              content: Array.from({ length: parsed.headers.length }, (_, i) => ({
                type: 'tableCell',
                attrs: { colspan: 1, rowspan: 1 },
                content: [{ type: 'paragraph', content: row[i] ? [{ type: 'text', text: row[i] }] : [] }],
              })),
            })),
        ],
      }
      if (from === to) {
        // No selection — just insert at cursor
        editor.chain().focus().insertContent(tableContent).run()
      } else {
        // Replace selected text with table
        editor.chain().focus().deleteRange({ from, to }).insertContent(tableContent).run()
      }
    }
    document.addEventListener('editor:convert-md-table', handler)
    return () => document.removeEventListener('editor:convert-md-table', handler)
  }, [editor])

  useEffect(() => {
    if (!editor || !insertEntity) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(editor.chain().focus() as any)
      .insertEntityRef({ entityType: insertEntity.type, entityId: insertEntity.id, label: insertEntity.label })
      .run()
    onInsertEntityDone?.()
  }, [insertEntity]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus link input when opened
  useEffect(() => {
    if (linkInput.open) {
      setTimeout(() => linkInputRef.current?.focus(), 50)
    }
  }, [linkInput.open])

  const handleSlashCommand = useCallback(
    (cmd: { command: (e: typeof editor) => void }) => {
      if (!editor) return
      const { from } = editor.state.selection
      editor
        .chain()
        .focus()
        .deleteRange({ from: from - 1 - slashMenu.query.length, to: from })
        .run()
      setSlashMenu((s) => ({ ...s, open: false, query: '' }))
      setTimeout(() => cmd.command(editor), 0)
    },
    [editor, slashMenu.query],
  )

  const FONT_SIZES = ['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px', '48px']
  const PRESET_COLORS = [
    '#ffffff', '#e2e8f0', '#94a3b8', '#475569', '#1e293b',
    '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#6366f1',
  ]

  useEffect(() => {
    if (!colorPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [colorPickerOpen])

  function openLinkInput() {
    if (!editor) return
    const existing = editor.getAttributes('link').href ?? ''
    setLinkInput({ open: true, value: existing })
  }

  function applyLink() {
    if (!editor) return
    const href = linkInput.value.trim()
    if (href) {
      editor.chain().focus().setLink({ href }).run()
    } else {
      editor.chain().focus().unsetLink().run()
    }
    setLinkInput({ open: false, value: '' })
  }

  function removeLinkInBubble() {
    editor?.chain().focus().unsetLink().run()
  }

  if (!editor) return null

  // Current link href (if cursor is inside a link)
  const currentLinkHref = editor.getAttributes('link').href as string | undefined

  return (
    <div className="relative">
      {/* ── Toolbars (sticky wrapper keeps both visible on scroll) */}
      {editable && (
        <div className="sticky top-0 z-10 space-y-1 mb-1">
        {showToolbar && (
        <div className="flex items-center gap-0.5 flex-wrap px-1 py-1.5 bg-surface-900 border border-slate-800 rounded-lg editor-toolbar">
          <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title={t.editorToolbar.h1}>
            <Heading1 size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title={t.editorToolbar.h2}>
            <Heading2 size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title={t.editorToolbar.h3}>
            <Heading3 size={14} />
          </ToolbarBtn>

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          {/* Font size */}
          <select
            value={editor.getAttributes('textStyle').fontSize ?? ''}
            onChange={(e) => {
              const v = e.target.value
              if (v) editor.chain().focus().setFontSize(v).run()
              else editor.chain().focus().unsetFontSize().run()
            }}
            className="h-6 px-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-300 focus:outline-none focus:border-slate-500 cursor-pointer"
            title={t.editorToolbar.fontSize}
          >
            <option value="">—</option>
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>{s.replace('px', '')}</option>
            ))}
          </select>

          {/* Text color */}
          <div className="relative" ref={colorPickerRef}>
            <button
              onClick={() => setColorPickerOpen((o) => !o)}
              className="w-6 h-6 rounded flex items-center justify-center hover:bg-slate-700 transition-colors"
              title={t.editorToolbar.textColor}
            >
              <span className="text-xs font-bold" style={{ color: editor.getAttributes('textStyle').color ?? 'currentColor', textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>A</span>
            </button>
            {colorPickerOpen && (
              <div className="absolute top-8 left-0 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-2 w-44">
                <div className="grid grid-cols-5 gap-1 mb-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => { editor.chain().focus().setColor(c).run(); setColorPickerOpen(false) }}
                      className="w-6 h-6 rounded border border-slate-600 hover:scale-110 transition-transform"
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    defaultValue={editor.getAttributes('textStyle').color ?? '#ffffff'}
                    onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
                    className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                    title={t.editorTools.customColor}
                  />
                  <button
                    onClick={() => { editor.chain().focus().unsetColor().run(); setColorPickerOpen(false) }}
                    className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {t.editorToolbar.reset}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title={t.editorToolbar.bold}>
            <Bold size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title={t.editorToolbar.italic}>
            <Italic size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title={t.editorToolbar.strike}>
            <Strikethrough size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title={t.editorToolbar.code}>
            <Code size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title={t.editorToolbar.highlight}>
            <Highlighter size={14} />
          </ToolbarBtn>

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title={t.editorToolbar.bulletList}>
            <List size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title={t.editorToolbar.orderedList}>
            <ListOrdered size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title={t.editorToolbar.taskList}>
            <CheckSquare size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title={t.editorToolbar.quote}>
            <Quote size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().insertContent([{ type: 'horizontalRule' }, { type: 'paragraph' }]).run()} active={false} title={t.editorToolbar.divider}>
            <Minus size={14} />
          </ToolbarBtn>

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title={t.editorToolbar.alignLeft}>
            <AlignLeft size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title={t.editorToolbar.alignCenter}>
            <AlignCenter size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title={t.editorToolbar.alignRight}>
            <AlignRight size={14} />
          </ToolbarBtn>

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          {/* Table button */}
          <ToolbarBtn
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            active={editor.isActive('table')}
            title={t.editorToolbar.table}
          >
            <TableIcon size={14} />
          </ToolbarBtn>

          {/* Map button */}
          <ToolbarBtn
            onClick={() => {
              const input = window.prompt(t.editorToolbar.mapPrompt)
              if (!input?.trim()) return
              const { url, provider, label } = toMapEmbedUrl(input.trim())
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ;(editor.chain().focus() as any).insertMapBlock({ src: url, provider, label }).run()
            }}
            active={editor.isActive('mapBlock')}
            title={t.editorToolbar.map}
          >
            <MapPin size={14} />
          </ToolbarBtn>

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          {/* Link button — shows inline input */}
          {linkInput.open ? (
            <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-md px-1.5 py-0.5">
              <LinkIcon size={12} className="text-slate-400 flex-shrink-0" />
              <input
                ref={linkInputRef}
                value={linkInput.value}
                onChange={(e) => setLinkInput((s) => ({ ...s, value: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); applyLink() }
                  if (e.key === 'Escape') setLinkInput({ open: false, value: '' })
                }}
                placeholder="https://..."
                className="bg-transparent text-xs text-slate-200 outline-none w-44 placeholder:text-slate-500"
              />
              <button onMouseDown={(e) => { e.preventDefault(); applyLink() }} className="text-green-400 hover:text-green-300">
                <Check size={13} />
              </button>
              <button onMouseDown={(e) => { e.preventDefault(); setLinkInput({ open: false, value: '' }) }} className="text-slate-500 hover:text-slate-300">
                <X size={13} />
              </button>
            </div>
          ) : (
            <ToolbarBtn onClick={openLinkInput} active={editor.isActive('link')} title={t.editorToolbar.link}>
              <LinkIcon size={14} />
            </ToolbarBtn>
          )}
        </div>
        )}

        {/* ── Table context toolbar */}
        <div className={`flex items-center gap-0.5 flex-wrap px-1 py-1 bg-surface-950 border border-slate-700 rounded-lg text-[11px] ${isTableActive ? '' : 'hidden'}`}>
          <span className="text-slate-500 text-[10px] px-1">{t.common.table}:</span>
          <ToolbarBtn onClick={() => editor.chain().focus().addRowBefore().run()} active={false} title={t.common.rowAbove}>
            <RowsIcon size={12} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().addRowAfter().run()} active={false} title={t.common.rowBelow}>
            <RowsIcon size={12} className="rotate-180" />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().deleteRow().run()} active={false} title={t.common.deleteRow}>
            <Trash size={12} className="text-red-400" />
          </ToolbarBtn>
          <div className="w-px h-3 bg-slate-700 mx-0.5" />
          <ToolbarBtn onClick={() => editor.chain().focus().addColumnBefore().run()} active={false} title={t.common.colLeft}>
            <Columns3 size={12} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().addColumnAfter().run()} active={false} title={t.common.colRight}>
            <Columns3 size={12} className="scale-x-[-1]" />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().deleteColumn().run()} active={false} title={t.common.deleteColumn}>
            <Trash size={12} className="text-red-400" />
          </ToolbarBtn>
          <div className="w-px h-3 bg-slate-700 mx-0.5" />
          <ToolbarBtn onClick={() => editor.chain().focus().mergeCells().run()} active={false} title={t.common.mergeCells}>
            <Merge size={12} />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor.chain().focus().splitCell().run()} active={false} title={t.common.splitCell}>
            <Split size={12} />
          </ToolbarBtn>
          <div className="w-px h-3 bg-slate-700 mx-0.5" />
          <ToolbarBtn onClick={() => editor.chain().focus().deleteTable().run()} active={false} title={t.common.deleteTable}>
            <TableIcon size={12} className="text-red-400" />
          </ToolbarBtn>
        </div>
        </div>
      )}

      {/* ── Link bubble — shows when cursor is inside a link ──── */}
      <BubbleMenu
        editor={editor}
        tippyOptions={{ duration: 100, placement: 'bottom' }}
        shouldShow={({ editor }) => editor.isActive('link')}
        className="flex items-center gap-1 bg-surface-900 border border-slate-700 rounded-lg shadow-xl px-2 py-1.5"
      >
        {currentLinkHref && (
          <>
            {/* URL preview (truncated) */}
            <span className="text-xs text-primary-400 max-w-[200px] truncate" title={currentLinkHref}>
              {currentLinkHref}
            </span>
            <div className="w-px h-3 bg-slate-700" />
            {/* Open link */}
            <button
              onMouseDown={(e) => { e.preventDefault(); followLink(currentLinkHref) }}
              className="p-1 text-slate-400 hover:text-slate-100 rounded"
              title={isInternalLink(currentLinkHref) ? t.common.navigateToDoc : t.common.openInNewTab}
            >
              <ExternalLink size={13} />
            </button>
            {/* Edit link (only in edit mode) */}
            {editable && (
              <button
                onMouseDown={(e) => { e.preventDefault(); openLinkInput() }}
                className="p-1 text-slate-400 hover:text-slate-100 rounded"
                title={t.common.editLink}
              >
                <Pencil size={13} />
              </button>
            )}
            {/* Remove link (only in edit mode) */}
            {editable && (
              <button
                onMouseDown={(e) => { e.preventDefault(); removeLinkInBubble() }}
                className="p-1 text-slate-400 hover:text-red-400 rounded"
                title={t.common.deleteLink}
              >
                <Trash2 size={13} />
              </button>
            )}
          </>
        )}
      </BubbleMenu>

      {/* ── Code block copy bubble ────────────────────────────── */}
      {editable && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 80, placement: 'top-end', offset: [0, 6] }}
          shouldShow={({ editor }) => editor.isActive('codeBlock')}
          className="flex items-center bg-slate-800 border border-slate-700 rounded-lg shadow-xl px-1.5 py-1"
        >
          <CodeCopyBubbleBtn editor={editor} />
        </BubbleMenu>
      )}

      {/* ── AI actions on text selection — pick a command, applies at once ── */}
      {editable && selectionBtn && (
        <div style={{ position: 'fixed', left: selectionBtn.x, top: selectionBtn.y, zIndex: 9999 }}>
          {!aiMenuOpen ? (
            <button
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setAiMenuOpen(true) }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg shadow-xl text-xs font-semibold text-white bg-primary-600 hover:bg-primary-500 transition-colors"
            >
              <Sparkles size={12} /> AI
            </button>
          ) : (
            <div
              onMouseDown={(e) => e.preventDefault()}
              className="flex flex-col min-w-[230px] bg-surface-900 border border-slate-700 rounded-lg shadow-2xl py-1 text-sm"
            >
              {/* Research → new page (agentic) */}
              <button
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); runResearchOnSelection() }}
                title={t.editor.aiWrite.researchHint}
                className="flex items-center gap-2 px-3 py-2 text-left font-medium text-slate-100 hover:bg-primary-600/25 transition-colors"
              >
                <Telescope size={14} className="flex-shrink-0 text-primary-400" />
                {t.editor.aiWrite.research}
              </button>
              {/* Explain → shows an explanation you can optionally insert (does not replace the selection) */}
              <button
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); runAiOnSelection('explain') }}
                className="flex items-center gap-2 px-3 py-2 text-left font-medium text-slate-100 hover:bg-primary-600/25 transition-colors"
              >
                <HelpCircle size={14} className="flex-shrink-0 text-primary-400" />
                {t.editor.aiWrite.explain}
              </button>
              <div className="border-t my-1" style={{ borderColor: 'var(--border-subtle)' }} />
              {(['improve', 'shorter', 'longer', 'summarize', 'translate'] as const).map((a) => (
                <button
                  key={a}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); runAiOnSelection(a) }}
                  className="flex items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-primary-600/25 hover:text-white transition-colors"
                >
                  <Sparkles size={13} className="flex-shrink-0 text-primary-400" />
                  {t.editor.aiWrite[a]}
                </button>
              ))}
              <div className="border-t my-1" style={{ borderColor: 'var(--border-subtle)' }} />
              <button
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setAiMenuOpen(false); setSelectionBtn(null) }}
                className="flex items-center gap-2 px-3 py-1.5 text-left text-slate-400 hover:bg-slate-700/40 hover:text-slate-200 transition-colors"
              >
                <X size={13} className="flex-shrink-0" />
                {t.editor.aiWrite.cancel}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Slash command menu ─────────────────────────────────── */}
      {slashMenu.open && (
        <SlashCommandMenu
          query={slashMenu.query}
          position={slashMenu.pos}
          onSelect={handleSlashCommand}
          onClose={() => setSlashMenu((s) => ({ ...s, open: false }))}
        />
      )}

      {/* ── Image insert modal (URL / upload) ─────────────────── */}
      {imageInsertOpen && (
        <ImageInsertModal
          projectId={projectId}
          onInsert={(url) => {
            if (!editor) return
            const pos = savedPosRef.current ?? editor.state.selection.from
            editor.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src: url } }).run()
          }}
          onClose={() => setImageInsertOpen(false)}
        />
      )}

      {/* ── AI image generation modal ──────────────────────────── */}
      {aiImageOpen && (
        <AiImageModal
          projectId={projectId}
          onInsert={(url) => {
            if (!editor) return
            const pos = savedPosRef.current ?? editor.state.selection.from
            editor.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src: url } }).run()
          }}
          onClose={() => setAiImageOpen(false)}
        />
      )}

      {/* ── AI video generation modal ──────────────────────────── */}

      {/* ── AI audio generation modal ─────────────────────────── */}
      {aiAudioOpen && (
        <AiAudioModal
          onInsert={(url) => {
            if (!editor) return
            const pos = savedPosRef.current ?? editor.state.selection.from
            editor.chain().focus().insertContentAt(pos, { type: 'audioBlock', attrs: { src: url, title: 'AI Audio' } }).run()
          }}
          onClose={() => setAiAudioOpen(false)}
        />
      )}

      {/* ── Barcode / QR modal ────────────────────────────────── */}
      {barcodeOpen && (
        <BarcodeModal
          initialTab={barcodeInitTab}
          onInsert={(dataUrl) => {
            if (!editor) return
            const pos = savedPosRef.current ?? editor.state.selection.from
            editor.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src: dataUrl } }).run()
          }}
          onClose={() => setBarcodeOpen(false)}
        />
      )}

      {/* ── Page link picker ──────────────────────────────────── */}
      {pageLinkOpen && (
        <PageLinkModal
          projectId={projectId}
          onSelect={(page) => {
            if (!editor) return
            const pos = savedPosRef.current ?? editor.state.selection.from
            editor.chain().focus().insertContentAt(pos, {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: `/pages/${page.id}` } }],
              text: stripLeadingEmoji(page.title) || t.embed.untitled,
            }).run()
            setPageLinkOpen(false)
          }}
          onClose={() => setPageLinkOpen(false)}
        />
      )}

      {/* ── Note embed picker ─────────────────────────────────── */}
      {noteEmbedOpen && (
        <NoteEmbedModal
          workspaceId={workspaceId}
          onSelect={(noteId) => {
            if (!editor) return
            const pos = savedPosRef.current ?? editor.state.selection.from
            editor.chain().focus().insertContentAt(pos, { type: 'noteEmbed', attrs: { noteId, height: 200 } }).run()
            setNoteEmbedOpen(false)
          }}
          onClose={() => setNoteEmbedOpen(false)}
        />
      )}

      {/* ── Page embed picker ─────────────────────────────────── */}
      {pageEmbedOpen && (
        <PageEmbedModal
          projectId={projectId}
          onSelect={(pageId) => {
            if (!editor) return
            const pos = savedPosRef.current ?? editor.state.selection.from
            editor.chain().focus().insertContentAt(pos, { type: 'pageEmbed', attrs: { pageId, height: 200 } }).run()
            setPageEmbedOpen(false)
          }}
          onClose={() => setPageEmbedOpen(false)}
        />
      )}

      {/* ── AI writing panel ──────────────────────────────────── */}
      {aiWrite && (
        <AiWritingPanel
          action={aiWrite.action}
          contextText={aiWrite.contextText}
          onInsert={(text) => {
            if (!editor) return
            if (aiWrite.action === 'explain') {
              // Keep the selected term; add the explanation right after it as a new paragraph.
              editor.chain().focus().insertContentAt(aiWrite.replaceTo, `\n\n${text}`).run()
            } else if (aiWrite.replaceFrom === aiWrite.replaceTo) {
              editor.chain().focus().insertContentAt(aiWrite.replaceFrom, text).run()
            } else {
              editor.chain().focus().deleteRange({ from: aiWrite.replaceFrom, to: aiWrite.replaceTo })
                .insertContentAt(aiWrite.replaceFrom, text).run()
            }
            setAiWrite(null)
          }}
          onDiscard={() => setAiWrite(null)}
        />
      )}

      {/* ── Editor ────────────────────────────────────────────── */}
      <EditorContent editor={editor} />
    </div>
  )
}

function ToolbarBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      className={cn(
        'p-1.5 rounded-md transition-colors',
        active ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700',
      )}
    >
      {children}
    </button>
  )
}

function CodeCopyBubbleBtn({ editor }: { editor: ReturnType<typeof import('@tiptap/react').useEditor> }) {
  const [copied, setCopied] = useState(false)
  const t = useT()

  function handleCopy() {
    if (!editor) return
    const { from } = editor.state.selection
    const resolved = editor.state.doc.resolve(from)
    let text = ''
    for (let d = resolved.depth; d >= 0; d--) {
      const n = resolved.node(d)
      if (n.type.name === 'codeBlock') { text = n.textContent; break }
    }
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); handleCopy() }}
      className="flex items-center gap-1.5 px-2 py-0.5 text-xs rounded transition-colors text-slate-400 hover:text-slate-100"
      title={t.common.copyCode}
    >
      {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
      <span>{copied ? t.common.copied : t.common.copy}</span>
    </button>
  )
}

function PageLinkModal({
  projectId,
  onSelect,
  onClose,
}: {
  projectId?: string
  onSelect: (page: PageMeta) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useT()

  const { data: pages = [] } = useQuery({
    queryKey: ['pages-list', projectId],
    queryFn: () => (projectId ? pageApi.listByProject(projectId) : Promise.resolve([])),
    staleTime: 30_000,
    enabled: !!projectId,
  })

  const filtered = pages.filter((p) =>
    (p.title || '').toLowerCase().includes(query.toLowerCase()),
  )

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface-900 border border-slate-700 rounded-xl shadow-2xl w-96 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.common.searchPage}
            className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {!projectId && (
            <p className="text-xs text-slate-500 text-center py-4">{t.common.openProjectPageFirst}</p>
          )}
          {projectId && filtered.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-4">{t.common.pagesNotFound}</p>
          )}
          {filtered.map((page) => (
            <button
              key={page.id}
              onMouseDown={(e) => { e.preventDefault(); onSelect(page) }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            >
              <span className="text-base">{page.icon ?? '📄'}</span>
              <span className="text-sm truncate">{stripLeadingEmoji(page.title) || t.common.untitled}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function NoteEmbedModal({
  workspaceId,
  onSelect,
  onClose,
}: {
  workspaceId: string | null
  onSelect: (noteId: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: notes = [] } = useQuery({
    queryKey: ['notes-embed-picker', workspaceId],
    queryFn: () => (workspaceId ? noteApi.list({ workspaceId }) : Promise.resolve([])),
    staleTime: 30_000,
    enabled: !!workspaceId,
  })

  const filtered = (notes as Note[]).filter((n) => {
    if (!query) return true
    const text = n.tags.join(' ') + ' ' + JSON.stringify(n.content)
    return text.toLowerCase().includes(query.toLowerCase())
  })

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface-900 border border-slate-700 rounded-xl shadow-2xl w-96 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <span className="text-slate-500 text-sm">🗒</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.editorToolbar.searchNote}
            className="flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {!workspaceId && <p className="text-xs text-slate-500 text-center py-4">{t.editorToolbar.noWorkspace}</p>}
          {workspaceId && filtered.length === 0 && <p className="text-xs text-slate-500 text-center py-4">{t.editorToolbar.notesNotFound}</p>}
          {filtered.slice(0, 30).map((note) => {
            const preview = note.tags.length > 0 ? note.tags.join(', ') : new Date(note.updatedAt).toLocaleDateString()
            return (
              <button
                key={note.id}
                onMouseDown={(e) => { e.preventDefault(); onSelect(note.id) }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
              >
                <span className="text-base flex-shrink-0">🗒</span>
                <span className="text-sm truncate flex-1">{preview}</span>
                <span className="text-[10px] text-slate-600 flex-shrink-0">{new Date(note.updatedAt).toLocaleDateString()}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function PageEmbedModal({
  projectId,
  onSelect,
  onClose,
}: {
  projectId?: string
  onSelect: (pageId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useT()

  const { data: pages = [] } = useQuery({
    queryKey: ['pages-embed-picker', projectId],
    queryFn: () => (projectId ? pageApi.listByProject(projectId) : Promise.resolve([])),
    staleTime: 30_000,
    enabled: !!projectId,
  })

  const filtered = pages.filter((p) => (p.title || '').toLowerCase().includes(query.toLowerCase()))

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface-900 border border-slate-700 rounded-xl shadow-2xl w-96 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <span className="text-slate-500 text-sm">📄</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.editorToolbar.searchPageEmbed}
            className="flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {!projectId && <p className="text-xs text-slate-500 text-center py-4">{t.common.openProjectPageFirst}</p>}
          {projectId && filtered.length === 0 && <p className="text-xs text-slate-500 text-center py-4">{t.common.pagesNotFound}</p>}
          {filtered.map((page) => (
            <button
              key={page.id}
              onMouseDown={(e) => { e.preventDefault(); onSelect(page.id) }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            >
              <span className="text-base">{page.icon ?? '📄'}</span>
              <span className="text-sm truncate">{stripLeadingEmoji(page.title) || t.common.untitled}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
