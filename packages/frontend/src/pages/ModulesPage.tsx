import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, Loader2, Trash2, Upload, AlertTriangle, Plus } from 'lucide-react'
import { moduleApi } from '@/api/client'
import { Header } from '@/components/layout/Header'
import { Modal } from '@/components/common/Modal'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useLanguageStore } from '@/stores/languageStore'
import { pickLocalized } from '@/lib/localized'
import { renderIcon } from '@/components/common/EmojiPicker'
import { useT } from '@/i18n'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/utils'

export function ModulesPage() {
  const t = useT().modules
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { language } = useLanguageStore()
  const { currentWorkspaceId } = useWorkspaceStore()
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [importUrl, setImportUrl] = useState('')

  const [searchParams, setSearchParams] = useSearchParams()
  const autoRan = useRef(false)

  const { data: catalog = [], isLoading } = useQuery({ queryKey: ['modules-catalog'], queryFn: moduleApi.catalog })
  const { data: installed = [], isLoading: installedLoading } = useQuery({
    queryKey: ['modules-installed', currentWorkspaceId],
    queryFn: () => moduleApi.installed(currentWorkspaceId!),
    enabled: !!currentWorkspaceId,
  })
  // Everything the user actually has here — built-in installs AND custom modules,
  // which never appeared in the catalog. This is the manager list.
  const { data: mine = [] } = useQuery({
    queryKey: ['modules-mine', currentWorkspaceId],
    queryFn: () => moduleApi.mine(currentWorkspaceId!),
    enabled: !!currentWorkspaceId,
  })

  const refreshModules = () => {
    qc.invalidateQueries({ queryKey: ['modules-mine', currentWorkspaceId] })
    qc.invalidateQueries({ queryKey: ['modules-installed', currentWorkspaceId] })
    qc.invalidateQueries({ queryKey: ['projects', currentWorkspaceId] })
  }

  const removeMut = useMutation({
    mutationFn: (projectId: string) => moduleApi.remove(currentWorkspaceId!, projectId),
    onSuccess: refreshModules,
  })

  // Open a module the way the sidebar does: the growth module has its own wrapper
  // UI, every other module self-routes from its project page (to its overview if
  // it has registries, or the builder if it's still empty).
  const openModule = (m: { projectId: string; moduleId: string | null }) => {
    if (m.moduleId === 'personal-growth') { navigate('/growth'); return }
    navigate(`/projects/${m.projectId}`)
  }

  // The catalog is a storefront of what you can still add: installed modules live
  // in "My modules" above, so showing them here again is just duplication.
  const available = catalog.filter((m) => !installed.includes(m.moduleId))

  const installMut = useMutation({
    mutationFn: (moduleId: string) => moduleApi.install(currentWorkspaceId!, moduleId),
    onSuccess: (res) => {
      refreshModules()
      toast.success(t.installed)
      if (res.projectId) navigate(`/projects/${res.projectId}`)
    },
  })

  const importMut = useMutation({
    mutationFn: () => moduleApi.import(JSON.parse(importText)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modules-catalog'] })
      setImportOpen(false); setImportText('')
      toast.success(t.imported)
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const importUrlMut = useMutation({
    mutationFn: () => moduleApi.importUrl(importUrl.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modules-catalog'] })
      setImportOpen(false); setImportUrl('')
      toast.success(t.imported)
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const createMut = useMutation({
    mutationFn: () => moduleApi.createCustom(currentWorkspaceId!, createName.trim()),
    onSuccess: (res) => {
      refreshModules()
      setCreateOpen(false); setCreateName('')
      navigate(`/projects/${res.projectId}`)
    },
  })

  // Import a module by URL and install it in one go (for ?installUrl deep-links).
  const autoInstallUrlMut = useMutation({
    mutationFn: async (url: string) => {
      const imp = await moduleApi.importUrl(url)
      if (!imp.ok || !imp.moduleId) throw new Error('import_failed')
      return moduleApi.install(currentWorkspaceId!, imp.moduleId)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['modules-catalog'] })
      qc.invalidateQueries({ queryKey: ['modules-installed', currentWorkspaceId] })
      qc.invalidateQueries({ queryKey: ['projects', currentWorkspaceId] })
      toast.success(t.installed)
      if (res.projectId) navigate(`/projects/${res.projectId}`)
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  // Deep-link install from the landing storefront: /modules?install=<id> or
  // ?installUrl=<rawUrl>. Runs once everything needed is loaded.
  useEffect(() => {
    if (autoRan.current) return
    const installId = searchParams.get('install')
    const installUrlParam = searchParams.get('installUrl')
    if (!installId && !installUrlParam) return
    if (!currentWorkspaceId || isLoading || installedLoading) return
    autoRan.current = true
    const next = new URLSearchParams(searchParams)
    next.delete('install'); next.delete('installUrl')
    setSearchParams(next, { replace: true })
    if (installUrlParam) { autoInstallUrlMut.mutate(installUrlParam); return }
    if (installId) {
      if (installed.includes(installId)) toast.success(t.installedBadge)
      else if (catalog.some((m) => m.moduleId === installId)) installMut.mutate(installId)
      else toast.error(t.empty)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, currentWorkspaceId, isLoading, installedLoading, installed, catalog])

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t.title}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setCreateOpen(true)} disabled={!currentWorkspaceId} className="btn-ghost flex items-center gap-2 text-sm px-3 py-1.5">
              <Plus size={15} /> {t.createCustom}
            </button>
            <button onClick={() => setImportOpen(true)} className="btn-ghost flex items-center gap-2 text-sm px-3 py-1.5">
              <Upload size={15} /> {t.import}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          <p className="text-sm text-slate-400 mb-6">{t.subtitle}</p>

          {/* My modules — what's actually installed here, built-in and custom.
              Custom modules have no catalog card, so this is the only place they
              can be opened or deleted. */}
          {mine.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">{t.myModules}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {mine.map((m) => (
                  <div key={m.projectId} className="bg-surface-800 rounded-xl border border-slate-700 p-3 flex items-center gap-3">
                    <button onClick={() => openModule(m)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                      <div className="w-9 h-9 rounded-lg bg-primary-600/15 flex items-center justify-center text-primary-400 flex-shrink-0">
                        {renderIcon(m.icon, 18, 'text-primary-400', 'Boxes') ?? <Boxes size={18} />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-100 truncate hover:text-primary-300">{m.name}</p>
                        <p className="text-[11px] text-slate-500">{m.source === 'custom' ? t.custom : t.official}</p>
                      </div>
                    </button>
                    <button onClick={() => openModule(m)} className="btn-ghost text-xs px-2.5 py-1 flex-shrink-0">{t.open}</button>
                    <button
                      onClick={() => { if (confirm(t.removeConfirm)) removeMut.mutate(m.projectId) }}
                      disabled={removeMut.isPending}
                      className="p-1.5 rounded-lg hover:bg-red-900/30 text-slate-500 hover:text-red-400 flex-shrink-0" title={t.uninstall}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-500" /></div>
          ) : available.length === 0 ? (
            // Nothing left to add. Say so only when there is also nothing above,
            // so an all-installed instance doesn't look broken.
            mine.length === 0 ? <p className="text-sm text-slate-500">{t.empty}</p> : null
          ) : (
            <>
              {mine.length > 0 && <h2 className="text-sm font-semibold text-slate-300 mb-3">{t.catalogTitle}</h2>}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {available.map((m) => (
                  <div key={m.moduleId} className="bg-surface-800 rounded-xl border border-slate-700 p-4 flex flex-col">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-primary-600/15 flex items-center justify-center text-primary-400">
                        {renderIcon(m.icon, 20, 'text-primary-400', 'Boxes') ?? <Boxes size={20} />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-100 truncate">{pickLocalized(m.name, language)}</p>
                        <p className="text-[11px] text-slate-500">v{m.version} · {m.source === 'builtin' ? t.official : t.custom}</p>
                      </div>
                    </div>
                    {m.description && <p className="text-xs text-slate-400 flex-1">{pickLocalized(m.description, language)}</p>}
                    {m.disclaimer && (
                      <p className="text-[11px] text-amber-400/80 mt-2 flex items-start gap-1">
                        <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> {pickLocalized(m.disclaimer, language)}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => installMut.mutate(m.moduleId)}
                        disabled={installMut.isPending || !currentWorkspaceId}
                        className={cn('btn-primary text-sm px-3 py-1.5 flex items-center gap-2 w-full justify-center')}>
                        {installMut.isPending && installMut.variables === m.moduleId
                          ? <Loader2 size={14} className="animate-spin" /> : null}
                        {t.install}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t.createCustom}>
        <div className="space-y-3">
          <p className="text-xs text-slate-400">{t.createCustomHint}</p>
          <input autoFocus value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder={t.createCustomPlaceholder}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreateOpen(false)} className="btn-ghost text-sm px-3 py-1.5">{t.cancel}</button>
            <button onClick={() => createMut.mutate()} disabled={!createName.trim() || createMut.isPending} className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2">
              {createMut.isPending && <Loader2 size={14} className="animate-spin" />}{t.createBtn}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title={t.importTitle}>
          <div className="space-y-3">
            <p className="text-xs text-slate-400">{t.importUrlHint}</p>
            <div className="flex gap-2">
              <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://github.com/user/repo/blob/main/module.json"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200" />
              <button onClick={() => importUrlMut.mutate()} disabled={importUrlMut.isPending || !importUrl.trim()}
                className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2 whitespace-nowrap">
                {importUrlMut.isPending && <Loader2 size={14} className="animate-spin" />}{t.importFromUrl}
              </button>
            </div>
            <div className="text-center text-[11px] text-slate-600">— {t.or} —</div>
            <p className="text-xs text-slate-400">{t.importHint}</p>
            <textarea
              value={importText} onChange={(e) => setImportText(e.target.value)}
              rows={12} placeholder='{ "id": "my-module", "version": "1.0.0", ... }'
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setImportOpen(false)} className="btn-ghost text-sm px-3 py-1.5">{t.cancel}</button>
              <button onClick={() => importMut.mutate()} disabled={importMut.isPending || !importText.trim()}
                className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2">
                {importMut.isPending && <Loader2 size={14} className="animate-spin" />} {t.importBtn}
              </button>
            </div>
          </div>
        </Modal>
    </div>
  )
}
