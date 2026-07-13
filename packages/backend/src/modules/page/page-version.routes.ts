import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { denyIfNotMember, getProjectWorkspaceId } from '../../lib/requireAccess.js'

const MAX_VERSIONS_PER_PAGE = 50

export async function savePageVersion(
  prisma: PrismaClient,
  pageId: string,
  title: string,
  content: unknown,
  savedBy?: string,
) {
  const latest = await prisma.pageVersion.findFirst({
    where: { pageId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })

  const version = (latest?.version ?? 0) + 1

  await prisma.pageVersion.create({
    data: { pageId, title, content: content as object, version, savedBy },
  })

  const old = await prisma.pageVersion.findMany({
    where: { pageId },
    orderBy: { version: 'desc' },
    skip: MAX_VERSIONS_PER_PAGE,
    select: { id: true },
  })

  if (old.length > 0) {
    await prisma.pageVersion.deleteMany({
      where: { id: { in: old.map((v) => v.id) } },
    })
  }
}

async function getPageWsId(prisma: PrismaClient, pageId: string): Promise<string | null> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { projectId: true } })
  if (!page) return null
  return getProjectWorkspaceId(prisma, page.projectId)
}

export async function pageVersionRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // GET /pages/:id/versions
  app.get('/pages/:id/versions', async (req, reply) => {
    const { id } = req.params as { id: string }
    const wsId = await getPageWsId(prisma, id)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const versions = await prisma.pageVersion.findMany({
      where: { pageId: id },
      orderBy: { version: 'desc' },
      take: MAX_VERSIONS_PER_PAGE,
      select: { id: true, version: true, title: true, savedBy: true, createdAt: true },
    })

    return reply.send(versions)
  })

  // GET /pages/:id/versions/:versionId
  app.get('/pages/:id/versions/:versionId', async (req, reply) => {
    const { id, versionId } = req.params as { id: string; versionId: string }
    const wsId = await getPageWsId(prisma, id)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const version = await prisma.pageVersion.findFirst({ where: { id: versionId, pageId: id } })
    if (!version) return reply.status(404).send({ error: 'Version not found' })

    return reply.send(version)
  })

  // POST /pages/:id/versions/:versionId/restore
  app.post('/pages/:id/versions/:versionId/restore', async (req, reply) => {
    const { id, versionId } = req.params as { id: string; versionId: string }
    const wsId = await getPageWsId(prisma, id)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const version = await prisma.pageVersion.findFirst({ where: { id: versionId, pageId: id } })
    if (!version) return reply.status(404).send({ error: 'Version not found' })

    const current = await prisma.page.findUnique({ where: { id } })
    if (current) {
      await savePageVersion(prisma, id, current.title, current.content, 'system')
    }

    const restored = await prisma.page.update({
      where: { id },
      // yjsState=null so the collab editor re-seeds from the restored content
      // (pages render from Yjs, not from content — a direct write would be invisible).
      data: { title: version.title, content: version.content as object, yjsState: null, updatedAt: new Date() },
    })

    return reply.send(restored)
  })
}
