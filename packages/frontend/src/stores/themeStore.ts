import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light' | 'glass' | 'hud' | 'latte' | 'dawn'

interface ThemeState {
  theme: Theme
  setTheme: (t: Theme) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'light',
      setTheme: (theme) => {
        set({ theme })
        document.documentElement.setAttribute('data-theme', theme)
      },
    }),
    { name: 'sinoutx-theme' },
  ),
)

export function initTheme() {
  const stored = localStorage.getItem('sinoutx-theme')
  try {
    const parsed = stored ? JSON.parse(stored) : null
    const theme: Theme = parsed?.state?.theme ?? 'light'
    document.documentElement.setAttribute('data-theme', theme)
  } catch {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
}
