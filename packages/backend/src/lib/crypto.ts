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
