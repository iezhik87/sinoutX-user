// Built-in module «Финансы» (personal finance). Tier-1 declarative: accounts +
// transactions. Balances/totals are computed by the module-aware overview route
// (the Collections engine itself does no arithmetic). A premium receipt/statement
// OCR pipeline is added in a later phase.
export const finance = {
  id: 'finance',
  version: '1.2.0',
  name: { ru: 'Финансы', en: 'Finance', be: 'Фінансы' },
  description: {
    ru: 'Личные финансы: счета и карты с балансами, доходы, расходы и переводы. Данные не покидают ваш сервер.',
    en: 'Personal finance: accounts and cards with balances, income, expenses and transfers. Data stays on your server.',
    be: 'Асабістыя фінансы: рахункі і карты з балансамі, даходы, выдаткі і пераводы. Дадзеныя не пакідаюць ваш сервер.',
  },
  icon: 'lucide:Wallet',
  author: 'SinoutX',
  collections: [
    {
      key: 'accounts',
      name: { ru: 'Счета', en: 'Accounts', be: 'Рахункі' },
      icon: 'lucide:CreditCard',
      fields: [
        { key: 'name', label: { ru: 'Название', en: 'Name', be: 'Назва' }, type: 'text', required: true },
        {
          key: 'type', label: { ru: 'Тип', en: 'Type', be: 'Тып' }, type: 'select',
          options: [
            { value: 'cash', label: { ru: 'Наличные', en: 'Cash', be: 'Гатоўка' } },
            { value: 'debit', label: { ru: 'Дебетовая карта', en: 'Debit card', be: 'Дэбетавая карта' } },
            { value: 'credit', label: { ru: 'Кредитная карта', en: 'Credit card', be: 'Крэдытная карта' } },
            { value: 'savings', label: { ru: 'Накопительный', en: 'Savings', be: 'Накапляльны' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other', be: 'Іншае' } },
          ],
        },
        { key: 'currency', label: { ru: 'Валюта', en: 'Currency', be: 'Валюта' }, type: 'text' },
        { key: 'startBalance', label: { ru: 'Стартовый баланс', en: 'Starting balance', be: 'Стартавы баланс' }, type: 'number' },
        { key: 'note', label: { ru: 'Заметка', en: 'Note', be: 'Нататка' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['name', 'type', 'currency', 'startBalance'] } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'transactions',
      name: { ru: 'Операции', en: 'Transactions', be: 'Аперацыі' },
      icon: 'lucide:ArrowLeftRight',
      fields: [
        { key: 'date', label: { ru: 'Дата', en: 'Date', be: 'Дата' }, type: 'datetime', required: true },
        {
          key: 'type', label: { ru: 'Тип', en: 'Type', be: 'Тып' }, type: 'select',
          options: [
            { value: 'expense', label: { ru: 'Расход', en: 'Expense', be: 'Выдатак' } },
            { value: 'income', label: { ru: 'Доход', en: 'Income', be: 'Даход' } },
            { value: 'transfer', label: { ru: 'Перевод', en: 'Transfer', be: 'Перавод' } },
          ],
        },
        { key: 'amount', label: { ru: 'Сумма', en: 'Amount', be: 'Сума' }, type: 'number', required: true },
        {
          key: 'category', label: { ru: 'Категория', en: 'Category', be: 'Катэгорыя' }, type: 'select',
          options: [
            { value: 'groceries', label: { ru: 'Продукты', en: 'Groceries', be: 'Прадукты' } },
            { value: 'eatingout', label: { ru: 'Кафе/рестораны', en: 'Eating out', be: 'Кафэ/рэстараны' } },
            { value: 'transport', label: { ru: 'Транспорт', en: 'Transport', be: 'Транспарт' } },
            { value: 'housing', label: { ru: 'Жильё', en: 'Housing', be: 'Жыллё' } },
            { value: 'utilities', label: { ru: 'Коммуналка', en: 'Utilities', be: 'Камуналка' } },
            { value: 'health', label: { ru: 'Здоровье', en: 'Health', be: 'Здароўе' } },
            { value: 'shopping', label: { ru: 'Покупки', en: 'Shopping', be: 'Пакупкі' } },
            { value: 'entertainment', label: { ru: 'Развлечения', en: 'Entertainment', be: 'Забавы' } },
            { value: 'education', label: { ru: 'Образование', en: 'Education', be: 'Адукацыя' } },
            { value: 'salary', label: { ru: 'Зарплата', en: 'Salary', be: 'Зарплата' } },
            { value: 'gift', label: { ru: 'Подарок', en: 'Gift', be: 'Падарунак' } },
            { value: 'transfer', label: { ru: 'Перевод', en: 'Transfer', be: 'Перавод' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other', be: 'Іншае' } },
          ],
        },
        { key: 'account', label: { ru: 'Счёт', en: 'Account', be: 'Рахунак' }, type: 'relation', relation: { collection: 'accounts' } },
        { key: 'toAccount', label: { ru: 'Счёт назначения', en: 'To account', be: 'Рахунак прызначэння' }, type: 'relation', relation: { collection: 'accounts' } },
        { key: 'toAmount', label: { ru: 'Сумма зачисления', en: 'Credited amount', be: 'Сума залічэння' }, type: 'number', help: { ru: 'Для обмена валют: сколько зачислено на счёт назначения (в его валюте). Пусто = как «Сумма».', en: 'Currency exchange: amount credited to the destination account (in its currency). Empty = same as Amount.', be: 'Для абмену валют: колькі залічана на рахунак прызначэння. Пуста = як «Сума».' } },
        { key: 'rate', label: { ru: 'Курс', en: 'Rate', be: 'Курс' }, type: 'number', help: { ru: 'Курс обмена (необязательно, для истории).', en: 'Exchange rate (optional, for the record).', be: 'Курс абмену (неабавязкова).' } },
        { key: 'merchant', label: { ru: 'Кому / продавец', en: 'Merchant / payee', be: 'Каму / прадавец' }, type: 'text' },
        { key: 'file', label: { ru: 'Чек', en: 'Receipt', be: 'Чэк' }, type: 'file' },
        { key: 'note', label: { ru: 'Заметка', en: 'Note', be: 'Нататка' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['date', 'type', 'amount', 'category', 'account', 'merchant'], sort: [{ field: 'date', dir: 'desc' }] } },
        { key: 'byCategory', type: 'board', name: { ru: 'По категориям', en: 'By category', be: 'Па катэгорыях' }, config: { groupBy: 'category' } },
        { key: 'cal', type: 'calendar', name: { ru: 'Календарь', en: 'Calendar', be: 'Каляндар' }, config: { dateField: 'date' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      // Monthly budget plan: expected income/expenses. `include` decides whether
      // a plan line counts toward the projected real balance (the overview adds
      // included plans on top of actual transactions).
      key: 'budget',
      name: { ru: 'Бюджет', en: 'Budget', be: 'Бюджэт' },
      icon: 'lucide:Target',
      fields: [
        { key: 'month', label: { ru: 'Месяц', en: 'Month', be: 'Месяц' }, type: 'date', required: true },
        {
          key: 'type', label: { ru: 'Тип', en: 'Type', be: 'Тып' }, type: 'select',
          options: [
            { value: 'expense', label: { ru: 'Расход', en: 'Expense', be: 'Выдатак' } },
            { value: 'income', label: { ru: 'Доход', en: 'Income', be: 'Даход' } },
          ],
        },
        {
          key: 'category', label: { ru: 'Категория', en: 'Category', be: 'Катэгорыя' }, type: 'select',
          options: [
            { value: 'groceries', label: { ru: 'Продукты', en: 'Groceries', be: 'Прадукты' } },
            { value: 'eatingout', label: { ru: 'Кафе/рестораны', en: 'Eating out', be: 'Кафэ/рэстараны' } },
            { value: 'transport', label: { ru: 'Транспорт', en: 'Transport', be: 'Транспарт' } },
            { value: 'housing', label: { ru: 'Жильё', en: 'Housing', be: 'Жыллё' } },
            { value: 'utilities', label: { ru: 'Коммуналка', en: 'Utilities', be: 'Камуналка' } },
            { value: 'health', label: { ru: 'Здоровье', en: 'Health', be: 'Здароўе' } },
            { value: 'shopping', label: { ru: 'Покупки', en: 'Shopping', be: 'Пакупкі' } },
            { value: 'entertainment', label: { ru: 'Развлечения', en: 'Entertainment', be: 'Забавы' } },
            { value: 'education', label: { ru: 'Образование', en: 'Education', be: 'Адукацыя' } },
            { value: 'salary', label: { ru: 'Зарплата', en: 'Salary', be: 'Зарплата' } },
            { value: 'gift', label: { ru: 'Подарок', en: 'Gift', be: 'Падарунак' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other', be: 'Іншае' } },
          ],
        },
        { key: 'amount', label: { ru: 'Сумма (план)', en: 'Amount (planned)', be: 'Сума (план)' }, type: 'number', required: true },
        { key: 'include', label: { ru: 'Учитывать в реальном балансе', en: 'Count toward real balance', be: 'Улічваць у рэальным балансе' }, type: 'checkbox' },
        { key: 'note', label: { ru: 'Заметка', en: 'Note', be: 'Нататка' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'План', en: 'Plan', be: 'План' }, config: { columns: ['month', 'type', 'category', 'amount', 'include'], sort: [{ field: 'month', dir: 'desc' }] } },
        { key: 'byCategory', type: 'board', name: { ru: 'По категориям', en: 'By category', be: 'Па катэгорыях' }, config: { groupBy: 'category' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
  ],
  ai: {
    systemHints: {
      ru: 'Это модуль личных финансов. Реестры: accounts (счета/карты; поля: name, type [cash|debit|credit|savings|other], currency, startBalance=стартовый баланс), transactions (операции; поля: date=дата-время, type [expense расход|income доход|transfer перевод], amount=сумма ВСЕГДА положительная, category, account=счёт (для перевода — откуда), toAccount=счёт назначения (только для перевода), merchant=кому/продавец, note), budget (план на месяц; поля: month=дата месяца, type [expense|income], category, amount=план, include=учитывать в реальном балансе). Баланс счёта считается автоматически = startBalance + доходы − расходы. Когда пользователь говорит «потратил/купил» — type=expense; «получил/зарплата» — income; «перевёл с X на Y» — transfer (account=X, toAccount=Y). ОБМЕН ВАЛЮТ (счета разных валют): type=transfer, account=откуда, toAccount=куда, amount=сколько СПИСАНО (валюта источника), toAmount=сколько ЗАЧИСЛЕНО (валюта назначения), rate=курс. Курс выбирает пользователь: если названы обе суммы («обменял 100 BYN на 30 USD») — ставь amount=100, toAmount=30; если сумма + курс («100 BYN в USD по 3.3») — посчитай toAmount (через execute_code, не в уме) и подтверди числом. Баланс каждого счёта считается в его валюте отдельно. Планируемые суммы («заложи на еду 20000») — в budget. Дата = сейчас, если не указана. Помогай вносить операции в нужный реестр. ⚠️ БАЛАНСЫ И ИТОГИ: НИКОГДА не складывай операции в уме и не считай остаток вручную — вызови finance_overview и возьми ГОТОВЫЕ посчитанные движком балансы счетов, доход/расход за месяц, траты по категориям. На любой вопрос «сколько на карте / баланс / остаток / итог» сначала finance_overview, потом отвечай его числом. Прочую арифметику (конвертация валют, доли) считай через execute_code, а не в уме. НЕ давай инвестиционных/налоговых советов — только структурируй данные.',
      en: 'This is a personal finance module. Collections: accounts (accounts/cards; fields: name, type [cash|debit|credit|savings|other], currency, startBalance), transactions (fields: date, type [expense|income|transfer], amount ALWAYS positive, category, account (for a transfer — the source), toAccount (transfer destination only), merchant, note), budget (monthly plan; fields: month=date, type [expense|income], category, amount=planned, include=count toward real balance). Account balance is computed automatically = startBalance + income − expenses. "spent/bought" → type=expense; "received/salary" → income; "moved from X to Y" → transfer (account=X, toAccount=Y). CURRENCY EXCHANGE (accounts of different currencies): type=transfer, account=source, toAccount=destination, amount=DEBITED (source currency), toAmount=CREDITED (destination currency), rate=exchange rate. The user picks the rate: if both amounts are given ("exchanged 100 BYN for 30 USD") set amount=100, toAmount=30; if amount + rate, compute toAmount (via execute_code, not in your head) and confirm. Each account balance is tracked in its own currency. Planned amounts ("budget 20000 for food") → budget. Date = now if not given. Help record transactions into the right collection. ⚠️ BALANCES & TOTALS: NEVER sum transactions in your head or compute a balance by hand — call finance_overview and take the engine-computed account balances, this-month income/expense and spend-by-category. For any "how much is on the card / balance / total" question, call finance_overview first and answer with its number. Do other arithmetic (currency conversion, shares) via execute_code, not in your head. Do NOT give investment/tax advice — only structure the data.',
      be: 'Гэта модуль асабістых фінансаў. Рэестры: accounts (рахункі/карты; палі: name, type [cash|debit|credit|savings|other], currency, startBalance), transactions (палі: date, type [expense|income|transfer], amount заўсёды дадатная, category, account (для пераводу — адкуль), toAccount (толькі для пераводу), merchant, note), budget (план на месяц: month, type [expense|income], category, amount, include). Баланс рахунку лічыцца аўтаматычна = startBalance + даходы − выдаткі. «патраціў/купіў» → expense; «атрымаў/зарплата» → income; «перавёў з X на Y» → transfer (account=X, toAccount=Y). Плануемыя сумы — у budget. Дата = зараз, калі не зададзена. НЕ давай інвестыцыйных/падатковых парад — толькі структуруй дадзеныя.',
    },
    pipelines: [
      { id: 'receipt-scan', premium: true, label: { ru: 'Распознать чек / выписку', en: 'Scan a receipt / statement', be: 'Распазнаць чэк / выпіску' } },
    ],
  },
  // No seed: currency and account naming are user-specific (defaulting to RUB /
  // a Russian name is wrong for non-RU users) — the user adds their first account.
}
