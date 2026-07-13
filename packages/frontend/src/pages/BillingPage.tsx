import { Header } from '@/components/layout/Header'
import { useT } from '@/i18n/useT'
import { PlanTab } from './SettingsPage'

/**
 * Plan, wallet and payment — reachable from the account menu, not buried in
 * Settings. Money is an account matter, and the account lives under your name.
 *
 * The body is `PlanTab` verbatim: two copies of a billing screen would drift,
 * and the one that drifts is always the one showing the price.
 */
export function BillingPage() {
  const t = useT()
  return (
    <div className="flex flex-col h-full">
      <Header title={t.settings.tabs.plan} />
      <div className="flex-1 overflow-y-auto p-6">
        <PlanTab />
      </div>
    </div>
  )
}
