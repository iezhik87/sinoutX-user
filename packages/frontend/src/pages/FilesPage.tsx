import { useRef, useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Download, Trash2, Loader2, Search, FolderKanban, Unlink, FileText, FileImage, FileVideo, FileAudio, FileSpreadsheet, FileArchive, FileCode, FileJson, File, ArrowUpDown, Link2 } from 'lucide-react'
import { uploadApi, projectApi, type Attachment } from '@/api/client'
import { FileViewer } from '@/components/sources/FileViewer'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useLanguageStore } from '@/stores/languageStore'
import { getDateLocale } from '@/i18n/dateLocale'
import { formatDistanceToNow } from 'date-fns'
import { Header } from '@/components/layout/Header'
import { useT } from '@/i18n'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function FileTypeIcon({ mime, filename }: { mime: string; filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const s = 28

  if (mime.includes('pdf'))
    return <FileText size={s} style={{ color: '#ef4444' }} />
  if (mime.startsWith('image/'))
    return <FileImage size={s} style={{ color: '#8b5cf6' }} />
  if (mime.startsWith('video/'))
    return <FileVideo size={s} style={{ color: '#f59e0b' }} />
  if (mime.startsWith('audio/'))
    return <FileAudio size={s} style={{ color: '#ec4899' }} />
  if (mime.includes('sheet') || mime.includes('excel') || ext === 'xlsx' || ext === 'xls' || ext === 'csv')
    return <FileSpreadsheet size={s} style={{ color: '#22c55e' }} />
  if (mime.includes('word') || mime.includes('document') || ext === 'docx' || ext === 'doc')
    return <FileText size={s} style={{ color: '#3b82f6' }} />
  if (mime.includes('presentation') || ext === 'pptx' || ext === 'ppt')
    return <FileText size={s} style={{ color: '#f97316' }} />
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z') || mime.includes('tar') || mime.includes('gzip'))
    return <FileArchive size={s} style={{ color: '#a16207' }} />
  if (ext === 'json' || mime.includes('json'))
    return <FileJson size={s} style={{ color: '#f59e0b' }} />
  if (['js','ts','jsx','tsx','py','go','rs','java','cpp','c','cs','php','rb','swift','kt'].includes(ext))
    return <FileCode size={s} style={{ color: '#06b6d4' }} />
  if (mime.startsWith('text/') || ['txt','md','log','csv','xml','yaml','yml','toml','ini','env'].includes(ext))
    return <FileText size={s} style={{ color: '#94a3b8' }} />
  return <File size={s} style={{ color: '#64748b' }} />
}

type SortKey = 'name' | 'ext' | 'date'

function getExt(filename: string) {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

export function FilesPage({ projectId: initialProjectId }: { projectId?: string } = {}) {
  const qc = useQueryClient()
  const t = useT()
  const { language } = useLanguageStore()
  const { currentWorkspaceId } = useWorkspaceStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [filterProject, setFilterProject] = useState<string | null>(initialProjectId ?? null)
  const [viewingFile, setViewingFile] = useState<Attachment | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortAsc, setSortAsc] = useState(false)

  const UNATTACHED = '__unattached__'

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['attachments', currentWorkspaceId],
    queryFn: () => uploadApi.list({ workspaceId: currentWorkspaceId! }),
    enabled: !!currentWorkspaceId,
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', currentWorkspaceId],
    queryFn: () => projectApi.listByWorkspace(currentWorkspaceId!),
    enabled: !!currentWorkspaceId,
    staleTime: 60_000,
  })

  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))

  const deleteMutation = useMutation({
    mutationFn: (id: string) => uploadApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments', currentWorkspaceId] }),
  })

  const attachMutation = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string | null }) =>
      uploadApi.update(id, { projectId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments', currentWorkspaceId] }),
  })

  async function uploadFile(file: File) {
    if (!currentWorkspaceId) return
    setUploading(true)
    try {
      await uploadApi.upload(file, currentWorkspaceId)
      qc.invalidateQueries({ queryKey: ['attachments', currentWorkspaceId] })
    } finally {
      setUploading(false)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) await uploadFile(file)
  }, [currentWorkspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const unattachedCount = files.filter((f) => !f.projectId).length

  const filtered = files.filter((f) => {
    const matchesSearch = f.filename.toLowerCase().includes(search.toLowerCase()) ||
      (f.description ?? '').toLowerCase().includes(search.toLowerCase())
    const matchesProject =
      filterProject === null ? true :
      filterProject === UNATTACHED ? !f.projectId :
      f.projectId === filterProject
    return matchesSearch && matchesProject
  })

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'name') cmp = a.filename.localeCompare(b.filename)
    else if (sortKey === 'ext') cmp = getExt(a.filename).localeCompare(getExt(b.filename))
    else cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    return sortAsc ? cmp : -cmp
  })

  const projectsWithFiles = projects.filter((p) => files.some((f) => f.projectId === p.id))

  const allFilteredSelected = filtered.length > 0 && filtered.every((f) => selected.has(f.id))

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((f) => f.id)))
    }
  }

  function handleSortClick(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  async function handleBulkDelete() {
    if (!confirm(t.files.deleteSelectedConfirm.replace('{count}', String(selected.size)))) return
    setBulkDeleting(true)
    try {
      for (const id of selected) {
        await uploadApi.delete(id)
      }
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ['attachments', currentWorkspaceId] })
    } finally {
      setBulkDeleting(false)
    }
  }

  const sortLabels: Record<SortKey, string> = { name: t.files.sortName, ext: t.files.sortExt, date: t.files.sortDate }

  return (
    <div className="flex flex-col h-full">
      {viewingFile && <FileViewer file={viewingFile} onClose={() => setViewingFile(null)} />}
      <Header
        title={t.sidebar.files}
        actions={
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
            {selected.size > 0 && (
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-all"
              >
                {bulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {t.files.deleteSelected} {selected.size}
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="btn-primary"
            >
              {uploading
                ? <><Loader2 size={14} className="animate-spin" /> {t.settings.files.uploading}</>
                : <><Upload size={14} /> {t.settings.files.upload}</>}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">

          {/* Title + stats */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold" style={{ color: 'var(--text-heading)' }}>
                {t.sidebar.files}
              </h1>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {files.length} {t.settings.files.description}
              </p>
            </div>
          </div>

          {/* Toolbar: search + sort */}
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.sidebar.search + '...'}
                className="w-full rounded-xl text-sm outline-none transition-all focus:ring-2 focus:ring-primary-500/40"
                style={{
                  paddingLeft: '2.25rem',
                  paddingRight: '0.75rem',
                  paddingTop: '0.5rem',
                  paddingBottom: '0.5rem',
                  color: 'var(--text-primary)',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--border-default)',
                }}
              />
            </div>
            {/* Sort buttons */}
            <div className="flex items-center gap-1">
              {(['name', 'ext', 'date'] as SortKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => handleSortClick(key)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all"
                  style={{
                    background: sortKey === key ? 'var(--border-default)' : 'var(--card-bg)',
                    border: '1px solid var(--border-subtle)',
                    color: sortKey === key ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  <ArrowUpDown size={11} />
                  {sortLabels[key]}
                  {sortKey === key && (sortAsc ? ' ↑' : ' ↓')}
                </button>
              ))}
            </div>
          </div>

          {/* Project filter chips */}
          {(projectsWithFiles.length > 0 || unattachedCount > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap mb-4">
              <button
                onClick={() => setFilterProject(null)}
                className="text-xs px-2.5 py-1 rounded-full transition-all"
                style={{
                  background: filterProject === null ? 'var(--border-default)' : 'var(--card-bg)',
                  border: '1px solid var(--border-subtle)',
                  color: filterProject === null ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {t.files.all}
              </button>
              {unattachedCount > 0 && (
                <button
                  onClick={() => setFilterProject(filterProject === UNATTACHED ? null : UNATTACHED)}
                  className="text-xs px-2.5 py-1 rounded-full transition-all flex items-center gap-1"
                  style={{
                    background: filterProject === UNATTACHED ? '#7f1d1d' : 'var(--card-bg)',
                    border: filterProject === UNATTACHED ? '1px solid #ef4444' : '1px solid var(--border-subtle)',
                    color: filterProject === UNATTACHED ? '#fca5a5' : '#f87171',
                  }}
                >
                  <Unlink size={11} />
                  {t.files.unattached} · {unattachedCount}
                </button>
              )}
              {projectsWithFiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setFilterProject(filterProject === p.id ? null : p.id)}
                  className="text-xs px-2.5 py-1 rounded-full transition-all flex items-center gap-1"
                  style={{
                    background: filterProject === p.id ? 'var(--border-default)' : 'var(--card-bg)',
                    border: '1px solid var(--border-subtle)',
                    color: filterProject === p.id ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  <FolderKanban size={11} />
                  {p.name}
                </button>
              ))}
            </div>
          )}

          {/* Drop zone / content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-primary-500" />
            </div>
          ) : files.length === 0 ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all"
              style={{
                borderColor: dragOver ? 'var(--border-strong)' : 'var(--border-subtle)',
                background: dragOver ? 'var(--card-bg-hover)' : 'transparent',
              }}
            >
              <Upload size={40} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
              <p className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t.settings.files.noFiles}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {t.settings.files.upload}
              </p>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className="rounded-2xl transition-all"
              style={{ outline: dragOver ? '2px dashed var(--border-strong)' : 'none', outlineOffset: 4 }}
            >
              {sorted.length === 0 ? (
                <p className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t.files.notFound}
                </p>
              ) : (
                <>
                  {/* Select all row */}
                  <div className="flex items-center gap-3 px-4 py-2 mb-1">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded cursor-pointer accent-primary-500"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {selected.size > 0 ? `${t.files.selected}: ${selected.size}` : t.files.selectAll}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {sorted.map((file) => (
                      <FileRow
                        key={file.id}
                        file={file}
                        projectName={file.projectId ? (projectMap[file.projectId]?.name ?? null) : null}
                        projects={projects}
                        language={language}
                        selected={selected.has(file.id)}
                        onToggleSelect={() => toggleSelect(file.id)}
                        onOpen={() => setViewingFile(file)}
                        onDelete={() => {
                          if (confirm(t.settings.files.deleteConfirm)) deleteMutation.mutate(file.id)
                        }}
                        onAttach={(projectId) => attachMutation.mutate({ id: file.id, projectId })}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FileRow({
  file,
  projectName,
  projects,
  language,
  selected,
  onToggleSelect,
  onOpen,
  onDelete,
  onAttach,
}: {
  file: Attachment
  projectName: string | null
  projects: { id: string; name: string }[]
  language: string
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onDelete: () => void
  onAttach: (projectId: string | null) => void
}) {
  const [attachOpen, setAttachOpen] = useState(false)
  const attachRef = useRef<HTMLDivElement>(null)
  const t = useT()

  useEffect(() => {
    if (!attachOpen) return
    function handleClick(e: MouseEvent) {
      if (attachRef.current && !attachRef.current.contains(e.target as Node)) setAttachOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [attachOpen])

  return (
    <div
      className="group flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer"
      onClick={onOpen}
      style={{
        background: selected ? 'var(--card-bg-hover)' : 'var(--card-bg)',
        border: selected ? '1px solid rgb(var(--color-primary-500))' : '1px solid var(--card-border)',
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.background = 'var(--card-bg-hover)'
          e.currentTarget.style.borderColor = 'var(--card-border-hover)'
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.background = 'var(--card-bg)'
          e.currentTarget.style.borderColor = 'var(--card-border)'
        }
      }}
    >
      {/* Checkbox */}
      <div onClick={(e) => { e.stopPropagation(); onToggleSelect() }} className="flex-shrink-0">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="w-4 h-4 rounded cursor-pointer accent-primary-500"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      <div className="flex-shrink-0 w-7 flex items-center justify-center">
        <FileTypeIcon mime={file.mimeType} filename={file.filename} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {file.filename}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {formatBytes(file.size)} · {file.mimeType}
          </span>
          {projectName && (
            <span
              className="text-xs flex items-center gap-1 px-1.5 py-0.5 rounded-md"
              style={{ background: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              <FolderKanban size={10} />
              {projectName}
            </span>
          )}
        </div>
      </div>

      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
        {formatDistanceToNow(new Date(file.createdAt), {
          locale: getDateLocale(language as never),
          addSuffix: true,
        })}
      </span>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        {/* Attach to project */}
        <div className="relative" ref={attachRef}>
          <button
            onClick={() => setAttachOpen((v) => !v)}
            className="btn-ghost p-1.5"
            title={t.files.attachToProject}
          >
            <Link2 size={13} />
          </button>
          {attachOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 bg-surface-900 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[180px]">
              <p className="px-3 py-1 text-xs text-slate-500 font-medium">{t.files.attachToProject}</p>
              <div className="border-t border-slate-800 mb-1" />
              {file.projectId && (
                <button
                  onClick={() => { onAttach(null); setAttachOpen(false) }}
                  className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-slate-800 transition-colors flex items-center gap-2"
                >
                  <Unlink size={11} /> {t.files.detach}
                </button>
              )}
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { onAttach(p.id); setAttachOpen(false) }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-800 transition-colors flex items-center gap-2"
                  style={{ color: file.projectId === p.id ? 'rgb(var(--color-primary-400))' : 'var(--text-secondary)' }}
                >
                  <FolderKanban size={11} />
                  {p.name}
                  {file.projectId === p.id && ' ✓'}
                </button>
              ))}
            </div>
          )}
        </div>
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost p-1.5"
          title={t.files.download}
        >
          <Download size={13} />
        </a>
        <button onClick={onDelete} className="btn-ghost p-1.5 text-red-400 hover:text-red-300">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}
