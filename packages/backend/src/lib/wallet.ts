// ─── Wallet ───────────────────────────────────────────────────────────────────
// Only managed-model tokens draw on the balance. A BYOK user pays his provider
// directly and never touches this file.
//
// Two guards exist because they fail differently:
//   • empty balance  — the user knows he spent it, and we offer him his own key;
//   • monthly cap    — the user does NOT know, because a looping agent spent it
//     for him overnight. A tool loop that re-triggers itself can burn a month's
//     budget in an hour, and a chargeback costs more than the tokens.
import type { PrismaClient } from '@prisma/client'
import { config } from '../config/index.js'
import { toMicroUsd, fromMicroUsd, usd, type MicroUsd } from './pricing.js'
import { unfreezeIfPaid, settleDue } from './subscription.js'

export const signupGrantMicroUsd = (): MicroUsd => toMicroUsd(config.WALLET_SIGNUP_GRANT_USD)
export const monthlyCapMicroUsd = (): MicroUsd => toMicroUsd(config.WALLET_MONTHLY_CAP_USD)

/** The cap that applies to THIS user: his own if he set one, else the default. */
export async function userMonthlyCapMicroUsd(prisma: PrismaClient, userId: string): Promise<MicroUsd> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { monthlyCapMicroUsd: true } })
  return u?.monthlyCapMicroUsd ?? monthlyCapMicroUsd()
}
export const lowBalanceMicroUsd = (): MicroUsd => toMicroUsd(config.WALLET_LOW_BALANCE_USD)

export interface SpendCheck {
  ok: boolean
  /** `unfunded` never had money; `empty` spent it. The same wall, but the first
   *  needs an explanation and the second needs a reminder. */
  reason?: 'unfunded' | 'empty' | 'monthly_cap'
  balanceMicroUsd: MicroUsd
  spentThisMonthMicroUsd: MicroUsd
}

const monthStart = (): Date => {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

/** How much the user has been charged for managed tokens this calendar month. */
export async function spentThisMonth(prisma: PrismaClient, userId: string): Promise<MicroUsd> {
  const agg = await prisma.aiUsage.aggregate({
    where: { userId, managed: true, createdAt: { gte: monthStart() } },
    _sum: { chargedMicroUsd: true },
  })
  return agg._sum.chargedMicroUsd ?? 0
}

/**
 * May this user run an answer on our key right now? Checked BEFORE the request,
 * because the cheapest way to not pay for a runaway agent is to not call the
 * model.
 */
export async function canSpend(prisma: PrismaClient, userId: string | undefined): Promise<SpendCheck> {
  if (!userId) return { ok: false, reason: 'unfunded', balanceMicroUsd: 0, spentThisMonthMicroUsd: 0 }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { balanceMicroUsd: true, monthlyCapMicroUsd: true } })
  const balance = user?.balanceMicroUsd ?? 0
  const spent = await spentThisMonth(prisma, userId)
  const cap = user?.monthlyCapMicroUsd ?? monthlyCapMicroUsd()

  if (spent >= cap) {
    return { ok: false, reason: 'monthly_cap', balanceMicroUsd: balance, spentThisMonthMicroUsd: spent }
  }
  if (balance <= 0) {
    // Never funded vs spent it all: the wall is the same, the sentence is not.
    const everPaid = await prisma.walletTransaction.count({
      where: { userId, status: 'completed', amountMicroUsd: { gt: 0 } },
    })
    return {
      ok: false,
      reason: everPaid > 0 ? 'empty' : 'unfunded',
      balanceMicroUsd: balance,
      spentThisMonthMicroUsd: spent,
    }
  }
  return { ok: true, balanceMicroUsd: balance, spentThisMonthMicroUsd: spent }
}

/**
 * Take money for one answer. The balance may go slightly negative: the cost is
 * only known once the answer is finished, and cutting a reply mid-sentence to
 * save a tenth of a cent would be absurd. The pre-flight check keeps the
 * overdraft to at most one answer.
 */
export async function debit(prisma: PrismaClient, userId: string, amount: MicroUsd): Promise<MicroUsd | null> {
  if (amount <= 0) return null
  try {
    const u = await prisma.user.update({
      where: { id: userId },
      data: { balanceMicroUsd: { decrement: amount } },
      select: { balanceMicroUsd: true },
    })
    return u.balanceMicroUsd
  } catch (e) {
    console.error('[wallet] debit failed', userId, (e as Error).message)
    return null
  }
}

export interface CreditOptions {
  kind: 'topup' | 'grant' | 'adjust' | 'refund'
  note?: string
  paymentId?: string
  orderId?: string
}

/**
 * Put money in. The transaction row and the balance move together, so a crash
 * between them cannot leave a paid-but-not-credited user.
 */
export async function credit(
  prisma: PrismaClient,
  userId: string,
  amount: MicroUsd,
  opts: CreditOptions,
): Promise<boolean> {
  if (amount <= 0) return false
  try {
    await prisma.$transaction([
      prisma.walletTransaction.create({
        data: {
          userId, kind: opts.kind, amountMicroUsd: amount, status: 'completed',
          paymentId: opts.paymentId ?? null, orderId: opts.orderId ?? null,
          note: opts.note ?? null, settledAt: new Date(),
        },
      }),
      prisma.user.update({ where: { id: userId }, data: { balanceMicroUsd: { increment: amount } } }),
    ])
    return true
  } catch (e) {
    // A duplicate paymentId lands here: the webhook was replayed, and the money
    // is already in. That is a success, not a failure.
    const msg = (e as Error).message
    if (msg.includes('Unique constraint')) {
      console.warn('[wallet] duplicate credit ignored', opts.paymentId ?? opts.orderId)
      return false
    }
    console.error('[wallet] credit failed', userId, msg)
    return false
  }
}

/**
 * Settle a top-up that was written as `pending` before the user paid.
 *
 * The SAME row is completed — not a second one — or the ledger would show the
 * money twice while the balance moved once. `paymentId` is unique, so a replayed
 * webhook fails the write instead of crediting again.
 */
export async function settleTopup(prisma: PrismaClient, orderId: string, paymentId: string): Promise<boolean> {
  let userId: string | null = null
  try {
    await prisma.$transaction(async (tx) => {
      // Credit any top-up that is not already settled — including one we expired
      // to `failed` after 15 minutes. Crypto can confirm late; a payment made
      // against a stale invoice is still the user's money, so it must land.
      const row = await tx.walletTransaction.findUnique({ where: { orderId } })
      if (!row || row.kind !== 'topup' || row.status === 'completed') {
        throw new Error('topup not creditable')
      }
      await tx.walletTransaction.update({
        where: { orderId },
        data: { status: 'completed', paymentId, settledAt: new Date() },
      })
      const u = await tx.user.update({
        where: { id: row.userId },
        data: { balanceMicroUsd: { increment: row.amountMicroUsd } },
        select: { id: true },
      })
      userId = u.id
    })
    // Money in → take what is owed, then let him back in. The other order would
    // unfreeze an account that still cannot pay for the month it is in.
    if (userId) {
      await settleDue(prisma, userId).catch(() => {})
      await unfreezeIfPaid(prisma, userId).catch(() => false)
    }
    return true
  } catch (e) {
    const msg = (e as Error).message
    // Either the row was already settled (replay) or the payment id is a
    // duplicate. Both mean the money is already in; neither is an error.
    console.warn('[wallet] settleTopup no-op', orderId, msg.slice(0, 120))
    return false
  }
}

/** How long an unpaid top-up invoice stays live before it is written off. */
export const TOPUP_TTL_MIN = 15

/**
 * Expire top-up intents that were created but never paid within the window.
 * They become `failed` (not deleted) so a late payment can still be credited by
 * settleTopup — but they stop hanging in the wallet as a permanent "pending".
 * Returns how many were expired.
 */
export async function expireStalePendingTopups(prisma: PrismaClient): Promise<number> {
  const cutoff = new Date(Date.now() - TOPUP_TTL_MIN * 60_000)
  const res = await prisma.walletTransaction.updateMany({
    where: { kind: 'topup', status: 'pending', createdAt: { lt: cutoff } },
    data: { status: 'failed' },
  })
  return res.count
}

/**
 * Admin correction, in either direction. A wallet you cannot fix by hand is a
 * wallet you cannot operate: refunds, goodwill credits, and clawing back a
 * mistaken grant all land here. The ledger row keeps the sign, so history stays
 * readable — `adjust -5.00` is a story, `topup 5.00` next to `refund 5.00` is a
 * puzzle.
 */
export async function adjust(
  prisma: PrismaClient,
  userId: string,
  signedAmount: MicroUsd,
  note: string,
): Promise<number | null> {
  if (!Number.isInteger(signedAmount) || signedAmount === 0) return null
  try {
    let balance = 0
    await prisma.$transaction(async (tx) => {
      await tx.walletTransaction.create({
        data: {
          userId, kind: signedAmount > 0 ? 'adjust' : 'refund',
          amountMicroUsd: signedAmount, status: 'completed',
          note, settledAt: new Date(),
        },
      })
      const u = await tx.user.update({
        where: { id: userId },
        data: { balanceMicroUsd: { increment: signedAmount } },
        select: { balanceMicroUsd: true },
      })
      balance = u.balanceMicroUsd
    })
    if (signedAmount > 0) {
      await settleDue(prisma, userId).catch(() => {})
      await unfreezeIfPaid(prisma, userId).catch(() => false)
    }
    return balance
  } catch (e) {
    console.error('[wallet] adjust failed', userId, (e as Error).message)
    return null
  }
}

export { usd } from './pricing.js'

/** The message the agent sends instead of an answer when the wallet says no. */
export function refusalText(check: SpendCheck, lang: 'ru' | 'en' | 'be'): string {
  if (check.reason === 'monthly_cap') {
    const cap = usd(monthlyCapMicroUsd())
    return {
      ru: `🛑 Достигнут месячный лимит расходов (${cap}). Это защита от зациклившегося агента, а не отказ. Поднимите лимит в настройках или подключите свой ключ — тогда токены оплачиваете вы напрямую.`,
      en: `🛑 The monthly spend cap (${cap}) has been reached. It is a guard against a looping agent, not a refusal. Raise it in settings, or connect your own key and pay your provider directly.`,
      be: `🛑 Дасягнуты месячны ліміт выдаткаў (${cap}). Гэта абарона ад зацыкленага агента. Падыміце ліміт у наладах або падключыце свой ключ.`,
    }[lang]
  }
  if (check.reason === 'unfunded') {
    return {
      ru: '🔑 Встроенная модель работает с баланса, а он пуст. Есть два пути: пополнить баланс — или бесплатно подключить свой ключ в Настройки → AI Ассистент, тогда за токены вы платите провайдеру напрямую, без наценки.',
      en: '🔑 The built-in model runs on your balance, and it is empty. Two ways forward: top it up — or connect your own key for free in Settings → AI Assistant and pay your provider directly, with no markup.',
      be: '🔑 Убудаваная мадэль працуе з балансу, а ён пусты. Два шляхі: папоўніць баланс — або бясплатна падключыць свой ключ у Налады → AI Асістэнт.',
    }[lang]
  }
  return {
    ru: '💳 Баланс закончился. Пополните его — или подключите свой ключ в Настройки → AI Ассистент, и платите провайдеру напрямую, без наценки.',
    en: '💳 Your balance is empty. Top it up — or connect your own key in Settings → AI Assistant and pay your provider directly, with no markup.',
    be: '💳 Баланс скончыўся. Папоўніце яго — або падключыце свой ключ у Налады → AI Асістэнт і плаціце правайдэру напрамую.',
  }[lang]
}
