// Pick a string from an i18n map (module/collection names come as { ru, en, ... }).
export function pickLocalized(map: Record<string, string> | null | undefined, lang = 'ru'): string {
  if (!map) return ''
  return map[lang] ?? map.ru ?? map.en ?? Object.values(map)[0] ?? ''
}
