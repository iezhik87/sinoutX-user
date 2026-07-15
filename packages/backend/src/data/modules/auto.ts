// Built-in module «Авто» (vehicles). Declarative registries: cars + service log +
// fuel log + insurance/inspection (with expiry) + tires. No compute engine —
// consumption/cost totals are done by the agent via execute_code when asked.
// Country-neutral: document types cover RU/BY/other; the agent picks by the
// user's country (from Memory Core).
export const auto = {
  id: 'auto',
  version: '1.1.0',
  name: { ru: 'Авто', en: 'Vehicles', be: 'Аўто' },
  description: {
    ru: 'Всё по машинам: характеристики и VIN, журнал ТО и ремонтов, заправки, страховки и техосмотр со сроками, шины. Данные не покидают ваш сервер.',
    en: 'Everything about your cars: specs and VIN, service & repair log, fuel-ups, insurance & inspection with expiry, tires. Data stays on your server.',
    be: 'Усё па машынах: характарыстыкі і VIN, журнал ТА і рамонтаў, запраўкі, страхоўкі і тэхагляд са тэрмінамі, шыны. Дадзеныя не пакідаюць ваш сервер.',
  },
  icon: 'lucide:Car',
  author: 'SinoutX',
  collections: [
    {
      key: 'cars',
      name: { ru: 'Машины', en: 'Cars', be: 'Машыны' },
      icon: 'lucide:Car',
      fields: [
        { key: 'name', label: { ru: 'Название', en: 'Name', be: 'Назва' }, type: 'text', required: true, help: { ru: 'Как называешь: «Веста», «рабочая» и т.п.', en: 'Your nickname for it', be: 'Як называеш' } },
        { key: 'make', label: { ru: 'Марка', en: 'Make', be: 'Марка' }, type: 'text' },
        { key: 'model', label: { ru: 'Модель', en: 'Model', be: 'Мадэль' }, type: 'text' },
        { key: 'year', label: { ru: 'Год', en: 'Year', be: 'Год' }, type: 'number' },
        { key: 'vin', label: { ru: 'VIN', en: 'VIN', be: 'VIN' }, type: 'text' },
        { key: 'plate', label: { ru: 'Госномер', en: 'Plate', be: 'Дзярж. нумар' }, type: 'text' },
        {
          key: 'fuel', label: { ru: 'Топливо', en: 'Fuel', be: 'Паліва' }, type: 'select',
          options: [
            { value: 'petrol', label: { ru: 'Бензин', en: 'Petrol', be: 'Бензін' } },
            { value: 'diesel', label: { ru: 'Дизель', en: 'Diesel', be: 'Дызель' } },
            { value: 'gas', label: { ru: 'Газ (ГБО)', en: 'LPG', be: 'Газ' } },
            { value: 'hybrid', label: { ru: 'Гибрид', en: 'Hybrid', be: 'Гібрыд' } },
            { value: 'electric', label: { ru: 'Электро', en: 'Electric', be: 'Электра' } },
          ],
        },
        {
          key: 'transmission', label: { ru: 'КПП', en: 'Transmission', be: 'КПП' }, type: 'select',
          options: [
            { value: 'manual', label: { ru: 'Механика', en: 'Manual', be: 'Механіка' } },
            { value: 'automatic', label: { ru: 'Автомат', en: 'Automatic', be: 'Аўтамат' } },
            { value: 'robot', label: { ru: 'Робот', en: 'Robot', be: 'Робат' } },
            { value: 'cvt', label: { ru: 'Вариатор', en: 'CVT', be: 'Варыятар' } },
          ],
        },
        { key: 'engine', label: { ru: 'Двигатель', en: 'Engine', be: 'Рухавік' }, type: 'text', help: { ru: 'Объём/код, напр. «1.6 ВАЗ-21129»', en: 'Displacement/code', be: 'Аб’ём/код' } },
        { key: 'power', label: { ru: 'Мощность, л.с.', en: 'Power, hp', be: 'Магутнасць, к.с.' }, type: 'number' },
        { key: 'mileage', label: { ru: 'Пробег, км', en: 'Mileage, km', be: 'Прабег, км' }, type: 'number' },
        { key: 'color', label: { ru: 'Цвет', en: 'Color', be: 'Колер' }, type: 'text' },
        { key: 'note', label: { ru: 'Заметка', en: 'Note', be: 'Нататка' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['name', 'make', 'model', 'year', 'plate', 'mileage'] } },
        { key: 'gallery', type: 'gallery', name: { ru: 'Галерея', en: 'Gallery', be: 'Галерэя' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'service',
      name: { ru: 'ТО и ремонты', en: 'Service & repairs', be: 'ТА і рамонты' },
      icon: 'lucide:Wrench',
      fields: [
        { key: 'date', label: { ru: 'Дата', en: 'Date', be: 'Дата' }, type: 'date', required: true },
        { key: 'car', label: { ru: 'Машина', en: 'Car', be: 'Машына' }, type: 'relation', relation: { collection: 'cars' } },
        {
          key: 'type', label: { ru: 'Тип', en: 'Type', be: 'Тып' }, type: 'select',
          options: [
            { value: 'maintenance', label: { ru: 'Плановое ТО', en: 'Scheduled service', be: 'Планавае ТА' } },
            { value: 'repair', label: { ru: 'Ремонт', en: 'Repair', be: 'Рамонт' } },
            { value: 'replacement', label: { ru: 'Замена расходников', en: 'Consumables', be: 'Замена расходнікаў' } },
            { value: 'diagnostics', label: { ru: 'Диагностика', en: 'Diagnostics', be: 'Дыягностыка' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other', be: 'Іншае' } },
          ],
        },
        { key: 'odometer', label: { ru: 'Пробег, км', en: 'Odometer, km', be: 'Прабег, км' }, type: 'number' },
        { key: 'work', label: { ru: 'Что сделано', en: 'Work done', be: 'Што зроблена' }, type: 'longtext' },
        { key: 'parts', label: { ru: 'Запчасти / расходники', en: 'Parts / consumables', be: 'Запчасткі' }, type: 'longtext', help: { ru: 'Артикулы: напр. масляный фильтр 21080-1012005-08', en: 'Part numbers', be: 'Артыкулы' } },
        { key: 'cost', label: { ru: 'Стоимость', en: 'Cost', be: 'Кошт' }, type: 'number' },
        { key: 'station', label: { ru: 'СТО / мастер', en: 'Shop / mechanic', be: 'СТА / майстар' }, type: 'text' },
        { key: 'nextDate', label: { ru: 'Следующее ТО (дата)', en: 'Next service (date)', be: 'Наступнае ТА (дата)' }, type: 'date' },
        { key: 'nextOdometer', label: { ru: 'Следующее ТО (пробег)', en: 'Next service (km)', be: 'Наступнае ТА (прабег)' }, type: 'number' },
        { key: 'file', label: { ru: 'Чек / наряд', en: 'Receipt / order', be: 'Чэк / нарад' }, type: 'file' },
        { key: 'note', label: { ru: 'Заметка', en: 'Note', be: 'Нататка' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['date', 'car', 'type', 'odometer', 'work', 'cost', 'station'], sort: [{ field: 'date', dir: 'desc' }] } },
        { key: 'byType', type: 'board', name: { ru: 'По типу', en: 'By type', be: 'Па тыпе' }, config: { groupBy: 'type' } },
        { key: 'cal', type: 'calendar', name: { ru: 'Календарь', en: 'Calendar', be: 'Каляндар' }, config: { dateField: 'date' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'fuel',
      name: { ru: 'Заправки', en: 'Fuel-ups', be: 'Запраўкі' },
      icon: 'lucide:Fuel',
      fields: [
        { key: 'date', label: { ru: 'Дата', en: 'Date', be: 'Дата' }, type: 'date', required: true },
        { key: 'car', label: { ru: 'Машина', en: 'Car', be: 'Машына' }, type: 'relation', relation: { collection: 'cars' } },
        { key: 'odometer', label: { ru: 'Пробег, км', en: 'Odometer, km', be: 'Прабег, км' }, type: 'number' },
        { key: 'liters', label: { ru: 'Литры', en: 'Liters', be: 'Літры' }, type: 'number' },
        { key: 'pricePerL', label: { ru: 'Цена за литр', en: 'Price per liter', be: 'Цана за літр' }, type: 'number' },
        { key: 'cost', label: { ru: 'Сумма', en: 'Total', be: 'Сума' }, type: 'number' },
        { key: 'full', label: { ru: 'Полный бак', en: 'Full tank', be: 'Поўны бак' }, type: 'checkbox', help: { ru: 'Нужно для точного расчёта расхода', en: 'Needed for accurate consumption', be: 'Патрэбна для разліку расходу' } },
        { key: 'station', label: { ru: 'АЗС', en: 'Station', be: 'АЗС' }, type: 'text' },
        { key: 'note', label: { ru: 'Заметка', en: 'Note', be: 'Нататка' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['date', 'car', 'odometer', 'liters', 'cost', 'station'], sort: [{ field: 'date', dir: 'desc' }] } },
        { key: 'cal', type: 'calendar', name: { ru: 'Календарь', en: 'Calendar', be: 'Каляндар' }, config: { dateField: 'date' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'parts',
      name: { ru: 'Запчасти', en: 'Parts', be: 'Запчасткі' },
      icon: 'lucide:Cog',
      fields: [
        { key: 'name', label: { ru: 'Деталь', en: 'Part', be: 'Дэталь' }, type: 'text', required: true, help: { ru: 'Что за деталь, напр. «Масляный фильтр»', en: 'What part, e.g. "Oil filter"', be: 'Якая дэталь' } },
        { key: 'car', label: { ru: 'Машина', en: 'Car', be: 'Машына' }, type: 'relation', relation: { collection: 'cars' } },
        {
          key: 'system', label: { ru: 'Система', en: 'System', be: 'Сістэма' }, type: 'select',
          options: [
            { value: 'oil', label: { ru: 'Масло', en: 'Oil', be: 'Алей' } },
            { value: 'filters', label: { ru: 'Фильтры', en: 'Filters', be: 'Фільтры' } },
            { value: 'ignition', label: { ru: 'Свечи/зажигание', en: 'Ignition', be: 'Свечкі/запальванне' } },
            { value: 'timing', label: { ru: 'ГРМ', en: 'Timing', be: 'ГРМ' } },
            { value: 'brakes', label: { ru: 'Тормоза', en: 'Brakes', be: 'Тармазы' } },
            { value: 'transmission', label: { ru: 'КПП', en: 'Transmission', be: 'КПП' } },
            { value: 'cooling', label: { ru: 'Охлаждение/антифриз', en: 'Cooling', be: 'Ахаладжэнне' } },
            { value: 'suspension', label: { ru: 'Подвеска', en: 'Suspension', be: 'Падвеска' } },
            { value: 'electrical', label: { ru: 'Электрика/АКБ', en: 'Electrical', be: 'Электрыка' } },
            { value: 'fuel', label: { ru: 'Топливная', en: 'Fuel system', be: 'Паліўная' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other', be: 'Іншае' } },
          ],
        },
        { key: 'brand', label: { ru: 'Бренд', en: 'Brand', be: 'Брэнд' }, type: 'text', help: { ru: 'Напр. MANN, NGK, Gates', en: 'e.g. MANN, NGK, Gates', be: 'Напр. MANN, NGK' } },
        { key: 'partNumber', label: { ru: 'Артикул', en: 'Part number', be: 'Артыкул' }, type: 'text', help: { ru: 'Напр. 21080-1012005-08', en: 'e.g. 21080-1012005-08', be: 'Напр. 21080-1012005-08' } },
        {
          key: 'tier', label: { ru: 'Уровень', en: 'Tier', be: 'Узровень' }, type: 'select',
          options: [
            { value: 'budget', label: { ru: 'Эконом', en: 'Budget', be: 'Эканом' } },
            { value: 'standard', label: { ru: 'Стандарт', en: 'Standard', be: 'Стандарт' } },
            { value: 'premium', label: { ru: 'Премиум', en: 'Premium', be: 'Прэміум' } },
          ],
        },
        { key: 'interval', label: { ru: 'Интервал замены', en: 'Replacement interval', be: 'Інтэрвал замены' }, type: 'text', help: { ru: 'Напр. 10 000 км / 1 год', en: 'e.g. 10,000 km / 1 year', be: 'Напр. 10 000 км' } },
        { key: 'price', label: { ru: 'Цена', en: 'Price', be: 'Цана' }, type: 'number' },
        { key: 'note', label: { ru: 'Заметка', en: 'Note', be: 'Нататка' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['name', 'system', 'brand', 'partNumber', 'tier', 'price'] } },
        { key: 'bySystem', type: 'board', name: { ru: 'По системам', en: 'By system', be: 'Па сістэмах' }, config: { groupBy: 'system' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'insurance',
      name: { ru: 'Страховки и техосмотр', en: 'Insurance & inspection', be: 'Страхоўкі і тэхагляд' },
      icon: 'lucide:ShieldCheck',
      fields: [
        {
          key: 'type', label: { ru: 'Тип', en: 'Type', be: 'Тып' }, type: 'select', required: true,
          options: [
            { value: 'osago', label: { ru: 'ОСАГО', en: 'OSAGO (RU)', be: 'ОСАГА' } },
            { value: 'osgo', label: { ru: 'Автогражданка (ОСГО)', en: 'Compulsory liability (BY)', be: 'Аўтагра­мадзянка' } },
            { value: 'kasko', label: { ru: 'КАСКО', en: 'CASCO', be: 'КАСКА' } },
            { value: 'inspection', label: { ru: 'Техосмотр', en: 'Technical inspection', be: 'Тэхагляд' } },
            { value: 'permit', label: { ru: 'Допуск к дорожному движению', en: 'Road-use permit (BY)', be: 'Допуск да дарожнага руху' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other', be: 'Іншае' } },
          ],
        },
        { key: 'car', label: { ru: 'Машина', en: 'Car', be: 'Машына' }, type: 'relation', relation: { collection: 'cars' } },
        { key: 'number', label: { ru: 'Номер полиса/документа', en: 'Policy / doc number', be: 'Нумар' }, type: 'text' },
        { key: 'provider', label: { ru: 'Компания / орган', en: 'Provider', be: 'Кампанія / орган' }, type: 'text' },
        { key: 'start', label: { ru: 'Начало', en: 'Start', be: 'Пачатак' }, type: 'date' },
        { key: 'end', label: { ru: 'Действует до', en: 'Valid until', be: 'Дзейнічае да' }, type: 'date', required: true, help: { ru: 'По этой дате напомню продлить', en: 'Reminder is based on this date', be: 'Па гэтай даце нагадаю' } },
        { key: 'cost', label: { ru: 'Стоимость', en: 'Cost', be: 'Кошт' }, type: 'number' },
        { key: 'file', label: { ru: 'Скан', en: 'Scan', be: 'Скан' }, type: 'file' },
        { key: 'note', label: { ru: 'Заметка', en: 'Note', be: 'Нататка' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['type', 'car', 'provider', 'start', 'end', 'cost'], sort: [{ field: 'end', dir: 'asc' }] } },
        { key: 'cal', type: 'calendar', name: { ru: 'Сроки', en: 'Expiry', be: 'Тэрміны' }, config: { dateField: 'end' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'tires',
      name: { ru: 'Шины и колёса', en: 'Tires & wheels', be: 'Шыны і колы' },
      icon: 'lucide:CircleDot',
      fields: [
        {
          key: 'season', label: { ru: 'Сезон', en: 'Season', be: 'Сезон' }, type: 'select',
          options: [
            { value: 'summer', label: { ru: 'Летние', en: 'Summer', be: 'Летнія' } },
            { value: 'winter', label: { ru: 'Зимние', en: 'Winter', be: 'Зімовыя' } },
            { value: 'allseason', label: { ru: 'Всесезонные', en: 'All-season', be: 'Усесезонныя' } },
          ],
        },
        { key: 'car', label: { ru: 'Машина', en: 'Car', be: 'Машына' }, type: 'relation', relation: { collection: 'cars' } },
        { key: 'size', label: { ru: 'Размер', en: 'Size', be: 'Памер' }, type: 'text', help: { ru: 'Напр. 195/65 R15', en: 'e.g. 195/65 R15', be: 'Напр. 195/65 R15' } },
        { key: 'brand', label: { ru: 'Марка/модель', en: 'Brand/model', be: 'Марка/мадэль' }, type: 'text' },
        { key: 'bought', label: { ru: 'Куплены', en: 'Bought', be: 'Куплены' }, type: 'date' },
        { key: 'storage', label: { ru: 'Где хранятся', en: 'Stored at', be: 'Дзе захоўваюцца' }, type: 'text' },
        { key: 'note', label: { ru: 'Заметка', en: 'Note', be: 'Нататка' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['season', 'car', 'size', 'brand', 'bought'] } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
  ],
  ai: {
    systemHints: {
      ru: 'Это модуль «Авто». Реестры: cars (машины; поля: name, make=марка, model, year, vin, plate=госномер, fuel [petrol|diesel|gas|hybrid|electric], transmission [manual|automatic|robot|cvt], engine, power=л.с., mileage=пробег км, color, note), service (ТО и ремонты; поля: date, car=relation, type [maintenance|repair|replacement|diagnostics|other], odometer=пробег, work=что сделано, parts=запчасти/артикулы, cost, station=СТО, nextDate/nextOdometer=следующее ТО, file=чек, note), fuel (заправки; поля: date, car, odometer, liters, pricePerL, cost, full=полный бак, station, note), insurance (страховки и техосмотр; поля: type, car, number, provider, start, end=действует до, cost, file, note), parts (запчасти; поля: name, car, system, brand, partNumber=артикул, tier [budget|standard|premium], interval, price, note), tires (шины; season, car, size, brand, bought, storage). ЗАПИСЫВАЙ данные по авто ТОЛЬКО через create_record в нужный реестр (НЕ таблицей и НЕ отдельной страницей): «заправился» → fuel; «поменял масло/сделал ТО/починил» → service (укажи odometer и parts с артикулами); «оформил страховку/техосмотр» → insurance (обязательно end — по нему напомнишь продлить); характеристики машины → cars; ПЕРЕЧЕНЬ/РЕКОМЕНДАЦИИ ЗАПЧАСТЕЙ (надёжные бренды, артикулы, эконом/стандарт/премиум) → реестр parts (create_record: name, car, system, brand, partNumber, tier [budget|standard|premium], interval, price) — по одной записи на вариант, а НЕ страница со сводной таблицей. Если пользователь всё же просит именно СТРАНИЦУ-справку по авто — создавай её ВНУТРИ проекта этого модуля «Авто» (используй его projectId из list_projects/list_collections), НЕ в домашнем проекте, и ОБЯЗАТЕЛЬНО скажи, где создал (проект → страница). Артикулы запчастей клади в parts. Пробег из свежей записи обновляй и в cars.mileage. РАСХОД ТОПЛИВА, средние, суммарные траты — считай через execute_code (по записям fuel/service), НЕ в уме. Дата = сейчас, если не указана. СТРАНА: типы документов/страховок зависят от страны пользователя (бери из Ядра памяти; для Беларуси — автогражданка (osgo), техосмотр, допуск к дорожному движению; для России — ОСАГО/КАСКО). Если страна неизвестна — спроси. Проактивно предлагай напомнить о сроке страховки/техосмотра (end) и о следующем ТО (nextDate/nextOdometer) — можешь завести скил или задачу с напоминанием.',
      en: 'This is the Vehicles module. Collections: cars (name, make, model, year, vin, plate, fuel [petrol|diesel|gas|hybrid|electric], transmission [manual|automatic|robot|cvt], engine, power=hp, mileage=km, color, note), service (date, car=relation, type [maintenance|repair|replacement|diagnostics|other], odometer, work, parts=part numbers, cost, station, nextDate/nextOdometer, file, note), fuel (date, car, odometer, liters, pricePerL, cost, full=full tank, station, note), insurance (type, car, number, provider, start, end=valid until, cost, file, note), tires (season, car, size, brand, bought, storage). RECORD vehicle data ONLY via create_record into the right collection (never a table on a page): "filled up" → fuel; "changed oil / did service / fixed" → service (set odometer and parts with part numbers); "got insurance/inspection" → insurance (always set end — you remind to renew by it); car specs → cars. Put part numbers in parts. Also update cars.mileage from the latest odometer. FUEL CONSUMPTION, averages, totals — compute via execute_code (from fuel/service records), not in your head. Date = now if not given. COUNTRY: document/insurance types depend on the user\'s country (take from Memory Core; Belarus — compulsory liability (osgo), inspection, road-use permit; Russia — OSAGO/KASKO). If the country is unknown, ask. Proactively offer to remind about insurance/inspection expiry (end) and next service (nextDate/nextOdometer) — set up a skill or a task.',
      be: 'Гэта модуль «Аўто». Рэестры: cars (машыны), service (ТА і рамонты), fuel (запраўкі), insurance (страхоўкі і тэхагляд; поле end=дзейнічае да — па ім нагадаю прадоўжыць), tires (шыны). Запісвай дадзеныя праз create_record у патрэбны рэестр (не табліцай на старонцы). Расход паліва і сумы лічы праз execute_code. КРАІНА: тыпы дакументаў залежаць ад краіны (бяры з Ядра памяці; для Беларусі — аўтагра­мадзянка, тэхагляд, допуск да дарожнага руху). Прапануй нагадаць пра тэрміны страхоўкі і наступнае ТА.',
    },
  },
  // No seed: cars are user-specific — the user adds their first vehicle.
}
