import { z } from 'zod'

// ─── Module manifest schema (validated on register/import) ────────────────────
// Code terms are English; UI labels are localized via the i18n maps below.

const Localized = z.record(z.string(), z.string()) // { ru: "...", en: "..." }

export const FIELD_TYPES = [
  'text', 'longtext', 'number', 'date', 'datetime',
  'select', 'multiselect', 'checkbox', 'relation', 'file',
  'secret', // encrypted at rest, masked in UI, excluded from AI memory/search
] as const

export const VIEW_TYPES = ['table', 'form', 'chart', 'board', 'calendar', 'gallery'] as const

const Option = z.object({ value: z.string(), label: Localized })

const Field = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'field key: letters/digits/underscore, must start with a letter'),
  label: Localized,
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  options: z.array(Option).optional(),
  relation: z.object({ collection: z.string(), multiple: z.boolean().optional() }).optional(),
  // A bare string (custom modules) or an i18n map, like `label`.
  unit: z.union([z.string(), Localized]).optional(),
  help: Localized.optional(),
  default: z.unknown().optional(),
  // For a number field: sibling field keys holding the low/high reference bounds
  // (used to highlight out-of-range values, e.g. lab indicators).
  range: z.object({ lowKey: z.string(), highKey: z.string() }).optional(),
})

const View = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  type: z.enum(VIEW_TYPES),
  name: Localized,
  config: z.record(z.string(), z.unknown()).optional(),
})

const Collection = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  name: Localized,
  icon: z.string().optional(),
  fields: z.array(Field).min(1),
  views: z.array(View).optional(),
})

export const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'module id: lowercase letters, digits, hyphens'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version: semver x.y.z'),
  name: Localized,
  description: Localized.optional(),
  icon: z.string().optional(),
  author: z.string().optional(),
  disclaimer: Localized.optional(),
  // Usually ≥1 collection; empty is allowed for "feature" modules that wrap
  // existing built-in screens (e.g. Personal Growth) rather than store records.
  collections: z.array(Collection),
  ai: z.object({
    systemHints: Localized.optional(),
    // First-party capabilities referenced by id (handler lives in core, never
    // shipped as code). e.g. { id: 'lab-ocr', target: 'analyses' }.
    pipelines: z.array(z.object({ id: z.string(), target: z.string().optional(), label: Localized.optional(), premium: z.boolean().optional() })).optional(),
  }).optional(),
  seed: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).optional(),
}).superRefine((m, ctx) => {
  // Collection keys unique; relation targets must exist.
  const keys = new Set<string>()
  for (const c of m.collections) {
    if (keys.has(c.key)) ctx.addIssue({ code: 'custom', message: `duplicate collection key "${c.key}"` })
    keys.add(c.key)
  }
  for (const c of m.collections) {
    for (const f of c.fields) {
      if (f.type === 'relation' && f.relation && !keys.has(f.relation.collection)) {
        ctx.addIssue({ code: 'custom', message: `field "${c.key}.${f.key}" → unknown relation collection "${f.relation.collection}"` })
      }
    }
  }
})

export type Manifest = z.infer<typeof ManifestSchema>
export type ManifestField = z.infer<typeof Field>
export type ManifestCollection = z.infer<typeof Collection>

// Pick a localized string with sensible fallback (ru → en → first available).
export function localized(map: Record<string, string> | null | undefined, lang = 'ru'): string {
  if (!map) return ''
  return map[lang] ?? map.ru ?? map.en ?? Object.values(map)[0] ?? ''
}
