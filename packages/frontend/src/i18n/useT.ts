import { useLanguageStore } from '@/stores/languageStore'
import { translations } from './translations'
import type { TranslationKeys } from './translations'

/** Returns the full translation object for the current language */
export function useT(): TranslationKeys {
  const { language } = useLanguageStore()
  return translations[language]
}
