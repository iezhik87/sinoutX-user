import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeTypes,
  type Connection,
  type NodeDragHandler,
  type ReactFlowInstance,
  BackgroundVariant,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Loader2, Network, Star, LayoutGrid, FileText, CheckSquare, StickyNote, Link2, Folder } from 'lucide-react'
import { graphApi, type GraphNode, type Attachment } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { Header } from '@/components/layout/Header'
import { Modal } from '@/components/common/Modal'
import { FileViewer } from '@/components/sources/FileViewer'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

// ─── Custom node types ────────────────────────────────────────────────────────

type NodeData = {
  label: string
  status?: string
  priority?: string
  isImportant?: boolean
  onNavigate?: () => void
}

// Folder — amber scheme
function FolderNode({ data }: { data: NodeData }) {
  const t = useT()
  return (
    <div
      className="bg-slate-900 border border-amber-700/60 rounded-xl px-3 py-2.5 min-w-[140px] max-w-[210px] shadow-lg cursor-pointer hover:border-amber-400 hover:shadow-amber-900/30 transition-all"
      onClick={data.onNavigate}
      title={t.graph.openFolder}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-amber-500 !border-amber-700 !top-[-5px]" />
      <div className="flex items-center gap-2">
        <div className="flex-shrink-0 w-6 h-6 rounded-md bg-amber-900/50 flex items-center justify-center">
          <Folder size={12} className="text-amber-400" />
        </div>
        <span className="text-xs text-amber-100 truncate font-semibold leading-tight">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-amber-500 !border-amber-700 !bottom-[-5px]" />
    </div>
  )
}

// Page — blue scheme, document shape
function PageNode({ data }: { data: NodeData }) {
  const t = useT()
  return (
    <div
      className="bg-slate-900 border border-blue-800/60 rounded-xl px-3 py-2.5 min-w-[140px] max-w-[210px] shadow-lg cursor-pointer hover:border-blue-500 hover:shadow-blue-900/30 transition-all"
      onClick={data.onNavigate}
      title={t.graph.openPage}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-blue-500 !border-blue-700 !top-[-5px]" />
      <div className="flex items-center gap-2">
        <div className="flex-shrink-0 w-6 h-6 rounded-md bg-blue-900/50 flex items-center justify-center">
          <FileText size={12} className="text-blue-400" />
        </div>
        <span className="text-xs text-slate-200 truncate font-medium leading-tight">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-blue-500 !border-blue-700 !bottom-[-5px]" />
    </div>
  )
}

// Task — priority strip on left, checkbox icon, status badge
function TaskNode({ data }: { data: NodeData }) {
  const priorityBg: Record<string, string> = {
    URGENT: 'bg-red-600',
    HIGH: 'bg-orange-500',
    MEDIUM: 'bg-indigo-500',
    LOW: 'bg-slate-600',
  }
  const stripClass = priorityBg[data.priority ?? 'MEDIUM'] ?? 'bg-slate-600'

  const statusColors: Record<string, string> = {
    DONE: 'text-emerald-400',
    IN_PROGRESS: 'text-indigo-400',
    TODO: 'text-slate-500',
    BLOCKED: 'text-red-400',
  }
  const statusColor = statusColors[data.status ?? 'TODO'] ?? 'text-slate-500'

  const t = useT()
  return (
    <div
      className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-lg cursor-pointer hover:border-indigo-500 hover:shadow-indigo-900/20 transition-all flex min-w-[140px] max-w-[210px]"
      onClick={data.onNavigate}
      title={t.graph.openTasks}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-indigo-500 !border-indigo-700 !top-[-5px]" />
      {/* Priority strip */}
      <div className={cn('w-1.5 flex-shrink-0', stripClass)} />
      <div className="px-2.5 py-2 flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <CheckSquare size={12} className="text-indigo-400 flex-shrink-0" />
          <span className="text-xs text-slate-200 truncate font-medium">{data.label}</span>
        </div>
        {data.status && (
          <span className={cn('text-[10px] mt-0.5 block', statusColor)}>
            {data.status.toLowerCase().replace('_', ' ')}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-indigo-500 !border-indigo-700 !bottom-[-5px]" />
    </div>
  )
}

// Note — sticky-note style, warm yellow tint
function NoteNode({ data }: { data: NodeData }) {
  const t = useT()
  return (
    <div
      className="bg-amber-950/60 border border-amber-700/50 rounded-xl px-3 py-2.5 min-w-[130px] max-w-[200px] shadow-lg cursor-pointer hover:border-amber-500 hover:shadow-amber-900/30 transition-all"
      onClick={data.onNavigate}
      title={t.graph.openNotes}
      style={{ transform: 'rotate(-1deg)' }}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-amber-500 !border-amber-700 !top-[-5px]" />
      <div className="flex items-center gap-2">
        <div className="flex-shrink-0 w-6 h-6 rounded-md bg-amber-900/60 flex items-center justify-center">
          <StickyNote size={12} className="text-amber-400" />
        </div>
        <span className="text-xs text-amber-100 truncate font-medium leading-tight">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-amber-500 !border-amber-700 !bottom-[-5px]" />
    </div>
  )
}

// Attachment / Source — diamond-ish with link icon, teal tint
function AttachmentNode({ data }: { data: NodeData }) {
  const t = useT()
  return (
    <div
      className={cn(
        'bg-slate-900 border rounded-lg px-3 py-2 min-w-[120px] max-w-[190px] shadow-lg cursor-pointer transition-all',
        data.isImportant
          ? 'border-amber-600/70 hover:border-amber-400 hover:shadow-amber-900/20'
          : 'border-teal-800/60 hover:border-teal-500 hover:shadow-teal-900/20',
      )}
      onClick={data.onNavigate}
      title={t.graph.openFile}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-teal-500 !border-teal-700 !top-[-5px]" />
      <div className="flex items-center gap-2">
        <div className={cn('flex-shrink-0 w-5 h-5 rounded flex items-center justify-center', data.isImportant ? 'bg-amber-900/50' : 'bg-teal-900/50')}>
          {data.isImportant
            ? <Star size={11} className="text-amber-400 fill-amber-400" />
            : <Link2 size={11} className="text-teal-400" />
          }
        </div>
        <span className="text-xs text-slate-300 truncate">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-teal-500 !border-teal-700 !bottom-[-5px]" />
    </div>
  )
}

const NODE_TYPES: NodeTypes = {
  folder: FolderNode,
  page: PageNode,
  task: TaskNode,
  note: NoteNode,
  attachment: AttachmentNode,
}

// ─── Tree layout (top-down) ───────────────────────────────────────────────────
// Рекурсивный алгоритм: каждый узел центрируется над своим поддеревом.

function layoutNodes(
  nodes: GraphNode[],
  edges: Array<{ source: string; target: string; linkType?: string }>,
): { x: number; y: number }[] {
  if (nodes.length === 0) return []

  const V_STEP   = 90   // вертикальный шаг между строками
  const INDENT   = 28   // отступ на каждый уровень вложенности
  const COL_W    = 280  // ширина колонки (расстояние между корнями)
  const START_Y  = 60

  // Строим карты детей отдельно для иерархии и задач
  const hierChildren = new Map<string, string[]>()
  const taskChildren = new Map<string, string[]>()
  const hasParent    = new Set<string>()

  for (const e of edges) {
    const t = e.linkType ?? ''
    if (t === 'HIERARCHY') {
      if (!hierChildren.has(e.source)) hierChildren.set(e.source, [])
      hierChildren.get(e.source)!.push(e.target)
      hasParent.add(e.target)
    } else if (t === 'TASK') {
      if (!taskChildren.has(e.source)) taskChildren.set(e.source, [])
      taskChildren.get(e.source)!.push(e.target)
      hasParent.add(e.target)
    }
  }

  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]))
  const positions: { x: number; y: number }[] = new Array(nodes.length).fill(null).map(() => ({ x: 0, y: 0 }))

  // DFS: собираем подерево в виде [{id, depth}] — как в сайдбаре сверху вниз
  function collectSubtree(id: string, depth: number): Array<{ id: string; depth: number }> {
    const result: Array<{ id: string; depth: number }> = [{ id, depth }]
    for (const kid of (hierChildren.get(id) ?? [])) {
      result.push(...collectSubtree(kid, depth + 1))
    }
    for (const task of (taskChildren.get(id) ?? [])) {
      result.push({ id: task, depth: depth + 1 })
    }
    return result
  }

  // Корни — страницы/папки без родителя
  const treeRoots = nodes.filter(
    (n) => !hasParent.has(n.id) && (n.type === 'folder' || n.type === 'page' || hierChildren.has(n.id))
  )
  // Плавающие — задачи/заметки без родителя
  const floating = nodes.filter(
    (n) => !hasParent.has(n.id) && n.type !== 'folder' && n.type !== 'page' && !hierChildren.has(n.id)
  )

  // Каждый корень — вертикальная колонка
  let colX = 0
  let maxRows = 0

  for (const root of treeRoots) {
    const items = collectSubtree(root.id, 0)
    if (items.length > maxRows) maxRows = items.length

    items.forEach((item, row) => {
      const idx = idToIdx.get(item.id)
      if (idx !== undefined) {
        positions[idx] = {
          x: colX + item.depth * INDENT,
          y: START_Y + row * V_STEP,
        }
      }
    })
    colX += COL_W
  }

  // Плавающие — строка под всеми колонками
  const bottomY = START_Y + maxRows * V_STEP
  const totalCols = treeRoots.length || 1
  const floatStep = COL_W
  floating.forEach((node, i) => {
    const idx = idToIdx.get(node.id)
    if (idx !== undefined) {
      positions[idx] = {
        x: (i % totalCols) * floatStep,
        y: bottomY + Math.floor(i / totalCols) * V_STEP,
      }
    }
  })

  return positions
}

// ─── Edge colors ──────────────────────────────────────────────────────────────

const EDGE_COLORS: Record<string, string> = {
  HIERARCHY: '#94a3b8',   // серый — структурная иерархия
  TASK:      '#6366f1',   // индиго — страница → задача
  REFERENCE: '#3b82f6',   // синий — явная ссылка (заметки)
  DEPENDS_ON: '#f59e0b',  // жёлтый — зависимость
  BLOCKS:    '#ef4444',   // красный — блокирует
  RELATED:   '#64748b',   // серый — связано
}

const LINK_TYPES = ['REFERENCE', 'RELATED', 'DEPENDS_ON', 'BLOCKS'] as const
type LinkType = typeof LINK_TYPES[number]

// ─── Position storage ─────────────────────────────────────────────────────────

function positionsKey(workspaceId: string, projectId?: string) {
  return `graph-positions-${workspaceId}${projectId ? `-${projectId}` : ''}`
}

function loadPositions(workspaceId: string, projectId?: string): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(positionsKey(workspaceId, projectId))
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function savePositions(workspaceId: string, projectId: string | undefined, positions: Record<string, { x: number; y: number }>) {
  try {
    localStorage.setItem(positionsKey(workspaceId, projectId), JSON.stringify(positions))
  } catch { /* quota exceeded */ }
}

// ─── Node type legend data ────────────────────────────────────────────────────

const NODE_LEGEND_DATA = [
  { type: 'folder', color: '#f59e0b', key: 'folders' as const, Icon: Folder      },
  { type: 'page',   color: '#3b82f6', key: 'pages'   as const, Icon: FileText    },
  { type: 'task',   color: '#6366f1', key: 'tasks'   as const, Icon: CheckSquare },
  { type: 'note',   color: '#f97316', key: 'notes'   as const, Icon: StickyNote  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export function GraphPage() {
  const { projectId } = useParams<{ projectId?: string }>()
  const { currentWorkspaceId } = useWorkspaceStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const t = useT()

  const [pendingConn, setPendingConn] = useState<{ source: string; target: string } | null>(null)
  const [linkType, setLinkType] = useState<LinkType>('REFERENCE')
  const [saving, setSaving] = useState(false)
  const [viewerFile, setViewerFile] = useState<Attachment | null>(null)

  const { data: graphData, isLoading } = useQuery({
    queryKey: ['graph', currentWorkspaceId, projectId],
    queryFn: () => graphApi.getGraph(currentWorkspaceId!, projectId),
    enabled: !!currentWorkspaceId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)

  const nodesRef = useRef(nodes)
  useEffect(() => { nodesRef.current = nodes }, [nodes])

  const makeNavigateHandler = useCallback((n: GraphNode): (() => void) | undefined => {
    if (n.type === 'page') return () => navigate(`/pages/${n.id}`)
    if (n.type === 'task' && n.projectId) return () => navigate(`/projects/${n.projectId}/tasks`)
    if (n.type === 'note') {
      const base = n.projectId ? `/projects/${n.projectId}/notes` : `/notes`
      return () => navigate(`${base}?noteId=${n.id}`)
    }
    if (n.type === 'attachment') {
      return () => {
        const file: Attachment = {
          id: n.id,
          workspaceId: '',
          projectId: n.projectId,
          filename: (n.data?.filename as string) || n.label,
          mimeType: (n.data?.mimeType as string) || '',
          size: (n.data?.size as number) || 0,
          storagePath: '',
          url: (n.data?.url as string) || '',
          isImportant: (n.data?.isImportant as boolean) || false,
          metadata: {},
          createdAt: '',
        }
        setViewerFile(file)
      }
    }
    return undefined
  }, [navigate, setViewerFile])

  useEffect(() => {
    if (!graphData || !currentWorkspaceId) return

    const savedPos = loadPositions(currentWorkspaceId, projectId)
    const autoPos  = layoutNodes(graphData.nodes, graphData.edges)

    const rfNodes: Node[] = graphData.nodes.map((n, i) => ({
      id: n.id,
      type: n.type === 'folder' ? 'folder' : n.type === 'task' ? 'task' : n.type === 'attachment' ? 'attachment' : n.type === 'note' ? 'note' : 'page',
      position: savedPos[n.id] ?? autoPos[i],
      data: {
        label: n.label,
        status: (n.data?.status as string) ?? undefined,
        priority: (n.data?.priority as string) ?? undefined,
        isImportant: (n.data?.isImportant as boolean) ?? false,
        onNavigate: makeNavigateHandler(n),
      },
    }))

    const rfEdges: Edge[] = graphData.edges.map((e) => {
      const color = EDGE_COLORS[e.linkType] ?? '#64748b'
      const isStructural = e.linkType === 'HIERARCHY' || e.linkType === 'TASK'
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        // Структурные рёбра без подписи, явные — с подписью
        label: isStructural ? undefined : e.linkType.toLowerCase().replace('_', ' '),
        labelStyle: { fill: '#64748b', fontSize: 10 },
        style: { stroke: color, strokeWidth: isStructural ? 1.5 : 1.5, opacity: isStructural ? 0.6 : 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
        animated: e.linkType === 'DEPENDS_ON' || e.linkType === 'BLOCKS',
      }
    })

    setNodes(rfNodes)
    setEdges(rfEdges)
    // fitView after ReactFlow processes new nodes
    setTimeout(() => rfInstanceRef.current?.fitView({ padding: 0.2 }), 50)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, currentWorkspaceId, projectId])

  const onNodeDragStop: NodeDragHandler = useCallback(
    () => {
      if (!currentWorkspaceId) return
      const positions: Record<string, { x: number; y: number }> = {}
      nodesRef.current.forEach((n) => { positions[n.id] = n.position })
      savePositions(currentWorkspaceId, projectId, positions)
    },
    [currentWorkspaceId, projectId],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      setPendingConn({ source: connection.source, target: connection.target })
      setLinkType('REFERENCE')
    },
    [],
  )

  async function handleConfirmLink() {
    if (!pendingConn || !currentWorkspaceId) return
    setSaving(true)
    try {
      await graphApi.createLink({
        workspaceId: currentWorkspaceId,
        sourceType: 'page',
        sourceId: pendingConn.source,
        targetType: 'page',
        targetId: pendingConn.target,
        linkType,
      })
      setEdges((eds) =>
        addEdge(
          {
            id: `tmp-${Date.now()}`,
            source: pendingConn.source,
            target: pendingConn.target,
            label: linkType.toLowerCase().replace('_', ' '),
            labelStyle: { fill: '#64748b', fontSize: 10 },
            style: { stroke: EDGE_COLORS[linkType], strokeWidth: 1.5 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: EDGE_COLORS[linkType],
              width: 12,
              height: 12,
            },
            animated: linkType === 'DEPENDS_ON' || linkType === 'BLOCKS',
          },
          eds,
        ),
      )
      qc.invalidateQueries({ queryKey: ['graph'] })
      setPendingConn(null)
    } finally {
      setSaving(false)
    }
  }

  const onEdgeClick = useCallback(
    async (_: React.MouseEvent, edge: Edge) => {
      if (!window.confirm(t.graph.deleteLinkConfirm)) return
      setEdges((eds) => eds.filter((e) => e.id !== edge.id))
      try {
        await graphApi.deleteLink(edge.id)
        qc.invalidateQueries({ queryKey: ['graph'] })
      } catch {
        qc.invalidateQueries({ queryKey: ['graph'] })
      }
    },
    [setEdges, qc],
  )

  if (!currentWorkspaceId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-500">{t.common.selectWorkspace}</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-primary-500" />
      </div>
    )
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header title={t.graph.title} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Network size={48} className="text-slate-700" />
          <p className="text-slate-400 text-lg">{t.graph.empty}</p>
          <p className="text-slate-600 text-sm max-w-xs text-center">
            {t.graph.emptyHint}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t.graph.title}
        actions={
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{graphData.nodes.length} {t.graph.nodes} · {graphData.edges.length} {t.graph.edges}</span>
            <span className="text-slate-600 hidden sm:inline">{t.graph.hint}</span>
            <button
              onClick={() => {
                if (!currentWorkspaceId) return
                localStorage.removeItem(positionsKey(currentWorkspaceId, projectId))
                qc.invalidateQueries({ queryKey: ['graph'] })
              }}
              className="flex items-center gap-1 text-slate-500 hover:text-slate-200 transition-colors"
              title={t.graph.resetLayout}
            >
              <LayoutGrid size={13} /> {t.graph.reset}
            </button>
          </div>
        }
      />

      {/* Legend bar */}
      <div className="flex items-center gap-5 px-4 py-2 border-b border-slate-800 bg-surface-950 flex-wrap">
        {/* Node type legend */}
        <div className="flex items-center gap-3">
          {NODE_LEGEND_DATA.map(({ color, key, Icon }) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded flex items-center justify-center" style={{ backgroundColor: color + '22', border: `1px solid ${color}55` }}>
                <Icon size={9} style={{ color }} />
              </div>
              <span className="text-xs text-slate-500">{t.graph[key]}</span>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-slate-800" />

        {/* Edge type legend */}
        {Object.entries(EDGE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-4 h-0.5" style={{ backgroundColor: color }} />
            <span className="text-xs text-slate-500">{type.toLowerCase().replace('_', ' ')}</span>
          </div>
        ))}
      </div>

      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onNodeDragStop={onNodeDragStop}
          onInit={(instance) => { rfInstanceRef.current = instance }}
          nodeTypes={NODE_TYPES}
          fitView={false}
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable
          proOptions={{ hideAttribution: true }}
          connectionLineStyle={{ stroke: '#6366f1', strokeWidth: 1.5 }}
          defaultEdgeOptions={{
            style: { stroke: '#6366f1', strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="#1e293b"
            gap={20}
            size={1}
          />
          <Controls
            className="[&>button]:bg-surface-900 [&>button]:border-slate-700 [&>button]:text-slate-400 [&>button:hover]:bg-slate-800"
          />
          <MiniMap
            nodeColor={(n) =>
              n.type === 'folder' ? '#f59e0b'
              : n.type === 'task' ? '#6366f1'
              : n.type === 'note' ? '#f97316'
              : '#3b82f6'
            }
            maskColor="rgba(2,6,23,0.7)"
            className="bg-surface-900 border border-slate-800 rounded-lg"
          />
        </ReactFlow>
      </div>

      {pendingConn && (
        <Modal open onClose={() => setPendingConn(null)} title={t.graph.linkType}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2">
              {LINK_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => setLinkType(type)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors text-left',
                    linkType === type
                      ? 'border-primary-500 bg-primary-500/10 text-slate-100'
                      : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300',
                  )}
                >
                  <div className="w-3 h-0.5 flex-shrink-0" style={{ backgroundColor: EDGE_COLORS[type] }} />
                  <p className="text-sm font-medium">{type.toLowerCase().replace('_', ' ')}</p>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-1 border-t border-slate-800">
              <button onClick={() => setPendingConn(null)} className="btn-ghost">{t.common.cancel}</button>
              <button onClick={handleConfirmLink} disabled={saving} className="btn-primary">
                {saving ? <Loader2 size={14} className="animate-spin" /> : t.graph.connect}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {viewerFile && (
        <FileViewer file={viewerFile} onClose={() => setViewerFile(null)} />
      )}
    </div>
  )
}
