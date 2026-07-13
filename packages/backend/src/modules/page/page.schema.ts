import { z } from 'zod'

export const createPageSchema = z.object({
  projectId: z.string().cuid(),
  parentPageId: z.string().cuid().nullable().optional(),
  title: z.string().min(1).max(255).default('Без названия'),
  icon: z.string().max(50).optional(),
  content: z.record(z.unknown()).optional(),
  type: z.enum(['PAGE', 'FOLDER', 'TEMPLATE']).default('PAGE'),
})

export const updatePageSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  icon: z.string().max(50).nullable().optional(),
  coverImage: z.string().url().nullable().optional(),
  content: z.record(z.unknown()).optional(),
  parentPageId: z.string().cuid().nullable().optional(),
  position: z.number().int().min(0).optional(),
})

export const pageParamsSchema = z.object({
  id: z.string().cuid(),
})

export type CreatePageInput = z.infer<typeof createPageSchema>
export type UpdatePageInput = z.infer<typeof updatePageSchema>
