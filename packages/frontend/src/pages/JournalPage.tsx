import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { ChevronLeft, ChevronRight, Trash2, BookOpen } from 'lucide-react'
import { journalApi, type JournalMeta } from '@/api/client'
import { Header } from '@/components/layout/Header'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'
import { cn } from '@/lib/utils'

function formatDate(dateStr: string, locale = 'ru'): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(
    locale === 'ru' ? 'ru-RU' : locale === 'be' ? 'be-BY' : 'en-US',
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
  )
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function calendarDays(ym: string): (string | null)[] {
  const [y, m] = ym.split('-').map(Number)
  const firstDay = new Date(y, m - 1, 1).getDay() // 0=Sun
  const offset = (firstDay + 6) % 7 // Mon-based
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = Array(offset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${ym}-${String(d).padStart(2, '0')}`)
  }
  return cells
}

export function JournalPage({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT()
  const { language } = useLanguageStore()
  const qc = useQueryClient()
  const today = isoDate(new Date())
  const [selectedDate, setSelectedDate] = useState(today)
  const [currentMonth, setCurrentMonth] = useState(today.slice(0, 7))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Month entries (for calendar dots)
  const { data: monthEntries = [] } = useQuery({
    queryKey: ['journal-month', currentMonth],
    queryFn: () => journalApi.list(currentMonth),
  })
  const entryDates = new Set(monthEntries.map((e: JournalMeta) => e.date))
  const moodByDate = Object.fromEntries(monthEntries.map((e: JournalMeta) => [e.date, e.mood]))

  // Current entry
  const { data: entry } = useQuery({
    queryKey: ['journal-entry', selectedDate],
    queryFn: () => journalApi.get(selectedDate).catch(() => null),
  })

  const [mood, setMood] = useState<string | null>(null)
  useEffect(() => { setMood(entry?.mood ?? null) }, [entry?.mood])

  const saveMut = useMutation({
    mutationFn: (content: Record<string, unknown>) => journalApi.save(selectedDate, content, mood),
    onSuccess: () => {
      setSaveStatus('saved')
      qc.invalidateQueries({ queryKey: ['journal-month', currentMonth] })
      qc.invalidateQueries({ queryKey: ['journal-entry', selectedDate] })
      setTimeout(() => setSaveStatus('idle'), 2000)
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => journalApi.delete(selectedDate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-month', currentMonth] })
      qc.invalidateQueries({ queryKey: ['journal-entry', selectedDate] })
    },
  })

  const handleSave = useCallback((json: Record<string, unknown>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(() => saveMut.mutate(json), 1500)
  }, [saveMut]) // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: t.journal.placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: entry?.content ?? { type: 'doc', content: [] },
    onUpdate: ({ editor }) => handleSave(editor.getJSON() as Record<string, unknown>),
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[300px] px-1',
      },
    },
  })

  // Reload editor content when date changes
  useEffect(() => {
    if (editor && entry !== undefined) {
      const content = entry?.content ?? { type: 'doc', content: [] }
      const current = editor.getJSON()
      if (JSON.stringify(current) !== JSON.stringify(content)) {
        editor.commands.setContent(content as any, false)
      }
    }
  }, [entry, selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  const days = calendarDays(currentMonth)
  const [y, m] = currentMonth.split('-').map(Number)
  const uiLocale = language === 'ru' ? 'ru-RU' : language === 'be' ? 'be-BY' : 'en-US'
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString(uiLocale, { month: 'long', year: 'numeric' })

  return (
    <div className="flex flex-col h-full">
      {!embedded && (
        <Header
          title={t.journal.title}
          actions={
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <BookOpen size={13} />
              {monthEntries.length} {t.journal.entryCount}
            </div>
          }
        />
      )}

      <div className="flex-1 overflow-hidden flex">
        {/* Sidebar: calendar */}
        <div className="w-64 flex-shrink-0 border-r border-slate-800 overflow-y-auto p-3">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setCurrentMonth(prevMonth(currentMonth))} className="p-1 rounded text-slate-500 hover:text-slate-300">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-medium text-slate-300 capitalize">{monthLabel}</span>
            <button onClick={() => setCurrentMonth(nextMonth(currentMonth))} className="p-1 rounded text-slate-500 hover:text-slate-300">
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-1">
            {t.habits.weekDays.map((d) => (
              <div key={d} className="text-[9px] text-slate-600 text-center py-0.5">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day, i) => {
              if (!day) return <div key={i} />
              const isToday = day === today
              const isSelected = day === selectedDate
              const hasEntry = entryDates.has(day)
              const dayMood = moodByDate[day]
              return (
                <button
                  key={day}
                  onClick={() => { setSelectedDate(day); if (day.slice(0, 7) !== currentMonth) setCurrentMonth(day.slice(0, 7)) }}
                  className={cn(
                    'relative aspect-square rounded-lg text-[11px] flex flex-col items-center justify-center transition-colors',
                    isSelected ? 'bg-primary-600 text-white' : isToday ? 'border border-primary-500 text-primary-400' : 'text-slate-400 hover:bg-surface-700',
                  )}
                >
                  {dayMood && hasEntry ? <span className="text-[9px] leading-none">{dayMood}</span> : null}
                  <span className="leading-none">{day.slice(8)}</span>
                  {hasEntry && !dayMood && (
                    <div className={cn('w-1 h-1 rounded-full mt-0.5', isSelected ? 'bg-white' : 'bg-primary-400')} />
                  )}
                </button>
              )
            })}
          </div>

          {/* Quick jump to today */}
          {selectedDate !== today && (
            <button
              onClick={() => { setSelectedDate(today); setCurrentMonth(today.slice(0, 7)) }}
              className="w-full mt-3 text-xs text-primary-400 hover:text-primary-300 py-1"
            >
              {t.journal.today}
            </button>
          )}
        </div>

        {/* Editor area */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Date header */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800">
            <div>
              <p className="text-sm font-semibold text-slate-100 capitalize">{formatDate(selectedDate, language)}</p>
              <p className="text-xs text-slate-500 mt-0.5">{saveStatus === 'saving' ? t.journal.saving : saveStatus === 'saved' ? t.journal.save : ''}</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Mood picker */}
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500 mr-1">{t.journal.mood}:</span>
                {t.journal.moods.map((emoji, i) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      const next = mood === emoji ? null : emoji
                      setMood(next)
                      if (editor) saveMut.mutate(editor.getJSON() as Record<string, unknown>)
                    }}
                    title={t.journal.moodLabels[i]}
                    className={cn('text-base transition-transform hover:scale-125', mood === emoji ? 'scale-125' : 'opacity-50 hover:opacity-100')}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              {/* Delete */}
              {entryDates.has(selectedDate) && (
                <button
                  onClick={() => { if (window.confirm(t.journal.deleteConfirm)) deleteMut.mutate() }}
                  className="text-slate-600 hover:text-red-400 transition-colors"
                  title={t.journal.delete}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {/* TipTap editor */}
          <div className="flex-1 px-6 py-4 max-w-3xl w-full mx-auto">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  )
}
