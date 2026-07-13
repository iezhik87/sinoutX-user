import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Language } from '@/i18n/translations'

interface LanguageState {
  language: Language
  setLanguage: (lang: Language) => void
}

function detectBrowserLanguage(): Language {
  const lang = navigator.language?.toLowerCase() ?? ''
  if (lang.startsWith('be')) return 'be'
  if (lang.startsWith('ru')) return 'ru'
  return 'en'
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      language: detectBrowserLanguage(),
      setLanguage: (language) => set({ language }),
    }),
    { name: 'sinoutx-language' },
  ),
)
