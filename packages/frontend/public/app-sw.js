/* Minimal, NETWORK-FIRST service worker — our cloud only.
 *
 * Its whole job is to make the app installable (browsers want a fetch handler
 * before they offer "Install") WITHOUT ever pinning a stale bundle — the exact
 * bug the previous cache-first worker caused. Navigations always go to the
 * network first; the cache is only an offline fallback. Hashed build assets are
 * safe to cache because a new build ships new filenames.
 */
const CACHE = 'sinout-app-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop every other cache — including the old cache-first bundle cache that
    // used to pin stale JS.
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // The API is always live — never cache or intercept it.
  if (url.pathname.startsWith('/api/')) return

  // HTML / navigation → network-first, so the shell is never stale.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res })
        .catch(() => caches.match(req).then((r) => r || caches.match('/'))),
    )
    return
  }

  // Other same-origin GETs (hashed assets, icons, manifest) → stale-while-
  // revalidate: instant from cache, refreshed in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const cached = await cache.match(req)
    const network = fetch(req)
      .then((res) => { if (res.ok) cache.put(req, res.clone()); return res })
      .catch(() => cached)
    return cached || network
  })())
})
