import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { denyIfNotMember, getProjectWorkspaceId } from '../../lib/requireAccess.js'

export async function customFieldRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  // GET /projects/:projectId/custom-fields
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/custom-fields', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
    const wsId = await getProjectWorkspaceId(prisma, projectId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    const fields = await prisma.customField.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
    })
    return reply.send(fields)
  })

  // POST /projects/:projectId/custom-fields
  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/custom-fields', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string().cuid() }).parse(req.params)
    const wsId = await getProjectWorkspaceId(prisma, projectId)
    if (!wsId) return reply.status(404).send({ error: 'Project not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    const data = z.object({
      name: z.string().min(1).max(50),
      fieldType: z.enum(['text', 'number', 'date', 'select', 'checkbox']),
      options: z.array(z.string()).optional(),
    }).parse(req.body)

    const count = await prisma.customField.count({ where: { projectId } })
    const field = await prisma.customField.create({
      data: { projectId, name: data.name, fieldType: data.fieldType, options: data.options ? (data.options as object) : undefined, position: count },
    })
    return reply.status(201).send(field)
  })

  // DELETE /custom-fields/:id
  fastify.delete<{ Params: { id: string } }>('/custom-fields/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(req.params)
    const field = await prisma.customField.findUnique({ where: { id }, select: { projectId: true } })
    if (!field) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, field.projectId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    await prisma.customField.delete({ where: { id } })
    return reply.status(204).send()
  })

  // GET /tasks/:taskId/custom-field-values
  fastify.get<{ Params: { taskId: string } }>('/tasks/:taskId/custom-field-values', async (req, reply) => {
    const { taskId } = z.object({ taskId: z.string().cuid() }).parse(req.params)
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } })
    if (!task) return reply.status(404).send({ error: 'Not found' })
    const wsId = await getProjectWorkspaceId(prisma, task.projectId)
    if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    const values = await prisma.customFieldValue.findMany({ where: { taskId } })
    return reply.send(values)
  })

  // PUT /tasks/:taskId/custom-field-values/:fieldId
  fastify.put<{ Params: { taskId: string; fieldId: string } }>(
    '/tasks/:taskId/custom-field-values/:fieldId',
    async (req, reply) => {
      const { taskId, fieldId } = z.object({ taskId: z.string().cuid(), fieldId: z.string().cuid() }).parse(req.params)
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } })
      if (!task) return reply.status(404).send({ error: 'Not found' })
      const wsId = await getProjectWorkspaceId(prisma, task.projectId)
      if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
      const { value } = z.object({ value: z.string().nullable() }).parse(req.body)

      const result = await prisma.customFieldValue.upsert({
        where: { customFieldId_taskId: { customFieldId: fieldId, taskId } },
        create: { id: (await import('node:crypto')).randomUUID(), customFieldId: fieldId, taskId, value },
        update: { value },
      })
      return reply.send(result)
    },
  )
}
