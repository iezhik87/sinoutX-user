import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { useRef, useEffect, useState } from 'react'
import { Pencil, Eraser, Trash2, Download, Minus, Plus, Type, Minus as Line, Square, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

type Tool = 'pen' | 'eraser' | 'line' | 'rect' | 'circle' | 'text'

const canvasCache = new Map<string, string>()

function DrawingCanvas({
  node,
  updateAttributes,
  deleteNode,
}: {
  node: { attrs: { data: string; height: number; blockId: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  deleteNode: () => void
  selected: boolean
}) {
  const mainRef = useRef<HTMLCanvasElement>(null)   // committed drawing
  const overlayRef = useRef<HTMLCanvasElement>(null) // shape preview
  const containerRef = useRef<HTMLDivElement>(null)

  const isDrawing = useRef(false)
  const startPos = useRef<{ x: number; y: number } | null>(null)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  const t = useT()
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#1e293b')
  const [size, setSize] = useState(3)

  // Text input state
  const [textInput, setTextInput] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false })
  const [textValue, setTextValue] = useState('')
  const textInputRef = useRef<HTMLInputElement>(null)

  const blockId = node.attrs.blockId
  const height = node.attrs.height ?? 240
  const fontSize = Math.max(14, size * 4)

  useEffect(() => {
    const canvas = mainRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const src = canvasCache.get(blockId) ?? node.attrs.data
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (src) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0)
      img.src = src
    }
    // clear overlay
    const overlay = overlayRef.current
    if (overlay) overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId])

  function save() {
    const canvas = mainRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    canvasCache.set(blockId, dataUrl)
    updateAttributes({ data: dataUrl })
  }

  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = mainRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }

  // ── Draw preview of shape on overlay canvas ──────────────────────────────────
  function drawOverlay(start: { x: number; y: number }, end: { x: number; y: number }) {
    const overlay = overlayRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    ctx.strokeStyle = color
    ctx.lineWidth = size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (tool === 'line') {
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
    } else if (tool === 'rect') {
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y)
    } else if (tool === 'circle') {
      const rx = (end.x - start.x) / 2
      const ry = (end.y - start.y) / 2
      ctx.beginPath()
      ctx.ellipse(start.x + rx, start.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // ── Commit shape from overlay to main canvas ──────────────────────────────────
  function commitShape(start: { x: number; y: number }, end: { x: number; y: number }) {
    const canvas = mainRef.current
    const overlay = overlayRef.current
    if (!canvas || !overlay) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Draw overlay content onto main
    ctx.drawImage(overlay, 0, 0)
    overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height)
    void start; void end
    save()
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    if (tool === 'text') return
    e.preventDefault()
    e.stopPropagation()
    const pos = getPos(e)
    isDrawing.current = true
    startPos.current = pos
    lastPos.current = pos

    if (tool === 'pen' || tool === 'eraser') {
      const ctx = mainRef.current?.getContext('2d')
      if (!ctx) return
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, size / 2, 0, Math.PI * 2)
      ctx.fillStyle = tool === 'eraser' ? '#ffffff' : color
      ctx.fill()
    }
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!isDrawing.current || !lastPos.current || !startPos.current) return
    const pos = getPos(e)

    if (tool === 'pen' || tool === 'eraser') {
      const ctx = mainRef.current?.getContext('2d')
      if (!ctx) return
      ctx.beginPath()
      ctx.moveTo(lastPos.current.x, lastPos.current.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color
      ctx.lineWidth = size
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
      lastPos.current = pos
    } else {
      drawOverlay(startPos.current, pos)
    }
  }

  function endDraw(e?: React.MouseEvent | React.TouchEvent) {
    e?.stopPropagation()
    if (!isDrawing.current) return
    isDrawing.current = false
    const end = lastPos.current ?? startPos.current!

    if (tool === 'pen' || tool === 'eraser') {
      save()
    } else if (startPos.current) {
      commitShape(startPos.current, end)
    }
    startPos.current = null
    lastPos.current = null
  }

  function handleCanvasClick(e: React.MouseEvent) {
    if (tool !== 'text') return
    e.stopPropagation()
    // Position text input in screen coords (inside container)
    const container = containerRef.current!
    const cRect = container.getBoundingClientRect()
    setTextInput({ x: e.clientX - cRect.left, y: e.clientY - cRect.top, visible: true })
    setTextValue('')
    setTimeout(() => textInputRef.current?.focus(), 0)
  }

  function commitText() {
    if (!textValue.trim()) { setTextInput((s) => ({ ...s, visible: false })); return }
    const canvas = mainRef.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Convert screen coords back to canvas coords
    const rect = canvas.getBoundingClientRect()
    const container = containerRef.current!
    const cRect = container.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const cx = (textInput.x + cRect.left - rect.left) * scaleX
    const cy = (textInput.y + cRect.top - rect.top) * scaleY
    ctx.font = `${fontSize}px sans-serif`
    ctx.fillStyle = color
    ctx.fillText(textValue, cx, cy + fontSize)
    setTextInput((s) => ({ ...s, visible: false }))
    setTextValue('')
    save()
  }

  function clearCanvas() {
    const canvas = mainRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    overlayRef.current?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    canvasCache.delete(blockId)
    updateAttributes({ data: '' })
  }

  function downloadPng() {
    const canvas = mainRef.current
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = 'drawing.png'
    a.click()
  }

  const COLORS = ['#1e293b', '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#8b5cf6']

  const TOOLS: { id: Tool; icon: React.ReactNode; title: string }[] = [
    { id: 'pen',    icon: <Pencil size={13} />, title: t.editorTools.pen },
    { id: 'eraser', icon: <Eraser size={13} />, title: t.editorTools.eraser },
    { id: 'line',   icon: <Line size={13} />,   title: t.editorTools.lineTool },
    { id: 'rect',   icon: <Square size={13} />, title: t.editorTools.rect },
    { id: 'circle', icon: <Circle size={13} />, title: t.editorTools.ellipse },
    { id: 'text',   icon: <Type size={13} />,   title: t.editorTools.textTool },
  ]

  const cursor = tool === 'eraser' ? 'cell' : tool === 'text' ? 'text' : 'crosshair'

  return (
    <NodeViewWrapper className="my-3 group/drawing" contentEditable={false}>
      <div className="rounded-xl overflow-hidden border border-slate-700 hover:border-slate-600 transition-colors">

        {/* Toolbar — appears on hover */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-900 border-b border-slate-800 flex-wrap
                        max-h-0 overflow-hidden opacity-0
                        group-hover/drawing:max-h-12 group-hover/drawing:opacity-100
                        transition-all duration-150">
          {/* Tools */}
          {TOOLS.map(({ id, icon, title }) => (
            <button
              key={id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTool(id)}
              className={cn('p-1.5 rounded-md transition-colors', tool === id ? 'bg-primary-600 text-white' : 'text-slate-400 hover:bg-slate-800')}
              title={title}
            >
              {icon}
            </button>
          ))}

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          {/* Colors */}
          {COLORS.map((c) => (
            <button
              key={c}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setColor(c); if (tool === 'eraser') setTool('pen') }}
              className={cn('w-4 h-4 rounded-full border-2 transition-transform hover:scale-110',
                color === c ? 'border-white scale-110' : 'border-transparent')}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => { setColor(e.target.value); if (tool === 'eraser') setTool('pen') }}
            className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
            title={t.editorTools.customColor}
          />

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          {/* Size */}
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => setSize((s) => Math.max(1, s - 1))} className="p-1 text-slate-400 hover:text-slate-200"><Minus size={11} /></button>
          <span className="text-xs text-slate-400 w-4 text-center">{size}</span>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => setSize((s) => Math.min(40, s + 1))} className="p-1 text-slate-400 hover:text-slate-200"><Plus size={11} /></button>

          <div className="flex-1" />

          <button onMouseDown={(e) => e.preventDefault()} onClick={downloadPng} className="p-1.5 text-slate-500 hover:text-slate-200 transition-colors" title={t.editorTools.download}><Download size={13} /></button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={clearCanvas} className="p-1.5 text-slate-500 hover:text-red-400 transition-colors" title={t.editorTools.clearCanvas}><Trash2 size={13} /></button>
          <div className="w-px h-4 bg-slate-700 mx-0.5" />
          <button onMouseDown={(e) => e.preventDefault()} onClick={deleteNode} className="p-1.5 text-slate-500 hover:text-red-400 transition-colors text-xs font-medium" title={t.embed.deleteBlock}>✕</button>
        </div>

        {/* Canvas stack */}
        <div ref={containerRef} style={{ position: 'relative', height: `${height}px` }}>
          {/* Main canvas */}
          <canvas
            ref={mainRef}
            width={800}
            height={height}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', cursor, touchAction: 'none' }}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={() => endDraw()}
            onClick={handleCanvasClick}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={() => endDraw()}
          />
          {/* Overlay canvas for shape preview (pointer-events:none so events go to main) */}
          <canvas
            ref={overlayRef}
            width={800}
            height={height}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
          />
          {/* Floating text input */}
          {textInput.visible && (
            <input
              ref={textInputRef}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextInput((s) => ({ ...s, visible: false })) }}
              onBlur={commitText}
              style={{
                position: 'absolute',
                left: textInput.x,
                top: textInput.y,
                background: 'transparent',
                border: 'none',
                borderBottom: `1px dashed ${color}`,
                outline: 'none',
                color,
                fontSize: `${fontSize}px`,
                fontFamily: 'sans-serif',
                minWidth: 80,
              }}
            />
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export const DrawingBlockExtension = Node.create({
  name: 'drawingBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      data:    { default: '' },
      height:  { default: 240 },
      blockId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-block-id'),
        renderHTML: (attrs) => ({ 'data-block-id': attrs.blockId }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="drawing-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'drawing-block' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawingCanvas as unknown as Parameters<typeof ReactNodeViewRenderer>[0])
  },

  addCommands() {
    return {
      insertDrawingBlock:
        () =>
        (props: { commands: { insertContent: (c: Record<string, unknown>) => boolean } }) =>
          props.commands.insertContent({
            type: this.name,
            attrs: {
              data: '',
              height: 240,
              blockId: `drawing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            },
          }),
    } as Record<string, unknown>
  },
})
