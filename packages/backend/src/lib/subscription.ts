// ─── Cloud subscription ───────────────────────────────────────────────────────
// Hosting is a service, and a service costs money. The free path is self-hosted:
// give away the cloud and you give away the only scarce resource you own — the
// disk and the CPU under it.
//
// Three meters, one monthly charge, drawn from the same wallet as tokens:
//   base   — the seat you occupy on our server
//   disk   — what you store beyond the free allowance
//   people — everyone in your workspace past the first
//
// Nobody is billed on self-hosted, and neither the instance owner nor admins are
// billed anywhere: an operator who freezes himself cannot unfreeze himself.
import type { PrismaClient } from '@prisma/client'
import { config } from '../config/index.js'
import { toMicroUsd, fromMicroUsd, usd, type MicroUsd } from './pricing.js'
import { isBilled } from './billingMode.js'
import { roleIsUnlimited } from './plans.js'
import { markFrozen, clearFrozen } from './frozen.js'

/** One month on from a date, keeping the day-of-month where possible. The cycle
 *  is anchored to the user's top-up date — bill the month he actually paid for,
 *  not from the calendar 1st. */
export const addMonth = (d: Date): Date => {
  const n = new Date(d)
  n.setUTCMonth(n.getUTCMonth() + 1)
  return n
}

// Idempotency key of ONE charge: the due date it settles. A retried cron for the
// same cycle collides on this and no-ops.
const cycleOrderId = (userId: string, due: Date) => `sub-${userId}-${due.toISOString().slice(0, 10)}`

export interface MonthlyBill {
  baseMicroUsd: MicroUsd
  storageMicroUsd: MicroUsd
  totalMicroUsd: MicroUsd
  /** 200 MB packs the user holds. He buys them; we do not add them silently. */
  packs: number
}

/**
 * What this user owes for a month of cloud.
 *
 * Storage is NOT metered from what he happens to have stored: he buys 200 MB
 * packs deliberately, and pays for the packs he holds. Charging by measured
 * usage would mean a photo uploaded on the 30th silently costs him money he
 * never agreed to.
 */
export async function monthlyBill(prisma: PrismaClient, userId: string): Promise<MonthlyBill> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { storagePacks: true } })
  const packs = user?.storagePacks ?? 0

  const base = toMicroUsd(config.PRICE_CLOUD_BASE_USD)
  const storage = toMicroUsd(packs * config.PRICE_STORAGE_PACK_USD)

  // No seat charge: every person is a separate account with his own $5
  // subscription. Inviting a teammate costs nothing to the inviter — the
  // teammate pays his own way. Charging both was billing one head twice.
  return {
    baseMicroUsd: base,
    storageMicroUsd: storage,
    totalMicroUsd: base + storage,
    packs,
  }
}

export interface ChargeResult {
  charged: boolean
  frozen: boolean
  balanceMicroUsd: MicroUsd
}

/**
 * Charge one user for the current month, once.
 *
 * The charge is written as a negative ledger row keyed by `sub-<user>-<period>`,
 * whose unique constraint is the only thing standing between a retried cron and
 * a double charge. Do not "check then write" — check-then-write races itself.
 */
export async function chargeMonth(prisma: PrismaClient, userId: string): Promise<ChargeResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, balanceMicroUsd: true, frozenAt: true, nextChargeAt: true },
  })
  // Everyone pays. An admin who wants to host someone for free credits the
  // balance by hand — one mechanism instead of two that can disagree.
  if (!user || !isBilled()) return { charged: false, frozen: false, balanceMicroUsd: user?.balanceMicroUsd ?? 0 }

  const now = new Date()
  // Not due yet: the cycle runs from the top-up date, so a user who paid on the
  // 15th is billed on the 15th, not dragged to the calendar 1st.
  if (user.nextChargeAt && now < user.nextChargeAt) {
    return { charged: false, frozen: !!user.frozenAt, balanceMicroUsd: user.balanceMicroUsd }
  }

  const bill = await monthlyBill(prisma, userId)
  if (bill.totalMicroUsd <= 0) return { charged: false, frozen: false, balanceMicroUsd: user.balanceMicroUsd }

  // The due date being settled (the anchor for this cycle's idempotency key).
  const due = user.nextChargeAt ?? now

  let balance = user.balanceMicroUsd
  try {
    await prisma.$transaction(async (tx) => {
      await tx.walletTransaction.create({
        data: {
          userId, kind: 'subscription',
          amountMicroUsd: -bill.totalMicroUsd,
          status: 'completed',
          orderId: cycleOrderId(userId, due),
          note: `${due.toISOString().slice(0, 10)}: base ${usd(bill.baseMicroUsd)}`
            + (bill.packs ? ` · ${bill.packs} × ${config.STORAGE_PACK_MB} MB` : ''),
          settledAt: now,
        },
      })
      const u = await tx.user.update({
        where: { id: userId },
        // Advance the cycle from the due date (not `now`), so a late cron does
        // not push the anchor forward and quietly skip a month.
        data: { balanceMicroUsd: { decrement: bill.totalMicroUsd }, nextChargeAt: addMonth(due) },
        select: { balanceMicroUsd: true },
      })
      balance = u.balanceMicroUsd
    })
  } catch {
    // Unique orderId → already charged for this cycle. Not an error.
    return { charged: false, frozen: !!user.frozenAt, balanceMicroUsd: user.balanceMicroUsd }
  }

  // An empty balance blocks writing until he tops up. Reading, search and
  // export keep working — nobody loses their notes over a lapsed balance.
  const frozen = await syncFreeze(prisma, userId)
  return { charged: true, frozen, balanceMicroUsd: balance }
}

/**
 * Bring a user's frozen state in line with his balance, on a billing instance.
 * Empty (≤0) freezes writing; positive lifts it. Called after every balance
 * move — a token debit, a top-up, an admin adjustment — so the redis cache the
 * write-guard reads is always current. The operator (OWNER/ADMIN) is never
 * frozen: he could not unfreeze himself.
 *
 * Returns whether the account is frozen afterwards.
 */
export async function syncFreeze(prisma: PrismaClient, userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId }, select: { role: true, balanceMicroUsd: true, frozenAt: true },
  })
  if (!u) return false

  if (!isBilled() || roleIsUnlimited(u.role)) {
    if (u.frozenAt) { await prisma.user.update({ where: { id: userId }, data: { frozenAt: null } }).catch(() => null); await clearFrozen(userId) }
    return false
  }

  const broke = u.balanceMicroUsd <= 0
  if (broke && !u.frozenAt) {
    await prisma.user.update({ where: { id: userId }, data: { frozenAt: new Date() } }).catch(() => null)
    await markFrozen(userId)
    return true
  }
  if (!broke && u.frozenAt) {
    await prisma.user.update({ where: { id: userId }, data: { frozenAt: null } }).catch(() => null)
    await clearFrozen(userId)
    console.log(`[subscription] unfroze ${userId} at ${usd(u.balanceMicroUsd)}`)
    return false
  }
  return !!u.frozenAt
}

/** Back-compat name for callers that only ever meant "recompute after money in". */
export const unfreezeIfPaid = syncFreeze

/** At startup: freeze every billed account already at ≤0, so an instance that
 *  just turned billing on catches its existing debtors, not only new ones. */
export async function freezeExistingDebtors(prisma: PrismaClient): Promise<number> {
  if (!isBilled()) return 0
  const debtors = await prisma.user.findMany({
    where: { balanceMicroUsd: { lte: 0 }, frozenAt: null, role: { notIn: ['OWNER', 'ADMIN'] } },
    select: { id: true },
  })
  for (const d of debtors) {
    await prisma.user.update({ where: { id: d.id }, data: { frozenAt: new Date() } }).catch(() => null)
    await markFrozen(d.id)
  }
  if (debtors.length) console.log(`[subscription] froze ${debtors.length} existing debtor(s)`)
  return debtors.length
}

export const billSummary = (b: MonthlyBill): string =>
  `$${fromMicroUsd(b.totalMicroUsd).toFixed(2)}`

/**
 * Charge whatever is owed right now — called the moment money arrives, so a
 * top-up settles the bill before the daily cron ever wakes up. Idempotent:
 * the unique orderId makes a second call for the same month a no-op.
 */
export async function settleDue(prisma: PrismaClient, userId: string): Promise<void> {
  if (!isBilled()) return
  await chargeMonth(prisma, userId).catch((e) => console.error('[subscription] settleDue', userId, e))
}
