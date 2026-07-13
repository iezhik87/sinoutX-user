// Client for the isolated code-execution sandbox (the `executor` container).
// The backend never runs untrusted code itself — it forwards to the sandbox,
// which has no secrets/DB and no internet (see docker-compose `internal` network).
import { config } from '../config/index.js'

export interface ExecResult { stdout: string; stderr: string; exitCode: number; timedOut: boolean; error?: string }

// `net: true` routes to the internet-capable sandbox (admin-only relaxation);
// otherwise the locked, no-internet sandbox.
export async function runInSandbox(language: 'python' | 'bash', code: string, timeoutMs = 15000, net = false): Promise<ExecResult> {
  const url = net ? config.EXECUTOR_NET_URL : config.EXECUTOR_URL
  if (!url) return { stdout: '', stderr: '', exitCode: -1, timedOut: false, error: 'sandbox disabled' }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(config.EXECUTOR_TOKEN ? { 'x-executor-token': config.EXECUTOR_TOKEN } : {}) },
      body: JSON.stringify({ language, code, timeoutMs: Math.min(timeoutMs, 60000) }),
      signal: AbortSignal.timeout(Math.min(timeoutMs, 60000) + 5000),
    })
    if (!res.ok) return { stdout: '', stderr: '', exitCode: -1, timedOut: false, error: `sandbox ${res.status}` }
    return (await res.json()) as ExecResult
  } catch (e) {
    return { stdout: '', stderr: '', exitCode: -1, timedOut: false, error: e instanceof Error ? e.message : String(e) }
  }
}
