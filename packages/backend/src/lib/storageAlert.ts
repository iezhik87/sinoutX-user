// ─── Storage warning ──────────────────────────────────────────────────────────
// Today a user learns his disk is full the moment an upload is refused — which
// is the worst possible moment, because he is holding a photo he wanted to keep.
// Warn him while he can still act: buy a pack, or delete something.
//
// The warning fires once per threshold crossing, in the messenger he already
// uses. A warning per upload would be noise, and noise is ignored.
import type { PrismaClient } from '@prisma/client'
import { config } from '../config/index.js'
import { redis } from './redis.js'
import { isBillingEnabled } from './billingMode.js'
import { storageGraceMb } from './plans.js'
import { notifyChannels } from '../modules/integration/channels/index.js'

/** Warn when this much of the quota is gone. */
const WARN_AT = 0.85

const warnKey = (userId: string, limitMb: number) => `storage:warn:${userId}:${limitMb}`

/**
 * Called after a successful upload. Fire-and-forget: a failed warning must never
 * fail the upload that triggered it.
 *
 * The Redis key includes the limit, so buying a pack silently re-arms the
 * warning for the new, larger quota — which is exactly what should happen.
 */
export async function maybeWarnStorage(
  prisma: PrismaClient,
  workspaceId: string,
  usedMb: number,
  limitMb: number,
  lang: 'ru' | 'en' | 'be' = 'ru',
): Promise<void> {
  if (!isBillingEnabled()) return // nobody is paying for this disk
  if (limitMb <= 0) return                       // unlimited or unknown
  if (usedMb / limitMb < WARN_AT) return

  // Two different messages, and they must not share a key: «running out» once,
  // then «already over, living on the grace» once more when that happens.
  const over = usedMb > limitMb

  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId, role: 'OWNER' }, select: { userId: true },
  })
  if (!owner) return

  // `NX` makes this the only place a warning is sent: whoever wins the race
  // sends it, everyone else silently does nothing.
  const key = over ? `${warnKey(owner.userId, limitMb)}:over` : warnKey(owner.userId, limitMb)
  const first = await redis.set(key, '1', 'EX', 60 * 60 * 24 * 30, 'NX').catch(() => null)
  if (first !== 'OK') return

  const left = Math.max(0, limitMb - usedMb)
  const packMb = config.STORAGE_PACK_MB
  const packUsd = config.PRICE_STORAGE_PACK_USD.toFixed(2)

  const graceMb = storageGraceMb(limitMb)
  const graceLeft = Math.max(0, limitMb + graceMb - usedMb)

  const title = over
    ? (lang === 'en' ? 'Over your storage limit'
      : lang === 'be' ? 'Месца перавышана'
      : 'Место превышено')
    : (lang === 'en' ? 'Storage almost full'
      : lang === 'be' ? 'Месца амаль скончылася'
      : 'Место заканчивается')

  const body = over
    ? (lang === 'en'
      ? `${usedMb} of ${limitMb} MB used. Uploads keep working on a ${graceMb} MB reserve — about ${graceLeft} MB of it is left, then they stop. Buy a pack (+${packMb} MB for $${packUsd}/mo) or delete files.`
      : lang === 'be'
      ? `Занята ${usedMb} з ${limitMb} МБ. Загрузка яшчэ працуе на запасе ў ${graceMb} МБ — з яго засталося каля ${graceLeft} МБ, потым спыніцца. Купіце пакет (+${packMb} МБ за $${packUsd}/мес) або выдаліце файлы.`
      : `Занято ${usedMb} из ${limitMb} МБ. Загрузка ещё работает на запасе в ${graceMb} МБ — от него осталось около ${graceLeft} МБ, потом остановится. Купите пакет (+${packMb} МБ за $${packUsd}/мес) или удалите файлы.`)
    : (lang === 'en'
      ? `${usedMb} of ${limitMb} MB used, ${left} MB left. Buy a pack (+${packMb} MB for $${packUsd}/mo) or delete files — after that a ${graceMb} MB reserve keeps you going for a while, then uploads stop.`
      : lang === 'be'
      ? `Занята ${usedMb} з ${limitMb} МБ, свабодна ${left} МБ. Купіце пакет (+${packMb} МБ за $${packUsd}/мес) або выдаліце файлы — далей ${graceMb} МБ запасу, потым загрузка спыніцца.`
      : `Занято ${usedMb} из ${limitMb} МБ, свободно ${left} МБ. Купите пакет (+${packMb} МБ за $${packUsd}/мес) или удалите файлы — дальше есть запас ${graceMb} МБ, потом загрузка остановится.`)

  // In-app first: a web-only user has no messenger, and "upload refused" is the
  // worst moment to first learn the disk was filling up.
  const { NotificationService } = await import('../modules/notification/notification.service.js')
  await new NotificationService(prisma)
    .create({ userId: owner.userId, type: 'system', title, body, link: '/billing' })
    .catch(() => {})

  // And the channels he connected.
  await notifyChannels(prisma, workspaceId, `💾 **${title}**\n${body}`).catch(() => 0)
}
