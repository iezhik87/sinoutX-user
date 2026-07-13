import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { stripLeadingEmoji } from '@/lib/displayText'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  type Connection,
  type NodeTypes,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeProps,
  type OnNodesChange,
  type OnEdgesChange,
  BackgroundVariant,
  Panel,
  ConnectionMode,
} from 'reactflow'
import { NodeResizer } from '@reactflow/node-resizer'
import '@reactflow/node-resizer/dist/style.css'
import 'reactflow/dist/style.css'
import {
  Plus, Trash2, Loader2, Pencil, Check, X, FileText, CheckSquare,
  Paperclip, Link2, Type, StickyNote, Layers, ChevronDown,
  Search, FolderKanban,
} from 'lucide-react'
import {
  canvasApi, projectApi, pageApi, taskApi, noteApi, uploadApi, attachmentContentUrl,
  type CanvasNode, type CanvasEdge, type CanvasViewport,
  type Project, type Task, type Attachment,
} from '@/api/client'
import { FileViewer } from '@/components/sources/FileViewer'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { toast } from '@/stores/toastStore'
import { Header } from '@/components/layout/Header'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

const CanvasSaveCtx = React.createContext<{
  save: (nodes: RFNode[], edges: RFEdge[]) => void
} | null>(null)

const CanvasFileCtx = React.createContext<{
  openFile: (data: Record<string, unknown>) => void
} | null>(null)

const EDGE_COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#94a3b8']

const HANDLE_STYLE: React.CSSProperties = {
  width: 8, height: 8,
  background: '#6366f1',
  border: '2px solid var(--bg-surface)',
  borderRadius: '50%',
}

function NodeHandles() {
  return (
    <>
      <Handle type="source" position={Position.Top}    style={HANDLE_STYLE} id="t" />
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} id="b" />
      <Handle type="source" position={Position.Left}   style={HANDLE_STYLE} id="l" />
      <Handle type="source" position={Position.Right}  style={HANDLE_STYLE} id="r" />
    </>
  )
}

// ── NoteNode ──────────────────────────────────────────────────────────────────
function NoteNode({ data, selected, id }: NodeProps<Record<string, unknown>>) {
  const navigate = useNavigate()
  const ctx = useContext(CanvasSaveCtx)
  const { setNodes, getEdges } = useReactFlow()
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const color = (data.color as string) ?? '#fef08a'
  const hasEntity = !!data.entityId

  function startEdit() {
    if (hasEntity) { navigate('/notes'); return }
    setEditText((data.preview as string) ?? '')
    setEditing(true)
  }
  function commitEdit() {
    setEditing(false)
    setNodes((nds) => {
      const next = nds.map((n) => n.id === id ? { ...n, data: { ...n.data, preview: editText } } : n)
      ctx?.save(next, getEdges())
      return next
    })
  }

  return (
    <div onDoubleClick={startEdit} title={hasEntity ? t.canvas.doubleClickHint : t.canvas.notePlaceholder}
      style={{ width: '100%', height: '100%', minWidth: 120, minHeight: 100, background: color, borderRadius: 2, boxShadow: selected ? '4px 4px 16px rgba(0,0,0,0.45), 0 0 0 2px #818cf8' : '4px 4px 12px rgba(0,0,0,0.25)', padding: '28px 12px 16px', position: 'relative', fontFamily: "'Segoe UI', sans-serif", cursor: 'pointer', boxSizing: 'border-box' }}>
      <NodeResizer minWidth={120} minHeight={100} color="#818cf8" isVisible={selected} />
      <NodeHandles />
      <div style={{ position: 'absolute', bottom: 0, right: 0, width: 0, height: 0, borderStyle: 'solid', borderWidth: '0 0 22px 22px', borderColor: 'transparent transparent rgba(0,0,0,0.15) transparent' }} />
      <div style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
        <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #ef4444, #991b1b)', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }} />
        <div style={{ width: 2, height: 8, background: '#78716c', margin: '0 auto', borderRadius: '0 0 1px 1px' }} />
      </div>
      {editing ? (
        <textarea autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
          onClick={(e) => e.stopPropagation()}
          style={{ width: '100%', minHeight: 60, background: 'transparent', border: 'none', outline: 'none', resize: 'none', fontSize: 11, color: 'rgba(0,0,0,0.7)', lineHeight: 1.5, fontFamily: 'inherit' }} />
      ) : (
        <>
          {!!data.preview
            ? <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.58)', lineHeight: 1.5, wordBreak: 'break-word', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>{data.preview as string}</p>
            : <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic' }}>{t.canvas.notePlaceholder}</p>
          }
        </>
      )}
    </div>
  )
}

// ── PageNode ──────────────────────────────────────────────────────────────────
function PageNode({ data, selected }: NodeProps<Record<string, unknown>>) {
  const navigate = useNavigate()
  return (
    <div onDoubleClick={() => data.entityId && navigate(`/pages/${data.entityId as string}`)}
      style={{ width: '100%', height: '100%', minWidth: 160, minHeight: 100, background: 'var(--bg-surface)', border: `1px solid ${selected ? '#818cf8' : 'var(--border-default)'}`, borderRadius: 10, boxShadow: selected ? '0 0 0 2px #818cf8, 0 8px 24px rgba(0,0,0,0.12)' : 'var(--card-shadow)', overflow: 'hidden', cursor: 'pointer', position: 'relative', boxSizing: 'border-box' }}>
      <NodeResizer minWidth={160} minHeight={100} color="#818cf8" isVisible={selected} />
      <NodeHandles />
      <div style={{ background: 'linear-gradient(90deg, #3b82f6 0%, #6366f1 100%)', height: 3 }} />
      <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
          <FileText size={11} style={{ color: '#6366f1', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {!!data.project ? (data.project as string) : 'Page'}
          </span>
        </div>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, wordBreak: 'break-word' }}>
          {(data.title as string) || '—'}
        </p>
      </div>
      <div style={{ padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[90, 75, 85, 60].map((w, i) => <div key={i} style={{ height: 3, width: `${w}%`, background: 'var(--border-default)', borderRadius: 2 }} />)}
      </div>
    </div>
  )
}

// ── TaskNode ──────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = { TODO: '#64748b', IN_PROGRESS: '#3b82f6', DONE: '#22c55e', CANCELLED: '#ef4444' }
const PRIORITY_COLORS: Record<string, string> = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444', URGENT: '#dc2626' }

function TaskNode({ data, selected }: NodeProps<Record<string, unknown>>) {
  const navigate = useNavigate()
  const t = useT()
  const status = (data.status as string) ?? 'TODO'
  const priority = (data.priority as string) ?? 'MEDIUM'
  const STATUS_LABELS: Record<string, string> = { TODO: t.canvas.statusTodo, IN_PROGRESS: t.canvas.statusInProgress, DONE: t.canvas.statusDone, CANCELLED: t.canvas.statusCancelled }
  return (
    <div onDoubleClick={() => data.projectId && navigate(`/projects/${data.projectId as string}/tasks`)}
      style={{ width: 220, background: 'var(--bg-elevated)', border: `1px solid ${selected ? '#818cf8' : 'var(--border-default)'}`, borderLeft: `3px solid ${STATUS_COLORS[status] ?? '#64748b'}`, borderRadius: 8, padding: '10px 12px', boxShadow: selected ? '0 0 0 1px #818cf8, 0 8px 24px rgba(0,0,0,0.12)' : 'var(--card-shadow)', cursor: 'pointer', position: 'relative' }}>
      <NodeHandles />
      {!!data.project && <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 500 }}>{data.project as string}</p>}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
        <CheckSquare size={13} style={{ color: STATUS_COLORS[status] ?? '#64748b', marginTop: 1, flexShrink: 0 }} />
        <p style={{ fontSize: 13, fontWeight: 500, color: status === 'DONE' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: status === 'DONE' ? 'line-through' : 'none', lineHeight: 1.3, wordBreak: 'break-word', flex: 1 }}>
          {data.title as string}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: `${STATUS_COLORS[status]}22`, color: STATUS_COLORS[status] ?? '#64748b', fontWeight: 600 }}>{STATUS_LABELS[status] ?? status}</span>
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: `${PRIORITY_COLORS[priority]}22`, color: PRIORITY_COLORS[priority] ?? '#f59e0b', fontWeight: 600 }}>{priority}</span>
      </div>
    </div>
  )
}

// ── FileNode ──────────────────────────────────────────────────────────────────
function FileNode({ data, selected }: NodeProps<Record<string, unknown>>) {
  const fileCtx = useContext(CanvasFileCtx)
  const isImage = !!(data.mimeType && (data.mimeType as string).startsWith('image/'))
  // Internal files (saved attachments) resolve through the backend proxy with a
  // fresh token; only genuinely external images fall back to the bare data.url.
  const imgSrc = data.entityId ? attachmentContentUrl(data.entityId as string) : (data.url as string | undefined)
  return (
    <div
      onDoubleClick={() => fileCtx?.openFile(data)}
      style={{ background: 'var(--bg-surface)', border: `1px solid ${selected ? '#818cf8' : 'var(--border-default)'}`, borderRadius: 8, boxShadow: selected ? '0 0 0 2px #818cf8, 0 8px 24px rgba(0,0,0,0.12)' : 'var(--card-shadow)', minWidth: 150, minHeight: 80, width: '100%', height: '100%', position: 'relative', cursor: 'pointer' }}>
      <NodeHandles />
      {isImage && <NodeResizer minWidth={80} minHeight={60} color="#818cf8" isVisible={selected} />}
      {isImage && imgSrc ? (
        <img src={imgSrc} alt={data.filename as string} style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block', minHeight: 80, borderRadius: 7 }} />
      ) : (
        <>
          <div style={{ height: 60, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
            <Paperclip size={24} style={{ color: 'var(--text-muted)' }} />
          </div>
          <div style={{ padding: '8px 10px' }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', wordBreak: 'break-all', lineHeight: 1.3 }}>{data.filename as string}</p>
            {!!data.size && <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{Math.round((data.size as number) / 1024)} KB</p>}
          </div>
        </>
      )}
    </div>
  )
}

// ── LinkNode ──────────────────────────────────────────────────────────────────
function LinkNode({ data, selected }: NodeProps<Record<string, unknown>>) {
  return (
    <div onDoubleClick={() => data.url && window.open(data.url as string, '_blank')}
      style={{ width: 220, background: 'var(--bg-surface)', border: `1px solid ${selected ? '#818cf8' : 'var(--border-default)'}`, borderRadius: 10, padding: '10px 12px', boxShadow: selected ? '0 0 0 2px #818cf8, 0 8px 24px rgba(0,0,0,0.12)' : 'var(--card-shadow)', cursor: 'pointer', position: 'relative' }}>
      <NodeHandles />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Link2 size={12} style={{ color: '#38bdf8', flexShrink: 0 }} />
        <p style={{ fontSize: 11, color: '#38bdf8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{data.url as string}</p>
      </div>
      {!!data.title && <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{data.title as string}</p>}
      {!!data.description && <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>{data.description as string}</p>}
    </div>
  )
}

// ── TextNode ──────────────────────────────────────────────────────────────────
function TextNode({ data, selected, id }: NodeProps<Record<string, unknown>>) {
  const ctx = useContext(CanvasSaveCtx)
  const { setNodes, getEdges } = useReactFlow()
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')

  function commitEdit() {
    setEditing(false)
    setNodes((nds) => {
      const next = nds.map((n) => n.id === id ? { ...n, data: { ...n.data, text: editText } } : n)
      ctx?.save(next, getEdges())
      return next
    })
  }

  return (
    <div style={{ maxWidth: 280, padding: '4px 2px', cursor: 'text', borderBottom: selected ? '1px solid #818cf8' : '1px solid transparent', position: 'relative' }}
      onDoubleClick={() => { setEditText((data.text as string) ?? ''); setEditing(true) }}>
      <NodeHandles />
      {editing ? (
        <textarea autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
          onClick={(e) => e.stopPropagation()}
          style={{ background: 'transparent', border: 'none', outline: 'none', resize: 'none', width: 280, minHeight: 40, fontSize: (data.fontSize as number) ?? 16, fontWeight: (data.bold as boolean) ? 700 : 400, color: (data.color as string) ?? 'var(--text-primary)', lineHeight: 1.5 }} />
      ) : (
        <p style={{ fontSize: (data.fontSize as number) ?? 16, fontWeight: (data.bold as boolean) ? 700 : 400, color: (data.color as string) ?? 'var(--text-primary)', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
          {(data.text as string) || t.canvas.editPlaceholder}
        </p>
      )}
    </div>
  )
}

const NODE_TYPES: NodeTypes = { note: NoteNode, page: PageNode, task: TaskNode, file: FileNode, link: LinkNode, text: TextNode }

// ── AddLinkPanel ──────────────────────────────────────────────────────────────
function AddLinkPanel({ onAdd, onClose }: { onAdd: (url: string, title: string) => void; onClose: () => void }) {
  const t = useT()
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')

  function submit() {
    const trimmed = url.trim()
    if (!trimmed) return
    onAdd(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`, title.trim())
    onClose()
  }

  return (
    <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 4px 24px rgba(0,0,0,0.15)', minWidth: 320 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link2 size={13} style={{ color: '#38bdf8' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{t.canvas.addLink}</span>
        <button onClick={onClose} style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}><X size={12} /></button>
      </div>
      <input autoFocus type="url" value={url} onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
        placeholder={t.canvas.linkUrlPlaceholder}
        style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--input-text)', outline: 'none', width: '100%' }} />
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
        placeholder={t.canvas.linkTitlePlaceholder}
        style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--input-text)', outline: 'none', width: '100%' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button onClick={onClose} style={{ padding: '4px 10px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>{/* cancel */}<X size={11} /></button>
        <button onClick={submit} style={{ padding: '4px 12px', borderRadius: 6, background: '#6366f1', border: 'none', color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>{t.canvas.addLinkBtn}</button>
      </div>
    </div>
  )
}

// ── ContentPicker ─────────────────────────────────────────────────────────────
function ContentPicker({ onAdd, existingEntityIds, workspaceId, onClose }: {
  onAdd: (node: Omit<RFNode, 'id' | 'position'>) => void
  existingEntityIds: Set<string>
  workspaceId: string
  onClose: () => void
}) {
  const t = useT()
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'pages' | 'tasks' | 'notes' | 'files'>('pages')
  const [selectedProject, setSelectedProject] = useState<string | null>(null)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-for-canvas', workspaceId],
    queryFn: () => projectApi.listByWorkspace(workspaceId),
    staleTime: 30_000,
  })
  const activeProjects = projects.filter((p) => p.status === 'ACTIVE')

  useEffect(() => {
    if (activeProjects.length > 0 && !selectedProject) setSelectedProject(activeProjects[0].id)
  }, [activeProjects]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: pages = [] } = useQuery({
    queryKey: ['canvas-picker-pages', selectedProject],
    queryFn: () => pageApi.listByProject(selectedProject!),
    enabled: !!selectedProject && activeTab === 'pages',
  })
  const { data: tasksData } = useQuery({
    queryKey: ['canvas-picker-tasks', selectedProject],
    queryFn: () => taskApi.list({ projectId: selectedProject!, limit: 100 }),
    enabled: !!selectedProject && activeTab === 'tasks',
  })
  const { data: notes = [] } = useQuery({
    queryKey: ['canvas-picker-notes', workspaceId, selectedProject, activeTab],
    queryFn: () => noteApi.list({ workspaceId, projectId: selectedProject ?? undefined }),
    enabled: activeTab === 'notes',
    staleTime: 30_000,
  })
  const { data: files = [] } = useQuery({
    queryKey: ['canvas-picker-files', workspaceId, selectedProject, activeTab],
    queryFn: () => uploadApi.list({ workspaceId, projectId: selectedProject ?? undefined }),
    enabled: activeTab === 'files',
    staleTime: 30_000,
  })

  const tasks = tasksData?.items ?? []
  const q = search.toLowerCase()
  const filteredPages = pages.filter((p) => !q || p.title.toLowerCase().includes(q))
  const filteredTasks = tasks.filter((task: Task) => !q || task.title.toLowerCase().includes(q))
  const filteredNotes = notes.filter((n) => !q || getTextPreview(n.content).toLowerCase().includes(q))
  const filteredFiles = files.filter((f) => !q || f.filename.toLowerCase().includes(q))

  const selectedProjectObj = activeProjects.find((p) => p.id === selectedProject)

  function addPage(p: typeof pages[0], project: Project) {
    onAdd({ type: 'page', data: { entityId: p.id, title: p.title, icon: p.icon ?? undefined, project: project.name }, style: { width: 200, height: 120 } })
  }
  function addTask(task: Task, project: Project) {
    onAdd({ type: 'task', data: { entityId: task.id, title: task.title, status: task.status, priority: task.priority, projectId: task.projectId, project: project.name } })
  }
  function addNote(note: { id: string; content: Record<string, unknown>; color: string | null }) {
    onAdd({ type: 'note', data: { entityId: note.id, preview: getTextPreview(note.content), color: note.color ?? '#fef08a' }, style: { width: 180, height: 150 } })
  }
  function addFile(file: typeof files[0]) {
    const isImg = file.mimeType.startsWith('image/')
    onAdd({ type: 'file', data: { entityId: file.id, filename: file.filename, mimeType: file.mimeType, size: file.size, url: file.url }, ...(isImg ? { style: { width: 240, height: 180 } } : {}) })
  }

  const TABS = [
    { id: 'pages', label: t.canvas.pickerPages },
    { id: 'tasks', label: t.canvas.pickerTasks },
    { id: 'notes', label: t.canvas.pickerNotes },
    { id: 'files', label: t.canvas.pickerFiles },
  ] as const

  return (
    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 320, zIndex: 20, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 20px rgba(0,0,0,0.12)' }}>
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Plus size={14} style={{ color: '#6366f1' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{t.canvas.pickerTitle}</span>
        <button onClick={onClose} style={{ color: 'var(--text-muted)', padding: 4, cursor: 'pointer', background: 'none', border: 'none' }}><X size={14} /></button>
      </div>

      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', position: 'relative' }}>
        <Search size={11} style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.canvas.pickerSearch}
          style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 6, padding: '5px 8px 5px 24px', fontSize: 12, color: 'var(--input-text)', outline: 'none' }} />
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ flex: 1, padding: '7px 4px', fontSize: 11, fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none', borderBottom: activeTab === tab.id ? '2px solid #6366f1' : '2px solid transparent', color: activeTab === tab.id ? '#6366f1' : 'var(--text-muted)', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Project selector */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 4, overflowX: 'auto' }}>
        {(activeTab === 'notes' || activeTab === 'files') && (
          <button onClick={() => setSelectedProject(null)}
            style={{ flexShrink: 0, fontSize: 11, padding: '3px 8px', borderRadius: 5, cursor: 'pointer', background: selectedProject === null ? '#6366f1' : 'var(--bg-elevated)', border: `1px solid ${selectedProject === null ? '#6366f1' : 'var(--border-default)'}`, color: selectedProject === null ? '#fff' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {t.canvas.allProjects}
          </button>
        )}
        {activeProjects.map((p) => (
          <button key={p.id} onClick={() => setSelectedProject(p.id)}
            style={{ flexShrink: 0, fontSize: 11, padding: '3px 8px', borderRadius: 5, cursor: 'pointer', background: selectedProject === p.id ? '#6366f1' : 'var(--bg-elevated)', border: `1px solid ${selectedProject === p.id ? '#6366f1' : 'var(--border-default)'}`, color: selectedProject === p.id ? '#fff' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {p.name}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {activeTab === 'pages' && filteredPages.map((page) => {
          const added = existingEntityIds.has(page.id)
          return (
            <div key={page.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', opacity: added ? 0.5 : 1 }} className={!added ? 'hover:bg-black/5' : undefined}>
              <FileText size={13} style={{ color: '#6366f1', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stripLeadingEmoji(page.title) || '—'}</span>
              {added ? <Check size={12} style={{ color: '#22c55e', flexShrink: 0 }} /> : (
                <button onClick={() => selectedProjectObj && addPage(page, selectedProjectObj)}
                  style={{ flexShrink: 0, padding: '2px 8px', borderRadius: 4, background: '#6366f1', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer' }}>{t.canvas.pickerAdd}</button>
              )}
            </div>
          )
        })}

        {activeTab === 'tasks' && filteredTasks.map((task: Task) => {
          const added = existingEntityIds.has(task.id)
          return (
            <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', opacity: added ? 0.5 : 1 }} className={!added ? 'hover:bg-black/5' : undefined}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[task.status] ?? '#64748b', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
              {added ? <Check size={12} style={{ color: '#22c55e', flexShrink: 0 }} /> : (
                <button onClick={() => selectedProjectObj && addTask(task, selectedProjectObj)}
                  style={{ flexShrink: 0, padding: '2px 8px', borderRadius: 4, background: '#6366f1', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer' }}>{t.canvas.pickerAdd}</button>
              )}
            </div>
          )
        })}

        {activeTab === 'notes' && filteredNotes.map((note) => {
          const added = existingEntityIds.has(note.id)
          const preview = getTextPreview(note.content)
          return (
            <div key={note.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', opacity: added ? 0.5 : 1 }} className={!added ? 'hover:bg-black/5' : undefined}>
              <StickyNote size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview || t.canvas.pickerEmptyNote}</span>
              {added ? <Check size={12} style={{ color: '#22c55e', flexShrink: 0 }} /> : (
                <button onClick={() => addNote(note)}
                  style={{ flexShrink: 0, padding: '2px 8px', borderRadius: 4, background: '#6366f1', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer' }}>{t.canvas.pickerAdd}</button>
              )}
            </div>
          )
        })}

        {activeTab === 'files' && filteredFiles.map((file) => {
          const added = existingEntityIds.has(file.id)
          const isImg = file.mimeType.startsWith('image/')
          return (
            <div key={file.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', opacity: added ? 0.5 : 1 }} className={!added ? 'hover:bg-black/5' : undefined}>
              {isImg
                ? <img src={file.url} alt={file.filename} style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                : <Paperclip size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              }
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.filename}</span>
              {added ? <Check size={12} style={{ color: '#22c55e', flexShrink: 0 }} /> : (
                <button onClick={() => addFile(file)}
                  style={{ flexShrink: 0, padding: '2px 8px', borderRadius: 4, background: '#6366f1', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer' }}>{t.canvas.pickerAdd}</button>
              )}
            </div>
          )
        })}

        {activeTab === 'pages' && filteredPages.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: '24px 16px' }}>{t.canvas.pickerNoPages}</p>}
        {activeTab === 'tasks' && filteredTasks.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: '24px 16px' }}>{t.canvas.pickerNoTasks}</p>}
        {activeTab === 'notes' && filteredNotes.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: '24px 16px' }}>{t.canvas.pickerNoNotes}</p>}
        {activeTab === 'files' && filteredFiles.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: '24px 16px' }}>{t.canvas.pickerNoFiles}</p>}
      </div>
    </div>
  )
}

function getTextPreview(content: Record<string, unknown>): string {
  try {
    const nodes = (content?.content as { type: string; content?: { text?: string }[] }[]) ?? []
    const texts: string[] = []
    for (const node of nodes) {
      if (node.content) for (const leaf of node.content) { if (leaf.text) texts.push(leaf.text) }
      if (texts.join(' ').length > 120) break
    }
    return texts.join(' ').slice(0, 120)
  } catch { return '' }
}

// ── EdgeColorPanel ─────────────────────────────────────────────────────────────
function EdgeColorPanel({ edgeId, currentColor, onColorChange, onClose }: {
  edgeId: string; currentColor: string
  onColorChange: (id: string, color: string) => void; onClose: () => void
}) {
  const t = useT()
  return (
    <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t.canvas.edgeColorLabel}:</span>
      <div style={{ display: 'flex', gap: 5 }}>
        {EDGE_COLORS.map((c) => (
          <button key={c} onClick={() => onColorChange(edgeId, c)}
            style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: currentColor === c ? '2px solid var(--text-primary)' : '2px solid transparent', cursor: 'pointer' }} />
        ))}
      </div>
      <button onClick={onClose} style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}><X size={12} /></button>
    </div>
  )
}

// ── CanvasInner ────────────────────────────────────────────────────────────────
function CanvasInner({ nodes, setNodes, onNodesChange, edges, setEdges, onEdgesChange, onConnect, scheduleSave, saveNow, pickerOpen, workspaceId, onAddNode, onClosePicker, addLinkOpen, onCloseLinkPanel, onViewportChange }: {
  nodes: RFNode[]; setNodes: React.Dispatch<React.SetStateAction<RFNode[]>>
  onNodesChange: OnNodesChange; edges: RFEdge[]; setEdges: React.Dispatch<React.SetStateAction<RFEdge[]>>
  onEdgesChange: OnEdgesChange; onConnect: (params: Connection) => void
  scheduleSave: (nds: RFNode[], eds: RFEdge[]) => void
  saveNow: (nds: RFNode[], eds: RFEdge[]) => void
  pickerOpen: boolean; workspaceId: string
  onAddNode: (node: Omit<RFNode, 'id' | 'position'>) => void; onClosePicker: () => void
  addLinkOpen: boolean; onCloseLinkPanel: () => void
  onViewportChange: (vp: CanvasViewport) => void
}) {
  const t = useT()
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [viewingFile, setViewingFile] = useState<Attachment | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const saveRef = useRef(scheduleSave)
  useEffect(() => { saveRef.current = scheduleSave }, [scheduleSave])

  const ctxValue = useMemo(() => ({ save: (nds: RFNode[], eds: RFEdge[]) => saveRef.current(nds, eds) }), [])
  const fileCtxValue = useMemo(() => ({
    openFile: (data: Record<string, unknown>) => {
      if (!data.url && !data.entityId) return
      setViewingFile({
        id: (data.entityId as string) ?? '',
        filename: (data.filename as string) ?? '',
        mimeType: (data.mimeType as string) ?? '',
        size: (data.size as number) ?? 0,
        url: data.url as string,
        workspaceId: '', projectId: null, description: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      } as unknown as Attachment)
    },
  }), [])

  const existingEntityIds = new Set(nodes.map((n) => n.data?.entityId as string).filter(Boolean))
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId)

  function handleNodesChange(changes: Parameters<OnNodesChange>[0]) {
    onNodesChange(changes)
    const typed = changes as { type: string; dragging?: boolean }[]
    const hasMoved = typed.some((c) => c.type === 'position' && c.dragging === false)
    // Persist deletions immediately — without this a removed node is never saved
    // and "comes back" on the next refetch (live canvas.updated event or remount).
    const hasRemoved = typed.some((c) => c.type === 'remove')
    if (hasRemoved) setNodes((nds) => { saveNow(nds, edges); return nds })
    else if (hasMoved) setNodes((nds) => { scheduleSave(nds, edges); return nds })
  }
  function handleEdgesChange(changes: Parameters<OnEdgesChange>[0]) {
    onEdgesChange(changes)
    setEdges((eds) => { scheduleSave(nodes, eds); return eds })
  }
  function handleEdgeClick(_: React.MouseEvent, edge: RFEdge) { setSelectedEdgeId(edge.id) }

  function changeEdgeColor(id: string, color: string) {
    setEdges((eds) => {
      const next = eds.map((e) => e.id === id ? { ...e, style: { ...e.style, stroke: color } } : e)
      scheduleSave(nodes, next)
      return next
    })
  }

  function handleAddLink(url: string, title: string) {
    onAddNode({ type: 'link', data: { url, title: title || url } })
  }

  return (
    <CanvasSaveCtx.Provider value={ctxValue}>
    <CanvasFileCtx.Provider value={fileCtxValue}>
      {viewingFile && <FileViewer file={viewingFile} onClose={() => setViewingFile(null)} />}
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange}
          onConnect={onConnect} onEdgeClick={handleEdgeClick}
          onPaneClick={() => setSelectedEdgeId(null)}
          onMoveEnd={(_, vp) => onViewportChange(vp)}
          nodeTypes={NODE_TYPES}
          fitView={nodes.length > 0} minZoom={0.1} maxZoom={3}
          connectionMode={ConnectionMode.Loose}
          deleteKeyCode="Delete" proOptions={{ hideAttribution: true }}
          style={{ background: 'var(--bg-app)' }}
          defaultEdgeOptions={{ style: { stroke: '#6366f1', strokeWidth: 2 }, animated: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border-default)" />
          <Controls style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8 }} />
          <MiniMap
            pannable
            zoomable
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', bottom: 84, right: 16 }}
            maskColor="rgba(128,128,128,0.12)"
            nodeColor={(node) => {
              if (node.type === 'note') return '#fbbf24'
              if (node.type === 'task') return '#3b82f6'
              if (node.type === 'page') return '#6366f1'
              if (node.type === 'link') return '#38bdf8'
              return '#94a3b8'
            }}
          />
          <Panel position="bottom-center">
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '5px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
              {t.canvas.hintPanel}
            </div>
          </Panel>
        </ReactFlow>

        {addLinkOpen && <AddLinkPanel onAdd={handleAddLink} onClose={onCloseLinkPanel} />}
        {selectedEdgeId && selectedEdge && !addLinkOpen && (
          <EdgeColorPanel edgeId={selectedEdgeId} currentColor={(selectedEdge.style?.stroke as string) ?? '#6366f1'} onColorChange={changeEdgeColor} onClose={() => setSelectedEdgeId(null)} />
        )}
        {pickerOpen && (
          <ContentPicker onAdd={onAddNode} existingEntityIds={existingEntityIds} workspaceId={workspaceId} onClose={onClosePicker} />
        )}
      </div>
    </CanvasFileCtx.Provider>
    </CanvasSaveCtx.Provider>
  )
}

// ── CanvasPage ────────────────────────────────────────────────────────────────
export function CanvasPage() {
  const { canvasId: paramCanvasId } = useParams<{ canvasId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const t = useT()
  const { currentWorkspaceId } = useWorkspaceStore()
  const { pending, setPending } = useCanvasStore()

  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(paramCanvasId ?? null)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [addLinkOpen, setAddLinkOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentViewport = useRef<CanvasViewport>({ x: 0, y: 0, zoom: 1 })
  const nodeCounter = useRef(0)

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as globalThis.Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const { data: canvasList = [] } = useQuery({
    queryKey: ['canvases', currentWorkspaceId],
    queryFn: () => canvasApi.list(currentWorkspaceId!),
    enabled: !!currentWorkspaceId,
  })

  useEffect(() => {
    if (paramCanvasId) setActiveCanvasId(paramCanvasId)
    else if (canvasList.length > 0 && !activeCanvasId) {
      setActiveCanvasId(canvasList[0].id)
      navigate(`/canvas/${canvasList[0].id}`, { replace: true })
    }
  }, [paramCanvasId, canvasList]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: canvasData, isLoading } = useQuery({
    queryKey: ['canvas', activeCanvasId],
    queryFn: () => canvasApi.getById(activeCanvasId!),
    enabled: !!activeCanvasId,
  })

  const loadedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!canvasData) return
    const isSwitch = loadedIdRef.current !== canvasData.id
    // On a same-canvas refetch, only skip the reload while a debounced save is
    // still pending (an unsaved node move) — otherwise always apply, so live
    // external changes (e.g. project-delete pruning dangling nodes) show up.
    if (!isSwitch && pendingSaveRef.current) return
    loadedIdRef.current = canvasData.id
    setNodes((canvasData.nodes as RFNode[]) ?? [])
    setEdges((canvasData.edges as RFEdge[]) ?? [])
    setNameValue(canvasData.name)
    if (canvasData.viewport) currentViewport.current = canvasData.viewport
  }, [canvasData]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pending || !activeCanvasId) return
    const id = `node-${Date.now()}-${++nodeCounter.current}`
    const vp = currentViewport.current
    const x = (-vp.x + 300 + nodeCounter.current * 30) / vp.zoom
    const y = (-vp.y + 200 + nodeCounter.current * 30) / vp.zoom
    const newNode: RFNode = { id, type: pending.node.type as string, position: { x, y }, data: pending.node.data as Record<string, unknown> }
    setNodes((nds) => { const next = [...nds, newNode]; scheduleSave(next, edges); return next })
    setPending(null)
  }, [pending, activeCanvasId]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveMutation = useMutation({
    mutationFn: (data: { nodes: RFNode[]; edges: RFEdge[]; viewport: CanvasViewport }) =>
      canvasApi.update(activeCanvasId!, { nodes: data.nodes as CanvasNode[], edges: data.edges as CanvasEdge[], viewport: data.viewport }),
    onSuccess: (data) => {
      // Keep the per-board cache in sync with what was just persisted, so
      // switching boards and back doesn't restore a stale pre-edit snapshot.
      qc.setQueryData(['canvas', data.id], data)
      qc.invalidateQueries({ queryKey: ['canvases', currentWorkspaceId] })
    },
    onError: (err: unknown) => {
      // Surface save failures (e.g. 403) — otherwise a rejected save silently
      // drops the edit and deleted nodes reappear on the next reload.
      const msg = err instanceof Error ? err.message : 'save failed'
      toast.error(`${t.canvas.saving}: ${msg}`)
    },
  })

  // Latest state refs so the unmount flush saves the current board, not a stale closure.
  const pendingSaveRef = useRef<{ nodes: RFNode[]; edges: RFEdge[] } | null>(null)
  const activeCanvasIdRef = useRef(activeCanvasId)
  useEffect(() => { activeCanvasIdRef.current = activeCanvasId }, [activeCanvasId])

  function scheduleSave(nds: RFNode[], eds: RFEdge[]) {
    if (!activeCanvasId) return
    pendingSaveRef.current = { nodes: nds, edges: eds }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveMutation.mutate({ nodes: nds, edges: eds, viewport: currentViewport.current })
      pendingSaveRef.current = null
    }, 1500)
  }

  // Persist immediately (no debounce) — used for deletions so the change can't
  // be reverted by a refetch landing inside the debounce window.
  function saveNow(nds: RFNode[], eds: RFEdge[]) {
    if (!activeCanvasId) return
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    pendingSaveRef.current = null
    saveMutation.mutate({ nodes: nds, edges: eds, viewport: currentViewport.current })
  }

  // Flush any pending save when leaving the page so edits (e.g. deletions)
  // aren't lost — otherwise the board reloads the old DB state on return and
  // deleted nodes "come back".
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const id = activeCanvasIdRef.current
      const pending = pendingSaveRef.current
      if (id && pending) {
        canvasApi.update(id, {
          nodes: pending.nodes as CanvasNode[],
          edges: pending.edges as CanvasEdge[],
          viewport: currentViewport.current,
        }).then((data) => qc.setQueryData(['canvas', id], data)).catch(() => {})
        pendingSaveRef.current = null
      }
    }
  }, [])

  const canvasContainerRef = useRef<HTMLDivElement>(null)

  function addNodeToCanvas(nodeTemplate: Omit<RFNode, 'id' | 'position'>) {
    if (!activeCanvasId) return
    const id = `node-${Date.now()}-${++nodeCounter.current}`
    const vp = currentViewport.current
    const rect = canvasContainerRef.current?.getBoundingClientRect()
    const cw = rect ? rect.width : 800
    const ch = rect ? rect.height : 600
    const jitter = (nodeCounter.current % 5 - 2) * 30
    const x = (-vp.x + cw / 2 + jitter) / vp.zoom
    const y = (-vp.y + ch / 2 + jitter) / vp.zoom
    const newNode: RFNode = { id, type: nodeTemplate.type, position: { x, y }, data: nodeTemplate.data, ...(nodeTemplate.style ? { style: nodeTemplate.style } : {}) }
    setNodes((nds) => { const next = [...nds, newNode]; scheduleSave(next, edges); return next })
  }

  const createCanvas = useMutation({
    mutationFn: () => canvasApi.create(currentWorkspaceId!, t.canvas.newBoard),
    onSuccess: (canvas) => {
      qc.invalidateQueries({ queryKey: ['canvases', currentWorkspaceId] })
      setActiveCanvasId(canvas.id); navigate(`/canvas/${canvas.id}`, { replace: true }); setDropdownOpen(false)
    },
  })

  const deleteCanvas = useMutation({
    mutationFn: (id: string) => canvasApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canvases', currentWorkspaceId] })
      const next = canvasList.find((c) => c.id !== activeCanvasId)
      if (next) { setActiveCanvasId(next.id); navigate(`/canvas/${next.id}`, { replace: true }) }
      else { setActiveCanvasId(null); navigate('/canvas', { replace: true }) }
    },
  })

  const renameCanvas = useMutation({
    mutationFn: (name: string) => canvasApi.update(activeCanvasId!, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canvases', currentWorkspaceId] })
      qc.invalidateQueries({ queryKey: ['canvas', activeCanvasId] })
    },
  })

  function commitRename() {
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== canvasData?.name) renameCanvas.mutate(trimmed)
    setEditingName(false)
  }

  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) => {
      const next = addEdge({ ...params, animated: true, style: { stroke: '#6366f1', strokeWidth: 2 } }, eds)
      scheduleSave(nodes, next)
      return next
    })
  }, [nodes]) // eslint-disable-line react-hooks/exhaustive-deps

  const titleEl = editingName ? (
    <div className="flex items-center gap-1.5">
      <input autoFocus value={nameValue} onChange={(e) => setNameValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingName(false) }}
        onBlur={commitRename}
        className="bg-surface-800 border border-primary-500 rounded px-2 py-0.5 text-base font-semibold text-slate-100 focus:outline-none w-48" />
      <button onClick={commitRename} className="p-1 text-primary-400"><Check size={14} /></button>
      <button onClick={() => setEditingName(false)} className="p-1 text-slate-500"><X size={14} /></button>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <div className="relative" ref={dropdownRef}>
        <button onClick={() => setDropdownOpen((v) => !v)} className="flex items-center gap-1.5 text-base font-semibold btn-ghost">
          <Layers size={14} className="text-primary-400" />
          <span>{canvasData?.name ?? t.canvas.title}</span>
          {canvasList.length > 1 && (
            <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-muted)', borderRadius: 10, padding: '0 5px', lineHeight: '16px', minWidth: 18, textAlign: 'center' }}>
              {canvasList.length}
            </span>
          )}
          <ChevronDown size={12} className="text-slate-500" />
        </button>
        {dropdownOpen && (
          <div className="absolute left-0 top-full mt-1 z-30 rounded-xl shadow-2xl py-1 min-w-[200px] border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
            {canvasList.map((c) => (
              <button key={c.id} onClick={() => { setActiveCanvasId(c.id); navigate(`/canvas/${c.id}`, { replace: true }); setDropdownOpen(false) }}
                className={cn('w-full text-left px-3 py-2 text-sm hover:bg-black/5 transition-colors flex items-center gap-2', c.id === activeCanvasId && 'text-primary-400 bg-primary-500/10')}>
                <Layers size={12} /><span className="truncate flex-1">{c.name}</span>
              </button>
            ))}
            <div className="border-t my-1" style={{ borderColor: 'var(--border-subtle)' }} />
            <button onClick={() => createCanvas.mutate()} disabled={createCanvas.isPending}
              className="w-full text-left px-3 py-2 text-sm text-primary-400 hover:bg-black/5 transition-colors flex items-center gap-2">
              {createCanvas.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {t.canvas.newBoard}
            </button>
          </div>
        )}
      </div>
      {canvasData && (
        <button onClick={() => { setNameValue(canvasData.name); setEditingName(true) }} className="p-1 text-slate-500 hover:text-slate-300" title={t.canvas.renameBoard}>
          <Pencil size={11} />
        </button>
      )}
    </div>
  )

  if (!isLoading && canvasList.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header title={<span className="flex items-center gap-2"><Layers size={16} className="text-primary-400" />{t.canvas.title}</span>} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Layers size={48} className="mx-auto text-slate-700 mb-4" />
            <p className="text-slate-500 text-sm mb-4">{t.canvas.noBoards}</p>
            <button onClick={() => createCanvas.mutate()} disabled={createCanvas.isPending} className="btn-primary">
              {createCanvas.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {t.canvas.createFirst}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title={titleEl}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => { setPickerOpen((v) => !v); setAddLinkOpen(false) }} className={cn('btn-ghost text-xs', pickerOpen && 'text-primary-400 bg-primary-500/10')}>
              <FolderKanban size={13} /> {t.canvas.addContent}
            </button>
            <button onClick={() => activeCanvasId && addNodeToCanvas({ type: 'note', data: { preview: '', color: ['#fef08a', '#bbf7d0', '#bae6fd', '#fecaca', '#e9d5ff'][Math.floor(Math.random() * 5)] }, style: { width: 180, height: 150 } })} className="btn-ghost text-xs">
              <StickyNote size={13} /> {t.canvas.addNote}
            </button>
            <button onClick={() => activeCanvasId && addNodeToCanvas({ type: 'text', data: { text: '' } })} className="btn-ghost text-xs">
              <Type size={13} /> {t.canvas.addText}
            </button>
            <button onClick={() => { setAddLinkOpen((v) => !v); setPickerOpen(false) }} className={cn('btn-ghost text-xs', addLinkOpen && 'text-primary-400 bg-primary-500/10')}>
              <Link2 size={13} /> {t.canvas.addLink}
            </button>
            {activeCanvasId && (
              <button onClick={() => { if (confirm(t.canvas.deleteConfirm)) deleteCanvas.mutate(activeCanvasId) }} disabled={deleteCanvas.isPending}
                className="btn-ghost text-xs text-red-500 hover:text-red-400 hover:bg-red-950/30">
                {deleteCanvas.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            )}
            {saveMutation.isPending && (
              <span className="text-xs text-slate-500 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> {t.canvas.saving}</span>
            )}
          </div>
        }
      />
      <div ref={canvasContainerRef} className="flex-1 relative overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full"><Loader2 size={24} className="animate-spin text-primary-500" /></div>
        ) : activeCanvasId ? (
          <ReactFlowProvider>
            <CanvasInner
              nodes={nodes} setNodes={setNodes} onNodesChange={onNodesChange}
              edges={edges} setEdges={setEdges} onEdgesChange={onEdgesChange}
              onConnect={onConnect} scheduleSave={scheduleSave} saveNow={saveNow}
              pickerOpen={pickerOpen} workspaceId={currentWorkspaceId!}
              onAddNode={addNodeToCanvas} onClosePicker={() => setPickerOpen(false)}
              addLinkOpen={addLinkOpen} onCloseLinkPanel={() => setAddLinkOpen(false)}
              onViewportChange={(vp) => { currentViewport.current = vp }}
            />
          </ReactFlowProvider>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Layers size={48} className="mx-auto text-slate-700 mb-4" />
              <p className="text-slate-500 text-sm mb-4">{t.canvas.noBoards}</p>
              <button onClick={() => createCanvas.mutate()} disabled={createCanvas.isPending} className="btn-primary">
                {createCanvas.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {t.canvas.createFirst}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
