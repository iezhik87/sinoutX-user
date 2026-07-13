import { useState, useRef, useCallback } from 'react'
import { Upload, Link, Loader2, Music } from 'lucide-react'
import { uploadApi } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { Modal } from '@/components/common/Modal'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

type Tab = 'upload' | 'url'

const ACCEPTED = '.mp3,.wav,.ogg,.flac,.aac,.m4a,.webm,.opus'
const ACCEPTED_TYPES = ['audio/']

export function AiAudioModal({
  onInsert,
  onClose,
}: {
  onInsert: (url: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [tab, setTab]           = useState<Tab>('upload')
  const [url, setUrl]           = useState('')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError]       = useState('')
  const fileInputRef            = useRef<HTMLInputElement>(null)
  const { currentWorkspaceId }  = useWorkspaceStore()

  async function handleFile(file: File) {
    if (!ACCEPTED_TYPES.some(t => file.type.startsWith(t))) {
      setError(t.editorTools.audioFormats)
      return
    }
    setError('')
    setFileName(file.name)
    setUploading(true)
    try {
      const attachment = await uploadApi.upload(file, currentWorkspaceId ?? '')
      onInsert(attachment.url)
      onClose()
    } catch {
      setError(t.editorTools.uploadError)
      setFileName(null)
    } finally {
      setUploading(false)
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [currentWorkspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleUrlInsert() {
    const trimmed = url.trim()
    if (!trimmed) return
    onInsert(trimmed)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={t.editorTools.insertAudio} className="max-w-md">
      {/* Tabs */}
      <div className="-mx-5 -mt-5 mb-5 flex border-b border-slate-700">
        {([['upload', t.editorTools.tabUploadFile, Upload], ['url', t.editorTools.tabUrl, Link]] as [Tab, string, typeof Upload][]).map(([tabId, label, Icon]) => (
          <button
            key={tabId}
            onClick={() => { setTab(tabId); setError('') }}
            className={cn(
              'flex items-center justify-center gap-2 flex-1 py-2.5 text-sm font-medium transition-colors',
              tab === tabId
                ? 'text-teal-400 border-b-2 border-teal-500'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'upload' ? (
        <div className="space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={cn(
              'relative flex flex-col items-center justify-center gap-3 h-40 rounded-xl border-2 border-dashed cursor-pointer transition-colors',
              dragging  ? 'border-teal-500 bg-teal-500/10' : 'border-slate-600 hover:border-slate-500',
              uploading && 'pointer-events-none',
            )}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 size={24} className="animate-spin text-teal-400" />
                <span className="text-xs text-slate-400">{t.editorTools.uploading} {fileName}</span>
              </div>
            ) : (
              <>
                <div className="w-11 h-11 rounded-xl bg-slate-700/50 flex items-center justify-center">
                  <Music size={20} className="text-teal-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-300">
                    {t.editorTools.dropOr}{' '}
                    <span className="text-teal-400 underline underline-offset-2">{t.editorTools.chooseFile}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">MP3, WAV, OGG, FLAC, AAC, M4A</p>
                </div>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">{t.editorTools.audioUrl}</label>
            <input
              autoFocus
              type="text"
              placeholder="https://example.com/audio.mp3"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUrlInsert()}
              className="nb-input w-full"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
            <button
              onClick={handleUrlInsert}
              disabled={!url.trim()}
              className="btn-primary"
            >
              {t.editorTools.insert}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
