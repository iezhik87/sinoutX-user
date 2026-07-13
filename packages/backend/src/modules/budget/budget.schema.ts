import { z } from 'zod'

export const createBudgetEntrySchema = z.object({
  projectId: z.string().cuid(),
  type: z.enum(['INCOME', 'EXPENSE']),
  category: z.string().min(1).max(100),
  amount: z.number().positive().multipleOf(0.01),
  currency: z.string().length(3).default('RUB'),
  account: z.string().max(100).default('Наличные'),
  date: z.string().datetime(),
  description: z.string().max(500).optional(),
  isRecurring: z.boolean().default(false),
  recurrenceRule: z.string().optional(),
  tags: z.array(z.string()).default([]),
})

export const updateBudgetEntrySchema = createBudgetEntrySchema.partial().omit({ projectId: true })

export const listBudgetQuerySchema = z.object({
  projectId: z.string().cuid().optional(),
  workspaceId: z.string().cuid().optional(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  category: z.string().optional(),
  account: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  currency: z.string().optional(),
})

export const budgetParamsSchema = z.object({ id: z.string().cuid() })

export type CreateBudgetEntryInput = z.infer<typeof createBudgetEntrySchema>
export type UpdateBudgetEntryInput = z.infer<typeof updateBudgetEntrySchema>
export type ListBudgetQuery = z.infer<typeof listBudgetQuerySchema>
