import { useState, useEffect, useRef, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Settings, Shield, Trash2, UserCheck, UserX, Key, Save, RefreshCw, Check, UserPlus, X, Eye, EyeOff, Copy, ClipboardList, Loader2, Database, Download, Upload, RotateCcw, Clock, Activity, Cpu, MemoryStick, Network, HardDrive, AlertTriangle, Coins } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '@/api/client'
import { ProviderConnect } from '@/components/settings/ProviderConnect'
import { useAuthStore } from '@/stores/authStore'
import { Header } from '@/components/layout/Header'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { ru, enUS, be } from 'date-fns/locale'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string
  email: string
  name: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  isActive: boolean
  isVerified: boolean
  lastLoginAt: string | null
  createdAt: string
  plan: string
  licenseExpiresAt: string | null
  workspaceCount: number
  storageLimitMb: number | null
  storageUsedBytes: number
  storageEffectiveLimitMb: number // -1 = unlimited
  capabilities?: { grant?: string[]; revoke?: string[] } | null
  balanceMicroUsd: number
}

interface UpdateUserData {
  role?: string
  isActive?: boolean
  isVerified?: boolean
  name?: string
  password?: string
  plan?: string
  licenseExpiresAt?: string | null
  storageLimitMb?: number | null
  capabilities?: { grant?: string[]; revoke?: string[] } | null
}

// Gateable capabilities + their base default (must mirror backend plans.ts).
const GATEABLE_CAPS: { cap: string; label: string }[] = [
  { cap: 'assistant_full', label: 'Полный ассистент (скилы/триггеры)' },
  { cap: 'code_exec:python', label: 'Скрипты Python (песочница)' },
  { cap: 'code_exec:bash', label: 'Bash (только self-hosted)' },
  { cap: 'code_exec:net', label: 'Интернет в скриптах (послабление)' },
  { cap: 'vault:reveal', label: 'Выдавать пароли из Сейфа (get_secret)' },
  { cap: 'managed_tokens', label: 'Биллинг токенов (cloud payg)' },
]
const BASE_CAPS = ['assistant_full']

// Effective on/off for a capability given the user's override (admin = always on).
function capOn(u: AdminUser, cap: string): boolean {
  if (u.role === 'OWNER' || u.role === 'ADMIN') return true
  const ov = u.capabilities ?? {}
  if ((ov.revoke ?? []).includes(cap)) return false
  if ((ov.grant ?? []).includes(cap)) return true
  return BASE_CAPS.includes(cap)
}
// Toggle a capability → new grant/revoke override relative to base.
function toggleCap(u: AdminUser, cap: string, on: boolean): { grant: string[]; revoke: string[] } {
  const ov = u.capabilities ?? {}
  let grant = new Set(ov.grant ?? [])
  let revoke = new Set(ov.revoke ?? [])
  grant.delete(cap); revoke.delete(cap)
  const isBase = BASE_CAPS.includes(cap)
  if (on && !isBase) grant.add(cap)
  if (!on && isBase) revoke.add(cap)
  return { grant: [...grant], revoke: [...revoke] }
}

interface AdminProject {
  id: string
  name: string
  status: string
  createdAt: string
  workspace: { id: string; name: string }
  _count: { tasks: number; pages: number }
}

interface AppSettings {
  id: string
  registrationMode: 'open' | 'invite' | 'closed'
  inviteCode: string | null
  smtpHost: string | null
  smtpPort: number | null
  smtpUser: string | null
  smtpPass: string | null
  smtpFrom: string | null
  appUrl: string | null
  /** null = follow DEPLOYMENT_MODE from the server env. */
  billingEnabled: boolean | null
  /** What the server actually does right now, whatever the row says. */
  billingEffective: boolean
}

interface AdminStats {
  users: number
  projects: number
  tasks: number
  pages: number
  version?: string
  builtAt?: string | null
}

interface MonitoringData {
  metrics: {
    ts: number
    cpu: { cores: number; usage: number; load1: number; load5: number; load15: number }
    mem: { total: number; free: number; used: number; processRss: number }
    net: { rxBytesPerSec: number; txBytesPerSec: number; available: boolean }
    disks: { path: string; totalBytes: number; freeBytes: number; usedBytes: number }[]
    uptime: { system: number; process: number }
  } | null
  history: { ts: number; cpu: number; mem: number; rx: number; tx: number }[]
  online: { id: string; name: string; email: string; role: string; via: 'jwt' | 'apikey'; lastSeen: string }[]
  onlineCount: number
  alerts: { resource: 'cpu' | 'mem' | 'disk'; value: number; threshold: number; since: number; detail?: string }[]
  thresholds: { cpu: number | null; mem: number | null; disk: number | null }
  now: string
}

type AlertThresholds = { cpu: number | null; mem: number | null; disk: number | null }

interface AdminAuditItem {
  id: string
  workspaceId: string | null
  workspaceName: string | null
  userId: string | null
  userEmail: string | null
  action: string
  resourceType: string | null
  resourceId: string | null
  resourceName: string | null
  meta: Record<string, unknown>
  ip: string | null
  createdAt: string
}

// ─── API ──────────────────────────────────────────────────────────────────────

interface ModelPrice { input: number; cachedInput: number; output: number }
interface PricingView {
  marginPercent: number
  models: Record<string, ModelPrice>
  images: Record<string, number>
  defaults: { models: Record<string, ModelPrice>; images: Record<string, number>; marginPercent: number }
}

interface ModelOpt { id: string; label: string }
type ModelsResponse = Record<string, ModelOpt[]> & {
  managed: { available: boolean; model: string; provider?: string }
  imageModels: Record<string, ModelOpt[]>
}

interface ManagedSlotView { hasKey: boolean; provider?: string; model?: string; baseUrl?: string }
interface ManagedView { ai: ManagedSlotView; image: ManagedSlotView; vision: ManagedSlotView; embeddings: ManagedSlotView }
type ManagedPatch = Partial<Record<keyof ManagedView, { provider?: string; apiKey?: string; model?: string; baseUrl?: string }>>

const adminApi = {
  getStats: () => api.get<AdminStats>('/admin/stats').then((r) => r.data),
  getManaged: () => api.get<ManagedView>('/admin/managed').then((r) => r.data),
  updateManaged: (patch: ManagedPatch) => api.patch<ManagedView>('/admin/managed', patch).then((r) => r.data),
  getModels: () => api.get<ModelsResponse>('/ai/settings/models').then((r) => r.data),
  getPricing: () => api.get<PricingView>('/admin/pricing').then((r) => r.data),
  updatePricing: (p: { marginPercent: number; models: Record<string, ModelPrice>; images: Record<string, number> }) =>
    api.patch<PricingView>('/admin/pricing', p).then((r) => r.data),
  getOpenRouterPrice: (model: string) =>
    api.get<{ price: ModelPrice; resolvedId: string }>('/admin/pricing/openrouter', { params: { model } }).then((r) => r.data),
  getOpenRouterModelList: () =>
    api.get<{ models: { id: string; label: string }[] }>('/admin/pricing/openrouter/list').then((r) => r.data.models),
  testProvider: (params: { provider: string; apiKey?: string; baseUrl?: string; model?: string }) =>
    api.post<{ ok: boolean; error?: string; message?: string; models?: ModelOpt[] }>('/ai/settings/test', params).then((r) => r.data),
  testImage: (params: { provider: string; apiKey?: string; baseUrl?: string; model?: string }) =>
    api.post<{ ok: boolean; error?: string; message?: string }>('/ai/settings/test-image', params).then((r) => r.data),
  testEmbeddings: (params: { provider: string; apiKey?: string; baseUrl?: string; model?: string }) =>
    api.post<{ ok: boolean; error?: string; message?: string }>('/ai/settings/test-embeddings', params).then((r) => r.data),
  getMonitoring: () => api.get<MonitoringData>('/admin/monitoring').then((r) => r.data),
  saveAlerts: (data: Partial<AlertThresholds>) => api.patch('/admin/monitoring/alerts', data).then((r) => r.data),
  getSettings: () => api.get<AppSettings>('/admin/settings').then((r) => r.data),
  updateSettings: (data: Partial<AppSettings>) => api.patch<AppSettings>('/admin/settings', data).then((r) => r.data),
  getUsers: () => api.get<AdminUser[]>('/admin/users').then((r) => r.data),
  createUser: (data: { email: string; name: string; password: string; role: string }) =>
    api.post<AdminUser>('/admin/users', data).then((r) => r.data),
  updateUser: (id: string, data: UpdateUserData) =>
    api.patch<AdminUser>(`/admin/users/${id}`, data).then((r) => r.data),
  adjustWallet: (id: string, amountUsd: number, note?: string) =>
    api.post<{ balanceUsd: number }>(`/admin/users/${id}/wallet`, { amountUsd, note }).then((r) => r.data),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),
  getProjects: () => api.get<AdminProject[]>('/admin/projects').then((r) => r.data),
  deleteProject: (id: string) => api.delete(`/admin/projects/${id}`),
  testEmail: (email: string) => api.post('/admin/test-email', { email }).then((r) => r.data),
  getAuditLog: (params?: { limit?: number; cursor?: string; action?: string }) =>
    api.get<{ items: AdminAuditItem[]; nextCursor: string | null; hasMore: boolean }>('/admin/audit-log', { params }).then((r) => r.data),

  // ── Backups ──
  createBackupStored: (destination: string) =>
    api.post<{ ok: boolean; name: string; destination: string; size: number; files: { total: number; included: number; skipped: number; bytes: number } }>('/admin/backup', { destination }).then((r) => r.data),
  createBackupDownload: async () => {
    const res = await api.post('/admin/backup', { destination: 'download' }, { responseType: 'blob' })
    const cd = (res.headers['content-disposition'] as string) ?? ''
    const name = cd.match(/filename="([^"]+)"/)?.[1] ?? `sinoutx-full-${new Date().toISOString().slice(0, 10)}.zip`
    triggerDownload(new Blob([res.data], { type: 'application/zip' }), name)
  },
  listBackups: () => api.get<BackupItem[]>('/admin/backups').then((r) => r.data),
  downloadBackup: async (location: string, name: string) => {
    const res = await api.get('/admin/backups/file', { params: { location, name }, responseType: 'blob' })
    triggerDownload(new Blob([res.data], { type: 'application/zip' }), name)
  },
  deleteBackup: (location: string, name: string) => api.delete('/admin/backups', { params: { location, name } }),
  restoreStored: (location: string, name: string) =>
    api.post<{ ok: boolean; stats: Record<string, number> }>('/admin/backup/restore', null, { params: { location, name } }).then((r) => r.data),
  restoreUpload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ ok: boolean; stats: Record<string, number> }>('/admin/backup/restore', fd).then((r) => r.data)
  },
  getBackupConfig: () => api.get<BackupConfig>('/admin/backup/config').then((r) => r.data),
  saveBackupConfig: (data: Partial<Pick<BackupConfig, 'schedule' | 'dir' | 'retention' | 'hour' | 'weekday'>>) =>
    api.patch('/admin/backup/config', data).then((r) => r.data),
}

interface BackupItem { location: string; name: string; size: number; createdAt: string }
interface BackupConfig {
  dirs: string[]; dirPaths: Record<string, string>
  schedule: 'off' | 'daily' | 'weekly'; dir: string | null; retention: number
  hour: number; weekday: number; lastRunAt: string | null
  serverHour: number; serverNow: string
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const ACTION_LABELS: Record<string, string> = {
  'user.login': 'Login',
  'user.login_failed': 'Login failed',
  'user.login_locked': 'Login locked',
  'user.register': 'Register',
  'user.password_changed': 'Password changed',
  'workspace.created': 'Workspace created',
  'workspace.updated': 'Workspace updated',
  'workspace.deleted': 'Workspace deleted',
  'member.added': 'Member added',
  'member.removed': 'Member removed',
  'member.role_changed': 'Role changed',
  'project.created': 'Project created',
  'project.updated': 'Project updated',
  'project.deleted': 'Project deleted',
  'ai_settings.updated': 'AI settings updated',
  'ai.write': 'Claude wrote (via MCP)',
  'backup.created': 'Backup created',
  'backup.restored': 'Backup restored',
  'admin.settings_changed': 'Admin settings changed',
  'admin.user_created': 'Admin: user created',
  'admin.user_deleted': 'Admin: user deleted',
}

// ─── Component ────────────────────────────────────────────────────────────────

type Tab = 'users' | 'monitoring' | 'usage' | 'settings' | 'licenses' | 'audit' | 'backup'

const ROLE_COLORS = { OWNER: 'text-amber-400', ADMIN: 'text-primary-400', MEMBER: 'text-slate-400' }

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('users')
  const { user: currentUser } = useAuthStore()
  const t = useT()
  const a = t.admin

  if (currentUser?.role !== 'OWNER' && currentUser?.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Shield size={48} className="mx-auto mb-3 text-slate-600" />
          <p className="text-slate-400">{a.noAccess}</p>
        </div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'users', label: a.tabs.users, icon: <Users size={16} /> },
    { id: 'monitoring', label: a.tabs.monitoring, icon: <Activity size={16} /> },
    { id: 'usage', label: a.tabs.usage, icon: <Coins size={16} /> },
    { id: 'settings', label: a.tabs.settings, icon: <Settings size={16} /> },
    { id: 'licenses', label: a.tabs.licenses, icon: <Key size={16} /> },
    { id: 'audit', label: a.tabs.audit, icon: <ClipboardList size={16} /> },
    { id: 'backup', label: a.tabs.backup, icon: <Database size={16} /> },
  ]

  return (
    <div className="flex flex-col h-full">
      <Header title={a.title} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          <StatsBar />

          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-800 mb-6 mt-6">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                  tab === t.id
                    ? 'border-primary-500 text-primary-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200',
                )}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>

          {tab === 'users' && <UsersTab currentUserId={currentUser?.id ?? ''} currentRole={currentUser?.role ?? ''} />}
          {tab === 'monitoring' && <MonitoringTab />}
          {tab === 'usage' && <UsageTab />}
          {tab === 'settings' && <SettingsTab />}
          {tab === 'licenses' && <LicensesTab />}
          {tab === 'audit' && <AuditTab />}
          {tab === 'backup' && <BackupTab />}
        </div>
      </div>
    </div>
  )
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar() {
  const { data } = useQuery({ queryKey: ['admin-stats'], queryFn: adminApi.getStats })
  const a = useT().admin
  const items = [
    { label: a.stats.users, value: data?.users ?? '—' },
    { label: a.stats.projects, value: data?.projects ?? '—' },
    { label: a.stats.tasks, value: data?.tasks ?? '—' },
    { label: a.stats.pages, value: data?.pages ?? '—' },
  ]
  const builtAt = data?.builtAt ? new Date(data.builtAt).toLocaleString() : null
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-4">
        {items.map((item) => (
          <div key={item.label} className="bg-surface-800 rounded-xl p-4 border border-slate-700">
            <p className="text-2xl font-bold text-slate-100">{item.value}</p>
            <p className="text-xs text-slate-500 mt-1">{item.label}</p>
          </div>
        ))}
      </div>
      {data?.version && (
        <div className="bg-surface-800 rounded-xl px-4 py-3 border border-slate-700 flex items-center gap-2 text-xs text-slate-400">
          <span className="font-medium text-slate-300">{a.version}:</span>
          <code className="text-primary-400">{data.version}</code>
          {builtAt && <span className="text-slate-500">· {builtAt}</span>}
        </div>
      )}
    </div>
  )
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function CreateUserModal({ onClose, currentRole }: { onClose: () => void; currentRole: string }) {
  const qc = useQueryClient()
  const t = useT()
  const u = t.admin.users
  const passwordTooShort = t.settings.security.tooShort
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'MEMBER' })
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const mutation = useMutation({
    mutationFn: () => adminApi.createUser(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['admin-stats'] })
      onClose()
    },
    onError: (e: any) => setError(e?.response?.data?.error ?? u.errorDefault),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-900 border border-slate-700 rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-slate-100">{u.createTitle}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400"><X size={16} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">{u.name}</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={u.namePlaceholder}
              className="w-full bg-surface-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-primary-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">{u.email}</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="user@example.com"
              className="w-full bg-surface-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-primary-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">{u.password}</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={u.passwordPlaceholder}
                className="w-full bg-surface-800 border border-slate-700 rounded-xl px-3 py-2 pr-9 text-sm text-slate-200 focus:outline-none focus:border-primary-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          {currentRole === 'OWNER' && (
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">{u.role}</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full bg-surface-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-primary-500"
              >
                <option value="MEMBER">{u.roles.MEMBER}</option>
                <option value="ADMIN">{u.roles.ADMIN}</option>
                <option value="OWNER">{u.roles.OWNER}</option>
              </select>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 btn btn-ghost text-sm py-2">{u.cancel}</button>
            <button
              onClick={() => {
                if (form.password.length < 8) { setError(passwordTooShort); return }
                mutation.mutate()
              }}
              disabled={mutation.isPending || !form.email || !form.name || !form.password}
              className="flex-1 btn btn-primary text-sm py-2 flex items-center justify-center gap-2"
            >
              {mutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <UserPlus size={14} />}
              {u.createBtn}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-slate-700 text-slate-300',
  pro: 'bg-primary-600/20 text-primary-300 border border-primary-500/30',
  team: 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30',
}

function UsersTab({ currentUserId, currentRole }: { currentUserId: string; currentRole: string }) {
  const qc = useQueryClient()
  const u = useT().admin.users
  const { language } = useLanguageStore()
  const dateLocale = language === 'en' ? enUS : language === 'be' ? be : ru
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [query, setQuery] = useState('')
  const { data: users = [], isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: adminApi.getUsers })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserData }) => adminApi.updateUser(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: adminApi.deleteUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['admin-stats'] })
    },
  })

  if (isLoading) return <div className="flex justify-center py-12"><RefreshCw className="animate-spin text-slate-500" /></div>

  const q = query.trim().toLowerCase()
  const filtered = q ? users.filter((x) => x.name.toLowerCase().includes(q) || x.email.toLowerCase().includes(q)) : users

  return (
    <>
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} currentRole={currentRole} />}
      {editing && <EditUserModal user={editing} currentRole={currentRole} onClose={() => setEditing(null)} />}

      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="relative flex-1 max-w-xs">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={u.searchPlaceholder}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-3 pr-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-primary-500"
          />
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary flex items-center gap-2 text-sm px-3 py-1.5">
          <UserPlus size={15} /> {u.addBtn}
        </button>
      </div>

      <div className="space-y-2">
        {filtered.map((user) => (
          <div key={user.id} className="bg-surface-800 rounded-xl border border-slate-700 p-4 flex items-center gap-4">
            <div className="w-9 h-9 rounded-full bg-primary-600/20 flex items-center justify-center text-sm font-medium text-primary-400 flex-shrink-0">
              {user.name[0]?.toUpperCase()}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-slate-100 truncate">{user.name}</span>
                <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase', PLAN_COLORS[user.plan] ?? PLAN_COLORS.free)}>{user.plan}</span>
                {!user.isActive && <span className="text-xs bg-red-900/40 text-red-400 px-1.5 py-0.5 rounded">{u.inactive}</span>}
                {!user.isVerified && <span className="text-xs bg-amber-900/40 text-amber-400 px-1.5 py-0.5 rounded">{u.unverified}</span>}
                {user.id === currentUserId && <span className="text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">{u.you}</span>}
              </div>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                <span className="text-xs text-slate-500">{user.email}</span>
                <span className={cn('text-xs font-medium', ROLE_COLORS[user.role])}>{u.roles[user.role]}</span>
                <span className="text-xs text-slate-600">{u.workspaces}: {user.workspaceCount}</span>
                {user.lastLoginAt
                  ? <span className="text-xs text-slate-600">{u.wasOnline} {formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true, locale: dateLocale })}</span>
                  : <span className="text-xs text-slate-700">{u.neverLoggedIn}</span>}
              </div>
            </div>

            {(() => {
              const usedB = user.storageUsedBytes
              const unlimited = user.storageEffectiveLimitMb < 0
              const limB = unlimited ? 0 : user.storageEffectiveLimitMb * 1024 * 1024
              const pct = unlimited || limB === 0 ? 0 : Math.min(100, Math.round((usedB / limB) * 100))
              const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
              const limTxt = unlimited ? '∞' : user.storageEffectiveLimitMb >= 1024 ? `${(user.storageEffectiveLimitMb / 1024).toFixed(0)} GB` : `${user.storageEffectiveLimitMb} MB`
              return (
                <div className="hidden sm:block w-32 flex-shrink-0" title={`${u.storage}: ${fmtBytes(usedB)} / ${limTxt}${user.storageLimitMb != null ? ` (${u.customLimit})` : ''}`}>
                  <div className="text-[11px] text-slate-400 mb-1 text-right tabular-nums">
                    {fmtBytes(usedB)} <span className="text-slate-600">/ {limTxt}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
                    {!unlimited && <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />}
                  </div>
                </div>
              )
            })()}

            <div className="flex items-center gap-1 flex-shrink-0">
              {user.id !== currentUserId && (
                <button
                  onClick={() => updateMutation.mutate({ id: user.id, data: { isActive: !user.isActive } })}
                  className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                  title={user.isActive ? u.deactivate : u.activate}
                >
                  {user.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                </button>
              )}
              <button
                onClick={() => setEditing(user)}
                className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                title={u.edit}
              >
                <Settings size={15} />
              </button>
              {currentRole === 'OWNER' && user.id !== currentUserId && (
                <button
                  onClick={() => { if (confirm(`${u.deleteConfirm} ${user.name}?`)) deleteMutation.mutate(user.id) }}
                  className="p-1.5 rounded-lg hover:bg-red-900/30 text-slate-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center text-sm text-slate-500 py-8">{u.noneFound}</p>}
      </div>
    </>
  )
}

// ─── Edit User Modal ────────────────────────────────────────────────────────────

function EditUserModal({ user, currentRole, onClose }: { user: AdminUser; currentRole: string; onClose: () => void }) {
  const qc = useQueryClient()
  const u = useT().admin.users
  const [form, setForm] = useState({
    name: user.name,
    role: user.role as string,
    plan: user.plan,
    isActive: user.isActive,
    isVerified: user.isVerified,
    licenseExpiresAt: user.licenseExpiresAt ? user.licenseExpiresAt.slice(0, 10) : '',
    storageLimitMb: user.storageLimitMb != null ? String(user.storageLimitMb) : '',
    password: '',
  })
  const [error, setError] = useState('')
  const [adjustUsd, setAdjustUsd] = useState('')
  const [adjustNote, setAdjustNote] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [balanceUsd, setBalanceUsd] = useState(user.balanceMicroUsd / 1_000_000)

  const mutation = useMutation({
    mutationFn: (data: UpdateUserData) => adminApi.updateUser(user.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); onClose() },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error'),
  })

  async function applyAdjust() {
    const amount = parseFloat(adjustUsd.replace(',', '.'))
    if (!Number.isFinite(amount) || amount === 0) return
    setAdjusting(true); setError('')
    try {
      const r = await adminApi.adjustWallet(user.id, amount, adjustNote.trim() || undefined)
      setBalanceUsd(r.balanceUsd)
      setAdjustUsd(''); setAdjustNote('')
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error')
    } finally { setAdjusting(false) }
  }

  function save() {
    const data: UpdateUserData = {
      name: form.name,
      isActive: form.isActive,
      isVerified: form.isVerified,
      plan: form.plan,
      licenseExpiresAt: form.licenseExpiresAt ? new Date(form.licenseExpiresAt + 'T00:00:00Z').toISOString() : null,
      storageLimitMb: form.storageLimitMb.trim() === '' ? null : Math.max(0, parseInt(form.storageLimitMb, 10) || 0),
    }
    if (currentRole === 'OWNER') data.role = form.role
    if (form.password) data.password = form.password
    mutation.mutate(data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-surface-900 border border-slate-700 rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-100">{u.editTitle}: {user.email}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{u.name}</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{u.role}</label>
              <select value={form.role} disabled={currentRole !== 'OWNER'} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-200 disabled:opacity-50">
                <option value="MEMBER">{u.roles.MEMBER}</option>
                <option value="ADMIN">{u.roles.ADMIN}</option>
                <option value="OWNER">{u.roles.OWNER}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{u.plan}</label>
              <select value={form.plan} onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-200">
                <option value="free">Free</option>
                <option value="team">Team</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{u.licenseExpires}</label>
            <input type="date" value={form.licenseExpiresAt} onChange={(e) => setForm((f) => ({ ...f, licenseExpiresAt: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{u.storageLimit}</label>
            <input type="number" min={0} value={form.storageLimitMb} placeholder={u.storageLimitPlaceholder}
              onChange={(e) => setForm((f) => ({ ...f, storageLimitMb: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
            <p className="text-[11px] text-slate-500 mt-1">{u.storageLimitHint} · {u.storage}: {fmtBytes(user.storageUsedBytes)}</p>
          </div>

          {/* Wallet — applied immediately, outside the form's Save: money must not
              ride along with an unrelated field the admin also happened to edit. */}
          <div className="border-t border-slate-800 pt-3">
            <label className="block text-xs text-slate-400 mb-1">
              {u.wallet} · <span className="text-slate-300 tabular-nums">${balanceUsd.toFixed(2)}</span>
            </label>
            <div className="flex gap-2">
              <input
                type="number" step="0.01" value={adjustUsd} placeholder="±$"
                onChange={(e) => setAdjustUsd(e.target.value)}
                className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
              />
              <input
                value={adjustNote} placeholder={u.walletNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
              />
              <button onClick={applyAdjust} disabled={adjusting || !adjustUsd} className="btn-secondary text-xs px-3 disabled:opacity-40">
                {adjusting ? <Loader2 size={13} className="animate-spin" /> : u.walletApply}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">{u.walletHint}</p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> {u.active}</label>
            <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.isVerified} onChange={(e) => setForm((f) => ({ ...f, isVerified: e.target.checked }))} /> {u.verified}</label>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Возможности агента (capabilities)</label>
            {user.role === 'OWNER' || user.role === 'ADMIN'
              ? <p className="text-[11px] text-amber-400/80">Админ — все возможности всегда включены.</p>
              : <div className="space-y-1">
                  {GATEABLE_CAPS.map(({ cap, label }) => (
                    <label key={cap} className="flex items-center gap-2 text-xs text-slate-300">
                      <input type="checkbox" checked={capOn(user, cap)}
                        onChange={(e) => mutation.mutate({ capabilities: toggleCap(user, cap, e.target.checked) })} />
                      <span>{label}</span>
                      <code className="text-[10px] text-slate-600">{cap}</code>
                    </label>
                  ))}
                </div>}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{u.resetPassword}</label>
            <input type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder={u.resetPasswordHint} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-ghost text-sm px-3 py-1.5">{u.cancel}</button>
          <button onClick={save} disabled={mutation.isPending} className="btn-primary text-sm px-3 py-1.5">
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : u.save}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

/**
 * Prices, editable. Provider prices move faster than deploys, and a wrong price
 * is worse than none: it charges the user a number that never existed.
 *
 * What is saved are OVERRIDES. Anything left at its shipped value is not stored,
 * so tomorrow's default reaches an instance that never touched the table.
 */
function PricingCard() {
  const qc = useQueryClient()
  const pr = useT().admin.pricing
  const { data } = useQuery({ queryKey: ['admin-pricing'], queryFn: adminApi.getPricing })
  // Fetched once and cached — backs the "add a model" picker below so an id is
  // CHOSEN from the real OpenRouter catalog, not typed (a typo there is a
  // silently-unpriced model, never an error anyone sees).
  const { data: orModels } = useQuery({ queryKey: ['openrouter-model-list'], queryFn: adminApi.getOpenRouterModelList, staleTime: 5 * 60 * 1000 })
  const [draft, setDraft] = useState<PricingView | null>(null)
  const [saved, setSaved] = useState(false)
  const [newModel, setNewModel] = useState('')
  const [newImage, setNewImage] = useState('')
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  // name -> the OpenRouter id the price actually came from, when it differs
  // from the row's own name (e.g. row "deepseek-v4-pro" resolves via
  // "deepseek/deepseek-v4-pro") — shown so the substitution is never silent.
  const [resolvedVia, setResolvedVia] = useState<Record<string, string>>({})

  const mutation = useMutation({
    // Store only what differs from the shipped defaults. Persisting the whole
    // table would freeze today's prices forever: tomorrow's default would never
    // reach an instance that merely opened this screen once.
    mutationFn: () => {
      const d = data!.defaults
      const models = Object.fromEntries(Object.entries(view.models).filter(([k, v]) => {
        const def = d.models[k]
        return !def || def.input !== v.input || def.cachedInput !== v.cachedInput || def.output !== v.output
      }))
      const images = Object.fromEntries(Object.entries(view.images).filter(([k, v]) => d.images[k] !== v))
      return adminApi.updatePricing({ marginPercent: view.marginPercent, models, images })
    },
    onSuccess: (fresh) => {
      qc.setQueryData(['admin-pricing'], fresh)
      setDraft(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  if (!data) return null
  const view = draft ?? data
  const dirty = draft !== null

  const edit = (fn: (v: PricingView) => PricingView) => setDraft(fn(view))
  const num = (v: string) => Math.max(0, parseFloat(v.replace(',', '.')) || 0)

  // Pull today's real price for one model from OpenRouter — fills the row, does
  // NOT save. The admin still reviews and hits the main Save button below, same
  // as any other edit here.
  const refreshFromOpenRouter = async (name: string) => {
    setRefreshingId(name)
    setRefreshError(null)
    try {
      const { price, resolvedId } = await adminApi.getOpenRouterPrice(name)
      edit((v) => ({ ...v, models: { ...v.models, [name]: price } }))
      setResolvedVia((v) => (resolvedId !== name ? { ...v, [name]: resolvedId } : v))
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setRefreshError(msg || `Не удалось получить цену для ${name}`)
    } finally {
      setRefreshingId(null)
    }
  }

  const isDefault = (name: string) => {
    const d = data.defaults.models[name]
    const c = view.models[name]
    return !!d && !!c && d.input === c.input && d.cachedInput === c.cachedInput && d.output === c.output
  }

  const priceInput = (value: number, onChange: (n: number) => void) => (
    <input
      type="number" step="0.001" min={0} value={value}
      onChange={(e) => onChange(num(e.target.value))}
      className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-mono tabular-nums"
    />
  )

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-slate-300">{pr.title}</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-lg">{pr.subtitle}</p>
      </div>

      {/* Margin */}
      <div className="bg-surface-800 border border-slate-700 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-200">{pr.margin}</span>
        <input
          type="number" min={0} max={1000} value={view.marginPercent}
          onChange={(e) => edit((v) => ({ ...v, marginPercent: num(e.target.value) }))}
          className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 tabular-nums"
        />
        <span className="text-sm text-slate-400">%</span>
        <span className="text-[11px] text-slate-500 flex-1 min-w-[200px]">{pr.marginHint}</span>
      </div>

      {/* Token models */}
      <div className="bg-surface-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-200">{pr.tokenModels}</span>
          <span className="text-[11px] text-slate-500">{pr.perMillion}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left font-medium pb-1.5">{pr.model}</th>
                <th className="text-right font-medium pb-1.5 px-2">{pr.input}</th>
                <th className="text-right font-medium pb-1.5 px-2">{pr.cached}</th>
                <th className="text-right font-medium pb-1.5 px-2">{pr.output}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {Object.entries(view.models).map(([name, price]) => (
                <tr key={name} className="border-t border-slate-800/70">
                  <td className="py-1.5 pr-2 font-mono text-slate-300">
                    {name}
                    {!isDefault(name) && <span className="ml-2 text-[10px] text-primary-400">{pr.custom}</span>}
                    {/* The refresh below can pull a bare id's price via a resolved
                        OpenRouter equivalent (deepseek-v4-pro → deepseek/deepseek-
                        v4-pro) — say so, so the row's own name never silently
                        stops meaning what it says. */}
                    {resolvedVia[name] && (
                      <div className="text-[10px] text-slate-500 font-normal">via {resolvedVia[name]}</div>
                    )}
                  </td>
                  <td className="py-1.5 px-1 text-right">{priceInput(price.input, (n) => edit((v) => ({ ...v, models: { ...v.models, [name]: { ...price, input: n } } })))}</td>
                  <td className="py-1.5 px-1 text-right">{priceInput(price.cachedInput, (n) => edit((v) => ({ ...v, models: { ...v.models, [name]: { ...price, cachedInput: n } } })))}</td>
                  <td className="py-1.5 px-1 text-right">{priceInput(price.output, (n) => edit((v) => ({ ...v, models: { ...v.models, [name]: { ...price, output: n } } })))}</td>
                  <td className="py-1.5 pl-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Shown for every row now — the backend resolves bare ids
                          (no "/") via a suffix match against the OpenRouter
                          catalog, so this works uniformly, not just for ids
                          already shaped like "provider/model". */}
                      <button
                        onClick={() => refreshFromOpenRouter(name)}
                        disabled={refreshingId === name}
                        className="text-slate-600 hover:text-primary-400 disabled:opacity-50"
                        title={pr.refreshFromOpenRouter}
                      >
                        <RefreshCw size={12} className={refreshingId === name ? 'animate-spin' : ''} />
                      </button>
                      {/* A shipped model cannot be deleted — only overridden. The row
                          would come back on reload and the button would be a lie. */}
                      {!data.defaults.models[name] && (
                        <button
                          onClick={() => edit((v) => { const m = { ...v.models }; delete m[name]; return { ...v, models: m } })}
                          className="text-slate-600 hover:text-red-400"
                          title={pr.remove}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {refreshError && <p className="text-[11px] text-red-400">{refreshError}</p>}

        <div className="flex gap-2">
          <input
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder={pr.addModel}
            list="or-model-options"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
          />
          {/* Picked from the live OpenRouter catalog — typing still works (the
              list only suggests), but a chosen id is a real one, not a guess. */}
          <datalist id="or-model-options">
            {(orModels ?? []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </datalist>
          <button
            onClick={async () => {
              const id = newModel.trim()
              if (!id || view.models[id]) return
              setNewModel('')
              // Seed the row with a live price when the id resolves (exact or via
              // the bare-id fallback) — zeros only when it truly isn't found, same
              // as any other unpriced custom row.
              const found = await adminApi.getOpenRouterPrice(id).catch(() => null)
              edit((v) => ({ ...v, models: { ...v.models, [id]: found?.price ?? { input: 0, cachedInput: 0, output: 0 } } }))
              if (found && found.resolvedId !== id) setResolvedVia((v) => ({ ...v, [id]: found.resolvedId }))
            }}
            disabled={!newModel.trim()}
            className="btn btn-ghost text-xs px-3 border border-slate-700 disabled:opacity-40"
          >
            {pr.add}
          </button>
        </div>
      </div>

      {/* Images */}
      <div className="bg-surface-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-200">{pr.imageModels}</span>
          <span className="text-[11px] text-slate-500">{pr.perImage}</span>
        </div>

        <div className="space-y-1.5">
          {Object.entries(view.images).map(([name, usd]) => (
            <div key={name} className="flex items-center gap-2">
              <span className="flex-1 font-mono text-xs text-slate-300 truncate">{name}</span>
              {priceInput(usd, (n) => edit((v) => ({ ...v, images: { ...v.images, [name]: n } })))}
              {data.defaults.images[name] === undefined ? (
                <button
                  onClick={() => edit((v) => { const im = { ...v.images }; delete im[name]; return { ...v, images: im } })}
                  className="text-slate-600 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              ) : <span className="w-3" />}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={newImage}
            onChange={(e) => setNewImage(e.target.value)}
            placeholder={pr.addImage}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
          />
          <button
            onClick={() => {
              const id = newImage.trim()
              if (!id || view.images[id] !== undefined) return
              edit((v) => ({ ...v, images: { ...v.images, [id]: 0 } }))
              setNewImage('')
            }}
            disabled={!newImage.trim()}
            className="btn btn-ghost text-xs px-3 border border-slate-700 disabled:opacity-40"
          >
            {pr.add}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !dirty}
          className="btn btn-primary text-sm px-4 py-2 disabled:opacity-40"
        >
          {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : pr.save}
        </button>
        {dirty && <button onClick={() => setDraft(null)} className="text-xs text-slate-500 hover:text-slate-300">{pr.reset}</button>}
        {saved && <span className="text-xs text-emerald-400">{pr.saved}</span>}
      </div>
    </div>
  )
}

const MANAGED_LLM_PROVIDERS = ['deepseek', 'anthropic', 'openai', 'openrouter', 'groq', 'mistral', 'google', 'xai', 'together', 'ollama', 'custom'] as const
const MANAGED_IMAGE_PROVIDERS = ['pollinations', 'openai', 'openrouter', 'flux', 'stability', 'fal', 'custom'] as const
const MANAGED_VISION_PROVIDERS = ['openrouter', 'openai', 'google', 'anthropic', 'custom'] as const
const MANAGED_EMBED_PROVIDERS = ['openai', 'openrouter', 'mistral', 'together', 'custom'] as const

// A chat /models listing has no embedding models in it, so the choice is a
// curated short list per provider. OpenRouter proxies OpenAI's — note the
// `openai/` prefix, which is why searching for the bare name there finds nothing.
const EMBED_MODELS: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: 'text-embedding-3-small', label: 'text-embedding-3-small (дёшево, 1536)' },
    { id: 'text-embedding-3-large', label: 'text-embedding-3-large (точнее, 3072)' },
    { id: 'text-embedding-ada-002', label: 'text-embedding-ada-002 (старое)' },
  ],
  openrouter: [
    { id: 'openai/text-embedding-3-small', label: 'openai/text-embedding-3-small' },
    { id: 'openai/text-embedding-3-large', label: 'openai/text-embedding-3-large' },
  ],
  mistral: [{ id: 'mistral-embed', label: 'mistral-embed' }],
  together: [
    { id: 'BAAI/bge-large-en-v1.5', label: 'BAAI/bge-large-en-v1.5' },
    { id: 'BAAI/bge-base-en-v1.5', label: 'BAAI/bge-base-en-v1.5' },
  ],
  custom: [],
}
const KEYLESS = new Set(['pollinations', 'ollama'])

/**
 * The keys the INSTANCE pays with, each configured through the same Connect →
 * pick model → Save flow a user gets for his own keys. The only thing special
 * here is that the key belongs to the operator, so it is never returned — the
 * server reports whether one exists, and the field stays empty until re-entered.
 */
function ManagedKeysCard() {
  const qc = useQueryClient()
  const m = useT().admin.managed
  const { data } = useQuery({ queryKey: ['admin-managed'], queryFn: adminApi.getManaged })
  if (!data) return null

  const saveSlot = async (slot: keyof ManagedView, p: { provider: string; model: string; apiKey?: string; baseUrl?: string }) => {
    const fresh = await adminApi.updateManaged({ [slot]: { provider: p.provider, model: p.model, apiKey: p.apiKey ?? '', baseUrl: p.baseUrl ?? '' } })
    qc.setQueryData(['admin-managed'], fresh)
    qc.invalidateQueries({ queryKey: ['ai-models'] })
    // The backend may have just auto-synced this model's live price (openrouter
    // slots) — the Pricing tab's cache would otherwise show stale data until
    // some unrelated refetch happened to touch it.
    qc.invalidateQueries({ queryKey: ['admin-pricing'] })
  }
  const resetSlot = async (slot: keyof ManagedView) => {
    const fresh = await adminApi.updateManaged({ [slot]: { provider: '', model: '', apiKey: '', baseUrl: '' } })
    qc.setQueryData(['admin-managed'], fresh)
    qc.invalidateQueries({ queryKey: ['ai-models'] })
  }

  // Connect = list the provider's models. LLM/vision/embeddings all answer the
  // generic /models; images have no such list, so a static one stands in.
  const listChat = (p: { provider: string; apiKey?: string; baseUrl?: string }) => adminApi.testProvider(p)
  const listImage = async (p: { provider: string; apiKey?: string; baseUrl?: string }) => {
    const r = await adminApi.testImage(p)
    return { ok: r.ok, error: r.error }
  }
  // Verify the key with the real embeddings call, not a chat /models listing —
  // an embeddings key that cannot embed must fail here, not at first use.
  const listEmb = async (p: { provider: string; apiKey?: string; baseUrl?: string }) => {
    const r = await adminApi.testEmbeddings(p)
    return { ok: r.ok, error: r.error }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-slate-300">{m.title}</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-lg">{m.subtitle}</p>
      </div>

      <ProviderConnect title={m.slotAi} providers={MANAGED_LLM_PROVIDERS}
        current={{ hasKey: data.ai.hasKey, provider: data.ai.provider, model: data.ai.model, baseUrl: data.ai.baseUrl }}
        keyless={(p) => KEYLESS.has(p)} listModels={listChat}
        save={(x) => saveSlot('ai', x)} reset={() => resetSlot('ai')} />

      <ProviderConnect title={m.slotVision} providers={MANAGED_VISION_PROVIDERS}
        current={{ hasKey: data.vision.hasKey, provider: data.vision.provider, model: data.vision.model, baseUrl: data.vision.baseUrl }}
        listModels={listChat}
        save={(x) => saveSlot('vision', x)} reset={() => resetSlot('vision')} />

      <ProviderConnect title={m.slotImage} providers={MANAGED_IMAGE_PROVIDERS}
        current={{ hasKey: data.image.hasKey, provider: data.image.provider, model: data.image.model, baseUrl: data.image.baseUrl }}
        keyless={(p) => KEYLESS.has(p)} listModels={listImage}
        save={(x) => saveSlot('image', x)} reset={() => resetSlot('image')} />

      <ProviderConnect title={m.slotEmbeddings} providers={MANAGED_EMBED_PROVIDERS}
        current={{ hasKey: data.embeddings.hasKey, provider: data.embeddings.provider, model: data.embeddings.model, baseUrl: data.embeddings.baseUrl }}
        listModels={listEmb} staticModels={(pv) => EMBED_MODELS[pv] ?? []}
        save={(x) => saveSlot('embeddings', x)} reset={() => resetSlot('embeddings')} />
    </div>
  )
}

function SettingsTab() {
  const qc = useQueryClient()
  const tAdmin = useT().admin
  const r = tAdmin.registration
  const s = tAdmin.smtp
  const { data: settings, isLoading } = useQuery({ queryKey: ['admin-settings'], queryFn: adminApi.getSettings })

  // Registration
  const [mode, setMode] = useState<'open' | 'invite' | 'closed' | ''>('')
  const [inviteCode, setInviteCode] = useState<string>('')
  const [regSaved, setRegSaved] = useState(false)

  // SMTP
  const [smtp, setSmtp] = useState({ host: '', port: '', user: '', pass: '', from: '', appUrl: '' })
  const [smtpSaved, setSmtpSaved] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState('')

  const currentMode = mode || settings?.registrationMode || 'invite'
  const currentCode = inviteCode !== '' ? inviteCode : (settings?.inviteCode ?? '')

  // Sync SMTP from server once loaded
  const smtpLoaded = !!settings && (smtp.host !== '' || !settings.smtpHost)
  if (settings && !smtpLoaded) {
    setSmtp({
      host: settings.smtpHost ?? '',
      port: settings.smtpPort?.toString() ?? '',
      user: settings.smtpUser ?? '',
      pass: settings.smtpPass ?? '',
      from: settings.smtpFrom ?? '',
      appUrl: settings.appUrl ?? '',
    })
  }

  // useT() is a hook: it must run on every render, not after the loading guard.
  const b = useT().admin.billing
  const [billingSaved, setBillingSaved] = useState(false)
  const billingMutation = useMutation({
    mutationFn: (enabled: boolean) => adminApi.updateSettings({ billingEnabled: enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
      setBillingSaved(true)
      setTimeout(() => setBillingSaved(false), 2000)
    },
  })

  const regMutation = useMutation({
    mutationFn: () => adminApi.updateSettings({
      registrationMode: currentMode as 'open' | 'invite' | 'closed',
      inviteCode: currentMode === 'invite' ? (currentCode || null) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
      setRegSaved(true)
      setTimeout(() => setRegSaved(false), 2000)
    },
  })

  const smtpMutation = useMutation({
    mutationFn: () => adminApi.updateSettings({
      smtpHost: smtp.host || null,
      smtpPort: smtp.port ? parseInt(smtp.port) : null,
      smtpUser: smtp.user || null,
      smtpPass: smtp.pass || null,
      smtpFrom: smtp.from || null,
      appUrl: smtp.appUrl || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
      setSmtpSaved(true)
      setTimeout(() => setSmtpSaved(false), 2000)
    },
  })

  async function handleTestEmail() {
    if (!testEmail) return
    setTestStatus('sending')
    setTestError('')
    try {
      await adminApi.testEmail(testEmail)
      setTestStatus('ok')
      setTimeout(() => setTestStatus('idle'), 3000)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? s.testError
      setTestError(msg)
      setTestStatus('error')
    }
  }

  if (isLoading) return <div className="flex justify-center py-12"><RefreshCw className="animate-spin text-slate-500" /></div>

  const modes = [
    { value: 'open',   label: r.open,   desc: r.openDesc },
    { value: 'invite', label: r.invite, desc: r.inviteDesc },
    { value: 'closed', label: r.closed, desc: r.closedDesc },
  ] as const

  const smtpConfigured = !!(settings?.smtpHost && settings?.smtpUser && settings?.smtpPass)

  const inputCls = 'w-full bg-surface-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-primary-500 font-mono'

  return (
    <div className="max-w-lg space-y-8">
      {/* Billing switch — the single answer to «does this instance charge people».
          Whoever owns the instance is never billed either way. */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-slate-300">{b.title}</h3>
        <label className="flex items-start gap-3 p-4 bg-surface-800 border border-slate-700 rounded-xl cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings?.billingEffective ?? false}
            onChange={(e) => billingMutation.mutate(e.target.checked)}
            disabled={billingMutation.isPending}
          />
          <span>
            <span className="block text-sm text-slate-200">{b.enable}</span>
            <span className="block text-xs text-slate-500 mt-1">{b.hint}</span>
          </span>
        </label>
        {billingSaved && <p className="text-xs text-emerald-400">{b.saved}</p>}
      </div>

      <ManagedKeysCard />

      <PricingCard />

      {/* Registration */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-slate-300">{r.modeTitle}</h3>
        <div className="space-y-2">
          {modes.map((m) => (
            <label
              key={m.value}
              className={cn(
                'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors',
                currentMode === m.value
                  ? 'border-primary-500 bg-primary-600/10'
                  : 'border-slate-700 bg-surface-800 hover:border-slate-600',
              )}
            >
              <input type="radio" name="regMode" value={m.value} checked={currentMode === m.value}
                onChange={() => setMode(m.value)} className="mt-0.5 accent-primary-500" />
              <div>
                <p className="text-sm font-medium text-slate-200">{m.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{m.desc}</p>
              </div>
            </label>
          ))}
        </div>

        {currentMode === 'invite' && (
          <div>
            <label className="text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
              <Key size={14} /> {r.inviteCodeLabel}
            </label>
            <input type="text" value={currentCode} onChange={(e) => setInviteCode(e.target.value)}
              placeholder={r.inviteCodeLabel + '...'} className={inputCls} />
            <p className="text-xs text-slate-500 mt-1.5">{r.inviteCodeHint}</p>
          </div>
        )}

        <button onClick={() => regMutation.mutate()} disabled={regMutation.isPending}
          className="flex items-center gap-2 btn btn-primary px-4 py-2 text-sm">
          {regSaved ? <Check size={15} /> : regMutation.isPending ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
          {regSaved ? r.saved : r.save}
        </button>
      </div>

      {/* SMTP */}
      <div className="space-y-4 pt-6 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-slate-300">{s.title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{s.desc}</p>
          </div>
          <span className={cn('text-xs px-2 py-1 rounded-full', smtpConfigured ? 'bg-green-500/10 text-green-400' : 'bg-slate-700 text-slate-500')}>
            {smtpConfigured ? s.configured : s.notConfigured.split('—')[0].trim()}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{s.host}</label>
            <input type="text" value={smtp.host} onChange={(e) => setSmtp((v) => ({ ...v, host: e.target.value }))}
              placeholder="smtp.gmail.com" className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{s.port}</label>
            <input type="number" value={smtp.port} onChange={(e) => setSmtp((v) => ({ ...v, port: e.target.value }))}
              placeholder="587" className={inputCls} />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">{s.user}</label>
          <input type="text" value={smtp.user} onChange={(e) => setSmtp((v) => ({ ...v, user: e.target.value }))}
            placeholder="user@gmail.com" className={inputCls} />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">{s.pass}</label>
          <div className="relative">
            <input type={showPass ? 'text' : 'password'} value={smtp.pass}
              onChange={(e) => setSmtp((v) => ({ ...v, pass: e.target.value }))}
              placeholder="••••••••" className={inputCls + ' pr-10'} />
            <button type="button" onClick={() => setShowPass((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">{s.from}</label>
          <input type="text" value={smtp.from} onChange={(e) => setSmtp((v) => ({ ...v, from: e.target.value }))}
            placeholder="SinoutX <noreply@example.com>" className={inputCls} />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">{s.appUrl}</label>
          <input type="url" value={smtp.appUrl} onChange={(e) => setSmtp((v) => ({ ...v, appUrl: e.target.value }))}
            placeholder="https://sinout.example.com" className={inputCls} />
          <p className="text-xs text-slate-500 mt-1">{s.appUrlHint}</p>
        </div>

        <button onClick={() => smtpMutation.mutate()} disabled={smtpMutation.isPending}
          className="flex items-center gap-2 btn btn-primary px-4 py-2 text-sm">
          {smtpSaved ? <Check size={15} /> : smtpMutation.isPending ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
          {smtpSaved ? s.saved : s.save}
        </button>

        {smtpConfigured && (
          <div className="pt-4 border-t border-slate-800">
            <p className="text-xs text-slate-400 mb-2">{s.testEmail}</p>
            <div className="flex gap-2">
              <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
                placeholder="you@example.com" className={inputCls} />
              <button onClick={handleTestEmail} disabled={testStatus === 'sending' || !testEmail}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-sm whitespace-nowrap transition-colors disabled:opacity-50">
                {testStatus === 'sending' ? <RefreshCw size={13} className="animate-spin" /> : null}
                {s.testBtn}
              </button>
            </div>
            {testStatus === 'ok' && <p className="text-xs text-green-400 mt-1.5">{s.testSuccess}</p>}
            {testStatus === 'error' && <p className="text-xs text-red-400 mt-1.5">{testError || s.testError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Projects Tab ─────────────────────────────────────────────────────────────

// ─── Licenses Tab ─────────────────────────────────────────────────────────────

interface LicenseKey {
  id: string; key: string; plan: string; email: string | null; note: string | null
  expiresAt: string | null; activatedAt: string | null; activatedBy: string | null
  isActive: boolean; createdAt: string
}

function LicensesTab() {
  const t = useT()
  const tAdmin = t.admin
  const l = tAdmin.licenses
  const deleteConfirm = t.auth.deleteConfirm

  const { data: keys = [], refetch } = useQuery<LicenseKey[]>({
    queryKey: ['admin-license-keys'],
    queryFn: () => api.get('/admin/license-keys').then((r) => r.data),
  })

  const [form, setForm] = useState({ plan: 'team', email: '', note: '', expiresAt: '', count: '1' })
  const [copied, setCopied] = useState<string | null>(null)

  const generateMutation = useMutation({
    mutationFn: () => api.post('/admin/license-keys', {
      plan: form.plan,
      email: form.email || undefined,
      note: form.note || undefined,
      expiresAt: form.expiresAt || undefined,
      count: parseInt(form.count) || 1,
    }),
    onSuccess: () => { refetch(); setForm({ plan: 'team', email: '', note: '', expiresAt: '', count: '1' }) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/license-keys/${id}`),
    onSuccess: () => refetch(),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/admin/license-keys/${id}`, { isActive }),
    onSuccess: () => refetch(),
  })

  function copyKey(key: string) {
    navigator.clipboard.writeText(key)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const inputCls = 'bg-surface-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-primary-500'

  return (
    <div className="space-y-8">
      {/* Generate Keys */}
      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-4">{l.generate}</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{l.plan}</label>
            <select value={form.plan} onChange={(e) => setForm((v) => ({ ...v, plan: e.target.value }))}
              className={inputCls}>
              <option value="team">{l.team}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{l.count}</label>
            <input type="number" min="1" max="100" value={form.count}
              onChange={(e) => setForm((v) => ({ ...v, count: e.target.value }))}
              className={inputCls + ' w-20'} />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{l.email}</label>
            <input type="email" value={form.email} onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))}
              placeholder="optional" className={inputCls + ' w-52'} />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{l.expiresAt}</label>
            <input type="date" value={form.expiresAt} onChange={(e) => setForm((v) => ({ ...v, expiresAt: e.target.value }))}
              className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{l.note}</label>
            <input type="text" value={form.note} onChange={(e) => setForm((v) => ({ ...v, note: e.target.value }))}
              placeholder="optional" className={inputCls + ' w-40'} />
          </div>
          <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}
            className="btn btn-primary px-4 py-2 text-sm flex items-center gap-2">
            {generateMutation.isPending ? <RefreshCw size={13} className="animate-spin" /> : <Key size={13} />}
            {l.generate}
          </button>
        </div>
      </div>

      {/* Keys list */}
      <div className="space-y-2">
        {keys.length === 0 && <p className="text-sm text-slate-500">{l.noKeys}</p>}
        {keys.map((k) => (
          <div key={k.id} className={cn('flex items-center gap-3 p-3 rounded-xl border text-sm',
            k.isActive ? 'border-slate-700 bg-surface-800' : 'border-slate-800 bg-surface-900 opacity-60')}>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-mono',
              k.plan === 'team' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-primary-500/20 text-primary-400')}>
              {k.plan.toUpperCase()}
            </span>
            <code className="flex-1 text-slate-300 text-xs font-mono tracking-wider">{k.key}</code>
            {k.email && <span className="text-slate-500 text-xs">{k.email}</span>}
            {k.activatedAt
              ? <span className="text-green-400 text-xs">{l.activated}</span>
              : <span className="text-slate-500 text-xs">{l.notActivated}</span>}
            {k.expiresAt && <span className="text-slate-500 text-xs">{new Date(k.expiresAt).toLocaleDateString()}</span>}
            <button onClick={() => copyKey(k.key)} className="text-slate-500 hover:text-slate-300 transition-colors">
              {copied === k.key ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
            </button>
            <button onClick={() => toggleMutation.mutate({ id: k.id, isActive: !k.isActive })}
              className="text-slate-500 hover:text-slate-300 transition-colors text-xs">
              {k.isActive ? l.deactivate : l.activate}
            </button>
            <button onClick={() => { if (confirm(deleteConfirm)) deleteMutation.mutate(k.id) }}
              className="text-red-400 hover:text-red-300 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

    </div>
  )
}

// ─── Audit Tab (global, admin) ──────────────────────────────────────────────────

function AuditField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cn('text-slate-200 break-all', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  )
}

function AuditTab() {
  const { language } = useLanguageStore()
  const al = useT().admin.audit
  const locale = language === 'ru' ? ru : language === 'be' ? be : enUS
  const labelFor = (action: string) => (al.actions as Record<string, string>)[action] ?? action
  const [cursor, setCursor] = useState<string | undefined>()
  const [items, setItems] = useState<AdminAuditItem[]>([])
  const [actionFilter, setActionFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const fullTime = (iso: string) => new Date(iso).toLocaleString(language === 'en' ? 'en-GB' : language === 'be' ? 'be-BY' : 'ru-RU')

  const { data, isFetching } = useQuery({
    queryKey: ['admin-audit', cursor, actionFilter],
    queryFn: () => adminApi.getAuditLog({ limit: 50, cursor, action: actionFilter || undefined }),
    placeholderData: (prev) => prev,
  })

  // Accumulate pages. Reset is done in the filter handler (NOT an effect), so a
  // remount re-applies cached data without an on-mount reset clobbering it.
  useEffect(() => {
    if (data?.items) setItems((prev) => (cursor ? [...prev, ...data.items] : data.items))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-slate-100">{al.title}</h2>
          <span className="text-xs text-slate-500">{al.rowHint}</span>
        </div>
        <select
          value={actionFilter}
          onChange={(e) => { setItems([]); setCursor(undefined); setActionFilter(e.target.value) }}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200"
        >
          <option value="">{al.allActions}</option>
          {Object.keys(ACTION_LABELS).map((act) => (
            <option key={act} value={act}>{labelFor(act)}</option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-slate-400 text-left">
              <th className="px-4 py-2.5 font-medium">{al.colAction}</th>
              <th className="px-4 py-2.5 font-medium">{al.colUser}</th>
              <th className="px-4 py-2.5 font-medium">{al.colWorkspace}</th>
              <th className="px-4 py-2.5 font-medium">{al.colResource}</th>
              <th className="px-4 py-2.5 font-medium">{al.colIp}</th>
              <th className="px-4 py-2.5 font-medium">{al.colTime}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {items.map((item) => {
              const open = expandedId === item.id
              return (
              <Fragment key={item.id}>
              <tr
                onClick={() => setExpandedId(open ? null : item.id)}
                className={cn('cursor-pointer transition-colors', open ? 'bg-slate-800/60' : 'hover:bg-slate-800/50')}
              >
                <td className="px-4 py-2.5 text-slate-200 whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span className={cn('text-slate-500 transition-transform', open && 'rotate-90')}>▸</span>
                    {labelFor(item.action)}
                    {(item.action === 'ai.write' || item.meta?.source === 'mcp') && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30">Claude</span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{item.userEmail ?? item.userId ?? '—'}</td>
                <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{item.workspaceName ?? '—'}</td>
                <td className="px-4 py-2.5 text-slate-400 max-w-[200px] truncate">{item.resourceName ?? item.resourceId ?? '—'}</td>
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap font-mono text-xs">{item.ip ?? '—'}</td>
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale })}</td>
              </tr>
              {open && (
                <tr className="bg-slate-900/40">
                  <td colSpan={6} className="px-4 py-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{al.details}</div>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                      <AuditField label={al.colAction} value={`${labelFor(item.action)}  ·  ${item.action}`} mono />
                      <AuditField label={al.exactTime} value={fullTime(item.createdAt)} />
                      <AuditField label={al.colUser} value={item.userEmail ?? '—'} />
                      <AuditField label={al.userId} value={item.userId ?? '—'} mono />
                      <AuditField label={al.colWorkspace} value={item.workspaceName ?? '—'} />
                      <AuditField label={al.workspaceId} value={item.workspaceId ?? '—'} mono />
                      <AuditField label={al.resourceType} value={item.resourceType ?? '—'} />
                      <AuditField label={al.colResource} value={item.resourceName ?? '—'} />
                      <AuditField label={al.resourceId} value={item.resourceId ?? '—'} mono />
                      <AuditField label={al.colIp} value={item.ip ?? '—'} mono />
                      <AuditField label={al.eventId} value={item.id} mono />
                    </dl>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mt-4 mb-2">{al.metaTitle}</div>
                    {item.meta && Object.keys(item.meta).length > 0 ? (
                      <pre className="text-xs text-slate-300 bg-slate-950/70 border border-slate-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(item.meta, null, 2)}</pre>
                    ) : (
                      <div className="text-xs text-slate-600 italic">{al.noMeta}</div>
                    )}
                  </td>
                </tr>
              )}
              </Fragment>
            )})}
            {items.length === 0 && !isFetching && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{al.none}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data?.hasMore && (
        <button
          onClick={() => setCursor(data.nextCursor ?? undefined)}
          disabled={isFetching}
          className="self-center px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors disabled:opacity-50"
        >
          {isFetching ? <Loader2 size={14} className="animate-spin inline mr-2" /> : null}
          {al.loadMore}
        </button>
      )}
    </div>
  )
}

// ─── Backup Tab (full-instance) ─────────────────────────────────────────────────

function BackupTab() {
  const qc = useQueryClient()
  const b = useT().admin.backup
  const { language } = useLanguageStore()
  const dateLocale = language === 'en' ? enUS : language === 'be' ? be : ru
  const [dest, setDest] = useState<string>('download')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: backups = [], isLoading } = useQuery({ queryKey: ['admin-backups'], queryFn: adminApi.listBackups })
  const { data: cfg } = useQuery({ queryKey: ['admin-backup-config'], queryFn: adminApi.getBackupConfig })
  const dirs = cfg?.dirs ?? []
  const dirPaths = cfg?.dirPaths ?? {}
  const destLabel = (d: string) => d === 'download' ? b.dest.download : d === 'minio' ? b.dest.minio : d
  const pad2 = (n: number) => String(n).padStart(2, '0')

  // Auto-backup form state (seeded from config once loaded).
  const [auto, setAuto] = useState<{ schedule: string; dir: string; retention: number; hour: number; weekday: number } | null>(null)
  const autoState = auto ?? {
    schedule: cfg?.schedule ?? 'off', dir: cfg?.dir ?? dirs[0] ?? '',
    retention: cfg?.retention ?? 7, hour: cfg?.hour ?? 3, weekday: cfg?.weekday ?? 1,
  }
  const saveAuto = useMutation({
    mutationFn: () => adminApi.saveBackupConfig({ schedule: autoState.schedule as 'off' | 'daily' | 'weekly', dir: autoState.dir || null, retention: autoState.retention, hour: autoState.hour, weekday: autoState.weekday }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-backup-config'] }); setMsg({ text: b.saved, ok: true }) },
  })

  async function create() {
    setBusy(true); setMsg(null)
    try {
      if (dest === 'download') {
        await adminApi.createBackupDownload()
        setMsg({ text: b.downloadStarted, ok: true })
      } else {
        const r = await adminApi.createBackupStored(dest)
        // Show the file tally, and flag skips loudly: an empty-of-files backup
        // is the failure mode worth catching before you need to restore.
        const f = r.files
        const filesNote = f ? ` · ${f.included}/${f.total} ${b.files} (${fmtBytes(f.bytes)})${f.skipped ? ` · ⚠ ${f.skipped} ${b.skipped}` : ''}` : ''
        setMsg({ text: `${b.saved}: ${r.name} (${fmtBytes(r.size)})${filesNote}`, ok: !f || f.skipped === 0 })
        qc.invalidateQueries({ queryKey: ['admin-backups'] })
      }
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false })
    } finally { setBusy(false) }
  }

  async function restore(location: string, name: string) {
    if (!confirm(b.restoreConfirm)) return
    setBusy(true); setMsg(null)
    try {
      const r = await adminApi.restoreStored(location, name)
      setMsg({ text: `${b.restored}: ${JSON.stringify(r.stats)}`, ok: true })
      qc.invalidateQueries()
    } catch (e) { setMsg({ text: (e as Error).message, ok: false }) } finally { setBusy(false) }
  }

  async function restoreUpload(file: File) {
    if (!confirm(b.restoreConfirm)) return
    setBusy(true); setMsg(null)
    try {
      const r = await adminApi.restoreUpload(file)
      setMsg({ text: `${b.restored}: ${JSON.stringify(r.stats)}`, ok: true })
      qc.invalidateQueries()
    } catch (e) { setMsg({ text: (e as Error).message, ok: false }) } finally { setBusy(false) }
  }

  async function del(location: string, name: string) {
    if (!confirm(`${b.deleteConfirm} ${name}?`)) return
    await adminApi.deleteBackup(location, name)
    qc.invalidateQueries({ queryKey: ['admin-backups'] })
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="bg-surface-800 rounded-xl border border-slate-700 p-5">
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{b.title}</h2>
        <p className="text-sm text-slate-400 mb-4">{b.desc}</p>

        <label className="block text-xs text-slate-400 mb-1">{b.destination}</label>
        <div className="flex gap-2 mb-1 flex-wrap">
          {['download', ...dirs, 'minio'].map((d) => (
            <button key={d} onClick={() => setDest(d)} title={dirPaths[d] || ''}
              className={cn('px-3 py-1.5 rounded-lg text-sm border transition-colors',
                dest === d ? 'border-primary-500 text-primary-300 bg-primary-600/15' : 'border-slate-700 text-slate-400 hover:text-slate-200')}>
              {destLabel(d)}
            </button>
          ))}
        </div>
        {dirPaths[dest] && <p className="text-xs text-slate-500 mb-4 font-mono">{b.pathLabel}: {dirPaths[dest]}</p>}
        {!dirPaths[dest] && <div className="mb-4" />}

        <div className="flex items-center gap-3">
          <button onClick={create} disabled={busy} className="btn-primary flex items-center gap-2 text-sm px-4 py-2 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Database size={15} />} {b.createBtn}
          </button>
          <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) restoreUpload(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-ghost flex items-center gap-2 text-sm px-3 py-2">
            <Upload size={15} /> {b.restoreFromFile}
          </button>
        </div>
        {msg && <p className={cn('text-xs mt-3', msg.ok ? 'text-emerald-400' : 'text-red-400')}>{msg.text}</p>}
      </div>

      {dirs.length > 0 && (
        <div className="bg-surface-800 rounded-xl border border-slate-700 p-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-1 flex items-center gap-2"><Clock size={15} /> {b.auto.title}</h3>
          <p className="text-xs text-slate-500 mb-3">{b.auto.hint}</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{b.auto.schedule}</label>
              <select value={autoState.schedule} onChange={(e) => setAuto({ ...autoState, schedule: e.target.value })}
                className="input w-full text-sm">
                <option value="off">{b.auto.off}</option>
                <option value="daily">{b.auto.daily}</option>
                <option value="weekly">{b.auto.weekly}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{b.auto.dir}</label>
              <select value={autoState.dir} onChange={(e) => setAuto({ ...autoState, dir: e.target.value })}
                disabled={autoState.schedule === 'off'} className="input w-full text-sm disabled:opacity-50">
                {dirs.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              {autoState.dir && dirPaths[autoState.dir] && <p className="text-[11px] text-slate-500 mt-1 font-mono truncate">{dirPaths[autoState.dir]}</p>}
            </div>
            {autoState.schedule === 'weekly' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">{b.auto.weekday}</label>
                <select value={autoState.weekday} onChange={(e) => setAuto({ ...autoState, weekday: Number(e.target.value) })}
                  className="input w-full text-sm">
                  {b.auto.weekdays.map((w, i) => <option key={i} value={i}>{w}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-slate-400 mb-1">{b.auto.hour}</label>
              <select value={autoState.hour} onChange={(e) => setAuto({ ...autoState, hour: Number(e.target.value) })}
                disabled={autoState.schedule === 'off'} className="input w-full text-sm disabled:opacity-50">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad2(h)}:00</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{b.auto.retention}</label>
              <input type="number" min={1} max={365} value={autoState.retention}
                onChange={(e) => setAuto({ ...autoState, retention: Math.max(1, Number(e.target.value) || 1) })}
                disabled={autoState.schedule === 'off'} className="input w-full text-sm disabled:opacity-50" />
            </div>
          </div>
          {autoState.schedule !== 'off' && (
            <p className="text-xs text-slate-400 mt-3">
              {autoState.schedule === 'weekly'
                ? b.auto.summaryWeekly.replace('{day}', b.auto.weekdays[autoState.weekday]).replace('{time}', `${pad2(autoState.hour)}:00`)
                : b.auto.summaryDaily.replace('{time}', `${pad2(autoState.hour)}:00`)}
              {' '}{b.auto.serverTimeNote}{cfg ? ` ${pad2(cfg.serverHour)}:00` : ''}.
            </p>
          )}
          <div className="flex items-center gap-3 mt-3">
            <button onClick={() => saveAuto.mutate()} disabled={saveAuto.isPending} className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2">
              {saveAuto.isPending && <Loader2 size={14} className="animate-spin" />} {b.auto.save}
            </button>
            {cfg?.lastRunAt && <span className="text-xs text-slate-500">{b.auto.lastRun}: {formatDistanceToNow(new Date(cfg.lastRunAt), { addSuffix: true, locale: dateLocale })}</span>}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">{b.stored}</h3>
        {isLoading ? <Loader2 className="animate-spin text-slate-500" /> : backups.length === 0 ? (
          <p className="text-sm text-slate-500">{b.none}</p>
        ) : (
          <div className="space-y-2">
            {backups.map((bk) => (
              <div key={bk.location + bk.name} className="bg-surface-800 rounded-lg border border-slate-700 p-3 flex items-center gap-3">
                <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase', bk.location === 'minio' ? 'bg-amber-600/20 text-amber-300' : 'bg-slate-700 text-slate-300')}>{destLabel(bk.location)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200 truncate">{bk.name}</p>
                  <p className="text-xs text-slate-500">{fmtBytes(bk.size)} · {formatDistanceToNow(new Date(bk.createdAt), { addSuffix: true, locale: dateLocale })}</p>
                </div>
                <button onClick={() => adminApi.downloadBackup(bk.location, bk.name)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200" title={b.download}><Download size={15} /></button>
                <button onClick={() => restore(bk.location, bk.name)} disabled={busy} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-primary-300" title={b.restore}><RotateCcw size={15} /></button>
                <button onClick={() => del(bk.location, bk.name)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-slate-500 hover:text-red-400" title={b.delete}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Monitoring ───────────────────────────────────────────────────────────────

function fmtRate(bytesPerSec: number): string {
  return `${fmtBytes(bytesPerSec)}/s`
}

function fmtUptime(sec: number, u: { d: string; h: string; m: string }): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const mn = Math.floor((sec % 3600) / 60)
  return [d ? `${d}${u.d}` : '', h ? `${h}${u.h}` : '', `${mn}${u.m}`].filter(Boolean).join(' ')
}

function UsageBar({ pct, color }: { pct: number; color?: string }) {
  const c = color ?? (pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500')
  return (
    <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
      <div className={cn('h-full rounded-full transition-all', c)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

const ALERT_LABEL: Record<'cpu' | 'mem' | 'disk', (m: { cpu: string; memory: string; disks: string }) => string> = {
  cpu: (m) => m.cpu, mem: (m) => m.memory, disk: (m) => m.disks,
}

function MetricChart({ data, series, percent }: {
  data: Record<string, number>[]
  series: { key: string; color: string; label: string }[]
  percent?: boolean
}) {
  const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <ResponsiveContainer width="100%" height={130}>
      <AreaChart data={data} margin={{ top: 5, right: 6, left: -22, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey="t" tickFormatter={fmtTime} minTickGap={48} tick={{ fontSize: 10, fill: '#64748b' }} stroke="#334155" />
        <YAxis domain={percent ? [0, 100] : [0, 'auto']} tickFormatter={(v) => percent ? `${v}` : fmtBytes(v)} tick={{ fontSize: 10, fill: '#64748b' }} stroke="#334155" width={percent ? 28 : 56} />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
          labelFormatter={(t) => fmtTime(t as number)}
          formatter={(v: number, n: string) => [percent ? `${Math.round(v)}%` : fmtRate(v), n]}
        />
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} fill={`url(#grad-${s.key})`} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

interface UsageRow {
  userId: string | null
  email: string | null
  name: string | null
  answers: number
  calls: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
  byokCostUsd: number
  chargedUsd: number
}

interface UsageData {
  days: number
  marginPercent: number
  totals: { answers: number; costUsd: number; byokCostUsd: number; chargedUsd: number }
  byUser: UsageRow[]
  models: { provider: string; model: string; answers: number; costUsd: number; priced: boolean }[]
}

// Answers cost fractions of a cent, so the usual 2-decimal money format would
// render every row as "$0.00". Four decimals until the numbers grow up.
const usd = (n: number) => '$' + (n >= 1 ? n.toFixed(2) : n.toFixed(4))
const num = (n: number) => n.toLocaleString('ru-RU')

function UsageTab() {
  const t = useT()
  const u = t.admin.usage
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<UsageData>('/admin/usage')
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-primary-500" /></div>
  if (!data || data.byUser.length === 0) {
    return <div className="text-sm text-slate-500 py-10 text-center">{u.empty}</div>
  }

  const totalIn = data.byUser.reduce((n, r) => n + r.inputTokens, 0)
  const totalCached = data.byUser.reduce((n, r) => n + r.cachedInputTokens, 0)
  const cacheShare = totalIn + totalCached > 0 ? Math.round((totalCached / (totalIn + totalCached)) * 100) : 0

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">{u.title}</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">{u.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{u.totalAnswers}</div>
          <div className="text-xl font-semibold text-slate-100 mt-1 tabular-nums">{num(data.totals.answers)}</div>
        </div>
        <div className="bg-surface-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{u.totalCost}</div>
          <div className="text-xl font-semibold text-slate-100 mt-1 tabular-nums">{usd(data.totals.costUsd)}</div>
          {data.totals.byokCostUsd > 0 && (
            <div className="text-[11px] text-slate-500 mt-1">{u.byokCost}: {usd(data.totals.byokCostUsd)}</div>
          )}
        </div>
        <div className="bg-surface-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500">{u.totalCharged} <span className="text-slate-600">· {u.margin} +{data.marginPercent}%</span></div>
          <div className="text-xl font-semibold text-primary-400 mt-1 tabular-nums">{usd(data.totals.chargedUsd)}</div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {u.cached}: <span className="text-slate-300 tabular-nums">{cacheShare}%</span> — {u.cacheHint}
      </p>

      <div className="overflow-x-auto border border-slate-800 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-surface-800 text-xs text-slate-500">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">{u.user}</th>
              <th className="text-right font-medium px-3 py-2.5">{u.answers}</th>
              <th className="text-right font-medium px-3 py-2.5">{u.calls}</th>
              <th className="text-right font-medium px-3 py-2.5">{u.input}</th>
              <th className="text-right font-medium px-3 py-2.5">{u.cached}</th>
              <th className="text-right font-medium px-3 py-2.5">{u.output}</th>
              <th className="text-right font-medium px-3 py-2.5">{u.cost}</th>
              <th className="text-right font-medium px-4 py-2.5">{u.charged}</th>
            </tr>
          </thead>
          <tbody>
            {data.byUser.map((r) => (
              <tr key={r.userId ?? 'anon'} className="border-t border-slate-800/70">
                <td className="px-4 py-2.5 text-slate-200">{r.name || r.email || '—'}</td>
                <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums">{num(r.answers)}</td>
                <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums">{num(r.calls)}</td>
                <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums">{num(r.inputTokens)}</td>
                <td className="px-3 py-2.5 text-right text-slate-500 tabular-nums">{num(r.cachedInputTokens)}</td>
                <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums">{num(r.outputTokens)}</td>
                <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums">{usd(r.costUsd)}</td>
                <td className="px-4 py-2.5 text-right text-primary-400 tabular-nums">{r.chargedUsd > 0 ? usd(r.chargedUsd) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-400 mb-2">{u.models}</h4>
        <div className="flex flex-wrap gap-2">
          {data.models.map((m) => (
            <span key={`${m.provider}:${m.model}`} className="text-xs bg-surface-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-400">
              <span className="text-slate-300">{m.model}</span> · {num(m.answers)}
              {m.priced
                ? <> · <span className="tabular-nums">{usd(m.costUsd)}</span></>
                : <span className="text-amber-500"> · {u.unpriced}</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function MonitoringTab() {
  const m = useT().admin.monitoring
  const qc = useQueryClient()
  const { language } = useLanguageStore()
  const dateLocale = language === 'en' ? enUS : language === 'be' ? be : ru
  const { data, isLoading } = useQuery({
    queryKey: ['admin-monitoring'],
    queryFn: adminApi.getMonitoring,
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  })

  const [thr, setThr] = useState<{ cpu: string; mem: string; disk: string } | null>(null)
  const thrState = thr ?? {
    cpu: data?.thresholds.cpu != null ? String(data.thresholds.cpu) : '',
    mem: data?.thresholds.mem != null ? String(data.thresholds.mem) : '',
    disk: data?.thresholds.disk != null ? String(data.thresholds.disk) : '',
  }
  const parseThr = (v: string) => v.trim() === '' ? null : Math.max(0, Math.min(100, parseInt(v, 10) || 0))
  const saveAlerts = useMutation({
    mutationFn: () => adminApi.saveAlerts({ cpu: parseThr(thrState.cpu), mem: parseThr(thrState.mem), disk: parseThr(thrState.disk) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-monitoring'] }),
  })

  if (isLoading) return <div className="flex justify-center py-12"><RefreshCw className="animate-spin text-slate-500" /></div>

  const met = data?.metrics
  const memPct = met ? Math.round((met.mem.used / met.mem.total) * 100) : 0
  const cpuPct = met ? Math.round(met.cpu.usage * 100) : 0
  const hist = (data?.history ?? []).map((p) => ({ t: p.ts, cpu: Math.round(p.cpu * 100), mem: Math.round(p.mem * 100), rx: p.rx, tx: p.tx }))

  return (
    <div className="flex flex-col gap-5">
      {/* Active alerts */}
      {(data?.alerts.length ?? 0) > 0 && (
        <div className="space-y-2">
          {data!.alerts.map((al) => (
            <div key={al.resource} className="flex items-center gap-2 bg-red-900/30 border border-red-500/40 text-red-300 rounded-lg px-3 py-2 text-sm">
              <AlertTriangle size={16} className="flex-shrink-0" />
              <span><b>{ALERT_LABEL[al.resource](m)}</b> {al.value}% ≥ {al.threshold}%{al.detail ? ` (${al.detail})` : ''} · {formatDistanceToNow(new Date(al.since), { addSuffix: true, locale: dateLocale })}</span>
            </div>
          ))}
        </div>
      )}

      {/* Resource cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU */}
        <div className="bg-surface-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2"><Cpu size={15} /> {m.cpu}</div>
          <div className="text-2xl font-semibold text-slate-100 mb-2 tabular-nums">{cpuPct}%</div>
          <UsageBar pct={cpuPct} />
          <div className="text-[11px] text-slate-500 mt-2">
            {met?.cpu.cores ?? '—'} {m.cores} · {m.load}: {met ? `${met.cpu.load1.toFixed(2)} / ${met.cpu.load5.toFixed(2)} / ${met.cpu.load15.toFixed(2)}` : '—'}
          </div>
        </div>

        {/* Memory */}
        <div className="bg-surface-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2"><MemoryStick size={15} /> {m.memory}</div>
          <div className="text-2xl font-semibold text-slate-100 mb-2 tabular-nums">{memPct}%</div>
          <UsageBar pct={memPct} />
          <div className="text-[11px] text-slate-500 mt-2">
            {met ? `${fmtBytes(met.mem.used)} / ${fmtBytes(met.mem.total)}` : '—'} · {m.appMemory}: {met ? fmtBytes(met.mem.processRss) : '—'}
          </div>
        </div>

        {/* Network */}
        <div className="bg-surface-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2"><Network size={15} /> {m.network}</div>
          {met?.net.available ? (
            <div className="space-y-1 mt-1">
              <div className="text-sm text-slate-200 tabular-nums">↓ {fmtRate(met.net.rxBytesPerSec)}</div>
              <div className="text-sm text-slate-200 tabular-nums">↑ {fmtRate(met.net.txBytesPerSec)}</div>
            </div>
          ) : <div className="text-xs text-slate-600 mt-2">{m.netUnavailable}</div>}
        </div>

        {/* Uptime */}
        <div className="bg-surface-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2"><Clock size={15} /> {m.uptime}</div>
          <div className="text-[11px] text-slate-500 mt-1 space-y-1">
            <div>{m.system}: <span className="text-slate-300">{met ? fmtUptime(met.uptime.system, m.units) : '—'}</span></div>
            <div>{m.process}: <span className="text-slate-300">{met ? fmtUptime(met.uptime.process, m.units) : '—'}</span></div>
          </div>
        </div>
      </div>

      {/* Disks */}
      {met && met.disks.length > 0 && (
        <div className="bg-surface-800 rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-3"><HardDrive size={15} /> {m.disks}</div>
          <div className="space-y-3">
            {met.disks.map((d) => {
              const pct = d.totalBytes > 0 ? Math.round((d.usedBytes / d.totalBytes) * 100) : 0
              return (
                <div key={d.path}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300 font-mono">{d.path}</span>
                    <span className="text-slate-500 tabular-nums">{fmtBytes(d.usedBytes)} / {fmtBytes(d.totalBytes)} ({pct}%)</span>
                  </div>
                  <UsageBar pct={pct} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* History charts */}
      {hist.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-surface-800 rounded-xl border border-slate-700 p-4">
            <div className="text-xs text-slate-400 mb-2">{m.cpu} · {m.historyTitle}</div>
            <MetricChart data={hist} percent series={[{ key: 'cpu', color: '#3b82f6', label: m.cpu }]} />
          </div>
          <div className="bg-surface-800 rounded-xl border border-slate-700 p-4">
            <div className="text-xs text-slate-400 mb-2">{m.memory} · {m.historyTitle}</div>
            <MetricChart data={hist} percent series={[{ key: 'mem', color: '#a855f7', label: m.memory }]} />
          </div>
          <div className="bg-surface-800 rounded-xl border border-slate-700 p-4">
            <div className="text-xs text-slate-400 mb-2">{m.network} · {m.historyTitle}</div>
            <MetricChart data={hist} series={[{ key: 'rx', color: '#10b981', label: '↓' }, { key: 'tx', color: '#f59e0b', label: '↑' }]} />
          </div>
        </div>
      )}

      {/* Alert thresholds */}
      <div className="bg-surface-800 rounded-xl border border-slate-700 p-4">
        <div className="flex items-center gap-2 text-slate-400 text-xs mb-1"><AlertTriangle size={15} /> {m.alertThresholds}</div>
        <p className="text-[11px] text-slate-500 mb-3">{m.thresholdHint}</p>
        <div className="grid grid-cols-3 gap-3">
          {([['cpu', m.cpu], ['mem', m.memory], ['disk', m.disks]] as const).map(([k, label]) => (
            <div key={k}>
              <label className="block text-xs text-slate-400 mb-1">{label} %</label>
              <input type="number" min={0} max={100} value={thrState[k]} placeholder="—"
                onChange={(e) => setThr({ ...thrState, [k]: e.target.value })}
                className="input w-full text-sm" />
            </div>
          ))}
        </div>
        <button onClick={() => saveAlerts.mutate()} disabled={saveAlerts.isPending} className="btn-primary text-sm px-3 py-1.5 mt-3 flex items-center gap-2">
          {saveAlerts.isPending && <Loader2 size={14} className="animate-spin" />} {m.save}
        </button>
      </div>

      {/* Online users */}
      <div className="bg-surface-800 rounded-xl border border-slate-700 p-4">
        <div className="flex items-center gap-2 text-slate-300 text-sm font-semibold mb-3">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          {m.online} · {data?.onlineCount ?? 0}
        </div>
        {(data?.online.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">{m.noOnline}</p>
        ) : (
          <div className="space-y-2">
            {data!.online.map((o) => (
              <div key={o.id} className="flex items-center gap-3 text-sm">
                <div className="w-7 h-7 rounded-full bg-primary-600/20 flex items-center justify-center text-xs font-medium text-primary-400 flex-shrink-0">{o.name[0]?.toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <span className="text-slate-200">{o.name}</span>
                  <span className="text-slate-500 ml-2 text-xs">{o.email}</span>
                </div>
                {o.via === 'apikey' && <span className="text-[10px] uppercase bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">API</span>}
                <span className="text-xs text-slate-500">{formatDistanceToNow(new Date(o.lastSeen), { addSuffix: true, locale: dateLocale })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
