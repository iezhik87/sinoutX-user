import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LayoutDashboard, FolderKanban, Calendar, BookOpen,
  Settings, CreditCard, ChevronDown, ChevronRight, Plus, Hash, Loader2, Search, Network, StickyNote, X, FileText, LogOut, User, Paperclip, Archive, BrainCircuit, ShieldCheck, Layers, Inbox, Boxes, Table2, Share2, Users2,
} from 'lucide-react'
import { workspaceApi, projectApi, collectionApi, moduleApi, planApi, walletApi, type Workspace, type Project } from '@/api/client'
import { useLanguageStore } from '@/stores/languageStore'
import { pickLocalized } from '@/lib/localized'
import { projectDisplayName } from '@/lib/projectName'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { ShareProjectModal } from '@/components/project/ShareProjectModal'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useFavoritesStore } from '@/stores/favoritesStore'
import { useUIStore } from '@/stores/uiStore'
import { useIsSolo } from '@/stores/instanceStore'
import { useAuthStore } from '@/stores/authStore'
import { useT } from '@/i18n'
import { NavigationTree } from './NavigationTree'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/common/Modal'

const SIDEBAR_WIDTH_KEY = 'sidebar-width'
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 260

function getSavedWidth(): number {
  try {
    const v = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    return v ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, parseInt(v))) : SIDEBAR_DEFAULT
  } catch { return SIDEBAR_DEFAULT }
}

export function Sidebar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const qc = useQueryClient()
  const { setSidebarOpen } = useUIStore()
  const { user: currentUser } = useAuthStore()
  const solo = useIsSolo()
  // Solo self-hosted edition has no admin panel at all.
  const isAdmin = !solo && (currentUser?.role === 'OWNER' || currentUser?.role === 'ADMIN')

  const [width, setWidth] = useState(getSavedWidth)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, dragRef.current.startWidth + me.clientX - dragRef.current.startX))
      setWidth(next)
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [width])

  // Persist width to localStorage whenever it changes
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width)) } catch {}
  }, [width])

  // Reactive viewport check so rotation / resize toggles the overlay layout.
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Close sidebar on mobile when navigating — but NOT on mount, otherwise the
  // drawer closes itself the instant it opens (it mounts only when opened).
  const firstPathRun = useRef(true)
  useEffect(() => {
    if (firstPathRun.current) { firstPathRun.current = false; return }
    if (isMobile) setSidebarOpen(false)
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  const { currentWorkspaceId, currentProjectId, setCurrentWorkspace, setCurrentProject } =
    useWorkspaceStore()

  const t = useT()
  const { language } = useLanguageStore()

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [newName, setNewName] = useState('')
  const [wsToDelete, setWsToDelete] = useState<Workspace | null>(null)
  const [archiveExpanded, setArchiveExpanded] = useState(false)
  const [projCollapsed, setProjCollapsed] = useState(() => localStorage.getItem('sb_proj_collapsed') === '1')
  const [modCollapsed, setModCollapsed] = useState(() => localStorage.getItem('sb_mod_collapsed') === '1')
  const toggleProjCollapsed = () => setProjCollapsed((v) => { localStorage.setItem('sb_proj_collapsed', v ? '0' : '1'); return !v })
  const toggleModCollapsed = () => setModCollapsed((v) => { localStorage.setItem('sb_mod_collapsed', v ? '0' : '1'); return !v })

  // Workspaces. Coerce to an array defensively: if the API ever answers with a
  // non-array (e.g. an HTML error page when the backend is down), a bare
  // `.filter` here would white-screen the whole app, not just fail to load data.
  const { data: workspacesData, isLoading: wsLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: workspaceApi.list,
    staleTime: 30_000,
  })
  const workspaces = Array.isArray(workspacesData) ? workspacesData : []

  const personalWs = workspaces.find((w) => w.isPersonal) ?? workspaces[0]

  // Single-workspace model: always operate in the user's Personal workspace.
  useEffect(() => {
    if (wsLoading || !personalWs) return
    if (currentWorkspaceId !== personalWs.id) setCurrentWorkspace(personalWs.id)
  }, [personalWs, wsLoading, currentWorkspaceId, setCurrentWorkspace])

  // Projects shared WITH me (other users' projects, single-workspace model)
  const { data: sharedProjectsData } = useQuery({
    queryKey: ['projects-shared'],
    queryFn: projectApi.listShared,
    staleTime: 30_000,
  })
  const sharedProjects = Array.isArray(sharedProjectsData) ? sharedProjectsData : []

  // Projects
  const { data: projectsData } = useQuery({
    queryKey: ['projects', currentWorkspaceId],
    queryFn: () => projectApi.listByWorkspace(currentWorkspaceId!),
    enabled: !!currentWorkspaceId,
    staleTime: 30_000,
  })
  const projects = Array.isArray(projectsData) ? projectsData : []

  // Clear stale currentProjectId if project no longer exists in the list
  useEffect(() => {
    if (projects.length > 0 && currentProjectId && !projects.find((p: { id: string }) => p.id === currentProjectId)) {
      setCurrentProject(null)
    }
  }, [projects, currentProjectId, setCurrentProject])

  // Delete workspace
  const deleteWs = useMutation({
    mutationFn: (id: string) => workspaceApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      if (wsToDelete?.id === currentWorkspaceId) {
        const next = workspaces.find((w: Workspace) => w.id !== wsToDelete?.id)
        setCurrentWorkspace(next?.id ?? null)
      }
      setWsToDelete(null)
    },
  })

  // Create workspace
  const createWs = useMutation({
    mutationFn: (name: string) => workspaceApi.create({ name }),
    onSuccess: (ws) => {
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      setCurrentWorkspace(ws.id)
      setShowCreateWorkspace(false)
      setNewName('')
    },
  })

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isMobile && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={cn(
          'flex flex-col h-screen overflow-hidden relative flex-shrink-0',
          isMobile && 'fixed left-0 top-0 z-40',
        )}
        style={{
          width: isMobile ? 'min(85vw, 320px)' : width,
          background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        {/* Resize handle (desktop only) */}
        {!isMobile && (
          <div
            onMouseDown={onMouseDown}
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 group hover:bg-primary-500/30 transition-colors"
          />
        )}
        {/* Single-workspace model: the header is the USER (account + logout),
            not a workspace name. Collaboration is via sharing projects. */}
        <UserBadge />

        {/* Empty state — no workspaces */}
        {!wsLoading && workspaces.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 text-center">
            <FolderKanban size={32} className="text-slate-600 mb-3" />
            <p className="text-sm font-medium text-slate-400 mb-1">{t.workspace.members.noWorkspace}</p>
            <p className="text-xs text-slate-600 mb-4">{t.workspace.members.noWorkspaceDesc}</p>
            <button onClick={() => setShowCreateWorkspace(true)} className="btn btn-primary text-xs px-3 py-1.5">
              <Plus size={12} /> {t.workspace.members.createFirst}
            </button>
          </div>
        )}

        {/* Nav */}
        {workspaces.length > 0 && <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {/* Search button */}
          <button
            onClick={onOpenSearch}
            className="sidebar-item w-full mb-1"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <Search size={13} className="text-slate-500" />
            <span className="flex-1 text-left text-slate-500">{t.sidebar.search}...</span>
          </button>

          {/* Global views */}
          <Link
            to="/"
            className={cn('sidebar-item', pathname === '/' && 'active')}
          >
            <LayoutDashboard size={15} />
            <span>{t.sidebar.dashboard}</span>
          </Link>

          <Link to="/canvas" className={cn('sidebar-item', pathname.startsWith('/canvas') && 'active')}>
            <Layers size={15} />
            <span>{t.canvas.title}</span>
          </Link>

          <Link to="/files" className={cn('sidebar-item', pathname === '/files' && 'active')}>
            <Paperclip size={15} />
            <span>{t.sidebar.files}</span>
          </Link>

          {/* Personal Growth now appears in the Modules list below (feature module). */}

          <Link to="/templates" className={cn('sidebar-item', pathname === '/templates' && 'active')}>
            <FileText size={15} />
            <span>{t.sidebar.templates}</span>
          </Link>

          <Link to="/modules" className={cn('sidebar-item', pathname === '/modules' && 'active')}>
            <Boxes size={15} />
            <span>{t.sidebar.modules}</span>
          </Link>

          {/* Favorites */}
          <FavoritesSection />

          {/* Projects */}
          {currentWorkspaceId && (
            <div className="mt-3">
              <div className="flex items-center justify-between px-2 mb-1">
                <button onClick={toggleProjCollapsed} className="flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-300">
                  {projCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  {t.sidebar.projects}
                </button>
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="btn-ghost p-0.5"
                  title={t.sidebar.newProject}
                >
                  <Plus size={13} />
                </button>
              </div>

              {!projCollapsed && <>
              {/* System project (assistant) pinned on top, separated by a line */}
              {projects.filter((p) => p.status !== 'ARCHIVED' && p.isSystem).map((p) => (
                <ProjectItem
                  key={p.id}
                  project={p}
                  isActive={p.id === currentProjectId}
                  isExpanded={expandedProjects.has(p.id)}
                  onToggle={() => toggleProject(p.id)}
                  onSelect={() => {
                    setCurrentProject(p.id)
                    navigate(`/projects/${p.id}`)
                  }}
                />
              ))}
              {projects.some((p) => p.status !== 'ARCHIVED' && p.isSystem) &&
                projects.some((p) => p.status !== 'ARCHIVED' && !p.isSystem) && (
                <div className="border-t border-slate-800 my-1.5 mx-2" />
              )}

              {projects.filter((p) => p.status !== 'ARCHIVED' && !p.isSystem && !p.isModule).map((p) => (
                <ProjectItem
                  key={p.id}
                  project={p}
                  isActive={p.id === currentProjectId}
                  isExpanded={expandedProjects.has(p.id)}
                  onToggle={() => toggleProject(p.id)}
                  onSelect={() => {
                    setCurrentProject(p.id)
                    navigate(`/projects/${p.id}`)
                  }}
                />
              ))}

              {projects.filter((p) => p.status !== 'ARCHIVED' && !p.isSystem && !p.isModule).length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-600">{t.sidebar.noProjects}</p>
              )}
              </>}

              {/* Modules — separated from projects, with a + to the store */}
              <div className="border-t border-slate-800 my-2 mx-2" />
              <div className="flex items-center justify-between px-2 mb-1">
                <button onClick={toggleModCollapsed} className="flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-300">
                  {modCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  {t.sidebar.modules}
                </button>
                <button onClick={() => navigate('/modules')} className="btn-ghost p-0.5" title={t.modules.title}>
                  <Plus size={13} />
                </button>
              </div>
              {!modCollapsed && <>
              {projects.filter((p) => p.status !== 'ARCHIVED' && p.isModule).map((p) => (
                <ProjectItem
                  key={p.id}
                  project={p}
                  isActive={p.id === currentProjectId}
                  isExpanded={expandedProjects.has(p.id)}
                  onToggle={() => toggleProject(p.id)}
                  onSelect={() => {
                    if (p.moduleId === 'personal-growth') { navigate('/growth'); return }
                    setCurrentProject(p.id)
                    navigate(`/projects/${p.id}`)
                  }}
                />
              ))}
              {projects.filter((p) => p.status !== 'ARCHIVED' && p.isModule).length === 0 && (
                <button onClick={() => navigate('/modules')} className="px-3 py-2 text-xs text-slate-600 hover:text-slate-400 text-left w-full">
                  {t.sidebar.noModules}
                </button>
              )}
              </>}

              {/* Shared with me — projects from other users (single-workspace model) */}
              {sharedProjects.length > 0 && (
                <>
                  <div className="border-t border-slate-800 my-2 mx-2" />
                  <div className="flex items-center gap-1.5 px-2 mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <Users2 size={12} /> {language === 'en' ? 'Shared with me' : language === 'be' ? 'Даступна мне' : 'Доступно мне'}
                  </div>
                  {sharedProjects.map((p) => (
                    <ProjectItem
                      key={p.id}
                      project={p}
                      isActive={p.id === currentProjectId}
                      isExpanded={expandedProjects.has(p.id)}
                      onToggle={() => toggleProject(p.id)}
                      onSelect={() => { setCurrentProject(p.id); navigate(`/projects/${p.id}`) }}
                    />
                  ))}
                </>
              )}

              {/* Archive section */}
              {projects.some((p) => p.status === 'ARCHIVED') && (
                <div className="mt-1">
                  <button
                    onClick={() => setArchiveExpanded((v) => !v)}
                    className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-slate-600 hover:text-slate-400 transition-colors"
                  >
                    {archiveExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    <Archive size={11} />
                    {t.sidebar.archivedProjects}
                    <span className="ml-auto text-slate-700">{projects.filter((p) => p.status === 'ARCHIVED').length}</span>
                  </button>
                  {archiveExpanded && projects.filter((p) => p.status === 'ARCHIVED').map((p) => (
                    <ProjectItem
                      key={p.id}
                      project={p}
                      isActive={p.id === currentProjectId}
                      isExpanded={expandedProjects.has(p.id)}
                      onToggle={() => toggleProject(p.id)}
                      onSelect={() => {
                        setCurrentProject(p.id)
                        navigate(`/projects/${p.id}`)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>}

        {/* Bottom nav — Settings moved up into the user badge; only the admin
            entry remains here, so show the strip only when there is one. */}
        {isAdmin && (
          <div className="px-2 py-2 space-y-0.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <Link to="/admin" className={cn('sidebar-item', pathname === '/admin' && 'active')}>
              <ShieldCheck size={15} />
              <span>{t.sidebar.admin}</span>
            </Link>
          </div>
        )}

      </aside>

      {/* Create workspace modal */}
      <Modal open={showCreateWorkspace} onClose={() => setShowCreateWorkspace(false)} title={t.sidebar.newWorkspace}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (newName.trim()) createWs.mutate(newName.trim())
          }}
          className="space-y-4"
        >
          <input
            autoFocus
            type="text"
            placeholder={t.sidebar.workspaceName}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="nb-input w-full"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreateWorkspace(false)} className="btn-ghost">
              {t.common.cancel}
            </button>
            <button type="submit" disabled={!newName.trim() || createWs.isPending} className="btn-primary">
              {createWs.isPending ? <Loader2 size={14} className="animate-spin" /> : t.common.create}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete workspace confirmation */}
      <Modal open={!!wsToDelete} onClose={() => setWsToDelete(null)} title={t.sidebar.deleteWorkspace}>
        <p className="text-sm text-slate-400 mb-4">
          {wsToDelete && <>«{wsToDelete.name}»</>}
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={() => setWsToDelete(null)} className="btn-ghost">{t.common.cancel}</button>
          <button
            onClick={() => wsToDelete && deleteWs.mutate(wsToDelete.id)}
            disabled={deleteWs.isPending}
            className="btn-danger"
          >
            {deleteWs.isPending ? <Loader2 size={14} className="animate-spin" /> : t.common.delete}
          </button>
        </div>
      </Modal>

      {/* Create project modal (shared with Dashboard) */}
      <CreateProjectModal open={showCreateProject} onClose={() => setShowCreateProject(false)} />
    </>
  )
}

function UserBadge() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // The tier names the account (self-hosted / cloud / team); the wallet balance
  // only means anything where a managed model bills it, so it is fetched lazily
  // and shown only when the instance actually charges.
  const { data: tier } = useQuery({ queryKey: ['account-tier'], queryFn: planApi.get, staleTime: 60_000 })
  const { data: wallet } = useQuery({
    queryKey: ['badge-wallet'], queryFn: walletApi.get, staleTime: 30_000, enabled: !!tier?.billed,
  })
  const p = t.settings.plan
  const tierLabel = tier ? (tier.tier === 'team' ? p.tierTeam : tier.tier === 'cloud' ? p.tierCloud : p.tierSelf) : null

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!user) return null

  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div ref={ref} className="relative px-2 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {/* Popover */}
      {open && (
        <div
          className="absolute top-full left-2 right-2 mt-1 rounded-xl shadow-2xl overflow-hidden z-50"
          style={{ background: 'var(--bg-elevated, #1e293b)', border: '1px solid var(--border-default, #334155)' }}
        >
          {/* User info */}
          <div className="flex items-center gap-3 px-3 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="w-9 h-9 rounded-full bg-primary-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
              {initials || <User size={16} />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-100 truncate">{user.name}</p>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
            </div>
          </div>
          {/* Personal settings — an account matter, so it lives under the account
              name next to plan and logout, not adrift in the nav. */}
          <button
            onClick={() => { setOpen(false); navigate('/settings') }}
            className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-700/40 transition-colors"
          >
            <Settings size={14} />
            {t.settings.title}
          </button>

          {/* Plan & payment — money is an account matter, so it lives under the
              account name, not in a Settings tab nobody opens. */}
          <button
            onClick={() => { setOpen(false); navigate('/billing') }}
            className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-700/40 transition-colors"
          >
            <CreditCard size={14} />
            {t.settings.tabs.plan}
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut size={14} />
            {t.settings.apikeys.logout}
          </button>
        </div>
      )}

      {/* Badge button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 w-full rounded-lg px-2 py-1.5 transition-colors',
          open
            ? 'bg-slate-700/60'
            : 'hover:bg-slate-800/60',
        )}
      >
        <div className="w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
          {initials || <User size={12} />}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-xs font-medium text-slate-200 truncate leading-tight">{user.name}</p>
          <p className="text-[10px] text-slate-500 truncate leading-tight flex items-center gap-1.5">
            {tierLabel && <span className="text-slate-400">{tierLabel}</span>}
            {tier?.billed && wallet && (
              <span className="tabular-nums text-slate-500">
                · ${wallet.balanceUsd >= 1 ? wallet.balanceUsd.toFixed(2) : wallet.balanceUsd.toFixed(3)}
              </span>
            )}
          </p>
        </div>
        <LogOut size={13} className="text-slate-600 flex-shrink-0" />
      </button>
    </div>
  )
}

function FavoritesSection() {
  const { favorites, remove } = useFavoritesStore()
  const { pathname } = useLocation()
  const t = useT()

  if (favorites.length === 0) return null

  return (
    <div className="mt-3">
      <div className="px-2 mb-1">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t.sidebar.favorites}</span>
      </div>
      {favorites.map((fav) => (
        <div key={fav.id} className="group relative">
          <Link
            to={fav.url}
            className={cn('sidebar-item pr-6', pathname === fav.url && 'active')}
          >
            <FileText size={13} className="text-slate-400 flex-shrink-0" />
            <span className="flex-1 truncate text-xs">{fav.title}</span>
          </Link>
          <button
            onClick={(e) => { e.preventDefault(); remove(fav.id) }}
            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}


function ProjectItem({
  project,
  isActive,
  isExpanded,
  onToggle,
  onSelect,
}: {
  project: Project
  isActive: boolean
  isExpanded: boolean
  onToggle: () => void
  onSelect: () => void
}) {
  const { pathname } = useLocation()
  const t = useT()
  const { language } = useLanguageStore()
  const solo = useIsSolo()
  const [shareOpen, setShareOpen] = useState(false)
  // Module name follows the UI language (from the catalog manifest); regular
  // projects keep their stored name regardless of language.
  const { data: catalog = [] } = useQuery({
    queryKey: ['modules-catalog'], queryFn: moduleApi.catalog, enabled: !!project.isModule,
  })
  const displayName = projectDisplayName(project, language, catalog)

  const PROJECT_VIEWS = [
    { icon: BookOpen,    label: t.projectViews.pages,    path: 'pages' },
    { icon: Paperclip,  label: t.projectViews.sources,  path: 'sources' },
    { icon: Hash,        label: t.projectViews.tasks,    path: 'tasks' },
    { icon: StickyNote,  label: t.projectViews.notes,    path: 'notes' },
    { icon: Network,     label: t.projectViews.graph,    path: 'graph' },
    { icon: Calendar,    label: t.projectViews.calendar, path: 'calendar' },
    { icon: BrainCircuit, label: t.projectViews.memory,  path: 'memory' },
  ]

  return (
    <div>
      <div className={cn('sidebar-item group', isActive && 'active')}>
        <button onClick={onToggle} className="flex-shrink-0 text-slate-500">
          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="flex-shrink-0 text-base leading-none">
          {project.isModule
            ? <Boxes size={15} className="text-primary-400" />
            : project.isSystem
              ? <Inbox size={15} className="text-primary-400" />
              : <FolderKanban size={15} className="text-slate-400" />}
        </span>
        <span className={cn('flex-1 truncate', (project.isSystem || project.isModule) && 'text-primary-300')} onClick={onSelect}>
          {displayName}
        </span>
        {!project.isSystem && !solo && (
          <button
            onClick={(e) => { e.stopPropagation(); setShareOpen(true) }}
            className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-primary-300 flex-shrink-0 transition-all"
            title={language === 'en' ? 'Share project' : 'Поделиться проектом'}
          >
            <Share2 size={12} />
          </button>
        )}
      </div>
      {shareOpen && <ShareProjectModal projectId={project.id} projectName={displayName} open={shareOpen} onClose={() => setShareOpen(false)} />}

      {isExpanded && (
        project.moduleId === 'personal-growth' ? (
          <div className="ml-4 pl-1 space-y-0.5" style={{ borderLeft: '1px solid var(--border-subtle)' }}>
            {[
              { tab: 'habits', label: language === 'en' ? 'Habits' : language === 'be' ? 'Звычкі' : 'Привычки' },
              { tab: 'goals', label: language === 'en' ? 'Goals' : language === 'be' ? 'Мэты' : 'Цели' },
              { tab: 'journal', label: language === 'en' ? 'Journal' : language === 'be' ? 'Дзённік' : 'Дневник' },
            ].map((v) => (
              <Link key={v.tab} to={`/growth?tab=${v.tab}`}
                className={cn('sidebar-item w-full text-sm', pathname.startsWith('/growth') && new URLSearchParams(window.location.search).get('tab') === v.tab && 'active')}>
                <span className="truncate">{v.label}</span>
              </Link>
            ))}
          </div>
        ) : project.isModule ? (
          <div className="ml-4 pl-1" style={{ borderLeft: '1px solid var(--border-subtle)' }}>
            <ModuleCollectionsNav projectId={project.id} />
          </div>
        ) : (
        <div className="ml-4 pl-1 space-y-0.5" style={{ borderLeft: '1px solid var(--border-subtle)' }}>
          {/* Project views — icon row */}
          <div className="flex items-center gap-0.5 px-1 py-1">
            {PROJECT_VIEWS.map(({ icon: Icon, label, path }) => {
              const active = pathname === `/projects/${project.id}/${path}`
              return (
                <Link
                  key={path}
                  to={`/projects/${project.id}/${path}`}
                  title={label}
                  className={cn(
                    'flex items-center justify-center w-6 h-6 rounded transition-colors',
                    active
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800',
                  )}
                >
                  <Icon size={13} />
                </Link>
              )
            })}
          </div>

          {/* Pages tree */}
          <div className="mt-1 pt-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <NavigationTree projectId={project.id} />
          </div>
        </div>
        )
      )}
    </div>
  )
}

// Collections of an installed module, listed as nav items.
function ModuleCollectionsNav({ projectId }: { projectId: string }) {
  const { pathname } = useLocation()
  const { language } = useLanguageStore()
  const { data: collections = [] } = useQuery({
    queryKey: ['collections', projectId],
    queryFn: () => collectionApi.listByProject(projectId),
  })
  const overviewTo = `/projects/${projectId}/overview`
  return (
    <div className="py-1 space-y-0.5">
      <Link to={overviewTo}
        className={cn('flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors',
          pathname === overviewTo ? 'bg-primary-500/20 text-primary-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800')}>
        <LayoutDashboard size={13} className="flex-shrink-0" />
        <span className="truncate">{language === 'en' ? 'Overview' : language === 'be' ? 'Агляд' : 'Обзор'}</span>
      </Link>
      {collections.length === 0 && <p className="text-xs text-slate-600 px-2 py-1.5">—</p>}
      {collections.map((c) => {
        const to = `/projects/${projectId}/c/${c.id}`
        const active = pathname === to
        return (
          <Link key={c.id} to={to}
            className={cn('flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors',
              active ? 'bg-primary-500/20 text-primary-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800')}>
            <Table2 size={13} className="flex-shrink-0" />
            <span className="truncate">{pickLocalized(c.name, language)}</span>
          </Link>
        )
      })}
    </div>
  )
}
