// Kill-switch service worker.
//
// A previous version of this file cached the app shell (index.html + hashed JS)
// cache-first, which pinned browsers to a stale bundle across deploys — new code
// never reached users, and API responses could be served from a stale cache.
//
// This version intentionally caches nothing and has no fetch handler. On install
// it wipes every Cache Storage entry, unregisters itself, and reloads open tabs
// so the app is always served fresh from the network. Once it has run in a
// browser, that browser is no longer controlled by any service worker.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    } catch { /* ignore */ }
    try {
      await self.registration.unregister()
    } catch { /* ignore */ }
    const clients = await self.clients.matchAll({ type: 'window' })
    for (const client of clients) {
      try { client.navigate(client.url) } catch { /* ignore */ }
    }
  })())
})
