import base64
import http.server
import json
import os
import queue
import runpy
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright
import server


SCOPE = "a" * 64


def payload(**kwargs):
    return server.validate(dict(query="погода Минск & область", scope=SCOPE, language="ru", country="by", **kwargs))


class TestPolicy(unittest.TestCase):
    def test_warmup_runs_before_accepting_search_and_on_same_thread(self):
        entered, release = threading.Event(), threading.Event()
        threads = []
        class Warm:
            def warmup(self):
                threads.append(threading.get_ident())
                entered.set()
                release.wait(2)
            def search(self, *_args):
                threads.append(threading.get_ident())
                return dict(results=[])
        worker = server.Worker(Warm(), warmup=True)
        self.assertTrue(entered.wait(1))
        try:
            with self.assertRaises(server.WorkerNotReady):
                worker.call(payload(), 1)
            self.assertTrue(worker.q.empty())
        finally:
            release.set()
        self.assertTrue(worker.ready.wait(1))
        self.assertEqual(worker.call(payload(), 1), dict(results=[]))
        self.assertEqual(threads[0], threads[1])

    def test_warmup_failure_is_not_ready(self):
        class Broken:
            def warmup(self):
                raise ValueError('private details')
        worker = server.Worker(Broken(), warmup=True)
        self.assertTrue(worker.ready.wait(1))
        self.assertTrue(worker.startup_failed)
        with self.assertRaises(server.WorkerError):
            worker.call(payload(), 1)
    def test_error_codes_do_not_expose_query(self):
        self.assertEqual(server.error_code(server.PlaywrightError('Execution context was destroyed: secret query')), 'navigation_changed')
        self.assertEqual(server.error_code(server.PlaywrightError('net::ERR_CONNECTION_RESET at https://google.com/?q=secret')), 'ERR_CONNECTION_RESET')
        self.assertEqual(server.error_code(ValueError('secret')), 'internal_error')
    def test_inputs_and_destinations(self):
        for bad in ({"url": "http://localhost"}, {"limit": True}, {"limit": 11}, {"scope": "user"}, {"country": "b"}):
            data = dict(query="x", scope=SCOPE)
            data.update(bad)
            with self.assertRaises(ValueError):
                server.validate(data)
        self.assertTrue(server.allowed_resource("https://www.bing.com/search?q=x"))
        for url in ("http://www.bing.com/", "https://bing.com.evil.test/", "http://127.0.0.1/", "https://bing.com:invalid/", "https://bing.com:8080/"):
            self.assertFalse(server.allowed_resource(url))
        for url in ("javascript:alert(1)", "http://127.0.0.1/", "http://169.254.169.254/", "http://localhost/", "http://x.local/", "https://bing.com/search?q=x"):
            self.assertIsNone(server.target_url(url))
        link = "https://example.org/a?b=1"
        encoded = base64.urlsafe_b64encode(link.encode()).decode().rstrip("=")
        self.assertEqual(server.target_url("https://www.bing.com/ck/a?u=a1" + encoded), link)
        self.assertEqual(server.target_url("https://www.google.com/url?q=https%3A%2F%2Fexample.org"), "https://example.org")

    def test_cache_scope_ttl_limit_cooldown_and_spacing(self):
        now = [100.0]
        calls = []

        def sleep(seconds):
            now[0] += seconds

        def render(engine, request, _deadline):
            calls.append((engine, now[0]))
            if engine == "bing":
                return dict(status="blocked", results=[])
            return dict(status="ok", results=[dict(title=str(i), url="https://example.org/" + str(i), snippet="text") for i in range(10)])

        search = server.Search(render=render, clock=lambda: now[0], sleep=sleep)
        search.ttl = 10
        first = search.search(payload(limit=3), 200)
        self.assertEqual(len(first["results"]), 3)
        self.assertEqual(first["attempts"][0]["status"], "blocked")
        self.assertEqual(first["engine"], "google")
        self.assertEqual(len(search.search(payload(limit=10), 200)["results"]), 10)
        self.assertEqual(len(calls), 2)
        other = payload()
        other["scope"] = "b" * 64
        self.assertFalse(search.search(other, 200)["cached"])
        self.assertEqual(calls[-1][1] - calls[-2][1], search.interval)
        self.assertEqual([c[0] for c in calls].count("bing"), 1)
        now[0] += 11
        self.assertFalse(search.search(payload(), 200)["cached"])
        now[0] += 301
        search.search(dict(payload(), query="another"), now[0] + 100)
        self.assertEqual([c[0] for c in calls].count("bing"), 2)

    def test_expired_queue_work_never_navigates(self):
        class Never:
            def search(self, *_args):
                raise AssertionError("expired work must not navigate")
        worker = server.Worker(Never())
        box = dict(done=threading.Event(), cancelled=False, result=None)
        worker.q.put((payload(), time.monotonic() - 1, box))
        self.assertTrue(box["done"].wait(1))
        self.assertIsNone(box["result"])
        self.assertNotIn("error", box)

    def test_queue_is_bounded(self):
        entered, release = threading.Event(), threading.Event()

        class Blocking:
            def search(self, *_args):
                entered.set()
                release.wait(2)
                return dict(results=[])
        worker = server.Worker(Blocking())
        def box():
            return dict(done=threading.Event(), cancelled=False, result=None)
        worker.q.put((payload(), time.monotonic() + 5, box()))
        self.assertTrue(entered.wait(1))
        for _ in range(4):
            worker.q.put_nowait((payload(), 0, box()))
        try:
            with self.assertRaises(queue.Full):
                worker.call(payload(), 0.1)
        finally:
            release.set()

    def test_attempt_deadlines_leave_http_cleanup_reserve(self):
        now = [100.0]
        deadlines = []

        def render(_engine, _request, deadline):
            deadlines.append(deadline)
            # Model a navigation that uses its full allowance plus cleanup.
            now[0] = deadline + 0.05
            return dict(status="timeout", results=[])

        search = server.Search(render=render, clock=lambda: now[0])
        response = search.search(payload(), 140.0)
        self.assertEqual(len(deadlines), 3)
        self.assertEqual(deadlines[0], 122.0)
        self.assertLessEqual(max(deadlines), 138.0)
        self.assertLess(now[0], 140.0)
        self.assertFalse(response["timedOut"])
        self.assertEqual([a["status"] for a in response["attempts"]], ["timeout"] * 3)

    def test_short_request_keeps_cleanup_reserve(self):
        now = [100.0]
        def render(_engine, _request, deadline):
            now[0] = deadline + 0.05
            return dict(status='timeout', results=[])
        search = server.Search(render=render, clock=lambda: now[0])
        response = search.search(payload(), 120.0)
        self.assertEqual(len(response['attempts']), 1)
        self.assertLess(now[0], 120.0)
        self.assertTrue(response['timedOut'])

    def test_hard_timeout_includes_safe_stage(self):
        release = threading.Event()

        class Slow:
            def search(self, _payload, _deadline, progress):
                progress.set("navigating", "bing")
                release.wait(1)
                return dict(results=[])
        worker = server.Worker(Slow())
        try:
            with self.assertRaises(server.WorkerTimeout) as error:
                worker.call(payload(), 0.05)
            self.assertEqual(error.exception.progress["stage"], "navigating")
            self.assertEqual(error.exception.progress["engine"], "bing")
            self.assertNotIn(payload()["query"], json.dumps(error.exception.progress, ensure_ascii=False))
            self.assertNotIn(SCOPE, json.dumps(error.exception.progress))
        finally:
            release.set()

    def test_attempt_timeout_preserves_failure_stage(self):
        search = server.Search(engines=["bing"])
        def render(*_args):
            search._stage("navigating", "bing")
            search.failure_stage = search.stage
            search._stage("closing_context", "bing")
            raise server.PlaywrightTimeoutError("private query")
        search.render = render
        result = search.search(payload(), time.monotonic() + 20)
        self.assertEqual(result["attempts"][0]["stage"], "navigating")
        self.assertEqual(result["attempts"][0]["status"], "timeout")

    def test_worker_failure_is_not_reported_as_timeout(self):
        class Broken:
            def search(self, *_args):
                raise ValueError("private query must not be in the log")
        with self.assertRaises(server.WorkerError):
            server.Worker(Broken()).call(payload(), 1)

    def test_setup_preserves_existing_provider_keys(self):
        shell = (Path(__file__).resolve().parent.parent / 'scripts' / 'enable-browser-search.sh').read_text(encoding='utf-8')
        code = shell.split("<<'PY'\n")[1].split('\nPY\n')[0]
        with tempfile.TemporaryDirectory(prefix='sinout-search-setup-') as tmp:
            envfile = Path(tmp) / '.env'
            old = 'SEARCH_API=serper\nSEARCH_API_KEY=private-provider\nEXECUTOR_TOKEN=private-executor\nBROWSER_SEARCH_MODE=off\nBROWSER_SEARCH_TOKEN=\n'
            envfile.write_text(old, encoding='utf-8')
            first = subprocess.run([sys.executable, '-c', code, 'fallback'], cwd=tmp, text=True, capture_output=True, check=True)
            written = envfile.read_text(encoding='utf-8')
            token = next(line.split('=', 1)[1] for line in written.splitlines() if line.startswith('BROWSER_SEARCH_TOKEN='))
            self.assertEqual(len(token), 64)
            self.assertIn('SEARCH_API_KEY=private-provider', written)
            self.assertIn('EXECUTOR_TOKEN=private-executor', written)
            self.assertNotIn(token, first.stdout)
            subprocess.run([sys.executable, '-c', code, 'primary'], cwd=tmp, text=True, capture_output=True, check=True)
            after = envfile.read_text(encoding='utf-8')
            self.assertIn('BROWSER_SEARCH_MODE=primary', after)
            self.assertIn('BROWSER_SEARCH_TOKEN=' + token, after)
            quoted = "BROWSER_SEARCH_TOKEN='literal$token with spaces' # retained\n"
            envfile.write_text(quoted, encoding='utf-8')
            subprocess.run([sys.executable, '-c', code, 'fallback'], cwd=tmp, text=True, capture_output=True, check=True)
            self.assertIn(quoted, envfile.read_text(encoding='utf-8'))


class TestHTTP(unittest.TestCase):
    def test_auth_validation_and_search(self):
        search = server.Search(engines=["bing"], render=lambda *_: dict(status="ok", results=[dict(title="one", url="https://example.org", snippet="text")]))
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        srv.token, srv.worker, srv.timeout_seconds = "internal-test-token", server.Worker(search), 3
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = "http://127.0.0.1:" + str(srv.server_port)

        def post(data, token=None):
            req = urllib.request.Request(base + "/search", json.dumps(data).encode(), headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})})
            try:
                response = urllib.request.urlopen(req)
            except urllib.error.HTTPError as e:
                response = e
            with response:
                return response.status, json.load(response)
        try:
            self.assertEqual(post(payload())[0], 401)
            self.assertEqual(post(dict(payload(), url="http://localhost"), srv.token)[0], 400)
            status, response = post(payload(), srv.token)
            self.assertEqual(status, 200)
            self.assertEqual(response["engine"], "bing")
            self.assertTrue(post(payload(), srv.token)[1]["cached"])
            release = threading.Event()
            class Slow:
                def search(self, _payload, _deadline, progress):
                    progress.set("closing_context", "bing")
                    release.wait(1)
                    return dict(results=[])
            srv.worker, srv.timeout_seconds = server.Worker(Slow()), 0.05
            try:
                status, response = post(payload(), srv.token)
                self.assertEqual(status, 504)
                self.assertEqual(response["stage"], "closing_context")
                self.assertEqual(response["engine"], "bing")
                self.assertNotIn("query", response)
            finally:
                release.set()
            srv.token = ""
            self.assertEqual(post(payload(), "anything")[0], 503)
        finally:
            srv.shutdown()
            srv.server_close()


class FixtureBrowser:
    def __init__(self, browser, html, status=200):
        self.browser, self.html, self.status = browser, html, status
        self.requests = []
        self.fail_evaluation_once = False

    def is_connected(self):
        return True

    def new_context(self, **kwargs):
        ctx = self.browser.new_context(**kwargs)
        pending = []
        original_close = ctx.close
        def close():
            for route in pending:
                route.abort()
            original_close()
        ctx.close = close
        if self.fail_evaluation_once:
            original_new_page = ctx.new_page
            def new_page():
                page = original_new_page()
                original_evaluate = page.evaluate
                failed = False
                def evaluate(*args, **kwargs):
                    nonlocal failed
                    if not failed:
                        failed = True
                        raise server.PlaywrightError('Execution context was destroyed, most likely because of a navigation')
                    return original_evaluate(*args, **kwargs)
                page.evaluate = evaluate
                return page
            ctx.new_page = new_page
        def fixture(route):
            self.requests.append(route.request.url)
            if route.request.url.endswith('/slow-script.js'):
                pending.append(route)
                return  # Leave a deferred subresource pending, like a slow CDN.
            route.fulfill(status=self.status, content_type="text/html", body=self.html)
        ctx.route("**/*", fixture)
        return ctx


class TestRealBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(channel=os.environ.get("BROWSER_TEST_CHANNEL", "chromium"))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def render(self, engine, html, status=200):
        search = server.Search(engines=[engine])
        fixture = FixtureBrowser(self.browser, html, status)
        search.browser = fixture
        result = search._render(engine, payload(), time.monotonic() + 10)
        return result, fixture.requests

    def test_javascript_results_and_private_requests(self):
        html = """<ul id=b_results></ul><img src='http://127.0.0.1/private'><script>
          setTimeout(() => document.querySelector('#b_results').innerHTML = '<li class=b_algo><h2><a href="https://example.org/weather">Weather</a></h2><div class=b_caption><p>Rendered by JS</p></div></li>', 100);
        </script>"""
        result, requests = self.render("bing", html)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["results"][0]["snippet"], "Rendered by JS")
        self.assertTrue(all(url.startswith("https://www.bing.com/") for url in requests))
        self.assertIn("%D0%9C", requests[0])

    def test_results_survive_pending_deferred_resource(self):
        html = '<ul id=b_results><li class=b_algo><h2><a href="https://example.org/">Visible result</a></h2><div class=b_caption><p>Already loaded</p></div></li></ul><script defer src="https://www.bing.com/slow-script.js"></script>'
        result, _ = self.render("bing", html)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["results"][0]["title"], "Visible result")

    def test_delayed_javascript_results(self):
        html = """<ul id=b_results></ul><script>
          setTimeout(() => document.querySelector('#b_results').innerHTML = '<li class=b_algo><h2><a href="https://example.org/">Delayed result</a></h2></li>', 1800);
        </script>"""
        result, _ = self.render("bing", html)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["results"][0]["title"], "Delayed result")

    def test_bing_search_waits_past_former_engine_limit(self):
        search = server.Search(engines=['bing'])
        search.browser = FixtureBrowser(self.browser, """<ol id=b_results></ol><script>
          setTimeout(() => document.querySelector('#b_results').innerHTML = '<li class=b_algo><h2><a href="https://example.org/">Late Bing result</a></h2></li>', 7600);
        </script>""")
        result = search.search(payload(), time.monotonic() + 40)
        self.assertEqual(result['results'][0]['title'], 'Late Bing result')
        self.assertEqual(result['attempts'][0]['status'], 'ok')

    def test_transient_navigation_error_retries_extraction(self):
        search = server.Search(engines=['google'])
        fixture = FixtureBrowser(self.browser, '<main id=search><div class=MjjYud><a href="https://example.org/"><h3>One</h3></a></div></main>')
        fixture.fail_evaluation_once = True
        search.browser = fixture
        result = search.search(payload(), time.monotonic() + 10)
        self.assertEqual(result['results'][0]['title'], 'One')
        attempt = result['attempts'][0]
        self.assertEqual(attempt['navigationRetries'], 1)
        self.assertEqual(attempt['httpStatus'], 200)
        self.assertEqual(attempt['pageKind'], 'results_markup')
        self.assertEqual(attempt['visibleRows'], 1)

    def test_google_and_duckduckgo_organic_parsers(self):
        for engine, html in [
            ("google", '<main id=search><div class=MjjYud><a href="https://example.org/"><h3>One</h3></a><div class=VwiC3b>Snippet</div></div></main>'),
            ("duckduckgo", '<article data-testid=result><h2><a href="https://example.org/">One</a></h2><div data-testid=result-snippet>Snippet</div></article>'),
        ]:
            result, _ = self.render(engine, html)
            self.assertEqual(result["results"], [dict(title="One", url="https://example.org/", snippet="Snippet")])

    def test_hidden_results_are_not_used(self):
        result, _ = self.render("bing", '<ul id=b_results hidden><li class=b_algo><h2><a href="https://example.org/">Hidden result</a></h2></li></ul>')
        self.assertEqual(result["status"], "empty")

    def test_bing_css_hidden_container_uses_supplied_html(self):
        search = server.Search(engines=['bing'])
        search.browser = FixtureBrowser(self.browser, '<main style="visibility:hidden"><ol id=b_results><li class=b_algo><h2><a href="https://example.org/weather">Weather in Minsk</a></h2><div class=b_caption><p>Forecast</p></div></li><li class="b_algo b_ad"><h2><a href="https://ads.example/">Ad</a></h2></li></ol></main>')
        result = search.search(payload(), time.monotonic() + 10)
        self.assertEqual(result['results'], [dict(title='Weather in Minsk', url='https://example.org/weather', snippet='Forecast')])
        self.assertEqual(result['attempts'][0]['extractionMode'], 'html')
        self.assertEqual(result['attempts'][0]['visibleRows'], 0)
        self.assertEqual(result['attempts'][0]['htmlRows'], 1)

    def test_bing_hidden_html_does_not_override_challenge(self):
        html = '<form id=captcha-form>Verify you are human</form><ol id=b_results style="visibility:hidden"><li class=b_algo><h2><a href="https://example.org/">One</a></h2></li></ol>'
        result, _ = self.render('bing', html)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['results'], [])

    def test_probe_explains_hidden_results(self):
        probe = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts' / 'browser-search-probe.py'))
        page = self.browser.new_page()
        try:
            page.set_content('<p>Visible message</p><ul id=b_results style="display:none"><li class=b_algo><h2><a href="https://example.org/">Hidden title</a></h2></li></ul>')
            details = page.evaluate(probe['DETAILS'])
            self.assertIn('Visible message', details['visibleText'])
            self.assertNotIn('Hidden title', details['visibleText'])
            candidate = details['candidates'][0]
            self.assertEqual(candidate['rectangles'], 0)
            self.assertEqual(candidate['hiddenBy'], [{'tag': 'UL', 'reasons': ['display:none']}])
        finally:
            page.close()

    def test_captcha_and_http_block_are_not_results(self):
        result, _ = self.render("bing", '<form id=captcha-form style="height:40px">Verify you are human</form>')
        self.assertEqual(result["status"], "blocked")
        result, _ = self.render("duckduckgo", '<form id=challenge-form><p>Select the ducks</p></form>')
        self.assertEqual(result["status"], "blocked")
        result, _ = self.render("bing", "<body>Too many requests</body>", 429)
        self.assertEqual(result["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
