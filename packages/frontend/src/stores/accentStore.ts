import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AccentPreset = 'violet' | 'blue' | 'indigo' | 'cyan' | 'emerald' | 'rose' | 'amber' | 'orange'

export const ACCENT_LABELS: Record<AccentPreset, string> = {
  violet: 'Violet', blue: 'Blue', indigo: 'Indigo', cyan: 'Cyan',
  emerald: 'Emerald', rose: 'Rose', amber: 'Amber', orange: 'Orange',
}

export const ACCENT_SWATCHES: Record<AccentPreset, string> = {
  violet: '#7c6af7', blue: '#3b82f6', indigo: '#6366f1', cyan: '#06b6d4',
  emerald: '#10b981', rose: '#f43f5e', amber: '#f59e0b', orange: '#f97316',
}

function applyAccent(accent: AccentPreset) {
  document.documentElement.setAttribute('data-accent', accent)
}

interface AccentState {
  accent: AccentPreset
  setAccent: (a: AccentPreset) => void
}

export const useAccentStore = create<AccentState>()(
  persist(
    (set) => ({
      accent: 'violet',
      setAccent: (accent) => {
        set({ accent })
        applyAccent(accent)
      },
    }),
    { name: 'sinoutx-accent' },
  ),
)

export function initAccent() {
  const stored = localStorage.getItem('sinoutx-accent')
  try {
    const parsed = stored ? JSON.parse(stored) : null
    const accent: AccentPreset = parsed?.state?.accent ?? 'violet'
    applyAccent(accent)
  } catch {
    applyAccent('violet')
  }
}
