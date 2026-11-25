"""Bounded public-search queue. Real Chromium, no fingerprint patches/CAPTCHA solving.

All Playwright objects live on the queue's one thread. Each navigation has an
isolated, anonymous context; search cookies never mix with the lab or user logins.
"""
import base64
from collections import OrderedDict
import hmac
import http.server
import ipaddress
import json
import os
import queue
import re
import threading
import time
from urllib.parse import parse_qs, urlencode, urlsplit

from playwright.sync_api import sync_playwright, Error as PlaywrightError, TimeoutError as PlaywrightTimeoutError


ENGINES = ("bing", "google", "duckduckgo")
DOMAINS = ("bing.com", "bing.net", "s.bingparachute.com", "microsoft.com", "msn.com", "google.com",
           "gstatic.com", "googleusercontent.com", "duckduckgo.com", "duckduckgo.net")


def integer(name, default, minimum, maximum):
    value = int(os.environ.get(name, default))
    if not minimum <= value <= maximum:
        raise ValueError("invalid " + name)
    return value


def validate(data):
    if not isinstance(data, dict) or set(data) - {"query", "limit", "language", "country", "scope"}:
        raise ValueError("invalid search fields")
    query_text = data.get("query")
    limit = data.get("limit", 8)
    scope = data.get("scope", "")
    language = data.get("language", "en")
    country = data.get("country", "")
    if not isinstance(query_text, str) or not 1 <= len(query_text.strip()) <= 500:
        raise ValueError("query must be 1..500 characters")
    if type(limit) is not int or not 1 <= limit <= 10:
        raise ValueError("limit must be 1..10")
    if not isinstance(scope, str) or not re.fullmatch(r"[a-f0-9]{64}", scope):
        raise ValueError("invalid cache scope")
    if language not in ("ru", "en", "be") or not isinstance(country, str) or not re.fullmatch(r"[a-z]{0,2}", country) or len(country) == 1:
        raise ValueError("invalid locale")
    return dict(query=query_text.strip(), limit=limit, scope=scope, language=language, country=country)


def allowed_resource(url):
    try:
        parsed = urlsplit(url)
        return parsed.scheme == "https" and (parsed.port in (None, 443)) and any(
            parsed.hostname == host or (parsed.hostname or "").endswith("." + host) for host in DOMAINS)
    except ValueError:
        return False


def target_url(value):
    """Unwrap search-engine redirect links; never visit result URLs here."""
    try:
        if len(value) > 4096:
            return None
        parsed = urlsplit(value)
        params = parse_qs(parsed.query)
        host = parsed.hostname or ""
        if host.endswith("google.com") and parsed.path == "/url":
            value = (params.get("q") or params.get("url") or [""])[0]
        elif host.endswith("duckduckgo.com") and "uddg" in params:
            value = params["uddg"][0]
        elif host.endswith("bing.com") and parsed.path.startswith("/ck/"):
            encoded = (params.get("u") or [""])[0]
            if encoded.startswith("a1"):
                raw = encoded[2:]
                value = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-8")
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if parsed.scheme not in ("https", "http") or not host or parsed.username or parsed.password:
            return None
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            pass
        if any(host == d or host.endswith("." + d) for d in ("bing.com", "google.com", "duckduckgo.com")):
            return None
        return value
    except (ValueError, UnicodeError):
        return None


def search_url(engine, payload):
    q = payload["query"]
    lang = payload["language"]
    country = payload["country"]
    if engine == "bing":
        params = dict(q=q, count=10, setlang=lang)
        if country:
            params["cc"] = country
        return "https://www.bing.com/search?" + urlencode(params)
    if engine == "google":
        params = dict(q=q, num=10, hl=lang)
        if country:
            params["gl"] = country
        return "https://www.google.com/search?" + urlencode(params)
    return "https://duckduckgo.com/?" + urlencode(dict(q=q, **({"kl": country + "-" + lang} if country else {})))


EXTRACT = r"""engine => {
  const selectors = {bing: '#b_results li.b_algo', google: '#search div.MjjYud', duckduckgo: '[data-testid="result"], .result.results_links'};
  const matches = [...document.querySelectorAll(selectors[engine])];
  const hiddenRows = [];
  const htmlReady = engine === 'bing' && document.readyState === 'complete'
    && getComputedStyle(document.querySelector('#b_results') || document.documentElement).visibility === 'hidden';
  const rows = matches.slice(0, 100).map(el => {
    if (el.closest('#tads, #bottomads, .b_ad, [data-layout="ad"]')) return null;
    const heading = el.querySelector(engine === 'bing' ? 'h2' : 'h3, h2');
    const a = heading?.closest('a') || heading?.querySelector('a') || el.querySelector('a[data-testid="result-title-a"], a.result__a');
    const snippet = el.querySelector('.b_caption p, .VwiC3b, [data-sncf], [data-testid="result-snippet"], .result__snippet');
    const visible = a && a.getClientRects().length && getComputedStyle(a).visibility !== 'hidden' && !a.closest('[hidden], [aria-hidden="true"]');
    // Bing can deliver the full organic list while its container stays CSS-hidden.
    // Read supplied HTML only; do not alter styles, click controls or solve checks.
    if (!visible && htmlReady && a?.getClientRects().length && getComputedStyle(a).visibility === 'hidden'
        && !a.closest('[hidden], [aria-hidden="true"]')) {
      const title = (heading?.textContent || a.textContent || '').trim().slice(0, 300);
      if (title && a.href) hiddenRows.push({title, url: a.href, snippet: (snippet?.textContent || '').trim().slice(0, 1200)});
    }
    return visible ? {title: (heading?.innerText || a.innerText || '').trim().slice(0, 300), url: a.href, snippet: (snippet?.innerText || '').trim().slice(0, 1200)} : null;
  }).filter(x => x && x.title && x.url);
  const text = (document.body?.innerText || '').slice(0, 12000).toLowerCase();
  const challenge = [...document.querySelectorAll('form[action*="/sorry"], #captcha-form, #b_captcha, #challenge-form, #img-form, .anomaly-modal, .anomaly-modal__modal, iframe[src*="recaptcha"]')].some(el => el.getClientRects().length)
    || (!rows.length && /unusual traffic|verify you are human|confirm you are human|подтвердите, что вы не робот|проверка, что вы не робот|complete the captcha|bots use duckduckgo/.test(text));
  const pageKind = location.hostname === 'consent.google.com' ? 'consent'
    : location.pathname.startsWith('/sorry') || challenge ? 'challenge'
    : matches.length ? 'results_markup' : 'other';
  return {rows, hiddenRows, challenge, pageKind, matchedRows: matches.length, bodyChars: text.length};
}"""


def error_code(error):
    """Classify locally; raw Playwright messages include the user's query."""
    message = str(error)
    if "Execution context was destroyed" in message or "Cannot find context with specified id" in message:
        return "navigation_changed"
    if "Target page, context or browser has been closed" in message:
        return "browser_closed"
    match = re.search(r"net::(ERR_[A-Z_]+)\b", message)
    return match.group(1) if match else "playwright_error" if isinstance(error, PlaywrightError) else "internal_error"


class Progress:
    """Safe diagnostics shared with the waiting HTTP thread; no query or scope."""
    def __init__(self):
        self.lock = threading.Lock()
        self.started = time.monotonic()
        self.engine = None
        self.stage = "queued"
        self.attempts = []

    def set(self, stage, engine=None):
        with self.lock:
            self.stage, self.engine = stage, engine

    def add(self, attempt):
        with self.lock:
            self.attempts.append(dict(attempt))

    def snapshot(self):
        with self.lock:
            return dict(stage=self.stage, engine=self.engine, attempts=list(self.attempts), elapsedMs=round((time.monotonic() - self.started) * 1000))


class WorkerTimeout(TimeoutError):
    def __init__(self, progress):
        super().__init__("browser_search_timeout")
        self.progress = progress.snapshot()


class WorkerError(RuntimeError):
    pass


class WorkerNotReady(RuntimeError):
    pass


class Search:
    def __init__(self, engines=None, render=None, clock=time.monotonic, sleep=time.sleep):
        self.engines = engines or [e.strip() for e in os.environ.get("BROWSER_SEARCH_ENGINES", "bing,google,duckduckgo").split(",") if e.strip()]
        if not self.engines or len(set(self.engines)) != len(self.engines) or any(e not in ENGINES for e in self.engines):
            raise ValueError("BROWSER_SEARCH_ENGINES must list bing, google, duckduckgo without duplicates")
        self.clock, self.sleep = clock, sleep
        self.render = render or self._render
        self.cache = OrderedDict()
        self.cooldown = {}
        self.last_start = {}
        self.ttl = integer("BROWSER_SEARCH_CACHE_SECONDS", 300, 0, 3600)
        self.interval = integer("BROWSER_SEARCH_INTERVAL_SECONDS", 5, 1, 60)
        self.block_seconds = integer("BROWSER_SEARCH_BLOCK_SECONDS", 300, 30, 3600)
        self.pw = self.browser = None
        self.progress = None
        self.stage = "queued"
        self.failure_stage = None
        self.diagnostics = {}

    def warmup(self):
        """Start Chromium and its first renderer on the owning worker thread."""
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(channel="chromium", timeout=15000, args=["--disable-dev-shm-usage"])
        ctx = self.browser.new_context(locale="ru-RU", accept_downloads=False, service_workers="block")
        try:
            page = ctx.new_page()
            page.goto("about:blank", timeout=5000)
        finally:
            ctx.close()

    def _stage(self, stage, engine):
        self.stage = stage
        if self.progress:
            self.progress.set(stage, engine)

    def _remaining_ms(self, deadline, reserve=0.75, maximum=5000):
        remaining = deadline - self.clock() - reserve
        if remaining <= 0:
            raise TimeoutError("search stage budget exhausted")
        return max(1, min(maximum, int(remaining * 1000)))

    def _render(self, engine, payload, deadline):
        if self.browser is None or not self.browser.is_connected():
            self._stage("starting_browser", engine)
            if self.pw is None:
                self.pw = sync_playwright().start()
            self.browser = self.pw.chromium.launch(channel="chromium", timeout=self._remaining_ms(deadline), args=["--disable-dev-shm-usage"])
        self._stage("creating_context", engine)
        self._remaining_ms(deadline)
        ctx = self.browser.new_context(locale={"ru": "ru-RU", "en": "en-US", "be": "be-BY"}[payload["language"]], accept_downloads=False, service_workers="block")
        try:
            def route(request_route):
                request = request_route.request
                if request.resource_type in ("image", "media", "font") or not allowed_resource(request.url):
                    if request.resource_type == "script":
                        self.diagnostics["blockedScripts"] = self.diagnostics.get("blockedScripts", 0) + 1
                    request_route.abort()
                else:
                    request_route.fallback()
            ctx.route("**/*", route)
            page = ctx.new_page()
            def on_response(response):
                if response.request.is_navigation_request() and response.frame == page.main_frame:
                    self.diagnostics["httpStatus"] = response.status
            def on_failed(request):
                if request.resource_type in ("document", "script") and allowed_resource(request.url):
                    self.diagnostics["failedRequests"] = self.diagnostics.get("failedRequests", 0) + 1
            page.on("response", on_response)
            page.on("requestfailed", on_failed)
            ms = self._remaining_ms(deadline, maximum=15000 if engine == "bing" else 5000)
            page.set_default_timeout(ms)
            self._stage("navigating", engine)
            # A slow deferred script must not hide results already in the DOM.
            response = page.goto(search_url(engine, payload), wait_until="commit", timeout=ms)
            if response and response.status in (403, 429):
                return {"status": "blocked", "results": [], "stage": "navigating"}
            if response and response.status >= 400:
                return {"status": "error", "results": [], "stage": "navigating"}
            if urlsplit(page.url).hostname == "consent.google.com":
                return {"status": "consent_required", "results": [], "stage": "navigating"}
            # Poll within this engine's budget, including delayed JS results.
            self._stage("extracting", engine)
            state = None
            while True:
                self._remaining_ms(deadline, reserve=0.5)
                try:
                    state = page.evaluate(EXTRACT, engine)
                except PlaywrightError as error:
                    if error_code(error) != "navigation_changed":
                        raise
                    # A client redirect replaces the JS context. Retry the new
                    # document within the same deadline, without a new request.
                    self.diagnostics["navigationRetries"] = self.diagnostics.get("navigationRetries", 0) + 1
                    page.wait_for_timeout(100)
                    continue
                self.diagnostics.update({k: state[k] for k in ("pageKind", "matchedRows", "bodyChars")})
                self.diagnostics["visibleRows"] = len(state["rows"])
                self.diagnostics["htmlRows"] = len(state["hiddenRows"])
                if state["pageKind"] == "consent":
                    return {"status": "consent_required", "results": [], "stage": "extracting"}
                if state["challenge"] or state["pageKind"] == "challenge":
                    return {"status": "blocked", "results": [], "stage": "extracting"}
                results, seen = [], set()
                selected_rows = state["rows"] or state["hiddenRows"]
                for row in selected_rows:
                    url = target_url(row.get("url", ""))
                    if url and url not in seen:
                        seen.add(url)
                        results.append(dict(title=row["title"], url=url, snippet=row["snippet"]))
                if results or self.clock() + 0.8 >= deadline:
                    if results:
                        self.diagnostics["extractionMode"] = "visible" if state["rows"] else "html"
                    status = "ok" if results else "timeout" if not state["bodyChars"] and not state["matchedRows"] else "empty"
                    return {"status": status, "results": results[:10], "stage": "extracting"}
                page.wait_for_timeout(250)
        except Exception:
            self.failure_stage = self.stage
            raise
        finally:
            self._stage("closing_context", engine)
            ctx.close()

    def search(self, payload, deadline, progress=None):
        self.progress = progress
        # Finish browser work BEFORE the HTTP waiter expires. Closing contexts,
        # serializing results and waking the waiting thread all take real time.
        started = self.clock()
        finish_by = deadline - min(2.0, max(0.1, (deadline - started) * 0.1))
        key = (payload["scope"], payload["query"], payload["language"], payload["country"])
        cached = self.cache.get(key)
        if cached and cached[0] > self.clock():
            if progress:
                progress.set("cached", cached[1]["engine"])
            self.cache.move_to_end(key)
            return dict(cached[1], results=cached[1]["results"][:payload["limit"]], cached=True)
        self.cache.pop(key, None)
        attempts = []
        for engine in self.engines:
            if self.clock() + 0.5 >= finish_by:
                break
            if self.cooldown.get(engine, 0) > self.clock():
                attempts.append(dict(engine=engine, status="cooldown"))
                continue
            wait = self.last_start.get(engine, -1e9) + self.interval - self.clock()
            if wait > 0:
                if self.clock() + wait + 1 >= finish_by:
                    attempts.append(dict(engine=engine, status="rate_limited"))
                    continue
                self.sleep(wait)
            self.last_start[engine] = self.clock()
            attempt_started = self.clock()
            self.stage, self.failure_stage = "rendering", None
            self.diagnostics = {}
            try:
                # A slow first source must not consume every later source's
                # allowance; the last source must not consume the HTTP reserve.
                # The server probe needed up to 18s to receive Bing's HTML.
                # Preserve a bounded allowance for later sources and cleanup.
                allowance = 22 if engine == "bing" else 7
                answer = self.render(engine, payload, min(finish_by, attempt_started + allowance))
            except (PlaywrightTimeoutError, TimeoutError):
                answer = dict(status="timeout", results=[])
            except Exception as e:  # Do not log exception messages: they can contain queries.
                print("[browser-search] engine=%s error_type=%s" % (engine, type(e).__name__), flush=True)
                self.diagnostics["errorCode"] = error_code(e)
                answer = dict(status="error", results=[])
            attempt = dict(engine=engine, status=answer["status"], elapsedMs=round((self.clock() - attempt_started) * 1000))
            attempt["stage"] = self.failure_stage or answer.get("stage") or self.stage
            attempt.update(self.diagnostics)
            attempts.append(attempt)
            if progress:
                progress.add(attempt)
            print("[browser-search] engine=%s status=%s stage=%s elapsed_ms=%d" % (engine, answer["status"], attempt["stage"], attempt["elapsedMs"]), flush=True)
            if answer["results"]:
                if progress:
                    progress.set("done", engine)
                out = dict(results=answer["results"], engine=engine, attempts=attempts, cached=False)
                if self.ttl:
                    self.cache[key] = (self.clock() + self.ttl, out)
                    while len(self.cache) > 128:
                        self.cache.popitem(last=False)
                return dict(out, results=out["results"][:payload["limit"]])
            delay = self.block_seconds if answer["status"] in ("blocked", "consent_required") else 30
            self.cooldown[engine] = self.clock() + delay
        timed_out = self.clock() + 0.5 >= finish_by
        if progress:
            progress.set("budget_exhausted" if timed_out else "done")
        return dict(results=[], engine=None, attempts=attempts, cached=False, timedOut=timed_out, elapsedMs=round((self.clock() - started) * 1000))


class Worker:
    def __init__(self, search, warmup=False):
        self.search = search
        self.warmup = warmup
        self.ready = threading.Event()
        self.startup_failed = False
        self.q = queue.Queue(maxsize=4)
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            if self.warmup:
                self.search.warmup()
        except Exception as error:
            self.startup_failed = True
            print("[browser-search] warmup_failed error_type=%s" % type(error).__name__, flush=True)
            self.ready.set()
            return
        self.ready.set()
        if self.warmup:
            print("[browser-search] ready (Chromium warmed; bounded queue; anonymous contexts)", flush=True)
        while True:
            payload, deadline, box = self.q.get()
            try:
                if not box["cancelled"] and time.monotonic() < deadline:
                    progress = box.get("progress")
                    if progress:
                        progress.set("running")
                    box["result"] = self.search.search(payload, deadline, progress)
            except Exception as e:
                print("[browser-search] worker_error_type=%s" % type(e).__name__, flush=True)
                box["error"] = True
            finally:
                box["done"].set()
                self.q.task_done()

    def call(self, payload, seconds):
        if self.startup_failed:
            raise WorkerError("browser_search_failed")
        if self.warmup and not self.ready.is_set():
            raise WorkerNotReady("browser_search_warming")
        box = dict(done=threading.Event(), cancelled=False, result=None, progress=Progress())
        self.q.put_nowait((payload, time.monotonic() + seconds, box))
        if not box["done"].wait(seconds):
            box["cancelled"] = True
            progress = box["progress"].snapshot()
            print("[browser-search] request_timeout stage=%s engine=%s elapsed_ms=%d" % (progress["stage"], progress["engine"], progress["elapsedMs"]), flush=True)
            raise WorkerTimeout(box["progress"])
        if box.get("error"):
            raise WorkerError("browser_search_failed")
        if box["result"] is None:
            raise WorkerTimeout(box["progress"])
        return box["result"]


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Queries and internal auth headers do not belong in access logs.

    def send(self, status, data):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path == "/health":
            worker = self.server.worker
            if worker.startup_failed:
                return self.send(503, {"status": "failed"})
            if not worker.ready.is_set():
                return self.send(503, {"status": "warming"})
        self.send(200 if self.path == "/health" else 404, {"status": "ok"} if self.path == "/health" else {"error": "not_found"})

    def do_POST(self):
        if not self.server.token:
            return self.send(503, {"error": "token_not_configured"})
        if not hmac.compare_digest(self.headers.get("Authorization", "").encode("utf-8"), ("Bearer " + self.server.token).encode("utf-8")):
            return self.send(401, {"error": "unauthorized"})
        if self.path != "/search":
            return self.send(404, {"error": "not_found"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 8192:
                return self.send(413, {"error": "invalid_body_size"})
            payload = validate(json.loads(self.rfile.read(size)))
        except (ValueError, TypeError, UnicodeError):
            return self.send(400, {"error": "invalid_search_request"})
        try:
            result = self.server.worker.call(payload, self.server.timeout_seconds)
            return self.send(200, result)
        except queue.Full:
            return self.send(429, {"error": "browser_search_busy"})
        except WorkerTimeout as e:
            return self.send(504, {"error": "browser_search_timeout", **e.progress})
        except WorkerError:
            return self.send(503, {"error": "browser_search_failed"})
        except WorkerNotReady:
            return self.send(503, {"error": "browser_search_warming"})


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("0.0.0.0", integer("PORT", 8090, 1, 65535)), Handler)
    server.token = os.environ.get("BROWSER_SEARCH_TOKEN", "")
    server.timeout_seconds = integer("BROWSER_SEARCH_TIMEOUT_SECONDS", 40, 3, 40)
    print("[browser-search] starting Chromium warmup", flush=True)
    server.worker = Worker(Search(), warmup=True)
    server.serve_forever()
