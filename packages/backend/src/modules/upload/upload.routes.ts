import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { uploadFile, deleteFile, getPublicUrl, getPresignedUrl, minio, BUCKET } from '../../lib/storage.js'
import { canUploadFile } from '../../lib/plans.js'
import { denyIfNotMember, getProjectWorkspaceId } from '../../lib/requireAccess.js'
import { isSafeWebhookUrl } from '../../lib/webhook.js'
import { maybeWarnStorage } from '../../lib/storageAlert.js'
import { toStorableImage } from '../../lib/images.js'

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB

export async function uploadRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // POST /upload — upload a file, returns Attachment
  app.post('/upload', async (req, reply) => {
    const data = await req.file({ limits: { fileSize: MAX_FILE_SIZE } })
    if (!data) return reply.status(400).send({ error: 'No file provided' })

    const qs = req.query as Record<string, string>
    const workspaceId = qs.workspaceId
    const projectId = qs.projectId || null
    const description = qs.description || null
    const isImportant = qs.isImportant === 'true'

    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })

    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const raw = Buffer.concat(chunks)

    // Downscale BEFORE the quota check: charging the user for bytes we are not
    // going to keep would reject uploads that comfortably fit.
    const small = await toStorableImage(raw, data.mimetype, data.filename)
    const buffer = small?.buffer ?? raw
    const mimeType = small?.mime ?? data.mimetype
    const filename = small?.filename ?? data.filename

    const storageCheck = await canUploadFile(prisma, workspaceId, buffer.byteLength)
    if (!storageCheck.ok) {
      return reply.status(403).send({ error: 'plan_limit', resource: 'storage', limitMb: storageCheck.limitMb, usedMb: storageCheck.usedMb })
    }

    const ext = filename.split('.').pop() ?? 'bin'
    const key = `${workspaceId}/${randomUUID()}.${ext}`

    await uploadFile(key, buffer, mimeType, buffer.byteLength)

    const attachment = await prisma.attachment.create({
      data: {
        workspaceId,
        ...(projectId ? { projectId } : {}),
        filename,
        description,
        mimeType,
        size: buffer.byteLength,
        storagePath: key,
        isImportant,
        metadata: {},
      },
    })

    // Warn while he can still act, not when the next upload bounces.
    const al = String(req.headers['x-lang'] ?? '').toLowerCase()
    const lang = al === 'en' ? 'en' : al === 'be' ? 'be' : 'ru'
    void maybeWarnStorage(prisma, workspaceId, storageCheck.usedMb + Math.round(buffer.byteLength / 1024 / 1024), storageCheck.limitMb, lang)

    return reply.status(201).send({
      ...attachment,
      url: getPublicUrl(key),
    })
  })

  // POST /attachments/from-url — download a remote image and save it as a
  // project source (attachment). Used by the editor's "Save to sources" action
  // for found/web images. SSRF-guarded; images only.
  app.post('/attachments/from-url', async (req, reply) => {
    const { url, workspaceId, projectId, description } = (req.body ?? {}) as {
      url?: string; workspaceId?: string; projectId?: string; description?: string
    }
    if (!url || !workspaceId) return reply.status(400).send({ error: 'url and workspaceId required' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    let buffer: Buffer
    let mimeType: string

    // Strip a same-origin host so in-app URLs become relative paths.
    const rel = url.replace(/^https?:\/\/[^/]+/, '')
    const aiMatch = rel.match(/^(?:\/api\/v1)?\/ai\/image\/([^/?#]+)$/)

    if (aiMatch) {
      // Our own AI-generated image — pull straight from object storage instead
      // of an HTTP round-trip (the path isn't a public URL).
      const key = `ai-images/${aiMatch[1]}`
      try {
        const stat = await minio.statObject(BUCKET, key)
        mimeType = (stat.metaData?.['content-type'] as string | undefined) ?? 'image/jpeg'
        const stream = await minio.getObject(BUCKET, key)
        const chunks: Buffer[] = []
        for await (const chunk of stream) chunks.push(chunk as Buffer)
        buffer = Buffer.concat(chunks)
      } catch (err) {
        req.log.warn({ err, key }, 'from-url: AI image not found in storage')
        return reply.status(404).send({ error: 'Image not found in storage' })
      }
    } else if (/^https?:\/\//i.test(url)) {
      if (!isSafeWebhookUrl(url)) return reply.status(400).send({ error: 'URL must be a public http(s) URL' })
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
        if (!res.ok) return reply.status(502).send({ error: `Fetch failed: ${res.status}` })
        mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim() || 'application/octet-stream'
        if (!mimeType.startsWith('image/')) return reply.status(400).send({ error: 'URL is not an image' })
        buffer = Buffer.from(await res.arrayBuffer())
      } catch (err) {
        req.log.warn({ err, url }, 'from-url: download failed')
        return reply.status(502).send({ error: 'Could not download the image' })
      }
    } else {
      return reply.status(400).send({ error: 'Unsupported image URL' })
    }
    if (buffer.byteLength === 0) return reply.status(502).send({ error: 'Empty image' })
    if (buffer.byteLength > MAX_FILE_SIZE) return reply.status(413).send({ error: 'Image too large' })

    const small = await toStorableImage(buffer, mimeType, `web.${mimeType.split('/')[1] ?? 'jpg'}`)
    if (small) { buffer = small.buffer; mimeType = small.mime }

    const storageCheck = await canUploadFile(prisma, workspaceId, buffer.byteLength)
    if (!storageCheck.ok) {
      return reply.status(403).send({ error: 'plan_limit', resource: 'storage', limitMb: storageCheck.limitMb, usedMb: storageCheck.usedMb })
    }

    const ext = mimeType.split('/')[1]?.split('+')[0] ?? 'jpg'
    const key = `${workspaceId}/${randomUUID()}.${ext}`
    await uploadFile(key, buffer, mimeType, buffer.byteLength)

    const attachment = await prisma.attachment.create({
      data: {
        workspaceId,
        ...(projectId ? { projectId } : {}),
        filename: `web-${randomUUID().slice(0, 8)}.${ext}`,
        description: description?.slice(0, 200) ?? null,
        mimeType,
        size: buffer.byteLength,
        storagePath: key,
        isImportant: false,
        metadata: { source: 'web', sourceUrl: url },
      },
    })

    return reply.status(201).send({
      ...attachment,
      url: `/api/v1/attachments/${attachment.id}/content`,
    })
  })

  // GET /attachments?workspaceId=xxx&projectId=xxx
  app.get('/attachments', async (req, reply) => {
    const { workspaceId, projectId } = req.query as { workspaceId?: string; projectId?: string }
    if (!workspaceId && !projectId) return reply.status(400).send({ error: 'workspaceId or projectId required' })

    if (workspaceId) {
      if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    } else if (projectId) {
      const wsId = await getProjectWorkspaceId(prisma, projectId)
      if (wsId && await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    }

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId
    else where.workspaceId = workspaceId

    const attachments = await prisma.attachment.findMany({
      where,
      orderBy: [{ isImportant: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    })

    return reply.send(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attachments.map((a: any) => ({ ...a, url: getPublicUrl(a.storagePath) })),
    )
  })

  // PATCH /attachments/:id — update description / isImportant / projectId
  app.patch('/attachments/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const existing = await prisma.attachment.findUnique({ where: { id }, select: { workspaceId: true } })
    if (!existing) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, existing.workspaceId, req.authUser!.id, reply)) return

    const body = req.body as { description?: string; isImportant?: boolean; projectId?: string | null }
    const attachment = await prisma.attachment.update({
      where: { id },
      data: {
        ...(body.description !== undefined && { description: body.description }),
        ...(body.isImportant !== undefined && { isImportant: body.isImportant }),
        ...('projectId' in body && { projectId: body.projectId ?? null }),
      },
    })
    return reply.send({ ...attachment, url: getPublicUrl(attachment.storagePath) })
  })

  // GET /attachments/:id/content — stream file through backend (proxy, fixes CORS)
  app.get('/attachments/:id/content', async (req, reply) => {
    const { id } = req.params as { id: string }
    const attachment = await prisma.attachment.findUnique({ where: { id } })
    if (!attachment) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, attachment.workspaceId, req.authUser!.id, reply)) return

    const { minio, BUCKET } = await import('../../lib/storage.js')
    const stream = await minio.getObject(BUCKET, attachment.storagePath)

    const mime = attachment.mimeType || ''
    const isViewable = mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime.startsWith('text/') || mime === 'application/pdf'
    const disposition = isViewable ? 'inline' : 'attachment'
    reply.header('Content-Type', mime)
    reply.header('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`)
    reply.header('Cache-Control', 'private, max-age=3600')
    return reply.send(stream)
  })

  // GET /attachments/:id/download — presigned URL
  app.get('/attachments/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string }
    const attachment = await prisma.attachment.findUnique({ where: { id } })
    if (!attachment) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, attachment.workspaceId, req.authUser!.id, reply)) return

    const url = await getPresignedUrl(attachment.storagePath)
    return reply.send({ url })
  })

  // DELETE /attachments/:id
  app.delete('/attachments/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const attachment = await prisma.attachment.findUnique({ where: { id } })
    if (!attachment) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, attachment.workspaceId, req.authUser!.id, reply)) return

    await deleteFile(attachment.storagePath).catch(() => null)
    await prisma.attachment.delete({ where: { id } })
    return reply.status(204).send()
  })
}
