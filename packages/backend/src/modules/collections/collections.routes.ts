import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { denyIfNotMember, denyIfNoProjectAccess, getProjectWorkspaceId } from '../../lib/requireAccess.js'
import { listCatalog, listInstalled, installModule, uninstallModule, importManifest, importManifestFromUrl, getManifest, listMine, removeModuleProject } from '../../lib/modules/service.js'
import { ocrProvidersPublic } from '../../lib/modules/vision.js'
import { runMedicalScan, runReceiptScan } from '../../lib/modules/pipelines.js'
import { resolveVisionOcr } from '../../lib/visionResolve.js'
import { buildModulePdf, buildMedcardSummaryPdf } from '../../lib/modules/module-pdf.js'
import { checkPipelineAccess, incrementPipelineUsage } from '../../lib/plans.js'
import { indexRecord, recallRecords } from '../../lib/embeddings.js'
import { secretKeysOf, encodeSecrets, maskSecrets, maskRecord, revealSecret } from '../../lib/recordSecrets.js'
import { getEmbeddingsConfig } from '../ai/ai.service.js'
import { consolidateMemory } from '../../lib/cron.js'
import { publish } from '../../lib/redis.js'

// Resolve workspaceId from a collection (collection → project → workspace).
async function collectionWorkspace(prisma: PrismaClient, collectionId: string) {
  const c = await prisma.collection.findUnique({ where: { id: collectionId }, select: { project: { select: { workspaceId: true } } } })
  return c?.project.workspaceId ?? null
}

// Resolve projectId + workspaceId from a collection (for project-level access on
// shared module projects + workspace-scoped embeddings).
async function collectionProjectWs(prisma: PrismaClient, collectionId: string): Promise<{ projectId: string; workspaceId: string } | null> {
  const c = await prisma.collection.findUnique({ where: { id: collectionId }, select: { projectId: true, project: { select: { workspaceId: true } } } })
  return c ? { projectId: c.projectId, workspaceId: c.project.workspaceId } : null
}

const asJson = (v: unknown) => v as object
const i18n = z.union([z.string(), z.record(z.string(), z.string())]).transform((v) => (typeof v === 'string' ? { ru: v, en: v } : v))
const FieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.record(z.string(), z.string()),
  type: z.enum(['text', 'longtext', 'number', 'date', 'datetime', 'select', 'multiselect', 'checkbox', 'relation', 'file']),
  required: z.boolean().optional(),
  options: z.array(z.object({ value: z.string(), label: z.record(z.string(), z.string()) })).optional(),
  relation: z.object({ collection: z.string(), multiple: z.boolean().optional() }).optional(),
  unit: z.string().optional(),
  range: z.object({ lowKey: z.string(), highKey: z.string() }).optional(),
})

export async function collectionsRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // ── Module catalog ──────────────────────────────────────────────────────────

  // GET /modules/catalog — available modules (built-in + imported).
  app.get('/modules/catalog', async (_req, reply) => {
    return reply.send(await listCatalog(prisma))
  })

  // GET /modules/installed?workspaceId= — module ids installed in a workspace.
  app.get('/modules/installed', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.query)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    return reply.send(await listInstalled(prisma, workspaceId))
  })

  // POST /modules/install { workspaceId, moduleId } — scaffold into a workspace.
  app.post('/modules/install', async (req, reply) => {
    const { workspaceId, moduleId } = z.object({ workspaceId: z.string(), moduleId: z.string() }).parse(req.body)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const res = await installModule(prisma, workspaceId, moduleId, req.authUser!.id)
    if (!res.ok) return reply.status(400).send({ error: res.error })
    return reply.status(201).send(res)
  })

  // POST /modules/uninstall { workspaceId, moduleId } — remove module + its data.
  app.post('/modules/uninstall', async (req, reply) => {
    const { workspaceId, moduleId } = z.object({ workspaceId: z.string(), moduleId: z.string() }).parse(req.body)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const ok = await uninstallModule(prisma, workspaceId, moduleId)
    return reply.send({ ok })
  })

  // GET /modules/mine?workspaceId= — every module-project here (built-in installs
  // AND custom modules the user built), for the Modules manager.
  app.get('/modules/mine', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.query)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    return reply.send(await listMine(prisma, workspaceId))
  })

  // POST /modules/remove { workspaceId, projectId } — delete a module-project
  // (custom or built-in) with its data. Works for custom modules, which have no
  // moduleId and so cannot go through /modules/uninstall.
  app.post('/modules/remove', async (req, reply) => {
    const { workspaceId, projectId } = z.object({ workspaceId: z.string(), projectId: z.string() }).parse(req.body)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const ok = await removeModuleProject(prisma, workspaceId, projectId)
    return reply.send({ ok })
  })

  // POST /modules/import { manifest } — add a custom manifest to the catalog.
  // Instance OWNER/ADMIN only (shared catalog).
  app.post('/modules/import', async (req, reply) => {
    if (req.authUser?.role !== 'OWNER' && req.authUser?.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Only an instance owner/admin can import modules' })
    }
    const { manifest } = z.object({ manifest: z.unknown() }).parse(req.body)
    const res = await importManifest(prisma, manifest)
    if (!res.ok) return reply.status(400).send({ error: res.error })
    return reply.status(201).send(res)
  })

  // POST /modules/import-url { url } — fetch a manifest from a repo URL.
  app.post('/modules/import-url', async (req, reply) => {
    if (req.authUser?.role !== 'OWNER' && req.authUser?.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Only an instance owner/admin can import modules' })
    }
    const { url } = z.object({ url: z.string().url() }).parse(req.body)
    const res = await importManifestFromUrl(prisma, url)
    if (!res.ok) return reply.status(400).send({ error: res.error })
    return reply.status(201).send(res)
  })

  // POST /modules/vault/import { workspaceId, data } — import a Bitwarden JSON
  // export (unencrypted) into the Vault module: logins/cards/secure-notes →
  // logins/cards/secrets collections, with secret fields encrypted at rest.
  app.post('/modules/vault/import', async (req, reply) => {
    const { workspaceId, data } = z.object({ workspaceId: z.string(), data: z.union([z.string(), z.record(z.any())]) }).parse(req.body)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any
    try { parsed = typeof data === 'string' ? JSON.parse(data) : data } catch { return reply.status(400).send({ error: 'Не удалось разобрать JSON.' }) }
    if (parsed?.encrypted) return reply.status(400).send({ error: 'Экспорт зашифрован. В Bitwarden экспортируй как «.json» БЕЗ шифрования.' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : []
    if (!items.length) return reply.status(400).send({ error: 'В файле нет записей (ожидается Bitwarden JSON export).' })

    const proj = await prisma.project.findFirst({ where: { workspaceId, isModule: true, moduleId: 'vault' }, select: { id: true } })
    if (!proj) return reply.status(400).send({ error: 'Модуль «Сейф» не установлен — установи его и повтори.' })
    const cols = await prisma.collection.findMany({ where: { projectId: proj.id }, select: { id: true, key: true, fields: true } })
    const byKey = new Map(cols.map((c) => [c.key, c]))

    const created = { logins: 0, cards: 0, secrets: 0, skipped: 0 }
    const mk = async (col: { id: string; fields: unknown } | undefined, rec: Record<string, unknown>, key: 'logins' | 'cards' | 'secrets') => {
      if (!col) { created.skipped++; return }
      const stored = encodeSecrets(rec, secretKeysOf(col.fields))
      await prisma.collectionRecord.create({ data: { collectionId: col.id, data: stored as object, createdBy: req.authUser!.id } })
      created[key]++
    }
    for (const it of items) {
      const name = String(it?.name ?? 'Без названия')
      if (it?.type === 1 && it?.login) {
        await mk(byKey.get('logins'), { title: name, url: it.login.uris?.[0]?.uri ?? '', username: it.login.username ?? '', password: it.login.password ?? '', totp: it.login.totp ?? '', category: 'personal', notes: it.notes ?? '' }, 'logins')
      } else if (it?.type === 3 && it?.card) {
        const exp = [it.card.expMonth, it.card.expYear].filter(Boolean).join('/')
        await mk(byKey.get('cards'), { title: name, number: it.card.number ?? '', holder: it.card.cardholderName ?? '', expiry: exp, cvv: it.card.code ?? '', notes: it.notes ?? '' }, 'cards')
      } else if (it?.type === 2) {
        await mk(byKey.get('secrets'), { title: name, value: it.notes ?? '', notes: '' }, 'secrets')
      } else { created.skipped++ }
    }
    return reply.send(created)
  })

  // ── Collections (Реестры) inside a module-project ────────────────────────────

  // GET /projects/:projectId/collections — collections (with views) of a project.
  app.get('/projects/:projectId/collections', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(req.params)
    if (await denyIfNoProjectAccess(prisma, projectId, req.authUser!.id, reply)) return
    const collections = await prisma.collection.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      include: { views: { orderBy: { position: 'asc' } } },
    })
    return reply.send(collections)
  })

  // GET /collections/:collectionId/records — records of a collection.
  app.get('/collections/:collectionId/records', async (req, reply) => {
    const { collectionId } = z.object({ collectionId: z.string() }).parse(req.params)
    const cp = await collectionProjectWs(prisma, collectionId)
    if (!cp) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, cp.projectId, req.authUser!.id, reply)) return
    const records = await prisma.collectionRecord.findMany({
      where: { collectionId },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    })
    // Never ship secret ciphertext/plaintext in bulk — only which keys are set.
    return reply.send(records.map(maskRecord))
  })

  // GET /records/:recordId/secret/:fieldKey — reveal ONE decrypted secret value.
  // Explicit, per-field; the only path that returns a plaintext secret.
  app.get('/records/:recordId/secret/:fieldKey', async (req, reply) => {
    const { recordId, fieldKey } = z.object({ recordId: z.string(), fieldKey: z.string() }).parse(req.params)
    const rec = await prisma.collectionRecord.findUnique({ where: { id: recordId }, select: { collectionId: true, data: true } })
    if (!rec) return reply.status(404).send({ error: 'Not found' })
    const cp = await collectionProjectWs(prisma, rec.collectionId)
    if (!cp) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, cp.projectId, req.authUser!.id, reply)) return
    const col = await prisma.collection.findUnique({ where: { id: rec.collectionId }, select: { fields: true } })
    if (!secretKeysOf(col?.fields).includes(fieldKey)) return reply.status(400).send({ error: 'Not a secret field' })
    return reply.send({ value: revealSecret(rec.data, fieldKey) ?? '' })
  })

  // POST /collections/:collectionId/records { data } — create a record.
  app.post('/collections/:collectionId/records', async (req, reply) => {
    const { collectionId } = z.object({ collectionId: z.string() }).parse(req.params)
    const { data } = z.object({ data: z.record(z.string(), z.unknown()).default({}) }).parse(req.body ?? {})
    const cp = await collectionProjectWs(prisma, collectionId)
    if (!cp) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, cp.projectId, req.authUser!.id, reply, { write: true })) return
    const wsId = cp.workspaceId
    const secretKeys = secretKeysOf((await prisma.collection.findUnique({ where: { id: collectionId }, select: { fields: true } }))?.fields)
    const stored = secretKeys.length ? encodeSecrets(data, secretKeys) : data
    const rec = await prisma.collectionRecord.create({
      data: { collectionId, data: stored as object, createdBy: req.authUser!.id },
    })
    void getEmbeddingsConfig(wsId, prisma).then((cfg) => cfg && indexRecord(prisma, rec, wsId, cfg)).catch(() => {})
    publish({ type: 'record.created', workspaceId: wsId, projectId: cp.projectId, collectionId, recordId: rec.id }).catch(() => {})
    return reply.status(201).send(maskRecord(rec))
  })

  // PATCH /records/:recordId { data } — replace a record's data.
  app.patch('/records/:recordId', async (req, reply) => {
    const { recordId } = z.object({ recordId: z.string() }).parse(req.params)
    const { data } = z.object({ data: z.record(z.string(), z.unknown()) }).parse(req.body)
    const rec = await prisma.collectionRecord.findUnique({ where: { id: recordId }, select: { collectionId: true, data: true } })
    if (!rec) return reply.status(404).send({ error: 'Not found' })
    const cp = await collectionProjectWs(prisma, rec.collectionId)
    if (!cp) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, cp.projectId, req.authUser!.id, reply, { write: true })) return
    const wsId = cp.workspaceId
    const secretKeys = secretKeysOf((await prisma.collection.findUnique({ where: { id: rec.collectionId }, select: { fields: true } }))?.fields)
    const stored = secretKeys.length ? encodeSecrets(data, secretKeys, rec.data as Record<string, unknown>) : data
    const updated = await prisma.collectionRecord.update({ where: { id: recordId }, data: { data: stored as object } })
    void getEmbeddingsConfig(wsId, prisma).then((cfg) => cfg && indexRecord(prisma, updated, wsId, cfg)).catch(() => {})
    return reply.send(maskRecord(updated))
  })

  // DELETE /records/:recordId — delete a record.
  app.delete('/records/:recordId', async (req, reply) => {
    const { recordId } = z.object({ recordId: z.string() }).parse(req.params)
    const rec = await prisma.collectionRecord.findUnique({ where: { id: recordId }, select: { collectionId: true } })
    if (!rec) return reply.status(404).send({ error: 'Not found' })
    const cp = await collectionProjectWs(prisma, rec.collectionId)
    if (!cp) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, cp.projectId, req.authUser!.id, reply, { write: true })) return
    await prisma.collectionRecord.delete({ where: { id: recordId } })
    return reply.status(204).send()
  })

  // POST /collections/:collectionId/records/batch { items: [data] } — bulk create.
  app.post('/collections/:collectionId/records/batch', async (req, reply) => {
    const { collectionId } = z.object({ collectionId: z.string() }).parse(req.params)
    const { items } = z.object({ items: z.array(z.record(z.string(), z.unknown())).min(1).max(200) }).parse(req.body ?? {})
    const cp = await collectionProjectWs(prisma, collectionId)
    if (!cp) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNoProjectAccess(prisma, cp.projectId, req.authUser!.id, reply, { write: true })) return
    const wsId = cp.workspaceId
    const secretKeys = secretKeysOf((await prisma.collection.findUnique({ where: { id: collectionId }, select: { fields: true } }))?.fields)
    const created: Awaited<ReturnType<typeof prisma.collectionRecord.create>>[] = []
    for (const data of items) {
      const stored = secretKeys.length ? encodeSecrets(data, secretKeys) : data
      created.push(await prisma.collectionRecord.create({ data: { collectionId, data: stored as object, createdBy: req.authUser!.id } }))
    }
    void getEmbeddingsConfig(wsId, prisma).then((cfg) => cfg && Promise.all(created.map((r) => indexRecord(prisma, r, wsId, cfg)))).catch(() => {})
    return reply.status(201).send({ created: created.length, records: created.map(maskRecord) })
  })

  // POST /records/batch-delete { ids: [] } — bulk delete (membership-checked).
  app.post('/records/batch-delete', async (req, reply) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(req.body ?? {})
    const recs = await prisma.collectionRecord.findMany({ where: { id: { in: ids } }, select: { id: true, collectionId: true } })
    if (!recs.length) return reply.send({ deleted: 0 })
    const colIds = [...new Set(recs.map((r) => r.collectionId))]
    const cols = await prisma.collection.findMany({ where: { id: { in: colIds } }, select: { projectId: true } })
    const projIds = [...new Set(cols.map((c) => c.projectId))]
    for (const pid of projIds) if (await denyIfNoProjectAccess(prisma, pid, req.authUser!.id, reply, { write: true })) return
    await prisma.collectionRecord.deleteMany({ where: { id: { in: recs.map((r) => r.id) } } })
    return reply.send({ deleted: recs.length })
  })

  // POST /collections/consolidate { workspaceId } — run memory consolidation now
  // (episodes → facts/entities). Returns per-workspace result incl. skip reason
  // (e.g. "AI provider error") so the agent sees WHY nothing happened.
  app.post('/collections/consolidate', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.body ?? {})
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const results = await consolidateMemory(prisma, { workspaceId, force: true })
    return reply.send({ results })
  })

  // POST /collections/recall — semantic recall over records (Phase 2 memory).
  // Ranks records of the given collections (or all in the workspace) by cosine
  // similarity to the query. Backfills missing embeddings on the fly. Returns
  // { semantic:false } when embeddings are not configured so callers can fall back.
  app.post('/collections/recall', async (req, reply) => {
    const body = z.object({
      workspaceId: z.string(),
      query: z.string().min(1),
      collectionIds: z.array(z.string()).optional(),
      limit: z.number().min(1).max(50).default(10),
      since: z.string().optional(),  // ISO date — only records created on/after
      until: z.string().optional(),  // ISO date — only records created on/before
    }).parse(req.body)
    if (await denyIfNotMember(prisma, body.workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    const cfg = await getEmbeddingsConfig(body.workspaceId, prisma)
    if (!cfg) return reply.send({ semantic: false, results: [] })
    const results = await recallRecords(prisma, cfg, body)
    return reply.send({ semantic: true, results })
  })

  // ── Module pipelines (OCR etc.) ──────────────────────────────────────────────

  // GET /modules/ocr-providers — curated vision providers + models for the UI.
  app.get('/modules/ocr-providers', async (_req, reply) => reply.send(ocrProvidersPublic()))

  // GET /projects/:projectId/module-info — moduleId + first-party pipelines.
  app.get('/projects/:projectId/module-info', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(req.params)
    const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true, moduleId: true } })
    if (!proj) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, proj.workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    let pipelines: unknown[] = []
    if (proj.moduleId) { const m = await getManifest(prisma, proj.moduleId); pipelines = m?.ai?.pipelines ?? [] }
    return reply.send({ moduleId: proj.moduleId, pipelines })
  })

  // GET /projects/:projectId/overview — cross-collection dashboard for a module:
  // a chronological timeline + highlights (active conditions / medications).
  app.get('/projects/:projectId/overview', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(req.params)
    const wsId = await getProjectWorkspaceId(prisma, projectId)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply, { allowViewer: true })) return

    const collections = await prisma.collection.findMany({ where: { projectId }, orderBy: { position: 'asc' } })
    type F = { key: string; type: string; label?: Record<string, string> }
    const out = {
      collections: [] as unknown[], timeline: [] as unknown[], conditions: [] as unknown[], medications: [] as unknown[],
      accounts: [] as unknown[], spendByCategory: [] as unknown[], cashflow: null as { income: number; expense: number } | null,
      budget: null as { plannedIncome: number; plannedExpense: number; includedIncome: number; includedExpense: number } | null,
      planVsActual: [] as unknown[],
    }

    for (const c of collections) {
      const fields = (c.fields as F[]) ?? []
      const records = await prisma.collectionRecord.findMany({ where: { collectionId: c.id }, orderBy: { createdAt: 'desc' }, take: 200 })
      out.collections.push({ id: c.id, key: c.key, name: c.name, icon: c.icon, count: records.length })

      const dateField = fields.find((f) => f.type === 'date' || f.type === 'datetime')?.key
      const titleField = fields.find((f) => f.type === 'text' || f.type === 'longtext')?.key
      const title = (r: typeof records[number]) => {
        const d = r.data as Record<string, unknown>
        if (titleField && d[titleField]) return String(d[titleField])
        // Fall back to the first meaningful scalar, never a date/secret/file —
        // otherwise a record with no text field (e.g. a transfer with no
        // merchant) showed a raw ISO timestamp as its title.
        const f = fields.find((f) => f.key !== dateField
          && !['date', 'datetime', 'secret', 'file'].includes(f.type)
          && d[f.key] != null && d[f.key] !== '')
        return f ? String(d[f.key]) : ''
      }
      for (const r of records) {
        const d = r.data as Record<string, unknown>
        const date = dateField ? (d[dateField] ? String(d[dateField]).slice(0, 10) : null) : null
        if (!date) continue
        out.timeline.push({ date, collectionId: c.id, collectionKey: c.key, collectionName: c.name, recordId: r.id, title: title(r) })
      }
      // Highlights by well-known keys.
      if (c.key === 'conditions') {
        for (const r of records) {
          const d = r.data as Record<string, unknown>
          if (d.status === 'active' || d.status === 'chronic') out.conditions.push({ id: r.id, name: d.name ?? '', status: d.status })
        }
      }
      if (c.key === 'medications') {
        for (const r of records) {
          const d = r.data as Record<string, unknown>
          if (d.status === 'active' || !d.status) out.medications.push({ id: r.id, name: d.name ?? '', dose: d.dose ?? '' })
        }
      }
    }
    out.timeline.sort((a, b) => String((b as { date: string }).date).localeCompare(String((a as { date: string }).date)))
    out.timeline = (out.timeline as { date: string }[]).slice(0, 50)

    // Finance module: compute account balances, current-month cashflow and
    // spend-by-category (the engine itself does no arithmetic).
    const acctCol = collections.find((c) => c.key === 'accounts')
    const txCol = collections.find((c) => c.key === 'transactions')
    if (acctCol && txCol) {
      const accts = await prisma.collectionRecord.findMany({ where: { collectionId: acctCol.id } })
      const txs = await prisma.collectionRecord.findMany({ where: { collectionId: txCol.id } })
      const bal = new Map<string, number>()
      const meta = new Map<string, { name: string; currency: string }>()
      for (const a of accts) {
        const d = a.data as Record<string, unknown>
        bal.set(a.id, Number(d.startBalance) || 0)
        meta.set(a.id, { name: String(d.name ?? ''), currency: String(d.currency ?? '') })
      }
      const ym = new Date().toISOString().slice(0, 7)
      const spend = new Map<string, number>()
      let income = 0, expense = 0
      for (const t of txs) {
        const d = t.data as Record<string, unknown>
        const amt = Number(d.amount) || 0
        const type = String(d.type ?? '')
        const acc = typeof d.account === 'string' ? d.account : null
        const to = typeof d.toAccount === 'string' ? d.toAccount : null
        if (type === 'expense' && acc) bal.set(acc, (bal.get(acc) ?? 0) - amt)
        else if (type === 'income' && acc) bal.set(acc, (bal.get(acc) ?? 0) + amt)
        else if (type === 'transfer') {
          // Cross-currency exchange credits toAmount (destination currency); empty = same-currency.
          const toAmt = Number((d as Record<string, unknown>).toAmount) || amt
          if (acc) bal.set(acc, (bal.get(acc) ?? 0) - amt)
          if (to) bal.set(to, (bal.get(to) ?? 0) + toAmt)
        }
        if (d.date && String(d.date).slice(0, 7) === ym) {
          if (type === 'expense') { expense += amt; const cat = String(d.category ?? 'other'); spend.set(cat, (spend.get(cat) ?? 0) + amt) }
          else if (type === 'income') income += amt
        }
      }
      const r2 = (n: number) => Math.round(n * 100) / 100
      out.accounts = [...meta.entries()].map(([id, m]) => ({ id, name: m.name, currency: m.currency, balance: r2(bal.get(id) ?? 0) }))
      out.spendByCategory = [...spend.entries()].map(([category, total]) => ({ category, total: r2(total) })).sort((a, b) => b.total - a.total)
      out.cashflow = { income: r2(income), expense: r2(expense) }

      // Budget: this-month plan totals + per-category plan-vs-actual.
      const budgetCol = collections.find((c) => c.key === 'budget')
      if (budgetCol) {
        const items = await prisma.collectionRecord.findMany({ where: { collectionId: budgetCol.id } })
        let plannedIncome = 0, plannedExpense = 0, includedIncome = 0, includedExpense = 0
        const plannedByCat = new Map<string, number>()
        for (const b of items) {
          const d = b.data as Record<string, unknown>
          if (!d.month || String(d.month).slice(0, 7) !== ym) continue
          const amt = Number(d.amount) || 0
          const inc = !!d.include
          if (d.type === 'income') { plannedIncome += amt; if (inc) includedIncome += amt }
          else { plannedExpense += amt; if (inc) includedExpense += amt; const cat = String(d.category ?? 'other'); plannedByCat.set(cat, (plannedByCat.get(cat) ?? 0) + amt) }
        }
        out.budget = { plannedIncome: r2(plannedIncome), plannedExpense: r2(plannedExpense), includedIncome: r2(includedIncome), includedExpense: r2(includedExpense) }
        const cats = new Set([...plannedByCat.keys(), ...spend.keys()])
        out.planVsActual = [...cats].map((category) => ({ category, planned: r2(plannedByCat.get(category) ?? 0), actual: r2(spend.get(category) ?? 0) }))
          .sort((a, b) => (b.planned + b.actual) - (a.planned + a.actual))
      }
    }
    return reply.send(out)
  })

  // GET /projects/:projectId/pipeline-access — can this workspace run premium pipelines?
  app.get('/projects/:projectId/pipeline-access', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(req.params)
    const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true, moduleId: true } })
    if (!proj) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, proj.workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    return reply.send(await checkPipelineAccess(prisma, proj.workspaceId, proj.moduleId))
  })

  // GET /projects/:projectId/export/pdf — printable PDF of the whole module.
  app.get('/projects/:projectId/export/pdf', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(req.params)
    const { lang } = z.object({ lang: z.string().optional() }).parse(req.query)
    const wsId = await getProjectWorkspaceId(prisma, projectId)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply, { allowViewer: true })) return
    const pdf = await buildModulePdf(prisma, projectId, lang ?? 'ru')
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', 'attachment; filename="card.pdf"')
    return reply.send(pdf)
  })

  // GET /projects/:projectId/export/summary — curated clinical summary (Медкарта).
  app.get('/projects/:projectId/export/summary', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(req.params)
    const { lang, period } = z.object({ lang: z.string().optional(), period: z.coerce.number().optional() }).parse(req.query)
    const wsId = await getProjectWorkspaceId(prisma, projectId)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply, { allowViewer: true })) return
    const pdf = await buildMedcardSummaryPdf(prisma, projectId, lang ?? 'ru', period && period > 0 ? period : 12)
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', 'attachment; filename="summary.pdf"')
    return reply.send(pdf)
  })

  // POST /projects/:projectId/finance/budget-rollover — copy the latest month's
  // budget plan into the following month (idempotent: skips if it already exists).
  app.post('/projects/:projectId/finance/budget-rollover', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(req.params)
    const wsId = await getProjectWorkspaceId(prisma, projectId)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    const col = await prisma.collection.findFirst({ where: { projectId, key: 'budget' }, select: { id: true } })
    if (!col) return reply.status(404).send({ error: 'no_budget' })
    const items = await prisma.collectionRecord.findMany({ where: { collectionId: col.id } })
    const monthOf = (r: { data: unknown }) => { const d = (r.data as Record<string, unknown>).month; const s = typeof d === 'string' ? d.slice(0, 7) : ''; return /^\d{4}-\d{2}$/.test(s) ? s : '' }
    const months = [...new Set(items.map(monthOf).filter(Boolean))].sort()
    if (months.length === 0) return reply.send({ created: 0, month: null })
    const latest = months[months.length - 1]
    const [y, m] = latest.split('-').map(Number)
    const targetYM = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7) // m is 1-based ⇒ next month
    if (months.includes(targetYM)) return reply.send({ created: 0, month: targetYM })
    let created = 0
    for (const r of items.filter((x) => monthOf(x) === latest)) {
      const d = r.data as Record<string, unknown>
      await prisma.collectionRecord.create({ data: { collectionId: col.id, createdBy: req.authUser!.id, data: { month: `${targetYM}-01`, type: d.type, category: d.category, amount: d.amount, include: d.include ?? false, note: d.note ?? '' } as object } })
      created++
    }
    return reply.send({ created, month: targetYM })
  })

  // GET /projects/:projectId/ocr-config — can this project recognise documents?
  // Recognition is configured per user (Settings → AI) or per instance (admin),
  // never here any more; the module screen only needs to know whether it works.
  app.get('/projects/:projectId/ocr-config', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(req.params)
    const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } })
    if (!proj) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, proj.workspaceId, req.authUser!.id, reply, { allowViewer: true })) return
    const ocr = await resolveVisionOcr(prisma, proj.workspaceId, req.authUser!.id, 'check')
    return reply.send({ available: !!ocr })
  })

  // POST /projects/:projectId/pipeline/:pipelineId — run a module's premium
  // recognition pipeline on an uploaded photo/PDF. Dispatches by pipelineId
  // (medical-scan → Medical Record, receipt-scan → Finance). Multipart.
  app.post('/projects/:projectId/pipeline/:pipelineId', async (req, reply) => {
    const { projectId, pipelineId } = z.object({ projectId: z.string(), pipelineId: z.string() }).parse(req.params)
    if (pipelineId !== 'medical-scan' && pipelineId !== 'receipt-scan') return reply.status(404).send({ error: 'unknown_pipeline' })
    const data = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } })
    if (!data) return reply.status(400).send({ error: 'No file provided' })
    const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true, settings: true, moduleId: true } })
    if (!proj) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, proj.workspaceId, req.authUser!.id, reply)) return
    const ocr = await resolveVisionOcr(prisma, proj.workspaceId, req.authUser!.id, 'web')
    if (!ocr) return reply.status(400).send({ error: 'ocr_not_configured' })
    // Tier-2 gating: Pro/Team (or instance owner) unlimited; free plan gets a few trials PER MODULE.
    const access = await checkPipelineAccess(prisma, proj.workspaceId, proj.moduleId)
    if (!access.ok) return reply.status(402).send({ error: 'premium_required', plan: access.plan })
    const chunks: Buffer[] = []
    for await (const c of data.file) chunks.push(c)
    const buffer = Buffer.concat(chunks)
    const fileArg = { buffer, mime: data.mimetype, filename: data.filename || 'document' }
    try {
      const result = pipelineId === 'receipt-scan'
        ? await runReceiptScan(prisma, proj.workspaceId, projectId, ocr, fileArg, req.authUser!.id)
        : await runMedicalScan(prisma, proj.workspaceId, projectId, ocr, fileArg, req.authUser!.id)
      if (!access.premium && result.kind !== 'none') await incrementPipelineUsage(prisma, proj.workspaceId, proj.moduleId)
      return reply.send(result)
    } catch (e) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : 'OCR failed' })
    }
  })

  // ── Module builder (no-JSON): custom modules + schema editing ────────────────

  // POST /modules/custom { workspaceId, name } — create a blank custom module.
  app.post('/modules/custom', async (req, reply) => {
    const { workspaceId, name } = z.object({ workspaceId: z.string(), name: z.string().min(1) }).parse(req.body)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return
    const last = await prisma.project.findFirst({ where: { workspaceId }, orderBy: { position: 'desc' }, select: { position: true } })
    const project = await prisma.project.create({
      data: { workspaceId, name, icon: 'lucide:Boxes', isModule: true, position: (last?.position ?? -1) + 1 },
    })
    return reply.status(201).send({ projectId: project.id })
  })

  // POST /projects/:projectId/collections — add a collection (+ default views).
  app.post('/projects/:projectId/collections', async (req, reply) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(req.params)
    const body = z.object({ key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), name: i18n, icon: z.string().optional(), fields: z.array(FieldSchema).optional() }).parse(req.body)
    const wsId = await getProjectWorkspaceId(prisma, projectId)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    const last = await prisma.collection.findFirst({ where: { projectId }, orderBy: { position: 'desc' }, select: { position: true } })
    const exists = await prisma.collection.findUnique({ where: { projectId_key: { projectId, key: body.key } } })
    if (exists) return reply.status(409).send({ error: 'Collection key already exists' })
    const col = await prisma.collection.create({
      data: { projectId, key: body.key, name: asJson(body.name), icon: body.icon ?? 'lucide:Table2', fields: asJson(body.fields ?? []), position: (last?.position ?? -1) + 1 },
    })
    await prisma.collectionView.create({ data: { collectionId: col.id, key: 'all', type: 'table', name: asJson({ ru: 'Все', en: 'All', be: 'Усе' }), config: asJson({}), position: 0 } })
    await prisma.collectionView.create({ data: { collectionId: col.id, key: 'card', type: 'form', name: asJson({ ru: 'Карточка', en: 'Card', be: 'Картка' }), config: asJson({}), position: 1 } })
    return reply.status(201).send(col)
  })

  // PATCH /collections/:collectionId — rename / edit fields / icon.
  app.patch('/collections/:collectionId', async (req, reply) => {
    const { collectionId } = z.object({ collectionId: z.string() }).parse(req.params)
    const body = z.object({ name: i18n.optional(), icon: z.string().optional(), fields: z.array(FieldSchema).optional() }).parse(req.body)
    const wsId = await collectionWorkspace(prisma, collectionId)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    const data: Record<string, unknown> = {}
    if (body.name !== undefined) data.name = asJson(body.name)
    if (body.icon !== undefined) data.icon = body.icon
    if (body.fields !== undefined) data.fields = asJson(body.fields)
    const col = await prisma.collection.update({ where: { id: collectionId }, data })
    return reply.send(col)
  })

  // DELETE /collections/:collectionId — remove a collection (and its records).
  app.delete('/collections/:collectionId', async (req, reply) => {
    const { collectionId } = z.object({ collectionId: z.string() }).parse(req.params)
    const wsId = await collectionWorkspace(prisma, collectionId)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    await prisma.collection.delete({ where: { id: collectionId } })
    return reply.status(204).send()
  })

  // POST /collections/:collectionId/views — add a view.
  app.post('/collections/:collectionId/views', async (req, reply) => {
    const { collectionId } = z.object({ collectionId: z.string() }).parse(req.params)
    const body = z.object({ key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), type: z.enum(['table', 'form', 'chart', 'board', 'calendar', 'gallery']), name: i18n, config: z.record(z.string(), z.unknown()).optional() }).parse(req.body)
    const wsId = await collectionWorkspace(prisma, collectionId)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    const last = await prisma.collectionView.findFirst({ where: { collectionId }, orderBy: { position: 'desc' }, select: { position: true } })
    const exists = await prisma.collectionView.findUnique({ where: { collectionId_key: { collectionId, key: body.key } } })
    if (exists) return reply.status(409).send({ error: 'View key already exists' })
    const view = await prisma.collectionView.create({
      data: { collectionId, key: body.key, type: body.type, name: asJson(body.name), config: asJson(body.config ?? {}), position: (last?.position ?? -1) + 1 },
    })
    return reply.status(201).send(view)
  })

  // DELETE /views/:viewId — remove a view.
  app.delete('/views/:viewId', async (req, reply) => {
    const { viewId } = z.object({ viewId: z.string() }).parse(req.params)
    const v = await prisma.collectionView.findUnique({ where: { id: viewId }, select: { collectionId: true } })
    if (!v) return reply.status(404).send({ error: 'Not found' })
    const wsId = await collectionWorkspace(prisma, v.collectionId)
    if (!wsId) return reply.status(404).send({ error: 'Not found' })
    if (await denyIfNotMember(prisma, wsId, req.authUser!.id, reply)) return
    await prisma.collectionView.delete({ where: { id: viewId } })
    return reply.status(204).send()
  })
}
