// Field-level encryption for collection records (the «Vault» module and any
// module using `type: 'secret'` fields).
//
// Secret values are stored under a reserved `_sec` key (encrypted at rest). The
// underscore prefix means recordText()/embeddings SKIP them automatically, so
// secrets never reach the AI's memory, search or context. The plaintext value
// is NEVER stored under the field's own key, and NEVER sent to the browser in
// bulk — only via the explicit reveal endpoint.
import { encryptSecret, decryptSecret } from './crypto.js'

type Dict = Record<string, unknown>

/** Keys of `type: 'secret'` fields, from a collection's `fields` JSON. */
export function secretKeysOf(fields: unknown): string[] {
  if (!Array.isArray(fields)) return []
  return fields.filter((f) => f && typeof f === 'object' && (f as Dict).type === 'secret' && typeof (f as Dict).key === 'string').map((f) => (f as Dict).key as string)
}

/** Transform incoming record data for storage: encrypt secret fields into `_sec`,
 *  drop plaintext under their own key, and never trust a client-supplied `_sec`.
 *  Empty/absent secret value on update = preserve the existing one. */
export function encodeSecrets(incoming: Dict, secretKeys: string[], existing?: Dict): Dict {
  const out: Dict = {}
  // Start from existing secrets (filtered to still-secret keys), then override.
  const prevSec = (existing?._sec as Dict | undefined) ?? {}
  const sec: Dict = {}
  for (const k of secretKeys) if (typeof prevSec[k] === 'string') sec[k] = prevSec[k]

  for (const [k, v] of Object.entries(incoming)) {
    if (k === '_sec' || k === '_secretSet') continue // reserved — never from client
    if (secretKeys.includes(k)) {
      const val = v == null ? '' : String(v)
      if (val.trim() !== '') {
        const enc = encryptSecret(val)
        if (enc != null) sec[k] = enc
      } // empty → keep existing (already carried over)
    } else {
      out[k] = v
    }
  }
  if (Object.keys(sec).length) out._sec = sec
  return out
}

/** Strip `_sec` from a record's data and expose only WHICH secret keys are set
 *  (for the UI to render masked ••• + reveal). Plaintext is never included. */
export function maskSecrets(data: unknown): Dict {
  if (!data || typeof data !== 'object') return {}
  const { _sec, _secretSet, ...rest } = data as Dict
  const keys = Object.keys((_sec as Dict | undefined) ?? {})
  // Only annotate records that actually have secrets — leave others untouched.
  return keys.length ? { ...rest, _secretSet: keys } : rest
}

export function maskRecord<T extends { data: unknown }>(rec: T): T {
  return { ...rec, data: maskSecrets(rec.data) }
}

/** Decrypt one secret field's stored value (for the reveal endpoint). */
export function revealSecret(data: unknown, fieldKey: string): string | undefined {
  const sec = (data && typeof data === 'object' ? (data as Dict)._sec : undefined) as Dict | undefined
  const stored = sec?.[fieldKey]
  return typeof stored === 'string' ? decryptSecret(stored) : undefined
}
