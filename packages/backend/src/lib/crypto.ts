import crypto from 'node:crypto'
import { config } from '../config/index.js'

// AES-256-GCM encryption for secrets at rest (AI provider keys, integration
// tokens, 2FA secrets, SMTP password).
//
// Stored format: "enc:v1:" + base64(iv[12] | authTag[16] | ciphertext).
// Graceful by design:
//   - No ENCRYPTION_KEY set  -> values pass through as plaintext (self-host).
//   - Value without the prefix -> treated as plaintext (legacy/unencrypted).
// This lets a deployment turn encryption on/off without a data migration;
// existing plaintext keeps working and gets encrypted on next save.

const PREFIX = 'enc:v1:'

function getKey(): Buffer | null {
  const k = config.ENCRYPTION_KEY
  if (!k) return null
  // Derive a fixed 32-byte key from the provided secret.
  return crypto.createHash('sha256').update(k, 'utf8').digest()
}

export function isEncrypted(v: string): boolean {
  return v.startsWith(PREFIX)
}

export function encryptSecret(plain: string | undefined | null): string | undefined {
  if (!plain) return plain ?? undefined
  if (plain.startsWith(PREFIX)) return plain // already encrypted
  const key = getKey()
  if (!key) return plain // no master key configured — store as-is
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptSecret(stored: string | undefined | null): string | undefined {
  if (!stored) return stored ?? undefined
  if (!stored.startsWith(PREFIX)) return stored // plaintext / legacy
  const key = getKey()
  if (!key) return stored // cannot decrypt without the key
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64')
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const ct = raw.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    return stored
  }
}

// ─── Переносимые секреты ──────────────────────────────────────────────────────
//
// Значения выше зашифрованы ключом ИНСТАНСА. Это верно, пока данные лежат на
// месте, и становится тупиком, когда человек хочет забрать свой Сейф на другой
// сервер: ключа облака ему не дадут — он общий на всех, — а без ключа записи
// переносятся нечитаемыми.
//
// Выход: на выгрузке расшифровать своим ключом и тут же зашифровать заново тем,
// который человек задал сам. Архив в пути не читает никто, включая нас; на новом
// инстансе он вводит ту же фразу, и значения ложатся уже под ключ того сервера.
// Плата за это — забытая фраза означает потерянный Сейф из этого архива. Но это
// его собственная плата, и он о ней знает, в отличие от ключа инстанса.

const PORTABLE_PREFIX = 'encp:v1:'

export const isPortableSecret = (v: string): boolean => v.startsWith(PORTABLE_PREFIX)

/** Новая соль на архив. */
export const newSecretsSalt = (): Buffer => crypto.randomBytes(16)

/**
 * Ключ из парольной фразы. scrypt намеренно медленный — перебор фразы должен
 * стоить дорого. Соль одна на весь архив: выводить ключ на каждое значение
 * значило бы считать scrypt сотни раз и растянуть выгрузку на минуты.
 */
export function derivePassphraseKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase.normalize('NFKC'), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

export function encryptPortable(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return PORTABLE_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

/** null — не расшифровалось: не та фраза или порченый архив. Молча вернуть
 *  исходное нельзя: в базу лёг бы мусор вместо пароля. */
export function decryptPortable(stored: string, key: Buffer): string | null {
  if (!stored.startsWith(PORTABLE_PREFIX)) return null
  try {
    const raw = Buffer.from(stored.slice(PORTABLE_PREFIX.length), 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
