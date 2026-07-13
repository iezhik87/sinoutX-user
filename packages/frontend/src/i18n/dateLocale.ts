import { ru, be } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import type { Language } from './translations'

const locales: Partial<Record<Language, Locale>> = { ru, be }

export function getDateLocale(language: Language): Locale | undefined {
  return locales[language]
}

// BCP-47 tag for Intl / toLocaleDateString. Passing `undefined` there falls back
// to the OS locale, which showed Russian dates in the English UI.
export function getIntlLocale(language: Language): string {
  return language === 'en' ? 'en-US' : language === 'be' ? 'be-BY' : 'ru-RU'
}
