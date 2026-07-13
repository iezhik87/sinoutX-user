import { useState, useEffect } from 'react'
import { WifiOff, Download } from 'lucide-react'
import { useT } from '@/i18n'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)

    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)

    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const t = useT()

  const handleInstall = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstallPrompt(null)
  }

  return (
    <>
      {isOffline && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2
                        bg-amber-900/90 border border-amber-700 text-amber-200 text-xs
                        px-4 py-2 rounded-full shadow-lg backdrop-blur-sm">
          <WifiOff size={13} />
          <span>{t.offline.message}</span>
        </div>
      )}
      {installPrompt && !isOffline && (
        <button
          onClick={handleInstall}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2
                     bg-surface-800 border border-slate-700 text-slate-300 text-xs
                     px-4 py-2 rounded-full shadow-lg hover:border-primary-600 transition-colors"
        >
          <Download size={13} />
          <span>{t.offline.install}</span>
        </button>
      )}
    </>
  )
}
