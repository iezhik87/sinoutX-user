// ─── Frozen accounts, cached ──────────────────────────────────────────────────
// The write guard runs on every mutating request, and `authUser` comes from a
// JWT that cannot know about a freeze that happened after it was signed. A DB
// lookup per write would be a query per keystroke-batch, so the set of frozen
// users lives in Redis: a `SISMEMBER` costs microseconds.
//
// It is primed from the database at boot, so a Redis flush cannot silently
// unfreeze everyone; and it fails OPEN, because a Redis outage must not lock
// every paying customer out of their own notes.
import type { PrismaClient } from '@prisma/client'
import { redis } from './redis.js'

const KEY = 'billing:frozen'

export async function isFrozen(userId: string): Promise<boolean> {
  try {
    return (await redis.sismember(KEY, userId)) === 1
  } catch {
    return false // fail open: an outage must not lock people out
  }
}

export async function markFrozen(userId: string): Promise<void> {
  await redis.sadd(KEY, userId).catch(() => 0)
}

export async function clearFrozen(userId: string): Promise<void> {
  await redis.srem(KEY, userId).catch(() => 0)
}

/** Rebuild the cache from the source of truth. Called once at startup. */
export async function primeFrozenCache(prisma: PrismaClient): Promise<number> {
  try {
    const frozen = await prisma.user.findMany({ where: { frozenAt: { not: null } }, select: { id: true } })
    await redis.del(KEY)
    if (frozen.length) await redis.sadd(KEY, ...frozen.map((u) => u.id))
    return frozen.length
  } catch (e) {
    console.error('[billing] could not prime frozen cache', (e as Error).message)
    return 0
  }
}
