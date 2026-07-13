import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import AdmZip from 'adm-zip'
import { markdownToTipTap, htmlToTipTap } from './notion-parser.js'
import { denyIfNotMember } from '../../lib/requireAccess.js'

const MAX_IMPORT_SIZE = 50 * 1024 * 1024 // 50 MB

// Notion appends a 32-char hex UUID to filenames: "Page Title abc123...html" → "Page Title"
function cleanTitle(filename: string): string {
  const withoutExt = filename.replace(/\.(html|md|csv)$/, '').replace(/%20/g, ' ')
  return withoutExt.replace(/\s+[0-9a-f]{32}$/i, '').trim() || withoutExt
}

interface FlatEntry {
  entryName: string
  getData: () => Buffer
}

// Recursively flatten ZIP archives — Notion multi-part exports wrap files in Part-N.zip
function flattenZip(zip: AdmZip, visited = new Set<string>()): FlatEntry[] {
  const result: FlatEntry[] = []
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (entry.entryName.includes('__MACOSX') || entry.entryName.includes('.DS_Store')) continue

    if (entry.entryName.endsWith('.zip')) {
      try {
        const innerZip = new AdmZip(entry.getData())
        const innerKey = entry.entryName
        if (!visited.has(innerKey)) {
          visited.add(innerKey)
          result.push(...flattenZip(innerZip, visited))
        }
      } catch { /* skip corrupt inner zips */ }
    } else if (entry.entryName.endsWith('.md') || entry.entryName.endsWith('.html') || entry.entryName.endsWith('.csv')) {
      result.push({ entryName: entry.entryName, getData: () => entry.getData() })
    }
  }
  return result
}

// Simple CSV parser (handles quoted fields with commas and newlines)
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (c === ',' && !inQuotes) {
      result.push(current.trim()); current = ''
    } else {
      current += c
    }
  }
  result.push(current.trim())
  return result
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0])
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = values[i] ?? '' })
    return row
  }).filter(r => Object.values(r).some(v => v))
}

function mapNotionPriority(val: string): string {
  const v = val.toLowerCase()
  if (v.includes('high') || v.includes('p1') || v.includes('urgent') || v.includes('critical')) return 'HIGH'
  if (v.includes('medium') || v.includes('p2') || v.includes('normal')) return 'MEDIUM'
  if (v.includes('low') || v.includes('p3')) return 'LOW'
  return 'MEDIUM'
}

function mapNotionStatus(val: string): string {
  const v = val.toLowerCase()
  if (v.includes('done') || v.includes('complete') || v.includes('finished') || v.includes('выполн') || v.includes('завершён') || v.includes('готово')) return 'DONE'
  if (v.includes('progress') || v.includes('doing') || v.includes('в работе') || v.includes('в процессе')) return 'IN_PROGRESS'
  if (v.includes('review') || v.includes('проверк')) return 'IN_PROGRESS'
  return 'TODO'
}

function parseNotionDate(val: string): Date | null {
  if (!val) return null
  try {
    const d = new Date(val)
    return isNaN(d.getTime()) ? null : d
  } catch { return null }
}

interface ImportResult {
  projectId: string
  pagesCreated: number
  pagesSkipped: number
  tasksCreated: number
  errors: string[]
}

export async function importRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // POST /import/notion — import from Notion ZIP export (HTML or Markdown format)
  app.post('/import/notion', async (req, reply) => {
    const qs = req.query as Record<string, string>
    const workspaceId = qs.workspaceId
    let projectId = qs.projectId || null
    const newProjectName = qs.newProjectName || 'Notion Import'

    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const data = await req.file({ limits: { fileSize: MAX_IMPORT_SIZE } })
    if (!data) return reply.status(400).send({ error: 'No file provided' })

    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    let zip: AdmZip
    try {
      zip = new AdmZip(buffer)
    } catch {
      return reply.status(400).send({ error: 'Invalid ZIP file' })
    }

    if (!projectId) {
      const project = await prisma.project.create({
        data: { workspaceId, name: newProjectName, description: 'Импортировано из Notion', status: 'ACTIVE', icon: '📥' },
      })
      projectId = project.id
    }

    const result: ImportResult = { projectId, pagesCreated: 0, pagesSkipped: 0, tasksCreated: 0, errors: [] }

    // Flatten ZIP (including nested Part-N.zip from Notion multi-part exports)
    const allEntries = flattenZip(zip)
      .sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length)

    const pageEntries = allEntries.filter(e => e.entryName.endsWith('.md') || e.entryName.endsWith('.html'))
    // Skip _all.csv (Notion exports with archived items) and use only primary CSV
    const csvEntries = allEntries.filter(e => e.entryName.endsWith('.csv') && !e.entryName.endsWith('_all.csv'))

    if (allEntries.length === 0) {
      return reply.status(200).send({ ...result, errors: ['No importable files found in the ZIP'] })
    }

    // ── Import pages ──────────────────────────────────────────────────────────
    const dirToPageId = new Map<string, string>()

    for (const entry of pageEntries) {
      try {
        const parts = entry.entryName.split('/')
        const filename = parts[parts.length - 1]
        const dirParts = parts.slice(0, -1)
        const title = cleanTitle(filename)
        if (!title) { result.pagesSkipped++; continue }

        let parentPageId: string | null = null
        if (dirParts.length > 0) {
          parentPageId = dirToPageId.get(dirParts.join('/')) ?? null
        }

        const fileContent = entry.getData().toString('utf8')
        const tipTap = entry.entryName.endsWith('.html')
          ? htmlToTipTap(fileContent)
          : markdownToTipTap(fileContent)

        const page = await prisma.page.create({
          data: {
            projectId: projectId!,
            parentPageId,
            title,
            content: tipTap as unknown as Prisma.InputJsonValue,
            type: 'PAGE',
          },
        })

        dirToPageId.set(entry.entryName.replace(/\.(html|md)$/, ''), page.id)
        result.pagesCreated++
      } catch (err) {
        result.errors.push(`${entry.entryName}: ${(err as Error).message}`)
        result.pagesSkipped++
      }
    }

    // ── Import tasks from CSV databases ───────────────────────────────────────
    let tasksCreated = 0
    for (const entry of csvEntries) {
      try {
        const rows = parseCsv(entry.getData().toString('utf8'))
        if (rows.length === 0) continue

        const headers = Object.keys(rows[0])
        const nameCol = headers.find(h => h.toLowerCase() === 'name' || h.toLowerCase() === 'title' || h.toLowerCase() === 'task') ?? ''
        if (!nameCol) continue

        const statusCol = headers.find(h => h.toLowerCase() === 'status')
        const priorityCol = headers.find(h => h.toLowerCase() === 'priority')
        const dueDateCol = headers.find(h => /due|date|deadline/i.test(h))
        const descCol = headers.find(h => /description|desc|note|comment/i.test(h))

        for (const row of rows) {
          const title = row[nameCol]?.trim()
          if (!title) continue
          const descText = descCol ? row[descCol]?.trim() : ''
          const descJson = descText
            ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: descText }] }] }
            : null
          await prisma.task.create({
            data: {
              projectId: projectId!,
              title,
              description: (descJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              status: (statusCol ? mapNotionStatus(row[statusCol]) : 'TODO') as 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED',
              priority: (priorityCol ? mapNotionPriority(row[priorityCol]) : 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
              dueDate: dueDateCol ? parseNotionDate(row[dueDateCol]) : null,
            },
          })
          tasksCreated++
        }
      } catch (err) {
        result.errors.push(`${entry.entryName} (CSV): ${(err as Error).message}`)
      }
    }

    return reply.status(200).send({ ...result, tasksCreated })
  })

  // POST /import/obsidian — import from Obsidian vault ZIP
  app.post('/import/obsidian', async (req, reply) => {
    const qs = req.query as Record<string, string>
    const workspaceId = qs.workspaceId
    let projectId = qs.projectId || null
    const newProjectName = qs.newProjectName || 'Obsidian Vault'

    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const data = await req.file({ limits: { fileSize: MAX_IMPORT_SIZE } })
    if (!data) return reply.status(400).send({ error: 'No file provided' })

    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    let zip: AdmZip
    try {
      zip = new AdmZip(buffer)
    } catch {
      return reply.status(400).send({ error: 'Invalid ZIP file' })
    }

    if (!projectId) {
      const project = await prisma.project.create({
        data: { workspaceId, name: newProjectName, description: 'Импортировано из Obsidian', status: 'ACTIVE', icon: '🔮' },
      })
      projectId = project.id
    }

    const result: ImportResult = { projectId, pagesCreated: 0, pagesSkipped: 0, tasksCreated: 0, errors: [] }

    const fileEntries = zip.getEntries()
      .filter(e => !e.isDirectory && e.entryName.endsWith('.md'))
      .filter(e => !e.entryName.includes('.obsidian/') && !e.entryName.includes('__MACOSX'))
      .sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length)

    // Obsidian: folder path → folder page id (created on demand)
    const folderToPageId = new Map<string, string>()

    const ensureFolder = async (folderPath: string): Promise<string> => {
      if (folderToPageId.has(folderPath)) return folderToPageId.get(folderPath)!
      const parts = folderPath.split('/')
      let parentPageId: string | null = null
      if (parts.length > 1) {
        parentPageId = await ensureFolder(parts.slice(0, -1).join('/'))
      }
      const page = await prisma.page.create({
        data: {
          projectId: projectId!,
          parentPageId,
          title: parts[parts.length - 1],
          content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] } as unknown as Prisma.InputJsonValue,
          type: 'FOLDER',
        },
      })
      folderToPageId.set(folderPath, page.id)
      return page.id
    }

    for (const entry of fileEntries) {
      try {
        const parts = entry.entryName.split('/')
        const filename = parts[parts.length - 1]
        const title = filename.replace(/\.md$/, '').trim()
        if (!title) { result.pagesSkipped++; continue }

        let parentPageId: string | null = null
        if (parts.length > 1) {
          parentPageId = await ensureFolder(parts.slice(0, -1).join('/'))
        }

        const tipTap = markdownToTipTap(entry.getData().toString('utf8'))
        await prisma.page.create({
          data: {
            projectId: projectId!,
            parentPageId,
            title,
            content: tipTap as unknown as Prisma.InputJsonValue,
            type: 'PAGE',
          },
        })
        result.pagesCreated++
      } catch (err) {
        result.errors.push(`${entry.entryName}: ${(err as Error).message}`)
        result.pagesSkipped++
      }
    }

    return reply.status(200).send(result)
  })
}
