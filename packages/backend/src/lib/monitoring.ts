// Lightweight server/app resource monitoring. A background sampler computes
// rate-based metrics (CPU %, network throughput) every few seconds and caches
// a full snapshot, so the admin endpoint can return instantly.
//
// Note: the backend runs in a container, but with no cgroup limits set the
// `os` numbers reflect the HOST (total memory, load average, cores) — which is
// exactly what "server load" means here. `processRss` is this container's own
// memory. Network is read from /proc/net/dev (Linux only; skipped elsewhere).

import os from 'os'
import { readFileSync } from 'fs'
import { statfs } from 'fs/promises'
import type { PrismaClient } from '@prisma/client'
import { writeAuditLog } from './audit.js'

interface DiskInfo { path: string; totalBytes: number; freeBytes: number; usedBytes: number }

export interface MetricsSnapshot {
  ts: number
  cpu: { cores: number; usage: number; load1: number; load5: number; load15: number }
  mem: { total: number; free: number; used: number; processRss: number }
  net: { rxBytesPerSec: number; txBytesPerSec: number; available: boolean }
  disks: DiskInfo[]
  uptime: { system: number; process: number }
}

// Disks worth watching from inside the container: root overlay (system disk),
// the data mount (SSD via UPLOADS_DIR) and the backup mount (BACKUP_MOUNT).
const DISK_PATHS = ['/', '/app/uploads', '/backups']

// History: one point every HISTORY_EVERY ticks, capped at HISTORY_MAX (~1h).
export interface HistoryPoint { ts: number; cpu: number; mem: number; rx: number; tx: number }
const HISTORY_EVERY = 2   // sampler runs every 5s → a point every 10s
const HISTORY_MAX = 360   // 360 × 10s = 1 hour

export interface ActiveAlert { resource: 'cpu' | 'mem' | 'disk'; value: number; threshold: number; since: number; detail?: string }
interface Thresholds { cpu: number | null; mem: number | null; disk: number | null }

let snapshot: MetricsSnapshot | null = null
const history: HistoryPoint[] = []
const activeAlerts = new Map<string, ActiveAlert>()
let thresholds: Thresholds = { cpu: null, mem: null, disk: null }
let thresholdsLoadedAt = 0
let tick = 0
let prismaRef: PrismaClient | null = null
let prevCpu = cpuTimes()
let prevNet = readNet()
let prevTs = Date.now()

function cpuTimes(): { idle: number; total: number } {
  let idle = 0, total = 0
  for (const c of os.cpus()) {
    const t = c.times
    total += t.user + t.nice + t.sys + t.idle + t.irq
    idle += t.idle
  }
  return { idle, total }
}

function readNet(): { rx: number; tx: number } | null {
  try {
    const lines = readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)
    let rx = 0, tx = 0
    for (const line of lines) {
      const [name, rest] = line.split(':')
      if (!rest || name.trim() === 'lo') continue
      const f = rest.trim().split(/\s+/).map(Number)
      rx += f[0] || 0  // received bytes
      tx += f[8] || 0  // transmitted bytes
    }
    return { rx, tx }
  } catch {
    return null
  }
}

async function sample(): Promise<void> {
  const now = Date.now()
  const dt = Math.max(0.001, (now - prevTs) / 1000)

  const cpu = cpuTimes()
  const idleD = cpu.idle - prevCpu.idle
  const totalD = cpu.total - prevCpu.total
  const usage = totalD > 0 ? Math.max(0, Math.min(1, 1 - idleD / totalD)) : 0
  prevCpu = cpu

  const net = readNet()
  let rxRate = 0, txRate = 0
  if (net && prevNet) {
    rxRate = Math.max(0, (net.rx - prevNet.rx) / dt)
    txRate = Math.max(0, (net.tx - prevNet.tx) / dt)
  }
  prevNet = net
  prevTs = now

  const disks: DiskInfo[] = []
  const seenDev = new Set<string>()
  for (const p of DISK_PATHS) {
    try {
      const s = await statfs(p)
      const total = s.blocks * s.bsize
      const free = s.bavail * s.bsize
      // Skip duplicates (same device mounted at multiple paths).
      const key = `${total}:${free}`
      if (seenDev.has(key)) continue
      seenDev.add(key)
      disks.push({ path: p, totalBytes: total, freeBytes: free, usedBytes: total - free })
    } catch { /* path not present in this container */ }
  }

  const [load1, load5, load15] = os.loadavg()
  const total = os.totalmem()
  const free = os.freemem()
  const memPct = total > 0 ? (total - free) / total : 0
  const diskPct = disks.length ? Math.max(...disks.map((d) => d.totalBytes > 0 ? d.usedBytes / d.totalBytes : 0)) : 0
  snapshot = {
    ts: now,
    cpu: { cores: os.cpus().length, usage, load1, load5, load15 },
    mem: { total, free, used: total - free, processRss: process.memoryUsage().rss },
    net: { rxBytesPerSec: rxRate, txBytesPerSec: txRate, available: net !== null },
    disks,
    uptime: { system: os.uptime(), process: process.uptime() },
  }

  // History (coarser cadence than the live sampler).
  if (tick % HISTORY_EVERY === 0) {
    history.push({ ts: now, cpu: usage, mem: memPct, rx: rxRate, tx: txRate })
    if (history.length > HISTORY_MAX) history.shift()
  }
  tick++

  await evaluateAlerts(usage * 100, memPct * 100, diskPct * 100, disks)
}

// Re-read thresholds from the DB at most every 20s.
async function refreshThresholds(): Promise<void> {
  if (!prismaRef || Date.now() - thresholdsLoadedAt < 20_000) return
  thresholdsLoadedAt = Date.now()
  try {
    const s = await prismaRef.appSettings.findUnique({ where: { id: 'singleton' } })
    thresholds = { cpu: s?.alertCpuPct ?? null, mem: s?.alertMemPct ?? null, disk: s?.alertDiskPct ?? null }
  } catch { /* keep previous */ }
}

async function evaluateAlerts(cpuPct: number, memPct: number, diskPct: number, disks: DiskInfo[]): Promise<void> {
  await refreshThresholds()
  const worstDisk = disks.length ? disks.reduce((a, b) => (b.usedBytes / b.totalBytes > a.usedBytes / a.totalBytes ? b : a)) : null
  const checks: { res: 'cpu' | 'mem' | 'disk'; value: number; limit: number | null; detail?: string }[] = [
    { res: 'cpu', value: cpuPct, limit: thresholds.cpu },
    { res: 'mem', value: memPct, limit: thresholds.mem },
    { res: 'disk', value: diskPct, limit: thresholds.disk, detail: worstDisk?.path },
  ]
  for (const c of checks) {
    const breached = c.limit != null && c.limit > 0 && c.value >= c.limit
    const existing = activeAlerts.get(c.res)
    if (breached && !existing) {
      const alert: ActiveAlert = { resource: c.res, value: Math.round(c.value), threshold: c.limit!, since: Date.now(), detail: c.detail }
      activeAlerts.set(c.res, alert)
      if (prismaRef) writeAuditLog(prismaRef, { action: 'monitoring.alert', resourceType: 'monitoring', resourceName: c.res, userEmail: 'system', meta: { value: alert.value, threshold: alert.threshold, detail: c.detail } }).catch(() => {})
    } else if (breached && existing) {
      existing.value = Math.round(c.value) // keep latest value
    } else if (!breached && existing) {
      activeAlerts.delete(c.res)
      if (prismaRef) writeAuditLog(prismaRef, { action: 'monitoring.alert_cleared', resourceType: 'monitoring', resourceName: c.res, userEmail: 'system' }).catch(() => {})
    }
  }
}

export function startMonitoring(prisma?: PrismaClient): void {
  prismaRef = prisma ?? null
  sample().catch(() => {})
  setInterval(() => sample().catch(() => {}), 5000).unref()
}

export function getMetrics(): MetricsSnapshot | null {
  return snapshot
}

export function getHistory(): HistoryPoint[] {
  return history
}

export function getActiveAlerts(): ActiveAlert[] {
  return [...activeAlerts.values()].sort((a, b) => a.since - b.since)
}

export function getThresholds(): Thresholds {
  return thresholds
}

// Called after an admin saves new thresholds so they take effect immediately.
export function invalidateThresholds(): void {
  thresholdsLoadedAt = 0
}
