import { useSearchParams } from 'react-router-dom'
import { Target, Flame, BookOpen } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { OKRPage } from './OKRPage'
import { HabitsPage } from './HabitsPage'
import { JournalPage } from './JournalPage'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

type GrowthTab = 'goals' | 'habits' | 'journal'

const TAB_ICONS: Record<GrowthTab, typeof Target> = {
  goals: Target,
  habits: Flame,
  journal: BookOpen,
}

export function GrowthPage() {
  const t = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as GrowthTab) ?? 'habits'

  function setTab(next: GrowthTab) {
    setSearchParams({ tab: next }, { replace: true })
  }

  const tabs: { key: GrowthTab; label: string }[] = [
    { key: 'habits', label: t.growth.habitsTab },
    { key: 'goals', label: t.growth.goalsTab },
    { key: 'journal', label: t.growth.journalTab },
  ]

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t.growth.title}
        actions={
          <div className="flex items-center bg-surface-800 border border-slate-700 rounded-lg p-0.5 gap-0.5">
            {tabs.map(({ key, label }) => {
              const Icon = TAB_ICONS[key]
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    tab === key
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-surface-700',
                  )}
                >
                  <Icon size={12} />
                  {label}
                </button>
              )
            })}
          </div>
        }
      />
      <div className="flex-1 overflow-hidden">
        {tab === 'habits' && <HabitsPage embedded />}
        {tab === 'goals' && <OKRPage embedded />}
        {tab === 'journal' && <JournalPage embedded />}
      </div>
    </div>
  )
}
