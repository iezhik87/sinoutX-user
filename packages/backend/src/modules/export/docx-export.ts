import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  ExternalHyperlink, BorderStyle, AlignmentType, ImageRun,
} from 'docx'

import { screenshotMapEmbed } from './map-screenshot.js'

async function fetchImageBuffer(src: string): Promise<Buffer | null> {
  try {
    const url = src.startsWith('/') ? `http://localhost:3010${src}` : src
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch { return null }
}

type TNode = {
  type: string
  text?: string
  content?: TNode[]
  marks?: { type: string; attrs?: Record<string, string> }[]
  attrs?: Record<string, unknown>
}

// ─── Inline runs ──────────────────────────────────────────

function getInlineRuns(node: TNode): (TextRun | ExternalHyperlink)[] {
  if (node.type === 'text') {
    const text = node.text ?? ''
    let bold = false, italics = false, strike = false, underline = false, isCode = false
    let href: string | undefined
    for (const m of (node.marks ?? [])) {
      if (m.type === 'bold') bold = true
      else if (m.type === 'italic') italics = true
      else if (m.type === 'strike') strike = true
      else if (m.type === 'underline') underline = true
      else if (m.type === 'code') isCode = true
      else if (m.type === 'link') href = m.attrs?.href
    }
    const run = new TextRun({
      text,
      bold,
      italics,
      strike,
      underline: underline ? {} : undefined,
      font: isCode ? 'Courier New' : undefined,
      color: isCode ? '7c6af7' : undefined,
      size: isCode ? 20 : undefined,
    })
    if (href) {
      return [new ExternalHyperlink({ link: href, children: [run] })]
    }
    return [run]
  }
  if (node.type === 'hardBreak') return [new TextRun({ break: 1 })]
  return (node.content ?? []).flatMap(c => getInlineRuns(c))
}

// ─── Block nodes ──────────────────────────────────────────

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
]

async function processNode(node: TNode, listDepth = 0, isBlockquote = false): Promise<Paragraph[]> {
  const bqStyle = isBlockquote
    ? {
        indent: { left: 720 },
        border: {
          left: { style: BorderStyle.SINGLE, size: 16, color: '7c6af7', space: 8 },
        },
      }
    : {}

  switch (node.type) {
    case 'doc':
      return (await Promise.all((node.content ?? []).map(c => processNode(c)))).flat()

    case 'heading': {
      const level = Math.max(1, Math.min(6, (node.attrs?.level as number) ?? 1))
      return [
        new Paragraph({
          heading: HEADING_LEVELS[level - 1],
          children: (node.content ?? []).flatMap(c => getInlineRuns(c)),
          spacing: { before: 200, after: 100 },
        }),
      ]
    }

    case 'paragraph': {
      const children = (node.content ?? []).flatMap(c => getInlineRuns(c))
      if (!children.length) return [new Paragraph({ ...bqStyle, children: [new TextRun('')] })]
      return [new Paragraph({ ...bqStyle, children, spacing: { after: 80 } })]
    }

    case 'image': {
      const src = node.attrs?.src as string
      if (!src) return []
      const buf = await fetchImageBuffer(src)
      if (!buf) return [new Paragraph({ children: [new TextRun({ text: `[Image: ${src}]`, color: '888888', italics: true })], spacing: { after: 80 } })]
      const widthAttr = node.attrs?.width as string | undefined
      const widthPx = widthAttr && widthAttr !== 'auto' ? Math.min(parseInt(widthAttr) || 400, 600) : 400
      return [new Paragraph({
        children: [new ImageRun({ data: buf, transformation: { width: widthPx, height: Math.round(widthPx * 0.6) } })],
        spacing: { after: 120 },
      })]
    }

    case 'bulletList':
    case 'taskList':
      return (await Promise.all((node.content ?? []).map(c => processListItem(c, 'bullet', 0, listDepth)))).flat()

    case 'orderedList': {
      let idx = 0
      return (await Promise.all((node.content ?? []).map(c => processListItem(c, 'ordered', ++idx, listDepth)))).flat()
    }

    case 'listItem':
      return processListItem(node, 'bullet', 0, listDepth)

    case 'taskItem':
      return processListItem(node, 'task', 0, listDepth, node.attrs?.checked as boolean)

    case 'blockquote':
      return (await Promise.all((node.content ?? []).map(c => processNode(c, listDepth, true)))).flat()

    case 'codeBlock': {
      const code = (node.content ?? []).map(c => c.text ?? '').join('')
      return code.split('\n').map(line =>
        new Paragraph({
          children: [new TextRun({ text: line || ' ', font: 'Courier New', size: 18, color: '334155' })],
          indent: { left: 360 },
          shading: { fill: 'F1F5F9' },
          spacing: { after: 0, before: 0 },
        }),
      )
    }

    case 'horizontalRule':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 1 } },
          children: [],
          spacing: { before: 120, after: 120 },
        }),
      ]

    case 'mapBlock': {
      const src = node.attrs?.src as string | undefined
      const label = node.attrs?.label as string | undefined
      const text = `[${label ?? 'Карта'}]`
      if (src) {
        const buf = await screenshotMapEmbed(src)
        if (buf) {
          return [new Paragraph({
            children: [new ImageRun({ data: buf, transformation: { width: 480, height: 240 } })],
            spacing: { before: 80, after: 80 },
          })]
        }
        return [new Paragraph({
          children: [
            new TextRun({ text: '🗺 ', size: 22 }),
            new ExternalHyperlink({ link: src, children: [new TextRun({ text, color: '5842dc', underline: {} })] }),
          ],
          spacing: { before: 80, after: 80 },
        })]
      }
      return [new Paragraph({ children: [new TextRun({ text: `🗺 ${text}`, color: '888888', italics: true })], spacing: { after: 80 } })]
    }

    case 'iframe': {
      const src = node.attrs?.src as string | undefined
      if (src) {
        return [new Paragraph({
          children: [
            new TextRun({ text: '🔗 ' }),
            new ExternalHyperlink({ link: src, children: [new TextRun({ text: src, color: '5842dc', underline: {} })] }),
          ],
          spacing: { before: 80, after: 80 },
        })]
      }
      return []
    }

    case 'table':
      return (await Promise.all((node.content ?? []).map(row =>
        Promise.all((row.content ?? []).map(cell =>
          Promise.all((cell.content ?? []).map(c => processNode(c))).then(r => r.flat()),
        )).then(r => r.flat()),
      ))).flat()

    default:
      return (await Promise.all((node.content ?? []).map(c => processNode(c, listDepth, isBlockquote)))).flat()
  }
}

async function processListItem(
  node: TNode,
  type: 'bullet' | 'ordered' | 'task',
  index: number,
  depth: number,
  checked?: boolean,
): Promise<Paragraph[]> {
  const prefix =
    type === 'task' ? (checked ? '☑  ' : '☐  ') :
    type === 'ordered' ? `${index}.  ` :
    '•  '
  const indentLeft = 360 + depth * 360

  const paras: Paragraph[] = []
  let isFirst = true
  for (const child of (node.content ?? [])) {
    if (isFirst && (child.type === 'paragraph' || child.type === 'taskItem')) {
      const runs = (child.content ?? []).flatMap(c => getInlineRuns(c))
      paras.push(
        new Paragraph({
          indent: { left: indentLeft, hanging: 360 },
          children: [new TextRun({ text: prefix }), ...runs],
          spacing: { after: 40 },
        }),
      )
      isFirst = false
    } else if (child.type === 'bulletList' || child.type === 'taskList' || child.type === 'orderedList') {
      paras.push(...await processNode(child, depth + 1))
    } else {
      paras.push(...await processNode(child, depth))
    }
  }
  return paras
}

// ─── Public API ──────────────────────────────────────────

export async function tipTapToDocxBuffer(
  title: string,
  content: Record<string, unknown>,
): Promise<Buffer> {
  const doc = new Document({
    title,
    description: 'Exported from Sinout',
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: title,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.LEFT,
            spacing: { after: 240 },
          }),
          ...await processNode(content as unknown as TNode),
        ],
      },
    ],
    styles: {
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          run: { size: 52, bold: true, color: '1a1a2e', font: 'Calibri' },
          paragraph: { spacing: { after: 240 } },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          run: { size: 36, bold: true, color: '1a1a2e' },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          run: { size: 28, bold: true, color: '334155' },
          paragraph: { spacing: { before: 200, after: 80 } },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          run: { size: 24, bold: true, color: '475569' },
          paragraph: { spacing: { before: 160, after: 60 } },
        },
      ],
    },
  })

  return Packer.toBuffer(doc)
}
