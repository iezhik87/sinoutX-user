// Markdown and HTML → TipTap JSON converters for Notion and Obsidian import

type Mark = { type: string; attrs?: Record<string, unknown> }
type TNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TNode[]
  text?: string
  marks?: Mark[]
}
export type TDoc = { type: 'doc'; content: TNode[] }

// ─── HTML utilities ───────────────────────────────────────────────────────────

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n)))
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
}

// ─── Inline markdown parser ───────────────────────────────────────────────────

function parseInline(raw: string): TNode[] {
  if (!raw) return []
  const result: TNode[] = []
  let i = 0
  const s = raw

  const addText = (text: string, marks: Mark[] = []) => {
    if (!text) return
    result.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text })
  }

  while (i < s.length) {
    // Image: ![alt](url)
    if (s[i] === '!' && s[i + 1] === '[') {
      const closeAlt = s.indexOf(']', i + 2)
      if (closeAlt !== -1 && s[closeAlt + 1] === '(') {
        const closeUrl = s.indexOf(')', closeAlt + 2)
        if (closeUrl !== -1) {
          result.push({ type: 'image', attrs: { src: s.slice(closeAlt + 2, closeUrl), alt: s.slice(i + 2, closeAlt) } })
          i = closeUrl + 1
          continue
        }
      }
    }

    // Wikilink: [[title|display]] or [[title]]
    if (s[i] === '[' && s[i + 1] === '[') {
      const close = s.indexOf(']]', i + 2)
      if (close !== -1) {
        const inner = s.slice(i + 2, close)
        const pipe = inner.indexOf('|')
        addText(pipe !== -1 ? inner.slice(pipe + 1) : inner)
        i = close + 2
        continue
      }
    }

    // Link: [text](url)
    if (s[i] === '[') {
      const closeText = s.indexOf(']', i + 1)
      if (closeText !== -1 && s[closeText + 1] === '(') {
        const closeUrl = s.indexOf(')', closeText + 2)
        if (closeUrl !== -1) {
          addText(s.slice(i + 1, closeText), [{ type: 'link', attrs: { href: s.slice(closeText + 2, closeUrl) } }])
          i = closeUrl + 1
          continue
        }
      }
    }

    // Bold+Italic: ***text***
    if (s.slice(i, i + 3) === '***') {
      const end = s.indexOf('***', i + 3)
      if (end !== -1) { addText(s.slice(i + 3, end), [{ type: 'bold' }, { type: 'italic' }]); i = end + 3; continue }
    }

    // Bold: **text**
    if (s.slice(i, i + 2) === '**') {
      const end = s.indexOf('**', i + 2)
      if (end !== -1) { addText(s.slice(i + 2, end), [{ type: 'bold' }]); i = end + 2; continue }
    }

    // Strike: ~~text~~
    if (s.slice(i, i + 2) === '~~') {
      const end = s.indexOf('~~', i + 2)
      if (end !== -1) { addText(s.slice(i + 2, end), [{ type: 'strike' }]); i = end + 2; continue }
    }

    // Bold: __text__
    if (s.slice(i, i + 2) === '__') {
      const end = s.indexOf('__', i + 2)
      if (end !== -1) { addText(s.slice(i + 2, end), [{ type: 'bold' }]); i = end + 2; continue }
    }

    // Italic: *text* (not **)
    if (s[i] === '*' && s[i + 1] !== '*') {
      const end = s.indexOf('*', i + 1)
      if (end !== -1 && s[end + 1] !== '*') { addText(s.slice(i + 1, end), [{ type: 'italic' }]); i = end + 1; continue }
    }

    // Italic: _text_ (not __)
    if (s[i] === '_' && s[i + 1] !== '_') {
      const end = s.indexOf('_', i + 1)
      if (end !== -1 && s[end + 1] !== '_') { addText(s.slice(i + 1, end), [{ type: 'italic' }]); i = end + 1; continue }
    }

    // Code: `text`
    if (s[i] === '`' && s[i + 1] !== '`') {
      const end = s.indexOf('`', i + 1)
      if (end !== -1) { addText(s.slice(i + 1, end), [{ type: 'code' }]); i = end + 1; continue }
    }

    // Accumulate plain text until next special char
    let j = i + 1
    while (j < s.length && !'*_~`[!'.includes(s[j])) j++
    addText(s.slice(i, j))
    i = j
  }

  return result.filter(n => n.type !== 'text' || (n.text ?? '').length > 0)
}

// ─── Markdown block parser ────────────────────────────────────────────────────

function parseListBlock(lines: string[], listType: 'bullet' | 'ordered' | 'task'): TNode {
  const items: TNode[] = []
  for (const line of lines) {
    let text = ''
    let checked = false
    if (listType === 'task') {
      const m = line.match(/^[-*]\s+\[([ x])\]\s*(.*)/)
      checked = m ? m[1] === 'x' : false
      text = m ? m[2] : line.replace(/^[-*+]\s+/, '')
    } else if (listType === 'ordered') {
      text = line.replace(/^\d+\.\s+/, '')
    } else {
      text = line.replace(/^[-*+]\s+/, '')
    }
    const itemContent: TNode[] = [{ type: 'paragraph', content: parseInline(text) }]
    items.push(listType === 'task'
      ? { type: 'taskItem', attrs: { checked }, content: itemContent }
      : { type: 'listItem', content: itemContent })
  }
  if (listType === 'task') return { type: 'taskList', content: items }
  if (listType === 'ordered') return { type: 'orderedList', content: items }
  return { type: 'bulletList', content: items }
}

export function markdownToTipTap(markdown: string): TDoc {
  const content: TNode[] = []
  const text = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') // strip frontmatter
  const lines = text.split(/\r?\n/)
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    // Fenced code block
    if (line.match(/^```/)) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].match(/^```/)) { codeLines.push(lines[i]); i++ }
      i++
      content.push({ type: 'codeBlock', attrs: { language: lang || null }, content: [{ type: 'text', text: codeLines.join('\n') }] })
      continue
    }

    // Heading
    const hm = line.match(/^(#{1,6})\s+(.+)/)
    if (hm) {
      content.push({ type: 'heading', attrs: { level: hm[1].length }, content: parseInline(hm[2]) })
      i++; continue
    }

    // Horizontal rule
    if (line.match(/^([-*_])\1{2,}\s*$/)) {
      content.push({ type: 'horizontalRule' })
      i++; continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('> ')) { quoteLines.push(lines[i].slice(2)); i++ }
      const inner = markdownToTipTap(quoteLines.join('\n'))
      content.push({ type: 'blockquote', content: inner.content })
      continue
    }

    // Task list
    if (line.match(/^[-*]\s+\[[ x]\]/)) {
      const taskLines: string[] = []
      while (i < lines.length && lines[i].match(/^[-*]\s+\[[ x]\]/)) { taskLines.push(lines[i]); i++ }
      content.push(parseListBlock(taskLines, 'task'))
      continue
    }

    // Unordered list
    if (line.match(/^[-*+]\s+/)) {
      const listLines: string[] = []
      while (i < lines.length && lines[i].match(/^[-*+]\s+/)) { listLines.push(lines[i]); i++ }
      content.push(parseListBlock(listLines, 'bullet'))
      continue
    }

    // Ordered list
    if (line.match(/^\d+\.\s+/)) {
      const listLines: string[] = []
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) { listLines.push(lines[i]); i++ }
      content.push(parseListBlock(listLines, 'ordered'))
      continue
    }

    // Paragraph — collect consecutive non-special lines
    const paraLines: string[] = []
    while (
      i < lines.length && lines[i].trim() &&
      !lines[i].match(/^#{1,6}\s/) && !lines[i].match(/^```/) &&
      !lines[i].startsWith('> ') && !lines[i].match(/^[-*+]\s/) &&
      !lines[i].match(/^\d+\.\s/) && !lines[i].match(/^([-*_])\1{2,}\s*$/)
    ) { paraLines.push(lines[i]); i++ }

    if (paraLines.length > 0) {
      const inline = parseInline(paraLines.join(' '))
      if (inline.length > 0) content.push({ type: 'paragraph', content: inline })
    } else {
      i++
    }
  }

  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }] }
}

// ─── HTML parser (Notion HTML export) ────────────────────────────────────────

function parseInlineHtml(html: string): TNode[] {
  const md = html
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '_$1_')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '_$1_')
    .replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '~~$1~~')
    .replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '~~$1~~')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  return parseInline(decodeHtmlEntities(md))
}

export function htmlToTipTap(html: string): TDoc {
  const content: TNode[] = []

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')

  const bodyMatch = body.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) body = bodyMatch[1]

  const blockRe = /<(h[1-6]|p|ul|ol|pre|blockquote|figure|div)([^>]*)>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi
  let match: RegExpExecArray | null

  while ((match = blockRe.exec(body)) !== null) {
    if (!match[1]) { content.push({ type: 'horizontalRule' }); continue }
    const tag = match[1].toLowerCase()
    const inner = match[3] ?? ''

    if (tag.match(/^h[1-6]$/)) {
      const text = stripTags(inner).trim()
      if (text) content.push({ type: 'heading', attrs: { level: parseInt(tag[1]) }, content: [{ type: 'text', text }] })

    } else if (tag === 'p') {
      const nodes = parseInlineHtml(inner)
      if (nodes.length > 0) content.push({ type: 'paragraph', content: nodes })

    } else if (tag === 'ul' || tag === 'ol') {
      const items: TNode[] = []
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi
      let liMatch: RegExpExecArray | null
      while ((liMatch = liRe.exec(inner)) !== null) {
        const nodes = parseInlineHtml(liMatch[1])
        if (nodes.length > 0) items.push({ type: 'listItem', content: [{ type: 'paragraph', content: nodes }] })
      }
      if (items.length > 0) content.push({ type: tag === 'ul' ? 'bulletList' : 'orderedList', content: items })

    } else if (tag === 'pre') {
      const cm = inner.match(/<code[^>]*>([\s\S]*?)<\/code>/i)
      const code = decodeHtmlEntities(stripTags(cm ? cm[1] : inner))
      if (code.trim()) content.push({ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: code }] })

    } else if (tag === 'blockquote') {
      const nodes = parseInlineHtml(inner)
      if (nodes.length > 0) content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: nodes }] })

    } else if (tag === 'figure') {
      const imgM = inner.match(/<img[^>]+src="([^"]+)"[^>]*(?:alt="([^"]*)")?/i)
      if (imgM) content.push({ type: 'image', attrs: { src: imgM[1], alt: imgM[2] ?? '' } })

    } else if (tag === 'div') {
      // Extract paragraphs from Notion's wrapper divs
      const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi
      let pM: RegExpExecArray | null
      while ((pM = pRe.exec(inner)) !== null) {
        const nodes = parseInlineHtml(pM[1])
        if (nodes.length > 0) content.push({ type: 'paragraph', content: nodes })
      }
    }
  }

  // Fallback: plain text extraction
  if (content.length === 0) {
    const plain = decodeHtmlEntities(stripTags(html))
    for (const p of plain.split(/\n\n+/).map(s => s.trim()).filter(Boolean)) {
      content.push({ type: 'paragraph', content: [{ type: 'text', text: p }] })
    }
  }

  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }] }
}
