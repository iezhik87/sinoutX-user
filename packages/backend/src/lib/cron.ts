import cron from 'node-cron'
import type { PrismaClient } from '@prisma/client'
import { publish, redis } from './redis.js'
import { sendDeadlineReminderEmail, sendLicenseExpiryReminderEmail, isEmailConfigured } from './email.js'
import { config } from '../config/index.js'
import { buildBackupBuffer, dirByLabel, backupName, pruneDir } from './instanceBackup.js'
import { NotificationService } from '../modules/notification/notification.service.js'
import { completeOnce, getEmbeddingsConfig, getAISettings, appendEpisode, tipTapToText, textToTipTap, EXPERTISE_PLAYBOOK_TITLE, EXPERTISE_LOG_TITLE } from '../modules/ai/ai.service.js'
import { getCustomTools, saveCustomTools } from '../modules/ai/ai.customtools.js'
import { runChannelAgent } from '../modules/integration/integration.routes.js'
import { outboundChannels, notifyChannels } from '../modules/integration/channels/index.js'
import { chargeMonth } from './subscription.js'
import { isBillingEnabled } from './billingMode.js'
import { expireStalePendingTopups } from './wallet.js'
import { usd } from './pricing.js'
import { parseAssembled } from '../modules/ai/ai.customtools.js'
import { indexRecord, recallRecords } from './embeddings.js'
import { promises as fs } from 'fs'
import { join } from 'path'

// ─── Recurrence helpers ───────────────────────────────────────────────────────

type RecurrenceRule = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'weekdays'

function nextOccurrence(from: Date, rule: RecurrenceRule): Date {
  const d = new Date(from)
  switch (rule) {
    case 'daily':    d.setDate(d.getDate() + 1); break
    case 'weekly':   d.setDate(d.getDate() + 7); break
    case 'biweekly': d.setDate(d.getDate() + 14); break
    case 'monthly':  d.setMonth(d.getMonth() + 1); break
    case 'yearly':   d.setFullYear(d.getFullYear() + 1); break
    case 'weekdays': {
      // Skip to next weekday (Mon–Fri)
      d.setDate(d.getDate() + 1)
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
      break
    }
  }
  return d
}

function isValidRule(r: string | null): r is RecurrenceRule {
  return ['daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'weekdays'].includes(r ?? '')
}

// ─── Recurring tasks ──────────────────────────────────────────────────────────

async function processRecurringTasks(prisma: PrismaClient) {
  const now = new Date()

  const tasks = await prisma.task.findMany({
    where: {
      isRecurring: true,
      isDeleted: false,
      status: 'DONE',
      dueDate: { lte: now },
    },
    take: 100,
  })

  for (const task of tasks) {
    if (!isValidRule(task.recurrenceRule)) continue

    const baseDue = task.dueDate ?? now
    const nextDue = nextOccurrence(baseDue, task.recurrenceRule as RecurrenceRule)
    // Shift reminders forward by the same delta so the next instance keeps them.
    const occDelta = nextDue.getTime() - baseDue.getTime()
    const nextReminders = (task.reminderAt ?? []).map((r) => new Date(r.getTime() + occDelta))

    // CONSUME the completed instance so it never re-spawns — recurrence moves to
    // the new instance. Without this, a DONE recurring task with a past dueDate
    // matched every hourly run and created an endless stream of duplicates (each
    // publishing task.created, which spammed trigger skills). Do this FIRST.
    await prisma.task.update({ where: { id: task.id }, data: { isRecurring: false } })

    // If the next occurrence already exists (e.g. spawned on completion), skip.
    const exists = await prisma.task.findFirst({
      where: { projectId: task.projectId, title: task.title, dueDate: nextDue, isRecurring: true, isDeleted: false },
      select: { id: true },
    })
    if (exists) continue

    // Create new task instance for next occurrence
    const newTask = await prisma.task.create({
      data: {
        projectId: task.projectId,
        pageId: task.pageId,
        boardId: task.boardId,
        title: task.title,
        status: 'TODO',
        priority: task.priority,
        dueDate: nextDue,
        reminderAt: nextReminders,
        isRecurring: true,
        recurrenceRule: task.recurrenceRule,
        position: 0,
      },
    })

    await publish({
      type: 'task.created',
      workspaceId: await getWorkspaceId(prisma, 'project', task.projectId),
      projectId: task.projectId,
      taskId: newTask.id,
    })
  }

  if (tasks.length > 0) {
    console.log(`[cron] Created ${tasks.length} recurring task instances`)
  }
}

// ─── Recurring calendar events ────────────────────────────────────────────────

async function processRecurringEvents(prisma: PrismaClient) {
  const now = new Date()

  const events = await prisma.calendarEvent.findMany({
    where: {
      isRecurring: true,
      startAt: { lte: now },
    },
    take: 100,
  })

  for (const event of events) {
    if (!isValidRule(event.recurrenceRule)) continue

    const nextStart = nextOccurrence(event.startAt, event.recurrenceRule as RecurrenceRule)
    const duration = event.endAt ? event.endAt.getTime() - event.startAt.getTime() : 0
    // Shift reminders forward by the same delta so the next occurrence keeps them.
    const occDelta = nextStart.getTime() - event.startAt.getTime()
    const nextReminders = (event.reminderAt ?? []).map((r) => new Date(r.getTime() + occDelta))

    // Check if next occurrence already exists to avoid duplicates
    const exists = await prisma.calendarEvent.findFirst({
      where: {
        projectId: event.projectId,
        title: event.title,
        startAt: nextStart,
      },
    })
    if (exists) continue

    await prisma.calendarEvent.create({
      data: {
        projectId: event.projectId,
        title: event.title,
        description: event.description,
        startAt: nextStart,
        endAt: duration > 0 ? new Date(nextStart.getTime() + duration) : null,
        allDay: event.allDay,
        isRecurring: true,
        recurrenceRule: event.recurrenceRule,
        color: event.color,
        location: event.location,
        reminderAt: nextReminders,
        linkedDocuments: event.linkedDocuments as object,
      },
    })
  }
}

// ─── Recurring budget entries ─────────────────────────────────────────────────

async function processRecurringBudget(prisma: PrismaClient) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const entries = await prisma.budgetEntry.findMany({
    where: {
      isRecurring: true,
      date: { lte: now },
    },
    take: 100,
  })

  for (const entry of entries) {
    if (!isValidRule(entry.recurrenceRule)) continue

    const nextDate = nextOccurrence(entry.date, entry.recurrenceRule as RecurrenceRule)

    // Only create if next occurrence is in the past or today and not already created
    if (nextDate > now) continue

    const exists = await prisma.budgetEntry.findFirst({
      where: {
        projectId: entry.projectId,
        category: entry.category,
        // Check within same day
        date: {
          gte: new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate()),
          lt: new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate() + 1),
        },
        isRecurring: true,
      },
    })
    if (exists) continue

    await prisma.budgetEntry.create({
      data: {
        projectId: entry.projectId,
        type: entry.type,
        category: entry.category,
        amount: entry.amount,
        currency: entry.currency,
        date: nextDate,
        description: entry.description,
        isRecurring: true,
        recurrenceRule: entry.recurrenceRule,
        tags: entry.tags,
      },
    })
  }

  void startOfToday // suppress unused warning
}

// ─── Scheduled skills: the agent's own recurring behaviours, run on schedule ──
// Each 'scheduled' skill (created by the agent via create_skill, editable by the
// user) runs its prompt through the FULL agent at the configured local hour and
// delivers the result to the workspace's messenger. This is what powers daily
// briefs, follow-ups, reminders the agent set up for itself.

function tzHour(tz: string | undefined, now: Date): number {
  try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hour: '2-digit', hour12: false }).format(now)) } catch { return now.getUTCHours() }
}
function tzDate(tz: string | undefined, now: Date): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(now) } catch { return now.toISOString().slice(0, 10) }
}

async function processScheduledSkills(prisma: PrismaClient) {
  const now = new Date()
  const rows = await prisma.integration.findMany({ where: { type: { in: ['TELEGRAM', 'VIBER'] }, status: 'ACTIVE' }, select: { workspaceId: true } })
  // A workspace with both messengers appears twice — collapse it, or every skill
  // would be considered once per channel.
  const workspaceIds = [...new Set(rows.map((r) => r.workspaceId))]

  for (const workspaceId of workspaceIds) {
    try {
      // A skill answers in ONE channel: running the agent per messenger would
      // double the token bill for the same prompt. Telegram wins when both are on.
      const [adapter] = await outboundChannels(prisma, workspaceId)
      if (!adapter) continue
      const skills = (await getCustomTools(workspaceId, prisma)).filter((t) => t.kind === 'scheduled' && t.enabled && t.prompt)
      if (!skills.length) continue

      const tz = (await getAISettings(workspaceId, prisma).catch(() => null))?.timezone
      const hour = tzHour(tz, now)
      const day = tzDate(tz, now)
      const owner = await prisma.workspaceMember.findFirst({ where: { workspaceId, role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { userId: true } })

      for (const sk of skills) {
        if ((sk.schedule?.hour ?? 9) !== hour) continue
        // Once per local day per skill.
        if ((await redis.set(`skill:${workspaceId}:${sk.id}:${day}`, '1', 'EX', 90000, 'NX')) !== 'OK') continue
        await runChannelAgent(prisma, adapter, workspaceId, adapter.chatKey, owner?.userId, undefined, sk.prompt!, 'ru', false)
          .catch((e) => console.error('[cron] skill run error', sk.id, e))
        // Stamp lastRunAt.
        const all = await getCustomTools(workspaceId, prisma)
        await saveCustomTools(workspaceId, prisma, all.map((t) => (t.id === sk.id ? { ...t, lastRunAt: now.toISOString() } : t))).catch(() => {})
        console.log(`[cron] ran scheduled skill ${sk.name} (ws ${workspaceId})`)
      }
    } catch (e) { console.error('[cron] scheduled skills error', e) }
  }
}

// ─── Episodic memory: distil idle chat sessions into episodes ────────────────
const EPISODE_SYSTEM = 'Кратко резюмируй фрагмент диалога пользователя с ассистентом как ЭПИЗОД памяти: о чём говорили, какие решения/договорённости/факты о пользователе всплыли, что сделано. 2–5 предложений, по сути, без воды и без выдумок. Если ничего стоящего — верни пустую строку. Только текст резюме.'

async function processEpisodeCapture(prisma: PrismaClient) {
  const idle = new Date(Date.now() - 30 * 60_000)
  const convs = await prisma.aiConversation.findMany({
    where: { updatedAt: { lt: idle } }, orderBy: { updatedAt: 'desc' }, take: 25,
    select: { id: true, workspaceId: true, title: true, summarizedAt: true, updatedAt: true },
  })
  for (const c of convs) {
    try {
      if (c.summarizedAt && c.summarizedAt >= c.updatedAt) continue // nothing new since last episode
      const since = c.summarizedAt ?? new Date(0)
      const msgs = await prisma.aiMessage.findMany({
        where: { conversationId: c.id, createdAt: { gt: since } },
        orderBy: { createdAt: 'asc' }, take: 80, select: { role: true, content: true },
      })
      if (msgs.filter((m) => m.role === 'user').length < 2) { // too little new to summarize
        await prisma.aiConversation.update({ where: { id: c.id }, data: { summarizedAt: new Date() } }).catch(() => {})
        continue
      }
      const transcript = msgs.map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${(m.content || '').slice(0, 1500)}`).join('\n').slice(0, 12000)
      let summary: string
      try { summary = (await completeOnce(c.workspaceId, EPISODE_SYSTEM, transcript, prisma)).trim() } catch { continue } // no AI provider → retry next tick
      if (summary && summary.length > 5) await appendEpisode(prisma, c.workspaceId, summary, `chat:${c.title}`)
      await prisma.aiConversation.update({ where: { id: c.id }, data: { summarizedAt: new Date() } }).catch(() => {})
    } catch (e) { console.error('[cron] episode capture', c.id, e) }
  }
}

async function processReminders(prisma: PrismaClient) {
  const now = new Date()
  const windowStart = new Date(now.getTime() - 60_000)

  // Raw query: find tasks with a reminderAt value within the last minute
  const tasks = await prisma.$queryRaw<Array<{ id: string; title: string; project_id: string }>>`
    SELECT t.id, t.title, t.project_id
    FROM tasks t
    WHERE t.is_deleted = false
      AND t.status NOT IN ('DONE', 'CANCELLED')
      AND EXISTS (
        SELECT 1 FROM unnest(t.reminder_at) AS r
        WHERE r >= ${windowStart} AND r <= ${now}
      )
  `

  const events = await prisma.$queryRaw<Array<{ id: string; title: string; project_id: string }>>`
    SELECT e.id, e.title, e.project_id
    FROM calendar_events e
    WHERE EXISTS (
      SELECT 1 FROM unnest(e.reminder_at) AS r
      WHERE r >= ${windowStart} AND r <= ${now}
    )
  `

  if (tasks.length === 0 && events.length === 0) return

  const projectIds = [...new Set([...tasks.map((t) => t.project_id), ...events.map((e) => e.project_id)])]
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, workspaceId: true, name: true },
  })
  const projectMap = new Map(projects.map((p) => [p.id, p]))
  const workspaceIds = [...new Set(projects.map((p) => p.workspaceId))]

  // Cheap early exit: nobody is reachable on any messenger.
  const reachable = await prisma.integration.count({
    where: { workspaceId: { in: workspaceIds }, type: { in: ['TELEGRAM', 'VIBER'] }, status: 'ACTIVE' },
  })
  if (reachable === 0) return

  let sent = 0
  for (const task of tasks) {
    const project = projectMap.get(task.project_id)
    if (!project) continue
    // Every connected messenger gets it — Telegram, Viber, or both.
    const n = await notifyChannels(prisma, project.workspaceId, `⏰ **Напоминание о задаче**\n${task.title}\nПроект: ${project.name}`)
    if (n) sent++
  }

  for (const event of events) {
    const project = projectMap.get(event.project_id)
    if (!project) continue
    const n = await notifyChannels(prisma, project.workspaceId, `📅 **Напоминание о событии**
${event.title}
Проект: ${project.name}`)
    if (n) sent++
  }

  if (sent > 0) console.log(`[cron] Sent ${sent} reminders`)
}

// ─── Email deadline reminders ─────────────────────────────────────────────────

async function processEmailDeadlineReminders(prisma: PrismaClient) {
  if (!await isEmailConfigured(prisma)) return

  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000)

  const tasks = await prisma.task.findMany({
    where: {
      isDeleted: false,
      status: { notIn: ['DONE', 'CANCELLED'] },
      dueDate: { gte: in24h, lt: in25h },
      assignee: { not: null },
    },
    include: { project: { select: { name: true } } },
  })

  if (tasks.length === 0) return

  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
  const appUrl = settings?.appUrl ?? 'http://localhost:3012'

  for (const task of tasks) {
    if (!task.assignee) continue
    const user = await prisma.user.findFirst({
      where: { name: task.assignee, isActive: true, isVerified: true },
    })
    if (!user) continue

    const prefs = (user.notificationPrefs as Record<string, boolean>) ?? {}
    if (prefs.deadlineReminder === false) continue

    await sendDeadlineReminderEmail(user.email, {
      taskTitle: task.title,
      projectName: task.project?.name ?? '',
      dueDate: task.dueDate!,
      appUrl,
    }, prisma).catch((e) => console.error('[cron] deadline email error:', e))
  }

  if (tasks.length > 0) console.log(`[cron] Processed ${tasks.length} deadline reminder emails`)
}

// ─── License expiry reminders ─────────────────────────────────────────────────

// Notify holders of paid (pro/team) licenses before they lapse. Fires once per
// threshold per expiry date — deduped via Redis so a daily run won't re-send.
const EXPIRY_THRESHOLDS = [14, 7, 3, 1] // days before expiry

async function processLicenseExpiryReminders(prisma: PrismaClient) {
  const now = new Date()
  const horizon = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000)

  const users = await prisma.user.findMany({
    where: {
      plan: 'team',
      licenseExpiresAt: { gt: now, lte: horizon },
    },
    select: { id: true, email: true, plan: true, licenseExpiresAt: true },
  })
  if (users.length === 0) return

  const appUrl = config.APP_URL ?? 'http://localhost:3012'
  const emailOn = await isEmailConfigured(prisma)
  let sent = 0

  for (const u of users) {
    if (!u.licenseExpiresAt) continue
    const msLeft = u.licenseExpiresAt.getTime() - now.getTime()
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))
    const threshold = EXPIRY_THRESHOLDS.find((t) => daysLeft <= t)
    if (!threshold) continue

    // Dedupe: one notice per (user, expiry, threshold). Key TTL outlives expiry.
    const expEpoch = Math.floor(u.licenseExpiresAt.getTime() / 1000)
    const dedupeKey = `license:reminded:${u.id}:${expEpoch}:${threshold}`
    const fresh = await redis.set(dedupeKey, '1', 'EX', 40 * 24 * 60 * 60, 'NX').catch(() => 'OK')
    if (fresh !== 'OK') continue // already reminded for this threshold

    await prisma.notification.create({
      data: {
        userId: u.id,
        type: 'system',
        title: `License expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        body: `Your ${u.plan.toUpperCase()} license expires ${u.licenseExpiresAt.toISOString().slice(0, 10)}. Renew to keep your features.`,
        link: `/buy?plan=${u.plan}`,
      },
    }).catch((e) => console.error('[cron] expiry notification error:', e))

    if (emailOn && u.email) {
      await sendLicenseExpiryReminderEmail(u.email, {
        plan: u.plan, expiresAt: u.licenseExpiresAt, daysLeft, appUrl,
      }, prisma).catch((e) => console.error('[cron] expiry email error:', e))
    }
    sent++
  }

  if (sent > 0) console.log(`[cron] Sent ${sent} license-expiry reminders`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const workspaceCache = new Map<string, string>()

async function getWorkspaceId(prisma: PrismaClient, entityType: string, entityId: string): Promise<string> {
  const cacheKey = `${entityType}:${entityId}`
  if (workspaceCache.has(cacheKey)) return workspaceCache.get(cacheKey)!

  let workspaceId = ''
  if (entityType === 'project') {
    const p = await prisma.project.findUnique({ where: { id: entityId }, select: { workspaceId: true } })
    workspaceId = p?.workspaceId ?? ''
  }

  if (workspaceId) workspaceCache.set(cacheKey, workspaceId)
  return workspaceId
}

// ─── Scheduled full-instance backup ────────────────────────────────────────────

async function processScheduledBackup(prisma: PrismaClient) {
  const s = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
  if (!s || s.backupSchedule === 'off') return

  // Runs from the hourly cron tick: fire only at the configured hour (server
  // time), and for weekly only on the configured weekday. A 23h dedupe guards
  // against double-runs (restarts / clock quirks).
  const now = new Date()
  if (now.getHours() !== (s.backupHour ?? 3)) return
  if (s.backupSchedule === 'weekly' && now.getDay() !== (s.backupWeekday ?? 1)) return
  const last = s.backupLastRunAt ? s.backupLastRunAt.getTime() : 0
  if (now.getTime() - last < 23 * 3600_000) return

  const dir = dirByLabel(s.backupDir ?? undefined)
  if (!dir) { console.error('[cron] scheduled backup: no destination dir'); return }

  try {
    const { buffer } = await buildBackupBuffer(prisma)
    await fs.mkdir(dir.path, { recursive: true })
    await fs.writeFile(join(dir.path, backupName()), buffer)
    await pruneDir(dir.path, s.backupRetention ?? 7)
    await prisma.appSettings.update({ where: { id: 'singleton' }, data: { backupLastRunAt: new Date() } })
    console.log(`[cron] Scheduled backup written to ${dir.label} (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`)
  } catch (e) {
    console.error('[cron] scheduled backup error:', e)
  }
}

// ─── Medical Record reminders (once a day at 08:00 server time) ────────────────

async function processMedcardReminders(prisma: PrismaClient) {
  const now = new Date()
  if (now.getHours() !== 8) return // fire once per day
  const today = now.toISOString().slice(0, 10)
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)
  const notif = new NotificationService(prisma)

  const projects = await prisma.project.findMany({ where: { isModule: true, moduleId: 'medical-record' }, select: { id: true, workspaceId: true } })
  for (const p of projects) {
    const cols = await prisma.collection.findMany({ where: { projectId: p.id }, select: { id: true, key: true } })
    const visits = cols.find((c) => c.key === 'visits')
    if (visits) {
      for (const r of await prisma.collectionRecord.findMany({ where: { collectionId: visits.id } })) {
        const d = r.data as Record<string, unknown>
        if (d.date === today || d.date === tomorrow) {
          await notif.create({ workspaceId: p.workspaceId, type: 'system', title: d.date === today ? 'Сегодня приём' : 'Завтра приём', body: [d.doctor, d.diagnosis].filter(Boolean).join(' · ') || undefined, link: `/projects/${p.id}/c/${visits.id}` }).catch(() => null)
        }
      }
    }
    const meds = cols.find((c) => c.key === 'medications')
    if (meds) {
      for (const r of await prisma.collectionRecord.findMany({ where: { collectionId: meds.id } })) {
        const d = r.data as Record<string, unknown>
        if ((d.status === 'active' || !d.status) && (d.until === today || d.until === tomorrow)) {
          await notif.create({ workspaceId: p.workspaceId, type: 'system', title: 'Курс лекарства заканчивается', body: String(d.name ?? ''), link: `/projects/${p.id}/c/${meds.id}` }).catch(() => null)
        }
      }
    }
  }
}

// ─── Memory consolidation (episodes → facts/entities, once a day) ──────────────
// Like human memory: the day's episodes are distilled into durable facts/entities
// overnight. Runs on the workspace's own chat model (BYOK) via completeOnce — skips
// workspaces without an AI provider. New facts/entities are embedded for recall.

const CONSOLIDATION_SYSTEM = `Ты — система консолидации памяти агента. Тебе дают свежие ЭПИЗОДЫ (события/диалоги/наблюдения). Извлеки из них устойчивые ФАКТЫ и СУЩНОСТИ — только значимое и долгоиграющее, не разовый шум. Верни СТРОГО JSON без markdown и без текста вокруг:
{"facts":[{"text":"...","topic":"...","importance":"low|medium|high"}],"entities":[{"name":"...","type":"person|project|concept|place|org|other","attributes":"..."}]}
Кратко, без дублей. Только JSON.`

export interface ConsolidationResult {
  workspaceId: string
  episodes: number   // fresh episodes considered
  created: number    // facts + entities created
  dupes?: number     // near-duplicates skipped
  skipped?: string   // reason if nothing was done
}

// A candidate fact/entity this close to an existing one is a duplicate, not new
// knowledge — skip it so the memory doesn't fill with restated variants.
const CONSOLIDATION_DEDUP_MIN = 0.88

/**
 * Distil fresh `episodes` into durable `facts`/`entities` for the memory module.
 * Reusable by the nightly cron AND on-demand (MCP / endpoint). Does NOT swallow
 * the AI error silently — returns it as `skipped` so callers can surface "no AI
 * provider on this workspace" / "402" instead of a mystery 0/N.
 */
export async function consolidateMemory(
  prisma: PrismaClient,
  opts?: { workspaceId?: string; force?: boolean },
): Promise<ConsolidationResult[]> {
  const now = new Date()
  const minFresh = opts?.force ? 1 : 3
  const where: Record<string, unknown> = { isModule: true, moduleId: 'memory' }
  if (opts?.workspaceId) where.workspaceId = opts.workspaceId
  const projects = await prisma.project.findMany({ where, select: { id: true, workspaceId: true } })
  const out: ConsolidationResult[] = []

  for (const p of projects) {
    const res: ConsolidationResult = { workspaceId: p.workspaceId, episodes: 0, created: 0 }
    try {
      const cols = await prisma.collection.findMany({ where: { projectId: p.id }, select: { id: true, key: true } })
      const epCol = cols.find((c) => c.key === 'episodes')
      const factCol = cols.find((c) => c.key === 'facts')
      const entCol = cols.find((c) => c.key === 'entities')
      if (!epCol || (!factCol && !entCol)) { res.skipped = 'memory collections missing'; out.push(res); continue }

      const eps = await prisma.collectionRecord.findMany({ where: { collectionId: epCol.id }, orderBy: { createdAt: 'desc' }, take: 80 })
      const fresh = eps.filter((e) => !(e.data as Record<string, unknown>)?._consolidated).slice(0, 40)
      res.episodes = fresh.length
      if (fresh.length < minFresh) { res.skipped = `too few new episodes (${fresh.length})`; out.push(res); continue }

      const text = fresh.map((e) => { const d = e.data as Record<string, unknown>; return `- ${d.when ?? ''} ${d.event ?? ''}`.trim() }).join('\n').slice(0, 12000)
      let parsed: Record<string, unknown>
      try {
        parsed = parseAssembled(await completeOnce(p.workspaceId, CONSOLIDATION_SYSTEM, text, prisma))
      } catch (e) {
        res.skipped = `AI provider error: ${(e as Error).message || 'no chat model on workspace'}`
        out.push(res)
        continue
      }

      const cfg = await getEmbeddingsConfig(p.workspaceId, prisma).catch(() => null)
      const facts = Array.isArray(parsed.facts) ? (parsed.facts as Record<string, unknown>[]).slice(0, 30) : []
      const entities = Array.isArray(parsed.entities) ? (parsed.entities as Record<string, unknown>[]).slice(0, 30) : []

      // Is there already a near-identical record in this collection? Uses the
      // semantic index — a restated fact ("likes tea" vs "prefers tea") is caught
      // even without the same words. Without embeddings we can't tell, so allow it.
      const isDuplicate = async (colId: string, text: string): Promise<boolean> => {
        if (!cfg || !text.trim()) return false
        const hits = await recallRecords(prisma, cfg, {
          workspaceId: p.workspaceId, query: text, collectionIds: [colId], limit: 1,
          minScore: CONSOLIDATION_DEDUP_MIN, backfill: false,
        }).catch(() => [])
        return hits.length > 0
      }

      if (factCol) for (const f of facts) {
        if (!f?.text) continue
        if (await isDuplicate(factCol.id, String(f.text))) { res.dupes = (res.dupes ?? 0) + 1; continue }
        const rec = await prisma.collectionRecord.create({ data: { collectionId: factCol.id, data: { text: String(f.text), topic: String(f.topic ?? ''), importance: String(f.importance ?? 'medium'), source: 'consolidation', date: now.toISOString() } as object } })
        if (cfg) void indexRecord(prisma, rec, p.workspaceId, cfg).catch(() => {})
        res.created++
      }
      if (entCol) for (const en of entities) {
        if (!en?.name) continue
        if (await isDuplicate(entCol.id, String(en.name))) { res.dupes = (res.dupes ?? 0) + 1; continue }
        const rec = await prisma.collectionRecord.create({ data: { collectionId: entCol.id, data: { name: String(en.name), type: String(en.type ?? 'other'), attributes: String(en.attributes ?? '') } as object } })
        if (cfg) void indexRecord(prisma, rec, p.workspaceId, cfg).catch(() => {})
        res.created++
      }

      for (const e of fresh) {
        await prisma.collectionRecord.update({ where: { id: e.id }, data: { data: { ...(e.data as object), _consolidated: now.toISOString() } as object } }).catch(() => {})
      }
      if (res.created || res.dupes) console.log(`[cron] memory consolidation: ${fresh.length} episodes → ${res.created} facts/entities${res.dupes ? `, ${res.dupes} dupes skipped` : ''} (ws ${p.workspaceId})`)
    } catch (e) {
      res.skipped = `error: ${(e as Error).message}`
      console.error('[cron] consolidation error:', e)
    }
    out.push(res)
  }
  return out
}

// ─── Nightly "sleep": expertises keep learning + stale memory is pruned ────────

const EXPERTISE_CONSOLIDATION_SYSTEM = `Ты — система обучения эксперта по теме «{DOMAIN}». Тебе дают фрагмент недавнего разговора и уже накопленный журнал знаний. Извлеки ТОЛЬКО НОВЫЕ устойчивые для этой темы уроки — принятые решения, найденные факты/нюансы, грабли, предпочтения пользователя, — которых ещё НЕТ в журнале. Верни СТРОГО JSON без markdown:
{"learnings":[{"kind":"decision|fact|pitfall|preference|resource","text":"..."}]}
Кратко, без дублей и без разового шума. Если нового нет — {"learnings":[]}. Только JSON.`

const EXP_KIND_RU: Record<string, string> = { decision: 'решение', fact: 'факт', pitfall: 'грабли', preference: 'предпочтение', resource: 'источник', note: 'заметка' }

// For each expertise, distil recent conversations in its project into new entries
// of its "Знания и решения" log — so the expertise keeps deepening even when the
// agent didn't call grow_expertise live. Bounded + idempotent via a per-conv Redis
// marker; runs on the workspace's own chat model (BYOK).
export async function consolidateExpertises(prisma: PrismaClient, opts?: { workspaceId?: string }): Promise<number> {
  const playbooks = await prisma.page.findMany({
    where: { title: EXPERTISE_PLAYBOOK_TITLE, isDeleted: false, ...(opts?.workspaceId ? { project: { workspaceId: opts.workspaceId } } : {}) },
    select: { projectId: true, project: { select: { name: true, workspaceId: true } } },
  })
  let total = 0
  for (const pb of playbooks) {
    const { projectId } = pb
    const domain = pb.project.name
    const wsId = pb.project.workspaceId
    const convs = await prisma.aiConversation.findMany({ where: { projectId }, select: { id: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 15 })
    for (const conv of convs) {
      try {
        const markKey = `expcons:${conv.id}`
        const last = await redis.get(markKey).catch(() => null)
        if (last && new Date(last) >= conv.updatedAt) continue // nothing new since last pass
        const since = last ? new Date(last) : new Date(Date.now() - 26 * 3600 * 1000)
        const msgs = await prisma.aiMessage.findMany({
          where: { conversationId: conv.id, createdAt: { gt: since }, role: { in: ['user', 'assistant'] } },
          orderBy: { createdAt: 'asc' }, take: 60, select: { role: true, content: true },
        })
        await redis.set(markKey, conv.updatedAt.toISOString(), 'EX', 60 * 60 * 24 * 90).catch(() => {})
        if (msgs.length < 4) continue
        const convText = msgs.map((m) => `${m.role === 'user' ? 'П' : 'А'}: ${m.content}`).join('\n').slice(0, 10000)
        const logPage = await prisma.page.findFirst({ where: { projectId, title: EXPERTISE_LOG_TITLE, isDeleted: false }, select: { id: true, content: true } })
        const logTail = logPage ? tipTapToText((logPage.content as Record<string, unknown>) ?? { type: 'doc', content: [] }).slice(-2000) : ''
        let parsed: Record<string, unknown>
        try {
          parsed = parseAssembled(await completeOnce(wsId, EXPERTISE_CONSOLIDATION_SYSTEM.replace('{DOMAIN}', domain), `РАЗГОВОР:\n${convText}\n\nУЖЕ В ЖУРНАЛЕ:\n${logTail || '(пусто)'}`, prisma))
        } catch { continue }
        const learnings = (Array.isArray(parsed?.learnings) ? parsed.learnings : []) as Record<string, unknown>[]
        const entries = learnings.filter((l) => l?.text).slice(0, 8)
          .map((l) => `- [${new Date().toISOString().slice(0, 10)}] (${EXP_KIND_RU[String(l.kind)] ?? 'заметка'}) ${String(l.text)}`).join('\n')
        if (!entries) continue
        if (logPage) {
          const existing = tipTapToText((logPage.content as Record<string, unknown>) ?? { type: 'doc', content: [] })
          await prisma.page.update({ where: { id: logPage.id }, data: { content: textToTipTap(`${existing}\n${entries}`), yjsState: null } })
        } else {
          await prisma.page.create({ data: { projectId, title: EXPERTISE_LOG_TITLE, icon: 'lucide:GraduationCap', content: textToTipTap(`# ${EXPERTISE_LOG_TITLE}\n\n${entries}`), position: 1 } })
        }
        total += learnings.length
        console.log(`[cron] expertise "${domain}": +${learnings.length} learnings from a recent chat (ws ${wsId})`)
      } catch (e) { console.error('[cron] expertise consolidation', conv.id, e) }
    }
  }
  return total
}

// Housekeeping: hard-delete memory records that were superseded (by a newer,
// contradicting one) more than 30 days ago. They're already hidden from recall —
// this just keeps the store tidy so old contradictions don't accumulate forever.
export async function pruneStaleMemory(prisma: PrismaClient, opts?: { workspaceId?: string }): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const memProjects = await prisma.project.findMany({
    where: { isModule: true, moduleId: 'memory', ...(opts?.workspaceId ? { workspaceId: opts.workspaceId } : {}) }, select: { id: true },
  })
  let removed = 0
  for (const p of memProjects) {
    const cols = await prisma.collection.findMany({ where: { projectId: p.id }, select: { id: true } })
    for (const c of cols) {
      const recs = await prisma.collectionRecord.findMany({ where: { collectionId: c.id }, select: { id: true, data: true } })
      for (const r of recs) {
        const sup = (r.data as Record<string, unknown> | null)?._superseded
        if (typeof sup === 'string' && new Date(sup) < cutoff) {
          await prisma.collectionRecord.delete({ where: { id: r.id } }).catch(() => {})
          removed++
        }
      }
    }
  }
  if (removed) console.log(`[cron] pruned ${removed} long-superseded memories`)
  return removed
}

// Daily guard: run once per calendar day at/after 04:00 — resilient to the
// container not being up at exactly 04:00 (a missed top-of-hour-4 tick no longer
// skips the whole day; the next hourly tick that day picks it up).
let lastConsolidationDay = ''
async function processMemoryConsolidation(prisma: PrismaClient) {
  const now = new Date()
  if (now.getHours() < 4) return
  const day = now.toDateString()
  if (day === lastConsolidationDay) return
  lastConsolidationDay = day
  // The nightly "sleep": distil episodes → durable memory, let expertises keep
  // learning from the day's chats, and tidy up long-superseded memories.
  await consolidateMemory(prisma)
  await consolidateExpertises(prisma).catch((e) => console.error('[cron] expertise consolidation error:', e))
  await pruneStaleMemory(prisma).catch((e) => console.error('[cron] memory prune error:', e))
}

// ─── Main cron runner ─────────────────────────────────────────────────────────


// ─── Cloud subscription: one charge per user per calendar month ───────────────
// Runs daily, not monthly: a server that was down on the 1st must still bill.
// Idempotency lives in the unique orderId `sub-<user>-<period>`, not in the
// schedule — a cron you can safely re-run is a cron you can safely restart.
async function processSubscriptions(prisma: PrismaClient) {
  if (!isBillingEnabled()) return

  // Anchored cycles: charge whoever is due today. Idempotent per cycle, so a
  // daily sweep is safe even if the server missed a day.
  const users = await prisma.user.findMany({
    where: { isActive: true, nextChargeAt: { lte: new Date() } },
    select: { id: true },
  })

  let charged = 0, frozen = 0
  for (const u of users) {
    const r = await chargeMonth(prisma, u.id).catch((e) => {
      console.error('[cron] subscription charge failed', u.id, e)
      return null
    })
    if (!r?.charged) continue
    charged++
    if (!r.frozen) continue
    frozen++

    // Tell him where he already is, not in a UI he may not open for a week.
    const ws = await prisma.workspaceMember.findFirst({
      where: { userId: u.id, role: 'OWNER' }, select: { workspaceId: true },
    })
    if (ws) {
      await notifyChannels(prisma, ws.workspaceId,
        `🧊 **Аккаунт заморожен**
Ежемесячный счёт за облако не покрыт: баланс ${usd(r.balanceMicroUsd)}.
Данные на месте — чтение, поиск и экспорт работают. Пополните баланс, и запись сразу вернётся.`,
      ).catch(() => 0)
    }
  }

  if (charged) console.log(`[cron] subscriptions: charged ${charged}, froze ${frozen}`)
}

export function startCronJobs(prisma: PrismaClient) {
  // Run every hour at :00
  cron.schedule('0 * * * *', async () => {
    console.log('[cron] Running recurring tasks check...')
    await processRecurringTasks(prisma).catch((e) => console.error('[cron] tasks error:', e))
    await processRecurringEvents(prisma).catch((e) => console.error('[cron] events error:', e))
    await processRecurringBudget(prisma).catch((e) => console.error('[cron] budget error:', e))
    await processScheduledBackup(prisma).catch((e) => console.error('[cron] scheduled backup error:', e))
    await processMedcardReminders(prisma).catch((e) => console.error('[cron] medcard reminders error:', e))
    await processMemoryConsolidation(prisma).catch((e) => console.error('[cron] memory consolidation error:', e))
    await processEpisodeCapture(prisma).catch((e) => console.error('[cron] episode capture error:', e))
    await processScheduledSkills(prisma).catch((e) => console.error('[cron] scheduled skills error:', e))
  })

  // Daily at 03:10 UTC — quiet hours, and far from the hourly batch above.
  cron.schedule('10 3 * * *', async () => {
    await processSubscriptions(prisma).catch((e) => console.error('[cron] subscriptions error:', e))
  })

  // Run every minute: send Telegram reminders for tasks/events, and write off
  // top-up invoices left unpaid past their window so they don't hang forever.
  cron.schedule('* * * * *', async () => {
    await processReminders(prisma).catch((e) => console.error('[cron] reminders error:', e))
    await expireStalePendingTopups(prisma)
      .then((n) => n && console.log(`[cron] expired ${n} unpaid top-up(s)`))
      .catch((e) => console.error('[cron] topup expiry error:', e))
  })

  // Run daily at 9:00: send email deadline reminders for tasks due tomorrow
  cron.schedule('0 9 * * *', async () => {
    await processEmailDeadlineReminders(prisma).catch((e) => console.error('[cron] deadline reminders error:', e))
    await processLicenseExpiryReminders(prisma).catch((e) => console.error('[cron] license expiry reminders error:', e))
  })

  console.log('[cron] Recurring jobs scheduled (hourly + reminders every minute)')
}
