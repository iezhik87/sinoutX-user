import nodemailer from 'nodemailer'
import type { PrismaClient } from '@prisma/client'
import { config } from '../config/index.js'

interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
  appUrl: string
}

async function getSmtpConfig(prisma?: PrismaClient): Promise<SmtpConfig | null> {
  if (prisma) {
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
    if (settings?.smtpHost && settings?.smtpUser && settings?.smtpPass) {
      return {
        host: settings.smtpHost,
        port: settings.smtpPort ?? 587,
        user: settings.smtpUser,
        pass: settings.smtpPass,
        from: settings.smtpFrom ?? settings.smtpUser,
        appUrl: settings.appUrl ?? config.APP_URL ?? 'http://localhost:3012',
      }
    }
  }
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) return null
  return {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT ?? 587,
    user: config.SMTP_USER,
    pass: config.SMTP_PASS,
    from: config.SMTP_FROM ?? config.SMTP_USER,
    appUrl: config.APP_URL ?? 'http://localhost:3012',
  }
}

function createTransporter(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  })
}

export async function isEmailConfigured(prisma?: PrismaClient): Promise<boolean> {
  const cfg = await getSmtpConfig(prisma)
  return cfg !== null
}

export async function sendVerificationEmail(to: string, token: string, prisma?: PrismaClient): Promise<void> {
  const cfg = await getSmtpConfig(prisma)
  if (!cfg) throw new Error('Email service not configured')

  const verifyUrl = `${cfg.appUrl}/verify-email?token=${token}`

  await createTransporter(cfg).sendMail({
    from: cfg.from,
    to,
    subject: 'Подтвердите email — SinoutX',
    text: `Для подтверждения email перейдите по ссылке:\n\n${verifyUrl}\n\nСсылка действительна 24 часа.`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
        <h2 style="margin:0 0 16px;color:#f1f5f9;font-size:20px">Добро пожаловать в SinoutX</h2>
        <p style="margin:0 0 24px;color:#94a3b8;line-height:1.6">Подтвердите ваш email-адрес, чтобы начать работу:</p>
        <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Подтвердить email</a>
        <p style="margin:24px 0 0;color:#64748b;font-size:13px">Ссылка действительна 24 часа. Если вы не регистрировались — проигнорируйте это письмо.</p>
        <p style="margin:8px 0 0;color:#475569;font-size:12px;word-break:break-all">Или скопируйте: ${verifyUrl}</p>
      </div>
    `,
  })
}

export async function sendPasswordResetEmail(to: string, token: string, prisma?: PrismaClient): Promise<void> {
  const cfg = await getSmtpConfig(prisma)
  if (!cfg) throw new Error('Email service not configured')

  const resetUrl = `${cfg.appUrl}/reset-password?token=${token}`

  await createTransporter(cfg).sendMail({
    from: cfg.from,
    to,
    subject: 'Сброс пароля — SinoutX',
    text: `Для сброса пароля перейдите по ссылке:\n\n${resetUrl}\n\nСсылка действительна 1 час. Если вы не запрашивали сброс пароля, проигнорируйте это письмо.`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
        <h2 style="margin:0 0 16px;color:#f1f5f9;font-size:20px">Сброс пароля</h2>
        <p style="margin:0 0 24px;color:#94a3b8;line-height:1.6">Кто-то запросил сброс пароля для вашего аккаунта SinoutX. Если это были вы, нажмите кнопку ниже:</p>
        <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Сбросить пароль</a>
        <p style="margin:24px 0 0;color:#64748b;font-size:13px">Ссылка действительна 1 час. Если вы не запрашивали сброс — просто проигнорируйте это письмо.</p>
        <p style="margin:8px 0 0;color:#475569;font-size:12px;word-break:break-all">Или скопируйте: ${resetUrl}</p>
      </div>
    `,
  })
}

export async function sendDeadlineReminderEmail(to: string, opts: {
  taskTitle: string; projectName: string; dueDate: Date; appUrl: string
}, prisma?: PrismaClient): Promise<void> {
  const cfg = await getSmtpConfig(prisma)
  if (!cfg) throw new Error('Email service not configured')
  const due = opts.dueDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  await createTransporter(cfg).sendMail({
    from: cfg.from, to,
    subject: `⏰ Дедлайн завтра: ${opts.taskTitle} — SinoutX`,
    text: `Завтра дедлайн задачи "${opts.taskTitle}" в проекте "${opts.projectName}" (${due}).`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
      <h2 style="margin:0 0 8px;color:#f1f5f9;font-size:18px">⏰ Дедлайн завтра</h2>
      <p style="margin:0 0 16px;color:#94a3b8;font-size:14px">Проект: <b style="color:#c4b5fd">${opts.projectName}</b></p>
      <div style="padding:16px;background:#1e293b;border-radius:8px;border-left:3px solid #7c3aed;margin-bottom:24px">
        <p style="margin:0;font-size:15px;font-weight:600;color:#f1f5f9">${opts.taskTitle}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#64748b">Срок: ${due}</p>
      </div>
      <a href="${opts.appUrl}" style="display:inline-block;padding:10px 20px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-size:13px">Открыть SinoutX</a>
    </div>`,
  })
}

export async function sendCommentNotificationEmail(to: string, opts: {
  taskTitle: string; projectName: string; commentAuthor: string; commentText: string; appUrl: string
}, prisma?: PrismaClient): Promise<void> {
  const cfg = await getSmtpConfig(prisma)
  if (!cfg) throw new Error('Email service not configured')
  await createTransporter(cfg).sendMail({
    from: cfg.from, to,
    subject: `💬 Новый комментарий: ${opts.taskTitle} — SinoutX`,
    text: `${opts.commentAuthor} оставил комментарий к задаче "${opts.taskTitle}": ${opts.commentText}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
      <h2 style="margin:0 0 8px;color:#f1f5f9;font-size:18px">💬 Новый комментарий</h2>
      <p style="margin:0 0 4px;color:#94a3b8;font-size:13px">Задача: <b style="color:#f1f5f9">${opts.taskTitle}</b></p>
      <p style="margin:0 0 16px;color:#94a3b8;font-size:13px">Проект: <b style="color:#c4b5fd">${opts.projectName}</b></p>
      <div style="padding:16px;background:#1e293b;border-radius:8px;margin-bottom:24px">
        <p style="margin:0 0 6px;font-size:12px;color:#7c3aed;font-weight:600">${opts.commentAuthor}</p>
        <p style="margin:0;font-size:14px;color:#e2e8f0;line-height:1.5">${opts.commentText}</p>
      </div>
      <a href="${opts.appUrl}" style="display:inline-block;padding:10px 20px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-size:13px">Открыть задачу</a>
    </div>`,
  })
}

export async function sendLicenseKeyEmail(to: string, opts: {
  licenseKey: string; plan: string; appUrl: string; expiresAt?: Date | null
}, prisma?: PrismaClient): Promise<void> {
  const cfg = await getSmtpConfig(prisma)
  if (!cfg) return
  const planLabel = opts.plan === 'business' ? 'Business' : 'Team'
  // Pro is an annual license; Team/Business are perpetual.
  const validity = opts.expiresAt
    ? `Valid for 1 year — until ${opts.expiresAt.toISOString().slice(0, 10)}.`
    : 'This is a perpetual license (no expiry).'
  await createTransporter(cfg).sendMail({
    from: cfg.from, to,
    subject: `Your SinoutX ${planLabel} license key`,
    text:
`Thank you for your purchase.

Your SinoutX ${planLabel} license key:
${opts.licenseKey}

${validity}

Activate it in your SinoutX instance under Settings → Plan, or visit
${opts.appUrl}/settings to enter it.

Questions or issues — reply to this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
      <h2 style="margin:0 0 16px;color:#f1f5f9;font-size:20px">Your SinoutX ${planLabel} license</h2>
      <p style="margin:0 0 16px;color:#94a3b8;line-height:1.6">Thank you for your purchase. Use the key below to activate your ${planLabel} plan inside your SinoutX instance.</p>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#1e293b;border:1px solid #334155;padding:14px 16px;border-radius:8px;font-size:15px;color:#c4b5fd;letter-spacing:1px;text-align:center">${opts.licenseKey}</div>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:13px;text-align:center">${validity}</p>
      <a href="${opts.appUrl}/settings" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open Settings</a>
      <p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:1.6">Questions or issues — reply to this email.</p>
    </div>`,
  })
}

export async function sendLicenseExpiryReminderEmail(to: string, opts: {
  plan: string; expiresAt: Date; daysLeft: number; appUrl: string
}, prisma?: PrismaClient): Promise<void> {
  const cfg = await getSmtpConfig(prisma)
  if (!cfg) return
  const planLabel = opts.plan === 'business' ? 'Business' : 'Team'
  const dateStr = opts.expiresAt.toISOString().slice(0, 10)
  const when = opts.daysLeft <= 1 ? 'tomorrow' : `in ${opts.daysLeft} days`
  await createTransporter(cfg).sendMail({
    from: cfg.from, to,
    subject: `Your SinoutX ${planLabel} license expires ${when}`,
    text:
`Your SinoutX ${planLabel} license expires ${when} (${dateStr}).

Renew now to keep your ${planLabel} features — when the license lapses your
account falls back to the Free plan:
${opts.appUrl}/buy?plan=${opts.plan === 'business' ? 'team' : opts.plan}

Questions — reply to this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
      <h2 style="margin:0 0 16px;color:#f1f5f9;font-size:20px">Your ${planLabel} license expires ${when}</h2>
      <p style="margin:0 0 16px;color:#94a3b8;line-height:1.6">Your SinoutX ${planLabel} license expires on <strong style="color:#e2e8f0">${dateStr}</strong>. When it lapses, your account falls back to the Free plan. Renew to keep your features.</p>
      <a href="${opts.appUrl}/buy?plan=${opts.plan === 'business' ? 'team' : opts.plan}" style="display:inline-block;margin-top:8px;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Renew ${planLabel}</a>
      <p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:1.6">Questions — reply to this email.</p>
    </div>`,
  })
}

export async function sendWorkspaceInviteEmail(to: string, opts: {
  workspaceName: string; inviterName: string; appUrl: string
}, prisma?: PrismaClient): Promise<void> {
  const cfg = await getSmtpConfig(prisma)
  if (!cfg) return
  await createTransporter(cfg).sendMail({
    from: cfg.from, to,
    subject: `Вас добавили в ${opts.workspaceName} — SinoutX`,
    text: `${opts.inviterName} добавил вас в рабочее пространство "${opts.workspaceName}" в SinoutX.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
      <h2 style="margin:0 0 16px;color:#f1f5f9;font-size:20px">Вас добавили в рабочее пространство</h2>
      <p style="margin:0 0 8px;color:#94a3b8;line-height:1.6"><b style="color:#c4b5fd">${opts.inviterName}</b> добавил вас в пространство <b style="color:#f1f5f9">${opts.workspaceName}</b>.</p>
      <a href="${opts.appUrl}/login" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Открыть SinoutX</a>
    </div>`,
  })
}

/**
 * Invitation for someone who has no account yet. The link carries the token, and
 * the token is what lets them register on an instance whose registration is
 * closed — so it must go to the address that was invited and nowhere else.
 */
export async function sendInviteToRegisterEmail(to: string, opts: {
  targetName: string; inviterName: string; appUrl: string; token: string
}, prisma?: PrismaClient): Promise<void> {
  const cfg = await getSmtpConfig(prisma)
  if (!cfg) return
  const link = `${opts.appUrl.replace(/\/$/, '')}/register?invite=${encodeURIComponent(opts.token)}`
  await createTransporter(cfg).sendMail({
    from: cfg.from, to,
    subject: `${opts.inviterName} приглашает вас в ${opts.targetName} — SinoutX`,
    text: `${opts.inviterName} приглашает вас в "${opts.targetName}" в SinoutX.\n`
      + `Чтобы получить доступ, заведите аккаунт по ссылке: ${link}\n`
      + `Ссылка действует 14 дней и работает только для этого адреса.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
      <h2 style="margin:0 0 16px;color:#f1f5f9;font-size:20px">Вас приглашают к совместной работе</h2>
      <p style="margin:0 0 8px;color:#94a3b8;line-height:1.6"><b style="color:#c4b5fd">${opts.inviterName}</b> приглашает вас в <b style="color:#f1f5f9">${opts.targetName}</b>.</p>
      <p style="margin:0 0 8px;color:#94a3b8;line-height:1.6">Доступ откроется после того, как вы заведёте аккаунт — это займёт минуту.</p>
      <a href="${link}" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Создать аккаунт</a>
      <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.6">Ссылка действует 14 дней и работает только для адреса ${to}. Если вы не ждали приглашения — просто не переходите по ней.</p>
    </div>`,
  })
}
