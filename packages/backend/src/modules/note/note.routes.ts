import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { NoteService } from './note.service.js'
import {
  createNoteSchema,
  updateNoteSchema,
  listNotesQuerySchema,
  noteParamsSchema,
} from './note.schema.js'
import { denyIfNotMember } from '../../lib/requireAccess.js'

export async function noteRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const service = new NoteService(prisma)

  // GET /notes?workspaceId=&projectId=&tags=&pinned=
  fastify.get('/notes', async (req, reply) => {
    const query = listNotesQuerySchema.parse(req.query)
    if (query.workspaceId) {
      if (await denyIfNotMember(prisma, query.workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    }
    return reply.send(await service.list(query))
  })

  // GET /notes/:id
  fastify.get<{ Params: { id: string } }>('/notes/:id', async (req, reply) => {
    const { id } = noteParamsSchema.parse(req.params)
    const note = await service.getById(id)
    if (!note) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Note not found' })
    const wsId = note.workspaceId
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply, { allowViewer: true })) return
    return reply.send(note)
  })

  // POST /notes
  fastify.post('/notes', async (req, reply) => {
    const data = createNoteSchema.parse(req.body)
    if (data.workspaceId && await denyIfNotMember(prisma, data.workspaceId, req.authUser!.id, reply)) return
    return reply.status(201).send(await service.create(data))
  })

  // PATCH /notes/:id
  fastify.patch<{ Params: { id: string } }>('/notes/:id', async (req, reply) => {
    const { id } = noteParamsSchema.parse(req.params)
    const note = await prisma.note.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!note) return reply.status(404).send({ error: 'Not found' })
    if (note.workspaceId && await denyIfNotMember(prisma, note.workspaceId, req.authUser!.id, reply)) return
    return reply.send(await service.update(id, updateNoteSchema.parse(req.body)))
  })

  // DELETE /notes/:id
  fastify.delete<{ Params: { id: string } }>('/notes/:id', async (req, reply) => {
    const { id } = noteParamsSchema.parse(req.params)
    const note = await prisma.note.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!note) return reply.status(404).send({ error: 'Not found' })
    if (note.workspaceId && await denyIfNotMember(prisma, note.workspaceId, req.authUser!.id, reply)) return
    await service.delete(id)
    return reply.status(204).send()
  })
}
