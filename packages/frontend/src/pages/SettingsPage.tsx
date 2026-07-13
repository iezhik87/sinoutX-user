import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from '@/stores/toastStore'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ProviderConnect } from '@/components/settings/ProviderConnect'
import {
  Bot, Trash2, Download, Upload, Loader2, Plus, Check, X,
  MessageCircle, Phone, Hash, Webhook, Key, Eye, EyeOff, Copy, DatabaseBackup,
  Cpu, ToggleLeft, ToggleRight, Settings2, Search,
  Moon, Sun, Leaf, ImagePlus, Coffee, Sunrise, ShieldCheck, HelpCircle,
  FileInput, FolderOpen, ArrowRight, AlertCircle, CheckCircle2,
} from 'lucide-react'
import { integrationApi, backupApi, aiSettingsApi, searchApi, importApi, projectApi, twoFactorApi, type ImportResult, type IntegrationType, type Integration, type AIProvider, type ImageProvider, type AISettings, type AISettingsPatch, type EmbeddingProvider, type ToolMeta, walletApi, type Wallet } from '@/api/client'
import { authApi, type ApiKeyItem } from '@/api/auth'
import { CustomToolsManager } from '@/components/ai/CustomToolsManager'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useAuthStore } from '@/stores/authStore'
import { useBillingStore } from '@/stores/billingStore'
import { useLanguageStore } from '@/stores/languageStore'
import { useThemeStore } from '@/stores/themeStore'
import { useAccentStore, ACCENT_SWATCHES, ACCENT_LABELS, type AccentPreset } from '@/stores/accentStore'
import { useT } from '@/i18n/useT'
import type { Language } from '@/i18n/translations'
import { getDateLocale } from '@/i18n/dateLocale'
import { Header } from '@/components/layout/Header'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

type Tab = 'general' | 'ai' | 'integrations' | 'files' | 'apikeys' | 'backup' | 'security' | 'plan' | 'help' | 'import'

const INTEGRATION_ICONS: Record<IntegrationType, React.ReactNode> = {
  TELEGRAM: <MessageCircle size={18} />,
  VIBER: <Phone size={18} />,
  SLACK: <Hash size={18} />,
  DISCORD: <Webhook size={18} />,
  TWITTER: <Bot size={18} />,
  EMAIL: <Bot size={18} />,
  WEBHOOK: <ArrowRight size={18} />,
}

const INTEGRATION_LABELS: Record<IntegrationType, string> = {
  TELEGRAM: 'Telegram',
  VIBER: 'Viber',
  SLACK: 'Slack',
  DISCORD: 'Discord',
  TWITTER: 'Twitter/X',
  EMAIL: 'Email',
  WEBHOOK: 'Webhook / Zapier / n8n',
}


export function SettingsPage() {
  const { currentWorkspaceId } = useWorkspaceStore()
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const t = useT()
  const navigate = useNavigate()

  // Surface the NOWPayments redirect outcome (?billing=success|cancelled),
  // then strip the param so a refresh doesn't re-toast.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const billing = searchParams.get('billing')
    if (billing === 'success') toast.success(t.buy.paid)
    else if (billing === 'cancelled') toast.info(t.buy.cancelled)
    if (billing) {
      searchParams.delete('billing')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams, t])

  if (!currentWorkspaceId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-500">{t.common.selectWorkspace}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header title={t.settings.title} />

      <div className="flex-1 overflow-y-auto">
        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 border-b border-slate-800 overflow-x-auto">
          {([
            { id: 'general',      label: t.settings.tabs.general,      icon: <Settings2 size={14} /> },
            { id: 'ai',           label: t.settings.tabs.ai,           icon: <Cpu size={14} /> },
            { id: 'integrations', label: t.settings.tabs.integrations, icon: <Bot size={14} /> },
            { id: 'apikeys',      label: t.settings.tabs.apikeys,      icon: <Key size={14} /> },
            { id: 'backup',       label: t.settings.tabs.backup,       icon: <DatabaseBackup size={14} /> },
            { id: 'security',     label: t.settings.tabs.security,     icon: <ShieldCheck size={14} /> },
            { id: 'import',       label: t.settings.tabs.import,       icon: <FileInput size={14} /> },
          ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap',
                activeTab === id
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200',
              )}
            >
              {icon}
              {label}
            </button>
          ))}
          <button
            onClick={() => navigate('/help')}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-colors -mb-px whitespace-nowrap ml-auto"
          >
            <HelpCircle size={14} />
            {t.settings.tabs.help}
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'general' && (
            <GeneralTab />
          )}
          {activeTab === 'ai' && (
            <AIAssistantTab workspaceId={currentWorkspaceId} />
          )}
          {activeTab === 'integrations' && (
            <IntegrationsTab workspaceId={currentWorkspaceId} />
          )}
          {activeTab === 'apikeys' && (
            <ApiKeysTab />
          )}
          {activeTab === 'backup' && (
            <BackupTab workspaceId={currentWorkspaceId} />
          )}
          {activeTab === 'security' && (
            <SecurityTab />
          )}
          {activeTab === 'import' && (
            <ImportTab workspaceId={currentWorkspaceId} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── General Tab ──────────────────────────────────────────────────────────────

function GeneralTab() {
  const { language, setLanguage } = useLanguageStore()
  const t = useT()
  const { theme, setTheme } = useThemeStore()
  const { accent, setAccent } = useAccentStore()

  const LANG_OPTIONS: { value: Language; label: string; flag: string }[] = [
    { value: 'be', label: 'Беларуская', flag: '🇧🇾' },
    { value: 'en', label: 'English', flag: '🇬🇧' },
    { value: 'ru', label: 'Русский', flag: '🇷🇺' },
  ]

  const THEME_OPTIONS = [
    { value: 'dark' as const, label: t.sidebar.themes.dark },
    { value: 'light' as const, label: t.sidebar.themes.light },
    { value: 'glass' as const, label: t.sidebar.themes.glass },
    { value: 'hud' as const, label: t.sidebar.themes.hud },
    { value: 'latte' as const, label: t.sidebar.themes.latte },
    { value: 'dawn' as const, label: t.sidebar.themes.dawn },
  ]

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h2 className="text-base font-semibold text-slate-200 mb-1">{t.settings.general.title}</h2>
      </div>

      {/* Language */}
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium text-slate-300">{t.settings.general.language}</label>
          <p className="text-xs text-slate-500 mt-0.5">{t.settings.general.languageDesc}</p>
        </div>
        <div className="flex gap-3">
          {LANG_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setLanguage(opt.value)}
              className={cn(
                'flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium transition-all',
                language === opt.value
                  ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200',
              )}
            >
              <span className="text-lg">{opt.flag}</span>
              {opt.label}
              {language === opt.value && <Check size={14} className="text-primary-400 ml-1" />}
            </button>
          ))}
        </div>
      </div>

      {/* Theme */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-slate-300">{t.settings.general.theme}</label>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm transition-all',
                theme === opt.value
                  ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200',
              )}
            >
              {opt.value === 'dark' && <Moon size={14} />}
              {opt.value === 'light' && <Sun size={14} />}
              {opt.value === 'glass' && <Leaf size={14} />}
              {opt.value === 'hud' && <Cpu size={14} />}
              {opt.value === 'latte' && <Coffee size={14} />}
              {opt.value === 'dawn' && <Sunrise size={14} />}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accent color */}
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium text-slate-300">{t.settings.general.accentColor}</label>
          <p className="text-xs text-slate-500 mt-0.5">{t.settings.general.accentColorDesc}</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          {(Object.keys(ACCENT_SWATCHES) as AccentPreset[]).map((key) => (
            <button
              key={key}
              onClick={() => setAccent(key)}
              title={ACCENT_LABELS[key]}
              className={cn(
                'relative w-8 h-8 rounded-full transition-all duration-150',
                accent === key
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110'
                  : 'hover:scale-105 opacity-70 hover:opacity-100',
              )}
              style={{ backgroundColor: ACCENT_SWATCHES[key] }}
            >
              {accent === key && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Check size={12} className="text-white drop-shadow" />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Keyboard shortcuts moved to Help (F1) */}
      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        <HelpCircle size={14} />
        <span>{t.shortcuts.title} — {t.shortcuts.seeHelp}</span>
      </div>
    </div>
  )
}

// ─── Integrations Tab ─────────────────────────────────────────────────────────

function IntegrationsTab({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient()
  const t = useT()
  const [editingType, setEditingType] = useState<IntegrationType | null>(null)

  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ['integrations', workspaceId],
    queryFn: () => integrationApi.list(workspaceId),
  })

  const disableMutation = useMutation({
    mutationFn: (id: string) => integrationApi.disable(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', workspaceId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => integrationApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', workspaceId] }),
  })

  const existingMap = new Map<IntegrationType, Integration>(integrations.map((i: Integration) => [i.type, i]))
  // Only messengers are offered (Slack/Discord/Webhook/Zapier/n8n hidden). WhatsApp
  // was dropped — its Business API blocks free-form outbound messages outside a 24h
  // window, which kills the proactive briefs/reminders the assistant is built on.
  const allTypes: IntegrationType[] = ['TELEGRAM', 'VIBER']

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-slate-400 mb-6">
        {t.settings.integrations.description}
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={20} className="animate-spin text-primary-500" />
        </div>
      ) : (
        allTypes.map((type) => {
          const existing = existingMap.get(type)
          return (
            <IntegrationCard
              key={type}
              type={type}
              integration={existing}
              workspaceId={workspaceId}
              isEditing={editingType === type}
              onStartEdit={() => setEditingType(type)}
              onCancelEdit={() => setEditingType(null)}
              onSaved={() => {
                setEditingType(null)
                qc.invalidateQueries({ queryKey: ['integrations', workspaceId] })
              }}
              onDisable={() => existing && disableMutation.mutate(existing.id)}
              onDelete={() => existing && deleteMutation.mutate(existing.id)}
            />
          )
        })
      )}
    </div>
  )
}

const WEBHOOK_EVENTS = ['task.created', 'task.updated', 'task.deleted', 'comment.created', 'page.created', 'page.updated'] as const

function WebhookForm({
  config,
  setConfig,
}: {
  config: { url: string; secret: string; events: string[] }
  setConfig: React.Dispatch<React.SetStateAction<Record<string, string | string[]>>>
}) {
  const t = useT()
  const wh = t.settings.integrations.webhook

  function toggleEvent(evt: string) {
    setConfig((c) => {
      const events = (c.events as string[]) ?? []
      return { ...c, events: events.includes(evt) ? events.filter((e) => e !== evt) : [...events, evt] }
    })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-slate-400 mb-1 block">{wh.urlLabel}</label>
        <input
          autoFocus
          type="url"
          placeholder={wh.urlPlaceholder}
          value={config.url}
          onChange={(e) => setConfig((c) => ({ ...c, url: e.target.value }))}
          className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">{wh.secretLabel}</label>
        <input
          type="password"
          placeholder={wh.secretPlaceholder}
          value={config.secret}
          onChange={(e) => setConfig((c) => ({ ...c, secret: e.target.value }))}
          className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-2 block">{wh.eventsLabel}</label>
        <div className="grid grid-cols-2 gap-1.5">
          {WEBHOOK_EVENTS.map((evt) => (
            <label key={evt} className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={(config.events ?? []).includes(evt)}
                onChange={() => toggleEvent(evt)}
                className="w-3.5 h-3.5 rounded accent-primary-500"
              />
              <span className="text-xs text-slate-300 group-hover:text-white">{wh.events[evt]}</span>
            </label>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500">{wh.hint}</p>
    </div>
  )
}

function IntegrationCard({
  type, integration, workspaceId, isEditing,
  onStartEdit, onCancelEdit, onSaved, onDisable, onDelete,
}: {
  type: IntegrationType
  integration: Integration | undefined
  workspaceId: string
  isEditing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaved: () => void
  onDisable: () => void
  onDelete: () => void
}) {
  const qc = useQueryClient()
  const t = useT()
  const { language } = useLanguageStore()
  const tt = (en: string, ru: string, be: string) => (language === 'en' ? en : language === 'be' ? be : ru)
  const [config, setConfig] = useState<Record<string, unknown>>((): Record<string, unknown> => {
    if (type === 'TELEGRAM') return { botToken: '', dailyBrief: (integration?.config as Record<string, unknown> | undefined)?.dailyBrief ?? { enabled: false, hour: 9 } }
    if (type === 'VIBER') return { token: '' }
    if (type === 'SLACK') return { webhookUrl: '' }
    if (type === 'DISCORD') return { applicationId: '', publicKey: '' }
    if (type === 'WEBHOOK') return { url: '', secret: '', events: [] }
    return {}
  })

  const isActive = integration?.status === 'ACTIVE'

  const upsertMutation = useMutation({
    mutationFn: () => integrationApi.upsert({ workspaceId, type, config }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations', workspaceId] })
      onSaved()
    },
  })

  const webhookUrl = `${window.location.origin}/api/v1/webhooks/${type.toLowerCase()}/${workspaceId}`

  return (
    <div className={cn(
      'bg-surface-900 border rounded-xl p-4 transition-colors',
      isActive ? 'border-primary-700/50' : 'border-slate-800',
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center',
            isActive ? 'bg-primary-600/20 text-primary-400' : 'bg-slate-800 text-slate-400',
          )}>
            {INTEGRATION_ICONS[type]}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-200">{INTEGRATION_LABELS[type]}</h3>
              {isActive && (
                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-green-600/20 text-green-400 rounded-full">
                  <Check size={9} /> {t.settings.integrations.active}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{t.settings.integrations.descriptions[type]}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {!isEditing && (
            <button onClick={onStartEdit} className="btn-ghost text-xs px-2 py-1">
              {integration ? t.settings.integrations.change : <><Plus size={12} /> {t.settings.integrations.connect}</>}
            </button>
          )}
          {integration && !isEditing && (
            <>
              {isActive && (
                <button onClick={onDisable} className="btn-ghost text-xs px-2 py-1">
                  {t.settings.integrations.disconnect}
                </button>
              )}
              <button
                onClick={() => { if (confirm(t.settings.integrations.deleteConfirm)) onDelete() }}
                className="btn-ghost p-1.5 text-slate-600 hover:text-red-400"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="mt-4 space-y-3 pt-4 border-t border-slate-800">
          {type === 'TELEGRAM' && (
            <>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Bot Token</label>
                <input
                  autoFocus
                  type="password"
                  placeholder="123456:ABC-DEF..."
                  value={(config as { botToken: string }).botToken}
                  onChange={(e) => setConfig((c) => ({ ...c, botToken: e.target.value }))}
                  className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <p className="text-[11px] text-slate-500">{tt('Proactive reminders/briefs are set up as Skills — ask the assistant (e.g. "send me a morning brief at 9") and edit them in Settings → AI → Skills.', 'Проактивные напоминания/брифы заводятся как Скилы — попроси ассистента («присылай утренний бриф в 9») и редактируй их в Настройки → ИИ → Скилы.', 'Праактыўныя напаміны — гэта Скілы.')}</p>

              <p className="text-xs text-slate-500 leading-relaxed">{t.settings.integrations.telegramHint}</p>
            </>
          )}

          {type === 'VIBER' && (
            <>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Bot Token</label>
                <input
                  autoFocus
                  type="password"
                  placeholder="4c5d1a3f8e2b…"
                  value={(config as { token: string }).token}
                  onChange={(e) => setConfig((c) => ({ ...c, token: e.target.value }))}
                  className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">{t.settings.integrations.viberHint}</p>
            </>
          )}

          {type === 'SLACK' && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Webhook URL</label>
              <div className="flex items-center gap-2 bg-surface-950 border border-slate-700 rounded-md px-3 py-2">
                <code className="text-xs text-slate-400 flex-1 break-all">{webhookUrl}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(webhookUrl)}
                  className="text-xs text-primary-400 flex-shrink-0"
                >
                  {t.settings.integrations.copy}
                </button>
              </div>
              <p className="text-xs text-slate-600 mt-1">{t.settings.integrations.slackInstruction}</p>
            </div>
          )}

          {type === 'DISCORD' && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Interactions Endpoint URL</label>
              <div className="flex items-center gap-2 bg-surface-950 border border-slate-700 rounded-md px-3 py-2">
                <code className="text-xs text-slate-400 flex-1 break-all">{webhookUrl}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(webhookUrl)}
                  className="text-xs text-primary-400 flex-shrink-0"
                >
                  {t.settings.integrations.copy}
                </button>
              </div>
            </div>
          )}

          {(type === 'TWITTER' || type === 'EMAIL') && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Webhook URL</label>
              <div className="flex items-center gap-2 bg-surface-950 border border-slate-700 rounded-md px-3 py-2">
                <code className="text-xs text-slate-400 flex-1 break-all">{webhookUrl}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(webhookUrl)}
                  className="text-xs text-primary-400 flex-shrink-0"
                >
                  {t.settings.integrations.copy}
                </button>
              </div>
            </div>
          )}

          {type === 'WEBHOOK' && (
            <WebhookForm config={config as { url: string; secret: string; events: string[] }} setConfig={setConfig as React.Dispatch<React.SetStateAction<Record<string, string | string[]>>>} />
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onCancelEdit} className="btn-ghost flex items-center gap-1.5">
              <X size={13} /> {t.common.cancel}
            </button>
            <button
              onClick={() => upsertMutation.mutate()}
              disabled={upsertMutation.isPending}
              className="btn-primary"
            >
              {upsertMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} /> {t.common.save}</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── API Keys Tab ─────────────────────────────────────────────────────────────

function ApiKeysTab() {
  const qc = useQueryClient()
  const t = useT()
  const { language } = useLanguageStore()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [newKeyName, setNewKeyName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => authApi.listApiKeys(),
  })

  async function handleCreate() {
    if (!newKeyName.trim()) return
    setCreating(true)
    try {
      const key = await authApi.createApiKey(newKeyName.trim())
      setCreatedKey(key.key ?? null)
      setNewKeyName('')
      qc.invalidateQueries({ queryKey: ['api-keys'] })
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t.settings.apikeys.deleteConfirm)) return
    await authApi.deleteApiKey(id)
    qc.invalidateQueries({ queryKey: ['api-keys'] })
  }

  function copyKey() {
    if (!createdKey) return
    navigator.clipboard.writeText(createdKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* User info + logout */}
      <div className="bg-surface-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-200">{user?.name}</p>
          <p className="text-xs text-slate-500">{user?.email} · {user?.role}</p>
        </div>
        <button onClick={handleLogout} className="btn-ghost text-xs text-red-400 hover:text-red-300">
          {t.settings.apikeys.logout}
        </button>
      </div>

      {/* New key shown once */}
      {createdKey && (
        <div className="bg-green-600/10 border border-green-600/30 rounded-xl p-4">
          <p className="text-sm font-medium text-green-400 mb-2">{t.settings.apikeys.newKeyCreated}</p>
          <div className="flex items-center gap-2 bg-surface-950 border border-slate-700 rounded-lg px-3 py-2">
            <code className="text-xs text-slate-300 flex-1 break-all font-mono">
              {showKey ? createdKey : '•'.repeat(32)}
            </code>
            <button onClick={() => setShowKey((v) => !v)} className="text-slate-500 hover:text-slate-200">
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <button onClick={copyKey} className={cn('text-slate-500 hover:text-slate-200', copied && 'text-green-400')}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <button onClick={() => setCreatedKey(null)} className="mt-2 text-xs text-slate-500 hover:text-slate-300">
            {t.common.close}
          </button>
        </div>
      )}

      {/* Create new key */}
      <div>
        <h3 className="text-sm font-medium text-slate-200 mb-3">{t.settings.apikeys.createTitle}</h3>
        <p className="text-xs text-slate-500 mb-3">
          {t.settings.apikeys.createDesc}
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder={t.settings.apikeys.keyNamePlaceholder}
            className="flex-1 bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newKeyName.trim()}
            className="btn-primary"
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {t.common.create}
          </button>
        </div>
      </div>

      {/* Keys list */}
      <div>
        <h3 className="text-sm font-medium text-slate-200 mb-3">{t.settings.apikeys.activeKeys}</h3>
        {isLoading ? (
          <Loader2 size={16} className="animate-spin text-primary-500" />
        ) : keys.length === 0 ? (
          <p className="text-sm text-slate-500">{t.settings.apikeys.noKeys}</p>
        ) : (
          <div className="space-y-2">
            {keys.map((key: ApiKeyItem) => (
              <div key={key.id} className="bg-surface-900 border border-slate-800 rounded-lg hover:border-slate-700 transition-colors">
                <div className="group flex items-center gap-3 px-3 py-2.5">
                  <Key size={13} className="text-slate-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200">{key.name}</p>
                    <p className="text-xs text-slate-600 font-mono">{key.prefix}...</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {key.lastUsedAt ? (
                      <p className="text-xs text-slate-600">{t.settings.apikeys.usedAgo} {formatDistanceToNow(new Date(key.lastUsedAt), { locale: getDateLocale(language), addSuffix: true })}</p>
                    ) : (
                      <p className="text-xs text-slate-700">{t.settings.apikeys.neverUsed}</p>
                    )}
                  </div>
                  <button onClick={() => handleDelete(key.id)} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


// ─── AI Assistant Tab ─────────────────────────────────────────────────────────



// 'sinoutx' is prepended at render time only when the server reports a key for it.
const USER_IMAGE_PROVIDERS = ['pollinations', 'openai', 'openrouter', 'flux', 'stability', 'fal', 'custom'] as const
const USER_EMBED_PROVIDERS = ['openai', 'openrouter', 'mistral', 'together', 'custom'] as const
// A chat /models listing has no embedding models; OpenRouter proxies OpenAI's
// under the `openai/` prefix, which is why the bare name is not findable there.
const USER_EMBED_MODELS: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: 'text-embedding-3-small', label: 'text-embedding-3-small' },
    { id: 'text-embedding-3-large', label: 'text-embedding-3-large' },
  ],
  openrouter: [
    { id: 'openai/text-embedding-3-small', label: 'openai/text-embedding-3-small' },
    { id: 'openai/text-embedding-3-large', label: 'openai/text-embedding-3-large' },
  ],
  mistral: [{ id: 'mistral-embed', label: 'mistral-embed' }],
  together: [{ id: 'BAAI/bge-large-en-v1.5', label: 'BAAI/bge-large-en-v1.5' }],
  custom: [],
}

const ALL_PROVIDERS: AIProvider[] = ['anthropic', 'openai', 'openrouter', 'groq', 'mistral', 'google', 'xai', 'together', 'perplexity', 'deepseek', 'ollama', 'custom']


function AIAssistantTab({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const t = useT()
  const { language } = useLanguageStore()
  const isRu = language === 'ru'
  const L = (en: string, ru: string, be: string) => (language === 'en' ? en : language === 'be' ? be : ru)
  const isBe = language === 'be'

  const TOOL_NAME_BE: Record<string, string> = {
    web_search: 'Пошук у інтэрнэце',
    save_sources_batch: 'Захаванне крыніц',
    save_source: 'Захаваць крыніцу',
    create_task: 'Стварэнне задачы',
    create_note: 'Стварэнне нататкі',
    create_page: 'Стварэнне старонкі',
    create_project: 'Стварэнне праекта',
    create_event: 'Стварэнне падзеі',
    update_task: 'Абнаўленне задачы',
    update_note: 'Абнаўленне нататкі',
    update_page: 'Абнаўленне старонкі',
    list_tasks: 'Спіс задач',
    list_notes: 'Спіс нататак',
    list_pages: 'Спіс старонак',
    list_projects: 'Спіс праектаў',
    get_task: 'Атрыманне задачы',
    get_note: 'Атрыманне нататкі',
    get_page: 'Атрыманне старонкі',
    search: 'Пошук у базе',
    analyze_file: 'Аналіз файла',
    get_budget_summary: 'Справаздача бюджэту',
    get_task_analytics: 'Аналітыка задач',
    get_upcoming_events: 'Бліжэйшыя падзеі',
    deep_research: 'Глыбокае даследаванне',
  }

  const getToolName = (name: string) =>
    isBe ? (TOOL_NAME_BE[name] ?? name) : name
  const [saved, setSaved] = useState(false)
  const [aiSubTab, setAiSubTab] = useState<'language' | 'image' | 'audio' | 'embeddings'>('language')
  // Per-provider show/hide key toggle
  // Per-provider test status
  // Per-provider dynamic models (from connection test)

  const { data, isLoading } = useQuery({
    queryKey: ['ai-settings', workspaceId],
    queryFn: () => aiSettingsApi.get(workspaceId),
  })

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => aiSettingsApi.getModels(),
  })

  // The wallet decides whether the managed model may be switched on at all —
  // it is our key and our bill. Fetched only where a managed model exists.
  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: () => walletApi.get(),
    enabled: !!modelsData?.managed?.available,
  })

  // Offered only where it exists: a self-hosted instance without a server key
  // must not advertise a built-in model it cannot run.
  const managedAvailable = !!modelsData?.managed?.available
  // The managed provider is chosen by the toggle, not from the list: putting it
  // in the dropdown next to twelve key-hungry providers hides the one choice
  // that needs no setup at all.

  const serverSettings = data?.settings
  const [activeProvider, setActiveProvider] = useState<AIProvider | null>(null)
  const provider: AIProvider = activeProvider ?? serverSettings?.provider ?? 'anthropic'
  const managedMode = managedAvailable && provider === 'sinoutx'

  // ── BYOK provider slots via the shared ProviderConnect ──────────────────────
  const saveSlot = async (patch: AISettingsPatch) => {
    await aiSettingsApi.update(workspaceId, patch)
    await queryClient.invalidateQueries({ queryKey: ['ai-settings', workspaceId] })
    queryClient.invalidateQueries({ queryKey: ['ai-models'] })
  }
  const langCurrent = {
    hasKey: !!serverSettings?.providers?.[provider]?.apiKey,
    provider: serverSettings?.provider && serverSettings.provider !== 'sinoutx' ? serverSettings.provider : undefined,
    model: serverSettings?.providers?.[provider]?.model,
    baseUrl: serverSettings?.providers?.[provider]?.baseUrl,
  }
  const imgCurrent = {
    hasKey: !!serverSettings?.imageGeneration?.apiKey,
    provider: serverSettings?.imageGeneration?.provider,
    model: serverSettings?.imageGeneration?.model,
    baseUrl: serverSettings?.imageGeneration?.baseUrl,
  }
  const embCurrent = {
    hasKey: !!serverSettings?.embeddings?.apiKey,
    provider: serverSettings?.embeddings?.provider,
    model: serverSettings?.embeddings?.model,
    baseUrl: serverSettings?.embeddings?.baseUrl,
  }
  // Switching ON costs money on a billing instance; switching OFF never does —
  // leaving for your own key must always be possible, empty balance or not.
  const canAffordManaged = !wallet?.billed || wallet.balanceUsd > 0
  // The backend always returns a default provider ('anthropic') even when nothing
  // is configured — so "chosen" means the user actively picked one this session,
  // or a saved provider that actually has a key (or is keyless like ollama).

  // Pull the live model list for a provider once a key is present (the static
  // list can be stale, e.g. DeepSeek dropped old models). Used on provider
  // switch and on API-key blur. Hoisted function → callable from the effect above.
  // Global form state (temperature/maxTokens/customSystemPrompt/enabledTools)
  const [globalForm, setGlobalForm] = useState<Partial<Pick<AISettings, 'temperature' | 'maxTokens' | 'customSystemPrompt' | 'assistantName' | 'assistantPersona' | 'enabledTools' | 'searchRegion' | 'timezone'>>>({})
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [customRegionMode, setCustomRegionMode] = useState(false)
  // Image generation provider form state
  // Video generation provider form state
  // Audio generation provider form state
  // Embeddings provider form state (separate BYOK key — semantic memory recall)

  const temperature        = globalForm.temperature        ?? serverSettings?.temperature        ?? 0.7
  const maxTokens          = globalForm.maxTokens          ?? serverSettings?.maxTokens          ?? 8096
  const customSystemPrompt = globalForm.customSystemPrompt ?? serverSettings?.customSystemPrompt ?? ''
  const assistantName      = globalForm.assistantName      ?? serverSettings?.assistantName      ?? ''
  const assistantPersona   = globalForm.assistantPersona   ?? serverSettings?.assistantPersona   ?? ''
  const enabledTools       = globalForm.enabledTools       ?? serverSettings?.enabledTools       ?? []
  const searchRegion       = globalForm.searchRegion       ?? serverSettings?.searchRegion       ?? ''
  const timezone           = globalForm.timezone           ?? serverSettings?.timezone           ?? browserTz

  const mutation = useMutation({
    mutationFn: (patch: AISettingsPatch) => aiSettingsApi.update(workspaceId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings', workspaceId] })
      setGlobalForm({})
      setActiveProvider(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Ошибка сохранения'
      console.error('[Settings save error]', err)
      alert(`Ошибка сохранения: ${msg}`)
    },
  })

  // Persist the browser timezone once if the workspace has none yet, so the AI
  // agent (incl. Telegram) creates tasks/events in the user's local time.
  useEffect(() => {
    if (serverSettings && !serverSettings.timezone && browserTz) {
      mutation.mutate({ timezone: browserTz })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSettings])







  // Saves the ASSISTANT settings only — character, tools, search, timezone.
  // Provider keys and models are owned by ProviderConnect and the toggle now.
  function handleSave() {
    mutation.mutate({
      temperature,
      maxTokens,
      customSystemPrompt,
      assistantName,
      assistantPersona,
      enabledTools,
      searchRegion: searchRegion || undefined,
      timezone: timezone || undefined,
    })
  }

  // Save a specific provider config without changing active provider

  function toggleTool(name: string) {
    const next = enabledTools.length === 0
      ? (data?.catalog ?? []).map((t) => t.name).filter((n) => n !== name)
      : enabledTools.includes(name) ? enabledTools.filter((n) => n !== name) : [...enabledTools, name]
    setGlobalForm((f) => ({ ...f, enabledTools: next }))
  }

  function isToolEnabled(name: string) {
    return enabledTools.length === 0 || enabledTools.includes(name)
  }

  const catalog: ToolMeta[] = data?.catalog ?? []
  const workspaceTools = catalog.filter((t) => t.category === 'workspace')
  const researchTools  = catalog.filter((t) => t.category === 'research')
  const webTools       = catalog.filter((t) => t.category === 'web')
  const analysisTools  = catalog.filter((t) => t.category === 'analysis')
  const knowledgeTools = catalog.filter((t) => t.category === 'knowledge')
  const deepTools      = catalog.filter((t) => t.category === 'deep')

  const [skillsOpen, setSkillsOpen] = useState(false)

  if (isLoading) {
    return <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 size={14} className="animate-spin" /> {t.common.loading}</div>
  }

  return (
    <div className="max-w-3xl space-y-5">

      {/* SinoutX vs BYOK — above everything, because it decides whether any of the
          provider settings below are relevant at all. A new account starts on
          SinoutX: it answers from the first message, and a wall of provider cards
          would greet a person who owns none of those keys. */}
      {managedAvailable && (
        <div className="bg-surface-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="inline-flex p-0.5 bg-surface-800 border border-slate-700 rounded-xl">
            <button
              //  deliberately does NOT change the active provider
              // (see saveProviderConfig). Switching is what  is for.
              onClick={() => mutation.mutate({ provider: 'sinoutx', providerConfig: { provider: 'sinoutx' } })}
              disabled={mutation.isPending || (!managedMode && !canAffordManaged)}
              title={!managedMode && !canAffordManaged ? t.settings.ai.needBalance : undefined}
              className={cn('px-4 py-2 text-sm rounded-lg transition-colors',
                managedMode ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-slate-200',
                !managedMode && !canAffordManaged && 'opacity-40 cursor-not-allowed')}
            >
              {t.settings.ai.managedMode}
            </button>
            <button
              onClick={() => {
                // Persist the switch, not just the local UI. Leaving `provider`
                // at 'sinoutx' meant the assistant kept answering on OUR key
                // while the screen showed BYOK — a stranger on our dime.
                const target = serverSettings?.provider && serverSettings.provider !== 'sinoutx' ? serverSettings.provider : 'anthropic'
                setActiveProvider(target)
                mutation.mutate({ provider: target })
              }}
              disabled={mutation.isPending}
              className={cn('px-4 py-2 text-sm rounded-lg transition-colors',
                !managedMode ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-slate-200')}
            >
              {t.settings.ai.byokMode}
            </button>
          </div>

          <p className="text-[11px] text-slate-500 max-w-lg leading-relaxed">
            {managedMode ? t.settings.ai.managedHint : t.settings.ai.byokHint}
          </p>

          {wallet?.billed && (
            <p className="text-[11px]">
              <span className={cn(canAffordManaged ? 'text-slate-500' : 'text-amber-500')}>
                {t.settings.ai.balance}: ${wallet.balanceUsd.toFixed(2)}
              </span>
              {!canAffordManaged && (
                <>
                  {' · '}
                  <button onClick={() => navigate('/billing')} className="text-primary-400 hover:underline">
                    {t.settings.ai.topUp}
                  </button>
                </>
              )}
            </p>
          )}

        </div>
      )}

      {/* ── Sub-tab switcher ──────────────────────────────────── */}
      {!managedMode && (
      <div className="flex gap-1 p-1 bg-slate-800/60 rounded-xl border border-slate-700/50 w-fit">
        {([
          { id: 'language', icon: <Bot size={13} />, label: isRu ? 'Языковая модель' : 'Language Model' },
          { id: 'image',    icon: <ImagePlus size={13} />, label: isRu ? 'Изображение' : 'Image' },
          { id: 'embeddings', icon: <Cpu size={13} />, label: language === 'en' ? 'Embeddings' : language === 'be' ? 'Эмбеддынгі' : 'Эмбеддинги' },
        ] as { id: 'language' | 'image' | 'audio' | 'embeddings'; icon: React.ReactNode; label: string }[]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setAiSubTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              aiSubTab === tab.id
                ? 'bg-primary-600/80 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      )}

      {/* ── Language Models ───────────────────────────────────── */}
      {/* Embeddings — semantic memory. Same Connect flow as the LLM. */}
      {!managedMode && aiSubTab === 'embeddings' && (
        <ProviderConnect
          title={isRu ? 'Эмбеддинги (память по смыслу)' : 'Embeddings (semantic memory)'}
          providers={USER_EMBED_PROVIDERS}
          current={embCurrent}
          staticModels={(pv) => USER_EMBED_MODELS[pv] ?? []}
          listModels={(x) => aiSettingsApi.testEmbeddingsConnection({ provider: x.provider as EmbeddingProvider, apiKey: x.apiKey, baseUrl: x.baseUrl }, workspaceId).then((r) => ({ ok: r.ok, error: r.error }))}
          save={(x) => saveSlot({ embeddings: { provider: x.provider as EmbeddingProvider, apiKey: x.apiKey, model: x.model, baseUrl: x.baseUrl } })}
          reset={() => saveSlot({ resetEmbeddings: true })}
        />
      )}

      {/* Language model — BYOK. Managed mode hides this entirely (handled above). */}
      {!managedMode && aiSubTab === 'language' && (
        <ProviderConnect
          title={t.settings.ai.languageModel}
          providers={ALL_PROVIDERS as unknown as string[]}
          current={langCurrent}
          keyless={(pv) => pv === 'ollama'}
          listModels={(x) => aiSettingsApi.testConnection({ provider: x.provider as AIProvider, apiKey: x.apiKey, baseUrl: x.baseUrl }, workspaceId).then((r) => ({ ok: r.ok, error: r.error, models: r.models }))}
          save={(x) => saveSlot({ provider: x.provider as AIProvider, providerConfig: { provider: x.provider as AIProvider, apiKey: x.apiKey, model: x.model, baseUrl: x.baseUrl } })}
          reset={() => saveSlot({ resetProvider: (serverSettings?.provider ?? 'anthropic') as AIProvider })}
        />
      )}

      {/* ── Image Generation ──────────────────────────────────── */}
      {/* Image generation — BYOK. Pollinations needs no key. */}
      {!managedMode && aiSubTab === 'image' && (
        <ProviderConnect
          title={t.settings.ai.imageGeneration}
          providers={USER_IMAGE_PROVIDERS}
          current={imgCurrent}
          keyless={(pv) => pv === 'pollinations'}
          staticModels={(pv) => (modelsData?.imageModels?.[pv as ImageProvider] ?? []).map((o) => ({ id: o.id, label: o.label }))}
          listModels={(x) => aiSettingsApi.testImageConnection({ provider: x.provider as ImageProvider, apiKey: x.apiKey, baseUrl: x.baseUrl }, workspaceId).then((r) => ({ ok: r.ok, error: r.error }))}
          save={(x) => saveSlot({ imageGeneration: { provider: x.provider as ImageProvider, apiKey: x.apiKey, model: x.model, baseUrl: x.baseUrl } })}
          reset={() => saveSlot({ resetImage: true })}
        />
      )}

      {/* ── Video Generation ──────────────────────────────────── */}
      {aiSubTab === 'language' && <>

      <div className="bg-surface-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Settings2 size={15} className="text-primary-400" />
          <h3 className="text-sm font-semibold text-slate-200">{t.settings.ai.parameters}</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{t.settings.ai.temperature}</span>
              <span className="text-slate-300">{temperature.toFixed(2)}</span>
            </label>
            <input type="range" min="0" max="2" step="0.05" value={temperature}
              onChange={(e) => setGlobalForm((f) => ({ ...f, temperature: parseFloat(e.target.value) }))}
              className="w-full accent-primary-500" />
            <div className="flex justify-between text-xs text-slate-600 mt-0.5">
              <span>{t.settings.ai.tempPrecise}</span><span>{t.settings.ai.tempBalance}</span><span>{t.settings.ai.tempCreative}</span>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t.settings.ai.maxTokens} ({maxTokens.toLocaleString()})</label>
            <input type="range" min="256" max="32768" step="256" value={maxTokens}
              onChange={(e) => setGlobalForm((f) => ({ ...f, maxTokens: parseInt(e.target.value) }))}
              className="w-full accent-primary-500" />
            <div className="flex justify-between text-xs text-slate-600 mt-0.5">
              <span>256</span><span>8K</span><span>32K</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 space-y-3">
          <div>
            <label className="block text-xs text-slate-300 mb-1 font-medium">{L('Assistant identity', 'Личность ассистента', 'Асоба асістэнта')}</label>
            <p className="text-[11px] text-slate-500 mb-2">{L('Name and character — always-on, applies to chat and Telegram. The agent also keeps an evolving Core in its memory module.', 'Имя и характер — всегда активны, в чате и Telegram. Свою эволюционирующую «суть» агент также хранит в модуле «Память».', 'Імя і характар — заўсёды актыўныя.')}</p>
            <input type="text" value={assistantName} maxLength={80}
              onChange={(e) => setGlobalForm((f) => ({ ...f, assistantName: e.target.value }))}
              placeholder={L('Name (e.g. Sino, Aria…)', 'Имя (напр. Сино, Ария…)', 'Імя')}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 mb-2" />
            <textarea value={assistantPersona} maxLength={4000}
              onChange={(e) => setGlobalForm((f) => ({ ...f, assistantPersona: e.target.value }))}
              placeholder={L('Character, tone, values — who the assistant is', 'Характер, тон, ценности — кто этот ассистент', 'Характар, тон, каштоўнасці')}
              rows={2}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 resize-y" />
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500">{L('Wipe the assistant long-term memory (facts/core/episodes). Identity stays — it comes from settings above.', 'Очистить долговременную память ассистента (факты/ядро/эпизоды). Личность не пострадает — она из настроек выше.', 'Ачысціць доўгатэрміновую памяць асістэнта.')}</p>
            <button
              onClick={async () => {
                if (!confirm(L('Wipe all of the assistant long-term memory? This cannot be undone.', 'Очистить всю долговременную память ассистента? Это необратимо.', 'Ачысціць усю памяць асістэнта? Незваротна.'))) return
                const r = await aiSettingsApi.clearMemory()
                alert(L(`Cleared ${r.cleared} memory records.`, `Удалено записей памяти: ${r.cleared}.`, `Выдалена: ${r.cleared}.`))
              }}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border border-red-600/40 text-red-400 hover:bg-red-600/10"
            >
              {L('Clear memory', 'Очистить память', 'Ачысціць памяць')}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">{t.settings.ai.systemInstructions}</label>
          <textarea value={customSystemPrompt}
            onChange={(e) => setGlobalForm((f) => ({ ...f, customSystemPrompt: e.target.value }))}
            placeholder={t.settings.ai.systemInstructionsPlaceholder}
            rows={3}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 resize-y" />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">{t.settings.ai.searchRegion}</label>
          <select
            value={customRegionMode ? '__custom__' : searchRegion}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                setCustomRegionMode(true)
                setGlobalForm((f) => ({ ...f, searchRegion: '' }))
              } else {
                setCustomRegionMode(false)
                setGlobalForm((f) => ({ ...f, searchRegion: e.target.value }))
              }
            }}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
          >
            <option value="">{t.settings.ai.searchRegionWorld}</option>
            <option value="by-be">{language === 'en' ? 'Belarus' : language === 'be' ? 'Беларусь' : 'Беларусь'} (by-be)</option>
            <option value="ru-RU">{language === 'en' ? 'Russia' : language === 'be' ? 'Расія' : 'Россия'} (ru-RU)</option>
            <option value="ua-uk">{language === 'en' ? 'Ukraine' : language === 'be' ? 'Украіна' : 'Украина'} (ua-uk)</option>
            <option value="us-en">{language === 'en' ? 'USA' : language === 'be' ? 'ЗША' : 'США'} (us-en)</option>
            <option value="de-de">{language === 'en' ? 'Germany' : language === 'be' ? 'Германія' : 'Германия'} (de-de)</option>
            <option value="pl-pl">{language === 'en' ? 'Poland' : language === 'be' ? 'Польшча' : 'Польша'} (pl-pl)</option>
            <option value="__custom__">{language === 'en' ? 'Other (custom)' : language === 'be' ? 'Іншы (уручную)' : 'Другой (вручную)'}</option>
          </select>
          {customRegionMode && (
            <input
              autoFocus
              type="text"
              value={searchRegion}
              onChange={(e) => setGlobalForm((f) => ({ ...f, searchRegion: e.target.value }))}
              placeholder="fr-fr, ja-ja, zh-CN"
              className="w-full mt-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
            />
          )}
          <p className="text-xs text-slate-600 mt-1">{t.settings.ai.searchRegionDesc}</p>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">{t.settings.ai.timezone}</label>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setGlobalForm((f) => ({ ...f, timezone: e.target.value }))}
            placeholder={browserTz}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <p className="text-xs text-slate-600 mt-1">{t.settings.ai.timezoneDesc}</p>
        </div>
      </div>

      {/* ── Bottom row: Skills button + Save ─────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">

        <button
          onClick={handleSave}
          disabled={mutation.isPending}
          className="btn-primary"
        >
          {mutation.isPending ? <><Loader2 size={14} className="animate-spin" /> {t.settings.ai.saving}</> : t.settings.ai.saveSettings}
        </button>
        <button
          onClick={() => setSkillsOpen(true)}
          className="btn-ghost flex items-center gap-2 text-sm"
        >
          <ToggleRight size={15} className="text-primary-400" />
          {t.settings.ai.skillsBtn}
          {enabledTools.length > 0 && (
            <span className="text-xs text-amber-400">({t.settings.ai.skillsCountFmt.replace('{n}', String(enabledTools.length)).replace('{total}', String(catalog.length))})</span>
          )}
        </button>
        {saved && <span className="text-xs text-green-400 flex items-center gap-1"><Check size={13} /> {t.settings.ai.saved}</span>}
        {mutation.isError && <span className="text-xs text-red-400">{t.settings.ai.saveError}</span>}
      </div>

      </>}

      {/* ── Skills Modal ─────────────────────────────────────── */}
      {skillsOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSkillsOpen(false)} />
          <div className="relative w-full max-w-2xl bg-surface-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
              <div className="flex items-center gap-2">
                <ToggleRight size={16} className="text-primary-400" />
                <h3 className="text-sm font-semibold text-slate-200">{t.settings.ai.tools}</h3>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setGlobalForm((f) => ({ ...f, enabledTools: [] }))}
                  className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-800"
                >
                  {t.settings.ai.enableAll}
                </button>
                <button onClick={() => setSkillsOpen(false)} className="text-slate-500 hover:text-slate-300 p-1 rounded-lg hover:bg-slate-800">
                  <X size={16} />
                </button>
              </div>
            </div>
            {/* Modal body */}
            <div className="overflow-y-auto p-5 space-y-4 flex-1">
              <p className="text-xs text-slate-500">{t.settings.ai.toolsDesc}</p>
              <CustomToolsManager />
              <div className="border-t border-slate-800" />
              {[
                { label: t.settings.ai.toolGroups.workspace, tools: workspaceTools },
                { label: t.settings.ai.toolGroups.research,  tools: researchTools  },
                { label: t.settings.ai.toolGroups.web,       tools: webTools       },
                { label: t.settings.ai.toolGroups.analysis,  tools: analysisTools  },
                { label: t.settings.ai.toolGroups.knowledge, tools: knowledgeTools },
                { label: t.settings.ai.toolGroups.deep,      tools: deepTools      },
              ].filter((g) => g.tools.length > 0).map((group) => (
                <div key={group.label}>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">{group.label}</p>
                  <div className="space-y-0.5">
                    {group.tools.map((tool) => {
                      const enabled = isToolEnabled(tool.name)
                      return (
                        <div key={tool.name} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-800/50">
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-mono text-slate-300">{getToolName(tool.name)}</span>
                            <span className="text-xs text-slate-500 ml-2">{!isRu && !isBe ? tool.description_en : tool.description}</span>
                          </div>
                          <button onClick={() => toggleTool(tool.name)} className="ml-2 flex-shrink-0">
                            {enabled ? <ToggleRight size={20} className="text-primary-400" /> : <ToggleLeft size={20} className="text-slate-600" />}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            {/* Modal footer */}
            <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between flex-shrink-0">
              <span className="text-xs text-slate-500">
                {enabledTools.length === 0
                  ? t.settings.ai.allSkillsEnabled.replace('{n}', String(catalog.length))
                  : t.settings.ai.skillsCountFmt.replace('{n}', String(enabledTools.length)).replace('{total}', String(catalog.length))}
              </span>
              <button onClick={() => { handleSave(); setSkillsOpen(false) }} disabled={mutation.isPending} className="btn-primary text-xs py-1.5 px-4">
                {mutation.isPending ? <Loader2 size={12} className="animate-spin" /> : t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Backup Tab ───────────────────────────────────────────────────────────────

function BackupTab({ workspaceId }: { workspaceId: string }) {
  const t = useT()
  const [downloading, setDownloading] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [restoreResult, setRestoreResult] = useState<{ projects: number; pages: number; tasks: number; notes: number; files: number; links: number } | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleBackup() {
    setDownloading(true)
    try {
      await backupApi.download(workspaceId)
    } catch (err) {
      console.error('Backup failed:', err)
    } finally {
      setDownloading(false)
    }
  }

  async function handleRestore() {
    if (!restoreFile) return
    setRestoring(true)
    setUploadPct(0)
    setRestoreResult(null)
    setRestoreError(null)
    try {
      const result = await backupApi.restore(restoreFile, setUploadPct)
      setRestoreResult(result.stats)
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : t.settings.backup.restoreErrorDefault)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Download */}
      <div className="bg-surface-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary-600/20 flex items-center justify-center flex-shrink-0">
            <DatabaseBackup size={20} className="text-primary-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-slate-200 mb-1">{t.settings.backup.exportTitle}</h3>
            <p className="text-xs text-slate-400 mb-4">
              {t.settings.backup.exportDesc}
            </p>
            <button onClick={handleBackup} disabled={downloading} className="btn-primary">
              {downloading ? (
                <><Loader2 size={14} className="animate-spin" /> {t.settings.backup.preparing}</>
              ) : (
                <><Download size={14} /> {t.settings.backup.downloadZip}</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* What's included */}
      <div className="bg-surface-900 border border-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-2">{t.settings.backup.includedTitle}</h3>
        <ul className="space-y-1 text-xs text-slate-400">
          {t.settings.backup.includedItems.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <Check size={11} className="text-green-400 flex-shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Restore */}
      <div className="bg-surface-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-amber-600/20 flex items-center justify-center flex-shrink-0">
            <Upload size={20} className="text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-slate-200 mb-1">{t.settings.backup.restoreTitle}</h3>
            <p className="text-xs text-slate-400 mb-4">
              {t.settings.backup.restoreDesc}
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => {
                setRestoreFile(e.target.files?.[0] ?? null)
                setRestoreResult(null)
                setRestoreError(null)
              }}
            />

            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary text-xs"
                disabled={restoring}
              >
                {t.settings.backup.selectZip}
              </button>
              {restoreFile && (
                <span className="text-xs text-slate-300 truncate max-w-[200px]">{restoreFile.name}</span>
              )}
            </div>

            {restoring && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>{uploadPct < 100 ? t.settings.backup.uploadingFile : t.settings.backup.processingData}</span>
                  <span>{uploadPct}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5">
                  <div
                    className="bg-primary-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
              </div>
            )}

            {restoreResult && (
              <div className="mb-4 p-3 bg-green-900/30 border border-green-800/50 rounded-lg text-xs text-green-300">
                <p className="font-semibold mb-1">{t.settings.backup.restoreDone}</p>
                <p>{t.dashboard.projects}: {restoreResult.projects} · {t.pages.title}: {restoreResult.pages} · {t.tasks.title}: {restoreResult.tasks} · {t.notes.title}: {restoreResult.notes} · {t.common.upload}: {restoreResult.files}</p>
              </div>
            )}

            {restoreError && (
              <div className="mb-4 p-3 bg-red-900/30 border border-red-800/50 rounded-lg text-xs text-red-300">
                {restoreError}
              </div>
            )}

            <button
              onClick={handleRestore}
              disabled={!restoreFile || restoring}
              className="btn-primary"
            >
              {restoring ? (
                <><Loader2 size={14} className="animate-spin" /> {t.settings.backup.restoring}</>
              ) : (
                <><Upload size={14} /> {t.settings.backup.restoreBtn}</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Search reindex */}
      <SearchReindexCard />
    </div>
  )
}

function SearchReindexCard() {
  const t = useT()
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ pages: number; tasks: number; notes: number } | null>(null)

  async function handleReindex() {
    setStatus('loading')
    setResult(null)
    try {
      const r = await searchApi.reindex() as { indexed: { pages: number; tasks: number; notes: number } }
      setResult(r.indexed)
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="bg-surface-900 border border-slate-800 rounded-xl p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-primary-600/20 flex items-center justify-center flex-shrink-0">
          <Search size={20} className="text-primary-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-200 mb-1">{t.settings.backup.reindexTitle}</h3>
          <p className="text-xs text-slate-400 mb-4">
            {t.settings.backup.reindexFullDesc}
          </p>
          <button onClick={handleReindex} disabled={status === 'loading'} className="btn-secondary text-xs">
            {status === 'loading' ? <><Loader2 size={13} className="animate-spin" /> {t.settings.backup.reindexRunning}</> : t.settings.backup.reindexBtn}
          </button>
          {status === 'done' && result && (
            <p className="mt-3 text-xs text-green-400">
              {t.common.done}: {t.pages.title.toLowerCase()} {result.pages}, {t.tasks.title.toLowerCase()} {result.tasks}, {t.notes.title.toLowerCase()} {result.notes}
            </p>
          )}
          {status === 'error' && (
            <p className="mt-3 text-xs text-red-400">{t.settings.backup.reindexFailed}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Security Tab ─────────────────────────────────────────────────────────────

function SecurityTab() {
  const t = useT()
  const s = t.settings.security
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // 2FA state
  const [twoFaStep, setTwoFaStep] = useState<'idle' | 'setup' | 'disable'>('idle')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [twoFaCode, setTwoFaCode] = useState('')
  const [twoFaLoading, setTwoFaLoading] = useState(false)
  const [twoFaError, setTwoFaError] = useState<string | null>(null)
  const [twoFaSuccess, setTwoFaSuccess] = useState(false)

  const { data: twoFaStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['2fa-status'],
    queryFn: twoFactorApi.status,
    staleTime: 60_000,
  })
  const enabled = twoFaStatus?.enabled ?? false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (next !== confirm) { setError(s.mismatch); return }
    if (next.length < 8) { setError(s.tooShort); return }
    setLoading(true)
    setError(null)
    try {
      const { api } = await import('@/api/client')
      await api.patch('/auth/change-password', { currentPassword: current, newPassword: next })
      setSaved(true)
      setCurrent(''); setNext(''); setConfirm('')
      setTimeout(() => setSaved(false), 3000)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? s.errorDefault)
    } finally {
      setLoading(false)
    }
  }

  async function handleSetup2FA() {
    setTwoFaLoading(true)
    setTwoFaError(null)
    try {
      const res = await twoFactorApi.setup()
      setQrDataUrl(res.qrDataUrl)
      setTwoFaStep('setup')
      setTwoFaCode('')
    } catch (err: unknown) {
      setTwoFaError(err instanceof Error ? err.message : 'Error')
    } finally {
      setTwoFaLoading(false)
    }
  }

  async function handleEnable2FA(e: React.FormEvent) {
    e.preventDefault()
    setTwoFaLoading(true)
    setTwoFaError(null)
    try {
      await twoFactorApi.enable(twoFaCode)
      setTwoFaStep('idle')
      setTwoFaCode('')
      setTwoFaSuccess(true)
      refetchStatus()
      setTimeout(() => setTwoFaSuccess(false), 3000)
    } catch (err: unknown) {
      setTwoFaError(err instanceof Error ? err.message : 'Invalid code')
    } finally {
      setTwoFaLoading(false)
    }
  }

  async function handleDisable2FA(e: React.FormEvent) {
    e.preventDefault()
    setTwoFaLoading(true)
    setTwoFaError(null)
    try {
      await twoFactorApi.disable(twoFaCode)
      setTwoFaStep('idle')
      setTwoFaCode('')
      refetchStatus()
    } catch (err: unknown) {
      setTwoFaError(err instanceof Error ? err.message : 'Invalid code')
    } finally {
      setTwoFaLoading(false)
    }
  }

  return (
    <div className="max-w-md space-y-8">
      {/* Change password */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-1">{s.changePassword}</h3>
        <p className="text-xs text-slate-500 mb-4">{s.changePasswordDesc}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {([
            { label: s.currentPassword, value: current, onChange: (v: string) => setCurrent(v) },
            { label: s.newPassword, value: next, onChange: (v: string) => setNext(v) },
            { label: s.confirmPassword, value: confirm, onChange: (v: string) => setConfirm(v) },
          ]).map(({ label, value, onChange }) => (
            <div key={label}>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">{label}</label>
              <div className="relative">
                <input
                  type={showPasswords ? 'text' : 'password'} value={value} required
                  onChange={(e) => { onChange(e.target.value); setError(null) }}
                  className="w-full bg-surface-800 border border-slate-700 rounded-lg px-3 py-2.5 pr-10 text-sm text-slate-100 focus:outline-none focus:border-primary-500"
                />
              </div>
            </div>
          ))}

          <label className="flex items-center gap-2 cursor-pointer mt-1">
            <input type="checkbox" checked={showPasswords} onChange={(e) => setShowPasswords(e.target.checked)}
              className="rounded accent-primary-500" />
            <span className="text-xs text-slate-400">{s.showPasswords}</span>
          </label>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
          )}
          {saved && (
            <p className="text-sm text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">{s.success}</p>
          )}

          <button type="submit" disabled={loading}
            className="flex items-center gap-2 btn btn-primary px-4 py-2 text-sm">
            {loading ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <ShieldCheck size={14} />}
            {saved ? s.changed : s.changeBtn}
          </button>
        </form>
      </div>

      {/* Two-Factor Authentication */}
      <div className="border-t border-slate-800 pt-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <ShieldCheck size={15} className={enabled ? 'text-green-400' : 'text-slate-500'} />
            {s.twoFactor.title}
          </h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${enabled ? 'bg-green-500/15 text-green-400' : 'bg-slate-700 text-slate-400'}`}>
            {enabled ? s.twoFactor.enabled : s.twoFactor.disabled}
          </span>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          {enabled ? s.twoFactor.descEnabled : s.twoFactor.desc}
        </p>

        {twoFaStep === 'idle' && !enabled && (
          <button onClick={handleSetup2FA} disabled={twoFaLoading}
            className="btn btn-primary flex items-center gap-2 px-4 py-2 text-sm">
            {twoFaLoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {s.twoFactor.enableBtn}
          </button>
        )}

        {twoFaStep === 'idle' && enabled && (
          <button onClick={() => { setTwoFaStep('disable'); setTwoFaCode(''); setTwoFaError(null) }}
            className="btn btn-ghost border border-red-500/40 text-red-400 hover:bg-red-500/10 flex items-center gap-2 px-4 py-2 text-sm">
            <X size={14} /> {s.twoFactor.disableBtn}
          </button>
        )}

        {twoFaStep === 'setup' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">{s.twoFactor.scanQr}</p>
            {qrDataUrl && (
              <div className="inline-block bg-white p-2 rounded-lg">
                <img src={qrDataUrl} alt="2FA QR Code" className="w-40 h-40" />
              </div>
            )}
            <form onSubmit={handleEnable2FA} className="flex gap-2">
              <input
                autoFocus type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                value={twoFaCode} onChange={e => { setTwoFaCode(e.target.value); setTwoFaError(null) }}
                placeholder={s.twoFactor.codePlaceholder} required
                className="w-32 bg-surface-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-primary-500 tracking-widest text-center"
              />
              <button type="submit" disabled={twoFaLoading || twoFaCode.length < 6}
                className="btn btn-primary flex items-center gap-2 px-4 py-2 text-sm">
                {twoFaLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {s.twoFactor.verifyBtn}
              </button>
              <button type="button" onClick={() => { setTwoFaStep('idle'); setTwoFaError(null) }}
                className="btn btn-ghost px-3 py-2 text-sm text-slate-400">
                {s.twoFactor.cancel}
              </button>
            </form>
            {twoFaError && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{twoFaError}</p>
            )}
          </div>
        )}

        {twoFaStep === 'disable' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">{s.twoFactor.disablePrompt}</p>
            <form onSubmit={handleDisable2FA} className="flex gap-2">
              <input
                autoFocus type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                value={twoFaCode} onChange={e => { setTwoFaCode(e.target.value); setTwoFaError(null) }}
                placeholder={s.twoFactor.codePlaceholder} required
                className="w-32 bg-surface-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-primary-500 tracking-widest text-center"
              />
              <button type="submit" disabled={twoFaLoading || twoFaCode.length < 6}
                className="btn btn-ghost border border-red-500/40 text-red-400 hover:bg-red-500/10 flex items-center gap-2 px-4 py-2 text-sm">
                {twoFaLoading ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                {s.twoFactor.disableBtn}
              </button>
              <button type="button" onClick={() => { setTwoFaStep('idle'); setTwoFaError(null) }}
                className="btn btn-ghost px-3 py-2 text-sm text-slate-400">
                {s.twoFactor.cancel}
              </button>
            </form>
            {twoFaError && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{twoFaError}</p>
            )}
          </div>
        )}

        {twoFaSuccess && (
          <p className="text-sm text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2 mt-3 flex items-center gap-2">
            <Check size={14} /> {s.twoFactor.successEnabled}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Plan Tab ─────────────────────────────────────────────────────────────────

interface PlanUsage {
  plan: string
  /** Where the account runs and whether it collaborates: selfhosted | cloud | team. */
  tier: 'selfhosted' | 'cloud' | 'team'
  licenseKey: string | null
  licenseExpiresAt: string | null
  /** Whether THIS user is charged: the instance bills, and he is not exempt. */
  billed: boolean
  isAdmin: boolean
  limits: { storageMb: number; members: number; premiumPipelines: boolean }
  usage: { storageMb: number; members: number }
}

// The wallet only exists where a managed model does: on a BYOK-only instance the
// balance would always read $0.00 and mean nothing, so the card hides itself.
function WalletCard() {
  const t = useT()
  const w = t.settings.plan.wallet
  const { language } = useLanguageStore()
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [busy, setBusy] = useState(false)
  const [capEditing, setCapEditing] = useState(false)
  const [capDraft, setCapDraft] = useState('')
  const [toppedUp, setToppedUp] = useState(false)
  const [customTopup, setCustomTopup] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const pendingTopup = searchParams.get('topup')

  useEffect(() => { walletApi.get().then(setWallet).catch(() => {}) }, [])

  // Just back from a crypto payment: the IPN may still be in flight, so poll
  // until the credit lands, then refresh the wallet and lift the freeze in place
  // — no stale "frozen" banner, no manual reload.
  useEffect(() => {
    if (!pendingTopup) return
    let alive = true
    const tick = async () => {
      try {
        const s = await walletApi.topupStatus(pendingTopup)
        if (!alive || s.status !== 'completed') return
        await walletApi.get().then(setWallet).catch(() => {})
        useBillingStore.getState().setFrozen(s.frozen)
        setToppedUp(true)
        setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('topup'); return n }, { replace: true })
        clearInterval(id)
      } catch { /* keep polling */ }
    }
    const id = setInterval(tick, 4000)
    void tick()
    return () => { alive = false; clearInterval(id) }
  }, [pendingTopup]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!wallet) return null
  // On cloud the card is the storefront: a new, unfunded user must still see the
  // tariff and the top-up buttons. Only a non-billing (BYOK) instance — where the
  // balance is a meaningless $0 — hides an otherwise empty card.
  const nothingToShow = wallet.balanceUsd === 0 && wallet.transactions.length === 0
    && !wallet.upcoming && wallet.stats.answers === 0
  if (!wallet.cloud && nothingToShow) return null

  const money = (v: number) => '$' + (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3))
  const capPct = wallet.monthlyCapUsd > 0 ? Math.min(100, (wallet.spentThisMonthUsd / wallet.monthlyCapUsd) * 100) : 0
  const low = wallet.balanceUsd <= wallet.lowBalanceUsd
  const storagePct = wallet.storage.limitMb > 0
    ? Math.min(100, (wallet.storage.usedMb / wallet.storage.limitMb) * 100)
    : 0

  async function topUp(amount: number) {
    setBusy(true)
    try {
      const { invoiceUrl } = await walletApi.topUp(amount)
      window.location.href = invoiceUrl
    } catch { setBusy(false) }
  }

  async function setPacks(next: number) {
    if (next < 0) return
    setBusy(true)
    try {
      const r = await walletApi.setStoragePacks(next)
      setWallet((w) => (w ? { ...w, storage: r.storage } : w))
      walletApi.get().then(setWallet).catch(() => {})
    } finally { setBusy(false) }
  }

  // null resets to the instance default. A blank or non-positive draft is read
  // as "reset" rather than a $0 cap, which would silently block the model.
  async function saveCap(reset = false) {
    const parsed = Number(capDraft.replace(',', '.'))
    const value = reset || !capDraft.trim() || !(parsed > 0) ? null : parsed
    setBusy(true)
    try {
      const r = await walletApi.setCap(value)
      setWallet((prev) => (prev ? { ...prev, monthlyCapUsd: r.capUsd } : prev))
      setCapEditing(false)
    } finally { setBusy(false) }
  }

  return (
    <div className="bg-surface-800 border border-slate-700 rounded-xl p-5 space-y-4">
      {/* Payment feedback: confirming while the IPN lands, then a success note. */}
      {pendingTopup && (
        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
          <Loader2 size={14} className="animate-spin flex-shrink-0" />
          {w.confirming}
        </div>
      )}
      {toppedUp && !pendingTopup && (
        <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
          <Check size={14} className="flex-shrink-0" />
          {w.toppedUp}
        </div>
      )}

      {/* Tariff — what the cloud costs, in one block: subscription, per-token
          price of the built-in model, storage-pack price. */}
      {wallet.cloud && (
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-2.5">{w.tariffTitle}</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-400">{w.subLine}</span>
              <span className="tabular-nums text-slate-200">${wallet.tariff.baseUsd.toFixed(2)}/{w.perMonth}</span>
            </div>
            {wallet.tariff.tokensInPerMUsd != null && wallet.tariff.tokensOutPerMUsd != null && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-slate-400">{w.tokensLine}</span>
                <span className="tabular-nums text-slate-200 text-right">
                  {w.tokIn} ${wallet.tariff.tokensInPerMUsd.toFixed(2)} · {w.tokOut} ${wallet.tariff.tokensOutPerMUsd.toFixed(2)} <span className="text-slate-500">{w.perM}</span>
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-400">{w.storage}</span>
              <span className="tabular-nums text-slate-200">{wallet.tariff.packMb} {w.mb} — ${wallet.tariff.packPriceUsd.toFixed(2)}/{w.perMonth}</span>
            </div>
          </div>
        </div>
      )}

      {/* Balance and the button to grow it, side by side: the money on the left,
          prominent top-up buttons on the right. */}
      <div className={cn('flex flex-wrap items-start justify-between gap-4', wallet.cloud && 'border-t border-slate-800 pt-4')}>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="text-xs text-slate-500">{w.balance}</div>
            <div className={cn('text-2xl font-semibold tabular-nums mt-0.5', low ? 'text-amber-400' : 'text-slate-100')}>
              {money(wallet.balanceUsd)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{w.spentThisMonth}</div>
            <div className="text-lg font-medium text-slate-300 tabular-nums mt-0.5">{money(wallet.spentThisMonthUsd)}</div>
          </div>
        </div>
        {wallet.topUpAvailable ? (
          <div className="flex flex-col items-end gap-1.5">
            <div className="text-[11px] font-medium text-slate-400">{w.topUpTitle}</div>
            <div className="flex flex-wrap gap-2 justify-end">
              {[15, 25, 50, 100].map((amt) => (
                <button
                  key={amt}
                  disabled={busy || amt < wallet.minTopUpUsd}
                  onClick={() => topUp(amt)}
                  className="btn btn-primary text-sm font-semibold px-4 py-2 rounded-lg tabular-nums disabled:opacity-50"
                >
                  ${amt}
                </button>
              ))}
            </div>
            {/* Own amount — anything from the minimum up to the $1000 cap. */}
            {(() => {
              const amt = Number(customTopup)
              const valid = amt >= wallet.minTopUpUsd && amt <= 1000
              return (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 text-sm">$</span>
                  <input
                    type="number" min={wallet.minTopUpUsd} max={1000} step={5} inputMode="decimal"
                    value={customTopup}
                    onChange={(e) => setCustomTopup(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && valid) topUp(amt) }}
                    placeholder={w.ownAmount}
                    className="w-28 bg-surface-900 border border-slate-600 rounded-lg px-2.5 py-1.5 text-sm text-slate-100 tabular-nums focus:outline-none focus:border-primary-500"
                  />
                  <button
                    disabled={busy || !valid}
                    onClick={() => topUp(amt)}
                    className="btn btn-primary text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                  >
                    {w.topUp}
                  </button>
                </div>
              )
            })()}
            <span className="text-[11px] text-slate-600">{w.min} ${wallet.minTopUpUsd}</span>
          </div>
        ) : (
          <p className="text-xs text-slate-500 self-center">{w.topUpUnavailable}</p>
        )}
      </div>

      <div>
        <div className="flex justify-between items-center text-xs text-slate-500 mb-1">
          <span>{w.cap}</span>
          {capEditing ? (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">$</span>
              <input
                type="number" min={0} step={5} autoFocus
                value={capDraft}
                onChange={(e) => setCapDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCap(); if (e.key === 'Escape') setCapEditing(false) }}
                className="w-20 bg-surface-900 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-100 tabular-nums focus:outline-none focus:border-primary-500"
              />
              <button disabled={busy} onClick={() => saveCap()} className="text-primary-400 hover:text-primary-300 disabled:opacity-50">{w.capSave}</button>
              <button disabled={busy} onClick={() => saveCap(true)} className="text-slate-500 hover:text-slate-300 disabled:opacity-50">{w.capReset}</button>
            </div>
          ) : (
            <span className="flex items-center gap-2">
              <span className="tabular-nums">{money(wallet.spentThisMonthUsd)} / {money(wallet.monthlyCapUsd)}</span>
              <button
                onClick={() => { setCapDraft(String(wallet.monthlyCapUsd)); setCapEditing(true) }}
                className="text-primary-400 hover:text-primary-300"
              >
                {w.capEdit}
              </button>
            </span>
          )}
        </div>
        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full', capPct > 80 ? 'bg-amber-500' : 'bg-primary-500')} style={{ width: `${capPct}%` }} />
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5">{w.capHint}</p>
        {wallet.nextChargeAt && (
          <p className="text-[11px] text-slate-500 mt-1">
            {w.nextCharge}: <span className="text-slate-400">{new Date(wallet.nextChargeAt).toLocaleDateString(language)}</span>
          </p>
        )}
      </div>

      {/* Storage — bought in packs, never metered into a surprise bill. The bar
          is the whole explanation: what you hold, what you use, what it costs. */}
      {(
        <div className="border-t border-slate-800 pt-4">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>{w.storage}</span>
            <span className="tabular-nums">
              {wallet.storage.limitMb === -1
                ? `${wallet.storage.usedMb} ${w.mb} · ${w.unlimited}`
                : `${wallet.storage.usedMb} / ${wallet.storage.limitMb} ${w.mb}`}
            </span>
          </div>
          {wallet.storage.limitMb !== -1 && (
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', storagePct > 90 ? 'bg-amber-500' : 'bg-teal-500')}
                style={{ width: `${storagePct}%` }}
              />
            </div>
          )}
          {wallet.cloud && (
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <button onClick={() => setPacks(wallet.storage.packs + 1)} disabled={busy} className="btn border border-slate-600 text-slate-200 hover:bg-slate-700/50 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">
              {w.buyPack} · +{wallet.storage.packMb} {w.mb} · ${wallet.storage.packPriceUsd.toFixed(2)}/{w.perMonth}
            </button>
            {wallet.storage.packs > 0 && (
              <button onClick={() => setPacks(wallet.storage.packs - 1)} disabled={busy} className="btn-ghost text-xs px-2.5 py-1.5 text-slate-500">
                − {w.removePack}
              </button>
            )}
            <span className="text-[11px] text-slate-600">
              {w.packsHeld}: {wallet.storage.packs}
            </span>
          </div>
          )}
          <p className="text-[11px] text-slate-500 mt-1.5">
            {wallet.storage.limitMb === -1 ? w.storageOwn : wallet.cloud ? w.packMonthly : w.storageHint}
          </p>
        </div>
      )}

      {/* This month, in the assistant's own terms. */}
      {wallet.stats.answers > 0 && (
        <div className="border-t border-slate-800 pt-4">
          <div className="text-xs text-slate-400 mb-2">{w.statsTitle}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-[11px] text-slate-500">{w.statAnswers}</div>
              <div className="text-sm font-medium text-slate-200 tabular-nums">{wallet.stats.answers.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">{w.statTokens}</div>
              <div className="text-sm font-medium text-slate-200 tabular-nums">
                {((wallet.stats.inputTokens + wallet.stats.cachedInputTokens + wallet.stats.outputTokens) / 1000).toFixed(0)}K
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">{w.statCache}</div>
              <div className="text-sm font-medium text-teal-400 tabular-nums">{wallet.stats.cacheSharePct}%</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">{w.statTokenCost}</div>
              <div className="text-sm font-medium text-slate-200 tabular-nums">
                {wallet.stats.tokensCostUsd > 0 ? money(wallet.stats.tokensCostUsd) : '—'}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-600 mt-2">{w.statsHint}</p>
        </div>
      )}

      {wallet.transactions.length > 0 && (
        <div>
          <div className="text-xs font-medium text-slate-400 mb-2">{w.history}</div>
          <div className="space-y-1.5">
            {wallet.transactions.slice(0, 6).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-400">
                  {w.kinds[tx.kind] ?? tx.kind}
                  {tx.status === 'pending' && <span className="text-amber-500/80 ml-1.5">· {w.pending}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-slate-600">{new Date(tx.createdAt).toLocaleDateString(language === 'en' ? 'en-GB' : 'ru-RU')}</span>
                  {/* Charges are stored as negative amounts; print the real sign
                      rather than a hopeful plus. */}
                  <span className={cn(
                    'tabular-nums',
                    tx.status !== 'completed' ? 'text-slate-500' : tx.amountUsd < 0 ? 'text-slate-300' : 'text-teal-400',
                  )}>
                    {tx.amountUsd < 0 ? '−' : '+'}{money(Math.abs(tx.amountUsd))}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function PlanTab() {
  const t = useT()
  const p = t.settings.plan
  const { user } = useAuthStore()
  const [data, setData] = useState<PlanUsage | null>(null)
  const [licenseKey, setLicenseKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keySuccess, setKeySuccess] = useState(false)
  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState<string | null>(null)

  async function handleBuy(plan: 'team') {
    if (!user?.email) {
      setBuyError('Email not set on your account')
      return
    }
    setBuying(true); setBuyError(null)
    try {
      const { billingApi } = await import('@/api/client')
      const { invoiceUrl } = await billingApi.createInvoice(plan, user.email)
      window.location.href = invoiceUrl
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setBuyError(msg ?? 'Failed to start checkout')
      setBuying(false)
    }
  }

  useEffect(() => {
    import('@/api/client').then(({ api }) => {
      api.get<PlanUsage>('/auth/plan').then((r) => setData(r.data)).catch(() => {})
    })
  }, [])

  async function activateKey(key: string) {
    if (!key.trim()) return
    setActivating(true)
    setKeyError(null)
    setKeySuccess(false)
    try {
      const { api } = await import('@/api/client')
      // activate-license returns { ok, plan, expiresAt } — not the full PlanUsage.
      // Re-fetch /auth/plan so usage/limits are present for the render.
      await api.post('/auth/activate-license', { key: key.trim() })
      const fresh = await api.get<PlanUsage>('/auth/plan')
      setData(fresh.data)
      setKeySuccess(true)
      setLicenseKey('')
      setTimeout(() => setKeySuccess(false), 4000)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setKeyError(msg ?? p.keyError)
    } finally {
      setActivating(false)
    }
  }

  function handleActivate(e: React.FormEvent) {
    e.preventDefault()
    activateKey(licenseKey)
  }

  // Pre-fill + auto-activate a key passed via /settings?key=... (from /buy success).
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('key')
    if (k) { setLicenseKey(k); activateKey(k) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const PLAN_COLORS: Record<string, string> = {
    free: 'text-slate-400 bg-slate-700',
    community: 'text-emerald-300 bg-emerald-500/20',
    pro: 'text-violet-300 bg-violet-500/20',
    team: 'text-blue-300 bg-blue-500/20',
  }

  return (
    <div className="max-w-md space-y-8">
      {/* Current plan */}
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">{p.currentPlan}</h3>
        {data ? (
          <div className="flex items-center gap-3 mt-3">
            <span className={cn('px-3 py-1 rounded-full text-sm font-semibold uppercase tracking-wide', PLAN_COLORS[data.tier === 'cloud' ? 'community' : data.tier === 'team' ? 'team' : 'free'])}>
              {/* Name the tier by where it runs, not by an internal plan slug:
                  self-hosted / cloud / team. */}
              {data.tier === 'team' ? p.tierTeam : data.tier === 'cloud' ? p.tierCloud : p.tierSelf}
            </span>
            {data.licenseKey && (
              <span className="text-xs text-slate-500 font-mono">{data.licenseKey}</span>
            )}
            {data.licenseExpiresAt && (() => {
              const daysLeft = Math.ceil((new Date(data.licenseExpiresAt).getTime() - Date.now()) / 86400000)
              return (
                <span className="text-xs text-slate-500">
                  {p.expiresAt}: {new Date(data.licenseExpiresAt).toLocaleDateString()}
                  {daysLeft >= 0 && <> · {p.daysLeft.replace('{n}', String(daysLeft))}</>}
                </span>
              )
            })()}
          </div>
        ) : (
          <div className="h-7 w-24 bg-slate-800 rounded-full animate-pulse mt-3" />
        )}

        {/* Renewal — paid plans with an expiry */}
        {data && data.plan === 'team' && data.licenseExpiresAt && (() => {
          const daysLeft = Math.ceil((new Date(data.licenseExpiresAt).getTime() - Date.now()) / 86400000)
          const soon = daysLeft <= 14
          return (
            <div className={cn('mt-4 rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3',
              soon ? 'border-amber-500/40 bg-amber-500/10' : 'border-slate-700 bg-surface-800')}>
              <p className={cn('text-xs leading-relaxed flex-1 min-w-[200px]', soon ? 'text-amber-200' : 'text-slate-400')}>
                {soon ? p.renewSoon : p.renewExtends}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleBuy('team')}
                  disabled={buying}
                  className={cn('px-4 py-2 text-sm rounded-lg whitespace-nowrap', soon ? 'btn btn-primary' : 'btn btn-ghost border border-slate-700')}
                >
                  {buying ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
                  {p.renew} — $149
                </button>
              </div>
            </div>
          )
        })()}
      </div>

      <WalletCard />

      {/* What this actually means, in a sentence. «Free» reads as a crippled trial
          on a rented server and as «it is yours» on your own — say which. The
          instance owner needs no such line: he has no plan and no bill. */}
      {data && !data.isAdmin && (
        <p className="text-sm text-slate-400 leading-relaxed">
          {data.plan === 'team' ? p.introTeam : data.billed ? p.introCloud : p.introSelf}
        </p>
      )}

      {/* Activate license key */}
      <div className="border-t border-slate-800 pt-6">
        <h3 className="text-sm font-semibold text-slate-200 mb-1">{p.activateKey}</h3>
        <p className="text-xs text-slate-500 mb-3">
          {p.upgradeHint.replace(/sinout@dasp\.top/, '').trim()}{' '}
          <a href="mailto:sinout@dasp.top?subject=SinoutX%20License" className="text-primary-400 hover:underline">sinout@dasp.top</a>
        </p>

        {data?.plan === 'free' && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleBuy('team')}
              disabled={buying}
              className="btn btn-primary px-4 py-2 text-sm whitespace-nowrap"
            >
              {buying ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
              {buying ? 'Starting…' : 'Buy Team — $149 once (crypto)'}
            </button>
            {buyError && (
              <span className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle size={12} /> {buyError}
              </span>
            )}
          </div>
        )}
        <form onSubmit={handleActivate} className="flex gap-2">
          <input
            value={licenseKey}
            onChange={(e) => {
              // Mask: uppercase, keep only A-Z0-9, regroup as PREFIX-XXXX-XXXX-XXXX.
              const c = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15)
              const parts = [c.slice(0, 3), c.slice(3, 7), c.slice(7, 11), c.slice(11, 15)].filter(Boolean)
              setLicenseKey(parts.join('-')); setKeyError(null)
            }}
            maxLength={18}
            placeholder="SXP-XXXX-XXXX-XXXX"
            className="flex-1 bg-surface-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm font-mono uppercase tracking-wider text-slate-100 focus:outline-none focus:border-primary-500 placeholder-slate-600"
          />
          <button
            type="submit"
            disabled={activating || !licenseKey.trim()}
            className="btn btn-primary px-4 py-2.5 text-sm whitespace-nowrap"
          >
            {activating ? <Loader2 size={14} className="animate-spin" /> : null}
            {activating ? p.activating : p.activate}
          </button>
        </form>
        {keyError && (
          <p className="mt-2 text-xs text-red-400 flex items-center gap-1">
            <AlertCircle size={12} /> {keyError}
          </p>
        )}
        {keySuccess && (
          <p className="mt-2 text-xs text-emerald-400 flex items-center gap-1">
            <Check size={12} /> {p.keySuccess}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Import Tab ───────────────────────────────────────────────────────────────

type ImportSource = 'notion' | 'obsidian'

function ImportCard({
  source,
  workspaceId,
}: {
  source: ImportSource
  workspaceId: string
}) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const s = t.settings.importTab
  const info = source === 'notion' ? s.notion : s.obsidian

  const [file, setFile] = useState<File | null>(null)
  const [projectMode, setProjectMode] = useState<'existing' | 'new'>('new')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [newProjectName, setNewProjectName] = useState(source === 'notion' ? 'Notion Import' : 'Obsidian Vault')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: projects } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => projectApi.listByWorkspace(workspaceId),
    staleTime: 30_000,
  })

  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith('.zip')) return
    setFile(f)
    setResult(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const handleImport = async () => {
    if (!file) return
    setLoading(true)
    setResult(null)
    try {
      const params = {
        workspaceId,
        ...(projectMode === 'existing' && selectedProjectId ? { projectId: selectedProjectId } : { newProjectName }),
      }
      const res = source === 'notion'
        ? await importApi.notion(file, params)
        : await importApi.obsidian(file, params)
      setResult(res)
      queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-700 p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div>
          <h3 className="font-semibold text-slate-100">{info.title}</h3>
          <p className="text-sm text-slate-400 mt-0.5">{info.desc}</p>
        </div>
      </div>

      <p className="text-xs text-slate-500 bg-slate-800/60 rounded-lg px-3 py-2">{info.hint}</p>

      {/* File drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${dragOver ? 'border-primary-400 bg-primary-500/10' : 'border-slate-600 hover:border-slate-500'}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
        <FolderOpen size={24} className="mx-auto mb-2 text-slate-500" />
        {file ? (
          <p className="text-sm text-primary-400 font-medium">{file.name}</p>
        ) : (
          <p className="text-sm text-slate-400">{s.dropHint}</p>
        )}
      </div>

      {/* Project selection */}
      <div className="flex gap-2">
        <button
          onClick={() => setProjectMode('new')}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${projectMode === 'new' ? 'border-primary-500 text-primary-400 bg-primary-500/10' : 'border-slate-600 text-slate-400 hover:border-slate-500'}`}
        >
          {s.newProject}
        </button>
        <button
          onClick={() => setProjectMode('existing')}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${projectMode === 'existing' ? 'border-primary-500 text-primary-400 bg-primary-500/10' : 'border-slate-600 text-slate-400 hover:border-slate-500'}`}
        >
          {s.selectProject}
        </button>
      </div>

      {projectMode === 'new' ? (
        <input
          type="text"
          value={newProjectName}
          onChange={e => setNewProjectName(e.target.value)}
          placeholder={s.newProjectName}
          className="input text-sm"
        />
      ) : (
        <select
          value={selectedProjectId}
          onChange={e => setSelectedProjectId(e.target.value)}
          className="input text-sm"
        >
          <option value="">{s.selectProject}...</option>
          {projects?.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      <button
        onClick={handleImport}
        disabled={!file || loading || (projectMode === 'existing' && !selectedProjectId)}
        className="btn btn-primary flex items-center justify-center gap-2 py-2 text-sm"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <FileInput size={14} />}
        {loading ? s.importing : s.startImport}
      </button>

      {result && (
        <div className="rounded-lg border border-slate-700 p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-green-400 font-medium text-sm">
            <CheckCircle2 size={16} />
            {s.result.success}
          </div>
          <div className="text-sm text-slate-300 flex flex-wrap gap-x-4 gap-y-1">
            <span>{s.result.created}: <span className="font-semibold text-white">{result.pagesCreated}</span></span>
            {result.tasksCreated > 0 && (
              <span>{s.result.tasksCreated ?? 'Tasks'}: <span className="font-semibold text-white">{result.tasksCreated}</span></span>
            )}
            {result.pagesSkipped > 0 && (
              <span className="text-slate-400">{s.result.skipped}: {result.pagesSkipped}</span>
            )}
          </div>
          {result.errors.length > 0 && (
            <details className="text-xs">
              <summary className="flex items-center gap-1 text-yellow-400 cursor-pointer">
                <AlertCircle size={12} /> {s.result.errors} ({result.errors.length})
              </summary>
              <ul className="mt-1 ml-4 text-slate-500 space-y-0.5 max-h-24 overflow-y-auto">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
          <button
            onClick={() => navigate(`/projects/${result.projectId}`)}
            className="flex items-center gap-1.5 text-sm text-primary-400 hover:text-primary-300 transition-colors w-fit"
          >
            {s.result.viewProject} <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

function ImportTab({ workspaceId }: { workspaceId: string }) {
  const t = useT()
  const { language } = useLanguageStore()
  const desc = language === 'en'
    ? 'Import pages and content from other tools. Page hierarchy is preserved.'
    : language === 'be'
    ? 'Імпарт старонак і кантэнту з іншых інструментаў. Іерархія старонак захоўваецца.'
    : 'Импорт страниц и контента из других инструментов. Иерархия страниц сохраняется.'
  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">{t.settings.importTab.title}</h2>
        <p className="text-sm text-slate-400 mt-1">{desc}</p>
      </div>
      <ImportCard source="notion" workspaceId={workspaceId} />
      <ImportCard source="obsidian" workspaceId={workspaceId} />
    </div>
  )
}
