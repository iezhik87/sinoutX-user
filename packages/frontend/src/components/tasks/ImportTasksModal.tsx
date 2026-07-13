import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { taskApi } from '@/api/client'
import { Modal } from '@/components/common/Modal'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

interface Props {
  projectId: string
  onClose: () => void
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []

  // Detect delimiter (comma or semicolon or tab)
  const firstLine = lines[0]
  const delim = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ','

  const parseLine = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === delim && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseLine(lines[0]).map((h) => h.replace(/^["']|["']$/g, ''))
  return lines.slice(1).map((line) => {
    const vals = parseLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  }).filter((r) => Object.values(r).some((v) => v))
}

export function ImportTasksModal({ projectId, onClose }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Record<string, string>[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')

  const importMutation = useMutation({
    mutationFn: () => taskApi.importCsv(projectId, rows!),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['tasks', projectId] })
      setRows(null)
      setFileName('')
      setTimeout(() => onClose(), 1200)
      setError('')
      // Show result inline
      setFileName(`✓ ${t.import.imported}: ${data.imported}`)
    },
    onError: () => setError(t.import.error),
  })

  const handleFile = (file: File) => {
    setError('')
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)
      if (parsed.length === 0) { setError(t.import.emptyFile); return }
      setRows(parsed)
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const headers = rows ? Object.keys(rows[0]) : []
  const IMPORTANT_COLS = ['title', 'name', 'task', 'status', 'priority', 'due', 'assignee']

  return (
    <Modal open={true} title={t.import.title} onClose={onClose}>
      <div className="space-y-4">
        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
            rows ? 'border-green-700 bg-green-950/20' : 'border-slate-700 hover:border-slate-500 bg-surface-900',
          )}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
          {rows ? (
            <div className="flex flex-col items-center gap-1">
              <CheckCircle2 size={24} className="text-green-500" />
              <p className="text-sm text-green-400">{fileName}</p>
              <p className="text-xs text-slate-500">{rows.length} {t.import.rows}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={24} className="text-slate-500" />
              <p className="text-sm text-slate-300">{t.import.dropHint}</p>
              <p className="text-xs text-slate-600">{t.import.formatHint}</p>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs bg-red-950/30 border border-red-900 rounded-lg px-3 py-2">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {/* Preview */}
        {rows && rows.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-2">{t.import.preview}</p>
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-surface-900">
                    {headers.map((h) => (
                      <th
                        key={h}
                        className={cn(
                          'px-3 py-1.5 text-left font-medium',
                          IMPORTANT_COLS.some((c) => h.toLowerCase().includes(c))
                            ? 'text-primary-400'
                            : 'text-slate-500',
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-slate-800/50">
                      {headers.map((h) => (
                        <td key={h} className="px-3 py-1.5 text-slate-400 max-w-[150px] truncate">
                          {row[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 5 && (
              <p className="text-xs text-slate-600 mt-1 text-right">+ {rows.length - 5} {t.import.more}</p>
            )}
          </div>
        )}

        {/* Notion hint */}
        <div className="flex items-start gap-2 text-xs text-slate-600 bg-surface-900 rounded-lg px-3 py-2">
          <FileText size={12} className="mt-0.5 flex-shrink-0" />
          <span>{t.import.notionHint}</span>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
          <button
            onClick={() => importMutation.mutate()}
            disabled={!rows || importMutation.isPending || importMutation.isSuccess}
            className="btn-primary"
          >
            {importMutation.isPending
              ? <><Loader2 size={14} className="animate-spin" /> {t.import.importing}</>
              : importMutation.isSuccess
              ? <><CheckCircle2 size={14} /> {fileName}</>
              : <><Upload size={14} /> {t.import.import} {rows ? `(${rows.length})` : ''}</>}
          </button>
        </div>
      </div>
    </Modal>
  )
}
