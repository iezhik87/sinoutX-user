#!/usr/bin/env python3
"""Isolated code-execution sandbox for the SinoutX agent.

Runs untrusted Python/bash submitted by the backend, in a locked-down container
(no secrets, no DB, no internet — see docker-compose `internal` network), with a
timeout and output cap. Stdlib only; no dependencies.
"""
import json
import os
import subprocess
import tempfile
import http.server
import socketserver

TOKEN = os.environ.get("EXECUTOR_TOKEN", "")
MAX_OUTPUT = 20000
MAX_TIMEOUT = 60


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/run":
            return self._send(404, {"error": "not found"})
        if TOKEN and self.headers.get("X-Executor-Token") != TOKEN:
            return self._send(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._send(400, {"error": "bad json"})

        language = data.get("language", "python")
        code = data.get("code", "")
        timeout = min(max(int(data.get("timeoutMs", 15000)) / 1000, 1), MAX_TIMEOUT)
        if not code or language not in ("python", "bash"):
            return self._send(400, {"error": "language must be python|bash and code is required"})

        cmd = ["python3", "-I", "-c", code] if language == "python" else ["bash", "-c", code]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                p = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=timeout, cwd=tmp,
                    env={"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": tmp, "LANG": "C.UTF-8"},
                )
                return self._send(200, {
                    "stdout": (p.stdout or "")[:MAX_OUTPUT],
                    "stderr": (p.stderr or "")[:MAX_OUTPUT],
                    "exitCode": p.returncode, "timedOut": False,
                })
        except subprocess.TimeoutExpired as e:
            out = e.stdout if isinstance(e.stdout, str) else ""
            return self._send(200, {"stdout": (out or "")[:MAX_OUTPUT], "stderr": "⏱ Timed out", "exitCode": -1, "timedOut": True})
        except Exception as e:
            return self._send(200, {"stdout": "", "stderr": str(e)[:500], "exitCode": -1, "timedOut": False})

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not found"})

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8088"))
    Server(("0.0.0.0", port), Handler).serve_forever()
