import { useRef, useState, useEffect } from 'react'
import { stripLeadingEmoji } from '@/lib/displayText'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, FileText, CheckSquare, Calendar, Loader2,
  Trash2, Download, Folder, X, Pencil, Check, Archive, ArchiveRestore, Search, Activity, Boxes,
} from 'lucide-react'
import { AddCollectionModal } from '@/components/modules/SchemaEditor'
import { projectApi, pageApi, exportApi, collectionApi } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { Header } from '@/components/layout/Header'
import { formatDate } from '@/lib/utils'
import { useT } from '@/i18n'
import { ProjectHealthModal } from '@/components/ai/ProjectHealthModal'
import { systemProjectName } from '@/lib/projectName'
import { useLanguageStore } from '@/stores/languageStore'

export function ProjectPage() {
  const { language } = useLanguageStore()
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const t = useT()

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [pageSearch, setPageSearch] = useState('')
  const [healthOpen, setHealthOpen] = useState(false)
  const [moduleAddOpen, setModuleAddOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!exportOpen) return
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [exportOpen])

  const { setCurrentProject, currentWorkspaceId } = useWorkspaceStore()

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.getById(projectId!),
    enabled: !!projectId,
    retry: false,
    throwOnError: false,
  })

  useEffect(() => {
    if (!isLoading && !project && projectId) {
      setCurrentProject(null)
      navigate('/')
    } else if (project) {
      setCurrentProject(project.id)
    }
  }, [isLoading, project, projectId, setCurrentProject, navigate])

  // Module projects show their collections, not pages — jump to the first one.
  const { data: moduleCollections } = useQuery({
    queryKey: ['collections', projectId],
    queryFn: () => collectionApi.listByProject(projectId!),
    enabled: !!projectId && !!project?.isModule,
  })
  useEffect(() => {
    if (project?.isModule && moduleCollections && moduleCollections.length > 0) {
      navigate(`/projects/${project.id}/overview`, { replace: true })
    }
  }, [project, moduleCollections, navigate])

  const updateProject = useMutation({
    mutationFn: (data: { icon?: string | null; name?: string }) => projectApi.update(projectId!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const deleteProject = useMutation({
    mutationFn: () => projectApi.delete(projectId!),
    onSuccess: () => {
      // Project delete cascades on the backend — refresh everything that
      // could still show its pages/tasks/stats.
      for (const key of ['projects', 'recent-pages', 'dashboard-tasks', 'dashboard-stats', 'upcoming-events', 'graph', 'search', 'notes', 'attachments', 'files', 'canvas', 'canvases']) {
        qc.invalidateQueries({ queryKey: [key] })
      }
      navigate('/')
    },
  })

  const archiveProject = useMutation({
    mutationFn: (status: 'ACTIVE' | 'ARCHIVED') => projectApi.update(projectId!, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const createPage = useMutation({
    mutationFn: () => pageApi.create({ projectId: projectId!, title: t.pages.untitled }),
    onSuccess: (page) => {
      qc.invalidateQueries({ queryKey: ['pages', 'tree', projectId] })
      navigate(`/pages/${page.id}`)
    },
  })

  const deletePage = useMutation({
    mutationFn: (id: string) => pageApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['pages', 'tree', projectId] })
    },
  })

  function handleDeletePage(e: React.MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(t.pages.deleteConfirm)) return
    deletePage.mutate(id)
  }

  useEffect(() => {
    if (project && !editingName) setNameValue(project.name)
  }, [project, editingName])

  function startEditName() {
    setNameValue(project?.name ?? '')
    setEditingName(true)
    setTimeout(() => nameInputRef.current?.select(), 50)
  }

  function commitName() {
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== project?.name) {
      updateProject.mutate({ name: trimmed })
    }
    setEditingName(false)
  }

  function handleDelete() {
    if (!confirm(t.project.deleteConfirm)) return
    deleteProject.mutate()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-primary-500" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-500">{t.project.notFound}</p>
      </div>
    )
  }

  // Module project with no collections yet — show the builder empty state.
  if (project.isModule && moduleCollections && moduleCollections.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header title={project.name} />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <Boxes size={40} className="text-slate-600 mb-3" />
          <p className="text-slate-400 mb-4 max-w-sm">{t.modules.builderEmpty}</p>
          <button onClick={() => setModuleAddOpen(true)} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"><Plus size={16} /> {t.modules.addCollection}</button>
        </div>
        {moduleAddOpen && <AddCollectionModal projectId={project.id} onClose={() => setModuleAddOpen(false)} onCreated={(id) => navigate(`/projects/${project.id}/c/${id}`)} />}
      </div>
    )
  }

  const views = [
    { icon: CheckSquare, label: t.projectViews.tasks, path: 'tasks', count: project._count?.tasks },
    { icon: Calendar, label: t.projectViews.calendar, path: 'calendar', count: project._count?.calendarEvents },
  ]

  const titleElement = project.isSystem ? (
    // The system Inbox shows a localized name and can't be renamed.
    <span className="text-base font-semibold text-primary-300">{systemProjectName(language)}</span>
  ) : editingName ? (
    <div className="flex items-center gap-1.5">
      <input
        ref={nameInputRef}
        value={nameValue}
        onChange={(e) => setNameValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitName()
          if (e.key === 'Escape') setEditingName(false)
        }}
        onBlur={commitName}
        autoFocus
        className="bg-surface-800 border border-primary-500 rounded px-2 py-0.5 text-base font-semibold text-slate-100 focus:outline-none w-64"
      />
      <button onClick={commitName} className="p-1 text-primary-400 hover:text-primary-300">
        <Check size={14} />
      </button>
      <button onClick={() => setEditingName(false)} className="p-1 text-slate-500 hover:text-slate-300">
        <X size={14} />
      </button>
    </div>
  ) : (
    <button
      onClick={startEditName}
      className="group flex items-center gap-1.5 text-base font-semibold text-slate-100 hover:text-white"
      title={t.common.rename}
    >
      <span>{project.name}</span>
      <Pencil size={11} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
    </button>
  )

  return (
    <div className="flex flex-col h-full">
      <Header
        title={titleElement}
        actions={
          <div className="flex items-center gap-2">
            {/* AI Health */}
            <button
              onClick={() => setHealthOpen(true)}
              className="btn-ghost text-xs text-primary-400 hover:text-primary-300"
              title="AI Project Health"
            >
              <Activity size={13} /> AI
            </button>

            {/* Export dropdown */}
            <div className="relative" ref={exportRef}>
              <button className="btn-ghost text-xs" title={t.project.exportProject} onClick={() => setExportOpen((v) => !v)}>
                <Download size={13} /> {t.common.download}
              </button>
              {exportOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-surface-900 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[180px]">
                  <button
                    onClick={() => { exportApi.exportProjectZip(projectId!, project.name); setExportOpen(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors font-medium"
                  >
                    {t.project.exportZip}
                  </button>
                  <button
                    onClick={() => { exportApi.exportProjectBinary(projectId!, 'pdf', `${project.name}.pdf`); setExportOpen(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors font-medium"
                  >
                    {t.project.exportPdf}
                  </button>
                  <button
                    onClick={() => { exportApi.exportProjectBinary(projectId!, 'docx', `${project.name}.docx`); setExportOpen(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors font-medium"
                  >
                    {t.project.exportDocx}
                  </button>
                  <div className="border-t border-slate-800 my-1" />
                  <button
                    onClick={() => { exportApi.exportProject(projectId!, 'json'); setExportOpen(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 transition-colors"
                  >
                    {t.project.exportJson}
                  </button>
                  <button
                    onClick={() => { exportApi.exportProject(projectId!, 'md'); setExportOpen(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 transition-colors"
                  >
                    {t.project.exportMd}
                  </button>
                </div>
              )}
            </div>

            {/* Archive / Restore */}
            {project.status === 'ARCHIVED' ? (
              <button
                onClick={() => { if (confirm(t.project.restoreConfirm)) archiveProject.mutate('ACTIVE') }}
                disabled={archiveProject.isPending}
                className="btn-ghost text-xs text-emerald-500 hover:text-emerald-400 hover:bg-emerald-950/30"
                title={t.project.restore}
              >
                {archiveProject.isPending ? <Loader2 size={13} className="animate-spin" /> : <ArchiveRestore size={13} />}
                {t.project.restore}
              </button>
            ) : (
              <button
                onClick={() => { if (confirm(t.project.archiveConfirm)) archiveProject.mutate('ARCHIVED') }}
                disabled={archiveProject.isPending}
                className="btn-ghost text-xs text-slate-400 hover:text-amber-400 hover:bg-amber-950/30"
                title={t.project.archive}
              >
                {archiveProject.isPending ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                {t.project.archive}
              </button>
            )}

            {/* Delete project */}
            <button
              onClick={handleDelete}
              disabled={deleteProject.isPending}
              className="btn-ghost text-xs text-red-500 hover:text-red-400 hover:bg-red-950/30"
              title={t.project.delete}
            >
              {deleteProject.isPending
                ? <Loader2 size={13} className="animate-spin" />
                : <Trash2 size={13} />
              }
              {t.project.delete}
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 px-6 border-b border-slate-800">
        <button
          className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 border-primary-500 text-primary-400 -mb-px"
        >
          <FileText size={13} />{t.project.overview}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {true && (
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Project description (name already shown in header) */}
            {project.description && (
              <p className="text-slate-400 text-sm">{project.description}</p>
            )}

            {/* Views grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {views.map(({ icon: Icon, label, path, count }) => (
                <Link
                  key={path}
                  to={`/projects/${projectId}/${path}`}
                  className="flex items-center gap-3 p-4 bg-surface-900 border border-slate-800 rounded-xl
                             hover:border-slate-600 transition-colors duration-150 group"
                >
                  <Icon size={20} className="text-primary-500" />
                  <div>
                    <p className="font-medium text-slate-200 group-hover:text-white">{label}</p>
                    {count !== undefined && (
                      <p className="text-xs text-slate-500">{count} {t.project.entries}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {/* Pages list */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                  {t.project.pagesSection}
                </h2>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                    <input
                      type="text"
                      value={pageSearch}
                      onChange={(e) => setPageSearch(e.target.value)}
                      placeholder={t.common.search}
                      className="bg-surface-950 border border-slate-700 rounded-md pl-6 pr-2 py-1 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-primary-500 w-36"
                    />
                  </div>
                  <button onClick={() => createPage.mutate()} disabled={createPage.isPending} className="btn-ghost text-xs">
                    {createPage.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={13} />}
                    {t.project.newPage}
                  </button>
                </div>
              </div>

              {(project.pages?.length ?? 0) === 0 ? (
                <div className="text-center py-10 border border-dashed border-slate-800 rounded-xl">
                  <FileText size={32} className="mx-auto text-slate-700 mb-2" />
                  <p className="text-slate-500 text-sm">{t.project.noPages}</p>
                  <button
                    onClick={() => createPage.mutate()}
                    className="btn-primary mt-3 mx-auto"
                  >
                    <Plus size={14} /> {t.project.createFirstPage}
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  {(() => {
                    const pages = project.pages ?? []
                    const q = pageSearch.toLowerCase()
                    const roots = pages.filter((p) => !p.parentPageId && (!q || p.title.toLowerCase().includes(q)))
                    const childrenOf = (parentId: string) => pages.filter((p) => p.parentPageId === parentId)
                    return roots.map((page) => (
                      <div key={page.id}>
                        <Link
                          to={`/pages/${page.id}`}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors group"
                        >
                          {page.type === 'FOLDER'
                            ? <Folder size={16} className="text-amber-400 flex-shrink-0" />
                            : <FileText size={16} className="text-slate-400 flex-shrink-0" />
                          }
                          <span className="flex-1 text-sm text-slate-300 group-hover:text-white truncate">{stripLeadingEmoji(page.title)}</span>
                          {page.type === 'FOLDER' && childrenOf(page.id).length > 0 && (
                            <span className="text-[10px] text-slate-600 group-hover:text-slate-500">{childrenOf(page.id).length}</span>
                          )}
                          <span className="text-xs text-slate-600 group-hover:text-slate-400">{formatDate(page.updatedAt ?? '')}</span>
                          <button
                            onClick={(e) => handleDeletePage(e, page.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 -my-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition-all"
                            title={t.pages.delete}
                          >
                            <Trash2 size={13} />
                          </button>
                        </Link>
                        {page.type === 'FOLDER' && childrenOf(page.id).map((child) => (
                          <Link
                            key={child.id}
                            to={`/pages/${child.id}`}
                            className="flex items-center gap-3 pl-8 pr-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors group"
                          >
                            <FileText size={14} className="text-slate-500 flex-shrink-0" />
                            <span className="flex-1 text-sm text-slate-400 group-hover:text-white truncate">{stripLeadingEmoji(child.title)}</span>
                            <button
                              onClick={(e) => handleDeletePage(e, child.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 -my-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition-all"
                              title={t.pages.delete}
                            >
                              <Trash2 size={13} />
                            </button>
                          </Link>
                        ))}
                      </div>
                    ))
                  })()}
                </div>
              )}
            </section>
          </div>
        )}

      </div>

      {healthOpen && (
        <ProjectHealthModal
          projectId={projectId!}
          workspaceId={currentWorkspaceId!}
          projectName={project.name}
          onClose={() => setHealthOpen(false)}
        />
      )}
    </div>
  )
}

