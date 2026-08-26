import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { randomUUID, createHash } from 'node:crypto'
import { redis } from '../../lib/redis.js'
import { completeManaged } from '../ai/ai.service.js'
import { createAuthMiddleware } from '../../middleware/authenticate.js'
import { hashPassword } from '../../lib/auth.js'
import { sendVerificationEmail, isEmailConfigured } from '../../lib/email.js'
import { DEFAULT_LIMITS, getAllUsersStorage } from '../../lib/plans.js'
import { provisionPersonalWorkspace } from '../../lib/personal.js'
import { getMetrics, getHistory, getActiveAlerts, invalidateThresholds } from '../../lib/monitoring.js'
import { getOnline } from '../../lib/presence.js'
import { writeAuditLog } from '../../lib/audit.js'
import { issueLicenseKey } from '../../lib/license.js'
import { config } from '../../config/index.js'
import { fromMicroUsd, toMicroUsd, isPriced, marginPercent, setPricingOverrides,
  activePricingSlots, upsertModelPrice, DEFAULT_MARGIN_PERCENT } from '../../lib/pricing.js'
import { resolveOpenRouterPrice, fetchOpenRouterModelList } from '../../lib/openrouterPricing.js'
import type { ModelPrice } from '../../lib/pricing.js'
import { adjust } from '../../lib/wallet.js'
import { setBillingMode, isBillingEnabled } from '../../lib/billingMode.js'
import { managedForAdmin, saveManaged, MANAGED_SLOTS } from '../../lib/managed.js'
import { listCatalogModels, IMAGE_TOKENS_PER_PICTURE } from '../../lib/modelCatalog.js'

async function requireOwnerOrAdmin(req: Parameters<ReturnType<typeof createAuthMiddleware>>[0], reply: Parameters<ReturnType<typeof createAuthMiddleware>>[1]) {
  const role = req.authUser?.role
  if (role !== 'OWNER' && role !== 'ADMIN') {
    return reply.status(403).send({ error: 'Admin access required' })
  }
}

export async function adminRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const authenticate = createAuthMiddleware(prisma)

  // ── App Settings ────────────────────────────────────────────────────────

  // GET /admin/settings
  app.get('/admin/settings', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (_req, reply) => {
    // `billingEffective` is what the code actually does; `billingEnabled` may be
    // null, meaning «whatever DEPLOYMENT_MODE says».
    let settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
    if (!settings) {
      settings = await prisma.appSettings.create({
        data: { id: 'singleton', registrationMode: 'invite', inviteCode: null },
      })
    }
    return reply.send({ ...settings, billingEffective: isBillingEnabled() })
  })

  // PATCH /admin/settings
  app.patch('/admin/settings', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const body = z.object({
      registrationMode: z.enum(['open', 'invite', 'closed']).optional(),
      inviteCode: z.string().nullable().optional(),
      smtpHost: z.string().nullable().optional(),
      smtpPort: z.number().nullable().optional(),
      smtpUser: z.string().nullable().optional(),
      smtpPass: z.string().nullable().optional(),
      smtpFrom: z.string().nullable().optional(),
      appUrl: z.string().nullable().optional(),
      planLimits: z.record(z.any()).optional(),
      // null = follow DEPLOYMENT_MODE; true/false decides it here instead.
      billingEnabled: z.boolean().nullable().optional(),
    }).parse(req.body)

    const settings = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...body },
      update: body,
    })
    await writeAuditLog(prisma, { action: 'admin.settings_changed', userId: req.authUser!.id, userEmail: req.authUser!.email, ip: req.ip })
    // The switch lives in memory on the hot path — update it, not just the row.
    if (body.billingEnabled !== undefined) setBillingMode(body.billingEnabled)

    return reply.send(settings)
  })

  // POST /admin/test-email — отправить тестовое письмо
  app.post('/admin/test-email', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const { email } = req.body as { email?: string }
    if (!email) return reply.status(400).send({ error: 'email required' })

    if (!await isEmailConfigured(prisma)) {
      return reply.status(503).send({ error: 'SMTP not configured' })
    }

    try {
      await sendVerificationEmail(email, 'test-token-preview', prisma)
      return reply.send({ ok: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Send failed'
      return reply.status(500).send({ error: msg })
    }
  })

  // ── Users ───────────────────────────────────────────────────────────────

  // GET /admin/users
  app.get('/admin/users', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (_req, reply) => {
    const [users, storage] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true, email: true, name: true, role: true,
          isActive: true, isVerified: true, lastLoginAt: true, createdAt: true,
          plan: true, licenseExpiresAt: true, storageLimitMb: true, capabilities: true,
          balanceMicroUsd: true,
          _count: { select: { workspaceMemberships: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      getAllUsersStorage(prisma),
    ])
    return reply.send(users.map(({ _count, ...u }) => {
      const s = storage.get(u.id)
      return {
        ...u,
        workspaceCount: _count.workspaceMemberships,
        storageUsedBytes: s?.usedBytes ?? 0,
        storageEffectiveLimitMb: s?.limitMb ?? -1, // -1 = unlimited
      }
    }))
  })

  // POST /admin/users
  app.post('/admin/users', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const body = z.object({
      email: z.string().email(),
      name: z.string().min(1),
      password: z.string().min(8),
      role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).default('MEMBER'),
    }).parse(req.body)

    // Only OWNER can create OWNER/ADMIN
    if (body.role !== 'MEMBER' && req.authUser?.role !== 'OWNER') {
      return reply.status(403).send({ error: 'Only OWNER can create admins' })
    }

    const exists = await prisma.user.findUnique({ where: { email: body.email } })
    if (exists) return reply.status(409).send({ error: 'Email already in use' })

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        role: body.role,
        // Admin-created accounts are trusted — no email verification step,
        // otherwise they could never log in (no verification email is sent).
        isVerified: true,
      },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    })
    // Every account gets its Personal workspace up front — no manual create step.
    await provisionPersonalWorkspace(prisma, user.id)
    await writeAuditLog(prisma, { action: 'admin.user_created', userId: req.authUser!.id, userEmail: req.authUser!.email, resourceType: 'user', resourceId: user.id, resourceName: user.email, ip: req.ip })
    return reply.status(201).send(user)
  })

  // PATCH /admin/users/:id
  app.patch('/admin/users/:id', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).optional(),
      isActive: z.boolean().optional(),
      isVerified: z.boolean().optional(),
      name: z.string().min(1).optional(),
      password: z.string().min(8).optional(),
      plan: z.enum(['free', 'team']).optional(),
      licenseExpiresAt: z.string().datetime().nullable().optional(),
      storageLimitMb: z.coerce.number().int().min(0).nullable().optional(), // null = use plan limit
      capabilities: z.object({ grant: z.array(z.string()).optional(), revoke: z.array(z.string()).optional() }).nullable().optional(),
    }).parse(req.body)

    // Only OWNER can change roles or promote to OWNER
    if (body.role && req.authUser?.role !== 'OWNER') {
      return reply.status(403).send({ error: 'Only OWNER can change roles' })
    }
    // Cannot demote yourself
    if (id === req.authUser?.id && body.role && body.role !== req.authUser.role) {
      return reply.status(400).send({ error: 'Cannot change your own role' })
    }

    const data: Record<string, unknown> = {}
    if (body.role !== undefined) data.role = body.role
    if (body.isActive !== undefined) data.isActive = body.isActive
    if (body.isVerified !== undefined) data.isVerified = body.isVerified
    if (body.name !== undefined) data.name = body.name
    if (body.password !== undefined) data.passwordHash = await hashPassword(body.password)
    if (body.plan !== undefined) data.plan = body.plan
    if (body.licenseExpiresAt !== undefined) data.licenseExpiresAt = body.licenseExpiresAt ? new Date(body.licenseExpiresAt) : null
    if (body.storageLimitMb !== undefined) data.storageLimitMb = body.storageLimitMb
    if (body.capabilities !== undefined) data.capabilities = body.capabilities

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, isActive: true, isVerified: true, plan: true, licenseExpiresAt: true, storageLimitMb: true, capabilities: true },
    })
    return reply.send(user)
  })

  // POST /admin/users/:id/wallet — hand-correct a balance (both directions).
  // Every correction is audited: money moved by a human must be attributable.
  app.post('/admin/users/:id/wallet', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      amountUsd: z.number().min(-1000).max(1000).refine((v) => v !== 0, 'amount must not be zero'),
      note: z.string().max(200).optional(),
    }).parse(req.body)

    const target = await prisma.user.findUnique({ where: { id }, select: { email: true } })
    if (!target) return reply.status(404).send({ error: 'Not found' })

    const note = body.note?.trim() || `admin ${req.authUser!.email}`
    const balance = await adjust(prisma, id, toMicroUsd(body.amountUsd), note)
    if (balance === null) return reply.status(400).send({ error: 'adjust failed' })

    await writeAuditLog(prisma, {
      action: 'admin.wallet_adjusted',
      userId: req.authUser!.id, userEmail: req.authUser!.email,
      resourceType: 'user', resourceId: id, resourceName: target.email,
      meta: { amountUsd: body.amountUsd, note }, ip: req.ip,
    })

    return reply.send({ balanceUsd: fromMicroUsd(balance) })
  })

  // DELETE /admin/users/:id
  app.delete('/admin/users/:id', { preHandler: [authenticate] }, async (req, reply) => {
    if (req.authUser?.role !== 'OWNER') {
      return reply.status(403).send({ error: 'Only OWNER can delete users' })
    }
    const { id } = req.params as { id: string }
    if (id === req.authUser.id) {
      return reply.status(400).send({ error: 'Cannot delete yourself' })
    }
    await writeAuditLog(prisma, { action: 'admin.user_deleted', userId: req.authUser!.id, userEmail: req.authUser!.email, resourceType: 'user', resourceId: id, ip: req.ip })
    await prisma.user.delete({ where: { id } })
    return reply.status(204).send()
  })

  // ── Projects ────────────────────────────────────────────────────────────

  // GET /admin/projects
  app.get('/admin/projects', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (_req, reply) => {
    const projects = await prisma.project.findMany({
      select: {
        id: true, name: true, status: true, createdAt: true,
        workspace: { select: { id: true, name: true } },
        _count: { select: { tasks: true, pages: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send(projects)
  })

  // DELETE /admin/projects/:id
  app.delete('/admin/projects/:id', { preHandler: [authenticate] }, async (req, reply) => {
    if (req.authUser?.role !== 'OWNER') {
      return reply.status(403).send({ error: 'Only OWNER can delete projects' })
    }
    const { id } = req.params as { id: string }
    await prisma.project.delete({ where: { id } })
    return reply.status(204).send()
  })

  // ── Stats ───────────────────────────────────────────────────────────────

  // GET /admin/stats
  app.get('/admin/stats', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (_req, reply) => {
    const [users, projects, tasks, pages] = await Promise.all([
      prisma.user.count(),
      prisma.project.count(),
      prisma.task.count(),
      prisma.page.count(),
    ])
    return reply.send({
      users, projects, tasks, pages,
      version: config.APP_VERSION,
      builtAt: config.APP_BUILT_AT ?? null,
    })
  })

  // ── Prices ───────────────────────────────────────────────────────────
  // Provider prices move; a deploy should not be the way to follow them.
  // What is stored are OVERRIDES: the code's defaults fill every gap, so an
  // empty table behaves exactly like no table.
  app.get('/admin/pricing', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (_req, reply) => {
    const slots = activePricingSlots()

    // Fill in whatever is missing, here and now: a model switched to in the slots
    // above must arrive priced, without anyone opening a price table. Only models
    // with no price yet are looked up, so this is normally a no-op.
    for (const s of slots) {
      if (!s.model) continue

      if (s.slot === 'image') {
        // Image models are billed per picture here, but a provider like
        // OpenRouter prices them per output token. Report that price and turn it
        // into a per-picture figure the admin can accept in one click — the
        // token count per picture is a vendor convention, so it is offered as a
        // suggestion rather than charged behind his back.
        if (s.perImage !== null) continue
        const cat = await listCatalogModels().catch(() => [])
        const m = cat.find((x) => x.id === s.model)
        if (m?.imageOutputPer1M) {
          s.imageOutputPer1M = m.imageOutputPer1M
          s.suggestedPerImage = (m.imageOutputPer1M * IMAGE_TOKENS_PER_PICTURE) / 1_000_000
        }
        continue
      }

      if (s.price) continue
      const resolved = await resolveOpenRouterPrice(s.model).catch(() => null)
      if (!resolved || 'ambiguous' in resolved) continue
      await upsertModelPrice(prisma, s.model, resolved.price).catch(() => null)
      s.price = resolved.price
    }

    return reply.send({ marginPercent: marginPercent(), slots, defaultMarginPercent: DEFAULT_MARGIN_PERCENT })
  })

  // GET /admin/pricing/openrouter/list — every model OpenRouter serves, for the
  // "add a model" picker: choose an id from the real catalog instead of typing
  // one that may not exist (a typo here is a silent, permanently-unpriced model).
  app.get('/admin/pricing/openrouter/list', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (_req, reply) => {
    try {
      return reply.send({ models: await fetchOpenRouterModelList() })
    } catch (e) {
      return reply.status(502).send({ error: (e as Error).message })
    }
  })

  // GET /admin/pricing/openrouter?model=<id> — pull today's real price for one
  // model from OpenRouter's public catalog, so the admin doesn't have to hand-
  // type it (and doesn't have to remember to, when a provider reprices). Works
  // for our own bare shipped ids too (e.g. "deepseek-v4-pro") via a suffix
  // fallback in resolveOpenRouterPrice — see there for why.
  app.get('/admin/pricing/openrouter', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const q = z.object({ model: z.string().min(1) }).parse(req.query)
    let result
    try {
      result = await resolveOpenRouterPrice(q.model)
    } catch (e) {
      return reply.status(502).send({ error: (e as Error).message })
    }
    if (!result) return reply.status(404).send({ error: `Модель "${q.model}" не найдена в каталоге OpenRouter` })
    if ('ambiguous' in result) {
      return reply.status(409).send({
        error: `Несколько моделей на OpenRouter подходят под "${q.model}": ${result.ambiguous.join(', ')}. Добавьте нужную по полному id через поле ниже.`,
      })
    }
    return reply.send({ price: result.price, resolvedId: result.resolvedId })
  })

  app.patch('/admin/pricing', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    // The table is no longer edited by hand — the margin is the one number that
    // is a business decision rather than a fact about a provider. A single model
    // price stays writable for the case automation cannot cover: a provider with
    // no public catalogue, where the alternative is billing those tokens at zero.
    const body = z.object({
      marginPercent: z.number().min(0).max(1000).optional(),
      model: z.object({
        id: z.string().min(1).max(200),
        input: z.number().min(0).max(1000),
        cachedInput: z.number().min(0).max(1000),
        output: z.number().min(0).max(1000),
      }).optional(),
      // Image models are billed per picture, a separate table. An image model
      // reached through OpenRouter has no per-picture price anywhere to read.
      image: z.object({
        id: z.string().min(1).max(200),
        perImage: z.number().min(0).max(100),
      }).optional(),
    }).parse(req.body)

    const existing = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { pricing: true } })
    const current = (existing?.pricing ?? {}) as { marginPercent?: number; models?: Record<string, ModelPrice>; images?: Record<string, number> }
    const next = {
      ...current,
      ...(body.marginPercent !== undefined ? { marginPercent: body.marginPercent } : {}),
      ...(body.model ? { models: { ...current.models, [body.model.id]: { input: body.model.input, cachedInput: body.model.cachedInput, output: body.model.output } } } : {}),
      ...(body.image ? { images: { ...current.images, [body.image.id]: body.image.perImage } } : {}),
    }

    const row = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', pricing: next as object },
      update: { pricing: next as object },
      select: { pricing: true },
    })

    // The table lives in memory on the hot path — update it, not just the row.
    setPricingOverrides(row.pricing as never)

    await writeAuditLog(prisma, {
      action: 'admin.pricing_updated',
      userId: req.authUser!.id, userEmail: req.authUser!.email,
      meta: { marginPercent: body.marginPercent, model: body.model?.id ?? body.image?.id },
      ip: req.ip,
    })

    return reply.send({ marginPercent: marginPercent(), slots: activePricingSlots(), defaultMarginPercent: DEFAULT_MARGIN_PERCENT })
  })

  // ── Managed provider keys ────────────────────────────────────────────
  // The keys the INSTANCE pays with. Stored encrypted, cached in memory, and
  // never returned: the response says whether a key exists, not what it is.
  app.get('/admin/managed', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (_req, reply) => {
    return reply.send(managedForAdmin())
  })

  app.patch('/admin/managed', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    // An empty string clears a key (that is how the built-in model is turned
    // off); an absent field leaves it untouched, so saving a model name cannot
    // wipe the key the form never showed.
    const slot = z.object({
      provider: z.string().max(64).optional(),
      apiKey: z.string().max(400).optional(),
      model: z.string().max(200).optional(),
      baseUrl: z.string().max(400).optional(),
    })
    // Built from MANAGED_SLOTS, not typed out by hand: zod silently DROPS unknown
    // keys, so a forgotten slot does not error — it just never saves, which is
    // the most expensive kind of quiet. (That is exactly how `vision` was lost.)
    // `satisfies` is the guard: omit a slot and this stops compiling. Zod
    // silently DROPS unknown keys, so a forgotten slot would not error — it
    // would just never save. That is exactly how `vision` was lost.
    const shape = {
      ai: slot.optional(),
      image: slot.optional(),
      vision: slot.optional(),
      embeddings: slot.optional(),
    } satisfies Record<typeof MANAGED_SLOTS[number], unknown>

    const body = z.object(shape).parse(req.body)

    await saveManaged(prisma, body)

    // Close the exact gap that just bit Luna: a model picked here but never
    // priced (or priced under a slightly different id) silently bills at $0.
    // Only token-priced slots apply — images are priced per picture, a
    // different table — and only when the provider is openrouter, the one
    // source with a live catalog to resolve against; other providers still
    // need a manual price in the Pricing tab, same as before.
    //
    // Fire-and-forget, NOT awaited: saving a provider key is a critical action
    // that must always complete fast — it must never sit blocked behind a
    // third-party HTTP call. This found that out the hard way: awaited here,
    // one slow/hung fetch to OpenRouter froze the Save button for every admin.
    const TOKEN_SLOTS = ['ai', 'vision', 'embeddings'] as const
    for (const key of TOKEN_SLOTS) {
      const s = body[key]
      if (!s || s.provider !== 'openrouter' || !s.model) continue
      void resolveOpenRouterPrice(s.model)
        .then((resolved) => resolved && !('ambiguous' in resolved) ? upsertModelPrice(prisma, s.model!, resolved.price) : null)
        .catch((e) => console.error('[pricing] auto-sync failed', s.model, e))
    }

    await writeAuditLog(prisma, {
      action: 'admin.managed_keys_updated',
      userId: req.authUser!.id, userEmail: req.authUser!.email,
      // Which slots were touched, never what was written into them.
      meta: { slots: Object.keys(body) }, ip: req.ip,
    })

    return reply.send(managedForAdmin())
  })

  // GET /admin/models — the live model catalogue (price + capabilities) joined
  // with the operator's own ratings, so one screen answers «what should we run».
  app.get('/admin/models', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const refresh = (req.query as { refresh?: string }).refresh === '1'
    try {
      const [models, row] = await Promise.all([
        listCatalogModels(refresh),
        prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { modelRatings: true } }),
      ])
      return reply.send({ models, ratings: (row?.modelRatings ?? {}) as Record<string, unknown> })
    } catch (e) {
      return reply.status(502).send({ error: e instanceof Error ? e.message : 'Каталог моделей недоступен' })
    }
  })

  // POST /admin/models/describe — the model's description in the reader's own
  // language. Providers write them in English only, so anything but English gets
  // a translation, cached: the text changes about as often as the model itself.
  app.post('/admin/models/describe', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const body = z.object({
      modelId: z.string().min(1).max(200),
      lang: z.enum(['ru', 'be', 'en']),
    }).parse(req.body)

    const models = await listCatalogModels().catch(() => [])
    const model = models.find((m) => m.id === body.modelId)
    if (!model) return reply.status(404).send({ error: 'Модель не найдена в каталоге' })
    // English needs no round trip — it is what the provider already wrote.
    if (body.lang === 'en' || !model.description.trim()) {
      return reply.send({ text: model.description, translated: false })
    }

    // Keyed by the text, not just the model: a reworded description must not
    // keep serving the translation of the old one.
    const key = `model:desc:${body.lang}:${createHash('sha1').update(body.modelId + model.description).digest('hex')}`
    const cached = await redis.get(key).catch(() => null)
    if (cached) return reply.send({ text: cached, translated: true })

    const target = body.lang === 'be' ? 'белорусский' : 'русский'
    try {
      const text = (await completeManaged(
        `Ты переводишь описания AI-моделей на ${target} язык. Верни ТОЛЬКО перевод, без пояснений и кавычек. `
        + 'Названия моделей, компаний и технические термины (tokens, context, API) оставляй как есть. Сохраняй абзацы.',
        model.description,
      )).trim()
      if (!text) return reply.send({ text: model.description, translated: false })
      await redis.set(key, text, 'EX', 30 * 86400).catch(() => null)
      return reply.send({ text, translated: true })
    } catch {
      // No managed key, or the provider refused — show the original rather than
      // an error: an English description beats an empty dialog.
      return reply.send({ text: model.description, translated: false })
    }
  })

  // PATCH /admin/models/rating — the operator's verdict on one model. Stars of 0
  // forget it entirely, so a rating given by mistake leaves no trace behind.
  app.patch('/admin/models/rating', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const body = z.object({
      modelId: z.string().min(1).max(200),
      stars: z.number().int().min(0).max(5),
      note: z.string().max(500).optional(),
    }).parse(req.body)

    const row = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { modelRatings: true } })
    const ratings = { ...((row?.modelRatings ?? {}) as Record<string, unknown>) }
    if (body.stars === 0) delete ratings[body.modelId]
    else ratings[body.modelId] = { stars: body.stars, note: body.note || undefined, ratedAt: new Date().toISOString() }

    await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', modelRatings: ratings as object },
      update: { modelRatings: ratings as object },
    })
    return reply.send({ ratings })
  })

  // GET /admin/usage — what the AI actually costs, per user, last 30 days.
  // `cost` is the provider's price of those tokens whoever paid it; `charged`
  // is what WE would take (cost x margin), and it is zero for BYOK answers.
  // Seeing both is the only way to pick a margin without guessing.
  app.get('/admin/usage', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const days = Math.min(Math.max(Number((req.query as { days?: string }).days ?? 30), 1), 365)
    const since = new Date(Date.now() - days * 86_400_000)

    // Split by `managed`: a BYOK answer's cost was paid by the USER to his
    // provider, not by us. Folding it into "our cost" makes the total exceed
    // what we charge — which is exactly the confusion it caused. Our cost is
    // the managed rows only; BYOK cost is reported separately, as reference.
    const rows = await prisma.aiUsage.groupBy({
      by: ['userId', 'managed'],
      where: { createdAt: { gte: since } },
      _sum: {
        inputTokens: true, cachedInputTokens: true, outputTokens: true,
        calls: true, costMicroUsd: true, chargedMicroUsd: true,
      },
      _count: { _all: true },
    })

    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))] } },
      select: { id: true, email: true, name: true },
    })
    const userMap = new Map(users.map((u) => [u.id, u]))

    // Fold the two managed/BYOK rows of each user into one line.
    type Acc = {
      userId: string | null; answers: number; calls: number
      inputTokens: number; cachedInputTokens: number; outputTokens: number
      costUsd: number; byokCostUsd: number; chargedUsd: number
    }
    const acc = new Map<string, Acc>()
    for (const r of rows) {
      const key = r.userId ?? '∅'
      const a = acc.get(key) ?? {
        userId: r.userId, answers: 0, calls: 0,
        inputTokens: 0, cachedInputTokens: 0, outputTokens: 0,
        costUsd: 0, byokCostUsd: 0, chargedUsd: 0,
      }
      a.answers += r._count._all
      a.calls += r._sum.calls ?? 0
      a.inputTokens += r._sum.inputTokens ?? 0
      a.cachedInputTokens += r._sum.cachedInputTokens ?? 0
      a.outputTokens += r._sum.outputTokens ?? 0
      const cost = fromMicroUsd(r._sum.costMicroUsd ?? 0)
      if (r.managed) a.costUsd += cost           // our real spend
      else a.byokCostUsd += cost                 // user's own key, reference only
      a.chargedUsd += fromMicroUsd(r._sum.chargedMicroUsd ?? 0)
      acc.set(key, a)
    }

    const byUser = [...acc.values()].map((a) => {
      const u = a.userId ? userMap.get(a.userId) : undefined
      return { ...a, email: u?.email ?? null, name: u?.name ?? null }
    }).sort((x, y) => (y.costUsd + y.byokCostUsd) - (x.costUsd + x.byokCostUsd))

    // Models seen in the window, so an unpriced one is visible rather than
    // silently contributing $0 to every total.
    const models = await prisma.aiUsage.groupBy({
      by: ['provider', 'model'],
      where: { createdAt: { gte: since } },
      _sum: { costMicroUsd: true },
      _count: { _all: true },
    })

    return reply.send({
      days,
      marginPercent: marginPercent(),
      totals: {
        answers: byUser.reduce((n, u) => n + u.answers, 0),
        // Our spend on the managed key. BYOK is a separate line, not folded in.
        costUsd: byUser.reduce((n, u) => n + u.costUsd, 0),
        byokCostUsd: byUser.reduce((n, u) => n + u.byokCostUsd, 0),
        chargedUsd: byUser.reduce((n, u) => n + u.chargedUsd, 0),
      },
      byUser,
      models: models.map((m) => ({
        provider: m.provider,
        model: m.model,
        answers: m._count._all,
        costUsd: fromMicroUsd(m._sum.costMicroUsd ?? 0),
        priced: isPriced(m.model),
      })),
    })
  })

  // GET /admin/monitoring — live server/app load + history + online + alerts.
  app.get('/admin/monitoring', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (_req, reply) => {
    const online = getOnline().map((s) => ({
      id: s.id, name: s.name, email: s.email, role: s.role, via: s.via,
      lastSeen: new Date(s.lastSeen).toISOString(),
    }))
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
    return reply.send({
      metrics: getMetrics(),
      history: getHistory(),
      online,
      onlineCount: online.length,
      alerts: getActiveAlerts(),
      thresholds: {
        cpu: settings?.alertCpuPct ?? null,
        mem: settings?.alertMemPct ?? null,
        disk: settings?.alertDiskPct ?? null,
      },
      now: new Date().toISOString(),
    })
  })

  // PATCH /admin/monitoring/alerts — set alert thresholds (percent; null = off).
  app.patch('/admin/monitoring/alerts', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const body = z.object({
      cpu: z.coerce.number().int().min(0).max(100).nullable().optional(),
      mem: z.coerce.number().int().min(0).max(100).nullable().optional(),
      disk: z.coerce.number().int().min(0).max(100).nullable().optional(),
    }).parse(req.body)
    const data: Record<string, unknown> = {}
    if (body.cpu !== undefined) data.alertCpuPct = body.cpu
    if (body.mem !== undefined) data.alertMemPct = body.mem
    if (body.disk !== undefined) data.alertDiskPct = body.disk
    await prisma.appSettings.upsert({ where: { id: 'singleton' }, update: data, create: { id: 'singleton', ...data } })
    invalidateThresholds()
    return reply.send({ ok: true })
  })

  // GET /admin/audit-log — global audit across ALL workspaces (admin-only).
  app.get('/admin/audit-log', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const { limit = 50, cursor, action } = z.object({
      limit: z.coerce.number().min(1).max(200).default(50),
      cursor: z.string().optional(),
      action: z.string().optional(),
    }).parse(req.query)

    const where: Record<string, unknown> = {}
    if (action) where.action = action
    if (cursor) where.createdAt = { lt: new Date(cursor) }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: { workspace: { select: { name: true } } },
    })
    const hasMore = logs.length > limit
    const items = (hasMore ? logs.slice(0, limit) : logs).map((l) => ({
      ...l,
      workspaceName: l.workspace?.name ?? null,
      createdAt: l.createdAt.toISOString(),
    }))
    const nextCursor = hasMore ? items[items.length - 1].createdAt : null
    return reply.send({ items, nextCursor, hasMore })
  })

  // ── License Keys ─────────────────────────────────────────────────────────

  // GET /admin/license-keys
  app.get('/admin/license-keys', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (_req, reply) => {
    const keys = await prisma.licenseKey.findMany({ orderBy: { createdAt: 'desc' } })
    return reply.send(keys)
  })

  // POST /admin/license-keys — generate key(s)
  app.post('/admin/license-keys', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const body = z.object({
      plan: z.enum(['team']),
      email: z.string().email().optional(),
      note: z.string().optional(),
      expiresAt: z.string().optional(),
      count: z.number().int().min(1).max(100).default(1),
    }).parse(req.body)

    // Pro and Team are both annual licenses — default to a 1-year expiry if
    // none is given.
    const expiresAt = body.expiresAt
      ? new Date(body.expiresAt)
      : (body.plan === 'team')
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      : null

    const keys = await Promise.all(
      Array.from({ length: body.count }).map(() =>
        issueLicenseKey(prisma, {
          plan: body.plan,
          email: body.email ?? null,
          note: body.note ?? null,
          expiresAt,
        }),
      ),
    )
    return reply.status(201).send(keys)
  })

  // DELETE /admin/license-keys/:id
  app.delete('/admin/license-keys/:id', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await prisma.licenseKey.delete({ where: { id } })
    return reply.status(204).send()
  })

  // PATCH /admin/license-keys/:id — deactivate/reactivate
  app.patch('/admin/license-keys/:id', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { isActive } = req.body as { isActive: boolean }
    const key = await prisma.licenseKey.update({ where: { id }, data: { isActive } })
    return reply.send(key)
  })

  // GET /admin/plan-limits
  app.get('/admin/plan-limits', { preHandler: [authenticate, requireOwnerOrAdmin] }, async (_req, reply) => {
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
    const stored = settings?.planLimits as Record<string, unknown> | null
    return reply.send(stored && Object.keys(stored).length > 0 ? stored : DEFAULT_LIMITS)
  })
}
