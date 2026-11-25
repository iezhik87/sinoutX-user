import { Prisma } from '@prisma/client'
import { z } from 'zod'

const querySchema = z.object({
  period: z.enum(['all', 'month', 'range', '30d']).optional(),
  month: z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/).optional(),
  from: z.string().regex(/^[1-9]\d{3}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^[1-9]\d{3}-\d{2}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
}).strict()

function day(value: string): Date {
  const date = new Date(value + 'T00:00:00.000Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid date')
  return date
}

export function usagePeriod(query: unknown, now = new Date()) {
  const q = querySchema.parse(query)
  const period = q.period ?? (q.days !== undefined ? '30d' : 'all')
  if ((q.month && period !== 'month') || ((q.from || q.to) && period !== 'range') || (q.days !== undefined && period !== '30d')) throw new Error('Conflicting period fields')
  let since: Date | undefined, until: Date | undefined
  if (period === 'month') {
    if (!q.month) throw new Error('Month is required')
    since = day(q.month + '-01')
    until = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + 1, 1))
  } else if (period === 'range') {
    if (!q.from || !q.to) throw new Error('Both dates are required')
    since = day(q.from)
    const last = day(q.to)
    if (since > last) throw new Error('Invalid date order')
    until = new Date(last.getTime() + 86_400_000)
  } else if (period === '30d') {
    since = new Date(now.getTime() - (q.days ?? 30) * 86_400_000)
  }
  const where: Prisma.AiUsageWhereInput = since ? { createdAt: { gte: since, ...(until ? { lt: until } : {}) } } : {}
  return { period, days: period === '30d' ? q.days ?? 30 : null, since, until, where, timezone: 'UTC' as const }
}

export type MonthlyUsage = {
  month: string; answers: number; calls: number; inputTokens: number; cachedInputTokens: number; outputTokens: number
  costUsd: number; byokCostUsd: number; chargedUsd: number
}

export function monthlyUsageSql(period: ReturnType<typeof usagePeriod>) {
  const conditions = [Prisma.sql`TRUE`]
  if (period.since) conditions.push(Prisma.sql`created_at >= ${period.since}`)
  if (period.until) conditions.push(Prisma.sql`created_at < ${period.until}`)
  return Prisma.sql`
    SELECT to_char(created_at, 'YYYY-MM') AS month,
      count(*)::double precision AS answers,
      sum(calls)::double precision AS calls,
      sum(input_tokens)::double precision AS "inputTokens",
      sum(cached_input_tokens)::double precision AS "cachedInputTokens",
      sum(output_tokens)::double precision AS "outputTokens",
      (sum(CASE WHEN managed THEN cost_micro_usd ELSE 0 END)::double precision / 1000000) AS "costUsd",
      (sum(CASE WHEN NOT managed THEN cost_micro_usd ELSE 0 END)::double precision / 1000000) AS "byokCostUsd",
      (sum(charged_micro_usd)::double precision / 1000000) AS "chargedUsd"
    FROM ai_usage WHERE ${Prisma.join(conditions, ' AND ')}
    GROUP BY month ORDER BY month DESC`
}
