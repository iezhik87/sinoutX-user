import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { Loader2, Trash2, Download, History, X, RotateCcw, Star, Link2, Search, FileText, Paperclip, CheckCircle2, ChevronDown, ChevronRight, Share2, Globe, Lock, Maximize2, Minimize2, Layers, Printer, Folder, Type } from 'lucide-react'
import { pageApi, projectApi, exportApi, pageVersionApi, graphApi, uploadApi, tokenizeAttachmentUrl, type PageVersion, type PageMeta, type Attachment, type PageTreeNode } from '@/api/client'
import { useCanvasStore } from '@/stores/canvasStore'
import { Header } from '@/components/layout/Header'
import { CollabPageEditor } from '@/components/editor/CollabPageEditor'
import { FileViewer } from '@/components/sources/FileViewer'
import { Modal } from '@/components/common/Modal'
import { EntityCreateModal, type EntityType } from '@/components/editor/EntityCreateModal'
import { CommentsPanel } from '@/components/pages/CommentsPanel'
import { useFavoritesStore } from '@/stores/favoritesStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/i18n/dateLocale'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'
const AUTOSAVE_DELAY = 1500

const PAGE_FONTS = [
  { value: 'Inter, sans-serif',               label: 'Inter' },
  { value: 'Georgia, serif',                  label: 'Georgia' },
  { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { value: '"Courier New", Courier, monospace', label: 'Courier New' },
  { value: 'system-ui, sans-serif',           label: 'System UI' },
]

const PAGE_FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 20]

export function PageEditorPage() {
  const { language } = useLanguageStore()
  const { pageId } = useParams<{ pageId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const t = useT()
  const { setPending } = useCanvasStore()

  const { data: page, isLoading } = useQuery({
    queryKey: ['page', pageId],
    queryFn: () => pageApi.getById(pageId!),
    enabled: !!pageId,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    // Poll every 4s while content is empty (AI may still be writing)
    refetchInterval: (query) => {
      const content = (query.state.data as { content?: { content?: unknown[] } } | undefined)?.content
      const isEmpty = !content?.content || (content.content as unknown[]).length === 0
      return isEmpty ? 4000 : false
    },
  })

  const { currentWorkspaceId, setCurrentProject } = useWorkspaceStore()

  useEffect(() => {
    if (page?.projectId) setCurrentProject(page.projectId)
  }, [page?.projectId, setCurrentProject])

  const { data: pageAttachments = [] } = useQuery({
    queryKey: ['attachments', page?.projectId],
    queryFn: () => uploadApi.list({ projectId: page!.projectId!, workspaceId: currentWorkspaceId! }),
    enabled: !!page?.projectId && !!currentWorkspaceId,
    staleTime: 30_000,
  })
  const [title, setTitle] = useState('')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [showHistory, setShowHistory] = useState(false)
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [shareState, setShareState] = useState<{ isPublic: boolean; publicToken: string | null } | null>(null)
  const [showShareCopied, setShowShareCopied] = useState(false)
  const [entityModal, setEntityModal] = useState<EntityType | null>(null)
  const [pendingInsert, setPendingInsert] = useState<{ id: string; label: string; type: EntityType } | null>(null)
  const [showSourcePicker, setShowSourcePicker] = useState(false)
  const [pendingSourceInsert, setPendingSourceInsert] = useState<{ filename: string; url: string } | null>(null)
  const [viewerFile, setViewerFile] = useState<Attachment | null>(null)
  const { toggle: toggleFav, has: isFav } = useFavoritesStore()
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [focusMode, setFocusMode] = useState(false)

  useEffect(() => {
    if (!focusMode) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocusMode(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [focusMode])

  const [collabUsers, setCollabUsers] = useState<Array<{ name: string; color: string }>>([])

  function handlePrint() {
    window.print()
  }

  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('page-font-family') ?? 'Inter, sans-serif')
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('page-font-size') ?? 15))

  const changeFontFamily = (v: string) => { setFontFamily(v); localStorage.setItem('page-font-family', v) }
  const changeFontSize = (v: number) => { setFontSize(v); localStorage.setItem('page-font-size', String(v)) }

  // Sync title and saveStatus when page loads or changes.
  // Content is derived directly from page (not stored in state) to avoid
  // race conditions where CollabPageEditor mounts with stale content.
  useEffect(() => {
    if (page?.id === pageId && page) {
      setTitle(page.title)
      setSaveStatus('saved')
      setShareState({ isPublic: page.isPublic ?? false, publicToken: page.publicToken ?? null })
    } else {
      setTitle('')
    }
  }, [page?.id, pageId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Content derived synchronously — always correct, no stale-state race
  const editorContent: Record<string, unknown> =
    page?.id === pageId && page?.content
      ? (page.content as Record<string, unknown>)
      : { type: 'doc', content: [] }

  // Handle clicks on entity-ref chips inside the editor
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Source links point to a bare /attachments/:id/content URL — open them
      // with the auth token so they don't return "Authentication required".
      const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
      if (anchor) {
        const href = anchor.getAttribute('href') ?? ''
        if (href.includes('/api/v1/attachments/') && href.includes('/content')) {
          e.preventDefault()
          window.open(tokenizeAttachmentUrl(href), '_blank')
          return
        }
      }
      const el = (e.target as HTMLElement).closest('[data-entity-id]') as HTMLElement | null
      if (!el) return
      const entityId = el.getAttribute('data-entity-id')
      const entityType = el.getAttribute('data-entity-type')
      const projectId = page?.projectId
      if (!entityId || !entityType || !projectId) return
      e.preventDefault()
      if (entityType === 'task') navigate(`/projects/${projectId}/tasks?taskId=${entityId}`)
      else if (entityType === 'note') navigate(`/projects/${projectId}/notes?noteId=${entityId}`)
      else if (entityType === 'budget') navigate(`/projects/${projectId}/budget?entryId=${entityId}`)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [page?.projectId, navigate])

  const savePage = useMutation({
    mutationFn: (data: { title?: string; content?: Record<string, unknown>; icon?: string | null }) =>
      pageApi.update(pageId!, data),
    onMutate: () => setSaveStatus('saving'),
    onSuccess: () => {
      setSaveStatus('saved')
      qc.invalidateQueries({ queryKey: ['pages', 'tree', page?.projectId] })
    },
    onError: () => setSaveStatus('unsaved'),
  })

  const scheduleAutosave = useCallback(
    (data: { title?: string; content?: Record<string, unknown> }) => {
      setSaveStatus('unsaved')
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(() => savePage.mutate(data), AUTOSAVE_DELAY)
    },
    [savePage],
  )

  const handleTitleChange = (value: string) => {
    setTitle(value)
    scheduleAutosave({ title: value })
  }

  const deletePage = useMutation({
    mutationFn: () => pageApi.delete(pageId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pages', 'tree', page?.projectId] })
      navigate(`/projects/${page?.projectId}`)
    },
  })

  const toggleShare = useMutation({
    mutationFn: () => pageApi.toggleShare(pageId!),
    onSuccess: (data) => {
      setShareState(data)
      qc.invalidateQueries({ queryKey: ['page', pageId] })
    },
  })

  const { data: pageTree = [] } = useQuery({
    queryKey: ['pages', 'tree', page?.projectId],
    queryFn: () => pageApi.getTree(page!.projectId),
    enabled: !!page?.projectId,
    staleTime: 30_000,
  })

  // Project name for the header breadcrumb
  const { data: breadcrumbProject } = useQuery({
    queryKey: ['project', page?.projectId],
    queryFn: () => projectApi.getById(page!.projectId),
    enabled: !!page?.projectId,
    staleTime: 60_000,
  })

  const flatPages = (function flatten(nodes: PageTreeNode[]): PageTreeNode[] {
    return nodes.flatMap((n) => [n, ...flatten(n.children)])
  })(pageTree)

  const flatIdx = flatPages.findIndex((p) => p.id === pageId)
  const prevPage = flatIdx > 0 ? flatPages[flatIdx - 1] : null
  const nextPage = flatIdx >= 0 && flatIdx < flatPages.length - 1 ? flatPages[flatIdx + 1] : null

  const isFolder = page?.type === 'FOLDER'

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-primary-500" />
      </div>
    )
  }

  if (!page) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-500">{t.pages.notFound}</p>
      </div>
    )
  }

  const editorScrollArea = (
    <>
      {/* Sticky arrow overlay — mirrors max-w-4xl centering */}
      {!focusMode && (prevPage || nextPage) && (
        <div className="sticky top-1/2 z-10 h-0 pointer-events-none" style={{ transform: 'translateY(-28px)' }}>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 relative">
            {prevPage && (
              <button
                onClick={() => navigate(`/pages/${prevPage.id}`)}
                title={prevPage.title || t.pages.untitled}
                className="absolute pointer-events-auto flex items-center justify-center w-8 h-14 rounded-r-xl transition-all opacity-25 hover:opacity-100"
                style={{ right: '100%', top: 0, marginRight: '6px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                <svg width="9" height="14" viewBox="0 0 9 14" fill="currentColor"><polygon points="9,0 0,7 9,14" /></svg>
              </button>
            )}
            {nextPage && (
              <button
                onClick={() => navigate(`/pages/${nextPage.id}`)}
                title={nextPage.title || t.pages.untitled}
                className="absolute pointer-events-auto flex items-center justify-center w-8 h-14 rounded-l-xl transition-all opacity-25 hover:opacity-100"
                style={{ left: '100%', top: 0, marginLeft: '6px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                <svg width="9" height="14" viewBox="0 0 9 14" fill="currentColor"><polygon points="0,0 9,7 0,14" /></svg>
              </button>
            )}
          </div>
        </div>
      )}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Font controls */}
        <div className="flex items-center gap-2 mb-3 justify-end" data-no-print>
          {collabUsers.length > 1 && (
            <div className="flex items-center mr-auto" title={collabUsers.map((u) => u.name).join(', ')}>
              {collabUsers.slice(0, 5).map((u, i) => (
                <span
                  key={i}
                  className="flex items-center justify-center rounded-full text-white text-[10px] font-semibold"
                  style={{ width: 22, height: 22, background: u.color, border: '2px solid var(--bg-app)', marginLeft: i === 0 ? 0 : -7 }}
                >
                  {(u.name || '?').charAt(0).toUpperCase()}
                </span>
              ))}
              <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>{t.pages.editingNow}</span>
            </div>
          )}
          <div className="flex items-center gap-0.5 rounded-lg pl-2 pr-1 py-0.5" style={{ background: 'var(--bg-elevated)' }}>
            <Type size={12} className="flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            <select
              value={fontFamily}
              onChange={(e) => changeFontFamily(e.target.value)}
              className="text-xs px-1 py-0.5 border-0 cursor-pointer bg-transparent"
              style={{ color: 'var(--text-muted)', outline: 'none' }}
            >
              {PAGE_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <span style={{ width: 1, height: 14, background: 'var(--border-subtle)' }} />
            <select
              value={fontSize}
              onChange={(e) => changeFontSize(Number(e.target.value))}
              className="text-xs px-1 py-0.5 border-0 cursor-pointer bg-transparent"
              style={{ color: 'var(--text-muted)', outline: 'none' }}
            >
              {PAGE_FONT_SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
            </select>
          </div>
        </div>

        <div className="page-document px-6 sm:px-10 py-8 sm:py-12" style={{ fontFamily, fontSize: `${fontSize}px` }}>
          {page.children.length > 0 && (
            <p className="text-xs text-slate-600 mb-6">
              {page.children.length} {t.pages.nestedCount}
            </p>
          )}

          <div className="mb-6 flex items-center gap-3" data-no-print>
            {isFolder ? (
              <>
                <Folder size={36} className="text-primary-400 flex-shrink-0" />
                <span className="text-xs uppercase tracking-wider text-slate-500">{t.pages.folder}</span>
              </>
            ) : (
              <FileText size={36} className="text-slate-400 flex-shrink-0" />
            )}
          </div>

          <textarea
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder={t.pages.untitled}
            rows={1}
            className="w-full bg-transparent font-bold text-slate-100 placeholder-slate-700
                       resize-none focus:outline-none leading-tight mb-8 overflow-hidden"
            style={{ fontSize: `${Math.round(fontSize * 2)}px`, fontFamily }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = el.scrollHeight + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                document.querySelector<HTMLElement>('.ProseMirror')?.focus()
              }
            }}
          />

          {page?.id !== pageId ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={20} className="animate-spin text-slate-500" />
            </div>
          ) : isFolder ? (
            // A folder isn't a document — show it as a folder with its contents
            // instead of an empty editor when paging through pages.
            <div className="flex flex-col items-center text-center py-10">
              <Folder size={64} className="text-primary-400 mb-4" />
              {page.children.length > 0 ? (
                <div className="w-full max-w-md flex flex-col gap-1 mt-2">
                  {page.children.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate(`/pages/${c.id}`)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-black/5 transition-colors"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {c.type === 'FOLDER'
                        ? <Folder size={15} className="text-primary-400 flex-shrink-0" />
                        : <FileText size={15} className="text-slate-400 flex-shrink-0" />}
                      <span className="truncate">{c.title || t.pages.untitled}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 mt-2">{t.pages.folderEmpty}</p>
              )}
            </div>
          ) : (
          <CollabPageEditor
            key={pageId}
            pageId={pageId!}
            content={editorContent}
            editable={true}
            projectId={page?.projectId ?? undefined}
            onChange={(c) => scheduleAutosave({ content: c })}
            onRequestEntityCreate={(type) => setEntityModal(type)}
            insertEntity={pendingInsert}
            onInsertEntityDone={() => setPendingInsert(null)}
            onRequestSourceInsert={() => setShowSourcePicker(true)}
            insertSource={pendingSourceInsert}
            onInsertSourceDone={() => setPendingSourceInsert(null)}
            onAttachmentClick={(id) => {
              const found = pageAttachments.find((a) => a.id === id)
              if (found) setViewerFile(found)
            }}
            onCollabUsers={setCollabUsers}
          />
          )}

          {/* Backlinks panel */}
          {pageId && !isFolder && <BacklinksPanel pageId={pageId} />}

          {/* Comments panel */}
          {pageId && !isFolder && <CommentsPanel pageId={pageId} />}
        </div>
      </div>
    </>
  )

  return (
    <>
    <style>{`
      @media print {
        nav, header, aside, [data-sidebar], .sidebar, [class*="sidebar"],
        [class*="header"], [class*="toolbar"], [class*="btn"], [class*="controls"],
        [class*="minimap"], [class*="panel"], button, input, select, textarea {
          display: none !important;
        }
        body, html { background: white !important; color: black !important; }
        .ProseMirror, [class*="editor"], [class*="content"], article, main {
          display: block !important;
          max-width: 100% !important;
          padding: 0 !important;
          margin: 0 !important;
        }
        [data-page-icon], .page-icon-wrapper, .page-emoji, [data-no-print] {
          display: none !important;
        }
      }
    `}</style>
    {/* Focus mode overlay */}
    {focusMode && (
      <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'var(--bg-app)' }}>
        {/* Minimal floating toolbar */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-2 border-b border-slate-800/60" style={{ background: 'var(--bg-app)' }}>
          <span className="text-xs text-slate-600">
            {saveStatus === 'saving' && t.pages.saving}
            {saveStatus === 'saved' && t.pages.saved}
            {saveStatus === 'unsaved' && t.pages.unsaved}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={fontFamily}
              onChange={(e) => changeFontFamily(e.target.value)}
              className="text-xs rounded px-2 py-1 border-0 cursor-pointer"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', outline: 'none' }}
            >
              {PAGE_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <select
              value={fontSize}
              onChange={(e) => changeFontSize(Number(e.target.value))}
              className="text-xs rounded px-2 py-1 border-0 cursor-pointer"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', outline: 'none' }}
            >
              {PAGE_FONT_SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
            </select>
            <button
              onClick={() => setFocusMode(false)}
              className="btn-ghost text-xs flex items-center gap-1"
              title={t.pages.exitFocusMode}
            >
              <Minimize2 size={13} /> {t.pages.exitFocusMode}
            </button>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
          <div className="page-document px-6 sm:px-10 py-8 sm:py-12" style={{ fontFamily, fontSize: `${fontSize}px` }}>
            <textarea
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder={t.pages.untitled}
              rows={1}
              className="w-full bg-transparent font-bold text-slate-100 placeholder-slate-700
                         resize-none focus:outline-none leading-tight mb-8 overflow-hidden"
              style={{ fontSize: `${Math.round(fontSize * 2)}px`, fontFamily }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = el.scrollHeight + 'px'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  document.querySelector<HTMLElement>('.ProseMirror')?.focus()
                }
              }}
            />
            <CollabPageEditor
              key={`focus-${pageId}`}
              pageId={pageId!}
              content={editorContent}
              editable={true}
              projectId={page?.projectId ?? undefined}
              onChange={(c) => scheduleAutosave({ content: c })}
              onRequestEntityCreate={(type) => setEntityModal(type)}
              insertEntity={pendingInsert}
              onInsertEntityDone={() => setPendingInsert(null)}
              onRequestSourceInsert={() => setShowSourcePicker(true)}
              insertSource={pendingSourceInsert}
              onInsertSourceDone={() => setPendingSourceInsert(null)}
              onAttachmentClick={(id) => {
                const found = pageAttachments.find((a) => a.id === id)
                if (found) setViewerFile(found)
              }}
              onCollabUsers={setCollabUsers}
            />
          </div>
        </div>
      </div>
    )}

    <div className="flex h-full">
      {/* Main editor area */}
      <div className="flex flex-col flex-1 min-w-0">
        <Header
          title={
            <div className="flex items-center gap-1.5 min-w-0 text-sm">
              <button
                onClick={() => navigate(`/projects/${page.projectId}`)}
                className="truncate flex-shrink-0 hover:text-slate-200 transition-colors"
                style={{ color: 'var(--text-muted)' }}
                title={t.pages.backToProject}
              >
                {projectDisplayName(breadcrumbProject, language) || '…'}
              </button>
              <ChevronRight size={12} className="flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
              <span className="truncate text-slate-300">{title || t.pages.untitled}</span>
            </div>
          }
          actions={
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 min-w-[100px] text-right">
                {saveStatus === 'saving' && t.pages.saving}
                {saveStatus === 'saved' && t.pages.saved}
                {saveStatus === 'unsaved' && t.pages.unsaved}
              </span>

              {/* Export dropdown */}
              <div className="relative">
                <button className="btn-ghost text-xs" title={t.pages.export} onClick={() => setShowExport(v => !v)}>
                  <Download size={13} /> {t.pages.export}
                </button>
                {showExport && <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowExport(false)} />
                  <div className="absolute right-0 top-full z-50 flex flex-col min-w-[220px]"
                  style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border-default)', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', padding: '4px 0' }}
                  onClick={() => setShowExport(false)}>
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t.common.download}</p>
                  <ExportBtn icon={<FileText size={12} />} label={t.pages.exportDocx} onClick={async () => {
                    setExportStatus('docx')
                    try { await exportApi.exportPageBinary(pageId!, 'docx', `${title || 'page'}.docx`) }
                    finally { setTimeout(() => setExportStatus(null), 2000) }
                  }} loading={exportStatus === 'docx'} />
                  <ExportBtn icon={<FileText size={12} />} label={t.pages.exportPdf} onClick={async () => {
                    setExportStatus('pdf')
                    try { await exportApi.exportPageBinary(pageId!, 'pdf', `${title || 'page'}.pdf`) }
                    finally { setTimeout(() => setExportStatus(null), 2000) }
                  }} loading={exportStatus === 'pdf'} />
                  <ExportBtn icon={<Download size={12} />} label={t.pages.exportMd} onClick={() => exportApi.exportPage(pageId!, 'md')} />
                  <ExportBtn icon={<Download size={12} />} label={t.pages.exportJson} onClick={() => exportApi.exportPage(pageId!, 'json')} />
                  <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '4px 0' }} />
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t.pages.saveToSources}</p>
                  <ExportBtn icon={<Paperclip size={12} />} label={t.pages.saveAsDocx} savedLabel={t.pages.savedToSources} onClick={async () => {
                    setExportStatus('save-docx')
                    try {
                      await exportApi.savePageAsAttachment(pageId!, 'docx')
                      setExportStatus('saved')
                      setTimeout(() => setExportStatus(null), 2500)
                    } catch { setExportStatus(null) }
                  }} loading={exportStatus === 'save-docx'} done={exportStatus === 'saved'} />
                  <ExportBtn icon={<Paperclip size={12} />} label={t.pages.saveAsPdf} savedLabel={t.pages.savedToSources} onClick={async () => {
                    setExportStatus('save-pdf')
                    try {
                      await exportApi.savePageAsAttachment(pageId!, 'pdf')
                      setExportStatus('saved')
                      setTimeout(() => setExportStatus(null), 2500)
                    } catch { setExportStatus(null) }
                  }} loading={exportStatus === 'save-pdf'} done={exportStatus === 'saved'} />
                </div>
                </>}
              </div>

              <button
                onClick={() => toggleFav({
                  id: pageId!,
                  type: 'page',
                  title: title || t.pages.untitled,
                  url: `/pages/${pageId}`,
                  icon: 'lucide:FileText',
                })}
                className={cn('btn-ghost p-1.5', isFav(pageId!) && 'text-yellow-400')}
                title={isFav(pageId!) ? t.pages.removeFromFavorites : t.pages.addToFavorites}
              >
                <Star size={13} fill={isFav(pageId!) ? 'currentColor' : 'none'} />
              </button>

              <CopyLinkButton />

              {/* Share button */}
              <div className="relative">
                <button
                  onClick={() => toggleShare.mutate()}
                  disabled={toggleShare.isPending}
                  className={cn('btn-ghost text-xs', shareState?.isPublic && 'text-green-400')}
                  title={shareState?.isPublic ? t.pages.shareDisable : t.pages.shareEnable}
                >
                  {toggleShare.isPending
                    ? <Loader2 size={13} className="animate-spin" />
                    : shareState?.isPublic ? <Globe size={13} /> : <Share2 size={13} />}
                  {shareState?.isPublic ? t.pages.shared : t.pages.share}
                </button>
                {shareState?.isPublic && shareState.publicToken && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-surface-800 border border-slate-700 rounded-lg p-3 min-w-[280px] shadow-xl">
                    <p className="text-[11px] text-slate-400 mb-2">{t.pages.shareLink}</p>
                    <div className="flex gap-2 items-center">
                      <input
                        readOnly
                        value={`${window.location.origin}/p/${shareState.publicToken}`}
                        className="flex-1 bg-surface-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 select-all"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/p/${shareState.publicToken}`)
                          setShowShareCopied(true)
                          setTimeout(() => setShowShareCopied(false), 2000)
                        }}
                        className="btn-ghost text-xs flex-shrink-0"
                      >
                        {showShareCopied ? <CheckCircle2 size={13} className="text-green-400" /> : <Link2 size={13} />}
                      </button>
                    </div>
                    <button
                      onClick={() => toggleShare.mutate()}
                      className="mt-2 text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1"
                    >
                      <Lock size={11} /> {t.pages.shareDisable}
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowLinkModal(true)}
                className="btn-ghost p-1.5"
                title={t.pages.link}
              >
                <Link2 size={13} />
              </button>

              <button
                onClick={() => setShowHistory((v) => !v)}
                className={cn('btn-ghost text-xs', showHistory && 'text-primary-400')}
                title={t.pages.history}
              >
                <History size={13} />
              </button>

              <button onClick={handlePrint} className="btn-ghost p-1.5" title={t.pages?.print ?? 'Print'}>
                <Printer size={15} />
              </button>

              <button
                onClick={() => {
                  setPending({
                    node: {
                      type: 'page',
                      data: {
                        entityId: page.id,
                        title: title || t.pages.untitled,
                        icon: page.icon ?? undefined,
                        project: undefined,
                      },
                    },
                  })
                  navigate('/canvas')
                }}
                className="btn-ghost p-1.5 text-primary-400 hover:text-primary-300"
                title={t.canvas.sendToCanvas}
              >
                <Layers size={13} />
              </button>

              <button
                onClick={() => setFocusMode(true)}
                className="btn-ghost text-xs"
                title={t.pages.focusMode}
              >
                <Maximize2 size={13} />
              </button>

              <button
                onClick={() => { if (confirm(t.pages.deleteConfirm)) deletePage.mutate() }}
                className="btn-danger"
                disabled={deletePage.isPending}
              >
                <Trash2 size={14} />
              </button>
            </div>
          }
        />

        <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-app)' }}>
          {editorScrollArea}
        </div>
      </div>

      {/* Entity create modal */}
      {entityModal && currentWorkspaceId && page?.projectId && (
        <EntityCreateModal
          type={entityModal}
          projectId={page.projectId}
          workspaceId={currentWorkspaceId}
          pageId={pageId!}
          onCreated={(id, label, type) => {
            setPendingInsert({ id, label, type })
            setEntityModal(null)
          }}
          onClose={() => setEntityModal(null)}
        />
      )}

      {/* Source picker modal */}
      {showSourcePicker && page?.projectId && currentWorkspaceId && (
        <SourcePickerModal
          projectId={page.projectId}
          workspaceId={currentWorkspaceId}
          onSelect={async (attachment) => {
            const url = `/api/v1/attachments/${attachment.id}/content`
            setPendingSourceInsert({ filename: attachment.filename, url })
            setShowSourcePicker(false)
          }}
          onClose={() => setShowSourcePicker(false)}
        />
      )}

      {/* File viewer */}
      {viewerFile && (
        <FileViewer file={viewerFile} onClose={() => setViewerFile(null)} />
      )}

      {/* Link modal */}
      {showLinkModal && currentWorkspaceId && (
        <LinkModal
          pageId={pageId!}
          workspaceId={currentWorkspaceId}
          projectId={page?.projectId}
          onClose={() => setShowLinkModal(false)}
        />
      )}

      {/* Version history sidebar */}
      {showHistory && (
        <VersionHistoryPanel
          pageId={pageId!}
          onClose={() => setShowHistory(false)}
          onRestore={() => {
            qc.invalidateQueries({ queryKey: ['page', pageId] })
            setShowHistory(false)
          }}
        />
      )}
    </div>
    </>
  )
}

// ─── Copy Link Button ─────────────────────────────────────────────────────────

function CopyLinkButton() {
  const t = useT()
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button onClick={copy} className="btn-ghost text-xs" title={t.pages.copyPageLink}>
      {copied ? <CheckCircle2 size={13} className="text-emerald-400" /> : <Link2 size={13} />}
      {copied ? t.pages.copied : t.pages.linkLabel}
    </button>
  )
}

// ─── Backlinks Panel ──────────────────────────────────────────────────────────

import { Link } from 'react-router-dom'
import { projectDisplayName } from '@/lib/projectName'

function BacklinksPanel({ pageId }: { pageId: string }) {
  const { language } = useLanguageStore()
  const [open, setOpen] = useState(false)
  const t = useT()

  const { data: backlinks = [], isLoading } = useQuery({
    queryKey: ['backlinks', pageId],
    queryFn: () => pageApi.getBacklinks(pageId),
    staleTime: 30_000,
    enabled: open,
  })

  return (
    <div className="mt-12 border-t border-slate-800/60 pt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-400 transition-colors w-full"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Link2 size={12} />
        <span>{t.pages.backlinks ?? 'Упоминается в'}</span>
        {backlinks.length > 0 && (
          <span className="ml-1 text-slate-700">{backlinks.length}</span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-1 pl-4">
          {isLoading && (
            <p className="text-xs text-slate-600"><Loader2 size={11} className="inline animate-spin mr-1" />{t.common.loading ?? 'Загрузка…'}</p>
          )}
          {!isLoading && backlinks.length === 0 && (
            <p className="text-xs text-slate-700">{t.pages.noBacklinks ?? 'Нет обратных ссылок'}</p>
          )}
          {backlinks.map((bl) => (
            <Link
              key={bl.id}
              to={`/pages/${bl.id}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/50 transition-colors group"
            >
              <FileText size={12} className="text-slate-600 flex-shrink-0" />
              <span className="text-sm text-slate-300 group-hover:text-slate-100">{bl.title}</span>
              <span className="text-xs text-slate-600 ml-auto">{projectDisplayName(bl.project, language)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Export Button ────────────────────────────────────────────────────────────

function ExportBtn({ icon, label, savedLabel, onClick, loading, done }: {
  icon: ReactNode
  label: string
  savedLabel?: string
  onClick: () => void
  loading?: boolean
  done?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left disabled:opacity-60"
      style={{ color: 'var(--text-secondary)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--border-subtle)')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
    >
      {loading ? <Loader2 size={12} className="animate-spin flex-shrink-0" /> : done ? <CheckCircle2 size={12} className="flex-shrink-0 text-green-400" /> : <span className="flex-shrink-0">{icon}</span>}
      <span>{done ? (savedLabel ?? label) : label}</span>
    </button>
  )
}

// ─── Link Modal ───────────────────────────────────────────────────────────────

const LINK_TYPES = ['REFERENCE', 'RELATED', 'DEPENDS_ON', 'BLOCKS', 'EMBED'] as const
type LinkType = typeof LINK_TYPES[number]

function LinkModal({
  pageId,
  workspaceId,
  projectId,
  onClose,
}: {
  pageId: string
  workspaceId: string
  projectId?: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const t = useT()
  const [query, setQuery] = useState('')
  const [linkType, setLinkType] = useState<LinkType>('REFERENCE')
  const [saving, setSaving] = useState(false)

  const { data: pages = [] } = useQuery({
    queryKey: ['pages-list', projectId],
    queryFn: () => projectId ? pageApi.listByProject(projectId) : Promise.resolve([] as PageMeta[]),
    enabled: !!projectId,
  })

  const filtered = pages.filter(
    (p) => p.id !== pageId && p.title.toLowerCase().includes(query.toLowerCase()),
  )

  async function handleLink(targetPageId: string) {
    setSaving(true)
    try {
      await graphApi.createLink({
        workspaceId,
        sourceType: 'page',
        sourceId: pageId,
        targetType: 'page',
        targetId: targetPageId,
        linkType,
      })
      qc.invalidateQueries({ queryKey: ['graph'] })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t.pages.linkPage}>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">{t.graph.linkType}</label>
          <select
            value={linkType}
            onChange={(e) => setLinkType(e.target.value as LinkType)}
            className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {LINK_TYPES.map((lt) => (
              <option key={lt} value={lt}>{t.graph.linkTypes[lt]}</option>
            ))}
          </select>
        </div>

        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            autoFocus
            placeholder={t.pages.searchPages}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-surface-950 border border-slate-700 rounded-md pl-8 pr-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="max-h-60 overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">{t.pages.noPagesFound}</p>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => handleLink(p.id)}
                disabled={saving}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm text-slate-300 hover:bg-slate-800 transition-colors"
              >
                <FileText size={14} className="text-slate-400 flex-shrink-0" />
                <span className="truncate">{p.title || t.pages.untitled}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}

// ─── Version History Panel ────────────────────────────────────────────────────

function VersionHistoryPanel({
  pageId,
  onClose,
  onRestore,
}: {
  pageId: string
  onClose: () => void
  onRestore: () => void
}) {
  const qc = useQueryClient()
  const t = useT()
  const { language } = useLanguageStore()
  const [restoring, setRestoring] = useState<string | null>(null)

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['page-versions', pageId],
    queryFn: () => pageVersionApi.list(pageId),
  })

  async function handleRestore(version: PageVersion) {
    if (!confirm(t.pages.restoreConfirm)) return
    setRestoring(version.id)
    try {
      await pageVersionApi.restore(pageId, version.id)
      qc.invalidateQueries({ queryKey: ['page-versions', pageId] })
      onRestore()
    } catch (err) {
      console.error('Restore failed:', err)
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="w-72 flex-shrink-0 border-l border-slate-800 bg-surface-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <History size={14} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-200">{t.pages.history}</span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-primary-500" />
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-slate-500">{t.pages.noVersions}</p>
            <p className="text-xs text-slate-600 mt-1">{t.pages.versionsHint}</p>
          </div>
        ) : (
          versions.map((v: PageVersion) => (
            <div
              key={v.id}
              className="group px-4 py-3 hover:bg-surface-800 transition-colors border-b border-slate-800/50 last:border-0"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-300 truncate">{v.title}</p>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    v{v.version} · {formatDistanceToNow(new Date(v.createdAt), { locale: getDateLocale(language), addSuffix: true })}
                  </p>
                </div>
                <button
                  onClick={() => handleRestore(v)}
                  disabled={restoring === v.id}
                  title={t.pages.restoreVersion}
                  className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 text-slate-500 hover:text-primary-400 transition-all"
                >
                  {restoring === v.id
                    ? <Loader2 size={12} className="animate-spin" />
                    : <RotateCcw size={12} />
                  }
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Source Picker Modal ──────────────────────────────────────────────────────

function SourcePickerModal({
  workspaceId,
  onSelect,
  onClose,
}: {
  projectId: string
  workspaceId: string
  onSelect: (attachment: Attachment) => void
  onClose: () => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const { data: attachments = [], isLoading } = useQuery({
    queryKey: ['attachments', workspaceId],
    queryFn: () => uploadApi.list({ workspaceId }),
  })

  const filtered = attachments.filter((a) =>
    a.filename.toLowerCase().includes(query.toLowerCase()) ||
    (a.description ?? '').toLowerCase().includes(query.toLowerCase())
  )


  return (
    <Modal open onClose={onClose} title={t.pages.insertSource}>
      <div className="flex flex-col gap-3 w-[480px] max-w-full">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.pages.searchSources}
          className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />

        <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-slate-500" />
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-8">
              {attachments.length === 0 ? t.pages.noProjectSources : t.common.noData}
            </p>
          )}
          {filtered.map((attachment) => (
            <button
              key={attachment.id}
              onClick={() => onSelect(attachment)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-slate-800"
            >
              <Paperclip size={18} className="flex-shrink-0 text-slate-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 truncate">{attachment.filename}</p>
                {attachment.description && (
                  <p className="text-xs text-slate-500 truncate">{attachment.description}</p>
                )}
              </div>
              <span className="text-xs text-slate-600 flex-shrink-0 uppercase">{attachment.filename.split('.').pop()?.toLowerCase()}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
