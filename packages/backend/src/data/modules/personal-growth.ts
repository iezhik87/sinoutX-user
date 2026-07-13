// Built-in "feature" module «Личный рост». Unlike data modules (Finance/Medical
// Record), it stores nothing in the Collections engine — it WRAPS the existing
// built-in screens (habits, OKR goals, journal) so they become an installable,
// optional module. Installing it surfaces the /growth section in the sidebar;
// uninstalling hides it. The underlying data lives in its own tables and is
// never touched by install/uninstall.
export const personalGrowth = {
  id: 'personal-growth',
  version: '1.0.0',
  name: { ru: 'Личный рост', en: 'Personal Growth', be: 'Асабісты рост' },
  description: {
    ru: 'Привычки, цели (OKR) и дневник — в одном месте. Отслеживай прогресс и рефлексируй. Данные не покидают ваш сервер.',
    en: 'Habits, goals (OKR) and a journal in one place. Track progress and reflect. Data stays on your server.',
    be: 'Звычкі, мэты (OKR) і дзённік у адным месцы. Адсочвай прагрэс і рэфлексуй.',
  },
  icon: 'lucide:TrendingUp',
  author: 'SinoutX',
  collections: [],
}
