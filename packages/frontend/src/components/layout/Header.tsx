import { PanelLeftClose, PanelLeftOpen, Zap, Menu } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'

interface HeaderProps {
  title?: string | React.ReactNode
  actions?: React.ReactNode
}

export function Header({ title, actions }: HeaderProps) {
  const { sidebarOpen, toggleSidebar, toggleQuickCapture } = useUIStore()

  return (
    <header className="flex items-center justify-between h-12 px-3 sm:px-4 flex-shrink-0" style={{ background: 'var(--bg-header)', borderBottom: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <button onClick={toggleSidebar} className="btn-ghost p-1.5 flex-shrink-0" title="Меню" aria-label="Меню">
          {/* Mobile: a universally recognised hamburger; desktop: panel toggle. */}
          <Menu size={20} className="sm:hidden" />
          {sidebarOpen ? <PanelLeftClose size={16} className="hidden sm:block" /> : <PanelLeftOpen size={16} className="hidden sm:block" />}
        </button>
        {title && (
          typeof title === 'string'
            ? <h1 className="text-sm font-medium text-slate-300 truncate">{title}</h1>
            : <div className="text-sm font-medium text-slate-300 min-w-0 flex-1">{title}</div>
        )}
      </div>
      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0 pl-2">
        {actions}
        <button
          onClick={toggleQuickCapture}
          className="btn-ghost p-1.5 sm:hidden flex-shrink-0"
          title="Быстрый захват (Ctrl+Shift+Space)"
        >
          <Zap size={15} />
        </button>
      </div>
    </header>
  )
}
