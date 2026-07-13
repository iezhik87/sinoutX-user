// Built-in reference module: «Медкарта-lite». Personal medical archive —
// analyses, their indicators, and visits. Tier 1 (declarative, no custom code).
export const medicalRecord = {
  id: 'medical-record',
  version: '2.5.5',
  name: { ru: 'Медкарта', en: 'Medical Record', be: 'Медкарта' },
  description: {
    ru: 'Личный медархив: анализы, показатели и приёмы. Данные не покидают ваш сервер.',
    en: 'Personal medical archive: lab results, indicators and visits. Data stays on your server.',
    be: 'Асабісты медархіў: аналізы, паказчыкі і прыёмы. Дадзеныя не пакідаюць ваш сервер.',
  },
  icon: 'lucide:HeartPulse',
  author: 'SinoutX',
  disclaimer: {
    ru: 'Не является медицинской консультацией. Это личный архив и помощник по структурированию данных.',
    en: 'Not medical advice. A personal archive and data-structuring assistant.',
    be: 'Не медыцынская кансультацыя. Гэта асабісты архіў і памочнік па структураванні дадзеных.',
  },
  collections: [
    {
      key: 'profile',
      name: { ru: 'Профиль', en: 'Profile', be: 'Профіль' },
      icon: 'lucide:UserRound',
      fields: [
        { key: 'fullName', label: { ru: 'ФИО', en: 'Full name', be: 'ФІА' }, type: 'text' },
        { key: 'birthDate', label: { ru: 'Дата рождения', en: 'Date of birth', be: 'Дата нараджэння' }, type: 'date' },
        {
          key: 'sex', label: { ru: 'Пол', en: 'Sex', be: 'Пол' }, type: 'select',
          options: [
            { value: 'male', label: { ru: 'Мужской', en: 'Male', be: 'Мужчынскі' } },
            { value: 'female', label: { ru: 'Женский', en: 'Female', be: 'Жаночы' } },
          ],
        },
        {
          key: 'bloodType', label: { ru: 'Группа крови', en: 'Blood type', be: 'Група крыві' }, type: 'select',
          options: [
            { value: 'O+', label: { ru: 'O(I) Rh+', en: 'O+', be: 'O(I) Rh+' } },
            { value: 'O-', label: { ru: 'O(I) Rh−', en: 'O−', be: 'O(I) Rh−' } },
            { value: 'A+', label: { ru: 'A(II) Rh+', en: 'A+', be: 'A(II) Rh+' } },
            { value: 'A-', label: { ru: 'A(II) Rh−', en: 'A−', be: 'A(II) Rh−' } },
            { value: 'B+', label: { ru: 'B(III) Rh+', en: 'B+', be: 'B(III) Rh+' } },
            { value: 'B-', label: { ru: 'B(III) Rh−', en: 'B−', be: 'B(III) Rh−' } },
            { value: 'AB+', label: { ru: 'AB(IV) Rh+', en: 'AB+', be: 'AB(IV) Rh+' } },
            { value: 'AB-', label: { ru: 'AB(IV) Rh−', en: 'AB−', be: 'AB(IV) Rh−' } },
          ],
        },
        { key: 'height', label: { ru: 'Рост', en: 'Height', be: 'Рост' }, type: 'number', unit: { ru: 'см', en: 'cm', be: 'см' } },
        { key: 'weight', label: { ru: 'Вес', en: 'Weight', be: 'Вага' }, type: 'number', unit: { ru: 'кг', en: 'kg', be: 'кг' } },
        { key: 'allergies', label: { ru: 'Аллергии', en: 'Allergies', be: 'Алергіі' }, type: 'longtext' },
        { key: 'anamnesis', label: { ru: 'Общий анамнез', en: 'General anamnesis', be: 'Агульны анамнез' }, type: 'longtext' },
      ],
      views: [
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
        { key: 'all', type: 'table', name: { ru: 'Таблица', en: 'Table', be: 'Табліца' }, config: { columns: ['fullName', 'birthDate', 'sex', 'bloodType'] } },
      ],
    },
    {
      key: 'analyses',
      name: { ru: 'Анализы', en: 'Lab results', be: 'Аналізы' },
      icon: 'lucide:FlaskConical',
      fields: [
        { key: 'date', label: { ru: 'Дата', en: 'Date', be: 'Дата' }, type: 'date', required: true },
        {
          key: 'panel', label: { ru: 'Панель', en: 'Panel', be: 'Панэль' }, type: 'select',
          options: [
            { value: 'cbc', label: { ru: 'ОАК', en: 'CBC', be: 'ЗАК' } },
            { value: 'biochem', label: { ru: 'Биохимия', en: 'Biochemistry', be: 'Біяхімія' } },
            { value: 'hormones', label: { ru: 'Гормоны', en: 'Hormones', be: 'Гармоны' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other', be: 'Іншае' } },
          ],
        },
        { key: 'lab', label: { ru: 'Лаборатория', en: 'Lab', be: 'Лабараторыя' }, type: 'text' },
        { key: 'file', label: { ru: 'Скан', en: 'Scan', be: 'Скан' }, type: 'file' },
        { key: 'notes', label: { ru: 'Заметки', en: 'Notes', be: 'Нататкі' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['date', 'panel', 'lab'], sort: [{ field: 'date', dir: 'desc' }] } },
        { key: 'byPanel', type: 'board', name: { ru: 'По панелям', en: 'By panel', be: 'Па панэлях' }, config: { groupBy: 'panel' } },
        { key: 'scans', type: 'gallery', name: { ru: 'Сканы', en: 'Scans', be: 'Сканы' }, config: { cover: 'file' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'indicators',
      name: { ru: 'Показатели', en: 'Indicators', be: 'Паказчыкі' },
      icon: 'lucide:Activity',
      fields: [
        { key: 'analysis', label: { ru: 'Анализ', en: 'Analysis', be: 'Аналіз' }, type: 'relation', relation: { collection: 'analyses' } },
        { key: 'name', label: { ru: 'Показатель', en: 'Indicator', be: 'Паказчык' }, type: 'text', required: true },
        { key: 'canonical', label: { ru: 'Канон. имя', en: 'Standard name', be: 'Канан. імя' }, type: 'text' },
        { key: 'value', label: { ru: 'Значение', en: 'Value', be: 'Значэнне' }, type: 'number', range: { lowKey: 'refLow', highKey: 'refHigh' } },
        { key: 'unit', label: { ru: 'Ед.', en: 'Unit', be: 'Адз.' }, type: 'text' },
        { key: 'refLow', label: { ru: 'Норма от', en: 'Ref low', be: 'Норма ад' }, type: 'number' },
        { key: 'refHigh', label: { ru: 'Норма до', en: 'Ref high', be: 'Норма да' }, type: 'number' },
        { key: 'refEst', label: { ru: 'Норма — ориентир', en: 'Ref is estimate', be: 'Норма — арыенцір' }, type: 'checkbox' },
        { key: 'date', label: { ru: 'Дата', en: 'Date', be: 'Дата' }, type: 'date' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['date', 'name', 'value', 'unit', 'refLow', 'refHigh'], sort: [{ field: 'date', dir: 'desc' }] } },
        { key: 'trend', type: 'chart', name: { ru: 'Тренды', en: 'Trends', be: 'Трэнды' }, config: { x: 'date', y: 'value', series: 'canonical' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'visits',
      name: { ru: 'Приёмы', en: 'Visits', be: 'Прыёмы' },
      icon: 'lucide:Stethoscope',
      fields: [
        { key: 'date', label: { ru: 'Дата', en: 'Date', be: 'Дата' }, type: 'date', required: true },
        { key: 'doctor', label: { ru: 'Врач', en: 'Doctor', be: 'Урач' }, type: 'text' },
        { key: 'diagnosis', label: { ru: 'Диагноз', en: 'Diagnosis', be: 'Дыягназ' }, type: 'text' },
        { key: 'condition', label: { ru: 'По поводу', en: 'For condition', be: 'З нагоды' }, type: 'relation', relation: { collection: 'conditions' } },
        { key: 'notes', label: { ru: 'Заметки', en: 'Notes', be: 'Нататкі' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['date', 'doctor', 'diagnosis'], sort: [{ field: 'date', dir: 'desc' }] } },
        { key: 'cal', type: 'calendar', name: { ru: 'Календарь', en: 'Calendar', be: 'Каляндар' }, config: { dateField: 'date' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      // Problem list (FHIR Condition): diagnoses + chronic conditions in one place.
      key: 'conditions',
      name: { ru: 'Состояния', en: 'Conditions', be: 'Станы' },
      icon: 'lucide:ClipboardList',
      fields: [
        { key: 'name', label: { ru: 'Диагноз / состояние', en: 'Diagnosis / condition', be: 'Дыягназ / стан' }, type: 'text', required: true },
        {
          key: 'status', label: { ru: 'Статус', en: 'Status', be: 'Статус' }, type: 'select',
          options: [
            { value: 'active', label: { ru: 'Активно', en: 'Active', be: 'Актыўна' } },
            { value: 'chronic', label: { ru: 'Хроническое', en: 'Chronic', be: 'Хранічнае' } },
            { value: 'remission', label: { ru: 'Ремиссия', en: 'Remission', be: 'Рэмісія' } },
            { value: 'resolved', label: { ru: 'Разрешено', en: 'Resolved', be: 'Вырашана' } },
          ],
        },
        { key: 'onset', label: { ru: 'С какого времени', en: 'Onset', be: 'З якога часу' }, type: 'date' },
        { key: 'icd', label: { ru: 'Код МКБ', en: 'ICD code', be: 'Код МКХ' }, type: 'text' },
        { key: 'doctor', label: { ru: 'Врач', en: 'Doctor', be: 'Урач' }, type: 'text' },
        { key: 'notes', label: { ru: 'Заметки', en: 'Notes', be: 'Нататкі' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['name', 'status', 'onset', 'icd'] } },
        { key: 'byStatus', type: 'board', name: { ru: 'По статусу', en: 'By status', be: 'Па статусе' }, config: { groupBy: 'status' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      // FHIR MedicationStatement
      key: 'medications',
      name: { ru: 'Лекарства', en: 'Medications', be: 'Лекі' },
      icon: 'lucide:Pill',
      fields: [
        { key: 'name', label: { ru: 'Препарат', en: 'Medication', be: 'Прэпарат' }, type: 'text', required: true },
        { key: 'dose', label: { ru: 'Дозировка', en: 'Dose', be: 'Дозоўка' }, type: 'text' },
        { key: 'schedule', label: { ru: 'Схема приёма', en: 'Schedule', be: 'Схема прыёму' }, type: 'text' },
        { key: 'condition', label: { ru: 'По поводу', en: 'For condition', be: 'З нагоды' }, type: 'relation', relation: { collection: 'conditions' } },
        { key: 'since', label: { ru: 'Начало', en: 'Since', be: 'Пачатак' }, type: 'date' },
        { key: 'until', label: { ru: 'Окончание', en: 'Until', be: 'Заканчэнне' }, type: 'date' },
        {
          key: 'status', label: { ru: 'Статус', en: 'Status', be: 'Статус' }, type: 'select',
          options: [
            { value: 'active', label: { ru: 'Принимаю', en: 'Active', be: 'Прымаю' } },
            { value: 'finished', label: { ru: 'Завершён', en: 'Finished', be: 'Завершаны' } },
          ],
        },
        { key: 'notes', label: { ru: 'Заметки', en: 'Notes', be: 'Нататкі' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['name', 'dose', 'status'] } },
        { key: 'byStatus', type: 'board', name: { ru: 'По статусу', en: 'By status', be: 'Па статусе' }, config: { groupBy: 'status' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      // FHIR Observation (vital-signs): home self-measurements over time.
      key: 'vitals',
      name: { ru: 'Измерения', en: 'Measurements', be: 'Вымярэнні' },
      icon: 'lucide:Gauge',
      fields: [
        { key: 'measuredAt', label: { ru: 'Дата и время', en: 'Date & time', be: 'Дата і час' }, type: 'datetime', required: true },
        {
          key: 'type', label: { ru: 'Что измеряли', en: 'Metric', be: 'Што вымяралі' }, type: 'select',
          options: [
            { value: 'bp', label: { ru: '🩸 Давление', en: '🩸 Blood pressure', be: '🩸 Ціск' } },
            { value: 'pulse', label: { ru: '❤️ Пульс', en: '❤️ Pulse', be: '❤️ Пульс' } },
            { value: 'glucose', label: { ru: '🩸 Глюкоза', en: '🩸 Glucose', be: '🩸 Глюкоза' } },
            { value: 'spo2', label: { ru: '🫁 Сатурация (SpO₂)', en: '🫁 SpO₂', be: '🫁 Сатурацыя (SpO₂)' } },
            { value: 'temp', label: { ru: '🌡️ Температура', en: '🌡️ Temperature', be: '🌡️ Тэмпература' } },
            { value: 'weight', label: { ru: '⚖️ Вес', en: '⚖️ Weight', be: '⚖️ Вага' } },
            { value: 'steps', label: { ru: '🚶 Шаги', en: '🚶 Steps', be: '🚶 Крокі' } },
            { value: 'calories', label: { ru: '🔥 Калории', en: '🔥 Calories', be: '🔥 Калорыі' } },
            { value: 'bmi', label: { ru: '📐 ИМТ', en: '📐 BMI', be: '📐 ІМТ' } },
            { value: 'resp', label: { ru: '💨 ЧДД', en: '💨 Resp. rate', be: '💨 ЧДД' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other', be: 'Іншае' } },
          ],
        },
        { key: 'value', label: { ru: 'Значение', en: 'Value', be: 'Значэнне' }, type: 'number', required: true },
        { key: 'value2', label: { ru: 'Доп. (диаст.)', en: 'Secondary (diastolic)', be: 'Дадат. (дыяст.)' }, type: 'number' },
        { key: 'unit', label: { ru: 'Ед.', en: 'Unit', be: 'Адз.' }, type: 'text' },
        {
          key: 'context', label: { ru: 'Условия', en: 'Context', be: 'Умовы' }, type: 'select',
          options: [
            { value: 'fasting', label: { ru: 'Натощак', en: 'Fasting', be: 'Нашча' } },
            { value: 'before_meal', label: { ru: 'До еды', en: 'Before meal', be: 'Да ежы' } },
            { value: 'after_meal', label: { ru: 'После еды', en: 'After meal', be: 'Пасля ежы' } },
            { value: 'morning', label: { ru: 'Утро', en: 'Morning', be: 'Раніца' } },
            { value: 'evening', label: { ru: 'Вечер', en: 'Evening', be: 'Вечар' } },
            { value: 'rest', label: { ru: 'Покой', en: 'At rest', be: 'Спакой' } },
            { value: 'after_load', label: { ru: 'После нагрузки', en: 'After exertion', be: 'Пасля нагрузкі' } },
          ],
        },
        { key: 'notes', label: { ru: 'Заметки', en: 'Notes', be: 'Нататкі' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Журнал', en: 'Log', be: 'Журнал' }, config: { columns: ['measuredAt', 'type', 'value', 'value2', 'unit', 'context'], sort: [{ field: 'measuredAt', dir: 'desc' }] } },
        { key: 'trend', type: 'chart', name: { ru: 'Графики', en: 'Trends', be: 'Графікі' }, config: { x: 'measuredAt', y: 'value', series: 'type' } },
        { key: 'byType', type: 'board', name: { ru: 'По типу', en: 'By metric', be: 'Па тыпе' }, config: { groupBy: 'type' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'nutrition',
      name: { ru: 'Питание', en: 'Nutrition', be: 'Харчаванне' },
      icon: 'lucide:Utensils',
      fields: [
        { key: 'date', label: { ru: 'Дата', en: 'Date', be: 'Дата' }, type: 'date', required: true },
        {
          key: 'meal', label: { ru: 'Приём пищи', en: 'Meal', be: 'Прыём ежы' }, type: 'select',
          options: [
            { value: 'breakfast', label: { ru: 'Завтрак', en: 'Breakfast', be: 'Сняданак' } },
            { value: 'lunch', label: { ru: 'Обед', en: 'Lunch', be: 'Абед' } },
            { value: 'dinner', label: { ru: 'Ужин', en: 'Dinner', be: 'Вячэра' } },
            { value: 'snack', label: { ru: 'Перекус', en: 'Snack', be: 'Перакус' } },
          ],
        },
        { key: 'item', label: { ru: 'Блюдо/продукт', en: 'Food item', be: 'Страва/прадукт' }, type: 'text', required: true },
        { key: 'amount', label: { ru: 'Кол-во', en: 'Amount', be: 'Колькасць' }, type: 'number', unit: { ru: 'г', en: 'g', be: 'г' } },
        { key: 'kcal', label: { ru: 'Ккал', en: 'Kcal', be: 'Ккал' }, type: 'number', unit: { ru: 'ккал', en: 'kcal', be: 'ккал' } },
        { key: 'protein', label: { ru: 'Белки', en: 'Protein', be: 'Бялкі' }, type: 'number', unit: { ru: 'г', en: 'g', be: 'г' } },
        { key: 'fat', label: { ru: 'Жиры', en: 'Fat', be: 'Тлушчы' }, type: 'number', unit: { ru: 'г', en: 'g', be: 'г' } },
        { key: 'carbs', label: { ru: 'Углеводы', en: 'Carbs', be: 'Вугляводы' }, type: 'number', unit: { ru: 'г', en: 'g', be: 'г' } },
        { key: 'notes', label: { ru: 'Заметки', en: 'Notes', be: 'Нататкі' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Дневник', en: 'Diary', be: 'Дзённік' }, config: { columns: ['date', 'meal', 'item', 'amount', 'kcal', 'protein', 'fat', 'carbs'], sort: [{ field: 'date', dir: 'desc' }] } },
        { key: 'byDay', type: 'chart', name: { ru: 'Калории по дням', en: 'Calories by day', be: 'Калорыі па днях' }, config: { x: 'date', y: 'kcal' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'studies',
      name: { ru: 'Исследования', en: 'Studies', be: 'Даследаванні' },
      icon: 'lucide:ScanLine',
      fields: [
        { key: 'date', label: { ru: 'Дата', en: 'Date', be: 'Дата' }, type: 'date', required: true },
        {
          key: 'type', label: { ru: 'Тип', en: 'Type', be: 'Тып' }, type: 'select',
          options: [
            { value: 'usg', label: { ru: 'УЗИ', en: 'Ultrasound', be: 'УГД' } },
            { value: 'mri', label: { ru: 'МРТ', en: 'MRI', be: 'МРТ' } },
            { value: 'ct', label: { ru: 'КТ', en: 'CT', be: 'КТ' } },
            { value: 'xray', label: { ru: 'Рентген', en: 'X-ray', be: 'Рэнтген' } },
            { value: 'ecg', label: { ru: 'ЭКГ', en: 'ECG', be: 'ЭКГ' } },
            { value: 'endo', label: { ru: 'Эндоскопия', en: 'Endoscopy', be: 'Эндаскапія' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other', be: 'Іншае' } },
          ],
        },
        { key: 'area', label: { ru: 'Орган / область', en: 'Organ / area', be: 'Орган / вобласць' }, type: 'text' },
        { key: 'conclusion', label: { ru: 'Заключение', en: 'Conclusion', be: 'Заключэнне' }, type: 'longtext' },
        { key: 'doctor', label: { ru: 'Врач', en: 'Doctor', be: 'Урач' }, type: 'text' },
        { key: 'file', label: { ru: 'Скан / снимок', en: 'Scan / image', be: 'Скан / здымак' }, type: 'file' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['date', 'type', 'area', 'file'], sort: [{ field: 'date', dir: 'desc' }] } },
        { key: 'gallery', type: 'gallery', name: { ru: 'Снимки', en: 'Images', be: 'Здымкі' }, config: { cover: 'file' } },
        { key: 'cal', type: 'calendar', name: { ru: 'Календарь', en: 'Calendar', be: 'Каляндар' }, config: { dateField: 'date' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
    {
      key: 'documents',
      name: { ru: 'Документы', en: 'Documents', be: 'Дакументы' },
      icon: 'lucide:FileText',
      fields: [
        { key: 'date', label: { ru: 'Дата', en: 'Date', be: 'Дата' }, type: 'date' },
        { key: 'title', label: { ru: 'Название', en: 'Title', be: 'Назва' }, type: 'text', required: true },
        {
          key: 'type', label: { ru: 'Тип', en: 'Type', be: 'Тып' }, type: 'select',
          options: [
            { value: 'certificate', label: { ru: 'Справка', en: 'Certificate', be: 'Даведка' } },
            { value: 'extract', label: { ru: 'Выписка', en: 'Extract', be: 'Выпіска' } },
            { value: 'report', label: { ru: 'Заключение', en: 'Report', be: 'Заключэнне' } },
            { value: 'referral', label: { ru: 'Направление', en: 'Referral', be: 'Накіраванне' } },
            { value: 'other', label: { ru: 'Другое', en: 'Other', be: 'Іншае' } },
          ],
        },
        { key: 'file', label: { ru: 'Файл / скан', en: 'File / scan', be: 'Файл / скан' }, type: 'file' },
        { key: 'notes', label: { ru: 'Заметки', en: 'Notes', be: 'Нататкі' }, type: 'longtext' },
      ],
      views: [
        { key: 'all', type: 'table', name: { ru: 'Все', en: 'All', be: 'Усе' }, config: { columns: ['date', 'title', 'type', 'file'], sort: [{ field: 'date', dir: 'desc' }] } },
        { key: 'gallery', type: 'gallery', name: { ru: 'Плитки', en: 'Tiles', be: 'Пліткі' }, config: { cover: 'file' } },
        { key: 'card', type: 'form', name: { ru: 'Карточка', en: 'Card', be: 'Картка' } },
      ],
    },
  ],
  ai: {
    systemHints: {
      ru: 'Это личный медицинский архив (модель FHIR-lite). Реестры: profile (общие данные + анамнез), conditions (состояния/диагнозы — список проблем, статус active/chronic/remission/resolved), medications (лекарства), analyses с indicators (лабораторные показатели по бланку), vitals (домашние измерения; поля: measuredAt=дата-время, type=[bp давление|pulse пульс|glucose глюкоза|spo2 сатурация|temp температура|weight вес|resp ЧДД|other], value=значение, value2=диастолическое для давления, unit=единицы, context=[fasting|before_meal|after_meal|morning|evening|rest|after_load]), visits (приёмы/осмотры), studies (инструментальные исследования со сканом), documents (документы со сканом). Связи: indicator→анализ, лекарство/приём→состояние. Осмотр/консультацию вноси в visits, а ПОСТАВЛЕННЫЕ (подтверждённые, не «под вопросом») диагнозы — в conditions. Домашние замеры с прибора (давление/глюкометр/пульсоксиметр и т.п.) — в vitals. nutrition (Питание; поля: date, meal=[breakfast|lunch|dinner|snack], item=блюдо, amount=граммы, kcal, protein=белки, fat=жиры, carbs=углеводы, notes). ПОДСЧЁТ ПИТАНИЯ: когда пользователь называет еду (например «завтрак курица 100 г»), САМ оцени калории и БЖУ по своим знаниям о продуктах и сразу создай запись create_record в nutrition (date=сегодня, meal, item, amount, kcal, protein, fat, carbs) — не переспрашивай цифры, оценивай сам и коротко подтверди (ккал и БЖУ). Несколько блюд — несколько записей за тот же день. ИМТ: при записи веса, если в profile известен рост, посчитай ИМТ = вес(кг)/(рост_м)² и добавь запись vitals type=bmi (value=ИМТ округли до 0.1, unit=«кг/м²»). Помогай вносить данные в нужный реестр, отмечай отклонения показателей от референса. НИКОГДА не ставь диагнозы сам и не давай медицинских рекомендаций — только структурируй данные.',
      en: 'This is a personal medical archive (FHIR-lite). Collections: profile, conditions (problem list with status), medications, analyses with indicators (lab panel values), vitals (home self-measurements — blood pressure, pulse, glucose, SpO₂, temperature, weight; for blood pressure value=systolic, value2=diastolic), visits, studies (imaging with scan), documents (with scan). Relations: indicator→analysis, medication/visit→condition. Put device/home measurements into vitals. nutrition (fields: date, meal=[breakfast|lunch|dinner|snack], item, amount=grams, kcal, protein, fat, carbs, notes): when the user names food (e.g. "breakfast chicken 100g"), ESTIMATE kcal and macros (protein/fat/carbs) from your food knowledge yourself and create_record into nutrition (date=today, meal, item, amount, kcal, protein, fat, carbs) — do not ask for numbers, estimate and briefly confirm. BMI: when logging weight, if profile height is known, compute BMI = weight(kg)/(height_m)² and add a vitals record type=bmi (value rounded to 0.1, unit="kg/m²"). Help record data into the right collection and flag indicator deviations from the reference range. NEVER diagnose yourself or give medical advice — only structure the data.',
      be: 'Гэта асабісты медыцынскі архіў (FHIR-lite). Рэестры: profile, conditions (станы/дыягназы са статусам), medications (лекі), analyses з indicators, visits, studies (даследаванні са сканам), documents (са сканам). Сувязі: indicator→аналіз, лекі/прыём→стан. Дапамагай уносіць дадзеныя ў патрэбны рэестр, адзначай адхіленні паказчыкаў ад рэферэнсу. НІКОЛІ не стаў дыягназы сам і не давай медыцынскіх рэкамендацый — толькі структуруй дадзеныя.',
    },
    pipelines: [
      { id: 'medical-scan', premium: true, label: { ru: 'Распознать документ', en: 'Scan a document', be: 'Распазнаць дакумент' } },
    ],
  },
  // No seed: a fixed-date placeholder record is just clutter in every install.
}
