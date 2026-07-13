import type { Language } from '@/i18n/translations'
import { pickLocalized } from './localized'
import { stripLeadingEmoji } from './displayText'

// The system Inbox project and module-projects store a fixed Russian name in the
// DB (set at provision/install time). Everything that shows a project name must
// resolve it through here, or the English UI leaks "Входящие" / "Финансы".
export function systemProjectName(language: Language): string {
  return language === 'en' ? 'Inbox' : language === 'be' ? 'Уваходныя' : 'Входящие'
}

interface NamedProject {
  name: string
  isSystem?: boolean
  isModule?: boolean
  moduleId?: string | null
}

export function projectDisplayName(
  project: NamedProject | null | undefined,
  language: Language,
  catalog?: { moduleId: string; name: Record<string, string> }[],
): string {
  if (!project) return ''
  if (project.isSystem) return systemProjectName(language)
  if (project.isModule && catalog?.length) {
    return pickLocalized(catalog.find((m) => m.moduleId === project.moduleId)?.name, language) || stripLeadingEmoji(project.name)
  }
  return stripLeadingEmoji(project.name)
}
