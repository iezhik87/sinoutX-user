// Event-trigger dispatcher: runs 'trigger' skills when a workspace event fires.
// A dedicated Redis subscriber listens to all workspace channels; on a matching
// event it runs the skill's prompt through the full agent (headless) and, unless
// the agent answers SKIP, delivers the result to every messenger the workspace
// has connected.
import Redis from 'ioredis'
import type { PrismaClient } from '@prisma/client'
import { config } from '../config/index.js'
import { redis } from './redis.js'
import { getCustomTools } from '../modules/ai/ai.customtools.js'
import { runAgentHeadless } from '../modules/ai/ai.service.js'
import { outboundChannels } from '../modules/integration/channels/index.js'

// High-frequency events (page.updated, canvas.updated) are intentionally excluded
// to avoid running the agent on every keystroke-batch.
const TRIGGERABLE = new Set(['record.created', 'task.created', 'task.updated', 'page.created', 'note.created'])

async function handleEvent(prisma: PrismaClient, raw: string) {
  let ev: Record<string, unknown>
  try { ev = JSON.parse(raw) } catch { return }
  const type = ev.type as string | undefined
  const workspaceId = ev.workspaceId as string | undefined
  if (!type || !workspaceId || !TRIGGERABLE.has(type)) return

  const skills = (await getCustomTools(workspaceId, prisma)).filter((t) => t.kind === 'trigger' && t.enabled && t.event === type && t.prompt)
  if (!skills.length) return

  const adapters = await outboundChannels(prisma, workspaceId)
  // The answer fans out to every messenger, so the toolset must obey the weakest
  // of them: one Viber in the list and a Vault secret could no longer be recalled.
  const caps = adapters.length
    ? { id: adapters[0].id, canDelete: adapters.every((a) => a.canDelete) }
    : undefined
  // `telegram` is the file-upload channel (export_project sends a document);
  // Viber can only serve files from a public URL, so it stays out of this.
  const tg = await prisma.integration.findFirst({ where: { workspaceId, type: 'TELEGRAM', status: 'ACTIVE' }, select: { config: true } })
  const cfg = (tg?.config ?? {}) as Record<string, unknown>
  const botToken = cfg.botToken as string | undefined
  const chatId = cfg.chatId as string | number | undefined
  const owner = await prisma.workspaceMember.findFirst({ where: { workspaceId, role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { userId: true } })
  const sig = String(ev.recordId ?? ev.taskId ?? ev.pageId ?? ev.noteId ?? Date.now())

  for (const sk of skills) {
    // De-dupe: one fire per (skill, entity).
    if ((await redis.set(`trig:${workspaceId}:${sk.id}:${sig}`, '1', 'EX', 3600, 'NX')) !== 'OK') continue
    const ctx = [
      ev.recordId ? `recordId: ${ev.recordId}, collectionId: ${ev.collectionId}` : '',
      ev.taskId ? `taskId: ${ev.taskId}` : '',
      ev.pageId ? `pageId: ${ev.pageId}` : '',
    ].filter(Boolean).join(', ')
    const prompt = `Сработал твой триггер «${sk.name}». Событие: ${type}${ctx ? ` (${ctx})` : ''}.\nЧто делать: ${sk.prompt}\nСначала при необходимости посмотри детали (query_records/get_task и т.п.). Если по этому событию ничего делать или сообщать НЕ нужно — ответь ровно «SKIP».`
    const reply = await runAgentHeadless(
      [{ role: 'user', content: prompt }],
      { workspaceId, userId: owner?.userId, channel: caps, telegram: botToken && chatId !== undefined ? { botToken, chatId: Number(chatId) } : undefined, userLanguage: 'ru' },
      prisma,
    ).catch((e) => { console.error('[triggers] run', sk.id, e); return '' })
    let clean = (reply || '').trim()
    // The agent is told to answer "SKIP" to suppress, but often wraps it in prose
    // ("…всё в порядке.\n\nSKIP"). Treat a standalone/trailing SKIP as suppression,
    // and strip any stray SKIP token so it never leaks into the delivered message.
    if (!clean || /(^|\n)\s*skip\.?\s*$/i.test(clean)) continue
    clean = clean.replace(/(^|\n)\s*skip\.?\s*$/i, '').trim()
    if (!clean) continue
    for (const a of adapters) {
      await a.send(a.format(clean).slice(0, 4000)).catch((e) => console.error('[triggers] send', a.id, e))
    }
    console.log(`[triggers] fired ${sk.name} on ${type} (ws ${workspaceId})`)
  }
}

export function startTriggerDispatcher(prisma: PrismaClient) {
  const sub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  sub.on('error', (e) => console.error('[triggers] sub error', e.message))
  sub.psubscribe('sinoutx:ws:*', (err) => {
    if (err) console.error('[triggers] psubscribe failed', err)
    else console.log('[triggers] dispatcher listening')
  })
  sub.on('pmessage', (_pattern: string, _channel: string, message: string) => { void handleEvent(prisma, message).catch(() => {}) })
}
