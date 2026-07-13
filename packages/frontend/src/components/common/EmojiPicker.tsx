import { useState, useRef, useEffect } from 'react'
import { Search,
  FolderKanban, FolderOpen, BookOpen, BookMarked, FileText, Files, Archive, ClipboardList,
  Briefcase, Target, Rocket, Zap, Star, Trophy, Award, CheckCircle,
  Code2, Terminal, Database, Globe, Cpu, Server, Layers, LayoutDashboard,
  Lightbulb, Palette, Camera, Music, Film, PenLine,
  Heart, Coffee, Home, Map, Compass, Leaf, Flame, Feather,
  Key, Shield, Settings2, Wrench, Box, Package, Tag, Bookmark,
  ImagePlus, Sparkles, CheckSquare, StickyNote, DollarSign, Paperclip,
  GitBranch, QrCode, Barcode,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'

// ─── Lucide icon registry ─────────────────────────────────────────────────────

type IconComponent = React.FC<LucideProps>

export const LUCIDE_ICON_MAP: Record<string, IconComponent> = {
  FolderKanban, FolderOpen, BookOpen, BookMarked, FileText, Files, Archive, ClipboardList,
  Briefcase, Target, Rocket, Zap, Star, Trophy, Award, CheckCircle,
  Code2, Terminal, Database, Globe, Cpu, Server, Layers, LayoutDashboard,
  Lightbulb, Palette, Camera, Music, Film, PenLine,
  Heart, Coffee, Home, Map, Compass, Leaf, Flame, Feather,
  Key, Shield, Settings2, Wrench, Box, Package, Tag, Bookmark,
  ImagePlus, Sparkles, CheckSquare, StickyNote, DollarSign, Paperclip, GitBranch,
  QrCode, Barcode,
}

const LUCIDE_CATEGORIES = [
  {
    label: 'folders',
    icons: ['FolderKanban', 'FolderOpen', 'BookOpen', 'BookMarked', 'FileText', 'Files', 'Archive', 'ClipboardList'],
  },
  {
    label: 'work',
    icons: ['Briefcase', 'Target', 'Rocket', 'Zap', 'Star', 'Trophy', 'Award', 'CheckCircle'],
  },
  {
    label: 'tech',
    icons: ['Code2', 'Terminal', 'Database', 'Globe', 'Cpu', 'Server', 'Layers', 'LayoutDashboard'],
  },
  {
    label: 'creative',
    icons: ['Lightbulb', 'Palette', 'Camera', 'Music', 'Film', 'PenLine', 'Feather', 'Flame'],
  },
  {
    label: 'other',
    icons: ['Heart', 'Coffee', 'Home', 'Map', 'Compass', 'Leaf', 'Key', 'Shield', 'Settings2', 'Wrench', 'Box', 'Package', 'Tag', 'Bookmark'],
  },
]

const CATEGORY_LABELS: Record<string, { ru: string; en: string; be: string }> = {
  folders:  { ru: 'Документы',    en: 'Documents',  be: 'Дакументы'   },
  work:     { ru: 'Работа',       en: 'Work',       be: 'Праца'       },
  tech:     { ru: 'Технологии',   en: 'Technology', be: 'Тэхналогіі'  },
  creative: { ru: 'Творчество',   en: 'Creative',   be: 'Творчасць'   },
  other:    { ru: 'Другое',       en: 'Other',      be: 'Іншае'       },
}

// ─── Render helper (use everywhere to display icons) ─────────────────────────

// Icons are stored as `lucide:Name`. Legacy records may still hold a raw emoji;
// we deliberately DO NOT render those — the UI uses one clean line-icon set, not
// a mix of mismatched emoji. A legacy emoji falls back to `fallback` (a Lucide
// name), so existing projects/tasks show a tidy icon without a data migration.
export function renderIcon(
  icon: string | null | undefined,
  size = 14,
  className = 'text-slate-400',
  fallback: string = 'FileText',
): React.ReactNode {
  const FallbackComp = LUCIDE_ICON_MAP[fallback]
  if (!icon) return null
  if (icon.startsWith('lucide:')) {
    const name = icon.slice(7)
    const Comp = LUCIDE_ICON_MAP[name]
    if (Comp) return <Comp size={size} className={className} />
  }
  // Legacy emoji (or any non-lucide/unknown value) → clean fallback icon, never the emoji.
  return FallbackComp ? <FallbackComp size={size} className={className} /> : null
}

// ─── Picker component ─────────────────────────────────────────────────────────
// Icons only — a single clean line-icon set. The old emoji tab was removed on
// purpose: a mix of emoji looked inconsistent, so new records only get Lucide
// icons (legacy emoji still stored are transparently rendered as a fallback icon).

interface EmojiPickerProps {
  value?: string
  onChange: (icon: string) => void
  onClose: () => void
}

export function EmojiPicker({ value, onChange, onClose }: EmojiPickerProps) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const c = t.common

  return (
    <div
      ref={containerRef}
      className="absolute z-30 top-full left-0 mt-1 w-72 bg-surface-900 border border-slate-700 rounded-xl shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-2 border-b border-slate-800 text-xs font-medium text-slate-300">
        <FolderKanban size={12} className="text-primary-400" />
        {c.icons}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <Search size={13} className="text-slate-500 flex-shrink-0" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={c.search}
          className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 focus:outline-none"
        />
      </div>

      <div className="overflow-y-auto max-h-64 p-2">
        <LucideTab search={search} value={value} onSelect={(icon) => { onChange(icon); onClose() }} />
      </div>

      {/* Remove */}
      <div className="border-t border-slate-800 px-3 py-2">
        <button
          onClick={() => { onChange(''); onClose() }}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          {c.removeIcon}
        </button>
      </div>
    </div>
  )
}

function LucideTab({
  search, value, onSelect,
}: {
  search: string; value?: string; onSelect: (icon: string) => void
}) {
  const { language: lang } = useLanguageStore()
  const t = useT()
  const allNames = LUCIDE_CATEGORIES.flatMap((c) => c.icons)
  const filtered = search.trim()
    ? allNames.filter((n) => n.toLowerCase().includes(search.toLowerCase()))
    : null

  const renderName = (name: string) => {
    const Comp = LUCIDE_ICON_MAP[name]
    if (!Comp) return null
    const isActive = value === `lucide:${name}`
    return (
      <button
        key={name}
        onClick={() => onSelect(`lucide:${name}`)}
        title={name}
        className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
          isActive
            ? 'bg-primary-600 text-white'
            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
        }`}
      >
        <Comp size={16} />
      </button>
    )
  }

  if (filtered) {
    return (
      <div className="flex flex-wrap gap-0.5">
        {filtered.length === 0
          ? <p className="text-xs text-slate-600 p-2">{t.common.noData}</p>
          : filtered.map(renderName)}
      </div>
    )
  }

  return (
    <>
      {LUCIDE_CATEGORIES.map((cat) => (
        <div key={cat.label} className="mb-3">
          <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1.5 px-1">
            {(CATEGORY_LABELS[cat.label]?.[lang as 'ru' | 'en' | 'be']) ?? cat.label}
          </p>
          <div className="flex flex-wrap gap-0.5">
            {cat.icons.map(renderName)}
          </div>
        </div>
      ))}
    </>
  )
}
