import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd'
import { Plus, Loader2, KanbanSquare, Trash2, X, Check } from 'lucide-react'
import { boardApi, taskApi, type BoardColumn, type Task } from '@/api/client'
import { Header } from '@/components/layout/Header'
import { TaskCard } from '@/components/tasks/TaskCard'
import { TaskEditModal } from '@/components/tasks/TaskEditModal'
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

export function BoardPage() {
  const { projectId, boardId: boardIdParam } = useParams<{ projectId: string; boardId?: string }>()
  const qc = useQueryClient()
  const t = useT()

  const { data: boards = [] } = useQuery({
    queryKey: ['boards', projectId],
    queryFn: () => boardApi.listByProject(projectId!),
    enabled: !!projectId,
  })

  const activeBoardId = boardIdParam ?? boards[0]?.id

  const { data: board, isLoading } = useQuery({
    queryKey: ['board', activeBoardId],
    queryFn: () => boardApi.getById(activeBoardId!),
    enabled: !!activeBoardId,
  })

  const [createInColumn, setCreateInColumn] = useState<BoardColumn | null>(null)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [showAddColumn, setShowAddColumn] = useState(false)
  const [newColumnName, setNewColumnName] = useState('')

  function invalidateBoard() {
    qc.invalidateQueries({ queryKey: ['board', activeBoardId] })
    qc.invalidateQueries({ queryKey: ['boards', projectId] })
  }

  const createBoard = useMutation({
    mutationFn: () => boardApi.create({
      projectId: projectId!,
      name: t.board.title,
      columns: [
        { id: `col-${Date.now()}-1`, name: t.tasks.statuses.TODO, color: '#64748b', position: 0 },
        { id: `col-${Date.now()}-2`, name: t.tasks.statuses.IN_PROGRESS, color: '#6366f1', position: 1 },
        { id: `col-${Date.now()}-3`, name: t.tasks.statuses.DONE, color: '#10b981', position: 2 },
      ],
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boards', projectId] }),
  })

  const addColumn = useMutation({
    mutationFn: () => {
      if (!board) return Promise.resolve(null)
      const newCol = {
        id: `col-${Date.now()}`,
        name: newColumnName.trim() || t.board.columnNamePlaceholder,
        color: '#6366f1',
        position: board.columns.length,
      }
      return boardApi.update(activeBoardId!, {
        columns: [...board.columns.map(({ tasks: _t, ...c }) => c), newCol],
      })
    },
    onSuccess: () => { invalidateBoard(); setShowAddColumn(false); setNewColumnName('') },
  })

  const deleteColumn = useMutation({
    mutationFn: async (columnId: string) => {
      if (!board) return
      const colTasks = board.columns.find((c) => c.id === columnId)?.tasks ?? []
      await Promise.all(colTasks.map((task) =>
        taskApi.update(task.id, { boardId: null, boardColumnId: null }),
      ))
      return boardApi.update(activeBoardId!, {
        columns: board.columns.filter((c) => c.id !== columnId).map(({ tasks: _t, ...c }) => c),
      })
    },
    onSuccess: invalidateBoard,
  })

  const moveTask = useMutation({
    mutationFn: ({ taskId, columnId, position }: { taskId: string; columnId: string; position: number }) =>
      taskApi.move(taskId, activeBoardId!, columnId, position),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board', activeBoardId] }),
  })

  const reorderColumn = useMutation({
    mutationFn: ({ columnId, taskIds }: { columnId: string; taskIds: string[] }) =>
      boardApi.reorderColumn(activeBoardId!, columnId, taskIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board', activeBoardId] }),
  })

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || !board) return
    const { draggableId: taskId, source, destination } = result
    const srcColId = source.droppableId
    const dstColId = destination.droppableId
    if (srcColId === dstColId && source.index === destination.index) return
    if (srcColId === dstColId) {
      const col = board.columns.find((c) => c.id === srcColId)
      if (!col?.tasks) return
      const ids = [...col.tasks.map((task) => task.id)]
      ids.splice(source.index, 1)
      ids.splice(destination.index, 0, taskId)
      reorderColumn.mutate({ columnId: srcColId, taskIds: ids })
    } else {
      moveTask.mutate({ taskId, columnId: dstColId, position: destination.index })
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 size={24} className="animate-spin text-primary-500" /></div>
  }

  if (!activeBoardId || boards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <KanbanSquare size={40} className="text-slate-700" />
        <p className="text-slate-400">{t.board.noBoards}</p>
        <button onClick={() => createBoard.mutate()} className="btn-primary" disabled={createBoard.isPending}>
          {createBoard.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t.board.createBoard}
        </button>
      </div>
    )
  }

  if (!board) return null

  return (
    <div className="flex flex-col h-full">
      <Header
        title={board.name}
        actions={
          <div className="flex items-center gap-2">
            {boards.length > 1 && (
              <select className="bg-surface-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none">
                {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <button onClick={() => { setNewColumnName(''); setShowAddColumn(true) }} className="btn-ghost text-xs">
              <Plus size={13} /> {t.board.newColumn}
            </button>
            <button onClick={() => createBoard.mutate()} className="btn-ghost text-xs">
              <Plus size={13} /> {t.board.newBoard}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3 h-full" style={{ minWidth: `${(board.columns.length + (showAddColumn ? 1 : 0)) * 288}px` }}>
            {board.columns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                onAddTask={() => setCreateInColumn(column)}
                onDeleteColumn={() => { if (confirm(`${t.board.deleteColumnConfirm} "${column.name}"?`)) deleteColumn.mutate(column.id) }}
                onTaskClick={(task) => setEditTask(task)}
              />
            ))}

            {/* Add column inline */}
            {showAddColumn && (
              <div className="flex flex-col w-[272px] flex-shrink-0 bg-surface-900 rounded-xl border border-primary-600/50 p-3 gap-2 h-fit">
                <input
                  autoFocus
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addColumn.mutate(); if (e.key === 'Escape') setShowAddColumn(false) }}
                  placeholder={t.board.columnNamePlaceholder}
                  className="bg-surface-950 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <div className="flex gap-2">
                  <button onClick={() => addColumn.mutate()} disabled={addColumn.isPending} className="btn-primary flex-1 text-xs">
                    {addColumn.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {t.board.addColumn}
                  </button>
                  <button onClick={() => setShowAddColumn(false)} className="btn-ghost p-1.5"><X size={13} /></button>
                </div>
              </div>
            )}
          </div>
        </DragDropContext>
      </div>

      {createInColumn && (
        <CreateTaskModal
          open={!!createInColumn}
          onClose={() => setCreateInColumn(null)}
          projectId={projectId!}
          boardId={activeBoardId}
          boardColumnId={createInColumn.id}
        />
      )}

      {editTask && (
        <TaskEditModal
          task={editTask}
          onClose={() => setEditTask(null)}
          onDeleted={() => setEditTask(null)}
        />
      )}
    </div>
  )
}

function KanbanColumn({
  column,
  onAddTask,
  onDeleteColumn,
  onTaskClick,
}: {
  column: BoardColumn
  onAddTask: () => void
  onDeleteColumn: () => void
  onTaskClick: (task: Task) => void
}) {
  const t = useT()
  const tasks = column.tasks ?? []

  return (
    <div className="flex flex-col w-[272px] flex-shrink-0 bg-surface-900 rounded-xl border border-slate-800">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: column.color ?? '#6366f1' }} />
          <span className="text-sm font-medium text-slate-200">{column.name}</span>
          <span className="text-xs text-slate-500 bg-slate-800 px-1.5 rounded-full">{tasks.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onAddTask} className="btn-ghost p-1" title={t.board.addTask}><Plus size={13} /></button>
          <button onClick={onDeleteColumn} className="btn-ghost p-1 text-slate-600 hover:text-red-400" title={t.board.deleteColumn}><Trash2 size={11} /></button>
        </div>
      </div>

      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn('flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px] transition-colors', snapshot.isDraggingOver && 'bg-primary-600/5')}
          >
            {tasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={cn('transition-shadow', snapshot.isDragging && 'shadow-2xl shadow-black/50 rotate-1')}
                  >
                    <TaskCard task={task} compact={false} onClick={() => onTaskClick(task)} />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
            {tasks.length === 0 && !snapshot.isDraggingOver && (
              <button
                onClick={onAddTask}
                className="w-full py-3 border border-dashed border-slate-800 rounded-lg text-xs text-slate-600 hover:text-slate-400 hover:border-slate-700 transition-colors"
              >
                + {t.board.addTask}
              </button>
            )}
          </div>
        )}
      </Droppable>
    </div>
  )
}
