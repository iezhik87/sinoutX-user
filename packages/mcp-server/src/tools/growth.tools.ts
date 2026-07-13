import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as api from '../client.js'

function textToTipTap(text: string) {
  return {
    type: 'doc',
    content: text.split('\n\n').filter(Boolean).map((para) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: para }],
    })),
  }
}

const today = () => new Date().toISOString().slice(0, 10)

// Personal-growth tools: habits, OKR (objectives + key results), journal.
export function registerGrowthTools(server: McpServer) {
  server.tool(
    'sinout_create_habit',
    'Create a habit to track in a workspace',
    {
      workspaceId: z.string().describe('Workspace ID'),
      name: z.string().describe('Habit name'),
      description: z.string().optional().describe('Optional description'),
      period: z.enum(['forever', 'week', 'month', 'year']).optional().describe('Goal period (default forever)'),
      icon: z.string().optional().describe('Optional emoji icon'),
    },
    async ({ workspaceId, name, description, period, icon }) => {
      const habit = await api.habits.create(workspaceId, { name, description, period, icon })
      return { content: [{ type: 'text', text: JSON.stringify(habit, null, 2) }] }
    },
  )

  server.tool(
    'sinout_check_habit',
    'Mark a habit as done on a date (default today)',
    {
      habitId: z.string().describe('Habit ID'),
      date: z.string().optional().describe('Date YYYY-MM-DD (default today)'),
    },
    async ({ habitId, date }) => {
      const res = await api.habits.check(habitId, date ?? today())
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] }
    },
  )

  server.tool(
    'sinout_create_objective',
    'Create an objective (OKR) in a workspace',
    {
      workspaceId: z.string().describe('Workspace ID'),
      title: z.string().describe('Objective title'),
      description: z.string().optional().describe('Optional description'),
      quarter: z.string().optional().describe('Quarter, e.g. "2026-Q2"'),
      deadline: z.string().optional().describe('Deadline (ISO date)'),
    },
    async ({ workspaceId, title, description, quarter, deadline }) => {
      const obj = await api.okr.createObjective(workspaceId, { title, description, quarter, deadline })
      return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] }
    },
  )

  server.tool(
    'sinout_add_key_result',
    'Add a key result (KR) to an objective',
    {
      objectiveId: z.string().describe('Objective ID'),
      title: z.string().describe('Measurable key result'),
      target: z.number().optional().describe('Target value (default 100)'),
      current: z.number().optional().describe('Current value (default 0)'),
      unit: z.string().optional().describe('Unit, e.g. "%"'),
    },
    async ({ objectiveId, title, target, current, unit }) => {
      const kr = await api.okr.addKeyResult(objectiveId, { title, target, current, unit })
      return { content: [{ type: 'text', text: JSON.stringify(kr, null, 2) }] }
    },
  )

  server.tool(
    'sinout_create_journal_entry',
    'Create or update a personal journal entry for a date',
    {
      content: z.string().describe('Entry text (plain text / markdown)'),
      date: z.string().optional().describe('Date YYYY-MM-DD (default today)'),
      mood: z.string().optional().describe('Optional mood'),
    },
    async ({ content, date, mood }) => {
      const entry = await api.journal.save(date ?? today(), textToTipTap(content), mood)
      return { content: [{ type: 'text', text: JSON.stringify({ date: entry.date, mood: entry.mood }, null, 2) }] }
    },
  )
}
