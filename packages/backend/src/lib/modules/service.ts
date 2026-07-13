import type { PrismaClient, Prisma } from '@prisma/client'
import { ManifestSchema, localized, type Manifest } from './manifest.js'
import { BUILTIN_MANIFESTS } from '../../data/modules/index.js'
import { isSafeWebhookUrl } from '../webhook.js'

const asJson = (v: unknown) => v as Prisma.InputJsonValue

// ─── Catalog ──────────────────────────────────────────────────────────────────

// Validate + upsert the built-in manifests into the catalog on boot.
export async function syncBuiltinModules(prisma: PrismaClient): Promise<void> {
  for (const raw of BUILTIN_MANIFESTS) {
    const parsed = ManifestSchema.safeParse(raw)
    if (!parsed.success) {
      console.error('[modules] invalid built-in manifest, skipped:', parsed.error.issues[0]?.message)
      continue
    }
    const m = parsed.data
    await prisma.module.upsert({
      where: { moduleId: m.id },
      update: { version: m.version, manifest: asJson(m), source: 'builtin' },
      create: { moduleId: m.id, version: m.version, manifest: asJson(m), source: 'builtin' },
    }).catch((e) => console.error('[modules] sync failed for', m.id, e))
  }
}

export interface CatalogItem {
  moduleId: string
  version: string
  source: string
  name: Record<string, string>
  description?: Record<string, string>
  icon?: string
  disclaimer?: Record<string, string>
}

export async function listCatalog(prisma: PrismaClient): Promise<CatalogItem[]> {
  const mods = await prisma.module.findMany({ orderBy: { createdAt: 'asc' } })
  return mods.map((mod) => {
    const m = mod.manifest as unknown as Manifest
    return { moduleId: mod.moduleId, version: mod.version, source: mod.source, name: m.name, description: m.description, icon: m.icon, disclaimer: m.disclaimer }
  })
}

export async function getManifest(prisma: PrismaClient, moduleId: string): Promise<Manifest | null> {
  const mod = await prisma.module.findUnique({ where: { moduleId } })
  if (!mod) return null
  const parsed = ManifestSchema.safeParse(mod.manifest)
  return parsed.success ? parsed.data : null
}

// Validate + store a user-supplied manifest in the catalog.
export async function importManifest(prisma: PrismaClient, raw: unknown): Promise<{ ok: true; moduleId: string } | { ok: false; error: string }> {
  const parsed = ManifestSchema.safeParse(raw)
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { ok: false, error: `${i?.path.join('.') || 'manifest'}: ${i?.message}` }
  }
  const m = parsed.data
  await prisma.module.upsert({
    where: { moduleId: m.id },
    update: { version: m.version, manifest: asJson(m), source: 'imported' },
    create: { moduleId: m.id, version: m.version, manifest: asJson(m), source: 'imported' },
  })
  return { ok: true, moduleId: m.id }
}

// Convert a GitHub "blob" URL to its raw form so users can paste the page URL.
function toRawUrl(u: string): string {
  const m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : u
}

// Fetch a manifest from a URL (e.g. a module's GitHub repo) and add it to the
// catalog. Module = self-contained unit shipped from its own repo.
export async function importManifestFromUrl(prisma: PrismaClient, url: string): Promise<{ ok: true; moduleId: string } | { ok: false; error: string }> {
  if (!isSafeWebhookUrl(url)) return { ok: false, error: 'Invalid or unsafe URL' }
  const raw = toRawUrl(url.trim())
  let json: unknown
  try {
    const res = await fetch(raw, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json, text/plain, */*' } })
    if (!res.ok) return { ok: false, error: `Fetch failed: ${res.status}` }
    const text = await res.text()
    if (text.length > 512 * 1024) return { ok: false, error: 'Manifest too large' }
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Could not fetch or parse the manifest' }
  }
  return importManifest(prisma, json)
}

// ─── Install / uninstall (per workspace) ───────────────────────────────────────

export async function listInstalled(prisma: PrismaClient, workspaceId: string): Promise<string[]> {
  const projects = await prisma.project.findMany({
    where: { workspaceId, isModule: true }, select: { moduleId: true },
  })
  return projects.map((p) => p.moduleId).filter((x): x is string => !!x)
}

// Scaffold a module-project + its collections/views + seed records.
export async function installModule(
  prisma: PrismaClient, workspaceId: string, moduleId: string, userId: string,
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const m = await getManifest(prisma, moduleId)
  if (!m) return { ok: false, error: 'Module not found' }

  // Idempotent: a second call re-syncs the schema (names/views/fields, e.g. after
  // a module update or a new language) WITHOUT touching the user's records.
  const existing = await prisma.project.findFirst({ where: { workspaceId, isModule: true, moduleId } })
  const isNew = !existing

  const project = existing ?? await prisma.project.create({
    data: {
      workspaceId,
      name: localized(m.name),
      description: localized(m.description),
      icon: m.icon ?? 'lucide:Boxes',
      isModule: true,
      moduleId,
      position: ((await prisma.project.findFirst({ where: { workspaceId }, orderBy: { position: 'desc' }, select: { position: true } }))?.position ?? -1) + 1,
    },
  })

  await syncModuleSchema(prisma, project.id, moduleId, m)

  // Seed only on first install — never duplicate records on re-sync.
  if (isNew) {
    const cols = await prisma.collection.findMany({ where: { projectId: project.id }, select: { id: true, key: true } })
    for (const c of cols) {
      for (const row of m.seed?.[c.key] ?? []) {
        await prisma.collectionRecord.create({ data: { collectionId: c.id, data: asJson(row), createdBy: userId } })
      }
    }
  }

  return { ok: true, projectId: project.id }
}

// Upsert a project's collections + views from the manifest (additive; never
// touches records). Shared by install and the boot-time re-sync.
async function syncModuleSchema(prisma: PrismaClient, projectId: string, moduleId: string, m: Manifest): Promise<void> {
  for (const [ci, c] of m.collections.entries()) {
    const col = await prisma.collection.upsert({
      where: { projectId_key: { projectId, key: c.key } },
      update: { name: asJson(c.name), icon: c.icon ?? null, fields: asJson(c.fields), position: ci, moduleId },
      create: { projectId, moduleId, key: c.key, name: asJson(c.name), icon: c.icon ?? null, fields: asJson(c.fields), position: ci },
    })
    const views = c.views?.length ? c.views : [{ key: 'all', type: 'table', name: c.name, config: {} }]
    for (const [vi, v] of views.entries()) {
      await prisma.collectionView.upsert({
        where: { collectionId_key: { collectionId: col.id, key: v.key } },
        update: { type: v.type, name: asJson(v.name), config: asJson(v.config ?? {}), position: vi },
        create: { collectionId: col.id, key: v.key, type: v.type, name: asJson(v.name), config: asJson(v.config ?? {}), position: vi },
      })
    }
  }
}

// On boot: re-sync every installed module-project to its current manifest, so
// module updates (new languages, new views/fields) propagate without a manual
// reinstall. Additive only — user records are never touched.
export async function resyncInstalledModules(prisma: PrismaClient): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { isModule: true, moduleId: { not: null } }, select: { id: true, moduleId: true },
  })
  for (const p of projects) {
    const m = await getManifest(prisma, p.moduleId!)
    if (!m) continue
    await syncModuleSchema(prisma, p.id, p.moduleId!, m).catch((e) => console.error('[modules] resync failed for', p.moduleId, e))
    if (p.moduleId === 'medical-record') await migrateMedcardConditions(prisma, p.id).catch((e) => console.error('[modules] medcard migration failed', e))
  }
}

// One-off: move records from the old `chronic` + `diagnoses` collections into the
// merged `conditions` collection, then drop the old collections. Idempotent —
// once the old collections are gone it does nothing.
async function migrateMedcardConditions(prisma: PrismaClient, projectId: string): Promise<void> {
  const cols = await prisma.collection.findMany({ where: { projectId }, select: { id: true, key: true } })
  const conditions = cols.find((c) => c.key === 'conditions')
  if (!conditions) return
  for (const oldKey of ['chronic', 'diagnoses']) {
    const old = cols.find((c) => c.key === oldKey)
    if (!old) continue
    const records = await prisma.collectionRecord.findMany({ where: { collectionId: old.id } })
    for (const r of records) {
      const d = (r.data as Record<string, unknown>) ?? {}
      const data = oldKey === 'chronic'
        ? { name: d.name ?? '', status: d.status ?? 'chronic', onset: d.since ?? null, notes: d.notes ?? '' }
        : { name: d.diagnosis ?? '', status: 'active', onset: d.date ?? null, icd: d.icd ?? '', doctor: d.doctor ?? '', notes: d.notes ?? '' }
      await prisma.collectionRecord.create({ data: { collectionId: conditions.id, createdBy: r.createdBy, data: asJson(data) } })
    }
    await prisma.collection.delete({ where: { id: old.id } }) // cascades old records
    console.log(`[modules] medcard: migrated ${records.length} ${oldKey} → conditions`)
  }
}

// Remove the module-project (cascades collections/records/views). Data is deleted.
export async function uninstallModule(prisma: PrismaClient, workspaceId: string, moduleId: string): Promise<boolean> {
  const project = await prisma.project.findFirst({ where: { workspaceId, isModule: true, moduleId } })
  if (!project) return false
  await prisma.project.delete({ where: { id: project.id } })
  return true
}

// ─── Module manager ─────────────────────────────────────────────────────────

export interface InstalledModule {
  projectId: string
  /** null for a custom, code-free module the user built in the UI. */
  moduleId: string | null
  name: string
  icon: string | null
  source: 'builtin' | 'imported' | 'custom'
}

// Every module-project in a workspace — both catalog installs and custom modules
// the user created (which have no manifest and never showed up anywhere before).
// This is what the Modules manager lists.
export async function listMine(prisma: PrismaClient, workspaceId: string): Promise<InstalledModule[]> {
  const projects = await prisma.project.findMany({
    where: { workspaceId, isModule: true },
    orderBy: { position: 'asc' },
    select: { id: true, moduleId: true, name: true, icon: true },
  })
  const ids = projects.map((p) => p.moduleId).filter((x): x is string => !!x)
  const mods = ids.length
    ? await prisma.module.findMany({ where: { moduleId: { in: ids } }, select: { moduleId: true, source: true } })
    : []
  const sourceById = new Map(mods.map((m) => [m.moduleId, m.source]))
  return projects.map((p) => ({
    projectId: p.id,
    moduleId: p.moduleId,
    name: p.name,
    icon: p.icon,
    source: p.moduleId ? ((sourceById.get(p.moduleId) as 'builtin' | 'imported') ?? 'imported') : 'custom',
  }))
}

// Delete a module-project by id (custom or built-in) with its collections and
// records. Unlike uninstallModule this works for custom modules too, which have
// no moduleId to look up by.
export async function removeModuleProject(prisma: PrismaClient, workspaceId: string, projectId: string): Promise<boolean> {
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId, isModule: true }, select: { id: true } })
  if (!project) return false
  await prisma.project.delete({ where: { id: project.id } })
  return true
}
