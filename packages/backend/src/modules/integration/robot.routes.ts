import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { IntegrationService } from './integration.service.js'
import { decryptIntegrationConfig, encryptIntegrationConfig } from './secrets.js'
import { loadChannelHistory, persistChannelExchange } from './integration.routes.js'
import { generateApiKey } from '../../lib/auth.js'
import { denyIfNotMember } from '../../lib/requireAccess.js'
import { streamChat, type ChatContext, type ChatMessage } from '../ai/ai.service.js'

// Настольный робот (проект RobotOS): третий канал ассистента. Шлюз робота ходит
// сюда по своему ключу, ключ выпускается в Настройках → Интеграции и привязан
// к одному воркспейсу. В отличие от мессенджеров ответ идёт потоком, чтобы
// озвучивать его по предложениям, поэтому здесь свой маршрут вместо ChannelAdapter.

const CHAT_KEY = 'robot'

// Значения по умолчанию совпадают с константами шлюза robot_gateway.py.
export const robotSettingsSchema = z.object({
  // Слух: шлюз считает речью всё, что громче шума в noiseFactor раз
  noiseFactor: z.number().min(1.5).max(6).default(3),
  waitSpeechS: z.number().min(2).max(15).default(5),
  endSilenceS: z.number().min(0.4).max(3).default(1),
  // Разговор
  followUpS: z.number().min(0).max(30).default(7),
  stopWords: z.array(z.string().trim().min(1).max(40)).max(30)
    .default(['стоп', 'хватит', 'всё', 'все', 'пока', 'отбой', 'спасибо']),
  // Ответы
  answerLength: z.enum(['short', 'normal', 'detailed']).default('short'),
  instructions: z.string().max(1000).default(''),
  // Голос
  volume: z.number().int().min(0).max(100).default(50),
})

const settingsOf = (cfg: Record<string, unknown>) => {
  const parsed = robotSettingsSchema.safeParse(cfg.settings ?? {})
  return parsed.success ? parsed.data : robotSettingsSchema.parse({})
}

export async function robotRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const svc = new IntegrationService(prisma)

  const findIntegration = (workspaceId: string) =>
    prisma.integration.findUnique({ where: { workspaceId_type: { workspaceId, type: 'ROBOT' } } })

  // Запрос шлюза: только ключ, выпущенный для робота. Обычный API-ключ сюда не
  // подходит, иначе он получил бы настройки и историю чужого канала.
  async function resolveRobot(req: FastifyRequest, reply: FastifyReply) {
    const workspaceId = req.authWorkspaceScope?.[0]
    const integration = req.authVia === 'apikey' && workspaceId ? await findIntegration(workspaceId) : null
    const cfg = decryptIntegrationConfig(integration?.config)
    if (!integration || integration.status !== 'ACTIVE' || cfg.apiKeyId !== req.authApiKeyId) {
      reply.status(403).send({ error: 'Not a robot key' })
      return null
    }
    if (await denyIfNotMember(prisma, integration.workspaceId, req.authUser!.id, reply)) return null
    return { workspaceId: integration.workspaceId, cfg }
  }

  // ─── Настройки в приложении ─────────────────────────────────────────────────

  // GET /robot/status?workspaceId=
  app.get('/robot/status', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(req.query)
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const integration = await findIntegration(workspaceId)
    const cfg = decryptIntegrationConfig(integration?.config)
    // Ключ могли удалить на вкладке «Ключи API»: тогда робот уже не подключён.
    const key = cfg.apiKeyId
      ? await prisma.apiKey.findUnique({ where: { id: cfg.apiKeyId as string }, select: { prefix: true, lastUsedAt: true } })
      : null
    return reply.send({
      integrationId: integration?.id ?? null,
      connected: integration?.status === 'ACTIVE' && !!key,
      keyPrefix: key?.prefix ?? null,
      lastSeenAt: key?.lastUsedAt ?? null,
      defaultProjectId: (cfg.defaultProjectId as string | undefined) ?? null,
      settings: settingsOf(cfg),
      defaults: robotSettingsSchema.parse({}),
    })
  })

  // POST /robot/connect — новый ключ робота; прежний сразу перестаёт работать.
  app.post('/robot/connect', async (req, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(req.body)
    if (req.authVia === 'apikey') return reply.status(403).send({ error: 'Sign in to connect a robot' })
    if (await denyIfNotMember(prisma, workspaceId, req.authUser!.id, reply)) return

    const prev = decryptIntegrationConfig((await findIntegration(workspaceId))?.config)
    if (prev.apiKeyId) await prisma.apiKey.deleteMany({ where: { id: prev.apiKeyId as string } })

    const { raw, prefix, hash } = generateApiKey()
    const key = await prisma.apiKey.create({
      data: { userId: req.authUser!.id, name: 'Робот', keyHash: hash, prefix, scopes: [], workspaceIds: [workspaceId] },
      select: { id: true },
    })
    await svc.upsert(workspaceId, 'ROBOT', { ...prev, apiKeyId: key.id })
    // Ключ показывается один раз и нигде не хранится в открытом виде.
    return reply.status(201).send({ key: raw, workspaceId })
  })

  // PUT /robot/settings
  app.put('/robot/settings', async (req, reply) => {
    const body = z.object({
      workspaceId: z.string().min(1),
      settings: robotSettingsSchema,
      defaultProjectId: z.string().min(1).nullable().default(null),
    }).parse(req.body)
    if (req.authVia === 'apikey') return reply.status(403).send({ error: 'Sign in to change robot settings' })
    if (await denyIfNotMember(prisma, body.workspaceId, req.authUser!.id, reply)) return

    const integration = await findIntegration(body.workspaceId)
    if (!integration) return reply.status(404).send({ error: 'Robot is not connected' })
    if (body.defaultProjectId) {
      const project = await prisma.project.findFirst({ where: { id: body.defaultProjectId, workspaceId: body.workspaceId }, select: { id: true } })
      if (!project) return reply.status(400).send({ error: 'Project not found in this workspace' })
    }
    const cfg = decryptIntegrationConfig(integration.config)
    await prisma.integration.update({
      where: { id: integration.id },
      data: { config: encryptIntegrationConfig({ ...cfg, settings: body.settings, defaultProjectId: body.defaultProjectId }) as object },
    })
    return reply.send({ settings: body.settings, defaultProjectId: body.defaultProjectId })
  })

  // ─── Запросы шлюза ──────────────────────────────────────────────────────────

  // GET /robot/config — настройки, которые применяет сам шлюз (слух, голос).
  app.get('/robot/config', async (req, reply) => {
    const robot = await resolveRobot(req, reply)
    if (!robot) return
    return reply.send({ workspaceId: robot.workspaceId, settings: settingsOf(robot.cfg) })
  })

  // POST /robot/chat — фраза пользователя, ответ потоком SSE, как у /ai/chat.
  // Историю, границу воркспейса и запрет паролей задаёт сервер, а не шлюз.
  app.post('/robot/chat', async (req, reply) => {
    const { text, language } = z.object({
      text: z.string().trim().min(1).max(4000),
      language: z.enum(['ru', 'en', 'be']).default('ru'),
    }).parse(req.body)
    const robot = await resolveRobot(req, reply)
    if (!robot) return
    const { workspaceId, cfg } = robot

    const settings = settingsOf(cfg)
    const defaultProjectId = cfg.defaultProjectId as string | undefined
    const project = defaultProjectId
      ? await prisma.project.findFirst({ where: { id: defaultProjectId, workspaceId }, select: { id: true, name: true } })
      : null
    const history = await loadChannelHistory(prisma, CHAT_KEY, workspaceId, CHAT_KEY)
    const messages: ChatMessage[] = [...history, { role: 'user', content: text }]
    const context: ChatContext = {
      workspaceId,
      userId: req.authUser!.id,
      projectId: project?.id,
      projectName: project?.name,
      homeProjectId: project?.id,
      userLanguage: language,
      lockWorkspaceId: workspaceId,
      // Сказанное вслух не отозвать: canDelete: false убирает get_secret из инструментов.
      channel: { id: 'robot', canDelete: false },
      voice: { answerLength: settings.answerLength, instructions: settings.instructions },
    }

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    let answer = ''
    try {
      for await (const chunk of streamChat(messages, context, prisma)) {
        raw.write(chunk)
        try {
          const parsed = JSON.parse(chunk.replace(/^data: /, '').trim()) as { type?: string; text?: string }
          if (parsed.type === 'text' && parsed.text) answer += parsed.text
        } catch { /* ignore */ }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      raw.write(`data: ${JSON.stringify({ type: 'error', text: msg })}\n\n`)
    } finally {
      raw.end()
    }
    if (answer.trim()) await persistChannelExchange(prisma, CHAT_KEY, workspaceId, CHAT_KEY, text, answer.trim())
  })
}
