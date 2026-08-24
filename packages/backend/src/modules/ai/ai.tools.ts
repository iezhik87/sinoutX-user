// ─── Tool catalog ─────────────────────────────────────────────────────────────
// Single source of truth for all AI tools. Used by both the service
// and the settings API (to return catalog metadata to the frontend).

export interface ToolMeta {
  name: string
  description: string
  description_en: string
  category: 'workspace' | 'research' | 'web' | 'analysis' | 'knowledge' | 'deep'
}

export const TOOL_CATALOG: ToolMeta[] = [
  // ── Workspace ────────────────────────────────────────────────
  { name: 'list_workspaces',        category: 'workspace', description: 'Получить список рабочих пространств',                                         description_en: 'List all workspaces' },
  { name: 'list_projects',          category: 'workspace', description: 'Получить список проектов',                                                     description_en: 'List projects in workspace' },
  { name: 'create_project',         category: 'workspace', description: 'Создать новый проект',                                                         description_en: 'Create a new project' },
  { name: 'list_pages',             category: 'workspace', description: 'Получить список страниц проекта',                                              description_en: 'List project pages' },
  { name: 'get_page',               category: 'workspace', description: 'Прочитать содержимое страницы',                                                description_en: 'Read page content' },
  { name: 'list_page_templates',    category: 'workspace', description: 'Список доступных шаблонов страниц (встроенные + пользовательские)',            description_en: 'List available page templates (built-in + user-saved)' },
  { name: 'create_page_from_template', category: 'workspace', description: 'Создать страницу из шаблона (встроенного или пользовательского)',          description_en: 'Create a page from a template (built-in or user-saved)' },
  { name: 'save_page_as_template',  category: 'workspace', description: 'Сохранить существующую страницу как шаблон для повторного использования',     description_en: 'Save an existing page as a reusable template' },
  { name: 'list_project_templates',      category: 'workspace', description: 'Список сохранённых шаблонов проектов',                                           description_en: 'List saved project templates' },
  { name: 'save_project_as_template',    category: 'workspace', description: 'Сохранить существующий проект как шаблон для повторного использования',          description_en: 'Save an existing project as a reusable template' },
  { name: 'create_project_from_template',category: 'workspace', description: 'Создать новый проект на основе шаблона проекта',                                 description_en: 'Create a new project from a project template' },
  { name: 'create_folder',          category: 'workspace', description: 'Создать папку для группировки страниц',                                         description_en: 'Create a folder to group pages' },
  { name: 'create_page',            category: 'workspace', description: 'Создать новую страницу',                                                       description_en: 'Create a new page' },
  { name: 'update_page',            category: 'workspace', description: 'Обновить заголовок или содержимое страницы',                                   description_en: 'Update page title or content' },
  { name: 'create_task',            category: 'workspace', description: 'Создать задачу в проекте',                                                     description_en: 'Create a task in a project' },
  { name: 'create_event',           category: 'workspace', description: 'Создать событие календаря с напоминанием (день рождения, встреча, дедлайн)',     description_en: 'Create a calendar event with a reminder (birthday, meeting, deadline)' },
  { name: 'list_events',            category: 'workspace', description: 'Найти события календаря (ДР/встречи) по имени или диапазону — перед «такого нет» вызови это', description_en: 'Find calendar events (birthdays/meetings) by name or date range — call before saying "no such event"' },
  { name: 'export_project',         category: 'workspace', description: 'Экспортировать проект в PDF или DOCX (в Telegram файл придёт прямо в чат)',     description_en: 'Export a project to PDF or DOCX (in Telegram the file is sent to the chat)' },
  { name: 'delete_item',            category: 'workspace', description: 'Удалить задачу/заметку/страницу/событие/проект (обратимо, в корзину на 30 дней)', description_en: 'Delete a task/note/page/event/project (reversible, kept in trash for 30 days)' },
  { name: 'list_trash',             category: 'workspace', description: 'Показать недавно удалённые объекты (корзина)',                                  description_en: 'List recently deleted items (trash)' },
  { name: 'restore_item',           category: 'workspace', description: 'Восстановить удалённый объект из корзины',                                      description_en: 'Restore a deleted item from trash' },
  { name: 'create_tasks_batch',     category: 'workspace', description: 'Создать несколько задач за один вызов (из страницы, плана, списка действий)',  description_en: 'Create multiple tasks in one call (from page, plan, action list)' },
  { name: 'list_tasks',             category: 'workspace', description: 'Получить список задач',                                                        description_en: 'List tasks' },
  { name: 'update_task',            category: 'workspace', description: 'Изменить задачу: статус (в т.ч. закрыть), срок, приоритет, повтор',            description_en: 'Update a task: status (incl. complete), due date, priority, recurrence' },
  { name: 'create_note',            category: 'workspace', description: 'Создать заметку',                                                              description_en: 'Create a note' },
  { name: 'add_budget_entry',       category: 'workspace', description: 'Добавить запись в бюджет',                                                     description_en: 'Add a budget entry' },
  { name: 'create_link',            category: 'workspace', description: 'Создать связь между объектами на графе',                                       description_en: 'Create a link between objects in the graph' },
  { name: 'create_links_batch',     category: 'workspace', description: 'Создать несколько связей между объектами за один вызов',                       description_en: 'Create multiple links between objects in one call' },
  { name: 'list_sources',           category: 'workspace', description: 'Получить список файлов/источников проекта',                                    description_en: 'List project files/sources' },
  { name: 'fetch_and_save_source',  category: 'workspace', description: 'Скачать URL и сохранить как источник в проект (с опциональной автосвязью)',    description_en: 'Fetch a URL and save as a project source (with optional auto-linking)' },
  { name: 'save_sources_batch',     category: 'workspace', description: 'Скачать несколько URL параллельно и сохранить как источники + создать связи',  description_en: 'Fetch multiple URLs in parallel, save as sources and create links' },
  // ── Research (web search) ─────────────────────────────────────
  { name: 'web_search',             category: 'research',  description: 'Поиск в интернете через SearXNG (агрегирует Google, Bing, DuckDuckGo и др.)',  description_en: 'Web search via SearXNG (aggregates Google, Bing, DuckDuckGo, etc.)' },
  { name: 'fetch_url',              category: 'research',  description: 'Прочитать содержимое веб-страницы (сырой текст)',                              description_en: 'Read a web page (raw text)' },
  { name: 'search_wikipedia',       category: 'research',  description: 'Поиск в Википедии (рус + англ) — факты, определения, биографии',              description_en: 'Search Wikipedia (ru + en) — facts, definitions, biographies' },
  { name: 'search_academic',        category: 'research',  description: 'Поиск научных статей в Semantic Scholar (бесплатно, без ключа)',               description_en: 'Search academic papers on Semantic Scholar (free, no key required)' },
  { name: 'search_news',            category: 'research',  description: 'Поиск новостей через SearXNG (Google News, Bing News и др.)',                  description_en: 'Search news via SearXNG (Google News, Bing News, etc.)' },
  { name: 'multi_search',           category: 'research',  description: 'Выполнить несколько поисковых запросов параллельно и объединить результаты',   description_en: 'Run multiple search queries in parallel and merge results' },
  // ── Web (deep reading) ────────────────────────────────────────
  { name: 'extract_article',        category: 'web',       description: 'Извлечь чистый текст статьи (удаляет навигацию, рекламу, скрипты)',            description_en: 'Extract clean article text (removes nav, ads, scripts)' },
  { name: 'extract_links',          category: 'web',       description: 'Получить все ссылки со страницы (для обхода сайта)',                           description_en: 'Get all links from a page (for site crawling)' },
  { name: 'crawl_topic',            category: 'web',       description: 'Обойти N страниц сайта начиная с URL — собрать контент каждой',               description_en: 'Crawl N pages of a site starting from a URL — collect content from each' },
  { name: 'get_youtube_transcript', category: 'web',       description: 'Получить субтитры/транскрипт YouTube-видео по URL',                           description_en: 'Get subtitles/transcript of a YouTube video by URL' },
  // ── Analysis ──────────────────────────────────────────────────
  { name: 'compare_sources',        category: 'analysis',  description: 'Сравнить несколько источников (по URL) — найти общее и противоречия',          description_en: 'Compare multiple sources (by URL) — find commonalities and contradictions' },
  { name: 'extract_facts',          category: 'analysis',  description: 'Извлечь факты из текста: даты, числа, имена, организации',                    description_en: 'Extract facts from text: dates, numbers, names, organizations' },
  { name: 'build_timeline',         category: 'analysis',  description: 'Построить хронологию событий из текста или набора URL',                        description_en: 'Build a timeline of events from text or a set of URLs' },
  { name: 'extract_outline',        category: 'analysis',  description: 'Извлечь структуру/оглавление из статьи или страницы',                         description_en: 'Extract structure/outline from an article or page' },
  // ── Knowledge base ────────────────────────────────────────────
  { name: 'search_workspace',       category: 'knowledge', description: 'Полнотекстовый поиск по своей базе знаний (страницы, задачи, заметки)',        description_en: 'Full-text search across your knowledge base (pages, tasks, notes)' },
  { name: 'find_related_pages',     category: 'knowledge', description: 'Найти похожие страницы в базе по теме',                                        description_en: 'Find similar pages in the knowledge base by topic' },
  { name: 'read_page_with_children',category: 'knowledge', description: 'Прочитать страницу со всеми дочерними страницами',                            description_en: 'Read a page with all its child pages' },
  { name: 'bulk_create_notes',      category: 'knowledge', description: 'Создать несколько заметок за раз (результаты исследования)',                   description_en: 'Create multiple notes at once (research results)' },
  // ── Files ─────────────────────────────────────────────────────
  { name: 'read_document_url',      category: 'web',       description: 'Скачать и прочитать любой документ по URL: PDF, DOCX, XLSX, TXT, CSV, JSON и другие', description_en: 'Download and read any document by URL: PDF, DOCX, XLSX, TXT, CSV, JSON and more' },
  { name: 'read_attachment',        category: 'knowledge', description: 'Прочитать содержимое файла в проекте (по attachmentId): документы и изображения — фото/чеки распознаются vision-моделью', description_en: 'Read a file saved in a project (by attachmentId): documents and images — photos/receipts are read with a vision model' },
  // ── Media ─────────────────────────────────────────────────────
  { name: 'generate_image',         category: 'research',  description: 'Сгенерировать изображение по описанию (провайдер из настроек: OpenAI/FLUX/Stability/fal.ai/OpenRouter, иначе бесплатный)', description_en: 'Generate an image from a description (provider from settings: OpenAI/FLUX/Stability/fal.ai/OpenRouter, else free)' },
  { name: 'generate_audio',         category: 'research',  description: 'Озвучить текст (TTS: OpenAI/ElevenLabs/PlayHT, иначе бесплатный)', description_en: 'Speak text aloud (TTS: OpenAI/ElevenLabs/PlayHT, else free)' },
  { name: 'search_images',          category: 'research',  description: 'Поиск свободных изображений на Wikimedia Commons по теме (без API-ключа)',         description_en: 'Search free images on Wikimedia Commons by topic (no API key required)' },
  // ── Deep research ──────────────────────────────────────────────
  { name: 'deep_research',          category: 'deep',      description: 'Глубокое исследование темы: web + Wikipedia + академические статьи + база знаний', description_en: 'Deep research on a topic: web + Wikipedia + academic papers + knowledge base' },
  // ── Project memory ─────────────────────────────────────────────
  { name: 'get_project_memory',     category: 'knowledge', description: 'Прочитать память проекта — накопленные знания об этом проекте', description_en: 'Read project memory — accumulated knowledge about this project' },
  { name: 'update_project_memory',  category: 'knowledge', description: 'Обновить память проекта — сохранить важные исследования, решения и контекст', description_en: 'Update project memory — save important research, decisions and context' },
  { name: 'remember',               category: 'knowledge', description: 'Запомнить надолго в сквозную память воркспейса (факт/ядро/сущность/эпизод)', description_en: 'Remember long-term into workspace-wide memory (fact/core/entity/episode)' },
  { name: 'recall',                 category: 'knowledge', description: 'Вспомнить из долговременной памяти по смыслу (семантически)', description_en: 'Recall from long-term memory by meaning (semantic)' },
  { name: 'memory_stats',           category: 'knowledge', description: 'Статистика памяти о пользователе (сколько фактов/сущностей/эпизодов/ядра, покрытие семантическим индексом)', description_en: 'Memory stats about the user (counts of facts/entities/episodes/core, semantic index coverage)' },
  { name: 'memory_digest',          category: 'knowledge', description: 'Сводка «что я о тебе знаю» — Ядро/ключевые факты/люди-проекты, для показа и коррекции', description_en: 'Digest of "what I know about you" — core/key facts/people-projects, for review and correction' },
  { name: 'forget_memory',          category: 'knowledge', description: 'Забыть из памяти конкретное (когда пользователь говорит «это неверно/забудь»)', description_en: 'Forget a specific memory (when the user says "that\'s wrong / forget it")' },
  { name: 'search_conversations',   category: 'knowledge', description: 'Поиск по ПРОШЛЫМ разговорам — найти, что и когда обсуждали (сообщение + название чата + дата)', description_en: 'Search PAST conversations — find what was discussed and when (message + chat title + date)' },
  { name: 'build_expertise',        category: 'knowledge', description: 'Собрать себе ЭКСПЕРТИЗУ по теме: проект-база знаний + плейбук эксперта (дальше засеваешь deep_research и заполняешь)', description_en: 'Build yourself an EXPERTISE in a domain: a knowledge-base project + expert playbook (then seed via deep_research and fill it)' },
  { name: 'activate_expertise',     category: 'knowledge', description: 'Надеть готовую экспертизу — загрузить её плейбук и работать как эксперт в этой теме', description_en: 'Put on a built expertise — load its playbook and act as an expert in that domain' },
  { name: 'list_expertises',        category: 'knowledge', description: 'Список собранных экспертиз', description_en: 'List built expertises' },
  { name: 'grow_expertise',         category: 'knowledge', description: 'Дописать в экспертизу новое усвоенное (решение/факт/грабли) — она доучивается с опытом', description_en: 'Append a new learning (decision/fact/pitfall) to an expertise — it keeps learning with use' },
  { name: 'create_http_skill',      category: 'knowledge', description: 'Собрать навык к внешнему REST API (создаётся выключенным — пользователь одобряет и вставляет ключ)', description_en: 'Author a skill for an external REST API (created disabled — the user approves and pastes the key)' },
  { name: 'create_skill',           category: 'knowledge', description: 'Завести себе навык по расписанию (скил) — повторяющееся действие', description_en: 'Set up a scheduled skill — a recurring action' },
  { name: 'list_skills',            category: 'knowledge', description: 'Список своих навыков по расписанию (скилов)', description_en: 'List own scheduled skills' },
  { name: 'delete_skill',           category: 'knowledge', description: 'Удалить навык по расписанию', description_en: 'Delete a scheduled skill' },
  { name: 'execute_code',           category: 'knowledge', description: 'Выполнить код в песочнице (Python/bash) — право code_exec', description_en: 'Run code in a sandbox — requires code_exec' },
  // ── Модули / Реестры (Collections) ─────────────────────────────
  { name: 'list_collections',       category: 'knowledge', description: 'Список реестров (типизированных наборов записей) установленных модулей в воркспейсе и их схема полей', description_en: 'List collections (typed datasets) of installed modules in the workspace and their field schema' },
  { name: 'install_module',         category: 'knowledge', description: 'Установить модуль с типизированными реестрами (auto/finance/medical-record/vault/personal-growth)', description_en: 'Install a module with typed registries (auto/finance/medical-record/vault/personal-growth)' },
  { name: 'query_records',          category: 'knowledge', description: 'Прочитать записи реестра', description_en: 'Read records from a collection' },
  { name: 'create_registry',        category: 'knowledge', description: 'Создать СВОЙ типизированный реестр под новую сферу (сам задаёшь поля) — когда данные повторяются, а готового модуля нет', description_en: 'Create your OWN typed registry for a new domain (you define the fields) — when data recurs and no built-in module fits' },
  { name: 'delete_registry',        category: 'knowledge', description: 'Удалить КАСТОМНЫЙ реестр (ошибочный/пустой дубль) по collectionId. Встроенные модули не трогает', description_en: 'Delete a CUSTOM registry (a wrong/empty duplicate) by collectionId. Does not touch built-in modules' },
  { name: 'finance_overview',       category: 'knowledge', description: 'Готовые балансы счетов и денежный поток (движок считает сам — не складывай в уме)', description_en: 'Computed account balances and cashflow (engine-computed — never sum by hand)' },
  { name: 'get_secret',             category: 'knowledge', description: 'Достать логин/пароль/секрет из Сейфа по запросу (право vault:reveal)', description_en: 'Fetch a login/password/secret from the Vault (requires vault:reveal)' },
  { name: 'create_record',          category: 'knowledge', description: 'Добавить запись в реестр модуля (например, анализ в Медкарту)', description_en: 'Add a record to a module collection (e.g. a lab result in Medical Record)' },
  { name: 'update_record',          category: 'knowledge', description: 'Изменить запись реестра (мерж: только изменяемые поля)', description_en: 'Update a collection record (merge: only the changed fields)' },
  { name: 'delete_record',          category: 'knowledge', description: 'Удалить запись реестра', description_en: 'Delete a collection record' },
  // ── Canvas (доска идей) ───────────────────────────────────────
  { name: 'list_canvases',          category: 'workspace', description: 'Список досок идей в воркспейсе',                                                  description_en: 'List idea canvases in the workspace' },
  { name: 'create_canvas',          category: 'workspace', description: 'Создать новую доску идей',                                                       description_en: 'Create a new idea canvas' },
  { name: 'add_canvas_node',        category: 'workspace', description: 'Добавить узел на доску идей (картинку, заметку, текст, ссылку, страницу, задачу)', description_en: 'Add a node to an idea canvas (image, note, text, link, page, task)' },
  // ── Личный рост (Growth) ──────────────────────────────────────
  { name: 'create_habit',           category: 'workspace', description: 'Создать привычку для отслеживания (с периодом неделя/месяц/год)',                description_en: 'Create a habit to track (with a week/month/year period)' },
  { name: 'check_habit',            category: 'workspace', description: 'Отметить выполнение привычки на дату',                                              description_en: 'Mark a habit as done on a date' },
  { name: 'create_objective',       category: 'workspace', description: 'Создать цель (OKR) на квартал',                                                    description_en: 'Create an objective (OKR) for a quarter' },
  { name: 'add_key_result',         category: 'workspace', description: 'Добавить ключевой результат (KR) к цели',                                          description_en: 'Add a key result (KR) to an objective' },
  { name: 'create_journal_entry',   category: 'workspace', description: 'Создать/обновить запись в дневнике за дату (с настроением)',                       description_en: 'Create/update a journal entry for a date (with mood)' },
]

// ─── Anthropic format ─────────────────────────────────────────────────────────

import type Anthropic from '@anthropic-ai/sdk'

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  // ── Workspace ────────────────────────────────────────────────
  {
    name: 'list_workspaces',
    description: 'Получить список всех рабочих пространств',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_projects',
    description: 'Получить список проектов в рабочем пространстве. По умолчанию возвращает только активные проекты. Используй includeArchived: true чтобы найти архивные проекты.',
    input_schema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'ID рабочего пространства' },
        includeArchived: { type: 'boolean', description: 'Включить архивные проекты в список (по умолчанию false)' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'create_project',
    description: 'Создать новый проект в рабочем пространстве',
    input_schema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        name: { type: 'string', description: 'Название проекта' },
        description: { type: 'string', description: 'Описание проекта' },
        icon: { type: 'string', description: 'Иконка в формате lucide:ИмяИконки (например lucide:Leaf, lucide:BookOpen, lucide:Zap, lucide:Globe, lucide:Layers). НЕ используй эмодзи.' },
      },
      required: ['workspaceId', 'name'],
    },
  },
  {
    name: 'list_pages',
    description: 'Получить список страниц проекта',
    input_schema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'get_page',
    description: 'Получить содержимое страницы',
    input_schema: {
      type: 'object',
      properties: { pageId: { type: 'string' } },
      required: ['pageId'],
    },
  },
  {
    name: 'create_folder',
    description: 'Создать папку в проекте для группировки страниц',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string', description: 'Название папки' },
        parentPageId: { type: 'string', description: 'ID родительской папки (для вложенных папок)' },
      },
      required: ['projectId', 'title'],
    },
  },
  {
    name: 'create_page',
    description: 'Создать новую страницу в проекте. КРИТИЧЕСКИ ВАЖНО: параметр content ОБЯЗАТЕЛЕН — всегда передавай полный содержательный текст (минимум 300 слов). НИКОГДА не создавай страницу без content. Пустая страница = ошибка выполнения задачи.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string', description: 'Заголовок страницы' },
        content: { type: 'string', description: 'ОБЯЗАТЕЛЬНО. Полный текст страницы (минимум 300 слов). Поддерживает markdown: # заголовки, **жирный**, *курсив*, - списки, | таблицы, ```код```. Пиши весь контент здесь — не оставляй пустым.' },
        parentPageId: { type: 'string', description: 'ID родительской страницы или папки (для вложенности)' },
        icon: { type: 'string', description: 'Иконка в формате lucide:ИмяИконки (например lucide:FileText, lucide:BookOpen, lucide:BarChart, lucide:Globe, lucide:Lightbulb). НЕ используй эмодзи.' },
      },
      required: ['projectId', 'title', 'content'],
    },
  },
  {
    name: 'update_page',
    description: 'Обновить заголовок или содержимое страницы. Если передаёшь content — пиши полный текст (минимум 300 слов). Поддерживает markdown: # заголовки, **жирный**, - списки, | таблицы.',
    input_schema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string', description: 'Полный новый текст страницы (минимум 300 слов). Поддерживает markdown.' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'list_page_templates',
    description: 'Список доступных шаблонов страниц. Возвращает встроенные шаблоны (43 шт.) и пользовательские сохранённые шаблоны.',
    input_schema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'ID рабочего пространства (для пользовательских шаблонов)' },
        category: { type: 'string', description: 'Фильтр по категории: business, reports, planning, hr, technical, education, personal' },
      },
      required: [],
    },
  },
  {
    name: 'create_page_from_template',
    description: 'Создать страницу в проекте на основе шаблона. Используй templateId из list_page_templates.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID проекта' },
        templateId: { type: 'string', description: 'ID шаблона (из list_page_templates)' },
        title: { type: 'string', description: 'Название новой страницы (если не указано — берётся из шаблона)' },
        parentPageId: { type: 'string', description: 'ID родительской страницы (опционально)' },
      },
      required: ['projectId', 'templateId'],
    },
  },
  {
    name: 'save_page_as_template',
    description: 'Сохранить существующую страницу как шаблон для повторного использования.',
    input_schema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'ID страницы для сохранения как шаблон' },
        projectId: { type: 'string', description: 'ID проекта, к которому привязать шаблон' },
        name: { type: 'string', description: 'Название шаблона' },
      },
      required: ['pageId', 'projectId', 'name'],
    },
  },
  {
    name: 'list_project_templates',
    description: 'Список сохранённых шаблонов проектов в рабочем пространстве.',
    input_schema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'ID рабочего пространства' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'save_project_as_template',
    description: 'Сохранить существующий проект как шаблон проекта для повторного использования.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID проекта для сохранения как шаблон' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'create_project_from_template',
    description: 'Создать новый проект на основе шаблона проекта (включая все страницы).',
    input_schema: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: 'ID шаблона проекта (из list_project_templates)' },
        name: { type: 'string', description: 'Название нового проекта' },
        workspaceId: { type: 'string', description: 'ID рабочего пространства' },
      },
      required: ['templateId', 'name', 'workspaceId'],
    },
  },
  {
    name: 'create_task',
    description: 'Создать задачу в проекте. ВСЕГДА указывай startDate (сегодняшняя дата) и dueDate (оценочная дата завершения). Если пользователь просит напоминание — заполни remindBefore (например ["1d"] = за день до дедлайна) или reminderAt (точные даты-время). Напоминания приходят в Telegram, если интеграция подключена.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'] },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        startDate: { type: 'string', description: 'Дата начала в ISO формате (YYYY-MM-DD). По умолчанию — сегодняшняя дата. ОБЯЗАТЕЛЬНО указывай.' },
        dueDate: { type: 'string', description: 'Предполагаемая дата завершения в ISO формате (YYYY-MM-DD). ОБЯЗАТЕЛЬНО указывай — оцени срок исходя из сложности задачи, начиная от сегодняшней даты.' },
        remindBefore: { type: 'array', items: { type: 'string' }, description: 'За сколько до dueDate напомнить. Формат: "30m", "2h", "1d", "1w". Пример: ["1d"] = за сутки. Можно несколько.' },
        reminderAt: { type: 'array', items: { type: 'string' }, description: 'Точные моменты напоминаний в ISO (YYYY-MM-DDTHH:mm). Альтернатива remindBefore.' },
        recurrence: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'weekdays'], description: 'ЦИКЛИЧНАЯ задача (напр. еженедельный отчёт). При закрытии задачи автоматически создаётся следующая на нужную дату. Для «каждый понедельник» — weekly с dueDate на ближайший понедельник.' },
      },
      required: ['projectId', 'title'],
    },
  },
  {
    name: 'update_task',
    description: 'Изменить существующую задачу по её id (возьми из list_tasks). Так МЕНЯЮТ статус (в т.ч. «сделано» → status:"DONE»), срок, приоритет, название, напоминания, повтор. НЕ пересоздавай задачу ради смены статуса — используй этот инструмент. Если задача цикличная и переводишь в DONE — следующая создастся автоматически.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID задачи (из list_tasks).' },
        title: { type: 'string' },
        status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'] },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        startDate: { type: 'string', description: 'Дата начала ISO (YYYY-MM-DD) или null чтобы очистить.' },
        dueDate: { type: 'string', description: 'Срок ISO (YYYY-MM-DD[THH:mm]) или null чтобы очистить.' },
        remindBefore: { type: 'array', items: { type: 'string' }, description: 'За сколько до dueDate напомнить: "30m","2h","1d","1w".' },
        reminderAt: { type: 'array', items: { type: 'string' }, description: 'Точные моменты напоминаний в ISO.' },
        recurrence: { type: 'string', enum: ['none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'weekdays'], description: 'Сделать/поменять цикличность. "none" — убрать повтор.' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'create_event',
    description: 'Создать событие календаря с опциональным напоминанием в Telegram. Используй для дней рождения, встреч, дедлайнов, годовщин. Для дня рождения: allDay=true, recurrence="yearly". Чтобы напомнить заранее — remindBefore (например ["1d"] = за день) или reminderAt (точные даты). Сегодняшнюю дату бери из системного промпта, чтобы вычислить правильный год.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Проект, к которому привязать событие.' },
        title: { type: 'string', description: 'Название события, напр. "День рождения Анны".' },
        startAt: { type: 'string', description: 'Дата/время начала в ISO. Для события на весь день — YYYY-MM-DD. Иначе YYYY-MM-DDTHH:mm.' },
        endAt: { type: 'string', description: 'Дата/время окончания в ISO (необязательно).' },
        allDay: { type: 'boolean', description: 'Событие на весь день (для дней рождения — true).' },
        recurrence: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'weekdays'], description: 'Повтор. Для дня рождения — "yearly".' },
        remindBefore: { type: 'array', items: { type: 'string' }, description: 'За сколько до startAt напомнить: "30m","2h","1d","1w". Пример: ["1d"] = за день. Можно несколько.' },
        reminderAt: { type: 'array', items: { type: 'string' }, description: 'Точные моменты напоминаний в ISO. Альтернатива remindBefore.' },
        location: { type: 'string', description: 'Место (необязательно).' },
        description: { type: 'string', description: 'Описание (необязательно).' },
      },
      required: ['projectId', 'title', 'startAt'],
    },
  },
  {
    name: 'list_events',
    description: 'Найти события календаря воркспейса (дни рождения, встречи, дедлайны, годовщины). ОБЯЗАТЕЛЬНО вызывай перед тем, как сказать «такого события/ДР нет» — по памяти события не ищутся, только этим инструментом. Поиск по имени: query="Касьяник" вернёт его день рождения, если он заведён. Без query — весь список. Повторяющиеся события (ДР) возвращаются с полем recurring и показываются всегда, независимо от диапазона дат.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Подстрока названия (имя человека, тема). Регистр не важен. Пусто — вернуть все события.' },
        from: { type: 'string', description: 'Начало диапазона дат (YYYY-MM-DD), необязательно. К повторяющимся событиям не применяется.' },
        to: { type: 'string', description: 'Конец диапазона дат (YYYY-MM-DD), необязательно.' },
      },
      required: [],
    },
  },
  {
    name: 'export_project',
    description: 'Экспортировать проект (его страницы) в файл PDF или DOCX. В сессии Telegram файл автоматически отправляется в чат пользователю. Используй, когда просят «отдай/выгрузи/экспортируй проект в pdf/word/docx».',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID проекта. Если не указан — берётся текущий проект.' },
        format: { type: 'string', enum: ['pdf', 'docx'], description: 'Формат файла. По умолчанию pdf.' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'delete_item',
    description: 'Удалить объект: задачу, заметку, страницу, событие или проект. Удаление ОБРАТИМО — объект попадает в корзину на 30 дней, проект архивируется. Перед удалением убедись, что нашёл правильный id (через list_tasks / list_pages / list_projects / search_workspace). Если пользователь не уточнил, что именно удалить, — переспроси.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['task', 'note', 'page', 'event', 'project'], description: 'Тип объекта.' },
        id: { type: 'string', description: 'ID объекта.' },
      },
      required: ['type', 'id'],
    },
  },
  {
    name: 'list_trash',
    description: 'Показать недавно удалённые объекты (корзина, до 30 дней). Используй, чтобы найти, что восстановить.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['task', 'note', 'page', 'event', 'project'], description: 'Необязательный фильтр по типу.' },
      },
    },
  },
  {
    name: 'restore_item',
    description: 'Восстановить удалённый объект из корзины. Передай trashId (из list_trash) ИЛИ title для поиска по названию. Без параметров восстанавливает последнее удалённое.',
    input_schema: {
      type: 'object',
      properties: {
        trashId: { type: 'string', description: 'ID записи в корзине (из list_trash).' },
        title: { type: 'string', description: 'Название удалённого объекта (поиск по подстроке).' },
      },
    },
  },
  {
    name: 'create_tasks_batch',
    description: 'Создать несколько задач в проекте за один вызов. Используй когда нужно создать задачи из содержимого страницы, плана проекта или списка action items. ВСЕГДА указывай startDate и dueDate для каждой задачи.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        tasks: {
          type: 'array',
          description: 'Список задач для создания',
          items: {
            type: 'object',
            properties: {
              title:     { type: 'string', description: 'Название задачи' },
              priority:  { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], description: 'Приоритет (по умолчанию MEDIUM)' },
              status:    { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED'], description: 'Статус (по умолчанию TODO)' },
              startDate: { type: 'string', description: 'Дата начала в ISO формате (YYYY-MM-DD). По умолчанию — сегодняшняя дата. ОБЯЗАТЕЛЬНО указывай.' },
              dueDate:   { type: 'string', description: 'Предполагаемая дата завершения в ISO формате (YYYY-MM-DD). ОБЯЗАТЕЛЬНО указывай — оцени срок исходя из сложности задачи, начиная от сегодняшней даты.' },
            },
            required: ['title'],
          },
        },
      },
      required: ['projectId', 'tasks'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Список задач. БЕЗ projectId — задачи ВСЕГО воркспейса (используй, чтобы НАЙТИ задачу по названию, не зная проект, и взять её taskId для update_task/delete_item). С projectId — только этого проекта. Возвращает id, title, status, priority, dueDate и project (имя проекта).',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Необязательно. Если не указан — задачи всех проектов воркспейса.' },
        status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'] },
      },
      required: [],
    },
  },
  {
    name: 'create_note',
    description: 'Создать заметку в проекте',
    input_schema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        projectId: { type: 'string' },
        content: { type: 'string', description: 'Текст заметки' },
        pinned: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['workspaceId', 'content'],
    },
  },
  {
    name: 'add_budget_entry',
    description: 'Добавить запись в бюджет проекта',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        type: { type: 'string', enum: ['INCOME', 'EXPENSE'] },
        category: { type: 'string' },
        amount: { type: 'number' },
        currency: { type: 'string', default: 'USD' },
        date: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['projectId', 'type', 'category', 'amount', 'date'],
    },
  },
  {
    name: 'create_link',
    description: 'Создать связь между двумя сущностями на графе',
    input_schema: {
      type: 'object',
      properties: {
        sourceType: { type: 'string', enum: ['page', 'task', 'note', 'attachment'] },
        sourceId: { type: 'string' },
        targetType: { type: 'string', enum: ['page', 'task', 'note', 'attachment'] },
        targetId: { type: 'string' },
        linkType: { type: 'string', enum: ['REFERENCE', 'RELATED', 'DEPENDS_ON', 'BLOCKS'] },
      },
      required: ['sourceType', 'sourceId', 'targetType', 'targetId'],
    },
  },
  {
    name: 'fetch_and_save_source',
    description: 'Скачать файл или веб-страницу по URL и сохранить как источник в проект. После сохранения может автоматически создать связь с указанной сущностью.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL файла или веб-страницы' },
        workspaceId: { type: 'string' },
        projectId: { type: 'string' },
        description: { type: 'string', description: 'Краткое описание источника' },
        isImportant: { type: 'boolean' },
        customFilename: { type: 'string' },
        linkTo: {
          type: 'object',
          description: 'Создать связь после сохранения — linkType: REFERENCE (цитирует), RELATED (похоже), DEPENDS_ON',
          properties: {
            type: { type: 'string', enum: ['page', 'task', 'note'] },
            id: { type: 'string' },
            linkType: { type: 'string', enum: ['REFERENCE', 'RELATED', 'DEPENDS_ON', 'BLOCKS'], default: 'REFERENCE' },
          },
          required: ['type', 'id'],
        },
      },
      required: ['url', 'workspaceId', 'projectId'],
    },
  },
  {
    name: 'save_sources_batch',
    description: 'Скачать несколько URL параллельно и сохранить как источники в проект. Можно сразу создать связи каждого источника с указанной сущностью (страницей, задачей или заметкой). Используй после web_search для массового сохранения результатов.',
    input_schema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Список URL для скачивания (не более 15 за раз)',
        },
        workspaceId: { type: 'string' },
        projectId: { type: 'string' },
        descriptions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Описания для каждого источника по порядку (необязательно)',
        },
        isImportant: { type: 'boolean', description: 'Отметить все как важные' },
        linkTo: {
          type: 'object',
          description: 'Создать связь каждого источника с этой сущностью после сохранения',
          properties: {
            type: { type: 'string', enum: ['page', 'task', 'note'] },
            id: { type: 'string' },
            linkType: { type: 'string', enum: ['REFERENCE', 'RELATED', 'DEPENDS_ON', 'BLOCKS'], default: 'REFERENCE' },
          },
          required: ['type', 'id'],
        },
      },
      required: ['urls', 'workspaceId', 'projectId'],
    },
  },
  {
    name: 'create_links_batch',
    description: 'Создать несколько связей между объектами за один вызов. Используй для массового связывания источников с страницами/задачами.',
    input_schema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        links: {
          type: 'array',
          description: 'Массив связей для создания',
          items: {
            type: 'object',
            properties: {
              sourceType: { type: 'string', enum: ['page', 'task', 'note', 'attachment'] },
              sourceId: { type: 'string' },
              targetType: { type: 'string', enum: ['page', 'task', 'note', 'attachment'] },
              targetId: { type: 'string' },
              linkType: { type: 'string', enum: ['REFERENCE', 'RELATED', 'DEPENDS_ON', 'BLOCKS'], default: 'REFERENCE' },
            },
            required: ['sourceType', 'sourceId', 'targetType', 'targetId'],
          },
        },
      },
      required: ['workspaceId', 'links'],
    },
  },
  {
    name: 'list_sources',
    description: 'Получить список источников (вложений) проекта',
    input_schema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },

  // ── Research ─────────────────────────────────────────────────
  {
    name: 'web_search',
    description: 'Найти информацию в интернете через SearXNG (агрегирует Google, Bing, DDG и др.). Возвращает список результатов с заголовками, URL и сниппетами.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Поисковый запрос' },
        limit: { type: 'number', description: 'Максимальное количество результатов (по умолчанию 8)' },
        language: { type: 'string', description: 'Язык результатов: "all" — все языки (по умолчанию), "ru-RU" — только русский, "en-US" — только английский' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Прочитать содержимое веб-страницы и вернуть текст. Для статей лучше использовать extract_article.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL страницы для чтения' },
        maxLength: { type: 'number', description: 'Максимальная длина текста в символах (по умолчанию 8000)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'search_wikipedia',
    description: 'Поиск в Википедии. Автоматически ищет на русском и английском. Возвращает краткие выжимки с ссылками.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Поисковый запрос (термин, имя, событие)' },
        lang: { type: 'string', description: 'Язык: ru, en, или auto (по умолчанию). auto ищет сначала на ru, потом en.' },
        limit: { type: 'number', description: 'Количество статей (1–5, по умолчанию 3)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_academic',
    description: 'Поиск научных статей в Semantic Scholar. Бесплатно, без ключа. Возвращает заголовки, аннотации, авторов, год, DOI.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Тема или название статьи (лучше на английском)' },
        limit: { type: 'number', description: 'Количество результатов (1–10, по умолчанию 5)' },
        yearFrom: { type: 'number', description: 'Фильтр: год публикации от' },
        yearTo: { type: 'number', description: 'Фильтр: год публикации до' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_news',
    description: 'Поиск новостей и технических обсуждений на HackerNews. Хорошо для tech, science, startup тематик.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Поисковый запрос' },
        limit: { type: 'number', description: 'Количество результатов (по умолчанию 10)' },
        sortBy: { type: 'string', enum: ['relevance', 'date'], description: 'Сортировка (по умолчанию relevance)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'multi_search',
    description: 'Выполнить несколько поисковых запросов параллельно и объединить результаты. Идеально для исследования темы с разных сторон.',
    input_schema: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' }, description: 'Список поисковых запросов (до 5 штук)' },
        limitPerQuery: { type: 'number', description: 'Результатов на запрос (по умолчанию 5)' },
      },
      required: ['queries'],
    },
  },

  // ── Web ──────────────────────────────────────────────────────
  {
    name: 'extract_article',
    description: 'Извлечь чистый читаемый текст статьи с веб-страницы. Удаляет навигацию, рекламу, скрипты. Лучше чем fetch_url для статей.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL статьи' },
        maxLength: { type: 'number', description: 'Максимальная длина в символах (по умолчанию 12000)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'extract_links',
    description: 'Получить все ссылки со страницы. Полезно для обхода сайта или нахождения связанных материалов.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL страницы' },
        filter: { type: 'string', description: 'Фильтр ссылок: internal (только того же домена), external, или all (по умолчанию)' },
        limit: { type: 'number', description: 'Максимальное количество ссылок (по умолчанию 30)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'crawl_topic',
    description: 'Обойти несколько страниц сайта, начиная с заданного URL. Собирает контент каждой страницы. Полезно для изучения документации или раздела сайта.',
    input_schema: {
      type: 'object',
      properties: {
        startUrl: { type: 'string', description: 'Стартовая URL-страница' },
        maxPages: { type: 'number', description: 'Максимум страниц для обхода (1–8, по умолчанию 4)' },
        sameDomainOnly: { type: 'boolean', description: 'Только страницы того же домена (по умолчанию true)' },
      },
      required: ['startUrl'],
    },
  },
  {
    name: 'get_youtube_transcript',
    description: 'Получить транскрипт (субтитры) YouTube-видео. Поддерживает русский и английский языки. Не требует API ключа.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL YouTube-видео (youtu.be/... или youtube.com/watch?v=...)' },
        lang: { type: 'string', description: 'Предпочтительный язык субтитров: ru, en и т.д. (по умолчанию ru)' },
      },
      required: ['url'],
    },
  },

  // ── Analysis ──────────────────────────────────────────────────
  {
    name: 'compare_sources',
    description: 'Получить содержимое нескольких URL и вернуть их рядом для сравнения. Удобно для анализа противоречий между источниками.',
    input_schema: {
      type: 'object',
      properties: {
        urls: { type: 'array', items: { type: 'string' }, description: 'Список URL для сравнения (2–5 штук)' },
        maxLengthPerSource: { type: 'number', description: 'Символов на источник (по умолчанию 4000)' },
      },
      required: ['urls'],
    },
  },
  {
    name: 'extract_facts',
    description: 'Извлечь структурированные факты из текста: даты, числа с контекстом, имена, организации, упомянутые ссылки.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Текст для анализа. Если не указан — будет прочитан url.' },
        url: { type: 'string', description: 'URL страницы (альтернатива text)' },
      },
    },
  },
  {
    name: 'build_timeline',
    description: 'Построить хронологию событий из текста или нескольких URL. Извлекает пары "дата — событие".',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Текст для анализа. Если не указан — будет прочитан url.' },
        urls: { type: 'array', items: { type: 'string' }, description: 'Список URL (альтернатива text, до 3 штук)' },
      },
    },
  },
  {
    name: 'extract_outline',
    description: 'Извлечь структуру/оглавление из статьи или HTML-страницы. Возвращает иерархию заголовков.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL страницы' },
        text: { type: 'string', description: 'Текст (альтернатива url)' },
      },
    },
  },

  // ── Knowledge base ────────────────────────────────────────────
  {
    name: 'search_workspace',
    description: 'Полнотекстовый поиск по базе знаний (страницы, задачи, заметки) через Meilisearch.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Поисковый запрос' },
        workspaceId: { type: 'string' },
        projectId: { type: 'string', description: 'Ограничить поиск одним проектом (опционально)' },
        types: { type: 'array', items: { type: 'string', enum: ['page', 'task', 'note'] }, description: 'Типы объектов (по умолчанию все)' },
        limit: { type: 'number', description: 'Количество результатов (по умолчанию 15)' },
      },
      required: ['query', 'workspaceId'],
    },
  },
  {
    name: 'find_related_pages',
    description: 'Найти страницы в базе знаний, похожие по теме. Ищет по ключевым словам через Meilisearch.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Тема или ключевые слова для поиска похожих страниц' },
        workspaceId: { type: 'string' },
        excludePageId: { type: 'string', description: 'Исключить эту страницу из результатов' },
        limit: { type: 'number', description: 'Количество результатов (по умолчанию 8)' },
      },
      required: ['topic', 'workspaceId'],
    },
  },
  {
    name: 'read_page_with_children',
    description: 'Прочитать страницу и все её дочерние страницы. Полезно для получения полного контекста раздела.',
    input_schema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'ID корневой страницы' },
        maxDepth: { type: 'number', description: 'Максимальная глубина вложенности (по умолчанию 2)' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'bulk_create_notes',
    description: 'Создать несколько заметок за раз. Удобно для сохранения результатов исследования.',
    input_schema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        projectId: { type: 'string', description: 'Привязать к проекту (опционально)' },
        notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              pinned: { type: 'boolean' },
            },
            required: ['content'],
          },
          description: 'Список заметок для создания',
        },
      },
      required: ['workspaceId', 'notes'],
    },
  },

  // ── Files ────────────────────────────────────────────────────
  {
    name: 'read_document_url',
    description: 'Скачать документ по URL и извлечь текстовое содержимое. Поддерживает: PDF, DOCX, XLSX, TXT, CSV, JSON, XML, HTML, MD и другие форматы. Скан PDF без текстового слоя автоматически распознаётся vision-моделью (нужен workspaceId).',
    input_schema: {
      type: 'object',
      properties: {
        url:         { type: 'string', description: 'URL документа' },
        maxLength:   { type: 'number', description: 'Максимальная длина извлечённого текста (по умолчанию 20000)' },
        sheetName:   { type: 'string', description: 'Для XLSX: название листа (по умолчанию первый)' },
        workspaceId: { type: 'string', description: 'ID воркспейса — нужен, только если документ окажется сканом PDF без текстового слоя (для vision-распознавания)' },
        prompt:      { type: 'string', description: 'Только для скана PDF: что именно распознать/посчитать. По умолчанию — весь текст + позиции и итог.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'read_attachment',
    description: 'Прочитать содержимое файла, сохранённого в проекте. Документы (PDF, DOCX, XLSX, CSV, TXT…) — как read_document_url. Изображения и сканы PDF без текстового слоя (JPEG, PNG, чеки, фото, скриншоты) распознаются vision-моделью: можно прочитать текст, позиции и суммы с фото чека.',
    input_schema: {
      type: 'object',
      properties: {
        attachmentId: { type: 'string', description: 'ID вложения (из list_sources или fetch_and_save_source)' },
        maxLength:    { type: 'number', description: 'Максимальная длина извлечённого текста (по умолчанию 20000)' },
        sheetName:    { type: 'string', description: 'Для XLSX: название листа' },
        prompt:       { type: 'string', description: 'Только для изображений и сканов PDF: что именно распознать/посчитать (напр. «перечисли позиции с ценами и посчитай сумму»). По умолчанию — весь текст + позиции и итог.' },
      },
      required: ['attachmentId'],
    },
  },

  // ── Media ────────────────────────────────────────────────────
  {
    name: 'generate_image',
    description: 'СГЕНЕРИРОВАТЬ изображение по текстовому описанию (не поиск готовых — рисует новое). Провайдер берётся из настроек воркспейса (OpenAI/FLUX/Stability/fal.ai/OpenRouter), без ключа — бесплатный запасной. Промпт — КОРОТКОЕ ВИЗУАЛЬНОЕ описание («минималистичный логотип лаборатории данных, плоский стиль, фиолетовый акцент»), НЕ вставленный текст. Картинка сохраняется в Файлы воркспейса, возвращается URL. Если нужна реальная фотография/факт — используй search_images (Wikimedia), а не генерацию.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Короткое визуальное описание того, что нарисовать' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_audio',
    description: 'Озвучить текст (TTS) — вернёт ссылку на аудио, сохранённое в Файлы воркспейса. Провайдер из настроек (OpenAI/ElevenLabs/PlayHT), без ключа — бесплатный запасной. Уместно, когда пользователь просит «озвучь / надиктуй / сделай аудиоверсию».',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Текст для озвучки' },
      },
      required: ['text'],
    },
  },
  {
    name: 'search_images',
    description: 'Поиск свободных изображений на Wikimedia Commons. Возвращает прямые URL изображений для вставки на страницу через update_page с { type: "image", attrs: { src: url, alt: title } }.',
    input_schema: {
      type: 'object',
      properties: {
        query:  { type: 'string', description: 'Поисковый запрос на русском или английском' },
        limit:  { type: 'number', description: 'Количество изображений (1–8, по умолчанию 5)' },
      },
      required: ['query'],
    },
  },

  // ── Project memory ────────────────────────────────────────────
  {
    name: 'get_project_memory',
    description: 'Прочитать накопленную память AI по текущему проекту: исследования, решения, контекст, ключевые факты. Вызывай в начале каждой сессии работы с проектом.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'update_project_memory',
    description: 'Сохранить важную информацию в память проекта: результаты исследований, принятые решения, ключевые находки, контекст диалогов. Память видна в навигации проекта.',
    input_schema: {
      type: 'object',
      properties: {
        content:   { type: 'string', description: 'Текст для сохранения в память проекта (markdown). Полностью заменяет предыдущую память.' },
        projectId: { type: 'string', description: 'ID проекта для записи памяти. Указывай явно когда создаёшь новый проект — используй ID только что созданного проекта, а не текущего контекста.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'remember',
    description: 'Запомнить надолго в долговременную память (модуль «Память», сквозную по всему воркспейсу). Один вызов — без возни с реестрами. Сохраняй СРАЗУ, как только встретилось что-то стоящее запомнить: предпочтения и факты о пользователе, договорённости, важные решения, события. Не дожидайся просьбы «запомни». Не дублируй: для устойчивых правил используй kind=core с key (перезапишет по ключу).',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Что запомнить — кратко и по сути' },
        kind:    { type: 'string', enum: ['fact', 'core', 'entity', 'episode'], description: 'fact (по умолч.) — атомарный факт; core — устойчивое правило/идентичность (с key, upsert без дублей); entity — знание о сущности (name); episode — событие лога' },
        topic:   { type: 'string', description: 'Тема/категория (для fact)' },
        key:     { type: 'string', description: 'Ключ для kind=core (upsert по ключу, без дублей)' },
        name:    { type: 'string', description: 'Имя сущности для kind=entity' },
      },
      required: ['content'],
    },
  },
  {
    name: 'recall',
    description: 'Вспомнить из долговременной памяти по смыслу (семантический поиск, при наличии — иначе по ключевым словам). Вызывай ПЕРЕД ответом на что-либо, что может зависеть от прошлого контекста, чтобы ничего не упустить. По умолчанию ищет в памяти; scope=all — заглянуть и в другие модули (Финансы, Медкарта и т.д.).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Запрос по смыслу — о чём вспомнить' },
        scope: { type: 'string', enum: ['memory', 'all'], description: 'memory (по умолч.) — только память; all — все реестры воркспейса' },
        limit: { type: 'number', description: 'Сколько вернуть (по умолч. 8)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_stats',
    description: 'Реальная статистика твоей долговременной памяти о пользователе: сколько активных фактов, сущностей, эпизодов и правил Ядра, а также покрытие семантическим индексом (%). Вызывай, когда пользователь спрашивает про твою память/обучение/что ты знаешь — и приводи конкретные числа вместо выдуманных.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'memory_digest',
    description: 'Сводка «что я о тебе знаю»: Ядро (устойчивые правила), ключевые факты и люди/проекты. Вызывай на «что ты обо мне знаешь / что ты запомнил / покажи память», а также иногда предлагай сам показать и свериться. Покажи сгруппированно и по-человечески, затем предложи поправить (что забыть/уточнить). Это петля курирования — так память крепнет и чистится.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'forget_memory',
    description: 'Забыть из памяти конкретную запись — когда пользователь говорит «это неверно», «забудь про X», «я больше не …». Находит самое похожее и убирает из активной памяти (в recall больше не всплывёт). Вернёт, что именно забыл, и близкие кандидаты. Если есть верная новая версия факта — дополнительно сохрани её через remember.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Что забыть — опиши устаревший/неверный факт словами пользователя' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_conversations',
    description: 'Поиск по ПРОШЛЫМ разговорам с пользователем (отличается от recall, который ищет по выжимке-памяти): находит конкретное сообщение, где что-то говорилось, с названием чата и датой. Вызывай на «когда мы обсуждали…», «что я говорил про…», «в прошлый раз мы решили…».',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Ключевые слова/фраза для поиска по тексту прошлых сообщений' },
        limit: { type: 'number', description: 'Сколько сообщений вернуть (по умолч. 10, макс 25)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'build_expertise',
    description: 'Собрать себе ЭКСПЕРТИЗУ по крупной теме, чтобы стать в ней «гуру». Создаёт проект-базу знаний + каркас «Плейбук эксперта». После вызова ты ДОЛЖЕН в этой же сессии засеять знания через deep_research, разложить их по страницам проекта, заполнить плейбук (процесс, нормы, чек-лист, вопросы к пользователю, ошибки, нужные калькуляторы) и начать работать как эксперт. Вызывай, когда пользователь просит серьёзной помощи в предметной области (стройка, юриспруденция, диета, инвестиции и т.п.), а готовой экспертизы ещё нет.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Тема экспертизы, коротко (напр. «Строительство дома», «Налоги ИП», «Силовые тренировки»)' },
        focus: { type: 'string', description: 'Необязательно: конкретный фокус/ситуация пользователя, чтобы сузить сбор знаний' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'activate_expertise',
    description: 'Надеть готовую экспертизу: загружает её плейбук в контекст, чтобы ты действовал как эксперт в этой теме. Вызывай в начале работы по теме, для которой экспертиза уже собрана (проверь list_expertises).',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Тема/название экспертизы (частичное совпадение ок). Если экспертиза одна — можно без параметра.' },
      },
      required: [],
    },
  },
  {
    name: 'list_expertises',
    description: 'Список собранных экспертиз (темы, когда обновлялись). Загляни сюда, прежде чем собирать новую — вдруг по теме уже есть.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'grow_expertise',
    description: 'Экспертиза ДОУЧИВАЕТСЯ: допиши в её журнал «Знания и решения» новое, что усвоил по ходу работы — принятое решение, найденный факт/нюанс, грабли, предпочтение пользователя по этой теме. Вызывай в режиме эксперта, когда всплыло что-то стоящее сохранить надолго, чтобы в следующий раз ты был умнее именно в этой области. Устойчивый факт о конкретном случае пользователя дополнительно сохрани через remember.',
    input_schema: {
      type: 'object',
      properties: {
        learning: { type: 'string', description: 'Что нового усвоил — коротко и конкретно' },
        kind: { type: 'string', enum: ['decision', 'fact', 'pitfall', 'preference', 'resource', 'note'], description: 'Тип записи' },
        domain: { type: 'string', description: 'Тема экспертизы (если не активна автоматически или их несколько)' },
      },
      required: ['learning'],
    },
  },
  {
    name: 'install_module',
    description: 'Установить в воркспейс встроенный модуль с типизированными реестрами. Доступные: auto (машины, ТО, заправки, страховки, шины), finance (счета, операции, бюджет), medical-record (анализы, показатели, измерения, приёмы, лекарства), vault (пароли/секреты), personal-growth (привычки/цели/дневник). Вызывай, когда пользователь просит завести структурированную область («заведи модуль авто», «хочу вести финансы»). После установки смотри реестры через list_collections и клади данные через create_record. Если уже установлен — просто используй.',
    input_schema: {
      type: 'object',
      properties: {
        moduleId: { type: 'string', enum: ['auto', 'finance', 'medical-record', 'vault', 'personal-growth'], description: 'ID модуля' },
      },
      required: ['moduleId'],
    },
  },
  {
    name: 'create_http_skill',
    description: 'Собрать НАВЫК к внешнему REST API (банк, CRM, почта, любой сервис), чтобы дальше дёргать его самому. Вызывай, когда пользователь просит подключить API, а готового навыка нет (проверь свой список инструментов). Ты проектируешь навык: метод, URL с плейсхолдерами {param}, параметры, заголовки, тип авторизации и ИМЯ секрета (например token) — но НЕ его значение: ключ пользователь вставит сам при одобрении, диктовать его в чат нельзя. Навык создаётся ВЫКЛЮЧЕННЫМ: пока человек не одобрит в Настройки → ИИ → Навыки, звать его нельзя (это защита от того, чтобы через инъекцию со стороны меня заставили слить данные). Скажи пользователю, что и где одобрить.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Короткое имя навыка, напр. «Баланс банка»' },
        description: { type: 'string', description: 'Когда и зачем его звать (контракт для тебя же в будущем)' },
        url: { type: 'string', description: 'URL эндпоинта, можно с плейсхолдерами {param}' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        params: {
          type: 'array', description: 'Параметры навыка (подставляются в url/тело как {key})',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' }, type: { type: 'string', enum: ['string', 'number', 'boolean', 'enum'] },
              required: { type: 'boolean' }, description: { type: 'string' }, enumValues: { type: 'array', items: { type: 'string' } },
            },
            required: ['key', 'type'],
          },
        },
        headers: { type: 'array', description: 'Заголовки; значение может содержать {{secret.ИМЯ}} и {param}', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] } },
        authType: { type: 'string', enum: ['none', 'bearer', 'header', 'basic'], description: 'Тип авторизации' },
        secretName: { type: 'string', description: 'Имя секрета для ключа (значение введёт пользователь), напр. token' },
        headerName: { type: 'string', description: 'Для authType=header: имя заголовка (напр. X-Api-Key)' },
        bodyTemplate: { type: 'string', description: 'Для POST/PUT/PATCH: JSON-шаблон тела с {param}' },
        responseHint: { type: 'string', description: 'Dot-path к полезному полю ответа (необязательно)' },
      },
      required: ['name', 'description', 'url'],
    },
  },
  {
    name: 'create_skill',
    description: 'Завести СЕБЕ навык-скил: повторяющееся действие, которое ты выполняешь сам и шлёшь результат в Telegram. Два типа: ПО РАСПИСАНИЮ (укажи hour — каждый день в этот час) ИЛИ ПО СОБЫТИЮ (укажи event — срабатывает, когда в воркспейсе происходит событие). Используй на «напоминай/бриф каждое утро» (hour) и «когда добавлю замер/задачу → проверь/предупреди» (event). В prompt опиши, что делать; при срабатывании ты выполнишь его со всеми инструментами, а если делать нечего — ответишь SKIP. Пользователь видит/редактирует скилы в Настройки → ИИ → Скилы.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Короткое имя скила' },
        hour: { type: 'number', description: 'Для скила ПО РАСПИСАНИЮ: час 0–23 (локальное время)' },
        event: { type: 'string', enum: ['record.created', 'task.created', 'task.updated', 'page.created', 'note.created'], description: 'Для скила ПО СОБЫТИЮ: тип события (record.created — новая запись в реестре, напр. замер/трата; task.created — новая задача; и т.д.)' },
        prompt: { type: 'string', description: 'Что делать при срабатывании (напр. «если это замер давления и систолическое >140 — предупреди меня»)' },
      },
      required: ['name', 'prompt'],
    },
  },
  {
    name: 'list_skills',
    description: 'Список твоих навыков по расписанию (скилов): имя, час, что делают, вкл/выкл.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'delete_skill',
    description: 'Удалить навык по расписанию по его id (из list_skills).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'execute_code',
    description: 'Выполнить код в ИЗОЛИРОВАННОЙ песочнице (без доступа к серверу/данным/интернету) и получить вывод. Используй для расчётов, парсинга, преобразования данных, чего нет среди инструментов. language: python (по умолч.) или bash. Песочница эфемерна — состояние между вызовами НЕ сохраняется; вывод печатай в stdout (print). Лимит времени ~15с.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Код для выполнения' },
        language: { type: 'string', enum: ['python', 'bash'], description: 'python (по умолч.) | bash' },
      },
      required: ['code'],
    },
  },

  // ── Модули / Реестры (Collections) ─────────────────────────────
  {
    name: 'list_collections',
    description: 'Список реестров (типизированных наборов записей) установленных модулей в текущем воркспейсе с их полями. Вызывай прежде чем создавать/читать записи, чтобы узнать collectionId и точные english-ключи полей. Если реестров много, полный список может обрезаться — тогда СУЗЬ через module (например module="medical" для Медкарты, "finance" для Финансов), чтобы наверняка увидеть нужную коллекцию (например medications) и НЕ создавать дубль-реестр.',
    input_schema: {
      type: 'object',
      properties: {
        module: { type: 'string', description: 'Необязательный фильтр: показать только коллекции этого модуля. Подстрока по id модуля / имени проекта / ключу коллекции (например "medical", "finance", "growth").' },
      },
      required: [],
    },
  },
  {
    name: 'query_records',
    description: 'Прочитать записи указанного реестра.',
    input_schema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string', description: 'ID реестра (из list_collections)' },
        limit: { type: 'number', description: 'Максимум записей (по умолчанию 100)' },
      },
      required: ['collectionId'],
    },
  },
  {
    name: 'create_registry',
    description: 'Создать СВОЙ типизированный реестр (мини-модуль) под новую сферу, когда данные будут ПОВТОРЯТЬСЯ и структуру удобнее вести таблицей, а готового модуля нет (например «учёт растений и полива», «коллекция вин», «мои клиенты»). Сам придумай осмысленные поля. После создания записывай через create_record (вернётся collectionId), читай через query_records. Реестр появится в «Модули» как пользовательский, его видно и можно удалить. НЕ используй для разового/справочного текста — тогда обычная страница. ⚠️ ОБЯЗАТЕЛЬНО сперва проверь list_collections (при многих реестрах сузь через module=, напр. "medical") — если подходящая коллекция уже есть в установленном модуле (например medications в Медкарте), пиши В НЕЁ через create_record, а НЕ плоди дубль-реестр. Поля именуй понятными подписями (label) — ключи сгенерируются автоматически (кириллица транслитерируется).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Название реестра, напр. «Растения», «Клиенты»' },
        fields: {
          type: 'array',
          description: 'Поля реестра. Каждое: { label, type, required?, options? }. type ∈ text|longtext|number|date|datetime|select|multiselect|checkbox|file. Для select/multiselect передай options (массив строк). Задавай осмысленный набор полей под сферу.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Подпись поля (по-русски)' },
              type: { type: 'string', enum: ['text', 'longtext', 'number', 'date', 'datetime', 'select', 'multiselect', 'checkbox', 'file'] },
              required: { type: 'boolean' },
              options: { type: 'array', items: { type: 'string' }, description: 'Варианты для select/multiselect' },
            },
            required: ['label', 'type'],
          },
        },
        icon: { type: 'string', description: 'Иконка lucide:Имя (необязательно)' },
        projectId: { type: 'string', description: 'Необязательно: добавить реестр в существующий проект-модуль; иначе создаётся новый' },
      },
      required: ['name', 'fields'],
    },
  },
  {
    name: 'delete_registry',
    description: 'Удалить КАСТОМНЫЙ реестр по collectionId (возьми из list_collections — у кастомных стоит custom:true). Нужен, когда надо снести ошибочный или пустой реестр-дубль, а пользователь не может удалить его в интерфейсе. Каскадом удалятся все записи реестра, а если проект-обёртка после этого опустеет — уберётся и он. ⚠️ ВСТРОЕННЫЕ модули (Медкарта, Финансы и т.п.) этим НЕ удаляются — только пользовательские реестры. Перед удалением убедись, что реестр правда лишний, и лучше переспроси пользователя.',
    input_schema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string', description: 'ID коллекции реестра из list_collections' },
      },
      required: ['collectionId'],
    },
  },
  {
    name: 'finance_overview',
    description: 'Вернуть ПОСЧИТАННЫЕ движком балансы всех счетов/карт (startBalance + доходы − расходы ± переводы), доход/расход за текущий месяц и траты по категориям. ВСЕГДА используй это, когда спрашивают баланс/остаток/сколько на карте/итоги — НИКОГДА не складывай операции в уме. Данные точные и актуальные.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_secret',
    description: 'Найти в модуле «Сейф» запись по сайту/сервису и вернуть её данные, включая РАСШИФРОВАННЫЕ логин и пароль (и 2FA/значение). Используй ТОЛЬКО когда пользователь ЯВНО просит достать логин/пароль/секрет к чему-то (например «дай пароль от gmail»). query — сайт/название/логин. Вернёт до 5 совпадений. Предупреди коротко, что данные видны в переписке.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Сайт/сервис/название записи или логин для поиска' } },
      required: ['query'],
    },
  },
  {
    name: 'create_record',
    description: 'Добавить запись в реестр модуля. data — объект со значениями по ключам полей реестра (узнай ключи через list_collections). Поля типа secret (Сейф) шифруются при сохранении — передавай значение обычным текстом, наружу оно больше не выйдет.',
    input_schema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string', description: 'ID реестра (из list_collections)' },
        data: { type: 'object', description: 'Значения полей по их ключам, напр. {"date":"2026-05-01","name":"Гемоглобин","value":140,"unit":"г/л"}' },
      },
      required: ['collectionId', 'data'],
    },
  },
  {
    name: 'update_record',
    description: 'Изменить запись реестра. Передавай ТОЛЬКО те поля, которые меняешь — остальные сохранятся (мерж). Секреты Сейфа сохраняются автоматически: не пытайся их пере-передать, ты их не видишь.',
    input_schema: {
      type: 'object',
      properties: {
        recordId: { type: 'string' },
        data: { type: 'object', description: 'Только изменяемые поля (по ключам полей реестра)' },
      },
      required: ['recordId', 'data'],
    },
  },
  {
    name: 'delete_record',
    description: 'Удалить запись реестра.',
    input_schema: { type: 'object', properties: { recordId: { type: 'string' } }, required: ['recordId'] },
  },

  // ── Deep research ──────────────────────────────────────────────
  {
    name: 'deep_research',
    description: 'Полное автоматическое исследование темы: web-поиск + Wikipedia + научные статьи + чтение топ-статей + поиск в базе знаний. Возвращает структурированный отчёт.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Тема для исследования' },
        workspaceId: { type: 'string', description: 'ID рабочего пространства для поиска в базе знаний' },
        depth: { type: 'number', description: 'Глубина исследования: 1 (быстро, 2–3 источника), 2 (стандарт, 4–5 источников), 3 (глубоко, 6–8 источников). По умолчанию 2.' },
        includeAcademic: { type: 'boolean', description: 'Включить поиск научных статей (по умолчанию false)' },
        languages: { type: 'array', items: { type: 'string' }, description: 'Языки поиска, например ["ru", "en"] (по умолчанию оба)' },
      },
      required: ['topic'],
    },
  },

  // ── Canvas (доска идей) ─────────────────────────────────────────
  {
    name: 'list_canvases',
    description: 'Список досок идей (canvas) в текущем воркспейсе — id и названия. Доски относятся к воркспейсу, не к проекту.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_canvas',
    description: 'Создать новую доску идей (canvas) в воркспейсе. Возвращает id новой доски.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Название доски (необязательно)' } },
      required: [],
    },
  },
  {
    name: 'add_canvas_node',
    description: 'Добавить узел на доску идей (canvas). Используй для запросов вида «прикрепи/добавь на доску идей», «положи на canvas». Чтобы добавить картинку из интернета — сначала найди её через search_images, затем вызови add_canvas_node с nodeType=image и imageUrl. Картинка автоматически скачивается и сохраняется в Файлы проекта (появляется в разделе «Файлы»). Если canvasId не указан — берётся первая доска воркспейса или создаётся новая.',
    input_schema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'ID доски. Необязательно — иначе первая доска воркспейса или новая.' },
        nodeType: { type: 'string', enum: ['image', 'note', 'text', 'link', 'page', 'task'], description: 'Тип узла: image (картинка по imageUrl), note (заметка с текстом), text (текстовый блок), link (ссылка), page (по pageId), task (по taskId).' },
        imageUrl: { type: 'string', description: 'URL картинки — для nodeType=image (например из результатов search_images).' },
        text: { type: 'string', description: 'Текст — для note или text.' },
        url: { type: 'string', description: 'URL — для link.' },
        title: { type: 'string', description: 'Подпись/название узла (необязательно).' },
        pageId: { type: 'string', description: 'ID страницы — для nodeType=page.' },
        taskId: { type: 'string', description: 'ID задачи — для nodeType=task.' },
      },
      required: ['nodeType'],
    },
  },

  // ── Личный рост (Growth) ────────────────────────────────────────
  {
    name: 'create_habit',
    description: 'Создать привычку для отслеживания. Используй для запросов «заведи привычку», «хочу отслеживать ...».',
    input_schema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'ID воркспейса (по умолчанию текущий)' },
        name: { type: 'string', description: 'Название привычки' },
        description: { type: 'string', description: 'Описание (необязательно)' },
        period: { type: 'string', enum: ['forever', 'week', 'month', 'year'], description: 'Период цели привычки (по умолчанию forever)' },
        icon: { type: 'string', description: 'Эмодзи-иконка (необязательно, например 🏃)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'check_habit',
    description: 'Отметить выполнение привычки на дату (по умолчанию сегодня).',
    input_schema: {
      type: 'object',
      properties: {
        habitId: { type: 'string', description: 'ID привычки' },
        date: { type: 'string', description: 'Дата в формате YYYY-MM-DD (по умолчанию сегодня)' },
      },
      required: ['habitId'],
    },
  },
  {
    name: 'create_objective',
    description: 'Создать цель (OKR). Используй для «поставь цель», «цель на квартал». После создания добавь ключевые результаты через add_key_result.',
    input_schema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'ID воркспейса (по умолчанию текущий)' },
        title: { type: 'string', description: 'Формулировка цели' },
        description: { type: 'string', description: 'Описание (необязательно)' },
        quarter: { type: 'string', description: 'Квартал, например "2026-Q2" (необязательно)' },
        deadline: { type: 'string', description: 'Дедлайн в ISO формате (необязательно)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'add_key_result',
    description: 'Добавить ключевой результат (KR) к цели. Вызывай после create_objective с полученным objectiveId.',
    input_schema: {
      type: 'object',
      properties: {
        objectiveId: { type: 'string', description: 'ID цели (из create_objective)' },
        title: { type: 'string', description: 'Измеримый ключевой результат' },
        target: { type: 'number', description: 'Целевое значение (по умолчанию 100)' },
        current: { type: 'number', description: 'Текущее значение (по умолчанию 0)' },
        unit: { type: 'string', description: 'Единица измерения, например "%", "шт" (необязательно)' },
      },
      required: ['objectiveId', 'title'],
    },
  },
  {
    name: 'create_journal_entry',
    description: 'Создать или обновить запись в личном дневнике за дату. Используй для «запиши в дневник», «добавь в дневник».',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Текст записи (поддерживает markdown)' },
        date: { type: 'string', description: 'Дата в формате YYYY-MM-DD (по умолчанию сегодня)' },
        mood: { type: 'string', description: 'Настроение (необязательно, например "good", "tired", эмодзи)' },
      },
      required: ['content'],
    },
  },
]

// ─── OpenAI-compatible format converter ───────────────────────────────────────

export function toOpenAITools(tools: Anthropic.Tool[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }))
}
