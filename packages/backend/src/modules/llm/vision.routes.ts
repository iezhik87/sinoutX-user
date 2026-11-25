// ─── Image recognition for SinoutX Code ───────────────────────────────────────
// `POST /api/v1/vision/describe`: the agent's own model (the `code` slot) may be
// blind, so a picture goes through the same recognition chain the chat uses —
// the user's own key, then a key left on a module, then the instance's shared
// `vision` slot billed to the user. Nothing is saved: no file, no history.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { resolveVisionOcr } from '../../lib/visionResolve.js'
import { runExtraction } from '../../lib/modules/vision.js'
import { getManagedVision } from '../../lib/managed.js'
import { canUseManaged } from '../../lib/managedAccess.js'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const bodySchema = z.object({
  image: z.string().min(1),
  mime: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  question: z.string().trim().max(2000).optional(),
})

const fail = (reply: FastifyReply, status: number, message: string) => reply.status(status).send({ error: { message } })

/** The workspace whose recognition settings apply: the key's own, else the owner's first. */
async function workspaceOf(prisma: PrismaClient, req: FastifyRequest): Promise<string | null> {
  const scoped = req.authWorkspaceScope?.[0]
  if (scoped) return scoped
  const m = await prisma.workspaceMember.findFirst({
    where: { userId: req.authUser!.id }, orderBy: { createdAt: 'asc' }, select: { workspaceId: true },
  })
  return m?.workspaceId ?? null
}

function promptFor(question: string | undefined): string {
  return [
    'Опиши, что на изображении, подробно и по делу; весь видимый текст перепиши дословно; '
      + 'если это скриншот программы или ошибки — что за программа, что на экране, текст ошибки.',
    question ? `Затем ответь на вопрос: ${question}` : '',
    'Отвечай на языке вопроса; если вопроса нет — по-русски.',
  ].filter(Boolean).join('\n')
}

/** The innermost `"message": "…"` in a provider error — OpenRouter nests the
 *  real provider's JSON as an escaped string inside its own. */
function innermostMessage(raw: string): string | null {
  const all = [...raw.replace(/\\"/g, '"').matchAll(/"message"\s*:\s*"([^"]{3,})"/g)].map((m) => m[1])
  return all.length ? all[all.length - 1] : null
}

/** A provider failure in words the agent can act on, not a JSON dump. */
export function describeFailure(raw: string, model: string): { status: number; message: string } {
  const where = 'Выберите другую модель распознавания в админке (слот vision) или в Настройках → ИИ → распознавание документов.'
  // Google (Gemini) and some others refuse by the server's country.
  if (/location is not supported|not available in your (country|region)|unsupported_country|country, region, or territory not supported|region is not supported/i.test(raw)) {
    return { status: 503, message: `Модель распознавания ${model} недоступна из региона сервера SinoutX. ${where}` }
  }
  if (/no endpoints found|model.{0,40}(not found|does not exist|is not a valid model)|decommissioned|deprecated/i.test(raw)) {
    return { status: 503, message: `Модель распознавания ${model} больше не доступна у поставщика. ${where}` }
  }
  if (/Vision API 40[13]\b|invalid api key|incorrect api key|unauthorized/i.test(raw)) {
    return { status: 503, message: `Ключ поставщика распознавания не подходит или отозван. ${where}` }
  }
  if (/Vision API 402\b|insufficient (credits|balance|quota)/i.test(raw)) {
    return { status: 503, message: 'У ключа поставщика распознавания кончились деньги: пополните счёт у поставщика или смените ключ.' }
  }
  if (/Vision API 429|rate.?limit/i.test(raw)) {
    return { status: 429, message: 'Поставщик распознавания просит подождать: слишком много запросов. Повторите через минуту.' }
  }
  const inner = innermostMessage(raw)
  return { status: 502, message: `Модель распознавания не ответила${inner ? `: ${inner.slice(0, 200)}` : '.'}` }
}

export async function visionRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post('/vision/describe', {
    bodyLimit: 12 * 1024 * 1024,
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
        errorResponseBuilder: (_req: FastifyRequest, ctx: { after: string }) => Object.assign(
          new Error(`Слишком много запросов на распознавание: не больше 20 в минуту. Повторите через ${ctx.after}.`),
          { statusCode: 429, name: 'RateLimited' },
        ),
      },
    },
  }, async (req, reply) => {
    if (req.authVia !== 'apikey') return fail(reply, 401, 'Нужен ключ API SinoutX (sk_sinoutx_…) в Authorization: Bearer или x-api-key.')

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) return fail(reply, 400, `Неверный запрос: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
    const { mime, question } = parsed.data
    const image = parsed.data.image.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image)) return fail(reply, 400, 'Неверный запрос: image должен быть в base64.')
    const bytes = Math.floor(image.length * 3 / 4) - (image.endsWith('==') ? 2 : image.endsWith('=') ? 1 : 0)
    if (bytes > MAX_IMAGE_BYTES) return fail(reply, 400, 'Картинка больше 8 МБ: уменьшите её и пришлите снова.')

    const userId = req.authUser!.id
    const ws = await workspaceOf(prisma, req)
    if (!ws) return fail(reply, 503, 'У владельца ключа нет пространства, распознавать не через что.')

    const ocr = await resolveVisionOcr(prisma, ws, userId, 'code')
    if (!ocr) {
      // No key of his own; the shared one exists but is closed to him — say why.
      if (getManagedVision()) {
        const access = await canUseManaged(prisma, userId)
        if (access.reason === 'empty') return fail(reply, 402, 'Баланс SinoutX пуст: пополните его в приложении или подключите свой ключ распознавания (Настройки → ИИ).')
        if (access.reason === 'monthly_cap') return fail(reply, 402, 'Достигнут месячный лимит расходов SinoutX. Поднимите лимит в настройках или подключите свой ключ распознавания.')
        if (access.reason === 'frozen') return fail(reply, 402, 'Аккаунт SinoutX заморожен из-за неоплаченного счёта: оплатите его или подключите свой ключ распознавания.')
      }
      return fail(reply, 503, 'Распознавание картинок не настроено: настройте слот vision в админке или свой ключ распознавания (Настройки → ИИ).')
    }

    try {
      const text = await runExtraction(ocr, { images: [{ base64: image, mime }] }, promptFor(question))
      if (!text.trim()) return fail(reply, 502, 'Модель распознавания вернула пустой ответ.')
      return reply.send({ text })
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      req.log.warn({ err: raw, provider: ocr.provider, model: ocr.model }, '[vision/describe] recognition failed')
      const { status, message } = describeFailure(raw, ocr.model)
      return fail(reply, status, message)
    }
  })
}
