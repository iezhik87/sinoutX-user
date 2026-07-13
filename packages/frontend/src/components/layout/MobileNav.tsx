import { useLocation, useNavigate } from 'react-router-dom'
import { MessageCircle, ListTodo, FolderKanban } from 'lucide-react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

// The phone's primary navigation: a fixed bottom bar. The persistent desktop
// sidebar is hidden on mobile, so this is how you move between the agent chat,
// your tasks, and your projects. Cloud-only (gated by the caller).
export function MobileNav({
  chatOpen,
  onOpenChat,
  onOpenProjects,
}: {
  chatOpen: boolean
  onOpenChat: () => void
  onOpenProjects: () => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // The middle tab is the dashboard home — it aggregates today's tasks + overview.
  const onHome = !chatOpen && pathname === '/'
  const items = [
    { key: 'chat', label: t.ai.title, icon: MessageCircle, active: chatOpen, onClick: onOpenChat },
    { key: 'home', label: t.sidebar.dashboard, icon: ListTodo, active: onHome, onClick: () => navigate('/') },
    { key: 'projects', label: t.sidebar.projects, icon: FolderKanban, active: false, onClick: onOpenProjects },
  ]

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t"
      style={{
        background: 'var(--bg-elevated, #0f172a)',
        borderColor: 'var(--border-subtle, rgba(255,255,255,.08))',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {items.map((it) => {
        const Icon = it.icon
        return (
          <button
            key={it.key}
            onClick={it.onClick}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
              it.active ? 'text-primary-400' : 'text-slate-500 hover:text-slate-300',
            )}
          >
            <Icon size={22} strokeWidth={it.active ? 2.4 : 2} />
            <span className="truncate max-w-[80px]">{it.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
