import { z } from 'zod'

export const createNoteSchema = z.object({
  workspaceId: z.string().cuid(),
  projectId: z.string().cuid().nullable().optional(),
  content: z.record(z.unknown()),
  tags: z.array(z.string()).default([]),
  pinned: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
})

export const updateNoteSchema = z.object({
  content: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  projectId: z.string().cuid().nullable().optional(),
})

export const listNotesQuerySchema = z.object({
  workspaceId: z.string().cuid().optional(),
  projectId: z.string().cuid().optional(),
  tags: z.string().optional().transform((v) => v?.split(',').filter(Boolean)),
  pinned: z.coerce.boolean().optional(),
})

export const noteParamsSchema = z.object({ id: z.string().cuid() })

export type CreateNoteInput = z.infer<typeof createNoteSchema>
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>
