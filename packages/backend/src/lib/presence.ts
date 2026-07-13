// In-memory presence tracker: who has made an authenticated request recently.
// Single-instance only (resets on restart) — fine for a self-hosted backend.

interface SeenUser {
  id: string
  email: string
  name: string
  role: string
  via: 'jwt' | 'apikey'
  lastSeen: number
}

const seen = new Map<string, SeenUser>()

export function markSeen(u: { id: string; email: string; name: string; role: string }, via: 'jwt' | 'apikey') {
  seen.set(u.id, { id: u.id, email: u.email, name: u.name, role: u.role, via, lastSeen: Date.now() })
}

// Users seen within `windowMs` (default 5 min), newest first. Also prunes
// entries older than an hour so the map can't grow unbounded.
export function getOnline(windowMs = 5 * 60_000): SeenUser[] {
  const now = Date.now()
  for (const [k, v] of seen) if (now - v.lastSeen > 3600_000) seen.delete(k)
  return [...seen.values()].filter((s) => now - s.lastSeen <= windowMs).sort((a, b) => b.lastSeen - a.lastSeen)
}
