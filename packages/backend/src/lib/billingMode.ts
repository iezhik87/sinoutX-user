// ─── Is this instance billing anyone? ─────────────────────────────────────────
// The question is not "cloud or self-hosted" — that is a deployment detail the
// operator already knows. The question is whether THIS instance charges its
// users, and an operator should be able to answer it from the admin panel
// without a redeploy.
//
// Precedence: AppSettings.billingEnabled (if set) → DEPLOYMENT_MODE from the env.
//
// Cached in memory because `effectiveStorageMb` is on the upload path and must
// stay synchronous; the cache is primed at boot and rewritten whenever an admin
// flips the switch, so it cannot drift.
import type { PrismaClient } from '@prisma/client'
import { config } from '../config/index.js'

let enabled: boolean = config.DEPLOYMENT_MODE === 'cloud'

export const isBillingEnabled = (): boolean => enabled

/** Called at startup, before the first request touches a quota. */
export async function primeBillingMode(prisma: PrismaClient): Promise<boolean> {
  try {
    const s = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { billingEnabled: true },
    })
    if (s?.billingEnabled != null) enabled = s.billingEnabled
  } catch (e) {
    console.error('[billing] could not read the billing switch', (e as Error).message)
  }
  console.log(`[billing] charging users: ${enabled ? 'on' : 'off'}`)
  return enabled
}

/** Called by the admin route right after the setting is written. */
export function setBillingMode(value: boolean | null): void {
  enabled = value ?? config.DEPLOYMENT_MODE === 'cloud'
  console.log(`[billing] charging users: ${enabled ? 'on' : 'off'}`)
}

/**
 * Everyone pays, including the people who run the instance. There is no exempt
 * list to keep in sync with reality — an admin who wants to host someone (or
 * himself) for free simply credits the balance from the admin panel.
 *
 * The one thing that must stay true: an admin locked out by his own unpaid bill
 * has to be able to fix it. The write guard therefore lets OWNER/ADMIN reach the
 * admin routes even while frozen.
 */
export const isBilled = (): boolean => isBillingEnabled()
