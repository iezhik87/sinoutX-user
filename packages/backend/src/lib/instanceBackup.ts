import type { PrismaClient } from '@prisma/client'
import archiver from 'archiver'
import { promises as fs } from 'fs'
import { join } from 'path'
import { minio, BUCKET } from './storage.js'

// Configured server backup destinations. Set BACKUP_DIRS to a ';'-separated
// list of "Label=/abs/path" entries (mount each path into the container via
// docker-compose). Defaults to the uploads volume.
export function serverDirs(): { label: string; path: string }[] {
  const raw = process.env.BACKUP_DIRS?.trim()
  if (!raw) return [{ label: 'Сервер', path: process.env.BACKUP_DIR || '/app/uploads/backups' }]
  return raw.split(';').map((s) => {
    const i = s.indexOf('=')
    return i < 0 ? null : { label: s.slice(0, i).trim(), path: s.slice(i + 1).trim() }
  }).filter((d): d is { label: string; path: string } => !!d && !!d.label && !!d.path)
}
export function dirByLabel(label?: string): { label: string; path: string } | undefined {
  const dirs = serverDirs()
  return dirs.find((d) => d.label === label) ?? dirs[0]
}

// ─── Gather the whole instance ────────────────────────────────────────────────
export async function gatherGlobalData(prisma: PrismaClient) {
  const [
    users, workspaces, members, projects, pages, tasks, taskTags, notes,
    calendarEvents, budgetEntries, boards, links, tags, attachments, integrations,
  ] = await Promise.all([
    prisma.user.findMany(), prisma.workspace.findMany(), prisma.workspaceMember.findMany(),
    prisma.project.findMany(), prisma.page.findMany(), prisma.task.findMany(),
    prisma.taskTag.findMany(), prisma.note.findMany(), prisma.calendarEvent.findMany(),
    prisma.budgetEntry.findMany(), prisma.board.findMany(), prisma.link.findMany(),
    prisma.tag.findMany(), prisma.attachment.findMany(), prisma.integration.findMany(),
  ])
  return {
    backupVersion: '3.0-global', exportedAt: new Date().toISOString(),
    users, workspaces, members, projects, pages, tasks, taskTags, notes,
    calendarEvents, budgetEntries, boards, links, tags, attachments, integrations,
  }
}

export type GlobalData = Awaited<ReturnType<typeof gatherGlobalData>>

/** How the file half of a backup actually went. A backup that silently ships
 *  zero files looks identical to one that shipped them all — until you unzip it
 *  and find it empty. This makes the truth legible: it rides in the zip as
 *  manifest.json, in the server log, and in the API response. */
export interface BackupFileStats {
  /** Attachment rows in the DB — the number of files we *should* have. */
  total: number
  included: number
  skipped: number
  /** Bytes of file content actually written (before zip compression). */
  bytes: number
  /** First few paths that could not be fetched, with the reason. For diagnosis. */
  skippedSample: { path: string; reason: string }[]
}

// Pull one object fully into memory before appending it. A streamed getObject
// that errors mid-flight takes the whole archive down with it (archiver's error
// handler fires); buffering isolates the failure to that one file and lets us
// measure it.
async function fetchObject(storagePath: string): Promise<Buffer> {
  const stream = await minio.getObject(BUCKET, storagePath)
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

// Where backups themselves live inside the bucket. A backup must never contain
// older backups — that is how a 5 MB instance grows a 5 GB archive.
export const BACKUP_MINIO_PREFIX = 'backups/'

/** Every object key in the bucket except stored backups. */
async function listBucketObjects(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const out: string[] = []
    const stream = minio.listObjectsV2(BUCKET, '', true)
    stream.on('data', (o) => { if (o.name && !o.name.startsWith(BACKUP_MINIO_PREFIX)) out.push(o.name) })
    stream.on('end', () => resolve(out))
    stream.on('error', reject)
  })
}

/**
 * Mirror the whole bucket into the archive — every object, not only the ones a
 * DB row points at. Agent-generated images, TTS audio, exports and clips live in
 * MinIO without an `attachment` row; iterating attachments silently left them
 * out of the backup. A file now escapes only by not existing.
 */
export async function appendBucketFiles(archive: archiver.Archiver): Promise<BackupFileStats> {
  const names = await listBucketObjects()
  const stats: BackupFileStats = { total: names.length, included: 0, skipped: 0, bytes: 0, skippedSample: [] }
  for (const name of names) {
    try {
      const buf = await fetchObject(name)
      archive.append(buf, { name: `files/${name}` })
      stats.included++
      stats.bytes += buf.byteLength
    } catch (e) {
      stats.skipped++
      const reason = (e as Error).message || String(e)
      if (stats.skippedSample.length < 20) stats.skippedSample.push({ path: name, reason })
      console.warn(`[backup] skip file ${name}: ${reason}`)
    }
  }
  return stats
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

// Build a zip (data.json + manifest.json + MinIO files) into a Buffer.
export async function buildBackupBuffer(prisma: PrismaClient): Promise<{ buffer: Buffer; data: GlobalData; files: BackupFileStats }> {
  const data = await gatherGlobalData(prisma)
  const archive = archiver('zip', { zlib: { level: 6 } })
  const chunks: Buffer[] = []
  archive.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((res, rej) => {
    archive.on('end', () => res(Buffer.concat(chunks)))
    archive.on('error', rej)
  })
  archive.append(JSON.stringify(data, null, 2), { name: 'data.json' })
  const files = await appendBucketFiles(archive)
  archive.append(JSON.stringify({ createdAt: new Date().toISOString(), files }, null, 2), { name: 'manifest.json' })
  await archive.finalize()
  console.log(`[backup] files ${files.included}/${files.total} included, ${files.skipped} skipped, ${mb(files.bytes)} MB of content`)
  return { buffer: await done, data, files }
}

export function backupName(): string {
  return `sinoutx-full-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`
}

// Keep only the newest `keep` *.zip files in a directory.
export async function pruneDir(dir: string, keep: number): Promise<void> {
  if (keep <= 0) return
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.zip'))
    const withTime = await Promise.all(files.map(async (f) => ({ f, t: (await fs.stat(join(dir, f))).mtimeMs })))
    withTime.sort((a, b) => b.t - a.t)
    for (const { f } of withTime.slice(keep)) await fs.unlink(join(dir, f)).catch(() => null)
  } catch { /* dir missing */ }
}
