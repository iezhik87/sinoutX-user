import { z } from 'zod'

export const boardColumnSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0),
  wipLimit: z.number().int().min(0).nullable().optional(),
})

export const createBoardSchema = z.object({
  projectId: z.string().cuid(),
  name: z.string().min(1).max(100),
  columns: z.array(boardColumnSchema).default([
    { id: 'todo', name: 'К выполнению', color: '#64748b', position: 0 },
    { id: 'in_progress', name: 'В работе', color: '#6366f1', position: 1 },
    { id: 'review', name: 'Ревью', color: '#f59e0b', position: 2 },
    { id: 'done', name: 'Готово', color: '#22c55e', position: 3 },
  ]),
})

export const updateBoardSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  columns: z.array(boardColumnSchema).optional(),
})

export const boardParamsSchema = z.object({
  id: z.string().cuid(),
})

export type CreateBoardInput = z.infer<typeof createBoardSchema>
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>
export type BoardColumn = z.infer<typeof boardColumnSchema>
