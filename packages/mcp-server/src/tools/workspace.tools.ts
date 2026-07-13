import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as api from '../client.js'

export function registerWorkspaceTools(server: McpServer) {
  server.tool(
    'sinout_list_workspaces',
    'List all workspaces in Sinout',
    {},
    async () => {
      const data = await api.workspaces.list()
      const safe = (data as Record<string, unknown>[]).map(({ settings: _s, ...rest }) => rest)
      return {
        content: [{ type: 'text', text: JSON.stringify(safe, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_create_workspace',
    'Create a new workspace',
    {
      name: z.string().min(1).describe('Workspace name'),
      description: z.string().optional().describe('Optional description'),
    },
    async ({ name, description }) => {
      const ws = await api.workspaces.create({ name, description })
      return {
        content: [{ type: 'text', text: JSON.stringify(ws, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_list_projects',
    'List projects in a workspace',
    {
      workspaceId: z.string().describe('Workspace ID'),
    },
    async ({ workspaceId }) => {
      const data = await api.projects.listByWorkspace(workspaceId)
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_create_project',
    'Create a new project inside a workspace',
    {
      workspaceId: z.string().describe('Workspace ID'),
      name: z.string().min(1).describe('Project name'),
      description: z.string().optional().describe('Optional description'),
    },
    async ({ workspaceId, name, description }) => {
      const project = await api.projects.create({ workspaceId, name, description })
      return {
        content: [{ type: 'text', text: JSON.stringify(project, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_get_workspace',
    'Get workspace details by ID',
    {
      workspaceId: z.string().describe('Workspace ID'),
    },
    async ({ workspaceId }) => {
      const ws = await api.workspaces.getById(workspaceId) as Record<string, unknown>
      const { settings: _s, ...safe } = ws
      return {
        content: [{ type: 'text', text: JSON.stringify(safe, null, 2) }],
      }
    },
  )
}
