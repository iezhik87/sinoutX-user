// Built-in module «Память» (agent memory). Declarative Collections that give an
// agent an organized, recall-able memory space: a compact Core, atomic Facts,
// structured Entities and an episodic log. Cross-cutting by design — memory
// records link to entities across the workspace and other modules via the graph.
const L = (ru: string, en: string, be: string) => ({ ru, en, be })

export const memory = {
  id: 'memory',
  version: '1.0.0',
  name: L('Память', 'Memory', 'Памяць'),
  description: L(
    'Память агента: компактное Ядро, атомарные Факты, Сущности и Эпизоды. Связывается со всем воркспейсом и другими модулями. Данные не покидают ваш сервер.',
    'Agent memory: a compact Core, atomic Facts, Entities and Episodes. Links across the workspace and other modules. Data stays on your server.',
    'Памяць агента: кампактнае Ядро, атамарныя Факты, Сутнасці і Эпізоды. Звязваецца з усім воркспейсам і іншымі модулямі.',
  ),
  icon: 'lucide:BrainCircuit',
  author: 'SinoutX',
  collections: [
    {
      key: 'core',
      name: L('Ядро', 'Core', 'Ядро'),
      icon: 'lucide:Star',
      fields: [
        { key: 'key', label: L('Ключ', 'Key', 'Ключ'), type: 'text', required: true },
        { key: 'content', label: L('Содержимое', 'Content', 'Змест'), type: 'longtext', required: true },
        {
          key: 'pinned', label: L('Закреплено', 'Pinned', 'Замацавана'), type: 'select',
          options: [
            { value: 'yes', label: L('Да', 'Yes', 'Так') },
            { value: 'no', label: L('Нет', 'No', 'Не') },
          ],
        },
      ],
      views: [
        { key: 'all', type: 'table', name: L('Все', 'All', 'Усе'), config: { columns: ['key', 'content', 'pinned'] } },
        { key: 'card', type: 'form', name: L('Карточка', 'Card', 'Картка') },
      ],
    },
    {
      key: 'facts',
      name: L('Факты', 'Facts', 'Факты'),
      icon: 'lucide:Lightbulb',
      fields: [
        { key: 'text', label: L('Факт', 'Fact', 'Факт'), type: 'longtext', required: true },
        { key: 'topic', label: L('Тема', 'Topic', 'Тэма'), type: 'text' },
        {
          key: 'importance', label: L('Важность', 'Importance', 'Важнасць'), type: 'select',
          options: [
            { value: 'low', label: L('Низкая', 'Low', 'Нізкая') },
            { value: 'medium', label: L('Средняя', 'Medium', 'Сярэдняя') },
            { value: 'high', label: L('Высокая', 'High', 'Высокая') },
          ],
        },
        { key: 'source', label: L('Источник', 'Source', 'Крыніца'), type: 'text' },
        { key: 'date', label: L('Дата', 'Date', 'Дата'), type: 'datetime' },
      ],
      views: [
        { key: 'all', type: 'table', name: L('Все', 'All', 'Усе'), config: { columns: ['text', 'topic', 'importance', 'date'] } },
        { key: 'card', type: 'form', name: L('Карточка', 'Card', 'Картка') },
      ],
    },
    {
      key: 'entities',
      name: L('Сущности', 'Entities', 'Сутнасці'),
      icon: 'lucide:Boxes',
      fields: [
        { key: 'name', label: L('Имя', 'Name', 'Імя'), type: 'text', required: true },
        {
          key: 'type', label: L('Тип', 'Type', 'Тып'), type: 'select',
          options: [
            { value: 'person', label: L('Человек', 'Person', 'Чалавек') },
            { value: 'project', label: L('Проект', 'Project', 'Праект') },
            { value: 'concept', label: L('Понятие', 'Concept', 'Паняцце') },
            { value: 'place', label: L('Место', 'Place', 'Месца') },
            { value: 'org', label: L('Организация', 'Organization', 'Арганізацыя') },
            { value: 'other', label: L('Другое', 'Other', 'Іншае') },
          ],
        },
        { key: 'attributes', label: L('Атрибуты', 'Attributes', 'Атрыбуты'), type: 'longtext' },
        { key: 'notes', label: L('Заметки', 'Notes', 'Нататкі'), type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: L('Все', 'All', 'Усе'), config: { columns: ['name', 'type', 'attributes'] } },
        { key: 'card', type: 'form', name: L('Карточка', 'Card', 'Картка') },
      ],
    },
    {
      key: 'episodes',
      name: L('Эпизоды', 'Episodes', 'Эпізоды'),
      icon: 'lucide:History',
      fields: [
        { key: 'when', label: L('Когда', 'When', 'Калі'), type: 'datetime' },
        { key: 'event', label: L('Событие', 'Event', 'Падзея'), type: 'longtext', required: true },
        { key: 'refs', label: L('Ссылки', 'References', 'Спасылкі'), type: 'longtext' },
      ],
      views: [
        { key: 'timeline', type: 'table', name: L('Лента', 'Timeline', 'Стужка'), config: { columns: ['when', 'event', 'refs'] } },
        { key: 'card', type: 'form', name: L('Карточка', 'Card', 'Картка') },
      ],
    },
  ],
  ai: {
    systemHints: {
      ru: 'Это модуль «Память» агента. Реестры: core (Ядро — компактный always-load контекст: key, content, pinned; держи коротким), facts (Факты — атомарные знания: text, topic, importance, source, date), entities (Сущности — знание о людях/проектах/организациях/понятиях: name, type, attributes, notes), episodes (Эпизоды — сырой лог событий: when, event, refs; ночью консолидируются в facts/entities). ЧТО КУДА: устойчивые правила/предпочтения/идентичность → core (кратко, upsert по key, без дублей); атомарные durable факты → facts; знание об объекте → entities; сырое событие → episodes. ВАЖНО — ДОМЕННЫЕ ЗНАНИЯ И КРУПНЫЕ ТЕМЫ (например, спортивная команда и её соревнования, база знаний по теме, набор материалов) НЕ хранятся в памяти: их место — ОТДЕЛЬНЫЙ ПРОЕКТ (страницы/папки) или профильный модуль (Финансы/Медкарта/…). В памяти держи только ключевые факты + ССЫЛКУ на проект (create_link); не копируй тело темы в память. НИКОГДА не храни в памяти СВОЙ собственный рантайм/окружение/идентичность агента (фреймворк, контейнер/Docker, пути вроде ~/.hermes, «на каком сервере я кручусь») — это конфиг агента, а НЕ знание о пользователе. Память — ТОЛЬКО про пользователя и мир. Свою личность (имя/характер) бери из настроек ассистента, а не из памяти. Сохраняй важное СРАЗУ. Перед созданием ИЩИ существующую запись (не дублируй). Перед ответом сверяйся с памятью (recall/query_records).',
      en: 'This is the agent «Memory» module. Collections: core (compact always-load context: key, content, pinned; keep it short), facts (atomic knowledge: text, topic, importance, source, date), entities (knowledge about people/projects/orgs/concepts: name, type, attributes, notes), episodes (raw event log: when, event, refs; consolidated nightly). WHAT GOES WHERE: stable rules/preferences/identity → core (short, upsert by key, no dupes); atomic durable facts → facts; knowledge about an object → entities; raw event → episodes. IMPORTANT — DOMAIN KNOWLEDGE AND LARGE TOPICS (e.g. a sports team and its competitions, a topic knowledge base, a body of material) do NOT live in memory: put them in a DEDICATED PROJECT (pages/folders) or a domain module (Finance/Medical Record/…). In memory keep only key facts + a LINK to the project (create_link); do not copy the topic body into memory. NEVER store your OWN runtime/environment/identity in memory (framework, container/Docker, paths like ~/.hermes, "which server I run on") — that is agent config, NOT knowledge about the user. Memory is ONLY about the user and the world. Take your own identity (name/character) from the assistant settings, not from memory. Persist important things IMMEDIATELY. Search for an existing record before creating (no dupes). Consult memory before answering.',
      be: 'Гэта модуль «Памяць» агента. Рэестры: core (Ядро — кампактны кантэкст: key, content, pinned), facts (Факты: text, topic, importance, source, date), entities (Сутнасці: name, type, attributes, notes), episodes (Эпізоды: when, event, refs). Захоўвай важнае АДРАЗУ праз create_record. Звязвай запісы памяці з іншымі сутнасцямі і модулямі праз create_link. Перад адказам сверайся з памяццю.',
    },
  },
  // No seed: memory is the agent's own; nothing is pre-populated.
}
