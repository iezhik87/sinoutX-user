import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import archiver from 'archiver'
import { randomUUID } from 'crypto'
import { minio, BUCKET, uploadFile } from '../../lib/storage.js'
import { denyIfNotMember, getProjectWorkspaceId } from '../../lib/requireAccess.js'
import { tipTapToDocxBuffer } from './docx-export.js'
import { tipTapToPdfBuffer } from './pdf-export.js'

// ─── TipTap JSON → Markdown ───────────────────────────────────────────────────

function nodeToMarkdown(node: Record<string, unknown>, depth = 0): string {
  const type = node.type as string
  const content = node.content as Record<string, unknown>[] | undefined
  const attrs = node.attrs as Record<string, unknown> | undefined
  const text = node.text as string | undefined

  switch (type) {
    case 'doc':
      return (content ?? []).map((c) => nodeToMarkdown(c)).join('\n\n')

    case 'paragraph': {
      if (!content?.length) return ''
      return (content ?? []).map((c) => nodeToMarkdown(c)).join('')
    }

    case 'text': {
      let t = text ?? ''
      const marks = node.marks as Record<string, unknown>[] | undefined
      if (marks) {
        for (const mark of marks) {
          const mt = mark.type as string
          if (mt === 'bold') t = `**${t}**`
          else if (mt === 'italic') t = `_${t}_`
          else if (mt === 'strike') t = `~~${t}~~`
          else if (mt === 'code') t = `\`${t}\``
          else if (mt === 'link') {
            const href = (mark.attrs as Record<string, unknown>)?.href as string
            t = `[${t}](${href})`
          }
        }
      }
      return t
    }

    case 'heading': {
      const level = (attrs?.level as number) ?? 1
      const prefix = '#'.repeat(level)
      const text = (content ?? []).map((c) => nodeToMarkdown(c)).join('')
      return `${prefix} ${text}`
    }

    case 'bulletList':
      return (content ?? []).map((c) => nodeToMarkdown(c, depth)).join('\n')

    case 'orderedList':
      return (content ?? []).map((c, i) => nodeToMarkdown(c, depth).replace(/^- /, `${i + 1}. `)).join('\n')

    case 'listItem': {
      const inner = (content ?? []).map((c) => nodeToMarkdown(c)).join('')
      return `${'  '.repeat(depth)}- ${inner}`
    }

    case 'taskList':
      return (content ?? []).map((c) => nodeToMarkdown(c, depth)).join('\n')

    case 'taskItem': {
      const checked = attrs?.checked ? '[x]' : '[ ]'
      const inner = (content ?? []).map((c) => nodeToMarkdown(c)).join('')
      return `- ${checked} ${inner}`
    }

    case 'codeBlock': {
      const lang = (attrs?.language as string) ?? ''
      const code = (content ?? []).map((c) => nodeToMarkdown(c)).join('')
      return `\`\`\`${lang}\n${code}\n\`\`\``
    }

    case 'blockquote': {
      const inner = (content ?? []).map((c) => nodeToMarkdown(c)).join('\n')
      return inner.split('\n').map((l) => `> ${l}`).join('\n')
    }

    case 'horizontalRule':
      return '---'

    case 'hardBreak':
      return '  \n'

    case 'image': {
      const src = attrs?.src as string
      const alt = (attrs?.alt as string) ?? ''
      return `![${alt}](${src})`
    }

    default:
      return (content ?? []).map((c) => nodeToMarkdown(c)).join('')
  }
}

function tipTapToMarkdown(doc: Record<string, unknown>): string {
  return nodeToMarkdown(doc).trim()
}

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(','))
  }
  return lines.join('\r\n')
}

/** ASCII-безопасное имя для файловой системы внутри ZIP */
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_А-Яа-яЁё ]/g, '_').trim() || 'project'
}

/** Имя файла для Content-Disposition с поддержкой Unicode (RFC 5987) */
function contentDispositionFilename(name: string): string {
  // ASCII fallback + UTF-8 encoded filename*
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/['"\\]/g, '_')
  const encoded = encodeURIComponent(name)
  return `filename="${ascii}"; filename*=UTF-8''${encoded}`
}

export async function exportRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // GET /pages/:id/export?format=md|json|docx|pdf
  app.get('/pages/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { format = 'md' } = req.query as { format?: string }

    const page = await prisma.page.findUnique({
      where: { id, isDeleted: false },
      include: {
        tasks: {
          where: { parentTaskId: null },
          orderBy: { position: 'asc' },
        },
        project: { select: { workspaceId: true } },
      },
    })

    if (!page) return reply.status(404).send({ error: 'Page not found' })
    if (await denyIfNotMember(prisma, page.project.workspaceId, req.authUser!.id, reply)) return

    const safeTitle = page.title.replace(/[^a-zA-Z0-9-_А-Яа-яЁё ]/g, '_').trim() || 'page'

    if (format === 'json') {
      reply.header('Content-Type', 'application/json')
      reply.header('Content-Disposition', `attachment; ${contentDispositionFilename(safeTitle + '.json')}`)
      return reply.send({ id: page.id, title: page.title, content: page.content, tasks: page.tasks, createdAt: page.createdAt, updatedAt: page.updatedAt })
    }

    if (format === 'docx') {
      const buffer = await tipTapToDocxBuffer(page.title, page.content as Record<string, unknown> ?? { type: 'doc', content: [] })
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      reply.header('Content-Disposition', `attachment; ${contentDispositionFilename(safeTitle + '.docx')}`)
      return reply.send(buffer)
    }

    if (format === 'pdf') {
      const buffer = await tipTapToPdfBuffer(page.title, page.content as Record<string, unknown> ?? { type: 'doc', content: [] })
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; ${contentDispositionFilename(safeTitle + '.pdf')}`)
      return reply.send(buffer)
    }

    // Markdown (default)
    const mdContent = page.content ? tipTapToMarkdown(page.content as Record<string, unknown>) : ''
    const tasksMd = page.tasks.length > 0
      ? '\n\n## Tasks\n\n' + page.tasks.map((t) => `- [${t.status === 'DONE' ? 'x' : ' '}] ${t.title}`).join('\n')
      : ''
    const markdown = `# ${page.title}\n\n${mdContent}${tasksMd}`
    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    reply.header('Content-Disposition', `attachment; ${contentDispositionFilename(safeTitle + '.md')}`)
    return reply.send(markdown)
  })

  // POST /pages/:id/export/save-as-attachment?format=docx|pdf
  // Generates file and saves it as a project attachment
  app.post('/pages/:id/export/save-as-attachment', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { format = 'docx' } = req.query as { format?: string }

    const page = await prisma.page.findUnique({
      where: { id, isDeleted: false },
      include: { project: { select: { id: true, workspaceId: true } } },
    })
    if (!page) return reply.status(404).send({ error: 'Page not found' })
    if (!page.project) return reply.status(400).send({ error: 'Page has no project' })
    if (await denyIfNotMember(prisma, page.project.workspaceId, req.authUser!.id, reply)) return

    const { workspaceId, id: projectId } = page.project
    const safeTitle = page.title.replace(/[^a-zA-Z0-9-_А-Яа-яЁё ]/g, '_').trim() || 'page'

    let buffer: Buffer, mimeType: string, ext: string
    if (format === 'pdf') {
      buffer = await tipTapToPdfBuffer(page.title, page.content as Record<string, unknown> ?? { type: 'doc', content: [] })
      mimeType = 'application/pdf'
      ext = 'pdf'
    } else {
      buffer = await tipTapToDocxBuffer(page.title, page.content as Record<string, unknown> ?? { type: 'doc', content: [] })
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ext = 'docx'
    }

    const filename = `${safeTitle}.${ext}`
    const storageKey = `${workspaceId}/${randomUUID()}.${ext}`
    await uploadFile(storageKey, buffer, mimeType, buffer.byteLength)

    const attachment = await prisma.attachment.create({
      data: {
        workspaceId,
        projectId,
        filename,
        description: `Экспортировано из страницы «${page.title}»`,
        mimeType,
        size: buffer.byteLength,
        storagePath: storageKey,
        isImportant: false,
        metadata: { exportedFrom: id, exportFormat: ext },
      },
    })

    return reply.status(201).send({ id: attachment.id, filename: attachment.filename, size: attachment.size })
  })

  // GET /projects/:id/export?format=json|md|pdf|docx
  app.get('/projects/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { format = 'json' } = req.query as { format?: string }

    const wsId = await getProjectWorkspaceId(prisma, id)
    if (!wsId) return reply.status(404).send({ error: 'Project not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        pages: {
          where: { isDeleted: false },
          orderBy: { position: 'asc' },
        },
        tasks: { orderBy: { position: 'asc' } },
        boards: { include: { tasks: { orderBy: { position: 'asc' } } } },
        budgetEntries: { orderBy: { date: 'desc' } },
        calendarEvents: { orderBy: { startAt: 'asc' } },
      },
    })

    if (!project) return reply.status(404).send({ error: 'Project not found' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = project as any

    if (format === 'pdf' || format === 'docx') {
      // Build combined TipTap doc: each page as H1 + content, separated by hr
      type TipTapNode = Record<string, unknown>
      const combinedNodes: TipTapNode[] = []
      for (const page of p.pages as { title: string; content: TipTapNode | null }[]) {
        combinedNodes.push({
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: page.title }],
        })
        const pageContent = page.content as { content?: TipTapNode[] } | null
        if (pageContent?.content?.length) {
          combinedNodes.push(...pageContent.content)
        }
        combinedNodes.push({ type: 'horizontalRule' })
      }
      const combinedDoc: TipTapNode = { type: 'doc', content: combinedNodes }
      const safeProjectName = project.name.replace(/[^a-zA-Z0-9-_А-Яа-яЁё ]/g, '_').trim() || 'project'

      if (format === 'pdf') {
        const buffer = await tipTapToPdfBuffer(project.name, combinedDoc)
        reply.header('Content-Type', 'application/pdf')
        reply.header('Content-Disposition', `attachment; ${contentDispositionFilename(safeProjectName + '.pdf')}`)
        return reply.send(buffer)
      }

      const buffer = await tipTapToDocxBuffer(project.name, combinedDoc)
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      reply.header('Content-Disposition', `attachment; ${contentDispositionFilename(safeProjectName + '.docx')}`)
      return reply.send(buffer)
    }

    if (format === 'json') {
      reply.header('Content-Type', 'application/json')
      reply.header('Content-Disposition', `attachment; filename="${project.name}.json"`)
      return reply.send({
        exportVersion: '1.0',
        exportedAt: new Date().toISOString(),
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          createdAt: project.createdAt,
        },
        pages: p.pages.map((pg: Record<string, unknown>) => ({
          id: pg.id,
          title: pg.title,
          parentPageId: pg.parentPageId,
          content: pg.content,
          position: pg.position,
        })),
        tasks: p.tasks,
        boards: p.boards,
        budgetEntries: p.budgetEntries,
        events: p.calendarEvents,
      })
    }

    // Markdown: one file per page, concatenated
    const sections: string[] = [`# ${project.name}\n\n${project.description ?? ''}`]

    for (const page of p.pages.filter((pg: Record<string, unknown>) => !pg.parentPageId)) {
      const content = page.content
        ? tipTapToMarkdown(page.content as Record<string, unknown>)
        : ''
      sections.push(`---\n\n# ${page.title}\n\n${content}`)
    }

    const markdown = sections.join('\n\n')
    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${project.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.md"`)
    return reply.send(markdown)
  })

  // GET /projects/:id/export/zip — полный ZIP со страницами + файлами
  app.get('/projects/:id/export/zip', async (req, reply) => {
    const { id } = req.params as { id: string }

    const wsId = await getProjectWorkspaceId(prisma, id)
    if (!wsId) return reply.status(404).send({ error: 'Project not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        pages: { where: { isDeleted: false }, orderBy: { position: 'asc' } },
        tasks: { orderBy: { position: 'asc' } },
        budgetEntries: { orderBy: { date: 'desc' } },
        calendarEvents: { orderBy: { startAt: 'asc' } },
        attachments: { orderBy: [{ isImportant: 'desc' }, { createdAt: 'desc' }] },
      },
    })

    if (!project) return reply.status(404).send({ error: 'Project not found' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = project as any
    const projectFolder = safeName(project.name)

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; ${contentDispositionFilename(projectFolder + '.zip')}`,
    })

    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', (err) => {
      console.error('ZIP archive error:', err)
      raw.end()
    })
    archive.pipe(raw)

    // README
    const readmeParts = [
      `# ${project.name}`,
      project.description ? `\n${project.description}` : '',
      `\nЭкспортировано: ${new Date().toLocaleDateString('ru-RU')}`,
      `\nСтраниц: ${p.pages.length}`,
      `\nЗадач: ${p.tasks.length}`,
      `\nФайлов: ${p.attachments.length}`,
    ]
    archive.append(readmeParts.join('\n'), { name: `${projectFolder}/README.md` })

    // Страницы как Markdown
    const usedNames = new Set<string>()
    for (const page of p.pages) {
      const baseName = safeName(page.title) || 'page'
      let fileName = baseName
      let idx = 1
      while (usedNames.has(fileName)) { fileName = `${baseName}_${idx++}` }
      usedNames.add(fileName)

      const content = page.content
        ? tipTapToMarkdown(page.content as Record<string, unknown>)
        : ''
      const md = `# ${page.title}\n\n${content}`
      archive.append(md, { name: `${projectFolder}/pages/${fileName}.md` })
    }

    // JSON дамп данных
    const jsonDump = JSON.stringify({
      exportVersion: '1.0',
      exportedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        createdAt: project.createdAt,
      },
      tasks: p.tasks,
      budgetEntries: p.budgetEntries,
      events: p.calendarEvents,
      attachments: p.attachments.map((a: Record<string, unknown>) => ({
        id: a.id,
        filename: a.filename,
        description: a.description,
        mimeType: a.mimeType,
        size: a.size,
        isImportant: a.isImportant,
        metadata: a.metadata,
      })),
    }, null, 2)
    archive.append(jsonDump, { name: `${projectFolder}/data.json` })

    // Вложения — скачиваем из MinIO
    for (const att of p.attachments) {
      try {
        const stream = await minio.getObject(BUCKET, att.storagePath)
        archive.append(stream, { name: `${projectFolder}/files/${att.filename}` })
      } catch {
        // Если файл не найден — пропускаем
      }
    }

    await archive.finalize()
  })

  // GET /projects/:id/budget/export?format=csv|json&year=2025
  app.get('/projects/:id/budget/export', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { format = 'csv', year } = req.query as { format?: string; year?: string }

    const wsId = await getProjectWorkspaceId(prisma, id)
    if (!wsId) return reply.status(404).send({ error: 'Project not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return

    const where: Record<string, unknown> = { projectId: id }
    if (year) {
      const y = parseInt(year, 10)
      where.date = {
        gte: new Date(`${y}-01-01`),
        lt: new Date(`${y + 1}-01-01`),
      }
    }

    const entries = await prisma.budgetEntry.findMany({
      where,
      orderBy: { date: 'desc' },
    })

    const project = await prisma.project.findUnique({ where: { id }, select: { name: true } })
    const filename = `${(project?.name ?? 'budget').replace(/[^a-zA-Z0-9-_]/g, '_')}_budget`

    if (format === 'json') {
      reply.header('Content-Type', 'application/json')
      reply.header('Content-Disposition', `attachment; filename="${filename}.json"`)
      return reply.send(entries)
    }

    const rows = entries.map((e) => ({
      date: e.date.toISOString().slice(0, 10),
      type: e.type,
      category: e.category,
      amount: e.amount.toString(),
      currency: e.currency,
      description: e.description ?? '',
      tags: e.tags.join(';'),
    }))

    const csv = toCsv(rows, ['date', 'type', 'category', 'amount', 'currency', 'description', 'tags'])

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${filename}.csv"`)
    return reply.send('\uFEFF' + csv)
  })
}
