import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as api from '../client.js'

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] })

export function registerFileTools(server: McpServer) {
  // Upload a binary (PNG/XLSX/PDF/…) from base64 — migrate local files into SinoutX.
  server.tool(
    'sinout_upload_file',
    'Upload a binary file (PNG, XLSX, PDF, image, etc.) into SinoutX from base64. Stores it as an attachment in the workspace (optionally linked to a project). Use to migrate local files off disk into SinoutX. Returns the attachment id and url.',
    {
      filename: z.string().describe('File name with extension, e.g. chart.png'),
      base64: z.string().describe('File content, base64-encoded'),
      mimeType: z.string().optional().describe('e.g. image/png, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      workspaceId: z.string().describe('Target workspace'),
      projectId: z.string().optional().describe('Optional: link to a project'),
      description: z.string().optional(),
    },
    async ({ filename, base64, mimeType, workspaceId, projectId, description }) =>
      ok(await api.files.upload({ filename, base64, mimeType: mimeType || 'application/octet-stream', workspaceId, projectId, description })),
  )

  // List files.
  server.tool(
    'sinout_list_files',
    'List files (attachments) in a workspace or project. Pass workspaceId or projectId.',
    { workspaceId: z.string().optional(), projectId: z.string().optional() },
    async ({ workspaceId, projectId }) => ok(await api.files.list({ workspaceId, projectId })),
  )

  // Download a file as base64.
  server.tool(
    'sinout_get_file',
    'Download a file by attachment ID — returns its content as base64 (decode to use/parse, e.g. an XLSX or PNG) plus mimeType and size.',
    { id: z.string().describe('Attachment ID from sinout_list_files / sinout_upload_file') },
    async ({ id }) => {
      const f = await api.files.getContent(id)
      if (f.bytes > 12 * 1024 * 1024) return ok({ error: 'File too large to return inline (>12 MB) — use the download URL from sinout_list_files', mimeType: f.mimeType, bytes: f.bytes })
      return ok(f)
    },
  )

  // Delete a file.
  server.tool(
    'sinout_delete_file',
    'Delete a file (attachment) by ID.',
    { id: z.string() },
    async ({ id }) => { await api.files.remove(id); return ok({ deleted: id }) },
  )
}
