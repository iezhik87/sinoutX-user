import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tag as TagIcon, X, Plus, Check } from 'lucide-react'
import { tagApi, type TaskTag } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useT } from '@/i18n'

const TAG_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#6366f1', '#a855f7', '#ec4899',
  '#64748b', '#84cc16',
]

interface TaskTagPickerProps {
  initialTags: TaskTag[]
  onChange: (tagIds: string[]) => void
}

export function TaskTagPicker({ initialTags, onChange }: TaskTagPickerProps) {
  const qc = useQueryClient()
  const t = useT()
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLORS[5])
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialTags.map((tt) => tt.tag.id))
  const ref = useRef<HTMLDivElement>(null)

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags', workspaceId],
    queryFn: () => tagApi.list(workspaceId!),
    enabled: !!workspaceId,
  })

  const createTag = useMutation({
    mutationFn: () => tagApi.create({ workspaceId: workspaceId!, name: search.trim(), color: newColor }),
    onSuccess: (tag) => {
      qc.invalidateQueries({ queryKey: ['tags', workspaceId] })
      const next = [...selectedIds, tag.id]
      setSelectedIds(next)
      onChange(next)
      setSearch('')
    },
  })

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggle(tagId: string) {
    const next = selectedIds.includes(tagId)
      ? selectedIds.filter((id) => id !== tagId)
      : [...selectedIds, tagId]
    setSelectedIds(next)
    onChange(next)
  }

  const selectedTags = allTags.filter((t) => selectedIds.includes(t.id))
  const filtered = allTags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
  const canCreate = search.trim() && !allTags.some((t) => t.name.toLowerCase() === search.trim().toLowerCase())

  return (
    <div ref={ref} className="relative">
      <label className="text-xs text-slate-500 mb-1.5 flex items-center gap-1">
        <TagIcon size={11} /> {t.tasks.tags}
      </label>

      <div
        className="flex flex-wrap gap-1.5 min-h-[32px] bg-surface-950 border border-slate-700 rounded-md px-2 py-1.5 cursor-text"
        onClick={() => setOpen(true)}
      >
        {selectedTags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: tag.color + '33', color: tag.color }}
          >
            {tag.name}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggle(tag.id) }}
              className="hover:opacity-70"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <span className="text-xs text-slate-600 flex items-center">
          <Plus size={11} />
        </span>
      </div>

      {open && (
        <div className="absolute z-50 top-full mt-1 w-full bg-surface-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-800">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.tasks.addTag}
              className="w-full bg-transparent text-sm text-slate-200 placeholder-slate-600 focus:outline-none"
            />
          </div>

          <div className="max-h-48 overflow-y-auto">
            {filtered.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(tag.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800 text-left"
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                <span className="flex-1 text-sm text-slate-200">{tag.name}</span>
                {selectedIds.includes(tag.id) && <Check size={12} className="text-primary-400" />}
              </button>
            ))}

            {canCreate && (
              <div className="p-2 border-t border-slate-800">
                <div className="flex items-center gap-2 mb-2">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ backgroundColor: c, outline: c === newColor ? `2px solid ${c}` : 'none', outlineOffset: '1px' }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => createTag.mutate()}
                  className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300"
                >
                  <Plus size={12} /> {t.tasks.newTag}: <span style={{ color: newColor }}>"{search.trim()}"</span>
                </button>
              </div>
            )}

            {filtered.length === 0 && !canCreate && (
              <p className="text-xs text-slate-600 px-3 py-2">—</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
