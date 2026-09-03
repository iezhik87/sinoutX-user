import type { PrismaClient } from '@prisma/client'
import { decryptIntegrationConfig } from '../secrets.js'
import type { ChannelAdapter } from './types.js'
import { telegramAdapter } from './telegram.js'
import { viberAdapter } from './viber.js'

export * from './types.js'
export { telegramAdapter, tgApi, formatForTelegram, stripTgHtml } from './telegram.js'
export { viberAdapter, viberApi, verifyViberSignature, setViberWebhook, getViberAccountInfo, formatForViber } from './viber.js'

/**
 * Every messenger a workspace can be reached on right now.
 *
 * A channel only counts once we know where to send: Telegram learns `chatId`
 * from the first inbound message, Viber learns `receiverId` when the user
 * subscribes. Before that the bot exists but has nobody to talk to, so
 * proactive briefs and reminders simply skip it.
 */
export async function outboundChannels(prisma: PrismaClient, workspaceId: string): Promise<ChannelAdapter[]> {
  const rows = await prisma.integration.findMany({
    where: { workspaceId, status: 'ACTIVE', type: { in: ['TELEGRAM', 'VIBER'] } },
  })

  const out: ChannelAdapter[] = []
  for (const ig of rows) {
    const cfg = decryptIntegrationConfig(ig.config)
    if (ig.type === 'TELEGRAM') {
      const botToken = cfg.botToken as string | undefined
      const chatId = cfg.chatId as number | string | undefined
      if (botToken && chatId !== undefined) out.push(telegramAdapter(botToken, Number(chatId)))
    } else if (ig.type === 'VIBER') {
      const token = cfg.token as string | undefined
      const receiverId = cfg.receiverId as string | undefined
      if (token && receiverId) out.push(viberAdapter(token, receiverId, (cfg.senderName as string) ?? 'SinoutX'))
    }
  }
  return out
}

/**
 * Push a proactive message (reminder, brief, trigger) to every connected
 * messenger. `text` is markdown-ish; each adapter renders it its own way.
 */
export async function notifyChannels(prisma: PrismaClient, workspaceId: string, text: string): Promise<number> {
  const adapters = await outboundChannels(prisma, workspaceId)
  let sent = 0
  for (const a of adapters) {
    const ok = await a.send(a.format(text)).catch(() => undefined)
    if (ok !== undefined) sent++
  }
  return sent
}
