import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import speakeasy from 'speakeasy'
import QRCode from 'qrcode'
import { hashPassword, verifyPassword, generateApiKey } from '../../lib/auth.js'
import { createAuthMiddleware } from '../../middleware/authenticate.js'
import { provisionPersonalWorkspace } from '../../lib/personal.js'
import { redis } from '../../lib/redis.js'
import { sendPasswordResetEmail, sendVerificationEmail, isEmailConfigured } from '../../lib/email.js'
import { writeAuditLog } from '../../lib/audit.js'
import { credit, signupGrantMicroUsd } from '../../lib/wallet.js'
import { isBillingEnabled } from '../../lib/billingMode.js'
import { isSoloEdition } from '../../lib/edition.js'
import { findUsableInvite, redeemInvitesFor } from '../../lib/invites.js'
import { markFrozen } from '../../lib/frozen.js'
import { config } from '../../config/index.js'

// Brute-force lockout for /auth/login
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_LOCK_WINDOW_SEC = 15 * 60

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  inviteCode: z.string().optional(),
  /** Personal invitation token from a colleague's email — see lib/invites.ts. */
  invite: z.string().optional(),
})

export async function authRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const authenticate = createAuthMiddleware(prisma)

  // POST /auth/register — создать первого пользователя (только если нет ни одного)
  app.post('/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = registerSchema.parse(req.body)

    const userCount = await prisma.user.count()

    // Solo edition = один человек: после владельца регистрация закрыта наглухо.
    if (userCount > 0 && isSoloEdition()) {
      // Even a valid invitation stops here: the solo edition is one person by
      // definition, and a second account would quietly make it something else.
      return reply.status(403).send({ error: 'Registration is closed' })
    }

    // A personal invitation is permission to register — and nothing more. It is
    // checked before the instance-wide mode, because a closed instance is
    // exactly where an invited colleague would otherwise be stuck.
    const invite = body.invite ? await findUsableInvite(prisma, body.invite) : null
    if (body.invite && !invite) {
      return reply.status(403).send({ error: 'Invitation is invalid or expired' })
    }
    if (invite && invite.email !== body.email.trim().toLowerCase()) {
      return reply.status(403).send({ error: 'This invitation was sent to a different email' })
    }

    // Первый пользователь всегда может зарегистрироваться
    if (userCount > 0 && !invite) {
      // Читаем режим регистрации из БД (fallback на env для обратной совместимости)
      const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
      const mode = settings?.registrationMode ?? (process.env.INVITE_CODE ? 'invite' : 'open')

      if (mode === 'closed') {
        return reply.status(403).send({ error: 'Registration is closed' })
      }
      if (mode === 'invite') {
        const inviteCode = settings?.inviteCode ?? process.env.INVITE_CODE
        if (!inviteCode || body.inviteCode !== inviteCode) {
          return reply.status(403).send({ error: 'Invite code required' })
        }
      }
      // mode === 'open' — разрешаем без кода
    }

    const existing = await prisma.user.findUnique({ where: { email: body.email } })
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' })
    }

    const passwordHash = await hashPassword(body.password)
    const isFirst = userCount === 0
    const emailConfigured = await isEmailConfigured(prisma)
    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash,
        role: isFirst ? 'OWNER' : 'MEMBER',
        isVerified: !emailConfigured,
      },
    })

    // Single-workspace model: EVERY user gets their own Personal workspace
    // (memory, personal modules, settings live here). Collaboration is via
    // sharing projects, not extra workspaces.
    await provisionPersonalWorkspace(prisma, user.id)

    // Now, and only now, the invitations become access. Each is re-checked
    // against the plan: invitations sent while a seat was free do not all land
    // if it has since been taken.
    // Every pending invitation for this address, not just the one in the link:
    // someone may have been invited twice, or have signed up on their own.
    const redeemed = await redeemInvitesFor(prisma, user.id, user.email).catch(() => [])
    const joined = redeemed.filter((r) => r.granted).length
    const refused = redeemed.length - joined

    // A grant, if the operator chose to give one (zero by default).
    if (config.WALLET_SIGNUP_GRANT_USD > 0) {
      await credit(prisma, user.id, signupGrantMicroUsd(), { kind: 'grant', note: 'signup' })
        .catch(() => false)
    }

    // On a billing instance a new account starts frozen: hosting costs money
    // from day one, and the free path is self-hosting, not a free month here.
    // Reading and exporting stay open, and the first top-up settles the month
    // and lifts the freeze in one step. The operator is never frozen — he is
    // the one who would have to unfreeze himself.
    if (isBillingEnabled() && !isFirst) {
      await prisma.user.update({ where: { id: user.id }, data: { frozenAt: new Date() } }).catch(() => null)
      await markFrozen(user.id)
    }

    await writeAuditLog(prisma, { action: 'user.register', userId: user.id, userEmail: user.email, ip: req.ip })

    // Send verification email if SMTP is configured
    if (emailConfigured) {
      const verifyToken = randomBytes(32).toString('hex')
      await redis.set(`email-verify:${verifyToken}`, user.id, 'EX', 86400)
      await sendVerificationEmail(body.email, verifyToken, prisma)
      return reply.status(201).send({ requiresVerification: true })
    }

    const token = app.jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { expiresIn: '7d' },
    )

    return reply.status(201).send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      // So the screen can say «you are in» — or explain the silence when a seat
      // was taken between the invitation and the sign-up.
      ...(redeemed.length ? { invites: { joined, refused } } : {}),
    })
  })

  // POST /auth/login
  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = loginSchema.parse(req.body)

    // Brute-force lockout: after 5 failed attempts for an email FROM A GIVEN IP,
    // block that email+IP pair for 15 min (counter in Redis). Keying on email+IP
    // (not email alone) means an attacker can't lock a victim out from elsewhere.
    // Fail-open if Redis is unavailable.
    const lockKey = `login:fail:${body.email.toLowerCase()}:${req.ip}`
    const registerFail = async () => {
      try {
        const n = await redis.incr(lockKey)
        if (n === 1) await redis.expire(lockKey, LOGIN_LOCK_WINDOW_SEC)
      } catch { /* redis down — skip lockout */ }
    }
    try {
      const attempts = Number(await redis.get(lockKey)) || 0
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        const ttl = await redis.ttl(lockKey)
        await writeAuditLog(prisma, { action: 'user.login_locked', userEmail: body.email, ip: req.ip })
        return reply.status(429).send({ error: 'too_many_attempts', retryAfterSec: ttl > 0 ? ttl : LOGIN_LOCK_WINDOW_SEC })
      }
    } catch { /* redis down — skip lockout check */ }

    const user = await prisma.user.findUnique({ where: { email: body.email } })
    if (!user || !user.isActive) {
      await registerFail()
      await writeAuditLog(prisma, { action: 'user.login_failed', userEmail: body.email, ip: req.ip })
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const valid = await verifyPassword(body.password, user.passwordHash)
    if (!valid) {
      await registerFail()
      await writeAuditLog(prisma, { action: 'user.login_failed', userId: user.id, userEmail: user.email, ip: req.ip })
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    // Correct password — clear the failed-attempt counter.
    try { await redis.del(lockKey) } catch { /* ignore */ }

    if (!user.isVerified) {
      return reply.status(403).send({ error: 'Email not verified' })
    }

    // If 2FA is enabled — issue a short-lived temp token, require TOTP verification
    if (user.twoFactorEnabled) {
      const tempToken = randomBytes(32).toString('hex')
      await redis.set(`2fa-pending:${tempToken}`, user.id, 'EX', 300)
      return reply.send({ requiresTOTP: true, tempToken })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    await writeAuditLog(prisma, { action: 'user.login', userId: user.id, userEmail: user.email, ip: req.ip })

    const token = app.jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { expiresIn: '7d' },
    )

    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    })
  })

  // POST /auth/2fa/verify-login — завершить вход с TOTP-кодом
  app.post('/auth/2fa/verify-login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { tempToken, code } = req.body as { tempToken?: string; code?: string }
    if (!tempToken || !code) return reply.status(400).send({ error: 'tempToken and code required' })

    const userId = await redis.get(`2fa-pending:${tempToken}`)
    if (!userId) return reply.status(401).send({ error: 'Invalid or expired token' })

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user || !user.twoFactorSecret) return reply.status(401).send({ error: 'Invalid credentials' })

    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code,
      window: 1,
    })
    if (!valid) return reply.status(401).send({ error: 'Invalid TOTP code' })

    await redis.del(`2fa-pending:${tempToken}`)
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    await writeAuditLog(prisma, { action: 'user.login', userId: user.id, userEmail: user.email, ip: req.ip })

    const token = app.jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { expiresIn: '7d' },
    )
    return reply.send({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } })
  })

  // POST /auth/2fa/setup — сгенерировать секрет и QR-код (не включает 2FA)
  app.post('/auth/2fa/setup', { preHandler: authenticate }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.authUser!.id } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const secret = speakeasy.generateSecret({ name: `SinoutX (${user.email})`, length: 20 })
    // Store pending secret in Redis until verified
    await redis.set(`2fa-setup:${user.id}`, secret.base32, 'EX', 600)

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url!)
    return reply.send({ qrDataUrl, secret: secret.base32 })
  })

  // POST /auth/2fa/enable — подтвердить код и включить 2FA
  app.post('/auth/2fa/enable', { preHandler: authenticate }, async (req, reply) => {
    const { code } = req.body as { code?: string }
    if (!code) return reply.status(400).send({ error: 'code required' })

    const pendingSecret = await redis.get(`2fa-setup:${req.authUser!.id}`)
    if (!pendingSecret) return reply.status(400).send({ error: 'No pending 2FA setup. Call /auth/2fa/setup first.' })

    const valid = speakeasy.totp.verify({ secret: pendingSecret, encoding: 'base32', token: code, window: 1 })
    if (!valid) return reply.status(401).send({ error: 'Invalid TOTP code' })

    await redis.del(`2fa-setup:${req.authUser!.id}`)
    await prisma.user.update({
      where: { id: req.authUser!.id },
      data: { twoFactorEnabled: true, twoFactorSecret: pendingSecret },
    })
    return reply.send({ ok: true })
  })

  // POST /auth/2fa/disable — отключить 2FA (требует подтверждения текущим кодом)
  app.post('/auth/2fa/disable', { preHandler: authenticate }, async (req, reply) => {
    const { code } = req.body as { code?: string }
    if (!code) return reply.status(400).send({ error: 'code required' })

    const user = await prisma.user.findUnique({ where: { id: req.authUser!.id } })
    if (!user || !user.twoFactorSecret) return reply.status(400).send({ error: '2FA is not enabled' })

    const valid = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token: code, window: 1 })
    if (!valid) return reply.status(401).send({ error: 'Invalid TOTP code' })

    await prisma.user.update({
      where: { id: req.authUser!.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    })
    return reply.send({ ok: true })
  })

  // GET /auth/2fa/status — текущий статус 2FA
  app.get('/auth/2fa/status', { preHandler: authenticate }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser!.id },
      select: { twoFactorEnabled: true },
    })
    return reply.send({ enabled: user?.twoFactorEnabled ?? false })
  })

  // GET /auth/me — текущий пользователь
  app.get('/auth/me', { preHandler: authenticate }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser!.id },
      select: { id: true, email: true, name: true, role: true, createdAt: true, frozenAt: true },
    })
    if (!user) return reply.status(404).send({ error: 'User not found' })
    // frozenAt lets the client show the banner before the user discovers the
    // freeze by having a save silently rejected.
    return reply.send(user)
  })

  // POST /auth/logout — клиент просто удаляет токен, но можно добавить blacklist
  app.post('/auth/logout', { preHandler: authenticate }, async (_req, reply) => {
    return reply.send({ ok: true })
  })

  // GET /auth/verify-email?token=...
  app.get('/auth/verify-email', async (req, reply) => {
    const { token } = req.query as { token?: string }
    if (!token) return reply.status(400).send({ error: 'token required' })

    const userId = await redis.get(`email-verify:${token}`)
    if (!userId) return reply.status(400).send({ error: 'Invalid or expired token' })

    await redis.del(`email-verify:${token}`)
    await prisma.user.update({ where: { id: userId }, data: { isVerified: true } })

    return reply.send({ ok: true })
  })

  // POST /auth/resend-verification
  app.post('/auth/resend-verification', async (req, reply) => {
    const { email } = req.body as { email?: string }
    if (!email) return reply.status(400).send({ error: 'email required' })

    if (!await isEmailConfigured(prisma)) {
      return reply.status(503).send({ error: 'Email service not configured' })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || user.isVerified) return reply.send({ ok: true })

    const verifyToken = randomBytes(32).toString('hex')
    await redis.set(`email-verify:${verifyToken}`, user.id, 'EX', 86400)
    await sendVerificationEmail(email, verifyToken, prisma)
    return reply.send({ ok: true })
  })

  // POST /auth/forgot-password
  app.post('/auth/forgot-password', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
  }, async (req, reply) => {
    const { email } = req.body as { email?: string }
    if (!email) return reply.status(400).send({ error: 'email required' })

    // Always return 200 to avoid user enumeration
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.isActive) return reply.send({ ok: true })

    if (!await isEmailConfigured(prisma)) {
      return reply.status(503).send({ error: 'Email service not configured on this server' })
    }

    const token = randomBytes(32).toString('hex')
    await redis.set(`password-reset:${token}`, user.id, 'EX', 3600)

    await sendPasswordResetEmail(email, token, prisma)
    return reply.send({ ok: true })
  })

  // POST /auth/reset-password
  app.post('/auth/reset-password', async (req, reply) => {
    const { token, password } = req.body as { token?: string; password?: string }
    if (!token || !password) return reply.status(400).send({ error: 'token and password required' })
    if (password.length < 8) return reply.status(400).send({ error: 'Password too short' })

    const userId = await redis.get(`password-reset:${token}`)
    if (!userId) return reply.status(400).send({ error: 'Invalid or expired token' })

    await redis.del(`password-reset:${token}`)

    const passwordHash = await hashPassword(password)
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } })

    return reply.send({ ok: true })
  })

  // PATCH /auth/change-password — для авторизованного пользователя
  app.patch('/auth/change-password', { preHandler: authenticate }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string }
    if (!currentPassword || !newPassword) return reply.status(400).send({ error: 'currentPassword and newPassword required' })
    if (newPassword.length < 8) return reply.status(400).send({ error: 'Password too short' })

    const user = await prisma.user.findUnique({ where: { id: req.authUser!.id } })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const valid = await verifyPassword(currentPassword, user.passwordHash)
    if (!valid) return reply.status(401).send({ error: 'Current password is incorrect' })

    const passwordHash = await hashPassword(newPassword)
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })
    await writeAuditLog(prisma, { action: 'user.password_changed', userId: user.id, userEmail: user.email, ip: req.ip })
    return reply.send({ ok: true })
  })

  // GET /auth/plan — текущий план и использование
  app.get('/auth/plan', { preHandler: authenticate }, async (req, reply) => {
    const { getUserPlanUsage } = await import('../../lib/plans.js')
    const usage = await getUserPlanUsage(prisma, req.authUser!.id)
    if (!usage) return reply.status(404).send({ error: 'User not found' })
    return reply.send(usage)
  })

  // POST /auth/activate-license — активировать ключ
  app.post('/auth/activate-license', { preHandler: authenticate }, async (req, reply) => {
    const { key } = req.body as { key?: string }
    if (!key) return reply.status(400).send({ error: 'key required' })

    const license = await prisma.licenseKey.findUnique({ where: { key } })
    if (!license || !license.isActive) return reply.status(400).send({ error: 'Invalid or inactive license key' })
    if (license.activatedBy && license.activatedBy !== req.authUser!.id) {
      return reply.status(400).send({ error: 'License key already used by another account' })
    }
    if (license.expiresAt && license.expiresAt < new Date()) {
      return reply.status(400).send({ error: 'License key expired' })
    }
    if (license.email && license.email !== req.authUser!.email) {
      return reply.status(400).send({ error: 'This license key is bound to a different email' })
    }

    // Renewal stacking: if the user already holds the same plan with time left,
    // add this key's duration on top of the remaining time instead of resetting
    // — so renewing early never loses days. Perpetual keys (no expiry) stay null.
    const me = await prisma.user.findUnique({
      where: { id: req.authUser!.id },
      select: { plan: true, licenseExpiresAt: true },
    })
    const now = new Date()
    let newExpiresAt = license.expiresAt
    if (license.expiresAt && license.createdAt) {
      const durationMs = license.expiresAt.getTime() - license.createdAt.getTime()
      const base = (me?.licenseExpiresAt && me.licenseExpiresAt > now && me.plan === license.plan)
        ? me.licenseExpiresAt
        : now
      newExpiresAt = new Date(base.getTime() + durationMs)
    }

    await prisma.$transaction([
      prisma.licenseKey.update({
        where: { key },
        data: { activatedAt: new Date(), activatedBy: req.authUser!.id },
      }),
      prisma.user.update({
        where: { id: req.authUser!.id },
        data: { plan: license.plan, licenseKey: key, licenseExpiresAt: newExpiresAt },
      }),
    ])

    return reply.send({ ok: true, plan: license.plan, expiresAt: newExpiresAt })
  })

  // PATCH /auth/notification-prefs
  app.patch('/auth/notification-prefs', { preHandler: authenticate }, async (req, reply) => {
    const body = z.object({
      deadlineReminder: z.boolean().optional(),
      taskComment: z.boolean().optional(),
      workspaceInvite: z.boolean().optional(),
    }).parse(req.body)

    const user = await prisma.user.findUnique({ where: { id: req.authUser!.id } })
    const current = (user?.notificationPrefs as Record<string, boolean>) ?? {}
    const updated = { ...current, ...body }

    await prisma.user.update({
      where: { id: req.authUser!.id },
      data: { notificationPrefs: updated },
    })
    return reply.send(updated)
  })

  // GET /auth/notification-prefs
  app.get('/auth/notification-prefs', { preHandler: authenticate }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.authUser!.id }, select: { notificationPrefs: true } })
    const prefs = (user?.notificationPrefs as Record<string, boolean>) ?? {}
    return reply.send({
      deadlineReminder: prefs.deadlineReminder !== false,
      taskComment: prefs.taskComment !== false,
      workspaceInvite: prefs.workspaceInvite !== false,
    })
  })

  // ─── API Keys ────────────────────────────────────────────────────────────────

  // GET /auth/api-keys
  app.get('/auth/api-keys', { preHandler: authenticate }, async (req, reply) => {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.authUser!.id },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, expiresAt: true, scopes: true, workspaceIds: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send(keys)
  })

  // POST /auth/api-keys
  app.post('/auth/api-keys', { preHandler: authenticate }, async (req, reply) => {
    const { name, expiresAt, scopes, workspaceIds } = req.body as { name: string; expiresAt?: string; scopes?: string[]; workspaceIds?: string[] }
    if (!name) return reply.status(400).send({ error: 'name required' })

    // Restrict to workspaces the user is actually a member of (empty = all).
    const allowed = Array.isArray(workspaceIds) && workspaceIds.length
      ? (await prisma.workspaceMember.findMany({ where: { userId: req.authUser!.id, workspaceId: { in: workspaceIds } }, select: { workspaceId: true } })).map((m) => m.workspaceId)
      : []

    const { raw, prefix, hash } = generateApiKey()

    const key = await prisma.apiKey.create({
      data: {
        userId: req.authUser!.id,
        name,
        keyHash: hash,
        prefix,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        scopes: scopes ?? [],
        workspaceIds: allowed,
      },
      select: { id: true, name: true, prefix: true, expiresAt: true, scopes: true, workspaceIds: true, createdAt: true },
    })

    // Return raw key ONCE — never stored
    return reply.status(201).send({ ...key, key: raw })
  })

  // PATCH /auth/api-keys/:id — update name / workspace scope
  app.patch('/auth/api-keys/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { name, workspaceIds } = req.body as { name?: string; workspaceIds?: string[] }
    const existing = await prisma.apiKey.findFirst({ where: { id, userId: req.authUser!.id }, select: { id: true } })
    if (!existing) return reply.status(404).send({ error: 'Not found' })

    const data: Record<string, unknown> = {}
    if (typeof name === 'string' && name) data.name = name
    if (Array.isArray(workspaceIds)) {
      data.workspaceIds = workspaceIds.length
        ? (await prisma.workspaceMember.findMany({ where: { userId: req.authUser!.id, workspaceId: { in: workspaceIds } }, select: { workspaceId: true } })).map((m) => m.workspaceId)
        : []
    }
    const key = await prisma.apiKey.update({ where: { id }, data, select: { id: true, name: true, prefix: true, lastUsedAt: true, expiresAt: true, scopes: true, workspaceIds: true, createdAt: true } })
    return reply.send(key)
  })

  // DELETE /auth/api-keys/:id
  app.delete('/auth/api-keys/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await prisma.apiKey.deleteMany({ where: { id, userId: req.authUser!.id } })
    return reply.status(204).send()
  })
}
