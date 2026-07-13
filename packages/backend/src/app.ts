import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import jwtPlugin from '@fastify/jwt'
import { PrismaClient } from '@prisma/client'
import { config } from './config/index.js'
import { errorHandler } from './middleware/errorHandler.js'
import { createAuthMiddleware } from './middleware/authenticate.js'
import { isFrozen, primeFrozenCache } from './lib/frozen.js'
import { primeBillingMode, isBillingEnabled } from './lib/billingMode.js'
import { isSoloEdition } from './lib/edition.js'
import { primeManaged } from './lib/managed.js'
import { primePricing } from './lib/pricing.js'
import { writeAuditLog } from './lib/audit.js'
import { setupMeiliIndexes, meili } from './lib/meilisearch.js'
import { SearchService } from './modules/search/search.service.js'
import { connectRedis, redis } from './lib/redis.js'
import { setupStorage } from './lib/storage.js'
import { workspaceRoutes } from './modules/workspace/workspace.routes.js'
import { projectRoutes } from './modules/project/project.routes.js'
import { pageRoutes } from './modules/page/page.routes.js'
import { taskRoutes } from './modules/task/task.routes.js'
import { boardRoutes } from './modules/board/board.routes.js'
import { searchRoutes } from './modules/search/search.routes.js'
import { graphRoutes } from './modules/graph/graph.routes.js'
import { calendarRoutes } from './modules/calendar/calendar.routes.js'
import { budgetRoutes } from './modules/budget/budget.routes.js'
import { noteRoutes } from './modules/note/note.routes.js'
import { realtimeRoutes } from './modules/realtime/realtime.routes.js'
import { uploadRoutes } from './modules/upload/upload.routes.js'
import { integrationRoutes } from './modules/integration/integration.routes.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { exportRoutes } from './modules/export/export.routes.js'
import { pageVersionRoutes } from './modules/page/page-version.routes.js'
import { templateRoutes } from './modules/template/template.routes.js'
import { backupRoutes } from './modules/backup/backup.routes.js'
import { aiRoutes } from './modules/ai/ai.routes.js'
import { aiSettingsRoutes } from './modules/ai/ai-settings.routes.js'
import { aiTemplateRoutes } from './modules/ai/ai-templates.routes.js'
import { notificationRoutes } from './modules/notification/notification.routes.js'
import { tagRoutes } from './modules/tag/tag.routes.js'
import { commentRoutes } from './modules/comment/comment.routes.js'
import { customFieldRoutes } from './modules/task/custom-field.routes.js'
import { timeRoutes } from './modules/task/time.routes.js'
import { habitRoutes } from './modules/habit/habit.routes.js'
import { journalRoutes } from './modules/journal/journal.routes.js'
import { okrRoutes } from './modules/okr/okr.routes.js'
import { automationRoutes } from './modules/task/automation.routes.js'
import { activityRoutes } from './modules/activity/activity.routes.js'
import { adminRoutes } from './modules/admin/admin.routes.js'
import { canvasRoutes } from './modules/canvas/canvas.routes.js'
import { importRoutes } from './modules/import/import.routes.js'
import { auditRoutes } from './modules/audit/audit.routes.js'
import { billingRoutes } from './modules/billing/billing.routes.js'
import { adminBackupRoutes } from './modules/admin/admin-backup.routes.js'
import { startCronJobs } from './lib/cron.js'
import { startTriggerDispatcher } from './lib/triggers.js'
import { startMonitoring } from './lib/monitoring.js'
import { syncBuiltinModules, resyncInstalledModules } from './lib/modules/service.js'
import { collectionsRoutes } from './modules/collections/collections.routes.js'

const prisma = new PrismaClient({
  log: config.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
})

const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'development' ? 'debug' : 'info',
    ...(config.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    }),
  },
  trustProxy: true,
})

async function bootstrap() {
  // ── Security ──────────────────────────────────────────────
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true })
  await app.register(rateLimit, {
    timeWindow: '1 minute',
    // Bucket per API key (each agent/integration gets its own allowance) instead
    // of per source IP — otherwise all MCP traffic shares one IP bucket and a
    // single agent's batch/recall burst can 429 everyone. API keys get a higher
    // ceiling since recall scans many records per logical call.
    keyGenerator: (req) => {
      const apiKey = req.headers['x-api-key'] as string | undefined
      return apiKey ? `k:${apiKey}` : (req.ip ?? 'anon')
    },
    max: (req) => ((req.headers['x-api-key'] as string | undefined) ? 2000 : 300),
  })

  // ── WebSocket + multipart + JWT ───────────────────────────
  await app.register(websocket)
  await app.register(multipart)
  await app.register(jwtPlugin, { secret: config.JWT_SECRET })

  // ── Swagger / OpenAPI ────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Sinout API',
        description: 'Self-hosted knowledge base with AI management via MCP',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${config.PORT}` }],
    },
  })
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list' },
  })

  // ── Error handler ────────────────────────────────────────
  app.setErrorHandler(errorHandler)

  // ── Health check ─────────────────────────────────────────
  app.get('/health', async (_req, reply) => {
    const checks = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`,
      meili.health(),
      redis.ping(),
    ])
    const [dbResult, meiliResult, redisResult] = checks
    const dbStatus = dbResult.status === 'fulfilled' ? 'ok' : 'error'
    const meiliStatus = meiliResult.status === 'fulfilled' ? 'ok' : 'error'
    const redisStatus = redisResult.status === 'fulfilled' ? 'ok' : 'error'

    return reply.send({
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: { database: dbStatus, meilisearch: meiliStatus, redis: redisStatus },
    })
  })

  // ── WebSocket real-time ───────────────────────────────────
  app.register((instance, _opts, done) => { realtimeRoutes(instance, prisma).then(() => done()).catch(done) })

  // ── API routes ────────────────────────────────────────────
  app.register(
    async (api) => {
      const authenticate = createAuthMiddleware(prisma)

      // Routes that do NOT require authentication
      const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
        'POST /auth/register',
        'POST /auth/login',
        'POST /auth/2fa/verify-login',
        'GET /auth/verify-email',
        'POST /auth/resend-verification',
        'POST /auth/forgot-password',
        'POST /auth/reset-password',
        // Billing — checkout creation is public; IPN webhook verifies HMAC instead of JWT.
        'POST /billing/invoice',
        'POST /billing/webhook',
        // Public instance flags read before login (cloud vs self-hosted): gates the
        // mobile app shell + PWA install, which are our-cloud-only.
        'GET /config',
      ])

      const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
      // The ways out of a freeze must never be frozen themselves.
      const FROZEN_ALLOWED = ['/billing/', '/wallet', '/auth/logout', '/auth/me', '/export/']

      // Global auth guard — runs before every /api/v1 handler
      api.addHook('preHandler', async (req, reply) => {
        const routeKey = `${req.method} ${(req.routeOptions.url ?? '').replace('/api/v1', '')}`
        // Public auth routes
        if (PUBLIC_ROUTES.has(routeKey)) return
        // Public page share route
        if (req.method === 'GET' && (req.routeOptions.url ?? '').startsWith('/api/v1/share/')) return
        // AI-generated images are served by unguessable UUID filename and are
        // loaded via <img src> (which can't send auth headers) — serve publicly.
        if (req.method === 'GET' && (req.routeOptions.url ?? '').startsWith('/api/v1/ai/image/')) return
        // Inbound integration webhooks (Slack/Telegram/Discord) are called by
        // external services with no JWT — scoped by workspaceId + an ACTIVE
        // integration record. Must be public or the auth guard 401s them.
        if (req.method === 'POST' && (req.routeOptions.url ?? '').startsWith('/api/v1/webhooks/')) return
        await authenticate(req, reply)
        if (reply.sent) return

        // ── Frozen account: reads yes, writes no ────────────────────────────
        // An unpaid cloud account keeps its data readable, searchable and
        // exportable. Only mutations are refused, and the two ways out —
        // topping up and logging out — stay open. Losing a person's notes over
        // $5 buys a refund request and a bad review, not a payment.
        if (req.authUser && WRITE_METHODS.has(req.method) && await isFrozen(req.authUser.id)) {
          const url = (req.routeOptions.url ?? '').replace('/api/v1', '')
          // An admin frozen by his own unpaid bill must still reach the admin
          // panel — that is where balances are credited. Lock him out of it and
          // the instance has no way back.
          const isOperator = req.authUser.role === 'OWNER' || req.authUser.role === 'ADMIN'
          const allowed = FROZEN_ALLOWED.some((p) => url.startsWith(p)) || (isOperator && url.startsWith('/admin/'))
          if (!allowed) {
            return reply.status(402).send({
              error: 'account_frozen',
              message: 'Аккаунт заморожен: пополните баланс. Данные на месте, чтение и экспорт работают.',
            })
          }
        }
      })

      // AI-action audit — log mutations made by programmatic (MCP/API-key)
      // callers so workspace admins can see exactly what Claude wrote.
      const AI_AUDITED_RESOURCES = new Set([
        'pages', 'notes', 'tasks', 'projects', 'canvas', 'workspaces',
      ])
      api.addHook('onResponse', async (req, reply) => {
        if (req.authVia !== 'apikey' || !req.authUser) return
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return
        if (reply.statusCode >= 400) return

        const url = (req.routeOptions.url ?? '').replace('/api/v1/', '')
        const resourceType = url.split('/')[0]
        if (!AI_AUDITED_RESOURCES.has(resourceType)) return

        const verb = req.method === 'POST' ? 'created'
          : req.method === 'DELETE' ? 'deleted' : 'updated'
        const params = (req.params ?? {}) as Record<string, string>
        const body = (req.body ?? {}) as Record<string, unknown>
        const query = (req.query ?? {}) as Record<string, string>
        const workspaceId =
          params.workspaceId ?? (body.workspaceId as string) ?? query.workspaceId ?? null
        const resourceId = params.id ?? params[`${resourceType.slice(0, -1)}Id`] ?? null

        await writeAuditLog(prisma, {
          workspaceId,
          userId: req.authUser.id,
          userEmail: req.authUser.email,
          action: 'ai.write',
          resourceType,
          resourceId,
          meta: {
            source: 'mcp',
            via: req.authApiKeyName ?? 'API key',
            verb,
            method: req.method,
            path: url,
          },
          ip: req.ip,
        })
      })

      // Public instance config (no auth): what the client needs BEFORE login to
      // decide cloud-only behaviour (mobile shell, PWA install).
      api.get('/config', async (_req, reply) => reply.send({ cloud: isBillingEnabled(), solo: isSoloEdition() }))

      // Auth routes (public: login/register; protected: me/api-keys)
      api.register((r) => authRoutes(r, prisma))

      // All other routes
      api.register((r) => workspaceRoutes(r, prisma), { prefix: '/workspaces' })
      api.register((r) => projectRoutes(r, prisma))
      api.register((r) => pageRoutes(r, prisma))
      api.register((r) => pageVersionRoutes(r, prisma))
      api.register((r) => taskRoutes(r, prisma))
      api.register((r) => boardRoutes(r, prisma))
      api.register((r) => searchRoutes(r, prisma))
      api.register((r) => graphRoutes(r, prisma))
      api.register((r) => calendarRoutes(r, prisma))
      api.register((r) => budgetRoutes(r, prisma))
      api.register((r) => noteRoutes(r, prisma))
      api.register((r) => uploadRoutes(r, prisma))
      api.register((r) => integrationRoutes(r, prisma))
      api.register((r) => exportRoutes(r, prisma))
      api.register((r) => templateRoutes(r, prisma))
      api.register((r) => backupRoutes(r, prisma))
      api.register((r) => aiRoutes(r, prisma))
      api.register((r) => aiSettingsRoutes(r, prisma))
      api.register((r) => aiTemplateRoutes(r, prisma))
      api.register((r) => notificationRoutes(r, prisma))
      api.register((r) => tagRoutes(r, prisma))
      api.register((r) => commentRoutes(r, prisma))
      api.register((r) => customFieldRoutes(r, prisma))
      api.register((r) => timeRoutes(r, prisma))
      api.register((r) => habitRoutes(r, prisma))
      api.register((r) => journalRoutes(r, prisma))
      api.register((r) => okrRoutes(r, prisma))
      api.register((r) => automationRoutes(r, prisma))
      api.register((r) => activityRoutes(r, prisma))
      api.register((r) => adminRoutes(r, prisma))
      api.register((r) => canvasRoutes(r, prisma))
      api.register((r) => collectionsRoutes(r, prisma))
      api.register((r) => importRoutes(r, prisma))
      api.register((r) => auditRoutes(r, prisma))
      api.register((r) => billingRoutes(r, prisma))
      api.register((r) => adminBackupRoutes(r, prisma))
    },
    { prefix: '/api/v1' },
  )

  // ── Graceful shutdown ─────────────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down...`)
    await app.close()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // Keep the server alive if a stray async error escapes (e.g. during a long AI
  // generation). Without these, Node kills the whole process on any unhandled
  // rejection/exception — one bad request would take down everyone. Log the
  // full stack so the real cause is visible instead of a silent restart.
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'UNHANDLED REJECTION — process kept alive')
  })
  process.on('uncaughtException', (err) => {
    app.log.error({ err }, 'UNCAUGHT EXCEPTION — process kept alive')
  })

  // ── Start ─────────────────────────────────────────────────
  try {
    // Meilisearch индексы + авто-переиндексация при старте
    setupMeiliIndexes()
      .then(() => new SearchService(prisma).reindexAll())
      .then((counts) => app.log.info({ indexed: counts }, 'Meilisearch reindex complete'))
      .catch((e) => app.log.warn({ err: e }, 'Meilisearch setup failed — search may be unavailable'))

    // Redis (не блокируем если недоступен)
    connectRedis().catch((e) =>
      app.log.warn({ err: e }, 'Redis connection failed — real-time features unavailable'),
    )

    // Cron jobs for recurring tasks/events/budget
    // Both caches must be warm before the first quota check: the billing switch
    // decides whether anyone has a limit at all, and a Redis flush must not
    // silently unfreeze everyone.
    void primeBillingMode(prisma)
    void primeManaged(prisma)
    void primePricing(prisma)
    void primeFrozenCache(prisma).then((n) => n && console.log(`[billing] ${n} frozen account(s)`))

    startCronJobs(prisma)

    // Event-trigger dispatcher (agent 'trigger' skills react to workspace events)
    startTriggerDispatcher(prisma)

    // Background sampler for the admin monitoring dashboard
    startMonitoring(prisma)

    // Sync built-in modules into the catalog, then re-sync installed instances
    // so manifest updates (languages, views, fields) propagate automatically.
    syncBuiltinModules(prisma)
      .then(() => resyncInstalledModules(prisma))
      .catch((e) => console.error('[modules] sync error:', e))

    // MinIO bucket setup (не блокируем если недоступен)
    setupStorage().catch((e) =>
      app.log.warn({ err: e }, 'MinIO setup failed — file uploads unavailable'),
    )

    await app.listen({ port: config.PORT, host: config.HOST })
    app.log.info(`Server listening on http://${config.HOST}:${config.PORT}`)
    app.log.info(`Swagger UI: http://localhost:${config.PORT}/docs`)
  } catch (err) {
    app.log.error(err)
    await prisma.$disconnect()
    process.exit(1)
  }
}

bootstrap()
