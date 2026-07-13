import { useRef, useEffect, useState, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { Pen, Eraser, Minus, Square, Circle, Trash2, Download, Undo2, Redo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

type Tool = 'pen' | 'eraser' | 'line' | 'rect' | 'circle' | 'move'

interface DrawPoint { x: number; y: number }
interface DrawAction {
  tool: Tool
  color: string
  size: number
  points: DrawPoint[]
}

const COLORS = [
  '#f1f5f9', '#94a3b8', '#6366f1', '#8b5cf6', '#ec4899',
  '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#0ea5e9',
]

const SIZES = [2, 4, 8, 16, 24]

export function DrawPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const t = useT()
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#f1f5f9')
  const [size, setSize] = useState(4)
  const [drawing, setDrawing] = useState(false)
  const [history, setHistory] = useState<DrawAction[]>([])
  const [future, setFuture] = useState<DrawAction[]>([])
  const currentAction = useRef<DrawAction | null>(null)
  const startPoint = useRef<DrawPoint | null>(null)
  const snapshotRef = useRef<ImageData | null>(null)

  const getCtx = () => canvasRef.current?.getContext('2d') ?? null

  // Init canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect()
      const snap = getCtx()?.getImageData(0, 0, canvas.width, canvas.height)
      canvas.width = rect.width
      canvas.height = rect.height
      if (snap) getCtx()?.putImageData(snap, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const redrawAll = useCallback((actions: DrawAction[]) => {
    const ctx = getCtx()
    const canvas = canvasRef.current
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    actions.forEach((action) => drawAction(ctx, action))
  }, [])

  function drawAction(ctx: CanvasRenderingContext2D, action: DrawAction) {
    ctx.strokeStyle = action.tool === 'eraser' ? '#020617' : action.color
    ctx.fillStyle = action.color
    ctx.lineWidth = action.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (action.tool === 'pen' || action.tool === 'eraser') {
      if (action.points.length < 2) return
      ctx.beginPath()
      ctx.moveTo(action.points[0].x, action.points[0].y)
      action.points.forEach((p) => ctx.lineTo(p.x, p.y))
      ctx.stroke()
    } else if (action.tool === 'line' && action.points.length === 2) {
      ctx.beginPath()
      ctx.moveTo(action.points[0].x, action.points[0].y)
      ctx.lineTo(action.points[1].x, action.points[1].y)
      ctx.stroke()
    } else if (action.tool === 'rect' && action.points.length === 2) {
      const [a, b] = action.points
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
    } else if (action.tool === 'circle' && action.points.length === 2) {
      const [a, b] = action.points
      const rx = Math.abs(b.x - a.x) / 2
      const ry = Math.abs(b.y - a.y) / 2
      const cx = a.x + (b.x - a.x) / 2
      const cy = a.y + (b.y - a.y) / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  function getPos(e: React.MouseEvent | React.TouchEvent): DrawPoint {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: t.clientX - rect.left, y: t.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  function onPointerDown(e: React.MouseEvent | React.TouchEvent) {
    const pos = getPos(e)
    setDrawing(true)
    setFuture([])
    startPoint.current = pos

    if (tool === 'pen' || tool === 'eraser') {
      currentAction.current = { tool, color, size: tool === 'eraser' ? size * 3 : size, points: [pos] }
    } else if (tool !== 'move') {
      currentAction.current = { tool, color, size, points: [pos, pos] }
      snapshotRef.current = getCtx()?.getImageData(0, 0, canvasRef.current!.width, canvasRef.current!.height) ?? null
    }
  }

  function onPointerMove(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing || !currentAction.current) return
    const pos = getPos(e)
    const ctx = getCtx()
    if (!ctx) return

    if (tool === 'pen' || tool === 'eraser') {
      currentAction.current.points.push(pos)
      // Draw incremental
      ctx.strokeStyle = tool === 'eraser' ? '#020617' : color
      ctx.lineWidth = tool === 'eraser' ? size * 3 : size
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const pts = currentAction.current.points
      if (pts.length >= 2) {
        ctx.beginPath()
        ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y)
        ctx.lineTo(pos.x, pos.y)
        ctx.stroke()
      }
    } else if (tool !== 'move') {
      // Restore snapshot, redraw shape preview
      if (snapshotRef.current) ctx.putImageData(snapshotRef.current, 0, 0)
      currentAction.current.points[1] = pos
      drawAction(ctx, currentAction.current)
    }
  }

  function onPointerUp() {
    if (!drawing || !currentAction.current) return
    setDrawing(false)
    const action = currentAction.current
    currentAction.current = null
    snapshotRef.current = null
    if (action.points.length >= 1) {
      setHistory((h) => [...h, action])
    }
  }

  function undo() {
    if (history.length === 0) return
    const last = history[history.length - 1]
    const newHistory = history.slice(0, -1)
    setHistory(newHistory)
    setFuture((f) => [last, ...f])
    redrawAll(newHistory)
  }

  function redo() {
    if (future.length === 0) return
    const next = future[0]
    const newHistory = [...history, next]
    setHistory(newHistory)
    setFuture((f) => f.slice(1))
    redrawAll(newHistory)
  }

  function clearCanvas() {
    if (!confirm(t.draw.clearConfirm)) return
    const ctx = getCtx()
    const canvas = canvasRef.current
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHistory([])
    setFuture([])
  }

  function downloadCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `drawing-${new Date().toISOString().slice(0, 10)}.png`
    link.href = canvas.toDataURL()
    link.click()
  }

  const tools: { id: Tool; icon: React.ReactNode; title: string }[] = [
    { id: 'pen', icon: <Pen size={15} />, title: t.draw.pencil },
    { id: 'eraser', icon: <Eraser size={15} />, title: t.draw.eraser },
    { id: 'line', icon: <Minus size={15} />, title: t.draw.line },
    { id: 'rect', icon: <Square size={15} />, title: t.draw.rect },
    { id: 'circle', icon: <Circle size={15} />, title: t.draw.oval },
  ]

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t.draw.title}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={undo} disabled={history.length === 0} className="btn-ghost p-1.5" title={t.draw.undo}>
              <Undo2 size={14} />
            </button>
            <button onClick={redo} disabled={future.length === 0} className="btn-ghost p-1.5" title={t.draw.redo}>
              <Redo2 size={14} />
            </button>
            <button onClick={clearCanvas} className="btn-ghost p-1.5" title={t.draw.clear}>
              <Trash2 size={14} />
            </button>
            <button onClick={downloadCanvas} className="btn-ghost text-xs" title={t.draw.downloadPng}>
              <Download size={14} /> PNG
            </button>
          </div>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Toolbar */}
        <div className="w-14 flex-shrink-0 border-r border-slate-800 bg-surface-900 flex flex-col items-center py-3 gap-2 overflow-y-auto">
          {/* Tools */}
          {tools.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={t.title}
              className={cn(
                'w-9 h-9 rounded-lg flex items-center justify-center transition-colors',
                tool === t.id
                  ? 'bg-primary-600 text-white'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800',
              )}
            >
              {t.icon}
            </button>
          ))}

          <div className="w-6 h-px bg-slate-800 my-1" />

          {/* Sizes */}
          {SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              title={`${t.draw.size} ${s}px`}
              className={cn(
                'w-9 h-9 rounded-lg flex items-center justify-center transition-colors',
                size === s ? 'bg-slate-700' : 'hover:bg-slate-800',
              )}
            >
              <div
                className="rounded-full"
                style={{
                  width: Math.min(s * 1.5, 24),
                  height: Math.min(s * 1.5, 24),
                  backgroundColor: color,
                }}
              />
            </button>
          ))}

          <div className="w-6 h-px bg-slate-800 my-1" />

          {/* Colors */}
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c}
              className={cn(
                'w-7 h-7 rounded-full transition-transform',
                color === c && 'ring-2 ring-primary-400 ring-offset-2 ring-offset-surface-900 scale-110',
              )}
              style={{ backgroundColor: c }}
            />
          ))}

          {/* Custom color */}
          <label className="w-7 h-7 rounded-full overflow-hidden cursor-pointer border border-slate-700" title={t.draw.color}>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-full h-full cursor-pointer border-0 p-0"
            />
          </label>
        </div>

        {/* Canvas area */}
        <div
          className="flex-1 relative overflow-hidden bg-surface-950"
          style={{ cursor: tool === 'eraser' ? 'cell' : tool === 'move' ? 'grab' : 'crosshair' }}
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onMouseLeave={onPointerUp}
            onTouchStart={onPointerDown}
            onTouchMove={onPointerMove}
            onTouchEnd={onPointerUp}
          />
        </div>
      </div>
    </div>
  )
}
