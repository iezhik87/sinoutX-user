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
const API_ONLY = process.env.SEARCH_DOCTOR_API_ONLY === '1'
const BROWSER_ONLY = process.env.SEARCH_DOCTOR_BROWSER_ONLY === '1'
const API_KEY = process.env.SEARCH_API_KEY?.trim() || ''
const BROWSER_TOKEN = process.env.BROWSER_SEARCH_TOKEN || ''
const ENGINES = ['yandex', 'seznam', 'google', 'brave', 'duckduckgo', 'mojeek',
  'startpage', 'qwant', 'bing', 'yahoo', 'marginalia', 'wikipedia']

const pad = (s, n) => String(s).padEnd(n)
const safe = (text) => [API_KEY, BROWSER_TOKEN].filter(Boolean).reduce((s, secret) => s.split(secret).join('[скрыт]'), String(text)).replace(/[\r\n\t]/g, ' ').slice(0, 160)
let configuredEngines = null

// Exactly one small request to the same provider/endpoint the backend uses.
// Never print the key, headers or a raw provider error body.
async function checkApi() {
  const provider = process.env.SEARCH_API?.trim()
  if (!provider) { console.log('API поиска: не настроен — используются бесплатные пути'); return }
  if (!API_KEY) { console.log(`API поиска: ${safe(provider)} — ключ не задан`); process.exitCode = 1; return }
  if (provider !== 'serper') { console.log(`API поиска: ${safe(provider)} — ключ задан, проверка этого поставщика не реализована`); return }
  console.log('Serper: проверяю одним запросом (3 результата, расходует квоту API)…')
  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: QUERY, num: 3 }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) {
      const reason = ({ 401: 'проверьте ключ', 403: 'доступ запрещён: проверьте аккаунт/регион', 429: 'лимит запросов или квоты' })[r.status] || 'ошибка поставщика'
      console.log(`Serper: ✖ HTTP ${r.status} — ${reason}`)
      process.exitCode = 1
      return
    }
    const d = await r.json()
    if (!Array.isArray(d.organic)) throw new Error('неожиданный JSON: нет массива organic')
    const results = d.organic.filter((x) => typeof x.link === 'string' && /^https?:\/\//i.test(x.link))
    console.log(`Serper: ${results.length ? `✅ ${results.length}` : '— пусто'} (HTTP ${r.status}, корректный JSON)`)
    for (const x of results.slice(0, 3)) console.log(`  ${safe(x.title ?? '')} — ${safe(x.link)}`)
  } catch (e) {
    console.log(`Serper: ✖ ${safe(e.message ?? e)}`)
    process.exitCode = 1
  }
}

function printBrowserAttempt(a) {
  console.log(`  ${safe(a.engine)}: ${safe(a.status)}${a.elapsedMs != null ? ` (${safe(a.elapsedMs)} мс)` : ''}${a.stage ? `; этап: ${safe(a.stage)}` : ''}`)
  const fields = [['httpStatus', 'HTTP'], ['pageKind', 'страница'], ['matchedRows', 'элементов выдачи'], ['visibleRows', 'видимых'], ['bodyChars', 'символов'], ['failedRequests', 'сбоев загрузки'], ['blockedScripts', 'скриптов вне разрешённых доменов'], ['navigationRetries', 'смен документа'], ['errorCode', 'причина']]
  const details = fields.filter(([key]) => a[key] != null).map(([key, label]) => `${label}: ${safe(a[key])}`)
  if (a.extractionMode) details.push(`чтение: ${safe(a.extractionMode)}`)
  if (a.htmlRows != null) details.push(`результатов в HTML: ${safe(a.htmlRows)}`)
  if (details.length) console.log(`    ${details.join('; ')}`)
}

async function checkBrowser() {
  if (!BROWSER_TOKEN) { console.log('Браузерный поиск: токен не задан'); process.exitCode = 1; return }
  console.log(`Браузерный поиск: проверяю Chromium (режим ${safe(process.env.BROWSER_SEARCH_MODE || 'off')})…`)
  try {
    const r = await fetch(`${(process.env.BROWSER_SEARCH_URL || 'http://browser-search:8090').replace(/\/$/, '')}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BROWSER_TOKEN}` },
      body: JSON.stringify({ query: QUERY, limit: 3, language: 'ru', country: 'by', scope: 'd'.repeat(64) }),
      signal: AbortSignal.timeout(43_000),
    })
    const d = await r.json().catch(() => null)
    if (!r.ok) {
      console.log(`Браузерный поиск: ✖ HTTP ${r.status}${d?.error ? ` (${safe(d.error)})` : ''}`)
      if (d?.stage) console.log(`  этап: ${safe(d.stage)}; движок: ${safe(d.engine || 'нет')}; прошло: ${safe(d.elapsedMs ?? '?')} мс`)
      for (const a of (d?.attempts || [])) printBrowserAttempt(a)
      process.exitCode = 1
      return
    }
    if (!Array.isArray(d?.results)) throw new Error('неожиданный JSON')
    console.log(`Браузерный поиск: ${d.results.length ? `✅ ${d.results.length}` : '— результатов нет'}; движок: ${safe(d.engine || 'нет')}; кэш: ${d.cached === true ? 'да' : 'нет'}`)
    if (d.timedOut) console.log(`  общий бюджет времени исчерпан (${safe(d.elapsedMs ?? '?')} мс); ниже результаты отдельных попыток`)
    for (const a of (d.attempts || [])) printBrowserAttempt(a)
    for (const x of d.results.slice(0, 3)) console.log(`  ${safe(x.title ?? '')} — ${safe(x.url ?? '')}`)
    if (!d.results.length) process.exitCode = 1
  } catch (e) { console.log(`Браузерный поиск: ✖ ${safe(e.message ?? e)}`); process.exitCode = 1 }
}

async function engine(name) {
  if (configuredEngines && !configuredEngines.has(name)) return { verdict: '— отсутствует', note: 'нет в /config этого экземпляра' }
  const u = new URL('/search', SEARXNG)
  u.searchParams.set('q', QUERY)
  u.searchParams.set('format', 'json')
  u.searchParams.set('engines', name)
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) return { verdict: `HTTP ${r.status}`, note: '' }
    const d = await r.json()
    if (!Array.isArray(d.results)) return { verdict: '✖ ответ', note: 'нет массива results; проверьте адрес/прокси' }
    const all = d.results
    // Чужие результаты не подтверждают работу спрошенного движка. Статус
    // enabled читается отдельно: выключенный по умолчанию движок иногда
    // работает при принудительном запросе engines= (как Bing в замере).
    const mine = all.filter((x) => (x.engine ?? '') === name || (x.engines ?? []).includes(name))
    const failure = (d.unresponsive_engines ?? []).find((x) => Array.isArray(x) && x[0] === name)
    const disabled = configuredEngines?.get(name)?.enabled === false
    if (mine.length) return { verdict: `✅ ${mine.length}`, note: `${disabled ? '[не в общем поиске] ' : ''}${safe(mine[0].url ?? '')}` }
    if (failure) return { verdict: '— ошибка', note: safe(failure[1] ?? 'движок не ответил') }
    if (all.length) return { verdict: '— другие', note: 'ответили другие движки; этот не подтверждён' }
    // Empty results alone prove neither a CAPTCHA nor a network failure.
    return { verdict: '— пусто', note: `${disabled ? '[не в общем поиске] ' : ''}результатов нет; причина неизвестна` }
  } catch (e) {
    return { verdict: '✖ ошибка', note: safe(e.message ?? e) }
  }
}

console.log(`\nЗапрос: «${safe(QUERY)}»\nSearXNG: ${safe(SEARXNG)}\n`)
if (BROWSER_ONLY) await checkBrowser()
else {
  await checkApi()
  if (!API_ONLY && process.env.BROWSER_SEARCH_MODE && process.env.BROWSER_SEARCH_MODE !== 'off') await checkBrowser()
}
if (!API_ONLY && !BROWSER_ONLY) {
try {
  const r = await fetch(new URL('/config', SEARXNG), { signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  if (!Array.isArray(d.engines)) throw new Error('неверный JSON')
  configuredEngines = new Map(d.engines.map((x) => [x.name, x]))
  console.log('\nКонфигурация движков прочитана из SearXNG /config.')
} catch { console.log('\nНе удалось прочитать /config — состояние включения движков неизвестно.') }
try {
  const u = new URL('/search', SEARXNG)
  u.search = new URLSearchParams({ q: QUERY, format: 'json' }).toString()
  const r = await fetch(u, { signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  if (!Array.isArray(d.results)) throw new Error('нет массива results')
  console.log(`Общий поиск SearXNG: ${d.results.length} результатов; источники: ${[...new Set(d.results.flatMap((x) => x.engines ?? [x.engine]).filter(Boolean))].join(', ') || 'нет'}`)
} catch (e) { console.log(`Общий поиск SearXNG: ✖ ${safe(e.message ?? e)}`) }
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
  // 202 со страницей без результатов — заглушка/проверка, не рабочая выдача.
  console.log(pad(n ? `✅ ${n}` : r.status === 202 ? '— блокирует' : '— пусто', 12)
    + `HTTP ${r.status}` + (r.status === 202 ? ' (заглушка/проверка вместо выдачи)' : ''))
} catch (e) { console.log(pad('✖ ошибка', 12) + safe(e.message ?? e)) }
}

console.log()
