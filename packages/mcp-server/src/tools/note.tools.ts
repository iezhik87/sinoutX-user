import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as api from '../client.js'

function textToTipTap(text: string) {
  return {
    type: 'doc',
    content: text
      .split('\n\n')
      .filter(Boolean)
      .map((para) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: para }],
      })),
  }
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

export function registerNoteTools(server: McpServer) {
  server.tool(
    'sinout_list_notes',
    'List notes in a workspace',
    {
      workspaceId: z.string().describe('Workspace ID'),
      pinned: z.boolean().optional().describe('Filter only pinned notes'),
    },
    async ({ workspaceId, pinned }) => {
      const data = await api.notes.list({ workspaceId, pinned })
      const summary = data.map((n: Record<string, unknown>) => ({
        id: n.id,
        preview: extractText(n.content as Record<string, unknown>).slice(0, 120),
        pinned: n.pinned,
        tags: n.tags,
        updatedAt: n.updatedAt,
      }))
      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_get_note',
    'Get full note content by ID',
    {
      noteId: z.string().describe('Note ID'),
    },
    async ({ noteId }) => {
      const note = await api.notes.getById(noteId)
      const text = note.content ? extractText(note.content) : ''
      return {
        content: [
          {
            type: 'text',
            text: `${text}\n\n---\n_ID: ${note.id} | Pinned: ${note.pinned} | Tags: ${note.tags?.join(', ') || 'none'} | Updated: ${note.updatedAt}_`,
          },
        ],
      }
    },
  )

  server.tool(
    'sinout_create_note',
    'Create a new note in a workspace',
    {
      workspaceId: z.string().describe('Workspace ID'),
      content: z.string().optional().describe('Note content as plain text'),
      tags: z.array(z.string()).optional().describe('Tags for the note'),
      pinned: z.boolean().optional().default(false).describe('Pin the note'),
    },
    async ({ workspaceId, content, tags, pinned }) => {
      const richContent = content ? textToTipTap(content) : undefined
      const note = await api.notes.create({ workspaceId, content: richContent, tags, pinned })
      return {
        content: [{ type: 'text', text: JSON.stringify(note, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_update_note',
    'Update note content or metadata',
    {
      noteId: z.string().describe('Note ID'),
      content: z.string().optional().describe('New content as plain text'),
      tags: z.array(z.string()).optional().describe('New tags'),
      pinned: z.boolean().optional().describe('Pin or unpin the note'),
    },
    async ({ noteId, content, tags, pinned }) => {
      const updates: Record<string, unknown> = {}
      if (content !== undefined) updates.content = textToTipTap(content)
      if (tags !== undefined) updates.tags = tags
      if (pinned !== undefined) updates.pinned = pinned
      const note = await api.notes.update(noteId, updates)
      return {
        content: [{ type: 'text', text: JSON.stringify(note, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_delete_note',
    'Delete a note',
    {
      noteId: z.string().describe('Note ID'),
    },
    async ({ noteId }) => {
      await api.notes.delete(noteId)
      return {
        content: [{ type: 'text', text: `Note ${noteId} deleted successfully.` }],
      }
    },
  )
}
