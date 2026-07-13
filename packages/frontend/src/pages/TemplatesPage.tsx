import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Loader2, Trash2, ArrowRight, FileText, FolderKanban, Sparkles,
  Pencil, EyeOff, Eye, X, Search,
} from 'lucide-react'
import { templateApi, type PageTemplate } from '@/api/templates'
import { projectApi, pageApi, type ProjectTemplate, aiTemplateApi, type AiProjectTemplate } from '@/api/client'
import { BUILTIN_PAGE_TEMPLATES, BUILTIN_CATEGORIES, TEMPLATE_BE, type BuiltinPageTemplate } from '@/data/builtinPageTemplates'
import type { Localized } from '@/i18n'

function useBuiltinTemplates() {
  return { BUILTIN_PAGE_TEMPLATES, BUILTIN_CATEGORIES }
}

type TmplLike = { id: string; ru: { name: string; desc: string }; en: { name: string; desc: string } }

function tmplInfo(tmpl: TmplLike & { be?: { name: string; desc: string } }, language: string): { name: string; desc: string } {
  if (language === 'be') return (tmpl as any).be ?? TEMPLATE_BE[tmpl.id] ?? tmpl.ru
  if (language === 'en') return tmpl.en
  return tmpl.ru
}

function categoryLabel(cat: { id: string; ru: string; en: string; be?: string }, language: string): string {
  if (language === 'be') return cat.be ?? cat.ru
  if (language === 'en') return cat.en
  return cat.ru
}
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useLanguageStore } from '@/stores/languageStore'
import { Header } from '@/components/layout/Header'
import { Modal } from '@/components/common/Modal'
import { renderIcon, LUCIDE_ICON_MAP } from '@/components/common/EmojiPicker'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

// ─── Types ────────────────────────────────────────────────────────────────────

type TemplateMeta = { name: string; desc: string; meta: string; instructions: string }
interface AiTemplateInfo extends Localized<TemplateMeta> {
  id: ProjectTemplate
  icon: string        // lucide:Name
  builtIn: true
}

type CustomAiTemplate = AiProjectTemplate & { builtIn?: false }

type AnyTemplate = AiTemplateInfo | CustomAiTemplate

// ─── Built-in definitions ─────────────────────────────────────────────────────

const BUILT_IN_TEMPLATES: AiTemplateInfo[] = [
  {
    id: 'basic', icon: 'lucide:FolderKanban', builtIn: true,
    ru: {
      name: 'Базовый проект', desc: 'Общий обзор темы, ключевые аспекты и ресурсы', meta: '4–6 стр · 3–5 задач',
      instructions: `ШАБЛОН: Базовый проект
- Страниц: 4–6 (обзор темы, ключевые аспекты, ресурсы, задачи/план)
- Задач: 3–5 (основные шаги работы)
- Заметок: 1–2 (ключевые идеи)
- Поиск: 1 раунд web_search, сохрани 5–8 источников через save_sources_batch
- Объём страниц: 200–350 слов каждая
- Акцент: быстрый старт, общий обзор темы`,
    },
    en: {
      name: 'Basic project', desc: 'General overview, key aspects and resources', meta: '4–6 pages · 3–5 tasks',
      instructions: `TEMPLATE: Basic project
- Pages: 4–6 (topic overview, key aspects, resources, tasks/plan)
- Tasks: 3–5 (main steps)
- Notes: 1–2 (key ideas)
- Search: 1 round of web_search, save 5–8 sources via save_sources_batch
- Page length: 200–350 words each
- Focus: quick start, general topic overview`,
    },
    be: {
      name: 'Базавы праект', desc: 'Агульны агляд тэмы, ключавыя аспекты і рэсурсы', meta: '4–6 стар · 3–5 задач',
      instructions: `ШАБЛОН: Базавы праект
- Старонак: 4–6 (агляд тэмы, ключавыя аспекты, рэсурсы, задачы/план)
- Задач: 3–5 (асноўныя крокі працы)
- Нататак: 1–2 (ключавыя ідэі)
- Пошук: 1 раўнд web_search, захавай 5–8 крыніц праз save_sources_batch
- Аб'ём старонак: 200–350 слоў кожная
- Акцэнт: хуткі старт, агульны агляд тэмы`,
    },
  },
  {
    id: 'deep', icon: 'lucide:Layers', builtIn: true,
    ru: {
      name: 'Углублённый проект', desc: 'Полное исследование с множеством источников и анализом', meta: '10–14 стр · 8–10 задач',
      instructions: `ШАБЛОН: Углублённый проект
- Страниц: 10–14 (обзор, история, теория, практика, примеры, кейсы, аналитика, выводы, ресурсы, глоссарий + доп. разделы)
- Задач: 8–10 (детальный план работы по этапам)
- Заметок: 3–4 (ключевые инсайты, противоречия, открытые вопросы)
- Поиск: минимум 3 раунда web_search по разным аспектам темы, сохрани 15–25 источников
- Объём страниц: 500–800 слов каждая, глубокий анализ с примерами и данными
- Акцент: максимально полное исследование темы, экспертный уровень контента`,
    },
    en: {
      name: 'Deep project', desc: 'Comprehensive research with many sources and analysis', meta: '10–14 pages · 8–10 tasks',
      instructions: `TEMPLATE: Deep project
- Pages: 10–14 (overview, history, theory, practice, examples, case studies, analytics, conclusions, resources, glossary + extra)
- Tasks: 8–10 (detailed phased work plan)
- Notes: 3–4 (key insights, contradictions, open questions)
- Search: minimum 3 rounds of web_search on different aspects, save 15–25 sources
- Page length: 500–800 words each, deep analysis with examples and data
- Focus: maximum comprehensive research, expert-level content`,
    },
    be: {
      name: 'Паглыблены праект', desc: 'Поўнае даследаванне з мноствам крыніц і аналізам', meta: '10–14 стар · 8–10 задач',
      instructions: `ШАБЛОН: Паглыблены праект
- Старонак: 10–14 (агляд, гісторыя, тэорыя, практыка, прыклады, кейсы, аналітыка, высновы, рэсурсы, глосарый + дад. раздзелы)
- Задач: 8–10 (дэталёвы план працы па этапах)
- Нататак: 3–4 (ключавыя інсайты, супярэчнасці, адкрытыя пытанні)
- Пошук: мінімум 3 раўнды web_search па розных аспектах тэмы, захавай 15–25 крыніц
- Аб'ём старонак: 500–800 слоў кожная, глыбокі аналіз з прыкладамі і дадзенымі
- Акцэнт: максімальна поўнае даследаванне тэмы, экспертны ўзровень кантэнту`,
    },
  },
  {
    id: 'educational', icon: 'lucide:BookOpen', builtIn: true,
    ru: {
      name: 'Образовательный', desc: 'КТП, планы уроков, упражнения, методические рекомендации', meta: '8–10 стр · 5–7 задач',
      instructions: `ШАБЛОН: Образовательный проект
- Страниц: 8–10 обязательные разделы:
  1. Общая информация и цели обучения
  2. Учебно-тематический план (КТП) — таблица тем и часов
  3. Методические рекомендации и подходы
  4. Планы уроков (3–4 урока с целями, ходом, заданиями)
  5. Упражнения и практические задания
  6. Контроль и оценивание (критерии, тесты)
  7. Дифференцированный подход (для разных уровней)
  8. Ресурсы и дополнительные материалы
- Задач: 5–7 (подготовка материалов, планирование, контроль)
- Заметки: 2–3 (педагогические наблюдения, советы)
- Поиск: педагогические ресурсы, методики, УМК, стандарты. Сохрани 8–12 источников
- Объём страниц: 300–500 слов, с таблицами и структурированными разделами
- Акцент: практическая применимость, педагогическая обоснованность`,
    },
    en: {
      name: 'Educational', desc: 'Curriculum plan, lesson plans, exercises, methodology', meta: '8–10 pages · 5–7 tasks',
      instructions: `TEMPLATE: Educational project
- Pages: 8–10 required sections:
  1. General info and learning objectives
  2. Curriculum plan — table of topics and hours
  3. Methodological recommendations and approaches
  4. Lesson plans (3–4 lessons with goals, flow, assignments)
  5. Exercises and practical tasks
  6. Assessment and evaluation (criteria, tests)
  7. Differentiated approach (for different levels)
  8. Resources and additional materials
- Tasks: 5–7 (material preparation, planning, assessment)
- Notes: 2–3 (pedagogical observations, tips)
- Search: pedagogical resources, methodologies, textbooks, standards. Save 8–12 sources
- Page length: 300–500 words, with tables and structured sections
- Focus: practical applicability, pedagogical soundness`,
    },
    be: {
      name: 'Адукацыйны', desc: 'КТП, планы ўрокаў, практыкаванні, метадычныя рэкамендацыі', meta: '8–10 стар · 5–7 задач',
      instructions: `ШАБЛОН: Адукацыйны праект
- Старонак: 8–10 абавязковыя раздзелы:
  1. Агульная інфармацыя і мэты навучання
  2. Вучэбна-тэматычны план (КТП) — табліца тэм і гадзін
  3. Метадычныя рэкамендацыі і падыходы
  4. Планы ўрокаў (3–4 урокі з мэтамі, ходам, заданнямі)
  5. Практыкаванні і практычныя заданні
  6. Кантроль і ацэньванне (крытэрыі, тэсты)
  7. Дыферэнцыраваны падыход (для розных узроўняў)
  8. Рэсурсы і дадатковыя матэрыялы
- Задач: 5–7 (падрыхтоўка матэрыялаў, планаванне, кантроль)
- Нататак: 2–3 (педагагічныя назіранні, парады)
- Пошук: педагагічныя рэсурсы, методыкі, ВМК, стандарты. Захавай 8–12 крыніц
- Аб'ём старонак: 300–500 слоў, з табліцамі і структураванымі раздзеламі
- Акцэнт: практычная прымяняльнасць, педагагічная абгрунтаванасць`,
    },
  },
  {
    id: 'economic', icon: 'lucide:Database', builtIn: true,
    ru: {
      name: 'Экономический', desc: 'Финансовый анализ, статистика, SWOT, прогнозы', meta: '8–10 стр · 6–8 задач',
      instructions: `ШАБЛОН: Экономический проект
- Страниц: 8–10 обязательные разделы:
  1. Обзор и общая характеристика (рынок/сектор/компания)
  2. Макроэкономический контекст и тренды
  3. Финансовые показатели и статистика (таблицы с данными)
  4. Анализ рынка и конкурентной среды
  5. Правовое и налоговое регулирование
  6. Риски и возможности (SWOT или аналог)
  7. Прогнозы и сценарии развития
  8. Выводы и рекомендации
- Задач: 6–8 (сбор данных, анализ, проверка гипотез, отчёт)
- Заметки: 2–3 (ключевые цифры, неоднозначные данные)
- Бюджет: добавь в проект 3–5 записей бюджета если применимо
- Поиск: официальная статистика, отраслевые отчёты, новости. Сохрани 10–15 источников
- Объём страниц: 400–600 слов, обязательно используй таблицы и конкретные цифры
- Акцент: конкретные данные, количественный анализ, практические выводы`,
    },
    en: {
      name: 'Economic', desc: 'Financial analysis, statistics, SWOT, forecasts', meta: '8–10 pages · 6–8 tasks',
      instructions: `TEMPLATE: Economic project
- Pages: 8–10 required sections:
  1. Overview and general characteristics (market/sector/company)
  2. Macroeconomic context and trends
  3. Financial indicators and statistics (tables with data)
  4. Market and competitive analysis
  5. Legal and tax regulation
  6. Risks and opportunities (SWOT or equivalent)
  7. Forecasts and development scenarios
  8. Conclusions and recommendations
- Tasks: 6–8 (data collection, analysis, hypothesis testing, reporting)
- Notes: 2–3 (key figures, ambiguous data)
- Budget: add 3–5 budget entries to the project if applicable
- Search: official statistics, industry reports, news. Save 10–15 sources
- Page length: 400–600 words, always use tables and concrete figures
- Focus: concrete data, quantitative analysis, practical conclusions`,
    },
    be: {
      name: 'Эканамічны / бізнес-аналіз', desc: 'Аналіз рынку, бізнес-план, фінансавая мадэль', meta: '8–12 стар · 6–8 задач',
      instructions: `ШАБЛОН: Эканамічны / бізнес-аналіз
- Старонак: 8–10 абавязковыя раздзелы:
  1. Агляд і агульная характарыстыка (рынак/сектар/кампанія)
  2. Макраэканамічны кантэкст і трэнды
  3. Фінансавыя паказчыкі і статыстыка (таблічкі з дадзенымі)
  4. Аналіз рынку і канкурэнтнага асяроддзя
  5. Прававое і падатковае рэгуляванне
  6. Рызыкі і магчымасці (SWOT або аналаг)
  7. Прагнозы і сцэнарыі развіцця
  8. Высновы і рэкамендацыі
- Задач: 6–8 (збор дадзеных, аналіз, праверка гіпотэз, справаздача)
- Нататак: 2–3 (ключавыя лічбы, неадназначныя дадзеныя)
- Бюджэт: дадай у праект 3–5 запісаў бюджэту калі прымяняльна
- Пошук: афіцыйная статыстыка, галіновыя справаздачы, навіны. Захавай 10–15 крыніц
- Аб'ём старонак: 400–600 слоў, абавязкова выкарыстоўвай таблічкі і канкрэтныя лічбы
- Акцэнт: канкрэтныя дадзеныя, колькасны аналіз, практычныя высновы`,
    },
  },
  {
    id: 'research', icon: 'lucide:Compass', builtIn: true,
    ru: {
      name: 'Исследование', desc: 'Гипотеза, методология, анализ данных, научные выводы', meta: '8–12 стр · 5–7 задач',
      instructions: `ШАБЛОН: Научное исследование
- Страниц: 8–12 обязательные разделы:
  1. Введение (актуальность, цели, задачи исследования)
  2. Обзор литературы и состояние вопроса
  3. Теоретическая основа и концептуальная рамка
  4. Гипотеза и исследовательские вопросы
  5. Методология (методы, выборка, процедура)
  6. Сбор и анализ данных
  7. Результаты и их интерпретация
  8. Обсуждение (сравнение с другими исследованиями, ограничения)
  9. Выводы и перспективы дальнейших исследований
  10. Список литературы (оформить как отдельную страницу)
- Задач: 5–7 (этапы исследования, дедлайны)
- Заметки: 3–4 (идеи, противоречия, открытые вопросы)
- Поиск: академические источники, обзорные статьи, сохрани 12–18 источников
- Объём страниц: 450–700 слов, строгий академический стиль
- Акцент: научная строгость, обоснованность выводов, ссылки на источники`,
    },
    en: {
      name: 'Research', desc: 'Hypothesis, methodology, data analysis, conclusions', meta: '8–12 pages · 5–7 tasks',
      instructions: `TEMPLATE: Research project
- Pages: 8–12 required sections:
  1. Introduction (relevance, aims, objectives)
  2. Literature review and state of the field
  3. Theoretical framework and conceptual background
  4. Hypothesis and research questions
  5. Methodology (methods, sample, procedure)
  6. Data collection and analysis
  7. Results and interpretation
  8. Discussion (comparison with other research, limitations)
  9. Conclusions and future research directions
  10. References (formatted as a separate page)
- Tasks: 5–7 (research phases, deadlines)
- Notes: 3–4 (ideas, contradictions, open questions)
- Search: academic sources, review articles, save 12–18 sources
- Page length: 450–700 words, strict academic style
- Focus: scientific rigor, justified conclusions, proper citations`,
    },
    be: {
      name: 'Навукова-даследчы', desc: 'Гіпотэза, агляд літаратуры, метадалогія, выснова', meta: '12–16 стар · 6–8 задач',
      instructions: `ШАБЛОН: Навукова-даследчы праект
- Старонак: 8–12 абавязковыя раздзелы:
  1. Уводзіны (актуальнасць, мэты, задачы даследавання)
  2. Агляд літаратуры і стан пытання
  3. Тэарэтычная аснова і канцэптуальная рамка
  4. Гіпотэза і даследчыя пытанні
  5. Метадалогія (метады, выбарка, працэдура)
  6. Збор і аналіз дадзеных
  7. Вынікі і іх інтэрпрэтацыя
  8. Абмеркаванне (параўнанне з іншымі даследаваннямі, абмежаванні)
  9. Высновы і перспектывы далейшых даследаванняў
  10. Спіс літаратуры (аформіць як асобную старонку)
- Задач: 5–7 (этапы даследавання, дэдлайны)
- Нататак: 3–4 (ідэі, супярэчнасці, адкрытыя пытанні)
- Пошук: навуковыя крыніцы, аглядныя артыкулы, захавай 12–18 крыніц
- Аб'ём старонак: 450–700 слоў, строгі навуковы стыль
- Акцэнт: навуковая строгасць, абгрунтаванасць высноў, спасылкі на крыніцы`,
    },
  },
  {
    id: 'essay', icon: 'lucide:FileText', builtIn: true,
    ru: {
      name: 'Реферат', desc: 'Введение, главы, заключение, список литературы', meta: '6–8 стр · 3–4 задачи',
      instructions: `ШАБЛОН: Реферат
- Страниц: 6–8 обязательные разделы:
  1. Титульный лист (автор, тема, дисциплина, дата)
  2. Введение (актуальность, цель, структура работы — 1–2 абзаца)
  3–5. Основные главы (2–3 главы с подпунктами по теме)
  6. Заключение (краткие выводы)
  7. Список использованных источников
- Задач: 3–4 (поиск источников, написание, оформление, проверка)
- Заметки: 1–2 (ключевые тезисы)
- Поиск: учебные пособия, энциклопедии, научные статьи. Сохрани 6–10 источников
- Объём страниц: 300–450 слов, грамотный академический стиль
- Акцент: чёткая структура, последовательное изложение, список источников в конце`,
    },
    en: {
      name: 'Essay', desc: 'Introduction, chapters, conclusion, bibliography', meta: '6–8 pages · 3–4 tasks',
      instructions: `TEMPLATE: Essay / Review paper
- Pages: 6–8 required sections:
  1. Title page (author, topic, subject, date)
  2. Introduction (relevance, purpose, structure — 1–2 paragraphs)
  3–5. Main chapters (2–3 chapters with subsections on the topic)
  6. Conclusion (brief summary of findings)
  7. References
- Tasks: 3–4 (source search, writing, formatting, review)
- Notes: 1–2 (key arguments)
- Search: textbooks, encyclopedias, academic articles. Save 6–10 sources
- Page length: 300–450 words, proper academic style
- Focus: clear structure, coherent exposition, bibliography at the end`,
    },
    be: {
      name: 'Эсэ / рэферат', desc: 'Структураваны тэкст з аргументацыяй і крыніцамі', meta: '4–8 стар · 2–4 задачы',
      instructions: `ШАБЛОН: Эсэ / рэферат
- Старонак: 6–8 абавязковыя раздзелы:
  1. Тытульны ліст (аўтар, тэма, дысцыпліна, дата)
  2. Уводзіны (актуальнасць, мэта, структура працы — 1–2 абзацы)
  3–5. Асноўныя раздзелы (2–3 главы з падпунктамі па тэме)
  6. Заключэнне (кароткія высновы)
  7. Спіс выкарыстаных крыніц
- Задач: 3–4 (пошук крыніц, напісанне, афармленне, праверка)
- Нататак: 1–2 (ключавыя тэзісы)
- Пошук: вучэбныя дапаможнікі, энцыклапедыі, навуковыя артыкулы. Захавай 6–10 крыніц
- Аб'ём старонак: 300–450 слоў, граматны навуковы стыль
- Акцэнт: дакладная структура, паслядоўны выклад, спіс крыніц у канцы`,
    },
  },
  {
    id: 'presentation', icon: 'lucide:LayoutDashboard', builtIn: true,
    ru: {
      name: 'Презентация', desc: 'Структура слайдов, тезисы, ключевые факты и данные', meta: '6–10 слайдов · 3–5 задач',
      instructions: `ШАБЛОН: Презентация
- Страниц: 6–10, каждая страница = один слайд:
  1. Титульный слайд (тема, автор, дата)
  2. Содержание / Agenda
  3–7. Контентные слайды (3–5 слайдов с ключевыми идеями)
  8. Выводы и ключевые тезисы
  9. Вопросы для обсуждения (если применимо)
  10. Источники
- Каждая страница-слайд содержит: заголовок, 3–5 буллетов, ключевую цитату или цифру
- Задач: 3–5 (подготовка визуалов, репетиция, финальная версия)
- Заметки: 2–3 (идеи для иллюстраций, вопросы от аудитории)
- Поиск: факты, статистика, цитаты. Сохрани 5–8 источников
- Объём страниц: 150–250 слов (тезисно!), структура: заголовок + bullets + данные
- Акцент: лаконичность, визуальная логика, запоминающиеся факты`,
    },
    en: {
      name: 'Presentation', desc: 'Slide structure, bullet points, key facts and data', meta: '6–10 slides · 3–5 tasks',
      instructions: `TEMPLATE: Presentation
- Pages: 6–10, each page = one slide:
  1. Title slide (topic, author, date)
  2. Contents / Agenda
  3–7. Content slides (3–5 slides with key ideas)
  8. Key takeaways and conclusions
  9. Discussion questions (if applicable)
  10. Sources
- Each page-slide contains: heading, 3–5 bullets, a key quote or figure
- Tasks: 3–5 (visual prep, rehearsal, final version)
- Notes: 2–3 (illustration ideas, audience questions)
- Search: facts, statistics, quotes. Save 5–8 sources
- Page length: 150–250 words (bullet points!), structure: heading + bullets + data
- Focus: brevity, visual logic, memorable facts`,
    },
    be: {
      name: 'Прэзентацыя / даклад', desc: 'Слайды, тэзісы, структура выступлення', meta: '6–10 стар · 3–5 задач',
      instructions: `ШАБЛОН: Прэзентацыя / даклад
- Старонак: 6–10, кожная старонка = адзін слайд:
  1. Тытульны слайд (тэма, аўтар, дата)
  2. Змест / Agenda
  3–7. Кантэнтныя слайды (3–5 слайдаў з ключавымі ідэямі)
  8. Высновы і ключавыя тэзісы
  9. Пытанні для абмеркавання (калі прымяняльна)
  10. Крыніцы
- Кожная старонка-слайд змяшчае: загаловак, 3–5 пунктаў, ключавую цытату або лічбу
- Задач: 3–5 (падрыхтоўка візуалаў, рэпетыцыя, фінальная версія)
- Нататак: 2–3 (ідэі для ілюстрацый, пытанні ад аўдыторыі)
- Пошук: факты, статыстыка, цытаты. Захавай 5–8 крыніц
- Аб'ём старонак: 150–250 слоў (тэзісна!), структура: загаловак + пункты + дадзеныя
- Акцэнт: лаканічнасць, візуальная логіка, запамінальныя факты`,
    },
  },
  {
    id: 'coursework', icon: 'lucide:BookMarked', builtIn: true,
    ru: {
      name: 'Курсовая работа', desc: 'Теория, анализ, практика, выводы, список литературы', meta: '10–12 стр · 7–9 задач',
      instructions: `ШАБЛОН: Курсовая работа
- Страниц: 10–12 обязательные разделы:
  1. Введение (актуальность, цель, задачи, предмет, объект, методы, структура работы)
  2. Теоретические основы (основные понятия, существующие подходы, обзор литературы)
  3. Анализ состояния проблемы (текущая ситуация, статистика, тенденции)
  4. Глава 1 основной части (теоретическая)
  5. Глава 2 основной части (практическая или аналитическая)
  6. Результаты и обсуждение
  7. Практические рекомендации
  8. Заключение (выводы по каждой задаче, перспективы)
  9. Список литературы (15–25 источников, по ГОСТ)
  10. Приложения (если есть таблицы, схемы)
- Задач: 7–9 (по этапам: теория, сбор данных, анализ, написание глав, оформление)
- Заметки: 3–4 (ключевые аргументы, спорные вопросы)
- Поиск: учебники, монографии, научные статьи, официальная статистика. 15–20 источников
- Объём страниц: 500–700 слов, строгий академический стиль, сноски на источники
- Акцент: структурная полнота, академический стиль, практическая ценность`,
    },
    en: {
      name: 'Course work', desc: 'Theory, analysis, practice, conclusions, bibliography', meta: '10–12 pages · 7–9 tasks',
      instructions: `TEMPLATE: Course work
- Pages: 10–12 required sections:
  1. Introduction (relevance, aim, objectives, subject, object, methods, structure)
  2. Theoretical foundations (key concepts, existing approaches, literature review)
  3. Problem analysis (current situation, statistics, trends)
  4. Chapter 1 — theoretical part
  5. Chapter 2 — practical or analytical part
  6. Results and discussion
  7. Practical recommendations
  8. Conclusion (findings per objective, future prospects)
  9. References (15–25 sources, properly formatted)
  10. Appendices (if any tables or diagrams)
- Tasks: 7–9 (theory, data collection, analysis, chapter writing, formatting)
- Notes: 3–4 (key arguments, controversial points)
- Search: textbooks, monographs, academic articles, official statistics. 15–20 sources
- Page length: 500–700 words, strict academic style with citations
- Focus: structural completeness, academic style, practical value`,
    },
    be: {
      name: 'Курсавая праца', desc: 'Поўная структура курсавой з уступам, асноўнай часткай і заключэннем', meta: '10–15 стар · 5–7 задач',
      instructions: `ШАБЛОН: Курсавая праца
- Старонак: 10–12 абавязковыя раздзелы:
  1. Уводзіны (актуальнасць, мэта, задачы, прадмет, аб'ект, метады, структура працы)
  2. Тэарэтычныя асновы (асноўныя паняцці, існуючыя падыходы, агляд літаратуры)
  3. Аналіз стану праблемы (бягучая сітуацыя, статыстыка, тэндэнцыі)
  4. Раздзел 1 асноўнай часткі (тэарэтычны)
  5. Раздзел 2 асноўнай часткі (практычны або аналітычны)
  6. Вынікі і абмеркаванне
  7. Практычныя рэкамендацыі
  8. Заключэнне (высновы па кожнай задачы, перспектывы)
  9. Спіс літаратуры (15–25 крыніц, па ДАСТУ)
  10. Дадаткі (калі ёсць табліцы, схемы)
- Задач: 7–9 (па этапах: тэорыя, збор дадзеных, аналіз, напісанне раздзелаў, афармленне)
- Нататак: 3–4 (ключавыя аргументы, спрэчныя пытанні)
- Пошук: падручнікі, манаграфіі, навуковыя артыкулы, афіцыйная статыстыка. 15–20 крыніц
- Аб'ём старонак: 500–700 слоў, строгі навуковы стыль, зноскі на крыніцы
- Акцэнт: структурная паўната, навуковы стыль, практычная каштоўнасць`,
    },
  },
  {
    id: 'dissertation', icon: 'lucide:Award', builtIn: true,
    ru: {
      name: 'Диссертация', desc: 'Полная академическая структура с научной новизной', meta: '16–20 стр · 12–15 задач',
      instructions: `ШАБЛОН: Диссертация / Дипломная работа
- Страниц: 16–20 полная академическая структура:
  1. Введение (актуальность, научная новизна, цель, задачи, гипотеза, методология, практическая значимость)
  2. Обзор литературы — часть 1 (история вопроса, классические работы)
  3. Обзор литературы — часть 2 (современные исследования, пробелы в знаниях)
  4. Теоретическая рамка (концептуальная модель, ключевые теории)
  5. Методология (дизайн исследования, методы, инструментарий, этика)
  6. Глава 1 (первый аспект темы, теоретически)
  7. Глава 2 (второй аспект, теоретически или эмпирически)
  8. Глава 3 (третий аспект или синтез)
  9. Результаты эмпирической части (данные, анализ)
  10. Интерпретация результатов
  11. Обсуждение (связь с гипотезой, сравнение с литературой, ограничения)
  12. Выводы по каждой главе
  13. Общее заключение (выводы, вклад, рекомендации для практики)
  14. Список литературы (30–50 источников)
  15. Список сокращений и терминов
  16. Приложения
- Задач: 12–15 (детальный план по главам, этапы исследования, дедлайны)
- Заметки: 5–6 (ключевые тезисы, противоречия, будущие исследования)
- Поиск: академические источники ОБЯЗАТЕЛЬНО, монографии, диссертации, статьи WOS/Scopus. 25–35 источников
- Объём страниц: 600–1000 слов, строгий академический стиль, обязательные ссылки на источники
- Акцент: научная новизна, методологическая строгость, связность аргументации`,
    },
    en: {
      name: 'Dissertation', desc: 'Full academic structure with scientific novelty', meta: '16–20 pages · 12–15 tasks',
      instructions: `TEMPLATE: Dissertation / Thesis
- Pages: 16–20 full academic structure:
  1. Introduction (relevance, novelty, aim, objectives, hypothesis, methodology, significance)
  2. Literature review — part 1 (history of the problem, classical works)
  3. Literature review — part 2 (contemporary research, gaps in knowledge)
  4. Theoretical framework (conceptual model, key theories)
  5. Methodology (research design, methods, instruments, ethics)
  6. Chapter 1 (first thematic aspect, theoretical)
  7. Chapter 2 (second aspect, theoretical or empirical)
  8. Chapter 3 (third aspect or synthesis)
  9. Empirical results (data, analysis)
  10. Interpretation of results
  11. Discussion (relation to hypothesis, comparison with literature, limitations)
  12. Chapter conclusions
  13. General conclusion (findings, contribution, practical recommendations)
  14. References (30–50 sources, international and domestic)
  15. List of abbreviations and terms
  16. Appendices
- Tasks: 12–15 (detailed chapter plan, research stages, deadlines)
- Notes: 5–6 (key arguments, contradictions, future research)
- Search: use academic sources MANDATORY, monographs, dissertations, WOS/Scopus articles. 25–35 sources
- Page length: 600–1000 words, strict academic style with citations
- Focus: scientific novelty, methodological rigor, coherent argumentation`,
    },
    be: {
      name: 'Дыпломная / дысертацыя', desc: 'Поўная структура навуковай кваліфікацыйнай працы', meta: '15–25 стар · 8–12 задач',
      instructions: `ШАБЛОН: Дыпломная / дысертацыя
- Старонак: 16–20 поўная навуковая структура:
  1. Уводзіны (актуальнасць, навуковая навізна, мэта, задачы, гіпотэза, метадалогія, практычная значнасць)
  2. Агляд літаратуры — частка 1 (гісторыя пытання, класічныя працы)
  3. Агляд літаратуры — частка 2 (сучасныя даследаванні, прабелы ў ведах)
  4. Тэарэтычная рамка (канцэптуальная мадэль, ключавыя тэорыі)
  5. Метадалогія (дызайн даследавання, метады, інструментарый, этыка)
  6. Раздзел 1 (першы аспект тэмы, тэарэтычна)
  7. Раздзел 2 (другі аспект, тэарэтычна або эмпірычна)
  8. Раздзел 3 (трэці аспект або сінтэз)
  9. Вынікі эмпірычнай часткі (дадзеныя, аналіз)
  10. Інтэрпрэтацыя вынікаў
  11. Абмеркаванне (сувязь з гіпотэзай, параўнанне з літаратурай, абмежаванні)
  12. Высновы па кожным раздзеле
  13. Агульнае заключэнне (высновы, уклад, рэкамендацыі для практыкі)
  14. Спіс літаратуры (30–50 крыніц)
  15. Спіс скарачэнняў і тэрмінаў
  16. Дадаткі
- Задач: 12–15 (дэталёвы план па раздзелах, этапы даследавання, дэдлайны)
- Нататак: 5–6 (ключавыя тэзісы, супярэчнасці, будучыя даследаванні)
- Пошук: навуковыя крыніцы АБАВЯЗКОВА, манаграфіі, дысертацыі, артыкулы WOS/Scopus. 25–35 крыніц
- Аб'ём старонак: 600–1000 слоў, строгі навуковы стыль, абавязковыя спасылкі на крыніцы
- Акцэнт: навуковая навізна, метадалагічная строгасць, звязнасць аргументацыі`,
    },
  },
  {
    id: 'engineering', icon: 'lucide:Wrench', builtIn: true,
    ru: {
      name: 'Инженерный проект', desc: 'ТЗ, расчёты, схемы, спецификации, ТЭО', meta: '10–14 стр · 8–10 задач',
      instructions: `ШАБЛОН: Инженерный проект
- Страниц: 10–14 обязательные разделы:
  1. Техническое задание (ТЗ) — требования, ограничения, исходные данные
  2. Обзор существующих решений и аналогов (сравнительная таблица)
  3. Концепция и выбор технического решения (обоснование выбора)
  4. Расчёты и моделирование — ключевые формулы, результаты расчётов (используй блоки formula с LaTeX)
  5. Принципиальная схема / функциональная схема (используй diagram mermaid: flowchart LR — все метки в двойных кавычках)
  6. Спецификация компонентов / материалов (таблица: наименование, кол-во, параметры)
  7. Описание конструкции / архитектуры системы
  8. Технология изготовления / алгоритм работы (используй diagram mermaid: flowchart TD)
  9. Контроль качества и испытания (методика, критерии приёмки)
  10. Требования к безопасности и охране труда
  11. Технико-экономическое обоснование (ТЭО) — смета, сроки, окупаемость
  12. Выводы и рекомендации
- Задач: 8–10 (этапы проектирования, согласование, изготовление, испытания)
- Заметки: 3–4 (технические риски, открытые вопросы, замечания)
- Формулы: используй блоки formula (mathBlock) для расчётов — LaTeX-синтаксис
- Схемы: используй diagram (mermaid) для функциональных и структурных схем
- Поиск: нормативные документы, ГОСТы, технические статьи. Сохрани 8–12 источников
- Объём страниц: 300–600 слов, технический стиль — конкретные цифры, единицы измерения
- Акцент: инженерная строгость, обоснованность решений, наглядность расчётов и схем`,
    },
    en: {
      name: 'Engineering project', desc: 'TOR, calculations, diagrams, specifications, cost estimate', meta: '10–14 pages · 8–10 tasks',
      instructions: `TEMPLATE: Engineering project
- Pages: 10–14 required sections:
  1. Technical requirements (TOR) — requirements, constraints, input data
  2. Review of existing solutions and analogues (comparison table)
  3. Concept and technical solution selection (justification)
  4. Calculations and modelling — key formulas, results (use formula blocks with LaTeX)
  5. Schematic / functional diagram (use mermaid diagram: flowchart LR)
  6. Bill of materials / components specification (table: name, quantity, parameters)
  7. Design description / system architecture
  8. Manufacturing technology / operation algorithm (use mermaid diagram: flowchart TD)
  9. Quality control and testing (method, acceptance criteria)
  10. Safety and occupational health requirements
  11. Techno-economic justification — cost estimate, timeline, payback
  12. Conclusions and recommendations
- Tasks: 8–10 (design phases, approval, manufacturing, testing)
- Notes: 3–4 (technical risks, open questions, remarks)
- Formulas: use formula blocks (mathBlock) for calculations — LaTeX syntax
- Diagrams: use diagram (mermaid) for functional and structural schematics
- Search: standards, technical articles. Save 8–12 sources
- Page length: 300–600 words, technical style — specific figures, units of measurement
- Focus: engineering rigor, justified decisions, clear calculations and diagrams`,
    },
    be: {
      name: 'Інжынерны праект', desc: 'ТЗ, разлікі, схемы, спецыфікацыі, ТЭА', meta: '10–14 стар · 8–10 задач',
      instructions: `ШАБЛОН: Інжынерны праект
- Старонак: 10–14 абавязковыя раздзелы:
  1. Тэхнічнае заданне (ТЗ) — патрабаванні, абмежаванні, зыходныя дадзеныя
  2. Агляд існуючых рашэнняў і аналагаў (параўнальная табліца)
  3. Канцэпцыя і выбар тэхнічнага рашэння (абгрунтаванне выбару)
  4. Разлікі і мадэляванне — ключавыя формулы, вынікі разлікаў (выкарыстоўвай блокі formula з LaTeX)
  5. Прынцыповая схема / функцыянальная схема (выкарыстоўвай diagram mermaid: flowchart LR — усе пазнакі ў двайных двукоссях)
  6. Спецыфікацыя кампанентаў / матэрыялаў (табліца: найменне, кол-ва, параметры)
  7. Апісанне канструкцыі / архітэктуры сістэмы
  8. Тэхналогія вырабу / алгарытм працы (выкарыстоўвай diagram mermaid: flowchart TD)
  9. Кантроль якасці і выпрабаванні (методыка, крытэрыі прыёмкі)
  10. Патрабаванні да бяспекі і аховы працы
  11. Тэхніка-эканамічнае абгрунтаванне (ТЭА) — каштарыс, тэрміны, акупальнасць
  12. Высновы і рэкамендацыі
- Задач: 8–10 (этапы праектавання, узгадненне, вытворчасць, выпрабаванні)
- Нататак: 3–4 (тэхнічныя рызыкі, адкрытыя пытанні, заўвагі)
- Формулы: выкарыстоўвай блокі formula (mathBlock) для разлікаў — LaTeX-сінтаксіс
- Схемы: выкарыстоўвай diagram (mermaid) для функцыянальных і структурных схем
- Пошук: нарматыўныя дакументы, ДАСТы, тэхнічныя артыкулы. Захавай 8–12 крыніц
- Аб'ём старонак: 300–600 слоў, тэхнічны стыль — канкрэтныя лічбы, адзінкі вымярэння
- Акцэнт: інжынерная строгасць, абгрунтаванасць рашэнняў, нагляднасць разлікаў і схем`,
    },
  },
  {
    id: 'dossier', icon: 'lucide:ClipboardList', builtIn: true,
    ru: {
      name: 'Досье', desc: 'Комплексное досье на персону, организацию или объект исследования', meta: '6–9 стр · 4–6 задач',
      instructions: `ШАБЛОН: Досье
- Страниц: 6–9 обязательных разделов:
  1. Профиль (персона/организация): ФИО/название, даты, ключевые факты
  2. Биография / История: хронология ключевых событий (таблица: дата, событие, значимость)
  3. Деятельность / Направления работы: роли, должности, проекты, достижения
  4. Связи и окружение: ключевые контакты, партнёры, структуры (используй diagram mermaid: graph LR)
  5. Публичная активность: СМИ, публикации, выступления, цитаты
  6. Финансы / Активы (если применимо): собственность, компании, доходы
  7. Риски и спорные моменты: конфликты, судебные дела, противоречия
  8. Выводы и оценка: итоговое резюме, уровень доверия, рекомендации
- Задач: 4–6 (сбор данных, верификация, анализ, итоговый отчёт)
- Заметок: 2–3 (необработанные факты, вопросы без ответа)
- Поиск: 2 раунда web_search — официальные источники + независимые. Сохрани 10–15 источников
- Объём страниц: 250–500 слов, фактический стиль, без оценочных суждений
- Акцент: полнота фактической базы, верифицированность, структурированность`,
    },
    en: {
      name: 'Dossier', desc: 'Comprehensive dossier on a person, organization or subject of research', meta: '6–9 pages · 4–6 tasks',
      instructions: `TEMPLATE: Dossier
- Pages: 6–9 required sections:
  1. Profile (person/organization): full name, dates, key facts
  2. Biography / History: chronology of key events (table: date, event, significance)
  3. Activities / Work Areas: roles, positions, projects, achievements
  4. Connections & Environment: key contacts, partners, structures (use diagram mermaid: graph LR)
  5. Public Activity: media, publications, speeches, quotes
  6. Finances / Assets (if applicable): property, companies, income
  7. Risks & Controversies: conflicts, lawsuits, contradictions
  8. Conclusions & Assessment: final summary, trust level, recommendations
- Tasks: 4–6 (data collection, verification, analysis, final report)
- Notes: 2–3 (raw facts, unanswered questions)
- Search: 2 rounds of web_search — official sources + independent. Save 10–15 sources
- Page length: 250–500 words, factual style, no value judgments
- Focus: completeness of factual base, verifiability, structure`,
    },
    be: {
      name: 'Досье', desc: 'Комплекснае досье на персону, арганізацыю або аб\'ект даследавання', meta: '6–9 стар · 4–6 задач',
      instructions: `ШАБЛОН: Досье
- Старонак: 6–9 абавязковых раздзелаў:
  1. Профіль (персона/арганізацыя): ФІА/назва, даты, ключавыя факты
  2. Біяграфія / Гісторыя: храналогія ключавых падзей (табліца: дата, падзея, значнасць)
  3. Дзейнасць / Напрамкі работы: ролі, пасады, праекты, дасягненні
  4. Сувязі і акружэнне: ключавыя кантакты, партнёры, структуры (выкарыстоўвай diagram mermaid: graph LR)
  5. Публічная актыўнасць: СМІ, публікацыі, выступленні, цытаты
  6. Фінансы / Актывы (калі ёсць): уласнасць, кампаніі, даходы
  7. Рызыкі і спрэчныя моманты: канфлікты, судовыя справы, супярэчнасці
  8. Высновы і ацэнка: зводнае рэзюмэ, узровень даверу, рэкамендацыі
- Задач: 4–6 (збор дадзеных, верыфікацыя, аналіз, канчатковы справаздач)
- Нататак: 2–3 (неапрацаваныя факты, пытанні без адказу)
- Пошук: 2 раунды web_search — афіцыйныя крыніцы + незалежныя. Захавай 10–15 крыніц
- Аб\'ём старонак: 250–500 слоў, фактычны стыль, без ацэначных меркаванняў
- Акцэнт: паўната фактычнай базы, верыфікаванасць, структураванасць`,
    },
  },
]

// ─── localStorage helpers ─────────────────────────────────────────────────────

function storageKey(workspaceId: string) {
  return `sinoutx:ai-templates:${workspaceId}`
}

interface StoredTemplateSettings {
  hidden: string[]
  overrides: Record<string, string>   // builtIn id → custom instructions
}

function loadSettings(workspaceId: string): StoredTemplateSettings {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    if (raw) {
      const parsed = JSON.parse(raw) as StoredTemplateSettings
      return { hidden: parsed.hidden ?? [], overrides: parsed.overrides ?? {} }
    }
  } catch { /* ignore */ }
  return { hidden: [], overrides: {} }
}

function saveSettings(workspaceId: string, data: StoredTemplateSettings) {
  localStorage.setItem(storageKey(workspaceId), JSON.stringify(data))
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'pages' | 'projects'

export function TemplatesPage() {
  const { currentWorkspaceId } = useWorkspaceStore()
  const t = useT()
  const [tab, setTab] = useState<Tab>('projects')

  if (!currentWorkspaceId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-500">{t.common.selectWorkspace}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header title={t.templates.title} />
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-1 px-6 pt-4 border-b border-slate-800">
          {([
            { id: 'projects', label: t.templates.projects, icon: <FolderKanban size={14} /> },
            { id: 'pages',    label: t.templates.pages,    icon: <FileText size={14} /> },
          ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
                tab === id
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200',
              )}
            >
              {icon} {label}
            </button>
          ))}
        </div>
        <div className="p-6">
          {tab === 'projects' && <ProjectTemplatesTab workspaceId={currentWorkspaceId} />}
          {tab === 'pages'    && <PageTemplatesTab    workspaceId={currentWorkspaceId} />}
        </div>
      </div>
    </div>
  )
}

// ─── Project (AI) Templates tab ───────────────────────────────────────────────

function ProjectTemplatesTab({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const t = useT()
  const { language } = useLanguageStore()

  const [settings, setSettings] = useState<StoredTemplateSettings>(() => loadSettings(workspaceId))
  const [editTarget, setEditTarget] = useState<CustomAiTemplate | null>(null)
  const [editBuiltIn, setEditBuiltIn] = useState<AiTemplateInfo | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Custom AI templates from DB
  const { data: customTemplates = [] } = useQuery({
    queryKey: ['ai-templates', workspaceId],
    queryFn: () => aiTemplateApi.list(workspaceId),
  })
  const createCustomMut = useMutation({
    mutationFn: (data: { name: string; description: string; icon: string; instructions: string }) =>
      aiTemplateApi.create(workspaceId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-templates', workspaceId] }); setShowCreateModal(false) },
  })
  const updateCustomMut = useMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string; description: string; icon: string; instructions: string }) =>
      aiTemplateApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-templates', workspaceId] }); setEditTarget(null) },
  })
  const deleteCustomMut = useMutation({
    mutationFn: (id: string) => aiTemplateApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-templates', workspaceId] }) },
  })

  // Saved project templates (copied from existing)
  const { data: savedTemplates = [], isLoading: savedLoading } = useQuery({
    queryKey: ['project-templates', workspaceId],
    queryFn: () => templateApi.listProjectTemplates(workspaceId),
  })
  const [showUse, setShowUse] = useState<string | null>(null)
  const [useName, setUseName] = useState('')
  const useMut = useMutation({
    mutationFn: ({ templateId, name }: { templateId: string; name: string }) =>
      templateApi.useProjectTemplate(templateId, { name, workspaceId }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/projects/${project.id}`)
      setShowUse(null)
    },
  })

  function persist(next: StoredTemplateSettings) {
    setSettings(next)
    saveSettings(workspaceId, next)
  }

  function toggleHide(id: string) {
    const hidden = settings.hidden.includes(id)
      ? settings.hidden.filter((h) => h !== id)
      : [...settings.hidden, id]
    persist({ ...settings, hidden })
  }

  function saveOverride(id: string, instructions: string) {
    persist({ ...settings, overrides: { ...settings.overrides, [id]: instructions } })
  }

  function clearOverride(id: string) {
    const overrides = { ...settings.overrides }
    delete overrides[id]
    persist({ ...settings, overrides })
  }

  function launch(tmpl: AnyTemplate) {
    const prompt = t.templates.createProjectPrompt
    if ('builtIn' in tmpl && tmpl.builtIn) {
      const override = settings.overrides[tmpl.id]
      const tmplName = tmplInfo(tmpl, language).name
      if (override) {
        document.dispatchEvent(new CustomEvent('ai:open', { detail: { template: 'custom', prompt, instructions: override, templateName: tmplName } }))
      } else {
        document.dispatchEvent(new CustomEvent('ai:open', { detail: { template: tmpl.id, prompt } }))
      }
    } else {
      const c = tmpl as CustomAiTemplate
      document.dispatchEvent(new CustomEvent('ai:open', {
        detail: { template: 'custom', prompt, instructions: c.instructions, templateName: c.name },
      }))
    }
    void navigate('/')
  }

  const visibleBuiltIns = BUILT_IN_TEMPLATES.filter((tmpl) => !settings.hidden.includes(tmpl.id))
  const hiddenBuiltIns  = BUILT_IN_TEMPLATES.filter((tmpl) => settings.hidden.includes(tmpl.id))

  return (
    <div className="max-w-4xl">

      {/* ── AI Templates section ── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-primary-400" />
          <h2 className="text-sm font-semibold text-slate-200">
            {t.templates.aiTitle}
          </h2>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-ghost text-xs flex items-center gap-1.5 text-primary-400"
        >
          <Plus size={13} />
          {t.templates.newAiTemplate}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        {/* Built-in templates */}
        {visibleBuiltIns.map((tmpl) => {
          const info = tmplInfo(tmpl, language)
          const hasOverride = !!settings.overrides[tmpl.id]
          return (
            <div key={tmpl.id} className="group relative bg-surface-900 border border-slate-800 hover:border-primary-500/40 rounded-xl p-4 transition-all">
              <button onClick={() => launch(tmpl)} className="w-full text-left">
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 mt-0.5">
                    {renderIcon(tmpl.icon, 20, hasOverride ? 'text-primary-400' : 'text-slate-400')}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-slate-200 group-hover:text-primary-300 transition-colors text-sm">
                        {info.name}
                      </p>
                      {hasOverride && (
                        <span className="text-[9px] bg-amber-900/40 text-amber-400 border border-amber-800/50 rounded px-1 py-0.5 font-medium uppercase tracking-wide flex-shrink-0">
                          {t.templates.edited}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{info.desc}</p>
                    <p className="text-[10px] text-slate-600 mt-1.5 font-medium uppercase tracking-wide">{(info as any).meta}</p>
                  </div>
                </div>
              </button>
              {/* Controls */}
              <div className="absolute top-2 right-2 flex gap-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); setEditBuiltIn(tmpl) }}
                  className="p-1 rounded text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                  title={t.templates.editInstructions}
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleHide(tmpl.id) }}
                  className="p-1 rounded text-slate-700 hover:text-slate-400 hover:bg-slate-800 transition-colors"
                  title={t.templates.hide}
                >
                  <EyeOff size={11} />
                </button>
              </div>
            </div>
          )
        })}

        {/* Custom templates from DB */}
        {customTemplates.map((tmpl) => (
          <div key={tmpl.id} className="group relative bg-surface-900 border border-slate-700 hover:border-primary-500/40 rounded-xl p-4 transition-all">
            <button onClick={() => launch(tmpl)} className="w-full text-left">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 mt-0.5">
                  {renderIcon(tmpl.icon, 20, 'text-primary-400')}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium text-slate-200 group-hover:text-primary-300 transition-colors text-sm">
                      {tmpl.name}
                    </p>
                    <span className="text-[9px] bg-primary-900/50 text-primary-400 border border-primary-800/50 rounded px-1 py-0.5 font-medium uppercase tracking-wide flex-shrink-0">
                      {t.templates.customLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{tmpl.description}</p>
                </div>
              </div>
            </button>
            <div className="absolute top-2 right-2 flex gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); setEditTarget(tmpl) }}
                className="p-1 rounded text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                title={t.common.edit}
              >
                <Pencil size={11} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); if (confirm(t.templates.deleteAiConfirm)) deleteCustomMut.mutate(tmpl.id) }}
                className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-slate-800 transition-colors"
                title={t.common.delete}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Hidden built-ins restore */}
      {hiddenBuiltIns.length > 0 && (
        <div className="mb-8">
          <p className="text-xs text-slate-600 mb-2">{t.templates.hiddenTemplates}</p>
          <div className="flex flex-wrap gap-2">
            {hiddenBuiltIns.map((tmpl) => {
              const info = tmplInfo(tmpl, language)
              return (
                <button
                  key={tmpl.id}
                  onClick={() => toggleHide(tmpl.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-500 border border-slate-800 rounded-lg hover:border-slate-600 hover:text-slate-300 transition-colors"
                >
                  {renderIcon(tmpl.icon, 12, 'text-slate-500')}
                  {info.name}
                  <Eye size={10} />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Saved project templates (copied from existing) ── */}
      <div className="border-t border-slate-800 pt-6">
        <h2 className="text-sm font-semibold text-slate-500 mb-4 flex items-center gap-2">
          <FolderKanban size={13} />
          {t.templates.savedFromProjects}
        </h2>
        {savedLoading ? (
          <Loader2 size={18} className="animate-spin text-primary-500" />
        ) : savedTemplates.length === 0 ? (
          <p className="text-xs text-slate-600">{t.templates.noTemplates}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {savedTemplates.map((tmpl) => (
              <div key={tmpl.id} className="group bg-surface-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-200 text-sm">{tmpl.name}</p>
                    {tmpl.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{tmpl.description}</p>}
                    <p className="text-xs text-slate-600 mt-1">
                      {tmpl._count.pages} {t.templates.pages} · {tmpl._count.tasks} {t.tasks.title.toLowerCase()}
                    </p>
                  </div>
                  <button
                    onClick={() => { setShowUse(tmpl.id); setUseName(tmpl.name) }}
                    className="opacity-0 group-hover:opacity-100 btn-ghost p-1.5 text-primary-400 flex-shrink-0"
                    title={t.templates.useTemplate}
                  >
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Edit built-in template instructions modal ── */}
      {editBuiltIn && (
        <BuiltInEditModal
          language={language}
          tmpl={editBuiltIn}
          currentInstructions={settings.overrides[editBuiltIn.id] ?? (language === 'en' ? editBuiltIn.en.instructions : language === 'be' && editBuiltIn.be ? editBuiltIn.be.instructions : editBuiltIn.ru.instructions)}
          hasOverride={!!settings.overrides[editBuiltIn.id]}
          onSave={(instructions) => { saveOverride(editBuiltIn.id, instructions); setEditBuiltIn(null) }}
          onReset={() => { clearOverride(editBuiltIn.id); setEditBuiltIn(null) }}
          onClose={() => setEditBuiltIn(null)}
        />
      )}

      {/* ── Create/Edit custom template modal ── */}
      {(showCreateModal || editTarget) && (
        <CustomTemplateModal
          initial={editTarget ?? undefined}
          isPending={createCustomMut.isPending || updateCustomMut.isPending}
          onSave={(data) => {
            if (editTarget) {
              updateCustomMut.mutate({ id: editTarget.id, ...data })
            } else {
              createCustomMut.mutate(data)
            }
          }}
          onClose={() => { setShowCreateModal(false); setEditTarget(null) }}
        />
      )}

      {/* ── Use saved template modal ── */}
      {showUse && (
        <Modal open onClose={() => setShowUse(null)} title={t.templates.createFromTemplate}>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t.common.name}</label>
              <input
                autoFocus
                type="text"
                value={useName}
                onChange={(e) => setUseName(e.target.value)}
                className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowUse(null)} className="btn-ghost">{t.common.cancel}</button>
              <button
                onClick={() => useMut.mutate({ templateId: showUse, name: useName })}
                disabled={useMut.isPending || !useName.trim()}
                className="btn-primary"
              >
                {useMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                {t.common.create}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Built-in Template Edit Modal ────────────────────────────────────────────

function BuiltInEditModal({
  language, tmpl, currentInstructions, hasOverride, onSave, onReset, onClose,
}: {
  language: string
  tmpl: AiTemplateInfo
  currentInstructions: string
  hasOverride: boolean
  onSave: (instructions: string) => void
  onReset: () => void
  onClose: () => void
}) {
  const t = useT()
  const info = tmplInfo(tmpl, language)
  const [instructions, setInstructions] = useState(currentInstructions)

  return (
    <Modal open onClose={onClose} title={`${t.templates.editBuiltInPrefix}${info.name}`}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">{t.templates.editInstructionsHint}</p>
        <textarea
          autoFocus
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={14}
          className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none font-mono"
        />
        <div className="flex items-center justify-between gap-2">
          <div>
            {hasOverride && (
              <button
                onClick={onReset}
                className="text-xs text-amber-500 hover:text-amber-400 transition-colors"
              >
                {t.templates.resetDefault}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
            <button
              onClick={() => { if (instructions.trim()) onSave(instructions.trim()) }}
              disabled={!instructions.trim()}
              className="btn-primary"
            >
              {t.common.save}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Custom Template Create/Edit Modal ────────────────────────────────────────

function CustomTemplateModal({
  initial,
  isPending,
  onSave,
  onClose,
}: {
  initial?: CustomAiTemplate
  isPending?: boolean
  onSave: (data: { name: string; description: string; icon: string; instructions: string }) => void
  onClose: () => void
}) {
  const t = useT()
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? 'lucide:FolderKanban')
  const [showIconPicker, setShowIconPicker] = useState(false)
  const iconNames = Object.keys(LUCIDE_ICON_MAP)

  const title = initial ? t.templates.editTemplateTitle : t.templates.newTemplateTitle

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-4">

        {/* Icon + Name row */}
        <div className="flex items-start gap-3">
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowIconPicker((v) => !v)}
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-500 transition-colors"
            >
              {renderIcon(icon, 20, 'text-primary-400')}
            </button>
            {showIconPicker && (
              <div className="absolute z-30 top-full left-0 mt-1 w-64 bg-surface-900 border border-slate-700 rounded-xl shadow-2xl p-2">
                <div className="flex flex-wrap gap-1 max-h-48 overflow-y-auto">
                  {iconNames.map((n) => (
                    <button
                      key={n}
                      onClick={() => { setIcon(`lucide:${n}`); setShowIconPicker(false) }}
                      className={cn(
                        'w-8 h-8 flex items-center justify-center rounded-lg transition-colors',
                        icon === `lucide:${n}` ? 'bg-primary-600 text-white' : 'text-slate-400 hover:bg-slate-800',
                      )}
                      title={n}
                    >
                      {renderIcon(`lucide:${n}`, 15, undefined)}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowIconPicker(false)}
                  className="mt-2 w-full text-xs text-slate-500 hover:text-slate-300 text-center"
                >
                  <X size={10} className="inline mr-1" />
                  {t.common.close}
                </button>
              </div>
            )}
          </div>
          <div className="flex-1">
            <label className="text-xs text-slate-400 block mb-1">{t.common.name}</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.templates.namePlaceholder}
              className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">{t.templates.descLabel}</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.templates.descPlaceholder}
            className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">
            {t.templates.instructionsLabel}
          </label>
          <p className="text-[11px] text-slate-600 mb-1.5">{t.templates.instructionsHint}</p>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
            placeholder={t.templates.instructionsPlaceholder}
            className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none font-mono"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
          <button
            onClick={() => {
              if (!name.trim() || !instructions.trim()) return
              onSave({ icon, name: name.trim(), description: description.trim(), instructions: instructions.trim() })
            }}
            disabled={isPending || !name.trim() || !instructions.trim()}
            className="btn-primary"
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {initial ? t.common.save : t.common.create}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Page template localStorage helpers ──────────────────────────────────────

function pageTemplateSettingsKey(workspaceId: string) {
  return `sinoutx:page-templates:${workspaceId}`
}

interface PageTemplateSettings {
  hidden: string[]
}

function loadPageSettings(workspaceId: string): PageTemplateSettings {
  try {
    const raw = localStorage.getItem(pageTemplateSettingsKey(workspaceId))
    if (raw) {
      const parsed = JSON.parse(raw) as PageTemplateSettings
      return { hidden: parsed.hidden ?? [] }
    }
  } catch { /* ignore */ }
  return { hidden: [] }
}

function savePageSettings(workspaceId: string, data: PageTemplateSettings) {
  localStorage.setItem(pageTemplateSettingsKey(workspaceId), JSON.stringify(data))
}

// ─── Page Templates tab ───────────────────────────────────────────────────────

function PageTemplatesTab({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient()
  const { currentProjectId } = useWorkspaceStore()
  const navigate = useNavigate()
  const t = useT()
  const { language } = useLanguageStore()
  const isRu = language !== 'en'

  const [pageSettings, setPageSettings] = useState<PageTemplateSettings>(() => loadPageSettings(workspaceId))

  // useTarget: string = saved template id, object = builtin template
  const [useTarget, setUseTarget] = useState<string | { builtinId: string; name: string } | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [newProjectName, setNewProjectName] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [builtinSearch, setBuiltinSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editTarget, setEditTarget] = useState<PageTemplate | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['page-templates', workspaceId],
    queryFn: () => templateApi.listPageTemplates(workspaceId),
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => projectApi.listByWorkspace(workspaceId),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => templateApi.deletePageTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['page-templates'] })
      toast.success(isRu ? 'Шаблон удалён' : 'Template deleted')
    },
  })

  const renameMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      templateApi.updatePageTemplate(id, { title }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['page-templates'] })
      setEditTarget(null)
      toast.success(isRu ? 'Шаблон обновлён' : 'Template updated')
    },
  })

  const createMut = useMutation({
    mutationFn: ({ name, projectId }: { name: string; projectId: string }) =>
      templateApi.createPageTemplate({ name, projectId }),
    onSuccess: (page) => {
      qc.invalidateQueries({ queryKey: ['page-templates'] })
      setShowCreateModal(false)
      navigate(`/pages/${page.id}`)
    },
  })

  const useMut = useMutation({
    mutationFn: ({ templateId, projectId, title }: { templateId: string; projectId: string; title: string }) =>
      templateApi.usePageTemplate(templateId, { projectId, title }),
    onSuccess: (page) => {
      qc.invalidateQueries({ queryKey: ['pages'] })
      navigate(`/pages/${page.id}`)
      setUseTarget(null)
    },
  })

  const useBuiltinMut = useMutation({
    mutationFn: async ({ builtinId, projectId, title }: { builtinId: string; projectId: string; title: string }) => {
      const tmpl = BUILTIN_PAGE_TEMPLATES.find((b) => b.id === builtinId)
      if (!tmpl) throw new Error('Template not found')
      const content = language === 'en' ? (tmpl.contentEn ?? tmpl.content)
                    : language === 'be' ? (tmpl.contentBe ?? tmpl.content)
                    : tmpl.content
      const page = await pageApi.create({ projectId, title })
      await pageApi.update(page.id, { content })
      return page
    },
    onSuccess: (page) => {
      qc.invalidateQueries({ queryKey: ['pages'] })
      navigate(`/pages/${page.id}`)
      setUseTarget(null)
    },
  })

  function persistPageSettings(next: PageTemplateSettings) {
    setPageSettings(next)
    savePageSettings(workspaceId, next)
  }

  function toggleBuiltinHide(id: string) {
    const hidden = pageSettings.hidden.includes(id)
      ? pageSettings.hidden.filter((h) => h !== id)
      : [...pageSettings.hidden, id]
    persistPageSettings({ ...pageSettings, hidden })
  }

  function openBuiltin(tmpl: TmplLike) {
    const name = tmplInfo(tmpl, language).name
    setUseTarget({ builtinId: tmpl.id, name })
    setNewTitle(name)
    setSelectedProjectId(currentProjectId ?? projects[0]?.id ?? '')
  }

  function openSaved(tmpl: { id: string; title: string }) {
    setUseTarget(tmpl.id)
    setNewTitle(tmpl.title)
    setSelectedProjectId(currentProjectId ?? projects[0]?.id ?? '')
  }

  async function handleUse() {
    let projectId = selectedProjectId
    if (projectId === '__new__') {
      if (!newProjectName.trim()) return
      const created = await projectApi.create({ name: newProjectName.trim(), workspaceId })
      projectId = created.id
      qc.invalidateQueries({ queryKey: ['projects', workspaceId] })
    }
    if (!projectId) return
    if (typeof useTarget === 'string') {
      useMut.mutate({ templateId: useTarget, projectId, title: newTitle })
    } else if (useTarget) {
      useBuiltinMut.mutate({ builtinId: useTarget.builtinId, projectId, title: newTitle })
    }
  }

  const isPending = useMut.isPending || useBuiltinMut.isPending
  const hiddenBuiltins = BUILTIN_PAGE_TEMPLATES.filter((t) => pageSettings.hidden.includes(t.id))

  return (
    <div className="max-w-5xl">
      {/* ── Builtin templates ─────────────────────────────────────── */}
      <BuiltinTemplatesSection
        isRu={isRu}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        search={builtinSearch}
        setSearch={setBuiltinSearch}
        hiddenIds={pageSettings.hidden}
        defaultProjectId={currentProjectId ?? projects[0]?.id ?? ''}
        onUse={openBuiltin}
        onToggleHide={toggleBuiltinHide}
        onEditCopy={async (tmpl, projectId) => {
          const name = tmplInfo(tmpl, language).name
          const page = await templateApi.createPageTemplate({ name: `${name} (копия)`, projectId })
          const tmplTyped = tmpl as BuiltinPageTemplate
          const content = language === 'en' ? (tmplTyped.contentEn ?? tmplTyped.content) : language === 'be' ? (tmplTyped.contentBe ?? tmplTyped.content) : tmplTyped.content
          await pageApi.update(page.id, { content })
          qc.invalidateQueries({ queryKey: ['page-templates'] })
          navigate(`/pages/${page.id}`)
        }}
      />

      {/* Hidden builtin restore */}
      {hiddenBuiltins.length > 0 && (
        <div className="mt-4 mb-2">
          <p className="text-xs text-slate-600 mb-2">{language === 'en' ? 'Hidden built-ins:' : 'Скрытые встроенные:'}</p>
          <div className="flex flex-wrap gap-2">
            {hiddenBuiltins.map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => toggleBuiltinHide(tmpl.id)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-500 border border-slate-800 rounded-lg hover:border-slate-600 hover:text-slate-300 transition-colors"
              >
                {renderIcon(tmpl.icon, 12, 'text-slate-500')}
                {tmplInfo(tmpl, language).name}
                <Eye size={10} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── My templates ───────────────────────────────────────────── */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-300">
            {isRu ? 'Мои шаблоны' : 'My Templates'}
          </h3>
          <button
            onClick={() => { setSelectedProjectId(currentProjectId ?? projects[0]?.id ?? ''); setShowCreateModal(true) }}
            className="btn-ghost text-xs flex items-center gap-1.5 text-primary-400"
          >
            <Plus size={13} />
            {isRu ? 'Новый шаблон' : 'New template'}
          </button>
        </div>
        {isLoading ? (
          <Loader2 size={20} className="animate-spin text-primary-500" />
        ) : templates.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-slate-800 rounded-xl">
            <FileText size={24} className="mx-auto text-slate-700 mb-2" />
            <p className="text-slate-500 text-sm">{t.templates.noTemplates}</p>
            <p className="text-xs text-slate-600 mt-1">{t.templates.noTemplatesHint}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((tmpl) => (
              <div key={tmpl.id} className="group relative bg-surface-900 border border-slate-700 hover:border-primary-500/40 rounded-xl p-4 transition-all">
                <button onClick={() => openSaved(tmpl)} className="w-full text-left">
                  <div className="flex items-start gap-3">
                    <FileText size={18} className="text-primary-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 pr-12">
                      <p className="font-medium text-slate-200 group-hover:text-primary-300 transition-colors text-sm truncate">{tmpl.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{tmpl.project.name}</p>
                    </div>
                  </div>
                </button>
                <div className="absolute top-2 right-2 flex gap-0.5">
                  <button
                    onClick={() => navigate(`/pages/${tmpl.id}`)}
                    className="p-1 rounded text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                    title={isRu ? 'Редактировать содержимое' : 'Edit content'}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => setEditTarget(tmpl)}
                    className="p-1 rounded text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                    title={isRu ? 'Переименовать' : 'Rename'}
                  >
                    <FileText size={11} />
                  </button>
                  <button
                    onClick={() => { if (confirm(t.templates.deleteConfirm)) deleteMut.mutate(tmpl.id) }}
                    className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-slate-800 transition-colors"
                    title={t.common.delete}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Use modal ─────────────────────────────────────────────── */}
      {useTarget && (
        <Modal open onClose={() => setUseTarget(null)} title={t.templates.createFromTemplate}>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t.templates.pageNameLabel}</label>
              <input
                autoFocus
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t.templates.projectLabel}</label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none"
              >
                <option value="__new__">{language === 'be' ? '＋ Новы праект' : language === 'en' ? '＋ New project' : '＋ Новый проект'}</option>
                {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
              {selectedProjectId === '__new__' && (
                <div className="mt-2">
                  <label className="text-xs text-slate-400 block mb-1">{isRu ? 'Название нового проекта' : 'New project name'}</label>
                  <input
                    autoFocus
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder={isRu ? 'Введите название' : 'Enter project name'}
                    className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setUseTarget(null)} className="btn-ghost">{t.common.cancel}</button>
              <button onClick={handleUse} disabled={isPending || !selectedProjectId || (selectedProjectId === '__new__' && !newProjectName.trim())} className="btn-primary">
                {isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                {t.common.create}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Create new template modal ──────────────────────────────── */}
      {showCreateModal && (
        <Modal open onClose={() => setShowCreateModal(false)} title={isRu ? 'Новый шаблон страницы' : 'New Page Template'}>
          <PageTemplateFormModal
            isRu={isRu}
            projects={projects}
            defaultProjectId={selectedProjectId}
            isPending={createMut.isPending}
            onSave={({ name, projectId }) => createMut.mutate({ name, projectId })}
            onClose={() => setShowCreateModal(false)}
            saveLabel={isRu ? 'Создать и открыть' : 'Create & open'}
            hint={isRu
              ? 'Шаблон откроется в редакторе — наполните его содержимым и закройте. Он будет доступен в этом списке.'
              : 'The template will open in the editor — fill it with content and close. It will be available in this list.'}
          />
        </Modal>
      )}

      {/* ── Rename saved template modal ────────────────────────────── */}
      {editTarget && (
        <Modal open onClose={() => setEditTarget(null)} title={isRu ? 'Переименовать шаблон' : 'Rename Template'}>
          <PageTemplateFormModal
            isRu={isRu}
            projects={projects}
            defaultProjectId={editTarget.project.id}
            defaultName={editTarget.title}
            isPending={renameMut.isPending}
            hideProjectSelector
            onSave={({ name }) => renameMut.mutate({ id: editTarget.id, title: name })}
            onClose={() => setEditTarget(null)}
            saveLabel={t.common.save}
          />
        </Modal>
      )}
    </div>
  )
}

// ─── Reusable page template form ──────────────────────────────────────────────

function PageTemplateFormModal({
  isRu,
  projects,
  defaultProjectId,
  defaultName = '',
  isPending,
  hideProjectSelector,
  hint,
  saveLabel,
  onSave,
  onClose,
}: {
  isRu: boolean
  projects: { id: string; name: string }[]
  defaultProjectId: string
  defaultName?: string
  isPending: boolean
  hideProjectSelector?: boolean
  hint?: string
  saveLabel: string
  onSave: (data: { name: string; projectId: string }) => void
  onClose: () => void
}) {
  const t = useT()
  const [name, setName] = useState(defaultName)
  const [projectId, setProjectId] = useState(defaultProjectId)

  return (
    <div className="space-y-4">
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <div>
        <label className="text-xs text-slate-400 block mb-1">{t.common.name}</label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isRu ? 'Название шаблона...' : 'Template name...'}
          className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
      {!hideProjectSelector && (
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t.templates.projectLabel}</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none"
          >
            {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
        <button
          onClick={() => { if (name.trim()) onSave({ name: name.trim(), projectId }) }}
          disabled={isPending || !name.trim()}
          className="btn-primary"
        >
          {isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          {saveLabel}
        </button>
      </div>
    </div>
  )
}

type BuiltinTmpl = { id: string; icon: string; category: string; content: Record<string, unknown>; ru: { name: string; desc: string }; en: { name: string; desc: string } }

function BuiltinTemplatesSection({
  isRu,
  activeCategory,
  setActiveCategory,
  search,
  setSearch,
  hiddenIds,
  defaultProjectId,
  onUse,
  onToggleHide,
  onEditCopy,
}: {
  isRu: boolean
  activeCategory: string
  setActiveCategory: (c: string) => void
  search: string
  setSearch: (s: string) => void
  hiddenIds: string[]
  defaultProjectId: string
  onUse: (tmpl: BuiltinTmpl) => void
  onToggleHide: (id: string) => void
  onEditCopy: (tmpl: BuiltinTmpl, projectId: string) => Promise<void>
}) {
  const { BUILTIN_PAGE_TEMPLATES, BUILTIN_CATEGORIES } = useBuiltinTemplates()
  const { language } = useLanguageStore()
  const [copyingId, setCopyingId] = useState<string | null>(null)

  const visible = (BUILTIN_PAGE_TEMPLATES as BuiltinTmpl[]).filter((t) => !hiddenIds.includes(t.id))

  const filtered = visible.filter((tmpl) => {
    const matchesCat = activeCategory === 'all' || tmpl.category === activeCategory
    const q = search.toLowerCase()
    const info = tmplInfo(tmpl, language)
    const matchesSearch = !q || info.name.toLowerCase().includes(q) || info.desc.toLowerCase().includes(q) || tmpl.ru.name.toLowerCase().includes(q)
    return matchesCat && matchesSearch
  })

  async function handleEditCopy(e: React.MouseEvent, tmpl: BuiltinTmpl) {
    e.stopPropagation()
    setCopyingId(tmpl.id)
    try {
      await onEditCopy(tmpl, defaultProjectId)
    } finally {
      setCopyingId(null)
    }
  }

  const allLabel = isRu ? 'Все' : 'All'

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-300 mb-3">
        {isRu ? 'Встроенные шаблоны' : 'Built-in Templates'}
        <span className="ml-2 text-xs text-slate-600 font-normal">({visible.length})</span>
      </h3>

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isRu ? 'Поиск шаблона...' : 'Search templates...'}
          className="w-full bg-surface-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        <button
          onClick={() => setActiveCategory('all')}
          className={cn('text-xs px-2.5 py-1 rounded-full border transition-all', activeCategory === 'all' ? 'bg-primary-600 border-primary-500 text-white' : 'border-slate-800 text-slate-400 hover:border-slate-700')}
        >
          {allLabel}
        </button>
        {BUILTIN_CATEGORIES.map((cat: { id: string; ru: string; en: string; icon: string }) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={cn('text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1', activeCategory === cat.id ? 'bg-primary-600 border-primary-500 text-white' : 'border-slate-800 text-slate-400 hover:border-slate-700')}
          >
            {renderIcon(cat.icon, 11)}
            {categoryLabel(cat, language)}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((tmpl) => (
          <div key={tmpl.id} className="group relative bg-surface-900 border border-slate-800 hover:border-primary-500/40 rounded-xl p-4 transition-all">
            <button onClick={() => onUse(tmpl)} className="w-full text-left">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 mt-0.5 text-primary-400">{renderIcon(tmpl.icon, 20)}</span>
                <div className="min-w-0 pr-10">
                  <p className="text-sm font-medium text-slate-200 group-hover:text-primary-300 transition-colors truncate">{tmplInfo(tmpl, language).name}</p>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{tmplInfo(tmpl, language).desc}</p>
                </div>
              </div>
            </button>
            <div className="absolute top-2 right-2 flex gap-0.5">
              <button
                onClick={(e) => handleEditCopy(e, tmpl)}
                disabled={copyingId === tmpl.id}
                className="p-1 rounded text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                title={isRu ? 'Редактировать копию' : 'Edit a copy'}
              >
                {copyingId === tmpl.id ? <Loader2 size={11} className="animate-spin" /> : <Pencil size={11} />}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleHide(tmpl.id) }}
                className="p-1 rounded text-slate-700 hover:text-slate-400 hover:bg-slate-800 transition-colors"
                title={isRu ? 'Скрыть' : 'Hide'}
              >
                <EyeOff size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
