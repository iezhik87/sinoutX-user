import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as api from '../client.js'

const normType = (t: string): 'INCOME' | 'EXPENSE' =>
  /^(in|inc|income|доход|приход|деньги|зарплат|\+)/i.test(String(t).trim()) ? 'INCOME' : 'EXPENSE'

// Legacy /budget needs a real projectId; resolve one from a workspace when omitted.
async function resolveBudgetProject(projectId?: string, workspaceId?: string): Promise<string> {
  if (projectId) return projectId
  if (!workspaceId) throw new Error('Provide projectId or workspaceId')
  const projects = (await api.projects.listByWorkspace(workspaceId)) as any[]
  const pick = projects.find((p) => !p.isModule && !p.moduleId) ?? projects[0]
  if (!pick) throw new Error('No project in workspace to attach a budget entry')
  return pick.id
}

export function registerBudgetTools(server: McpServer) {
  server.tool(
    'sinout_get_budget_summary',
    'Get budget summary (income, expenses, balance) for a project',
    {
      projectId: z.string().optional().describe('Project ID'),
      workspaceId: z.string().optional().describe('Workspace ID'),
    },
    async ({ projectId, workspaceId }) => {
      const summary = await api.budget.getSummary({ projectId, workspaceId })
      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_list_budget_entries',
    'List budget entries (transactions) for a project',
    {
      projectId: z.string().describe('Project ID'),
      type: z.enum(['INCOME', 'EXPENSE']).optional().describe('Filter by type'),
    },
    async ({ projectId, type }) => {
      const data = await api.budget.list({ projectId, type })
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      }
    },
  )

  server.tool(
    'sinout_add_budget_entry',
    'Add an income/expense entry to the legacy project budget. Pass projectId OR workspaceId (a project is resolved from it). NOTE: if you use the Finance MODULE, prefer sinout_create_record into its transactions/budget collection (sinout_list_collections) — that is the module data store.',
    {
      projectId: z.string().optional().describe('Project ID (or pass workspaceId)'),
      workspaceId: z.string().optional().describe('Workspace ID — a project is auto-resolved'),
      type: z.string().describe('"income"/"expense" (RU доход/расход, "+/-" also accepted)'),
      category: z.string().min(1).describe('Category name (e.g. Salary, Food, Transport)'),
      amount: z.number().positive().describe('Amount (positive number)'),
      currency: z.string().optional().describe('Currency code (USD, EUR, RUB…), default USD'),
      date: z.string().describe('Transaction date, ISO (e.g. 2026-03-01)'),
      description: z.string().optional().describe('Optional description'),
    },
    async ({ projectId, workspaceId, type, category, amount, currency, date, description }) => {
      const entry = await api.budget.create({
        projectId: await resolveBudgetProject(projectId, workspaceId),
        type: normType(type),
        category,
        amount,
        currency: currency ?? 'USD',
        date: new Date(date).toISOString(),
        description,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }],
      }
    },
  )
}
