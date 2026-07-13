import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as api from '../client.js'

export function registerCalendarTools(server: McpServer) {
  server.tool(
    'sinout_list_events',
    'List calendar events for a project or workspace',
    {
      projectId: z.string().optional().describe('Project ID'),
      workspaceId: z.string().optional().describe('Workspace ID'),
      from: z.string().optional().describe('Start date ISO string (e.g. 2025-01-01)'),
      to: z.string().optional().describe('End date ISO string (e.g. 2025-12-31)'),
    },
    async ({ projectId, workspaceId, from, to }) => {
      const data = await api.calendar.list({ projectId, workspaceId, from, to })
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_get_upcoming_events',
    'Get upcoming calendar events for a workspace',
    {
      workspaceId: z.string().describe('Workspace ID'),
      limit: z.number().int().min(1).max(50).optional().default(10).describe('Number of upcoming events'),
    },
    async ({ workspaceId, limit }) => {
      const data = await api.calendar.getUpcoming(workspaceId, limit)
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_create_event',
    'Create a new calendar event',
    {
      projectId: z.string().describe('Project ID'),
      title: z.string().min(1).describe('Event title'),
      startAt: z.string().describe('Start date/time in ISO format'),
      endAt: z.string().optional().describe('End date/time in ISO format'),
      allDay: z.boolean().optional().default(false).describe('Is this an all-day event?'),
      description: z.string().optional().describe('Event description'),
    },
    async ({ projectId, title, startAt, endAt, allDay, description }) => {
      const event = await api.calendar.create({ projectId, title, startAt, endAt, allDay, description })
      return {
        content: [{ type: 'text', text: JSON.stringify(event, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_update_event',
    'Update a calendar event',
    {
      eventId: z.string().describe('Event ID'),
      title: z.string().optional().describe('New title'),
      startAt: z.string().optional().describe('New start date/time in ISO format'),
      endAt: z.string().optional().describe('New end date/time in ISO format'),
      description: z.string().optional().describe('New description'),
    },
    async ({ eventId, title, startAt, endAt, description }) => {
      const updates: Record<string, unknown> = {}
      if (title) updates.title = title
      if (startAt) updates.startAt = startAt
      if (endAt) updates.endAt = endAt
      if (description) updates.description = description
      const event = await api.calendar.update(eventId, updates)
      return {
        content: [{ type: 'text', text: JSON.stringify(event, null, 2) }],
      }
    },
  )
}
