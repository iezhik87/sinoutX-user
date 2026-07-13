import { useEffect, useState } from 'react'
import { Download, X, Share } from 'lucide-react'
import { canPromptInstall, promptInstall, isIosDevice, isStandalone } from '@/lib/pwa'

const DISMISS_KEY = 'pwa-install-dismissed'

// A one-time nudge to install the app to the home screen. Shown only on the
// mobile cloud app (the caller gates it), never once already installed, and
// dismissible for good. Android/Chrome get a real install button; iOS Safari has
// no install API, so it gets the manual "Share → Add to Home Screen" hint.
export function MobileInstallBanner({ bottomOffset }: { bottomOffset: number }) {
  const [available, setAvailable] = useState(canPromptInstall())
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')
  const ios = isIosDevice()

  useEffect(() => {
    const onAvail = () => setAvailable(true)
    const onInstalled = () => { setDismissed(true); localStorage.setItem(DISMISS_KEY, '1') }
    window.addEventListener('pwa:available', onAvail)
    window.addEventListener('pwa:installed', onInstalled)
    return () => {
      window.removeEventListener('pwa:available', onAvail)
      window.removeEventListener('pwa:installed', onInstalled)
    }
  }, [])

  if (dismissed || isStandalone()) return null
  // Nothing to offer unless Android gave us a prompt or it's an iOS device.
  if (!available && !ios) return null

  const close = () => { setDismissed(true); localStorage.setItem(DISMISS_KEY, '1') }
  const install = async () => { const ok = await promptInstall(); if (ok) close() }

  return (
    <div
      className="fixed inset-x-0 z-40 px-3"
      style={{ bottom: `calc(${bottomOffset}px + env(safe-area-inset-bottom) + 8px)` }}
    >
      <div className="flex items-center gap-3 rounded-xl border border-primary-500/30 bg-primary-600/15 backdrop-blur px-3 py-2.5 shadow-lg">
        <div className="w-9 h-9 rounded-lg bg-primary-600/30 flex items-center justify-center flex-shrink-0 text-primary-300">
          <Download size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-100 leading-tight">Установить SinoutX</p>
          {ios && !available ? (
            <p className="text-[11px] text-slate-400 leading-tight mt-0.5 flex items-center gap-1">
              Нажми <Share size={11} className="inline" /> → «На экран „Домой“»
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 leading-tight mt-0.5">Как приложение, на весь экран</p>
          )}
        </div>
        {available && (
          <button onClick={install} className="btn btn-primary text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0">
            Установить
          </button>
        )}
        <button onClick={close} className="p-1 text-slate-500 hover:text-slate-300 flex-shrink-0" aria-label="Закрыть">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
