import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as api from '../client.js'

type TipTapMark = { type: string; attrs?: Record<string, unknown> }
type TipTapNode = { type: string; attrs?: Record<string, unknown>; content?: TipTapNode[]; marks?: TipTapMark[]; text?: string }

function parseInline(text: string): TipTapNode[] {
  const result: TipTapNode[] = []
  const regex = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    }
    if (match[2] !== undefined) {
      result.push({ type: 'text', text: match[2], marks: [{ type: 'bold' }] })
    } else if (match[3] !== undefined) {
      result.push({ type: 'text', text: match[3], marks: [{ type: 'italic' }] })
    } else if (match[4] !== undefined) {
      result.push({ type: 'text', text: match[4], marks: [{ type: 'code' }] })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    result.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return result.length > 0 ? result : [{ type: 'text', text }]
}

function textToTipTap(text: string): TipTapNode {
  const lines = text.split('\n')
  const nodes: TipTapNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (headingMatch) {
      nodes.push({ type: 'heading', attrs: { level: headingMatch[1].length }, content: parseInline(headingMatch[2].trim()) })
      i++
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      nodes.push({ type: 'horizontalRule' })
      i++
      continue
    }

    // Bullet list
    if (/^[-*]\s+/.test(line)) {
      const items: TipTapNode[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: parseInline(lines[i].replace(/^[-*]\s+/, '')) }] })
        i++
      }
      nodes.push({ type: 'bulletList', content: items })
      continue
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: TipTapNode[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: parseInline(lines[i].replace(/^\d+\.\s+/, '')) }] })
        i++
      }
      nodes.push({ type: 'orderedList', content: items })
      continue
    }

    // Empty line
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph — collect consecutive non-special lines
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^[-*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length > 0) {
      nodes.push({ type: 'paragraph', content: parseInline(paraLines.join(' ')) })
    }
  }

  return { type: 'doc', content: nodes.length > 0 ? nodes : [{ type: 'paragraph' }] }
}

function extractText(doc: Record<string, unknown>): string {
  const parts: string[] = []
  function walk(node: Record<string, unknown>) {
    if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text)
    if (Array.isArray(node.content)) {
      for (const c of node.content as Record<string, unknown>[]) walk(c)
    }
  }
  walk(doc)
  return parts.join('\n')
}

export function registerPageTools(server: McpServer) {
  server.tool(
    'sinout_list_pages',
    'List all pages in a project (flat list)',
    {
      projectId: z.string().describe('Project ID'),
    },
    async ({ projectId }) => {
      const data = await api.pages.listByProject(projectId)
      const summary = data.map((p: Record<string, unknown>) => ({
        id: p.id,
        title: p.title,
        parentPageId: p.parentPageId ?? null,
        updatedAt: p.updatedAt,
      }))
      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_get_page_tree',
    'Get hierarchical page tree for a project (for navigation)',
    {
      projectId: z.string().describe('Project ID'),
    },
    async ({ projectId }) => {
      const tree = await api.pages.getTree(projectId)
      return {
        content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_get_page',
    'Get full content of a page by ID',
    {
      pageId: z.string().describe('Page ID'),
    },
    async ({ pageId }) => {
      const page = await api.pages.getById(pageId)
      const text = page.content ? extractText(page.content) : ''
      return {
        content: [
          {
            type: 'text',
            text: `# ${page.title}\n\n${text}\n\n---\n_ID: ${page.id} | Project: ${page.projectId} | Updated: ${page.updatedAt}_`,
          },
        ],
      }
    },
  )

  server.tool(
    'sinout_create_page',
    'Create a new page in a project. IMPORTANT: always pass the full content when you have information to write — never create a page with only a title if you have relevant data. The content field accepts plain text with newlines; it will be converted to rich text automatically.',
    {
      projectId: z.string().describe('Project ID'),
      title: z.string().min(1).describe('Page title'),
      content: z.string().optional().describe('Full page content as plain text with newlines. Include all research, analysis, sections and details here — do not leave empty if you have data to write.'),
      parentPageId: z.string().optional().describe('Parent page ID for nested pages'),
    },
    async ({ projectId, title, content, parentPageId }) => {
      const richContent = content ? textToTipTap(content) : undefined
      const page = await api.pages.create({ projectId, title, content: richContent, parentPageId })
      return {
        content: [{ type: 'text', text: JSON.stringify(page, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_update_page',
    'Update page title and/or content',
    {
      pageId: z.string().describe('Page ID'),
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content as plain text'),
    },
    async ({ pageId, title, content }) => {
      const updates: Record<string, unknown> = {}
      if (title) updates.title = title
      if (content) updates.content = textToTipTap(content)
      const page = await api.pages.update(pageId, updates)
      return {
        content: [{ type: 'text', text: JSON.stringify(page, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_delete_page',
    'Soft-delete a page and all its child pages',
    {
      pageId: z.string().describe('Page ID to delete'),
    },
    async ({ pageId }) => {
      await api.pages.delete(pageId)
      return {
        content: [{ type: 'text', text: `Page ${pageId} deleted successfully.` }],
      }
    },
  )

  server.tool(
    'sinout_create_spec',
    'Create a structured specification page for a feature or component. Generates a page with standard sections: Goal, Requirements, Technical Decisions, Implementation Plan, and Status. Optimized for coding agents to read and update as they implement.',
    {
      projectId: z.string().describe('Project ID'),
      title: z.string().min(1).describe('Specification title (e.g. "User Authentication", "Payment Module")'),
      goal: z.string().describe('What this feature/component should accomplish. 1-3 sentences.'),
      requirements: z.array(z.string()).describe('List of requirements or acceptance criteria'),
      techDecisions: z.array(z.string()).optional().describe('Key technical decisions: libraries, patterns, data models, APIs'),
      implementationPlan: z.array(z.string()).optional().describe('Step-by-step implementation plan'),
      status: z.enum(['draft', 'ready', 'in_progress', 'done', 'on_hold']).optional().default('draft').describe('Current status of this spec'),
      parentPageId: z.string().optional().describe('Parent page ID to nest this spec under'),
    },
    async ({ projectId, title, goal, requirements, techDecisions, implementationPlan, status, parentPageId }) => {
      const statusEmoji: Record<string, string> = {
        draft: '📝', ready: '✅', in_progress: '🔄', done: '🏁', on_hold: '⏸',
      }
      const statusLabel: Record<string, string> = {
        draft: 'Draft', ready: 'Ready', in_progress: 'In Progress', done: 'Done', on_hold: 'On Hold',
      }

      const lines: string[] = [
        `Status: ${statusEmoji[status ?? 'draft']} ${statusLabel[status ?? 'draft']}`,
        '',
        '## Goal',
        goal,
        '',
        '## Requirements',
        ...requirements.map((r) => `- ${r}`),
      ]

      if (techDecisions && techDecisions.length > 0) {
        lines.push('', '## Technical Decisions', ...techDecisions.map((d) => `- ${d}`))
      }

      if (implementationPlan && implementationPlan.length > 0) {
        lines.push('', '## Implementation Plan')
        implementationPlan.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
      }

      lines.push('', '## Implementation Notes', '_Empty — to be filled by the coding agent as work progresses._')

      const richContent = textToTipTap(lines.join('\n'))
      const page = await api.pages.create({
        projectId,
        title: `[SPEC] ${title}`,
        content: richContent,
        parentPageId,
      })

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...page,
                hint: 'Spec page created. Update the Implementation Notes section via sinout_update_page as you implement.',
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )
}
