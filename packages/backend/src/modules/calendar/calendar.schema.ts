import { z } from 'zod'

export const createEventSchema = z.object({
  projectId: z.string().cuid(),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().default(false),
  isRecurring: z.boolean().default(false),
  recurrenceRule: z.string().optional(),
  reminderAt: z.array(z.string().datetime()).default([]),
  linkedDocuments: z.array(z.object({ type: z.string(), id: z.string() })).default([]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  location: z.string().max(500).optional(),
})

export const updateEventSchema = createEventSchema.partial().omit({ projectId: true })

export const listEventsQuerySchema = z.object({
  projectId: z.string().cuid().optional(),
  workspaceId: z.string().cuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export const eventParamsSchema = z.object({ id: z.string().cuid() })

export type CreateEventInput = z.infer<typeof createEventSchema>
export type UpdateEventInput = z.infer<typeof updateEventSchema>
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>
