import { create } from 'zustand'

/**
 * Whether this account may write.
 *
 * Filled from two directions, because a freeze can happen at either moment:
 * `/auth/me` reports one that predates the session, and the 402 interceptor
 * catches one that happens during it. Not persisted — the server is the truth,
 * and a stale "frozen" in localStorage would lock a user who has already paid.
 */
interface BillingState {
  frozen: boolean
  setFrozen: (frozen: boolean) => void
}

export const useBillingStore = create<BillingState>((set) => ({
  frozen: false,
  setFrozen: (frozen) => set({ frozen }),
}))
