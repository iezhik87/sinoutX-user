import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

export type LicensePlan = 'team' | 'business'

/** Format: SXP- (team), SXB- (business). */
export function generateLicenseKey(plan: LicensePlan): string {
  const prefix = plan === 'business' ? 'SXB' : 'SXP'
  const seg = () => Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${prefix}-${seg()}-${seg()}-${seg()}`
}

export interface IssueLicenseInput {
  plan: LicensePlan
  email?: string | null
  note?: string | null
  expiresAt?: Date | null
}

/** Create a new license key row. Used by admin and by the billing webhook. */
export async function issueLicenseKey(prisma: PrismaClient, input: IssueLicenseInput) {
  return prisma.licenseKey.create({
    data: {
      id: randomUUID(),
      key: generateLicenseKey(input.plan),
      plan: input.plan,
      email: input.email ?? null,
      note: input.note ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  })
}
