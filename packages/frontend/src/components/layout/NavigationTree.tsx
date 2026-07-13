import { useState, useRef, useCallback, useEffect } from 'react'
import { stripLeadingEmoji } from '@/lib/displayText'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, Plus, FileText, Folder, FolderOpen, Loader2, FolderPlus, GripVertical,
  Trash2, Pencil, Check, X, Link2, Download, FileType,
} from 'lucide-react'
import { pageApi, uploadApi, type PageTreeNode, type AttachmentLeaf } from '@/api/client'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

interface NavigationTreeProps {
  projectId: string
}

type PresenceUser = { name: string; color: string }
type PresenceMap = Record<string, PresenceUser[]>

function usePresence(): PresenceMap {
  const { data = {} } = useQuery<PresenceMap>({
    queryKey: ['collab-presence'],
    queryFn: () => fetch('/collab-presence').then((r) => r.json()),
    refetchInterval: 8000,
    staleTime: 5000,
  })
  return data
}

export function NavigationTree({ projectId }: NavigationTreeProps) {
  const qc = useQueryClient()
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const presence = usePresence()

  const { data: rawTree = [], isLoading } = useQuery({
    queryKey: ['pages', 'tree', projectId],
    queryFn: () => pageApi.getTree(projectId),
  })
  // Filter out the AI Memory page — it has its own dedicated nav item
  const tree = rawTree.filter((n) => !n.isMemory)

  // ── Drag state ──────────────────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null)
  const dragCounter = useRef<Record<string, number>>({}) // tracks nested dragenter/leave

  const moveNode = useMutation({
    mutationFn: ({ id, parentPageId }: { id: string; parentPageId: string | null }) =>
      pageApi.update(id, { parentPageId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages', 'tree', projectId] }),
  })

  const handleDrop = useCallback((targetId: string | null) => {
    if (draggingId && draggingId !== targetId) {
      moveNode.mutate({ id: draggingId, parentPageId: targetId })
    }
    setDraggingId(null)
    setDropTarget(null)
    dragCounter.current = {}
  }, [draggingId, moveNode])

  // ── Create mutations ────────────────────────────────────────────────────────
  const createPage = useMutation({
    mutationFn: (parentPageId: string | null) =>
      pageApi.create({ projectId, title: t.navTree.untitled, parentPageId, type: 'PAGE' }),
    onSuccess: (page) => {
      qc.invalidateQueries({ queryKey: ['pages', 'tree', projectId] })
      navigate(`/pages/${page.id}`)
    },
  })

  const createFolder = useMutation({
    mutationFn: (parentPageId: string | null) =>
      pageApi.create({ projectId, title: t.navTree.newFolder, parentPageId, type: 'FOLDER' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages', 'tree', projectId] }),
  })

  const deletePage = useMutation({
    mutationFn: (id: string) => pageApi.delete(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['pages', 'tree', projectId] })
      // Navigate away if deleted page is currently open
      if (location.pathname === `/pages/${id}`) navigate('/')
    },
  })

  const renamePage = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      pageApi.update(id, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages', 'tree', projectId] }),
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-slate-500 text-xs">
        <Loader2 size={12} className="animate-spin" /> {t.common.loading}
      </div>
    )
  }

  return (
    <div
      className="space-y-0.5"
      // Root-level drop zone (move out of any folder)
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
      onDragEnter={(e) => {
        e.stopPropagation()
        dragCounter.current['root'] = (dragCounter.current['root'] ?? 0) + 1
        setDropTarget('root')
      }}
      onDragLeave={(e) => {
        e.stopPropagation()
        dragCounter.current['root'] = (dragCounter.current['root'] ?? 1) - 1
        if ((dragCounter.current['root'] ?? 0) <= 0) {
          setDropTarget(null)
        }
      }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(null) }}
    >
      {tree.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          draggingId={draggingId}
          dropTarget={dropTarget}
          dragCounter={dragCounter}
          presence={presence}
          onDragStart={(id) => setDraggingId(id)}
          onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
          onDrop={handleDrop}
          onSetDropTarget={setDropTarget}
          onCreatePage={(parentId) => createPage.mutate(parentId)}
          onCreateFolder={(parentId) => createFolder.mutate(parentId)}
          onDelete={(id) => deletePage.mutate(id)}
          onRename={(id, title) => renamePage.mutate({ id, title })}
        />
      ))}

      {/* Root-level action buttons */}
      <div
        className={cn(
          'flex items-center gap-0.5 mt-1 px-1 rounded transition-colors',
          dropTarget === 'root' && draggingId && 'bg-primary-900/30 outline outline-1 outline-primary-600/40',
        )}
      >
        <button
          onClick={() => createPage.mutate(null)}
          className="sidebar-item flex-1 text-slate-500 hover:text-slate-300"
          title={t.navTree.newPage}
        >
          <Plus size={13} />
          <span>{t.navTree.newPage}</span>
        </button>
        <button
          onClick={() => createFolder.mutate(null)}
          className="p-1.5 text-slate-600 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors"
          title={t.navTree.newFolder}
        >
          <FolderPlus size={13} />
        </button>
      </div>
    </div>
  )
}

// ── TreeNode ─────────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: PageTreeNode
  depth: number
  draggingId: string | null
  dropTarget: string | 'root' | null
  dragCounter: React.MutableRefObject<Record<string, number>>
  presence: PresenceMap
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDrop: (targetId: string | null) => void
  onSetDropTarget: (id: string | 'root' | null) => void
  onCreatePage: (parentId: string) => void
  onCreateFolder: (parentId: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
}

function TreeNode({
  node, depth,
  draggingId, dropTarget, dragCounter,
  presence,
  onDragStart, onDragEnd, onDrop, onSetDropTarget,
  onCreatePage, onCreateFolder, onDelete, onRename,
}: TreeNodeProps) {
  const isFolder = node.type === 'FOLDER'
  const [expanded, setExpanded] = useState(isFolder)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(node.title)
  const renameRef = useRef<HTMLInputElement>(null)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const t = useT()
  const isActive = pathname === `/pages/${node.id}`
  const hasChildren = node.children.length > 0
  const hasAttachments = (node.attachments?.length ?? 0) > 0
  const isExpandable = hasChildren || hasAttachments
  const isDragging = draggingId === node.id
  const isDropTarget = dropTarget === node.id && isFolder && draggingId !== node.id

  useEffect(() => {
    if (renaming) renameRef.current?.focus()
  }, [renaming])

  function submitRename() {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== node.title) onRename(node.id, trimmed)
    setRenaming(false)
  }

  function handleRowClick() {
    if (isFolder) setExpanded((v) => !v)
    else navigate(`/pages/${node.id}`)
  }

  return (
    <div
      className={cn(isDragging && 'opacity-40')}
    >
      {/* Row */}
      <div
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.id)
          onDragStart(node.id)
        }}
        onDragEnd={(e) => {
          e.stopPropagation()
          onDragEnd()
        }}
        // Folder drop zone
        onDragOver={(e) => {
          if (!isFolder || draggingId === node.id) return
          e.preventDefault()
          e.stopPropagation()
        }}
        onDragEnter={(e) => {
          if (!isFolder || draggingId === node.id) return
          e.stopPropagation()
          dragCounter.current[node.id] = (dragCounter.current[node.id] ?? 0) + 1
          onSetDropTarget(node.id)
          setExpanded(true) // auto-expand folder on hover
        }}
        onDragLeave={(e) => {
          if (!isFolder) return
          e.stopPropagation()
          dragCounter.current[node.id] = (dragCounter.current[node.id] ?? 1) - 1
          if ((dragCounter.current[node.id] ?? 0) <= 0) {
            onSetDropTarget(null)
          }
        }}
        onDrop={(e) => {
          if (!isFolder || draggingId === node.id) return
          e.preventDefault()
          e.stopPropagation()
          dragCounter.current[node.id] = 0
          onDrop(node.id)
        }}
        className={cn(
          'sidebar-item group cursor-grab active:cursor-grabbing',
          !isFolder && isActive && 'active',
          isFolder && 'text-slate-400',
          isDropTarget && 'bg-primary-900/30 outline outline-1 outline-primary-600/40',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {/* Drag handle */}
        <GripVertical
          size={11}
          className="flex-shrink-0 text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity -ml-0.5 mr-0.5 cursor-grab"
        />

        {/* Expand chevron */}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
          className={cn(
            'flex-shrink-0 text-slate-500 transition-transform duration-100',
            expanded && 'rotate-90',
            !isExpandable && 'invisible',
          )}
        >
          <ChevronRight size={13} />
        </button>

        {/* Icon */}
        {isFolder ? (
          expanded
            ? <FolderOpen size={13} className="text-amber-400 flex-shrink-0" />
            : <Folder size={13} className={cn('flex-shrink-0', isDropTarget ? 'text-primary-400' : 'text-amber-400')} />
        ) : (
          <FileText size={13} className="text-slate-500 flex-shrink-0" />
        )}

        {/* Title — inline rename or static */}
        {renaming ? (
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename()
              if (e.key === 'Escape') { setRenameValue(node.title); setRenaming(false) }
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-slate-800 text-slate-100 text-xs px-1.5 py-0.5 rounded border border-primary-500 outline-none min-w-0"
          />
        ) : (
          <span
            className={cn(
              'flex-1 truncate cursor-pointer select-none',
              isFolder && 'font-medium text-slate-300',
            )}
            onClick={handleRowClick}
            onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true) }}
          >
            {stripLeadingEmoji(node.title)}
          </span>
        )}

        {/* Presence avatars — who's on this page right now */}
        {!isFolder && (presence[node.id]?.length ?? 0) > 0 && (
          <div className="flex -space-x-1 flex-shrink-0 ml-1">
            {(presence[node.id] ?? []).slice(0, 3).map((u, i) => (
              <div
                key={i}
                className="w-3.5 h-3.5 rounded-full border border-surface-900 flex items-center justify-center text-[7px] font-bold text-white"
                style={{ backgroundColor: u.color }}
                title={u.name}
              >
                {u.name[0]?.toUpperCase()}
              </div>
            ))}
          </div>
        )}

        {/* Hover actions */}
        {!renaming && (
          confirmDelete ? (
            <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => { onDelete(node.id); setConfirmDelete(false) }}
                className="p-0.5 text-red-400 hover:text-red-300 transition-colors rounded"
                title={t.common.delete}
              >
                <Check size={11} />
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="p-0.5 text-slate-500 hover:text-slate-300 transition-colors rounded"
                title={t.common.cancel}
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0 transition-opacity">
              {isFolder && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCreateFolder(node.id) }}
                  className="p-0.5 text-slate-500 hover:text-amber-400 transition-colors rounded"
                  title={t.navTree.newSubfolder}
                >
                  <FolderPlus size={12} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onCreatePage(node.id) }}
                className="p-0.5 text-slate-500 hover:text-slate-300 transition-colors rounded"
                title={isFolder ? t.navTree.newPageInFolder : t.navTree.childPage}
              >
                <Plus size={12} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setRenaming(true) }}
                className="p-0.5 text-slate-500 hover:text-slate-300 transition-colors rounded"
                title={t.common.rename}
              >
                <Pencil size={11} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
                className="p-0.5 text-slate-500 hover:text-red-400 transition-colors rounded"
                title={t.common.delete}
              >
                <Trash2 size={11} />
              </button>
            </div>
          )
        )}
      </div>

      {/* Children + attachments */}
      {expanded && isExpandable && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              draggingId={draggingId}
              dropTarget={dropTarget}
              dragCounter={dragCounter}
              presence={presence}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
              onSetDropTarget={onSetDropTarget}
              onCreatePage={onCreatePage}
              onCreateFolder={onCreateFolder}
              onDelete={onDelete}
              onRename={onRename}
            />
          ))}
          {node.attachments?.map((att) => (
            <AttachmentNode key={att.id} attachment={att} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── AttachmentNode ────────────────────────────────────────────────────────────

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function AttachmentNode({ attachment: att, depth }: { attachment: AttachmentLeaf; depth: number }) {
  const [open, setOpen] = useState(false)
  const sourceUrl = (att.metadata?.sourceUrl as string) ?? null
  const t = useT()

  return (
    <>
      <div
        className="sidebar-item group cursor-pointer text-slate-500 hover:text-slate-300"
        style={{ paddingLeft: `${8 + depth * 14 + 14}px` }}
        onClick={() => setOpen((v) => !v)}
        title={att.filename}
      >
        <Link2 size={11} className="flex-shrink-0 text-teal-500/70" />
        <span className="flex-1 truncate text-[11px]">{att.filename}</span>
        <span className="text-[10px] text-slate-600 flex-shrink-0">{formatBytes(att.size)}</span>
      </div>

      {/* Inline detail card */}
      {open && (
        <div
          className="mx-2 mb-1 rounded-lg bg-slate-800/80 border border-slate-700/50 p-2.5 text-xs space-y-1.5"
          style={{ marginLeft: `${8 + depth * 14 + 14}px` }}
        >
          <p className="text-slate-300 font-medium truncate">{att.filename}</p>
          {att.description && <p className="text-slate-500 truncate">{att.description}</p>}
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-teal-400 hover:text-teal-300 truncate"
            >
              <FileType size={10} />
              <span className="truncate">{sourceUrl}</span>
            </a>
          )}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-slate-600">{formatBytes(att.size)} · {att.mimeType.split('/')[1]}</span>
            <button
              onClick={async (e) => {
                e.stopPropagation()
                try {
                  const url = await uploadApi.getDownloadUrl(att.id)
                  window.open(url, '_blank')
                } catch { /* ignore */ }
              }}
              className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors"
              title={t.common.download}
            >
              <Download size={11} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
