// Real Nginx + a local mock upstream. NGINX_BIN may point to nginx.exe on Windows.
// No Docker, external network or search-provider quota needed.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'

const config = await readFile(new URL('../nginx/nginx.conf', import.meta.url), 'utf8')
const block = config.match(/    location \/search\/ \{[\s\S]*?\n    \}/)?.[0]
assert.ok(block, 'SearXNG location must exist')
const requests = []
const upstream = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  requests.push({ url: req.url, prefix: req.headers['x-script-name'], method: req.method, body })
  if (req.url.startsWith('/search/preferences')) { res.writeHead(302, { Location: '/search/preferences?done=1' }); res.end(); return }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(requests.at(-1)))
})
await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
const upstreamPort = upstream.address().port
const reserve = createServer()
await new Promise((r) => reserve.listen(0, '127.0.0.1', r))
const port = reserve.address().port
await new Promise((r) => reserve.close(r))
const dir = await mkdtemp(join(tmpdir(), 'sinout-search-proxy-'))
const nginx = process.env.NGINX_BIN ? resolve(process.env.NGINX_BIN) : 'nginx'
let child
try {
  await mkdir(join(dir, 'logs'))
  await mkdir(join(dir, 'temp'))
  const location = block.replace('set $searxng searxng:8080;', `set $searxng 127.0.0.1:${upstreamPort};`)
  await writeFile(join(dir, 'nginx.conf'), `daemon off;\nmaster_process off;\nerror_log logs/error.log;\npid nginx.pid;\nevents {}\nhttp {\n access_log logs/access.log;\n client_body_temp_path temp/client_body;\n proxy_temp_path temp/proxy;\n fastcgi_temp_path temp/fastcgi;\n uwsgi_temp_path temp/uwsgi;\n scgi_temp_path temp/scgi;\n limit_req_zone $binary_remote_addr zone=search:10m rate=20r/s;\n server {\n listen 127.0.0.1:${port};\n${location}\n }\n}\n`)
  const args = ['-p', dir.replaceAll('\\', '/') + '/', '-c', 'nginx.conf']
  const check = spawnSync(nginx, [...args, '-t'], { cwd: dir, encoding: 'utf8', windowsHide: true })
  if (check.error) throw check.error
  assert.equal(check.status, 0, check.stderr)
  child = spawn(nginx, args, { cwd: dir, windowsHide: true, stdio: 'pipe' })
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 5000
  while (true) {
    try { await fetch(base + '/search/', { signal: AbortSignal.timeout(500) }); break }
    catch (e) { if (Date.now() > deadline) throw e; await new Promise((r) => setTimeout(r, 50)) }
  }
  for (const path of ['/search/', '/search/search?q=%D0%9C%D0%B8%D0%BD%D1%81%D0%BA&format=json&engines=bing', '/search/config', '/search/static/themes/simple/theme.css?v=1']) {
    const r = await fetch(base + path)
    assert.equal(r.status, 200)
    const forwarded = await r.json()
    assert.equal(forwarded.url, path, 'Path and encoded query must reach SearXNG unchanged')
    assert.equal(forwarded.prefix, '/search', 'SearXNG middleware needs the public prefix')
  }
  const body = 'q=%D0%9C%D0%B8%D0%BD%D1%81%D0%BA&format=json'
  const posted = await fetch(base + '/search/search', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }).then((r) => r.json())
  assert.equal(posted.method, 'POST')
  assert.equal(posted.url, '/search/search')
  assert.equal(posted.body, body)
  const redirect = await fetch(base + '/search/preferences', { redirect: 'manual' })
  assert.equal(redirect.headers.get('location'), '/search/preferences?done=1', 'Do not add the prefix twice')
  console.log('PASS real Nginx: search query, home/config/assets, POST body, prefix header and redirects')
} finally {
  if (child && child.exitCode === null) {
    child.kill()
    await new Promise((r) => child.once('exit', r))
  }
  await new Promise((r) => upstream.close(r))
  assert.equal(dirname(resolve(dir)), resolve(tmpdir()))
  assert.ok(basename(dir).startsWith('sinout-search-proxy-'))
  await rm(dir, { recursive: true, force: true })
}
