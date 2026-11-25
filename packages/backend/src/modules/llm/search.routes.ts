// ─── Web search for SinoutX Code ──────────────────────────────────────────────
// `POST /api/v1/search/web` — the same search the assistant's `web_search` tool
// runs (provider key → SearXNG → DuckDuckGo), for an agent that runs on the
// user's computer and has no search of its own. Nothing is saved: no sources,
// no history. Free for the key owner, but rate-limited per key — a looping agent
// must not burn the instance's paid search key.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { webSearch, getAISettings } from '../ai/ai.service.js'

const bodySchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(20).default(8),
})

const fail = (reply: FastifyReply, status: number, message: string) => reply.status(status).send({ error: { message } })

/** The workspace whose search region applies: the key's own, else the owner's first. */
async function workspaceOf(prisma: PrismaClient, req: FastifyRequest): Promise<string | null> {
  const scoped = req.authWorkspaceScope?.[0]
  if (scoped) return scoped
  const m = await prisma.workspaceMember.findFirst({
    where: { userId: req.authUser!.id }, orderBy: { createdAt: 'asc' }, select: { workspaceId: true },
  })
  return m?.workspaceId ?? null
}

export async function webSearchRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post('/search/web', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        // Thrown through the app's error handler, which answers
        // `{ statusCode, error, message }` — the message is what clients read.
        errorResponseBuilder: (_req: FastifyRequest, ctx: { after: string }) => Object.assign(
          new Error(`Слишком много поисковых запросов: не больше 30 в минуту. Повторите через ${ctx.after}.`),
          { statusCode: 429, name: 'RateLimited' },
        ),
      },
    },
  }, async (req, reply) => {
    if (req.authVia !== 'apikey') return fail(reply, 401, 'Нужен ключ API SinoutX (sk_sinoutx_…) в Authorization: Bearer или x-api-key.')

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) return fail(reply, 400, `Неверный запрос: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
    const { query, limit } = parsed.data

    // The region the owner set for the assistant's search applies here too.
    const ws = await workspaceOf(prisma, req)
    const settings = ws ? await getAISettings(ws, prisma).catch(() => null) : null

    const out = await webSearch(query, limit, { searchRegion: settings?.searchRegion, userId: req.authUser!.id, workspaceId: ws ?? undefined }, prisma)
    if (out.error || out.searchUnavailable) {
      return fail(reply, 503, out.error ?? 'Поиск на сервере сейчас недоступен: ни один поисковый движок не ответил.')
    }
    const results = (out.results ?? [])
      .filter((r) => r.url || r.snippet)
      .slice(0, limit)
      .map((r) => ({ title: String(r.title ?? ''), url: String(r.url ?? ''), snippet: String(r.snippet ?? '') }))
    return reply.send({ results })
  })
}
