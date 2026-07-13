import type { PrismaClient } from '@prisma/client'
import { createHmac } from 'node:crypto'

export type WebhookEvent =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'comment.created'
  | 'page.created'
  | 'page.updated'

interface WebhookConfig {
  url: string
  secret?: string
  events?: WebhookEvent[]
}

// SSRF protection — block private/loopback/link-local addresses
const PRIVATE_IP_RE = /^(localhost|127\.|0\.0\.0\.0|::1$|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/i

export function isSafeWebhookUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname
  if (PRIVATE_IP_RE.test(host)) return false
  return true
}

export async function fireWebhooks(
  prisma: PrismaClient,
  workspaceId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
) {
  const integrations = await prisma.integration.findMany({
    where: { workspaceId, type: 'WEBHOOK', status: 'ACTIVE' },
  })

  const payload = JSON.stringify({
    event,
    workspaceId,
    timestamp: new Date().toISOString(),
    data,
  })

  for (const integration of integrations) {
    const config = integration.config as unknown as WebhookConfig
    if (!config?.url) continue
    if (config.events?.length && !config.events.includes(event)) continue

    if (!isSafeWebhookUrl(config.url)) continue

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.secret) {
      const sig = createHmac('sha256', config.secret).update(payload).digest('hex')
      headers['X-Sinout-Signature'] = `sha256=${sig}`
    }

    fetch(config.url, { method: 'POST', headers, body: payload }).catch(() => null)
  }
}
