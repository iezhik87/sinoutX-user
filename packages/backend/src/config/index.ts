import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Distribution mode: 'self-hosted' (user's own server — full power, one-time
  // licensing) or 'cloud' (we host — subscription/balance, hardened: no bash for
  // non-admins, scripts sandboxed). Drives capability gating + billing.
  DEPLOYMENT_MODE: z.enum(['self-hosted', 'cloud']).default('self-hosted'),
  // Code-execution sandbox (separate executor container). Empty URL disables it.
  EXECUTOR_URL: z.string().default('http://executor:8088'),
  EXECUTOR_NET_URL: z.string().default('http://executor-net:8088'), // admin-only: sandbox WITH internet
  EXECUTOR_TOKEN: z.string().default(''),
  PORT: z.coerce.number().default(3010),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  MEILI_URL: z.string().url().default('http://localhost:7700'),
  MEILI_KEY: z.string().min(1),

  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USER: z.string().default('sinoutx'),
  MINIO_PASSWORD: z.string(),
  MINIO_USE_SSL: z.preprocess((v) => v === 'true' || v === true || v === 1, z.boolean()).default(false),
  MINIO_BUCKET: z.string().default('sinout-files'),

  JWT_SECRET: z.string().min(32),
  // Master key for encrypting stored secrets at rest (AI provider keys,
  // integration tokens, 2FA secrets, SMTP password). If unset, secrets are
  // stored as-is — set this on any multi-tenant/cloud deployment.
  ENCRYPTION_KEY: z.string().min(16).optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3012'),
  INVITE_CODE: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Managed AI ("SinoutX" provider): the key WE pay for. Its presence is what
  // makes the built-in assistant offerable at all — without it a cloud signup
  // meets a settings screen instead of a working assistant.
  MANAGED_AI_KEY: z.string().optional(),
  MANAGED_AI_MODEL: z.string().default('deepseek-v4-pro'),
  MANAGED_AI_BASE_URL: z.string().default('https://api.deepseek.com/v1'),

  // ─── Wallet ─────────────────────────────────────────────────────────────────
  // Grant on signup. Zero by default: a hundred signups at $0.50 is a bill the
  // operator pays for people who may never return. The free trial of the product
  // is BYOK — the user connects his own key and pays nothing to us, forever.
  // Raise it only if you can afford every registration to cost you this much.
  WALLET_SIGNUP_GRANT_USD: z.coerce.number().default(0),
  // Hard stop. A tool loop can call the model hundreds of times unattended; the
  // user would not pay that bill, and he would be right.
  WALLET_MONTHLY_CAP_USD: z.coerce.number().default(20),
  // Below this we warn him — in the messenger he already uses.
  WALLET_LOW_BALANCE_USD: z.coerce.number().default(0.2),

  // ─── Cloud subscription (DEPLOYMENT_MODE=cloud only) ───────────────────────
  // Hosting is a service and a service costs money. The free path is self-hosted,
  // not the cloud — otherwise we give away the only scarce resource we own.
  PRICE_CLOUD_BASE_USD: z.coerce.number().default(5),
  // Sold in 200 MB packs, not gigabytes: at $3/GB one byte over the free 200 MB
  // cost $3, which is the kind of bill that gets you an angry email instead of a
  // payment. The rate per gigabyte is unchanged — the step is just smaller.
  PRICE_STORAGE_PACK_USD: z.coerce.number().default(0.6),
  STORAGE_PACK_MB: z.coerce.number().default(200),
  SEARXNG_URL: z.string().url().optional(),
  // OpenAI-compatible local transcription endpoint (faster-whisper-server).
  // When set, Telegram voice messages are transcribed here instead of OpenAI.
  WHISPER_URL: z.string().url().optional(),
  // Имя модели распознавания речи. Должно совпадать с WHISPER__MODEL у
  // сервиса whisper: он загружает ту модель, которую попросит клиент, так
  // что расхождение молча оставляет старую.
  WHISPER_MODEL: z.string().default('Systran/faster-whisper-base'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  APP_URL: z.string().url().optional(),

  // NOWPayments crypto billing (optional — only needed for in-app license purchase)
  NOWPAYMENTS_API_KEY: z.string().optional(),
  NOWPAYMENTS_IPN_SECRET: z.string().optional(),
  // Per-plan prices in USD (used when creating an invoice).
  PRICE_TEAM_USD: z.coerce.number().default(149),

  // Deploy version info — set by deploy.sh so the admin panel can show what is
  // actually running. Defaults make local/dev obvious.
  APP_VERSION: z.string().default('dev'),
  APP_BUILT_AT: z.string().optional(),
})

function loadConfig() {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('Invalid environment variables:')
    result.error.issues.forEach((issue) => {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`)
    })
    process.exit(1)
  }
  return result.data
}

export const config = loadConfig()
export type Config = typeof config
