import { useUIStore } from '@/stores/uiStore'
import { X } from 'lucide-react'
import { useT } from '@/i18n'

export function KeyboardShortcutsOverlay() {
  const { shortcutsOverlayOpen, setShortcutsOverlayOpen } = useUIStore()
  const t = useT()

  const SECTIONS = [
    {
      title: t.shortcuts.navigation,
      shortcuts: [
        { keys: ['g', 'h'], desc: t.shortcuts.home },
        { keys: ['g', 'n'], desc: t.shortcuts.notes },
        { keys: ['g', 'c'], desc: t.shortcuts.calendar },
        { keys: ['g', 'g'], desc: t.shortcuts.graph },
        { keys: ['g', 's'], desc: t.shortcuts.settings },
        { keys: ['g', 't'], desc: t.shortcuts.templates },
      ],
    },
    {
      title: t.shortcuts.actions,
      shortcuts: [
        { keys: ['Ctrl', 'K'], desc: t.shortcuts.search },
        { keys: ['Ctrl', '⇧', 'A'], desc: t.shortcuts.aiAssistant },
        { keys: ['Ctrl', '⇧', 'Space'], desc: t.shortcuts.quickCapture },
        { keys: ['Ctrl', '\\'], desc: t.shortcuts.toggleSidebar },
      ],
    },
    {
      title: t.shortcuts.editor,
      shortcuts: [
        { keys: ['/'], desc: t.shortcuts.slashMenu },
        { keys: ['Tab'], desc: t.shortcuts.embedTask },
        { keys: ['Enter'], desc: t.shortcuts.fromTitle },
      ],
    },
    {
      title: t.shortcuts.general,
      shortcuts: [
        { keys: ['?'], desc: t.shortcuts.showShortcuts },
        { keys: ['ESC'], desc: t.shortcuts.closePanels },
      ],
    },
  ]

  if (!shortcutsOverlayOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
      onClick={() => setShortcutsOverlayOpen(false)}
    >
      <div
        className="bg-surface-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">{t.shortcuts.title}</h2>
          <button
            onClick={() => setShortcutsOverlayOpen(false)}
            className="text-slate-500 hover:text-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
                {section.title}
              </p>
              <div className="space-y-2">
                {section.shortcuts.map((s) => (
                  <div key={s.desc} className="flex items-center justify-between gap-4">
                    <span className="text-xs text-slate-400">{s.desc}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {s.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 text-[10px] font-mono
                                     bg-slate-800 border border-slate-700 rounded text-slate-300"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-slate-800 text-center">
          <span className="text-[11px] text-slate-600">
            {t.shortcuts.closeHint} <kbd className="bg-slate-800 border border-slate-700 px-1 rounded text-[10px]">?</kbd> {t.shortcuts.closeHint2} <kbd className="bg-slate-800 border border-slate-700 px-1 rounded text-[10px]">ESC</kbd> {t.shortcuts.closeHint3}
          </span>
        </div>
      </div>
    </div>
  )
}
