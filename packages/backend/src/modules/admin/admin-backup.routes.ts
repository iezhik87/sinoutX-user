import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import archiver from 'archiver'
import { promises as fs } from 'fs'
import { join } from 'path'
import { minio, BUCKET, uploadFile } from '../../lib/storage.js'
import { randomUUID } from 'crypto'
import { writeAuditLog } from '../../lib/audit.js'
import { serverDirs, dirByLabel, gatherGlobalData, buildBackupBuffer, backupName, appendBucketFiles } from '../../lib/instanceBackup.js'

const MINIO_PREFIX = 'backups/'
// A backup's "location" is either 'minio' or a configured server-dir label.
const MINIO = 'minio'

// Ownerless blobs carry no stored mime type on restore; a rough guess from the
// extension is enough for the browser to serve them inline again.
function guessMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
    pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', json: 'application/json',
  }
  return map[ext] ?? 'application/octet-stream'
}

function cdFilename(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/['"\\]/g, '_')
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.authUser?.role !== 'OWNER' && req.authUser?.role !== 'ADMIN') {
    reply.status(403).send({ error: 'Admin access required' })
    return true
  }
  return false
}

export async function adminBackupRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // GET /admin/backup/config — destinations + scheduled-backup settings.
  app.get('/admin/backup/config', async (req, reply) => {
    if (requireAdmin(req, reply)) return
    const s = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
    const dirs = serverDirs()
    const now = new Date()
    return reply.send({
      dirs: dirs.map((d) => d.label),
      dirPaths: Object.fromEntries(dirs.map((d) => [d.label, d.path])),
      schedule: s?.backupSchedule ?? 'off',
      dir: s?.backupDir ?? null,
      retention: s?.backupRetention ?? 7,
      hour: s?.backupHour ?? 3,
      weekday: s?.backupWeekday ?? 1,
      lastRunAt: s?.backupLastRunAt ?? null,
      // For the UI to calibrate "what time" (cron uses the server's local time).
      serverHour: now.getHours(),
      serverNow: now.toString(),
    })
  })

  // PATCH /admin/backup/config — save scheduled-backup settings.
  app.patch('/admin/backup/config', async (req, reply) => {
    if (requireAdmin(req, reply)) return
    const body = z.object({
      schedule: z.enum(['off', 'daily', 'weekly']).optional(),
      dir: z.string().nullable().optional(),
      retention: z.coerce.number().int().min(1).max(365).optional(),
      hour: z.coerce.number().int().min(0).max(23).optional(),
      weekday: z.coerce.number().int().min(0).max(6).optional(),
    }).parse(req.body)
    const data: Record<string, unknown> = {}
    if (body.schedule !== undefined) data.backupSchedule = body.schedule
    if (body.dir !== undefined) data.backupDir = body.dir
    if (body.retention !== undefined) data.backupRetention = body.retention
    if (body.hour !== undefined) data.backupHour = body.hour
    if (body.weekday !== undefined) data.backupWeekday = body.weekday
    await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data },
    })
    return reply.send({ ok: true })
  })

  // POST /admin/backup — create a full-instance backup; destination chooses where.
  // destination: 'download' | 'minio' | <server-dir label>.
  app.post('/admin/backup', async (req, reply) => {
    if (requireAdmin(req, reply)) return
    const { destination = 'download' } = z.object({ destination: z.string().default('download') }).parse(req.body ?? {})
    const name = backupName()

    if (destination === 'download') {
      const data = await gatherGlobalData(prisma)
      await writeAuditLog(prisma, { action: 'backup.created', userId: req.authUser!.id, userEmail: req.authUser!.email, resourceType: 'instance', resourceName: 'download', ip: req.ip })
      reply.hijack()
      const raw = reply.raw
      raw.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; ${cdFilename(name)}` })
      const archive = archiver('zip', { zlib: { level: 6 } })
      archive.on('error', () => raw.end())
      archive.pipe(raw)
      archive.append(JSON.stringify(data, null, 2), { name: 'data.json' })
      const files = await appendBucketFiles(archive)
      archive.append(JSON.stringify({ createdAt: new Date().toISOString(), files }, null, 2), { name: 'manifest.json' })
      await archive.finalize()
      console.log(`[backup] download: files ${files.included}/${files.total} included, ${files.skipped} skipped`)
      return
    }

    const { buffer, files } = await buildBackupBuffer(prisma)
    if (destination === MINIO) {
      await minio.putObject(BUCKET, MINIO_PREFIX + name, buffer, buffer.byteLength, { 'Content-Type': 'application/zip' })
    } else {
      const dir = dirByLabel(destination)
      if (!dir) return reply.status(400).send({ error: 'Unknown destination' })
      await fs.mkdir(dir.path, { recursive: true })
      await fs.writeFile(join(dir.path, name), buffer)
    }
    await writeAuditLog(prisma, { action: 'backup.created', userId: req.authUser!.id, userEmail: req.authUser!.email, resourceType: 'instance', resourceName: destination, ip: req.ip })
    // Return the file tally so the admin sees "312 files, 1.9 GB" — not just a
    // zip size he has to take on faith.
    return reply.send({ ok: true, name, destination, size: buffer.byteLength, files })
  })

  // GET /admin/backups — list stored backups (every server dir + MinIO).
  app.get('/admin/backups', async (req, reply) => {
    if (requireAdmin(req, reply)) return
    const out: { location: string; name: string; size: number; createdAt: string }[] = []
    for (const d of serverDirs()) {
      try {
        for (const f of (await fs.readdir(d.path)).filter((x) => x.endsWith('.zip'))) {
          const st = await fs.stat(join(d.path, f))
          out.push({ location: d.label, name: f, size: st.size, createdAt: st.mtime.toISOString() })
        }
      } catch { /* dir not created yet */ }
    }
    try {
      const stream = minio.listObjectsV2(BUCKET, MINIO_PREFIX, true)
      await new Promise<void>((res, rej) => {
        stream.on('data', (o) => { if (o.name?.endsWith('.zip')) out.push({ location: MINIO, name: o.name.replace(MINIO_PREFIX, ''), size: o.size ?? 0, createdAt: (o.lastModified ?? new Date()).toISOString() }) })
        stream.on('end', () => res())
        stream.on('error', rej)
      })
    } catch { /* ignore */ }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return reply.send(out)
  })

  // GET /admin/backups/file?location=&name= — download a stored backup.
  app.get('/admin/backups/file', async (req, reply) => {
    if (requireAdmin(req, reply)) return
    const { location, name } = z.object({ location: z.string(), name: z.string() }).parse(req.query)
    const safe = name.replace(/[/\\]/g, '')
    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; ${cdFilename(safe)}`)
    if (location === MINIO) return reply.send(await minio.getObject(BUCKET, MINIO_PREFIX + safe))
    const dir = dirByLabel(location)
    if (!dir) return reply.status(404).send({ error: 'Unknown location' })
    return reply.send(await fs.readFile(join(dir.path, safe)))
  })

  // DELETE /admin/backups?location=&name= — remove a stored backup.
  app.delete('/admin/backups', async (req, reply) => {
    if (requireAdmin(req, reply)) return
    const { location, name } = z.object({ location: z.string(), name: z.string() }).parse(req.query)
    const safe = name.replace(/[/\\]/g, '')
    if (location === MINIO) await minio.removeObject(BUCKET, MINIO_PREFIX + safe).catch(() => null)
    else { const dir = dirByLabel(location); if (dir) await fs.unlink(join(dir.path, safe)).catch(() => null) }
    return reply.send({ ok: true })
  })

  // POST /admin/backup/restore — restore from an uploaded zip OR a stored one.
  // multipart upload → file; or JSON { location, name } via query for stored.
  app.post('/admin/backup/restore', async (req, reply) => {
    if (requireAdmin(req, reply)) return

    let buffer: Buffer
    const q = req.query as { location?: string; name?: string }
    if (q.location && q.name) {
      const safe = q.name.replace(/[/\\]/g, '')
      if (q.location === MINIO) {
        const stream = await minio.getObject(BUCKET, MINIO_PREFIX + safe)
        const chunks: Buffer[] = []
        for await (const c of stream) chunks.push(c as Buffer)
        buffer = Buffer.concat(chunks)
      } else {
        const dir = dirByLabel(q.location)
        if (!dir) return reply.status(404).send({ error: 'Unknown location' })
        buffer = await fs.readFile(join(dir.path, safe))
      }
    } else {
      const data = await req.file({ limits: { fileSize: 4 * 1024 * 1024 * 1024 } })
      if (!data) return reply.status(400).send({ error: 'No file provided' })
      const chunks: Buffer[] = []
      for await (const c of data.file) chunks.push(c)
      buffer = Buffer.concat(chunks)
    }

    const AdmZip = (await import('adm-zip')).default
    let zip: InstanceType<typeof AdmZip>
    try { zip = new AdmZip(buffer) } catch { return reply.status(400).send({ error: 'Invalid ZIP file' }) }
    const dataEntry = zip.getEntries().find((e) => e.entryName.endsWith('data.json'))
    if (!dataEntry) return reply.status(400).send({ error: 'data.json not found in backup' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let d: any
    try { d = JSON.parse(dataEntry.getData().toString('utf-8')) } catch { return reply.status(400).send({ error: 'Invalid data.json' }) }
    if (typeof d.backupVersion !== 'string' || !d.backupVersion.startsWith('3')) {
      return reply.status(400).send({ error: 'Unsupported backup. Use a global (v3) admin backup.' })
    }

    const stats = { users: 0, workspaces: 0, projects: 0, pages: 0, tasks: 0, notes: 0, files: 0 }
    const D = (k: string) => (d[k] ?? []) as Record<string, unknown>[]

    // Users → workspaces → members → projects → boards → pages → tags → tasks →
    // taskTags → notes → events → budget → links → attachments(+files).
    for (const u of D('users')) {
      await prisma.user.upsert({ where: { id: u.id as string }, update: {}, create: {
        id: u.id as string, email: u.email as string, name: u.name as string,
        passwordHash: u.passwordHash as string, role: (u.role as 'OWNER' | 'ADMIN' | 'MEMBER') ?? 'MEMBER',
        isActive: (u.isActive as boolean) ?? true, isVerified: (u.isVerified as boolean) ?? true,
        lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt as string) : null,
        plan: (u.plan as string) ?? 'free', licenseKey: (u.licenseKey as string) ?? null,
        licenseExpiresAt: u.licenseExpiresAt ? new Date(u.licenseExpiresAt as string) : null,
        notificationPrefs: (u.notificationPrefs ?? {}) as object,
        createdAt: new Date(u.createdAt as string), updatedAt: new Date(u.updatedAt as string),
      } }).then(() => stats.users++).catch(() => null)
    }
    for (const w of D('workspaces')) {
      await prisma.workspace.upsert({ where: { id: w.id as string }, update: {}, create: {
        id: w.id as string, name: w.name as string, description: (w.description as string) ?? null,
        icon: (w.icon as string) ?? null, color: (w.color as string) ?? null, settings: (w.settings ?? {}) as object,
        createdAt: new Date(w.createdAt as string), updatedAt: new Date(w.updatedAt as string),
      } }).then(() => stats.workspaces++).catch(() => null)
    }
    for (const m of D('members')) {
      await prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: m.workspaceId as string, userId: m.userId as string } },
        update: {}, create: { id: m.id as string, workspaceId: m.workspaceId as string, userId: m.userId as string, role: (m.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') ?? 'MEMBER', createdAt: new Date(m.createdAt as string) },
      }).catch(() => null)
    }
    for (const p of D('projects')) {
      await prisma.project.upsert({ where: { id: p.id as string }, update: {}, create: {
        id: p.id as string, workspaceId: p.workspaceId as string, name: p.name as string,
        description: (p.description as string) ?? null, icon: (p.icon as string) ?? null, color: (p.color as string) ?? null,
        status: (p.status as 'ACTIVE' | 'ARCHIVED' | 'TEMPLATE') ?? 'ACTIVE', settings: (p.settings ?? {}) as object,
        position: (p.position as number) ?? 0, isSystem: (p.isSystem as boolean) ?? false,
        createdAt: new Date(p.createdAt as string), updatedAt: new Date(p.updatedAt as string),
      } }).then(() => stats.projects++).catch(() => null)
    }
    for (const b of D('boards')) {
      await prisma.board.upsert({ where: { id: b.id as string }, update: {}, create: {
        id: b.id as string, projectId: b.projectId as string, name: b.name as string, columns: (b.columns ?? []) as object,
        createdAt: new Date(b.createdAt as string), updatedAt: new Date(b.updatedAt as string),
      } }).catch(() => null)
    }
    const pageCreate = (pg: Record<string, unknown>, withParent: boolean) => prisma.page.upsert({ where: { id: pg.id as string }, update: {}, create: {
      id: pg.id as string, projectId: pg.projectId as string, ...(withParent ? { parentPageId: pg.parentPageId as string } : {}),
      title: pg.title as string, icon: (pg.icon as string) ?? null, content: (pg.content ?? {}) as object,
      type: (pg.type as 'PAGE' | 'FOLDER') ?? 'PAGE', position: (pg.position as number) ?? 0, isDeleted: (pg.isDeleted as boolean) ?? false,
      createdAt: new Date(pg.createdAt as string), updatedAt: new Date(pg.updatedAt as string),
    } }).then(() => stats.pages++).catch(() => null)
    for (const pg of D('pages').filter((p) => !p.parentPageId)) await pageCreate(pg, false)
    for (const pg of D('pages').filter((p) => p.parentPageId)) await pageCreate(pg, true)
    for (const t of D('tags')) {
      await prisma.tag.upsert({ where: { id: t.id as string }, update: {}, create: { id: t.id as string, workspaceId: t.workspaceId as string, name: t.name as string, color: (t.color as string) ?? null } }).catch(() => null)
    }
    const taskCreate = (t: Record<string, unknown>, withParent: boolean) => prisma.task.upsert({ where: { id: t.id as string }, update: {}, create: {
      id: t.id as string, projectId: t.projectId as string, pageId: (t.pageId as string) ?? null,
      ...(withParent ? { parentTaskId: t.parentTaskId as string } : {}),
      boardId: (t.boardId as string) ?? null, boardColumnId: (t.boardColumnId as string) ?? null,
      title: t.title as string, description: (t.description as string) ?? null, status: (t.status as 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CANCELLED') ?? 'TODO',
      priority: (t.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT') ?? 'MEDIUM',
      dueDate: t.dueDate ? new Date(t.dueDate as string) : null, startDate: t.startDate ? new Date(t.startDate as string) : null,
      isRecurring: (t.isRecurring as boolean) ?? false, recurrenceRule: (t.recurrenceRule as string) ?? null,
      reminderAt: ((t.reminderAt as string[]) ?? []).map((x) => new Date(x)),
      assignee: (t.assignee as string) ?? null, position: (t.position as number) ?? 0, isDeleted: (t.isDeleted as boolean) ?? false,
      createdAt: new Date(t.createdAt as string), updatedAt: new Date(t.updatedAt as string),
    } }).then(() => stats.tasks++).catch(() => null)
    for (const t of D('tasks').filter((x) => !x.parentTaskId)) await taskCreate(t, false)
    for (const t of D('tasks').filter((x) => x.parentTaskId)) await taskCreate(t, true)
    for (const tt of D('taskTags')) {
      await prisma.taskTag.upsert({ where: { taskId_tagId: { taskId: tt.taskId as string, tagId: tt.tagId as string } }, update: {}, create: { taskId: tt.taskId as string, tagId: tt.tagId as string } }).catch(() => null)
    }
    for (const n of D('notes')) {
      await prisma.note.upsert({ where: { id: n.id as string }, update: {}, create: {
        id: n.id as string, workspaceId: n.workspaceId as string, projectId: (n.projectId as string) ?? null,
        content: (n.content ?? {}) as object, tags: (n.tags as string[]) ?? [], pinned: (n.pinned as boolean) ?? false,
        color: (n.color as string) ?? null, createdAt: new Date(n.createdAt as string), updatedAt: new Date(n.updatedAt as string),
      } }).then(() => stats.notes++).catch(() => null)
    }
    for (const e of D('calendarEvents')) {
      await prisma.calendarEvent.upsert({ where: { id: e.id as string }, update: {}, create: {
        id: e.id as string, projectId: e.projectId as string, title: e.title as string, description: (e.description as string) ?? null,
        startAt: new Date(e.startAt as string), endAt: e.endAt ? new Date(e.endAt as string) : null, allDay: (e.allDay as boolean) ?? false,
        isRecurring: (e.isRecurring as boolean) ?? false, recurrenceRule: (e.recurrenceRule as string) ?? null,
        reminderAt: ((e.reminderAt as string[]) ?? []).map((x) => new Date(x)), linkedDocuments: (e.linkedDocuments ?? []) as object,
        color: (e.color as string) ?? null, location: (e.location as string) ?? null,
        createdAt: new Date(e.createdAt as string), updatedAt: new Date(e.updatedAt as string),
      } }).catch(() => null)
    }
    for (const b of D('budgetEntries')) {
      await prisma.budgetEntry.upsert({ where: { id: b.id as string }, update: {}, create: {
        id: b.id as string, projectId: b.projectId as string, type: b.type as 'INCOME' | 'EXPENSE', category: b.category as string,
        amount: b.amount as number, currency: (b.currency as string) ?? 'RUB', date: new Date(b.date as string),
        description: (b.description as string) ?? null, isRecurring: (b.isRecurring as boolean) ?? false,
        recurrenceRule: (b.recurrenceRule as string) ?? null, tags: (b.tags as string[]) ?? [],
        createdAt: new Date(b.createdAt as string), updatedAt: new Date(b.updatedAt as string),
      } }).catch(() => null)
    }
    for (const l of D('links')) {
      await prisma.link.upsert({ where: { id: l.id as string }, update: {}, create: {
        id: l.id as string, workspaceId: l.workspaceId as string, sourceType: l.sourceType as string, sourceId: l.sourceId as string,
        targetType: l.targetType as string, targetId: l.targetId as string, linkType: l.linkType as 'REFERENCE' | 'EMBED' | 'DEPENDS_ON' | 'BLOCKS' | 'RELATED',
        metadata: (l.metadata ?? {}) as object, createdAt: new Date(l.createdAt as string),
      } }).catch(() => null)
    }
    const fileEntries = zip.getEntries().filter((e) => e.entryName.includes('files/') && !e.isDirectory)
    for (const att of D('attachments')) {
      const fileEntry = fileEntries.find((e) => e.entryName.endsWith(att.storagePath as string))
      let storagePath = att.storagePath as string
      if (fileEntry) {
        try { await minio.statObject(BUCKET, storagePath) } catch {
          const fb = fileEntry.getData()
          await uploadFile(storagePath, fb, att.mimeType as string, fb.byteLength)
          stats.files++
        }
      } else {
        const ext = (att.filename as string).split('.').pop() ?? 'bin'
        storagePath = `${att.workspaceId}/${randomUUID()}.${ext}`
      }
      await prisma.attachment.upsert({ where: { id: att.id as string }, update: {}, create: {
        id: att.id as string, workspaceId: att.workspaceId as string, projectId: (att.projectId as string) ?? null,
        filename: att.filename as string, description: (att.description as string) ?? null,
        mimeType: att.mimeType as string, size: att.size as number, storagePath, isImportant: (att.isImportant as boolean) ?? false,
        metadata: (att.metadata ?? {}) as object, createdAt: new Date(att.createdAt as string),
      } }).catch(() => null)
    }

    // Ownerless blobs: agent-generated images, TTS audio, exports, clips — they
    // live in MinIO with no attachment row, so the loop above never touches them.
    // The backup now mirrors the whole bucket, so put them back too — otherwise a
    // restore is DB-complete but file-incomplete.
    const attachmentPaths = new Set(D('attachments').map((a) => a.storagePath as string))
    for (const e of fileEntries) {
      const objectName = e.entryName.slice(e.entryName.indexOf('files/') + 'files/'.length)
      if (!objectName || attachmentPaths.has(objectName)) continue
      try { await minio.statObject(BUCKET, objectName) } catch {
        const fb = e.getData()
        await uploadFile(objectName, fb, guessMime(objectName), fb.byteLength)
        stats.files++
      }
    }

    await writeAuditLog(prisma, { action: 'backup.restored', userId: req.authUser!.id, userEmail: req.authUser!.email, resourceType: 'instance', resourceName: 'full', ip: req.ip })
    return reply.send({ ok: true, stats })
  })
}
