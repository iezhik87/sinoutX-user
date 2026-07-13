// Built-in module «Сейф» (Vault). Passwords, cards and sensitive notes. Secret
// fields (type: 'secret') are encrypted at rest and excluded from the AI's
// memory/search/context — the assistant knows a secret EXISTS but not its value.
export const vault = {
  id: 'vault',
  version: '1.1.0',
  name: { ru: 'Сейф', en: 'Vault', be: 'Сейф' },
  description: {
    ru: 'Пароли, карты и чувствительные данные. Значения шифруются и НЕ попадают к ИИ (память/поиск).',
    en: 'Passwords, cards and sensitive data. Values are encrypted and hidden from the AI (memory/search).',
    be: 'Паролі, карты і адчувальныя дадзеныя. Значэнні шыфруюцца і НЕ трапляюць да ІІ.',
  },
  icon: 'lucide:ShieldCheck',
  author: 'SinoutX',
  disclaimer: {
    ru: 'Значения секретных полей шифруются на сервере (нужен ENCRYPTION_KEY) и исключены из памяти/поиска ассистента. Держите резервную копию критичных секретов отдельно.',
    en: 'Secret field values are encrypted server-side (requires ENCRYPTION_KEY) and excluded from the assistant. Keep a separate backup of critical secrets.',
    be: 'Значэнні сакрэтных палёў шыфруюцца на серверы (патрэбен ENCRYPTION_KEY) і выключаны з памяці асістэнта.',
  },
  collections: [
    {
      key: 'logins',
      name: { ru: 'Логины', en: 'Logins', be: 'Лагіны' },
      icon: 'lucide:KeyRound',
      fields: [
        { key: 'title', label: { ru: 'Название', en: 'Title', be: 'Назва' }, type: 'text', required: true },
        { key: 'url', label: { ru: 'Сайт / URL', en: 'Site / URL', be: 'Сайт / URL' }, type: 'text' },
        { key: 'username', label: { ru: 'Логин', en: 'Username', be: 'Лагін' }, type: 'text' },
        { key: 'password', label: { ru: 'Пароль', en: 'Password', be: 'Пароль' }, type: 'secret' },
        { key: 'totp', label: { ru: '2FA-секрет', en: '2FA secret', be: '2FA-сакрэт' }, type: 'secret' },
        {
          key: 'category', label: { ru: 'Категория', en: 'Category', be: 'Катэгорыя' }, type: 'select',
          options: [
            { value: 'personal', label: { ru: 'Личное', en: 'Personal', be: 'Асабістае' } },
            { value: 'work', label: { ru: 'Работа', en: 'Work', be: 'Праца' } },
            { value: 'finance', label: { ru: 'Финансы', en: 'Finance', be: 'Фінансы' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other', be: 'Іншае' } },
          ],
        },
        { key: 'notes', label: { ru: 'Заметки', en: 'Notes', be: 'Нататкі' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['title', 'username', 'url', 'category'] } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'cards',
      name: { ru: 'Карты', en: 'Cards', be: 'Карты' },
      icon: 'lucide:CreditCard',
      fields: [
        { key: 'title', label: { ru: 'Название', en: 'Title', be: 'Назва' }, type: 'text', required: true },
        { key: 'number', label: { ru: 'Номер', en: 'Number', be: 'Нумар' }, type: 'secret' },
        { key: 'holder', label: { ru: 'Держатель', en: 'Holder', be: 'Уладальнік' }, type: 'text' },
        { key: 'expiry', label: { ru: 'Срок', en: 'Expiry', be: 'Тэрмін' }, type: 'text' },
        { key: 'cvv', label: { ru: 'CVV', en: 'CVV', be: 'CVV' }, type: 'secret' },
        { key: 'pin', label: { ru: 'PIN', en: 'PIN', be: 'PIN' }, type: 'secret' },
        { key: 'notes', label: { ru: 'Заметки', en: 'Notes', be: 'Нататкі' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['title', 'holder', 'expiry'] } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'secrets',
      name: { ru: 'Секреты', en: 'Secrets', be: 'Сакрэты' },
      icon: 'lucide:Lock',
      fields: [
        { key: 'title', label: { ru: 'Название', en: 'Title', be: 'Назва' }, type: 'text', required: true },
        { key: 'value', label: { ru: 'Значение', en: 'Value', be: 'Значэнне' }, type: 'secret' },
        { key: 'notes', label: { ru: 'Заметки', en: 'Notes', be: 'Нататкі' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['title'] } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
  ],
  ai: {
    systemHints: {
      ru: 'Модуль «Сейф» хранит пароли/секреты. Их значения зашифрованы и исключены из памяти/поиска. По ЯВНОМУ запросу пользователя («дай логин/пароль к сайту X») достань запись инструментом get_secret и выдай логин+пароль (и 2FA, если есть). Кратко предупреди, что данные видны в этой переписке. Если инструмента get_secret нет — значит нет права: не выдавай, предложи посмотреть в приложении. Без явной просьбы секреты не показывай.',
      en: 'The Vault module holds passwords/secrets (encrypted, excluded from memory/search). On an EXPLICIT user request ("give me the login/password for site X") fetch it with the get_secret tool and return the login+password (and 2FA if present). Briefly warn the values appear in this chat. If get_secret is not available you lack the right — do not reveal; suggest the app. Never show secrets unprompted.',
      be: 'Модуль «Сейф» захоўвае паролі/сакрэты (зашыфраваныя). Па ЯЎНАЙ просьбе карыстальніка дастань запіс інструментам get_secret і выдай лагін+пароль. Папярэдзь, што дадзеныя бачны ў перапісцы. Без get_secret — няма права, не паказвай.',
    },
  },
}
