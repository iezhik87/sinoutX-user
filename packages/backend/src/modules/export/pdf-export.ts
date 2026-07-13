/* eslint-disable @typescript-eslint/no-var-requires */
// pdfmake browser build works fine in Node.js via require()
const pdfMakeLib = require('pdfmake/build/pdfmake') as {
  createPdf: (def: unknown) => { getBuffer: (cb: (data: Uint8Array) => void) => void }
  vfs: unknown
}
const vfsFonts = require('pdfmake/build/vfs_fonts') as {
  pdfMake?: { vfs: unknown }
  vfs?: unknown
}
pdfMakeLib.vfs = (vfsFonts.pdfMake ?? vfsFonts).vfs

import { screenshotMapEmbed } from './map-screenshot.js'

async function fetchMapImage(src: string): Promise<string | null> {
  const buf = await screenshotMapEmbed(src)
  if (!buf) return null
  return `data:image/png;base64,${buf.toString('base64')}`
}

async function fetchImageBase64(src: string): Promise<string | null> {
  try {
    const url = src.startsWith('/') ? `http://localhost:3010${src}` : src
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get('content-type') ?? 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch { return null }
}

type TNode = {
  type: string
  text?: string
  content?: TNode[]
  marks?: { type: string; attrs?: Record<string, string> }[]
  attrs?: Record<string, unknown>
}

// pdfmake content types (simplified)
type PdfText = { text: string | PdfInline[]; bold?: boolean; italics?: boolean; fontSize?: number; color?: string; font?: string; decoration?: string; link?: string }
type PdfInline = string | PdfText
type PdfContent = PdfInline | { ul?: PdfContent[]; ol?: PdfContent[] } | { text: PdfInline[]; style?: string; margin?: number[]; lineHeight?: number; color?: string; background?: string }

// ─── Inline content ──────────────────────────────────────

function getInlineContent(node: TNode): PdfInline[] {
  if (node.type === 'text') {
    const text = node.text ?? ''
    const marks = node.marks ?? []
    if (!marks.length) return [text]

    let bold = false, italics = false, decoration: string | undefined, isCode = false, link: string | undefined, strike = false
    for (const m of marks) {
      if (m.type === 'bold') bold = true
      else if (m.type === 'italic') italics = true
      else if (m.type === 'underline') decoration = 'underline'
      else if (m.type === 'strike') strike = true
      else if (m.type === 'code') isCode = true
      else if (m.type === 'link') link = m.attrs?.href
    }
    if (strike) decoration = 'lineThrough'

    const item: PdfText = {
      text,
      ...(bold && { bold }),
      ...(italics && { italics }),
      ...(decoration && { decoration }),
      ...(isCode && { fontSize: 9, color: '7c6af7', background: '#f1f5f9' }),
      ...(link && { link, color: '5842dc', decoration: 'underline' }),
    }
    return [item]
  }
  if (node.type === 'hardBreak') return ['\n']
  return (node.content ?? []).flatMap(c => getInlineContent(c))
}

// ─── Block content ────────────────────────────────────────

async function processNode(node: TNode, depth = 0): Promise<PdfContent[]> {
  switch (node.type) {
    case 'doc':
      return (await Promise.all((node.content ?? []).map(c => processNode(c)))).flat()

    case 'heading': {
      const level = (node.attrs?.level as number) ?? 1
      const sizes: Record<number, number> = { 1: 22, 2: 17, 3: 14, 4: 12 }
      const inline = (node.content ?? []).flatMap(c => getInlineContent(c))
      return [{
        text: inline,
        bold: true,
        fontSize: sizes[level] ?? 12,
        color: '#1a1a2e',
        margin: [0, level === 1 ? 16 : 10, 0, 4],
      } as PdfContent]
    }

    case 'paragraph': {
      const inline = (node.content ?? []).flatMap(c => getInlineContent(c))
      if (!inline.length) return [{ text: ' ', margin: [0, 0, 0, 4] } as PdfContent]
      return [{ text: inline, margin: [0, 0, 0, 6] } as PdfContent]
    }

    case 'image': {
      const src = node.attrs?.src as string
      if (!src) return []
      const dataUrl = await fetchImageBase64(src)
      if (!dataUrl) return [{ text: `[Image: ${src}]`, italics: true, color: '#888888', margin: [0, 4, 0, 8] } as unknown as PdfContent]
      const widthAttr = node.attrs?.width as string | undefined
      const w = widthAttr && widthAttr !== 'auto' ? Math.min(parseInt(widthAttr) || 400, 500) : 400
      return [{ image: dataUrl, width: w, margin: [0, 4, 0, 8] } as unknown as PdfContent]
    }

    case 'bulletList': {
      const items = (node.content ?? []).flatMap(c => getListItemContent(c))
      return [{ ul: items } as PdfContent]
    }

    case 'orderedList': {
      const items = (node.content ?? []).flatMap(c => getListItemContent(c))
      return [{ ol: items } as PdfContent]
    }

    case 'taskList': {
      const itemsArr = await Promise.all((node.content ?? []).map(async c => {
        const checked = (c.attrs?.checked as boolean) ?? false
        const children = (await Promise.all((c.content ?? []).map(ch => processNode(ch)))).flat()
        return [{ text: (checked ? '☑  ' : '☐  '), color: checked ? '#5842dc' : '#94a3b8' } as PdfContent, ...children]
      }))
      return itemsArr.flat()
    }

    case 'blockquote': {
      const inner = (await Promise.all((node.content ?? []).map(c => processNode(c)))).flat()
      return inner.map(item => {
        if (typeof item === 'object' && 'text' in item) {
          return { ...item as object, margin: [16, 0, 0, 6], color: '#5050a0' } as PdfContent
        }
        return item
      })
    }

    case 'codeBlock': {
      const code = (node.content ?? []).map(c => c.text ?? '').join('')
      return [{
        text: code,
        fontSize: 9,
        background: '#f1f5f9',
        color: '#334155',
        margin: [0, 4, 0, 8],
        lineHeight: 1.4,
      } as PdfContent]
    }

    case 'horizontalRule':
      return [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#cccccc' }] } as unknown as PdfContent]

    case 'mapBlock': {
      const src = node.attrs?.src as string | undefined
      const label = node.attrs?.label as string | undefined
      const display = label ?? 'Карта'
      if (src) {
        const dataUrl = await fetchMapImage(src)
        if (dataUrl) {
          return [{ image: dataUrl, width: 480, margin: [0, 4, 0, 8] } as unknown as PdfContent]
        }
        return [{ text: [{ text: '🗺  ' }, { text: display, link: src, color: '#5842dc', decoration: 'underline' }], margin: [0, 4, 0, 8] } as unknown as PdfContent]
      }
      return [{ text: `🗺 [${display}]`, italics: true, color: '#888888', margin: [0, 4, 0, 8] } as PdfContent]
    }

    case 'iframe': {
      const src = node.attrs?.src as string | undefined
      if (src) {
        return [{ text: [{ text: '🔗  ' }, { text: src, link: src, color: '#5842dc', decoration: 'underline' }], margin: [0, 4, 0, 8] } as unknown as PdfContent]
      }
      return []
    }

    default:
      return (await Promise.all((node.content ?? []).map(c => processNode(c, depth)))).flat()
  }
}

function getListItemContent(node: TNode): PdfContent[] {
  return (node.content ?? []).flatMap(c => {
    if (c.type === 'paragraph') {
      const inline = (c.content ?? []).flatMap(ch => getInlineContent(ch))
      return inline.length ? [{ text: inline } as PdfContent] : []
    }
    return []
  })
}

// ─── Public API ──────────────────────────────────────────

export async function tipTapToPdfBuffer(
  title: string,
  content: Record<string, unknown>,
): Promise<Buffer> {
  const bodyContent = await processNode(content as unknown as TNode)

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [60, 60, 60, 60],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 11,
      lineHeight: 1.5,
      color: '#1a1a2e',
    },
    content: [
      {
        text: title,
        fontSize: 26,
        bold: true,
        color: '#1a1a2e',
        margin: [0, 0, 0, 20],
      },
      ...bodyContent,
    ],
    styles: {
      header: { fontSize: 22, bold: true, margin: [0, 16, 0, 4] },
      subheader: { fontSize: 17, bold: true, margin: [0, 10, 0, 4] },
    },
  }

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const pdfDoc = pdfMakeLib.createPdf(docDefinition)
      pdfDoc.getBuffer((data: Uint8Array) => {
        resolve(Buffer.from(data))
      })
    } catch (err) {
      reject(err)
    }
  })
}
