// ─── Почему поиск не ищет ─────────────────────────────────────────────────────
//
// Движки у поисковика живут своей жизнью: сегодня отвечает Brave, через месяц
// он закрывается и начинает возвращать «слишком много запросов», а Google
// вместо выдачи отдаёт страницу проверки — молча, без ошибки, просто пусто.
// Снаружи это выглядит одинаково: «поиск не работает».
//
// Эта проверка спрашивает каждый движок ОТДЕЛЬНО и показывает, кто жив, кто
// молчит и кто отвечает пустотой. Запускать на том сервере, где болит: ответ
// зависит от адреса, с которого идёт запрос, и на чужой машине он другой.
const SEARXNG = process.env.SEARXNG_URL || 'http://searxng:8080'
const QUERY = process.env.SEARCH_DOCTOR_QUERY || 'купить фидер Минск'
const ENGINES = ['yandex', 'seznam', 'google', 'brave', 'duckduckgo', 'mojeek',
  'startpage', 'qwant', 'bing', 'yahoo', 'marginalia', 'wikipedia']

const pad = (s, n) => String(s).padEnd(n)

async function engine(name) {
  const u = new URL('/search', SEARXNG)
  u.searchParams.set('q', QUERY)
  u.searchParams.set('format', 'json')
  u.searchParams.set('engines', name)
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) return { verdict: `HTTP ${r.status}`, note: '' }
    const d = await r.json()
    const all = d.results ?? []
    // Считаем ТОЛЬКО то, что пришло от спрошенного движка. Если он выключен в
    // настройках, SearXNG молча игнорирует фильтр и отдаёт выдачу остальных —
    // и проверка показывала бы здоровым того, кто вообще не работал.
    const mine = all.filter((x) => (x.engine ?? '') === name || (x.engines ?? []).includes(name))
    const silent = (d.unresponsive_engines ?? []).length > 0
    if (mine.length) return { verdict: `✅ ${mine.length}`, note: mine[0].url.slice(0, 48) }
    if (all.length) return { verdict: '— выключен', note: 'в settings.yml стоит disabled: true' }
    // Пустота бывает двух сортов, и это РАЗНЫЕ болезни: «не ответил» — сеть или
    // блокировка по адресу, «ответил пустым» — отдал страницу проверки вместо
    // выдачи, и парсер честно разобрал ничто.
    return silent
      ? { verdict: '— молчит', note: 'не ответил: сеть или блокировка' }
      : { verdict: '— пусто', note: 'ответил, но выдачи нет: проверка на робота' }
  } catch (e) {
    return { verdict: '✖ ошибка', note: String(e.message ?? e).slice(0, 48) }
  }
}

console.log(`\nЗапрос: «${QUERY}»\nSearXNG: ${SEARXNG}\n`)
console.log(pad('движок', 14) + pad('итог', 12) + 'что именно')
console.log('─'.repeat(78))
for (const e of ENGINES) {
  const { verdict, note } = await engine(e)
  console.log(pad(e, 14) + pad(verdict, 12) + note)
}

// Запасной путь бэкенда: прямая выдача DuckDuckGo. Он не через SearXNG ходит,
// поэтому и проверяется отдельно — у него своя судьба.
process.stdout.write('\n' + pad('ddg напрямую', 14))
try {
  const r = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    body: new URLSearchParams({ q: QUERY }).toString(),
    signal: AbortSignal.timeout(20_000),
  })
  const html = await r.text()
  const n = (html.match(/class="result__a"/g) ?? []).length
  // 202 — это их «аномалия»: страница-заглушка вместо выдачи. Приходит после
  // нескольких запросов подряд с одного адреса, какими заголовками ни ходи.
  console.log(pad(n ? `✅ ${n}` : r.status === 202 ? '— блокирует' : '— пусто', 12)
    + `HTTP ${r.status}` + (r.status === 202 ? ' (несколько запросов — и адрес в бане)' : ''))
} catch (e) { console.log(pad('✖ ошибка', 12) + String(e.message ?? e).slice(0, 48)) }

console.log(pad('ключ API', 14) + (process.env.SEARCH_API
  ? `задан: ${process.env.SEARCH_API}`
  : 'не задан — работаем бесплатными путями'))
console.log()
