import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useLanguageStore } from '@/stores/languageStore'
import { getIntlLocale } from '@/i18n/dateLocale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Follows the UI language, not the OS locale (was hard-coded to ru-RU).
export function formatDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(locale ?? getIntlLocale(useLanguageStore.getState().language), { dateStyle: 'medium' }).format(d)
}
