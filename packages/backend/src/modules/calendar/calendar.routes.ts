import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { CalendarService } from './calendar.service.js'
import {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
  eventParamsSchema,
} from './calendar.schema.js'
import { z } from 'zod'
import { denyIfNotMember, denyIfNoProjectAccess } from '../../lib/requireAccess.js'

export async function calendarRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const service = new CalendarService(prisma)

  // GET /events?projectId=&workspaceId=&from=&to=
  fastify.get('/events', async (req, reply) => {
    const query = listEventsQuerySchema.parse(req.query)
    if (query.workspaceId) {
      if (await denyIfNotMember(prisma, query.workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    } else if (query.projectId) {
      if (await denyIfNoProjectAccess(prisma, query.projectId, req.authUser!.id, reply)) return
    }
    return reply.send(await service.list(query))
  })

  // GET /events/upcoming?workspaceId=
  fastify.get('/events/upcoming', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().cuid() }).parse(req.query)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    return reply.send(await service.getUpcoming(workspaceId))
  })

  // GET /events/:id
  fastify.get<{ Params: { id: string } }>('/events/:id', async (req, reply) => {
    const { id } = eventParamsSchema.parse(req.params)
    const event = await service.getById(id)
    if (!event) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Event not found' })
    if (await denyIfNoProjectAccess(prisma, event.projectId, req.authUser!.id, reply)) return
    return reply.send(event)
  })

  // POST /events
  fastify.post('/events', async (req, reply) => {
    const data = createEventSchema.parse(req.body)
    if (await denyIfNoProjectAccess(prisma, data.projectId, req.authUser!.id, reply, { write: true })) return
    return reply.status(201).send(await service.create(data))
  })

  // PATCH /events/:id
  fastify.patch<{ Params: { id: string } }>('/events/:id', async (req, reply) => {
    const { id } = eventParamsSchema.parse(req.params)
    const event = await prisma.calendarEvent.findUnique({ where: { id }, select: { projectId: true } })
    if (!event) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, event.projectId, req.authUser!.id, reply, { write: true })) return
    return reply.send(await service.update(id, updateEventSchema.parse(req.body)))
  })

  // DELETE /events/:id
  fastify.delete<{ Params: { id: string } }>('/events/:id', async (req, reply) => {
    const { id } = eventParamsSchema.parse(req.params)
    const event = await prisma.calendarEvent.findUnique({ where: { id }, select: { projectId: true } })
    if (!event) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, event.projectId, req.authUser!.id, reply, { write: true })) return
    await service.delete(id)
    return reply.status(204).send()
  })
}
