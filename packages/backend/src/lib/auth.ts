import bcrypt from 'bcrypt'
import { createHash, randomBytes } from 'crypto'

const BCRYPT_ROUNDS = 12

// ─── Password helpers ─────────────────────────────────────────────────────────

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// ─── API key helpers ──────────────────────────────────────────────────────────

const API_KEY_PREFIX = 'sk_sinoutx_'

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`
  const prefix = raw.slice(0, API_KEY_PREFIX.length + 8)
  const hash = hashApiKey(raw)
  return { raw, prefix, hash }
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
