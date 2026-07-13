import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import archiver from 'archiver'
import { minio, BUCKET, uploadFile } from '../../lib/storage.js'
import { randomUUID } from 'crypto'
import { denyIfNotMember } from '../../lib/requireAccess.js'
import { writeAuditLog } from '../../lib/audit.js'

// ─── Content-Disposition с Unicode ───────────────────────────────────────────

function contentDispositionFilename(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/['"\\]/g, '_')
  const encoded = encodeURIComponent(name)
  return `filename="${ascii}"; filename*=UTF-8''${encoded}`
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function backupRoutes(app: FastifyInstance, prisma: PrismaClient) {

  // POST /backup — ZIP со всеми данными + файлами из MinIO
  app.post('/backup', async (req, reply) => {
    const { workspaceId } = z
      .object({ workspaceId: z.string().cuid() })
      .parse(req.body)

    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const [
      workspace,
      projects,
      pages,
      tasks,
      taskTags,
      notes,
      calendarEvents,
      budgetEntries,
      boards,
      links,
      tags,
      attachments,
      integrations,
    ] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: workspaceId } }),
      prisma.project.findMany({ where: { workspaceId }, orderBy: { position: 'asc' } }),
      prisma.page.findMany({ where: { project: { workspaceId } }, orderBy: { position: 'asc' } }),
      prisma.task.findMany({ where: { project: { workspaceId } }, orderBy: { position: 'asc' } }),
      prisma.taskTag.findMany({ where: { task: { project: { workspaceId } } } }),
      prisma.note.findMany({ where: { workspaceId } }),
      prisma.calendarEvent.findMany({ where: { project: { workspaceId } } }),
      prisma.budgetEntry.findMany({ where: { project: { workspaceId } } }),
      prisma.board.findMany({ where: { project: { workspaceId } } }),
      prisma.link.findMany({ where: { workspaceId } }),
      prisma.tag.findMany({ where: { workspaceId } }),
      prisma.attachment.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }),
      prisma.integration.findMany({ where: { workspaceId } }),
    ])

    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' })

    await writeAuditLog(prisma, { action: 'backup.created', workspaceId, userId: req.authUser!.id, resourceType: 'workspace', resourceId: workspaceId, resourceName: workspace.name, ip: req.ip })


    const data = {
      backupVersion: '2.0',
      exportedAt: new Date().toISOString(),
      workspace,
      projects,
      pages,
      tasks,
      taskTags,
      notes,
      calendarEvents,
      budgetEntries,
      boards,
      links,
      tags,
      attachments,
      integrations,
    }

    const zipName = `sinoutx-backup-${workspace.name}-${new Date().toISOString().slice(0, 10)}`

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; ${contentDispositionFilename(zipName + '.zip')}`,
    })

    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', (err) => { console.error('Backup ZIP error:', err); raw.end() })
    archive.pipe(raw)

    // data.json — все сущности
    archive.append(JSON.stringify(data, null, 2), { name: `${zipName}/data.json` })

    // files/ — файлы из MinIO (сохраняем с оригинальным storagePath как именем)
    for (const att of attachments) {
      try {
        const stream = await minio.getObject(BUCKET, att.storagePath)
        archive.append(stream, { name: `${zipName}/files/${att.storagePath}` })
      } catch {
        // файл пропал из MinIO — пропускаем
      }
    }

    await archive.finalize()
  })

  // POST /backup/restore — восстановить из ZIP
  app.post('/backup/restore', async (req, reply) => {
    const data = await req.file({ limits: { fileSize: 2 * 1024 * 1024 * 1024 } }) // 2 GB max
    if (!data) return reply.status(400).send({ error: 'No file provided' })

    // Читаем ZIP в память
    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    // Парсим ZIP
    const AdmZip = (await import('adm-zip')).default
    let zip: InstanceType<typeof AdmZip>
    try {
      zip = new AdmZip(buffer)
    } catch {
      return reply.status(400).send({ error: 'Invalid ZIP file' })
    }

    // Найти data.json (может быть в подпапке)
    const dataEntry = zip.getEntries().find((e) => e.entryName.endsWith('data.json'))
    if (!dataEntry) return reply.status(400).send({ error: 'data.json not found in backup' })

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(dataEntry.getData().toString('utf-8'))
    } catch {
      return reply.status(400).send({ error: 'Invalid data.json' })
    }

    const version = parsed.backupVersion as string | undefined
    if (!version || !version.startsWith('2')) {
      return reply.status(400).send({ error: 'Unsupported backup version. Only v2.x supported.' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = parsed as any
    const restoreWorkspaceId = d.workspace?.id as string | undefined
    if (!restoreWorkspaceId) return reply.status(400).send({ error: 'workspace.id missing in backup data' })

    const existingWs = await prisma.workspace.findUnique({ where: { id: restoreWorkspaceId }, select: { id: true } })
    if (existingWs) {
      if (await denyIfNotMember(prisma, restoreWorkspaceId, req.authUser!.id, reply)) return
    }

    const stats = { created: 0, skipped: 0, files: 0 }

    // ── 1. Workspace ──────────────────────────────────────────────────────────
    await prisma.workspace.upsert({
      where: { id: d.workspace.id },
      update: {},
      create: {
        id: d.workspace.id,
        name: d.workspace.name,
        description: d.workspace.description,
        icon: d.workspace.icon,
        color: d.workspace.color,
        settings: d.workspace.settings ?? {},
        createdAt: new Date(d.workspace.createdAt),
        updatedAt: new Date(d.workspace.updatedAt),
      },
    })

    // ── 2. Projects ───────────────────────────────────────────────────────────
    for (const p of d.projects ?? []) {
      await prisma.project.upsert({
        where: { id: p.id },
        update: {},
        create: {
          id: p.id, workspaceId: p.workspaceId, name: p.name,
          description: p.description, icon: p.icon, color: p.color,
          status: p.status, settings: p.settings ?? {}, position: p.position,
          createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt),
        },
      })
      stats.created++
    }

    // ── 3. Boards ─────────────────────────────────────────────────────────────
    for (const b of d.boards ?? []) {
      await prisma.board.upsert({
        where: { id: b.id },
        update: {},
        create: {
          id: b.id, projectId: b.projectId, name: b.name,
          columns: b.columns ?? [],
          createdAt: new Date(b.createdAt), updatedAt: new Date(b.updatedAt),
        },
      })
    }

    // ── 4. Pages (два прохода — сначала без parentPageId) ────────────────────
    for (const pg of (d.pages ?? []).filter((p: Record<string, unknown>) => !p.parentPageId)) {
      await prisma.page.upsert({
        where: { id: pg.id },
        update: {},
        create: {
          id: pg.id, projectId: pg.projectId, title: pg.title,
          icon: pg.icon, content: pg.content ?? {}, type: pg.type ?? 'PAGE',
          position: pg.position, isDeleted: pg.isDeleted ?? false,
          createdAt: new Date(pg.createdAt), updatedAt: new Date(pg.updatedAt),
        },
      })
      stats.created++
    }
    for (const pg of (d.pages ?? []).filter((p: Record<string, unknown>) => p.parentPageId)) {
      await prisma.page.upsert({
        where: { id: pg.id },
        update: {},
        create: {
          id: pg.id, projectId: pg.projectId, parentPageId: pg.parentPageId,
          title: pg.title, icon: pg.icon, content: pg.content ?? {},
          type: pg.type ?? 'PAGE', position: pg.position, isDeleted: pg.isDeleted ?? false,
          createdAt: new Date(pg.createdAt), updatedAt: new Date(pg.updatedAt),
        },
      })
    }

    // ── 5. Tags ───────────────────────────────────────────────────────────────
    for (const t of d.tags ?? []) {
      await prisma.tag.upsert({
        where: { id: t.id },
        update: {},
        create: { id: t.id, workspaceId: t.workspaceId, name: t.name, color: t.color },
      })
    }

    // ── 6. Tasks (два прохода — subtasks) ────────────────────────────────────
    for (const t of (d.tasks ?? []).filter((t: Record<string, unknown>) => !t.parentTaskId)) {
      await prisma.task.upsert({
        where: { id: t.id },
        update: {},
        create: {
          id: t.id, projectId: t.projectId, pageId: t.pageId,
          boardId: t.boardId, boardColumnId: t.boardColumnId,
          title: t.title, description: t.description, status: t.status,
          priority: t.priority, dueDate: t.dueDate ? new Date(t.dueDate) : null,
          startDate: t.startDate ? new Date(t.startDate) : null,
          isRecurring: t.isRecurring ?? false, recurrenceRule: t.recurrenceRule,
          reminderAt: (t.reminderAt ?? []).map((d: string) => new Date(d)),
          assignee: t.assignee, position: t.position, isDeleted: t.isDeleted ?? false,
          createdAt: new Date(t.createdAt), updatedAt: new Date(t.updatedAt),
        },
      })
      stats.created++
    }
    for (const t of (d.tasks ?? []).filter((t: Record<string, unknown>) => t.parentTaskId)) {
      await prisma.task.upsert({
        where: { id: t.id },
        update: {},
        create: {
          id: t.id, projectId: t.projectId, pageId: t.pageId, parentTaskId: t.parentTaskId,
          boardId: t.boardId, boardColumnId: t.boardColumnId,
          title: t.title, description: t.description, status: t.status,
          priority: t.priority, dueDate: t.dueDate ? new Date(t.dueDate) : null,
          startDate: t.startDate ? new Date(t.startDate) : null,
          isRecurring: t.isRecurring ?? false, recurrenceRule: t.recurrenceRule,
          reminderAt: (t.reminderAt ?? []).map((d: string) => new Date(d)),
          assignee: t.assignee, position: t.position, isDeleted: t.isDeleted ?? false,
          createdAt: new Date(t.createdAt), updatedAt: new Date(t.updatedAt),
        },
      })
    }

    // ── 7. TaskTags ───────────────────────────────────────────────────────────
    for (const tt of d.taskTags ?? []) {
      await prisma.taskTag.upsert({
        where: { taskId_tagId: { taskId: tt.taskId, tagId: tt.tagId } },
        update: {},
        create: { taskId: tt.taskId, tagId: tt.tagId },
      }).catch(() => { /* ignore if task/tag missing */ })
    }

    // ── 8. Notes ─────────────────────────────────────────────────────────────
    for (const n of d.notes ?? []) {
      await prisma.note.upsert({
        where: { id: n.id },
        update: {},
        create: {
          id: n.id, workspaceId: n.workspaceId, projectId: n.projectId,
          content: n.content, tags: n.tags ?? [], pinned: n.pinned ?? false,
          color: n.color, createdAt: new Date(n.createdAt), updatedAt: new Date(n.updatedAt),
        },
      })
    }

    // ── 9. Calendar events ────────────────────────────────────────────────────
    for (const e of d.calendarEvents ?? []) {
      await prisma.calendarEvent.upsert({
        where: { id: e.id },
        update: {},
        create: {
          id: e.id, projectId: e.projectId, title: e.title, description: e.description,
          startAt: new Date(e.startAt), endAt: e.endAt ? new Date(e.endAt) : null,
          allDay: e.allDay ?? false, isRecurring: e.isRecurring ?? false,
          recurrenceRule: e.recurrenceRule,
          reminderAt: (e.reminderAt ?? []).map((d: string) => new Date(d)),
          linkedDocuments: e.linkedDocuments ?? [], color: e.color, location: e.location,
          createdAt: new Date(e.createdAt), updatedAt: new Date(e.updatedAt),
        },
      })
    }

    // ── 10. Budget entries ────────────────────────────────────────────────────
    for (const b of d.budgetEntries ?? []) {
      await prisma.budgetEntry.upsert({
        where: { id: b.id },
        update: {},
        create: {
          id: b.id, projectId: b.projectId, type: b.type, category: b.category,
          amount: b.amount, currency: b.currency ?? 'RUB', date: new Date(b.date),
          description: b.description, isRecurring: b.isRecurring ?? false,
          recurrenceRule: b.recurrenceRule, tags: b.tags ?? [],
          createdAt: new Date(b.createdAt), updatedAt: new Date(b.updatedAt),
        },
      })
    }

    // ── 11. Links ─────────────────────────────────────────────────────────────
    for (const l of d.links ?? []) {
      await prisma.link.upsert({
        where: { id: l.id },
        update: {},
        create: {
          id: l.id, workspaceId: l.workspaceId,
          sourceType: l.sourceType, sourceId: l.sourceId,
          targetType: l.targetType, targetId: l.targetId,
          linkType: l.linkType, metadata: l.metadata ?? {},
          createdAt: new Date(l.createdAt),
        },
      })
    }

    // ── 12. Attachments + файлы в MinIO ───────────────────────────────────────
    const fileEntries = zip.getEntries().filter((e) => e.entryName.includes('/files/') && !e.isDirectory)

    for (const att of d.attachments ?? []) {
      // Найти файл в ZIP по storagePath
      const fileEntry = fileEntries.find((e) => e.entryName.endsWith(att.storagePath))
      let storagePath = att.storagePath

      if (fileEntry) {
        const fileBuffer = fileEntry.getData()
        // Загрузить в MinIO (если путь уже занят — создать новый)
        try {
          await minio.statObject(BUCKET, storagePath)
          // Файл уже есть — пропускаем MinIO загрузку
        } catch {
          // Файла нет — загружаем
          await uploadFile(storagePath, fileBuffer, att.mimeType, fileBuffer.byteLength)
          stats.files++
        }
      } else {
        // Файла в ZIP нет — генерируем новый путь-заглушку
        const ext = att.filename.split('.').pop() ?? 'bin'
        storagePath = `${att.workspaceId}/${randomUUID()}.${ext}`
      }

      await prisma.attachment.upsert({
        where: { id: att.id },
        update: {},
        create: {
          id: att.id, workspaceId: att.workspaceId, projectId: att.projectId,
          filename: att.filename, description: att.description,
          mimeType: att.mimeType, size: att.size,
          storagePath, isImportant: att.isImportant ?? false,
          metadata: att.metadata ?? {},
          createdAt: new Date(att.createdAt),
        },
      })
    }

    await writeAuditLog(prisma, { action: 'backup.restored', workspaceId: d.workspace.id, userId: req.authUser!.id, resourceType: 'workspace', resourceId: d.workspace.id, resourceName: d.workspace.name, ip: req.ip })

    return reply.send({
      ok: true,
      workspaceId: d.workspace.id,
      stats: {
        projects: (d.projects ?? []).length,
        pages: (d.pages ?? []).length,
        tasks: (d.tasks ?? []).length,
        notes: (d.notes ?? []).length,
        files: stats.files,
        links: (d.links ?? []).length,
      },
    })
  })
}
