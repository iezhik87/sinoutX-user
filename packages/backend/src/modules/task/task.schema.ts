import { z } from 'zod'

export const createTaskSchema = z.object({
  projectId: z.string().cuid(),
  pageId: z.string().cuid().nullable().optional(),
  parentTaskId: z.string().cuid().nullable().optional(),
  boardId: z.string().cuid().nullable().optional(),
  boardColumnId: z.string().nullable().optional(),
  title: z.string().min(1).max(500),
  description: z.record(z.unknown()).nullable().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED']).default('TODO'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  dueDate: z.string().datetime().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  isRecurring: z.boolean().default(false),
  recurrenceRule: z.string().nullable().optional(),
  reminderAt: z.array(z.string().datetime()).default([]),
  assignee: z.string().nullable().optional(),
  tagIds: z.array(z.string().cuid()).default([]),
})

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.record(z.unknown()).nullable().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  isRecurring: z.boolean().optional(),
  recurrenceRule: z.string().nullable().optional(),
  reminderAt: z.array(z.string().datetime()).optional(),
  assignee: z.string().nullable().optional(),
  boardId: z.string().cuid().nullable().optional(),
  boardColumnId: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
  tagIds: z.array(z.string().cuid()).optional(),
})

export const listTasksQuerySchema = z.object({
  projectId: z.string().cuid().optional(),
  workspaceId: z.string().cuid().optional(),
  boardId: z.string().cuid().optional(),
  boardColumnId: z.string().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assignee: z.string().optional(),
  tagId: z.string().cuid().optional(),
  parentTaskId: z.string().cuid().nullable().optional(),
  hasDueDate: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
})

export const taskParamsSchema = z.object({
  id: z.string().cuid(),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>
