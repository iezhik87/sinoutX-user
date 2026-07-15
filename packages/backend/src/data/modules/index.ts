import { medicalRecord } from './medical-record.js'
import { finance } from './finance.js'
import { memory } from './memory.js'
import { personalGrowth } from './personal-growth.js'
import { vault } from './vault.js'
import { auto } from './auto.js'

// Built-in modules shipped with the app. Synced into the `Module` catalog on
// boot. Authored as plain objects so they compile into dist (no runtime file IO).
export const BUILTIN_MANIFESTS: unknown[] = [
  medicalRecord,
  finance,
  memory,
  personalGrowth,
  vault,
  auto,
]
