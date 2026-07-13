import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MapBlockView } from './MapBlockView'

// ─── URL converter ─────────────────────────────────────────────────────────────

export type MapProvider = 'google' | 'yandex' | 'osm' | 'unknown'

export function toMapEmbedUrl(input: string): { url: string; provider: MapProvider; label: string } {
  const s = input.trim()

  // Already embed-ready
  if (s.includes('maps/embed') || s.includes('map-widget') || s.includes('export/embed')) {
    const p: MapProvider = s.includes('google') ? 'google' : s.includes('yandex') ? 'yandex' : 'osm'
    return { url: s, provider: p, label: providerLabel(p) }
  }

  // Google Maps
  if (s.includes('google.com/maps') || s.includes('maps.google.com') || s.includes('maps.app.goo.gl')) {
    // Extract coordinates from place URLs: /@lat,lng,zoom
    const coordMatch = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+)/)
    if (coordMatch) {
      const [, lat, lng] = coordMatch
      return {
        url: `https://maps.google.com/maps?q=${lat},${lng}&output=embed`,
        provider: 'google',
        label: 'Google Maps',
      }
    }
    // Extract query from ?q=...
    try {
      const u = new URL(s.replace('maps.google.com', 'maps.google.com'))
      const q = u.searchParams.get('q')
      if (q) return { url: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, provider: 'google', label: 'Google Maps' }
    } catch { /* skip */ }
    // Fallback: add output=embed
    const sep = s.includes('?') ? '&' : '?'
    return { url: `${s}${sep}output=embed`, provider: 'google', label: 'Google Maps' }
  }

  // Yandex Maps
  if (s.includes('yandex.ru/maps') || s.includes('yandex.com/maps')) {
    try {
      const u = new URL(s)
      // ll=lng,lat&z=zoom
      const ll = u.searchParams.get('ll') ?? u.searchParams.get('pt')
      const z  = u.searchParams.get('z') ?? '14'
      if (ll) {
        return { url: `https://yandex.ru/map-widget/v1/?ll=${ll}&z=${z}&l=map`, provider: 'yandex', label: 'Яндекс Карты' }
      }
      return { url: `https://yandex.ru/map-widget/v1/${u.search}`, provider: 'yandex', label: 'Яндекс Карты' }
    } catch {
      return { url: s, provider: 'yandex', label: 'Яндекс Карты' }
    }
  }

  // OpenStreetMap
  if (s.includes('openstreetmap.org')) {
    const hashMatch = s.match(/#map=(\d+)\/(-?\d+\.?\d*)\/(-?\d+\.?\d*)/)
    if (hashMatch) {
      const [, zoom, lat, lng] = hashMatch
      const z     = parseInt(zoom)
      const delta = 360 / Math.pow(2, z + 1)
      const la    = parseFloat(lat)
      const lo    = parseFloat(lng)
      return {
        url: `https://www.openstreetmap.org/export/embed.html?bbox=${lo-delta},${la-delta/2},${lo+delta},${la+delta/2}&layer=mapnik&marker=${la},${lo}`,
        provider: 'osm',
        label: 'OpenStreetMap',
      }
    }
    return { url: s, provider: 'osm', label: 'OpenStreetMap' }
  }

  // Plain address or coordinates → Google Maps embed
  if (!s.startsWith('http')) {
    return {
      url: `https://maps.google.com/maps?q=${encodeURIComponent(s)}&output=embed`,
      provider: 'google',
      label: 'Google Maps',
    }
  }

  return { url: s, provider: 'unknown', label: 'Карта' }
}

function providerLabel(p: MapProvider): string {
  if (p === 'google') return 'Google Maps'
  if (p === 'yandex') return 'Яндекс Карты'
  if (p === 'osm')    return 'OpenStreetMap'
  return 'Карта'
}

// ─── TipTap node ───────────────────────────────────────────────────────────────

export const MapBlockExtension = Node.create({
  name: 'mapBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src:      { default: null },
      provider: { default: 'google' },
      label:    { default: 'Карта' },
      height:   { default: '400' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-map-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { 'data-map-block': 'true', class: 'map-block my-3' },
      [
        'iframe',
        {
          src: HTMLAttributes.src,
          width: '100%',
          height: HTMLAttributes.height,
          frameborder: '0',
          allowfullscreen: 'true',
          loading: 'lazy',
          referrerpolicy: 'no-referrer-when-downgrade',
          class: 'map-block__iframe',
        },
      ],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MapBlockView as unknown as Parameters<typeof ReactNodeViewRenderer>[0])
  },

  addCommands() {
    return {
      insertMapBlock:
        (attrs: { src: string; provider?: string; label?: string; height?: string }) =>
        (props: { commands: { insertContent: (c: Record<string, unknown>) => boolean } }) => {
          return props.commands.insertContent({ type: this.name, attrs })
        },
    } as Record<string, unknown>
  },
})
