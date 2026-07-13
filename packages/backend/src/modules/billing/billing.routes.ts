import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { config } from '../../config/index.js'
import { createInvoice, isNowPaymentsConfigured, verifyIpnSignature } from '../../lib/nowpayments.js'
import { issueLicenseKey, type LicensePlan } from '../../lib/license.js'
import { sendLicenseKeyEmail, isEmailConfigured } from '../../lib/email.js'
import { redis } from '../../lib/redis.js'
import { settleTopup, spentThisMonth, monthlyCapMicroUsd, lowBalanceMicroUsd, adjust, expireStalePendingTopups } from '../../lib/wallet.js'
import { toMicroUsd, fromMicroUsd, MODEL_PRICES, margin } from '../../lib/pricing.js'
import { getManagedAi } from '../../lib/managed.js'
import { effectiveStorageMb, getPlanLimits } from '../../lib/plans.js'
import { monthlyBill } from '../../lib/subscription.js'
import { isBillingEnabled } from '../../lib/billingMode.js'


// LicenseKey.note format used to record the NOWPayments payment id for
// idempotency. Lets us safely retry IPN deliveries without issuing
// duplicate keys.
const NOTE_PREFIX = 'nowpayments:'

// Redis key holding the buyer's email + plan for an order, so the webhook can
// reliably reach the right address even if NOWPayments doesn't echo
// customer_email back in the IPN. Invoices are short-lived; 30d TTL is ample.
const orderKey = (orderId: string) => `billing:order:${orderId}`
const ORDER_TTL_SEC = 60 * 60 * 24 * 30

// Crypto acquiring has network fees and minimum amounts: a $1 top-up is eaten
// by the fee. Money comes in ahead and is spent over months.
const MIN_TOPUP_USD = 15

/** What the assistant actually did this month, and what it cost. Cheap enough to
 *  compute on every settings visit: one grouped aggregate over an indexed range. */
async function monthStats(prisma: PrismaClient, userId: string) {
  const now = new Date()
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const agg = await prisma.aiUsage.aggregate({
    where: { userId, createdAt: { gte: since } },
    _sum: {
      inputTokens: true, cachedInputTokens: true, outputTokens: true,
      calls: true, chargedMicroUsd: true,
    },
    _count: { _all: true },
  })

  const input = agg._sum.inputTokens ?? 0
  const cached = agg._sum.cachedInputTokens ?? 0

  return {
    answers: agg._count._all,
    calls: agg._sum.calls ?? 0,
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: agg._sum.outputTokens ?? 0,
    // The share served from the provider's cache. It explains the bill better
    // than any other number: a cache hit costs a fraction of a miss.
    cacheSharePct: input + cached > 0 ? Math.round((cached / (input + cached)) * 100) : 0,
    tokensCostUsd: fromMicroUsd(agg._sum.chargedMicroUsd ?? 0),
  }
}

/** Everything the UI needs to show a storage bar and an honest "buy" button. */
async function storageState(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { storagePacks: true, storageLimitMb: true, plan: true, licenseExpiresAt: true },
  })
  const workspaceIds = (await prisma.workspaceMember.findMany({
    where: { userId, role: 'OWNER' }, select: { workspaceId: true },
  })).map((m) => m.workspaceId)

  const usedBytes = workspaceIds.length
    ? Number((await prisma.attachment.aggregate({
        where: { workspaceId: { in: workspaceIds } }, _sum: { size: true },
      }))._sum.size ?? 0)
    : 0

  const planLimits = await getPlanLimits(prisma, user?.plan ?? 'free')
  const packs = user?.storagePacks ?? 0
  const limitMb = user
    ? effectiveStorageMb({ storageLimitMb: user.storageLimitMb, storagePacks: packs }, planLimits.storageMb)
    : planLimits.storageMb

  return {
    usedMb: Math.round(usedBytes / 1024 / 1024),
    limitMb,
    freeMb: planLimits.storageMb,
    packs,
    packMb: config.STORAGE_PACK_MB,
    packPriceUsd: config.PRICE_STORAGE_PACK_USD,
  }
}

export async function billingRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // ── POST /billing/invoice ────────────────────────────────────────────
  // Public: starts a crypto checkout for the requested plan.
  // Body: { plan: 'team', email: string }
  // Returns: { invoiceUrl: string, orderId: string }
  app.post('/billing/invoice', async (req, reply) => {
    if (!isNowPaymentsConfigured()) {
      return reply.status(503).send({ error: 'Crypto billing is not configured on this instance' })
    }
    const body = z.object({
      plan: z.literal('team'),  // Team is the only sold licence; business is contact-only
      email: z.string().email(),
    }).parse(req.body)

    const orderId = `sx-${body.plan}-${randomUUID()}`
    const appUrl = config.APP_URL ?? 'http://localhost:3012'
    const priceAmount = config.PRICE_TEAM_USD

    try {
      const invoice = await createInvoice({
        priceAmount,
        priceCurrency: 'usd',
        orderId,
        orderDescription: 'SinoutX Team Licence (perpetual, one year of updates)',
        ipnCallbackUrl: `${appUrl}/api/v1/billing/webhook`,
        successUrl: `${appUrl}/buy?order=${orderId}`,
        cancelUrl: `${appUrl}/buy?plan=${body.plan}&cancelled=1`,
        customerEmail: body.email,
      })
      // Remember who bought what — webhook looks this up by order_id.
      await redis.set(orderKey(orderId), JSON.stringify({ email: body.email, plan: body.plan }), 'EX', ORDER_TTL_SEC)
        .catch((err) => req.log.warn({ err }, 'failed to cache billing order email'))
      return reply.send({ invoiceUrl: invoice.invoice_url, orderId })
    } catch (err) {
      req.log.error({ err }, 'NOWPayments invoice creation failed')
      return reply.status(502).send({ error: 'Failed to create invoice' })
    }
  })

  // ── GET /wallet ──────────────────────────────────────────────────────
  // Balance, the credit ledger, and how close the user is to the monthly cap.
  app.get('/wallet', async (req, reply) => {
    const userId = req.authUser!.id
    // Write off unpaid invoices older than the window first, so the history the
    // user is about to read is already free of a stale "pending".
    await expireStalePendingTopups(prisma).catch(() => 0)
    const [user, tx, spent] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { balanceMicroUsd: true, monthlyCapMicroUsd: true, nextChargeAt: true } }),
      prisma.walletTransaction.findMany({
        // Hide expired/failed top-up intents — an abandoned invoice is noise, not
        // history. Real charges and completed top-ups stay.
        where: { userId, NOT: { kind: 'topup', status: 'failed' } },
        orderBy: { createdAt: 'desc' }, take: 20,
        select: { id: true, kind: true, amountMicroUsd: true, status: true, note: true, createdAt: true },
      }),
      spentThisMonth(prisma, userId),
    ])
    // Everyone on a billing instance pays. `billed` is what the UI gates the
    // managed model on: no balance, no built-in model.
    const cloud = isBillingEnabled()
    const billed = cloud

    const [storage, bill, stats] = await Promise.all([
      storageState(prisma, userId),
      cloud ? monthlyBill(prisma, userId) : null,
      monthStats(prisma, userId),
    ])

    // What the built-in ("SinoutX") model costs the user, per 1M tokens, with our
    // margin already applied — the number he actually pays. Model name stays
    // hidden; only the price is shown. Null when no managed model is priced.
    const managedModel = getManagedAi()?.model
    const mp = managedModel ? MODEL_PRICES()[managedModel] : undefined
    const tokenPricing = mp
      ? { inPerMTokUsd: mp.input * margin(), outPerMTokUsd: mp.output * margin() }
      : null

    return reply.send({
      balanceUsd: fromMicroUsd(user?.balanceMicroUsd ?? 0),
      spentThisMonthUsd: fromMicroUsd(spent),
      monthlyCapUsd: fromMicroUsd(user?.monthlyCapMicroUsd ?? monthlyCapMicroUsd()),
      monthlyCapDefaultUsd: fromMicroUsd(monthlyCapMicroUsd()),
      nextChargeAt: user?.nextChargeAt ?? null,
      lowBalanceUsd: fromMicroUsd(lowBalanceMicroUsd()),
      minTopUpUsd: MIN_TOPUP_USD,
      topUpAvailable: isNowPaymentsConfigured(),
      cloud,
      billed,
      // The tariff, spelled out: the monthly subscription, the per-token price of
      // the built-in model, and the storage-pack price. One block, no surprises.
      tariff: {
        baseUsd: config.PRICE_CLOUD_BASE_USD,
        tokensInPerMUsd: tokenPricing?.inPerMTokUsd ?? null,
        tokensOutPerMUsd: tokenPricing?.outPerMTokUsd ?? null,
        packMb: config.STORAGE_PACK_MB,
        packPriceUsd: config.PRICE_STORAGE_PACK_USD,
      },
      storage,
      // What the next monthly charge will look like, itemised. The user should
      // read his bill before it happens, not discover it on the 1st.
      upcoming: bill && {
        baseUsd: fromMicroUsd(bill.baseMicroUsd),
        storageUsd: fromMicroUsd(bill.storageMicroUsd),
        totalUsd: fromMicroUsd(bill.totalMicroUsd),
        packs: bill.packs,
      },
      stats,
      transactions: tx.map((t) => ({ ...t, amountUsd: fromMicroUsd(t.amountMicroUsd) })),
    })
  })

  // ── GET /wallet/topup-status/:orderId ────────────────────────────────
  // Crypto redirects the user back before the IPN necessarily lands. The wallet
  // page polls this to learn when the balance was credited and the freeze lifted,
  // so it refreshes itself instead of showing a stale "frozen" until an F5.
  app.get('/wallet/topup-status/:orderId', async (req, reply) => {
    const { orderId } = req.params as { orderId: string }
    const userId = req.authUser!.id
    const [tx, user] = await Promise.all([
      // Scope by userId too: an orderId is not a capability, so nobody probes
      // someone else's payment through this.
      prisma.walletTransaction.findFirst({ where: { orderId, userId }, select: { status: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { balanceMicroUsd: true, frozenAt: true } }),
    ])
    return reply.send({
      status: tx?.status === 'completed' ? 'completed' : 'pending',
      balanceUsd: fromMicroUsd(user?.balanceMicroUsd ?? 0),
      frozen: !!user?.frozenAt,
    })
  })

  // ── POST /wallet/storage-packs ───────────────────────────────────────
  // Storage is bought, never metered into a surprise. `packs` is the absolute
  // number the user wants to hold; the delta is charged (or released) at once.
  app.post('/wallet/storage-packs', async (req, reply) => {
    if (!isBillingEnabled()) {
      return reply.status(400).send({ error: 'This instance does not bill for storage' })
    }
    const body = z.object({ packs: z.number().int().min(0).max(200) }).parse(req.body)
    const userId = req.authUser!.id

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { storagePacks: true, balanceMicroUsd: true, storageLimitMb: true },
    })
    if (!user) return reply.status(404).send({ error: 'Not found' })

    const delta = body.packs - user.storagePacks
    if (delta === 0) return reply.send({ packs: body.packs })

    if (delta > 0) {
      // The pack is paid for the moment it is taken. Charging only at the end of
      // the month would let a user buy space, fill it, and drop the pack before
      // the bill runs.
      const cost = toMicroUsd(delta * config.PRICE_STORAGE_PACK_USD)
      if (user.balanceMicroUsd < cost) {
        return reply.status(402).send({
          error: 'insufficient_balance',
          neededUsd: fromMicroUsd(cost),
          balanceUsd: fromMicroUsd(user.balanceMicroUsd),
        })
      }
      const left = await adjust(prisma, userId, -cost, `storage: +${delta} × ${config.STORAGE_PACK_MB} MB`)
      if (left === null) return reply.status(500).send({ error: 'charge failed' })
    } else {
      // Releasing a pack must not leave the user above his own limit: the files
      // are already on our disk, and we are not going to delete them for him.
      const state = await storageState(prisma, userId)
      const newLimitMb = state.freeMb + body.packs * config.STORAGE_PACK_MB
      if (state.usedMb > newLimitMb) {
        return reply.status(400).send({
          error: 'storage_in_use',
          usedMb: state.usedMb,
          wouldBeLimitMb: newLimitMb,
        })
      }
      // No refund for the current month — the disk was held. Freeing it just
      // stops the next bill.
    }

    await prisma.user.update({ where: { id: userId }, data: { storagePacks: body.packs } })
    return reply.send({ packs: body.packs, storage: await storageState(prisma, userId) })
  })

  // ── POST /billing/topup ──────────────────────────────────────────────
  // Starts a crypto checkout that lands on the wallet. The intent is written to
  // the DB as `pending` BEFORE the user pays: crypto confirmations can outlive
  // any cache, and money paid against a forgotten intent is money stolen.
  app.post('/billing/topup', async (req, reply) => {
    if (!isNowPaymentsConfigured()) {
      return reply.status(503).send({ error: 'Crypto billing is not configured on this instance' })
    }
    const body = z.object({ amountUsd: z.number().min(MIN_TOPUP_USD).max(1000) }).parse(req.body)
    const userId = req.authUser!.id
    const orderId = `sx-topup-${randomUUID()}`
    const appUrl = config.APP_URL ?? 'http://localhost:3012'

    await prisma.walletTransaction.create({
      data: {
        userId, kind: 'topup', amountMicroUsd: toMicroUsd(body.amountUsd),
        status: 'pending', orderId, note: `top-up $${body.amountUsd}`,
      },
    })

    try {
      const invoice = await createInvoice({
        priceAmount: body.amountUsd,
        priceCurrency: 'usd',
        orderId,
        orderDescription: `SinoutX wallet top-up ($${body.amountUsd})`,
        ipnCallbackUrl: `${appUrl}/api/v1/billing/webhook`,
        successUrl: `${appUrl}/billing?topup=${orderId}`,
        cancelUrl: `${appUrl}/billing?cancelled=1`,
        customerEmail: req.authUser!.email,
      })
      return reply.send({ invoiceUrl: invoice.invoice_url, orderId })
    } catch (err) {
      await prisma.walletTransaction.update({ where: { orderId }, data: { status: 'failed' } }).catch(() => null)
      req.log.error({ err }, 'NOWPayments top-up invoice failed')
      return reply.status(502).send({ error: 'Failed to create invoice' })
    }
  })

  // ── POST /wallet/cap ─────────────────────────────────────────────────
  // The user sets his own monthly spend cap on the built-in model. Null resets
  // it to the instance default. The cap protects HIM (a runaway agent), so it is
  // his to move.
  app.post('/wallet/cap', async (req, reply) => {
    const body = z.object({ capUsd: z.number().min(0).max(10000).nullable() }).parse(req.body)
    await prisma.user.update({
      where: { id: req.authUser!.id },
      data: { monthlyCapMicroUsd: body.capUsd == null ? null : toMicroUsd(body.capUsd) },
    })
    return reply.send({ capUsd: body.capUsd ?? fromMicroUsd(monthlyCapMicroUsd()) })
  })

  // ── POST /billing/webhook ────────────────────────────────────────────
  // Public: NOWPayments IPN callback. HMAC-SHA512 verified.
  // On `payment_status === 'finished'`, issue a license key, store the
  // payment_id for idempotency, and email the key to the buyer.
  app.post('/billing/webhook', async (req, reply) => {
    const signature = req.headers['x-nowpayments-sig'] as string | undefined
    const body = req.body as Record<string, unknown>

    if (!verifyIpnSignature(body, signature)) {
      req.log.warn('NOWPayments IPN signature verification failed')
      return reply.status(401).send({ error: 'invalid signature' })
    }

    const paymentId = String(body.payment_id ?? '')
    const status = String(body.payment_status ?? '')
    const orderId = String(body.order_id ?? '')

    // Only act on terminal-success states. NOWPayments uses 'finished' for
    // fully-confirmed payments; 'partially_paid' or others we ignore.
    if (status !== 'finished') {
      return reply.send({ ok: true, ignored: true, status })
    }

    if (!paymentId) {
      return reply.status(400).send({ error: 'missing payment_id' })
    }

    // ── Wallet top-up ──────────────────────────────────────────────────
    // A top-up and a license purchase arrive on the same IPN endpoint; the
    // order id says which. Without this branch a top-up would be handed a
    // license key instead of a balance.
    if (orderId.startsWith('sx-topup-')) {
      const intent = await prisma.walletTransaction.findUnique({ where: { orderId } })
      if (!intent) {
        req.log.error({ orderId }, 'top-up IPN for an unknown order')
        return reply.status(404).send({ error: 'unknown order' })
      }
      if (intent.status === 'completed') {
        return reply.send({ ok: true, alreadyCredited: true }) // replayed IPN
      }

      // Completes the SAME row and moves the balance in one transaction.
      const ok = await settleTopup(prisma, orderId, paymentId)

      req.log.info({ orderId, userId: intent.userId, ok }, 'wallet topped up')
      return reply.send({ ok: true, credited: ok })
    }

    // Recover the buyer's email from what we cached at checkout — this is
    // authoritative (the email they typed on /buy). Fall back to whatever
    // NOWPayments echoes in the IPN, which isn't guaranteed to be present.
    let cachedEmail: string | null = null
    try {
      const raw = orderId ? await redis.get(orderKey(orderId)) : null
      if (raw) cachedEmail = (JSON.parse(raw) as { email?: string }).email?.trim() || null
    } catch (err) {
      req.log.warn({ err }, 'failed to read cached billing order')
    }
    const customerEmail = cachedEmail
      ?? (String((body.customer_email ?? body.payer_email ?? '')).trim() || null)

    // Idempotency: skip if we've already issued a key for this payment.
    const noteMarker = `${NOTE_PREFIX}${paymentId}`
    const existing = await prisma.licenseKey.findFirst({ where: { note: { contains: noteMarker } } })
    if (existing) {
      return reply.send({ ok: true, alreadyIssued: true, key: existing.key })
    }

    // Plan: prefer the cached plan, else derive from the order_id prefix.
    const plan: LicensePlan = orderId.startsWith('sx-business-') ? 'business' : 'team'

    // Both licences are PERPETUAL: the payment buys a year of updates, not the
    // right to keep running what you already have. An expiry date here would
    // silently drop a paying customer back to free after twelve months.
    const expiresAt = null

    const license = await issueLicenseKey(prisma, {
      plan,
      email: customerEmail,
      note: `${noteMarker} order=${orderId}`,
      expiresAt,
    })

    if (customerEmail && await isEmailConfigured(prisma)) {
      const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
      const appUrl = settings?.appUrl ?? config.APP_URL ?? 'http://localhost:3012'
      sendLicenseKeyEmail(customerEmail, {
        licenseKey: license.key,
        plan: license.plan,
        appUrl,
        expiresAt,
      }, prisma).catch((err) => req.log.error({ err }, 'license email failed'))
    }

    // Order fulfilled — drop the cached email so it can't be reused.
    if (orderId) redis.del(orderKey(orderId)).catch(() => {})

    return reply.send({ ok: true, issued: true })
  })

  // ── GET /billing/order/:orderId ──────────────────────────────────────
  // Public: the success page polls this to show the key on screen as soon as
  // the IPN webhook has issued it (no dependency on email delivery).
  app.get('/billing/order/:orderId', async (req, reply) => {
    const { orderId } = z.object({ orderId: z.string() }).parse(req.params)
    const lic = await prisma.licenseKey.findFirst({ where: { note: { contains: `order=${orderId}` } }, select: { key: true, plan: true } })
    if (!lic) return reply.send({ status: 'pending' as const })
    return reply.send({ status: 'ready' as const, key: lic.key, plan: lic.plan })
  })
}
