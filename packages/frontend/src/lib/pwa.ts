// PWA install — OUR CLOUD ONLY. The manifest + apple meta are kept out of
// index.html and injected here so a self-hosted instance stays a plain website
// with no "install app" behaviour. No caching service worker is registered (a
// previous one pinned browsers to stale bundles); "add to home screen" needs
// only the manifest + apple meta, not a worker.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallPromptEvent | null = null
let initialized = false

export function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function isStandalone(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
}

/** Call once when the instance is confirmed to be our cloud. */
export function initCloudPwa(): void {
  if (initialized) return
  initialized = true

  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = '/manifest.json'
    document.head.appendChild(link)
  }
  const metas: [string, string][] = [
    ['apple-mobile-web-app-capable', 'yes'],
    ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
    ['apple-mobile-web-app-title', 'SinoutX'],
  ]
  for (const [name, content] of metas) {
    if (!document.querySelector(`meta[name="${name}"]`)) {
      const m = document.createElement('meta')
      m.name = name
      m.content = content
      document.head.appendChild(m)
    }
  }

  // A network-first worker so the browser will actually offer "Install" (many
  // Chromium browsers require a fetch-handling worker). It never serves a stale
  // shell — see app-sw.js. Self-hosted never gets here, so it stays worker-free.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/app-sw.js').catch(() => {})
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    window.dispatchEvent(new Event('pwa:available'))
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    window.dispatchEvent(new Event('pwa:installed'))
  })
}

/** True when the browser offered a native install prompt (Android/Chrome). */
export function canPromptInstall(): boolean {
  return deferred !== null
}

/** Fire the native install prompt. Returns true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  return outcome === 'accepted'
}
