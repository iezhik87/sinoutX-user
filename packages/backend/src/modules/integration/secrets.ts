// ─── Секреты интеграций ───────────────────────────────────────────────────────
//
// Токен бота — это полный доступ к боту: кто его получил, ставит свой вебхук и
// начинает читать чужую переписку с ассистентом, включая присланные фотографии
// документов. Хранился он в `Integration.config` открытым текстом, и это давало
// две течи.
//
// Первая: архив пространства. Мы сделали его переносимым и пообещали, что данные
// уходят целиком — значит архивы поедут на флешках и в чужие руки. Пароли из
// Сейфа при этом шифруются, а токен лежал рядом как есть.
//
// Вторая, менее заметная: `GET /integrations` отдавал конфиг целиком в браузер
// при каждом открытии настроек. Форма его не показывала, но по сети он уходил.
//
// Третья, отложенная во времени: восстановите архив на втором сервере — и там
// окажется живой токен. Проверка здоровья вебхука на обоих инстансах начнёт
// переставлять его каждый на себя, и два сервера будут драться за одного бота,
// оба считая, что чинят.
//
// Лечение то же, что у ключей AI-провайдеров: шифруем при хранении. В базе и в
// архиве лежит `enc:v1:`, на своём инстансе разворачивается и работает, на чужом
// — нет, и человек вводит токен заново. Это и правильное поведение: чужой сервер
// не должен молча увести бота.
import type { PrismaClient } from '@prisma/client'
import { encryptSecret, decryptSecret, isEncrypted } from '../../lib/crypto.js'
import { config } from '../../config/index.js'

/**
 * Ключи конфига, которые являются учётными данными.
 *
 * `url` (Slack, Discord, произвольный вебхук) сознательно НЕ входит: это тоже
 * пропуск, но пропуск на запись в один канал, а не на чтение всей переписки, и
 * человеку нужно видеть в настройках, куда именно он настроил отправку.
 * Зашифровав, мы отняли бы у него эту возможность ради меньшей угрозы.
 */
export const INTEGRATION_SECRET_KEYS = ['botToken', 'token', 'secret'] as const

type Cfg = Record<string, unknown>

const asCfg = (v: unknown): Cfg => (v && typeof v === 'object' ? { ...(v as Cfg) } : {})

/** Перед записью в базу. Уже зашифрованное `encryptSecret` пропускает как есть. */
export function encryptIntegrationConfig(config: unknown): Cfg {
  const out = asCfg(config)
  for (const k of INTEGRATION_SECRET_KEYS) {
    if (typeof out[k] === 'string' && out[k]) out[k] = encryptSecret(out[k] as string)
  }
  return out
}

/**
 * Перед использованием. Незашифрованное значение `decryptSecret` возвращает как
 * есть — поэтому строки, сохранённые до этой правки, продолжают работать, а
 * переезжают на шифрование при первом же сохранении или разовым проходом.
 */
export function decryptIntegrationConfig(config: unknown): Cfg {
  const out = asCfg(config)
  for (const k of INTEGRATION_SECRET_KEYS) {
    if (typeof out[k] === 'string' && out[k]) out[k] = decryptSecret(out[k] as string)
  }
  return out
}

/**
 * Для отдачи в браузер. Не пустая строка, а признак «задано»: интерфейсу нужно
 * знать, настроен ли токен, но не сам токен.
 */
export function maskIntegrationConfig(config: unknown): Cfg {
  const out = asCfg(config)
  for (const k of INTEGRATION_SECRET_KEYS) {
    if (typeof out[k] === 'string' && out[k]) out[k] = '••••••••'
  }
  return out
}

/**
 * Разовый проход при старте: зашифровать учётные данные, сохранённые до этой
 * правки.
 *
 * Без него токен так и лежал бы открытым до следующего сохранения интеграции —
 * то есть, возможно, никогда, потому что переподключать работающий бот незачем.
 * Проход идемпотентен: уже зашифрованное `encryptSecret` пропускает как есть,
 * поэтому со второго запуска он ничего не делает.
 *
 * Молчит, если шифровать нечем: без ENCRYPTION_KEY `encryptSecret` возвращает
 * значение как есть, и переписывать строки впустую незачем.
 */
export async function encryptStoredIntegrationSecrets(prisma: PrismaClient): Promise<number> {
  if (!config.ENCRYPTION_KEY) return 0
  const rows = await prisma.integration.findMany({ select: { id: true, config: true } })
  let changed = 0
  for (const r of rows) {
    const cfg = (r.config && typeof r.config === 'object' ? r.config : {}) as Record<string, unknown>
    const plain = INTEGRATION_SECRET_KEYS.some(
      (k) => typeof cfg[k] === 'string' && cfg[k] && !isEncrypted(cfg[k] as string),
    )
    if (!plain) continue
    await prisma.integration
      .update({ where: { id: r.id }, data: { config: encryptIntegrationConfig(cfg) as object } })
      .then(() => { changed++ })
      .catch((e) => console.error('[integrations] could not encrypt secrets for', r.id, e))
  }
  return changed
}

/**
 * Сколько интеграций после восстановления архива непригодны — их учётные данные
 * зашифрованы ключом ДРУГОГО инстанса.
 *
 * Так и задумано: чужой сервер не должен молча увести бота. Но человек об этом
 * узнать обязан, иначе бот просто перестанет отвечать, и причину искать будет
 * негде.
 */
export async function countUnreadableIntegrations(prisma: PrismaClient, workspaceId: string): Promise<number> {
  const rows = await prisma.integration.findMany({ where: { workspaceId }, select: { config: true } })
  let n = 0
  for (const r of rows) {
    const cfg = decryptIntegrationConfig(r.config)
    // Не расшифровалось — decryptSecret возвращает исходное, и префикс остаётся.
    if (INTEGRATION_SECRET_KEYS.some((k) => typeof cfg[k] === 'string' && isEncrypted(cfg[k] as string))) n++
  }
  return n
}
