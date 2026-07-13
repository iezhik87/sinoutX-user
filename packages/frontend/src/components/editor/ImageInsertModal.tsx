import { useState, useRef, useCallback } from 'react'
import { Upload, Link, Loader2, ImageIcon } from 'lucide-react'
import { uploadApi } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { Modal } from '@/components/common/Modal'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

type Tab = 'upload' | 'url'

export function ImageInsertModal({
  onInsert,
  onClose,
  projectId,
}: {
  onInsert: (url: string) => void
  onClose: () => void
  projectId?: string
}) {
  const t = useT()
  const [tab, setTab] = useState<Tab>('upload')
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { currentWorkspaceId } = useWorkspaceStore()

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError(t.editorTools.onlyImages)
      return
    }
    setError('')
    setPreview(URL.createObjectURL(file))
    setUploading(true)
    try {
      const wsId = currentWorkspaceId ?? ''
      const attachment = await uploadApi.upload(file, wsId, { projectId })
      onInsert(attachment.url)
      onClose()
    } catch {
      setError(t.editorTools.uploadError)
      setPreview(null)
    } finally {
      setUploading(false)
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [currentWorkspaceId, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleUrlInsert() {
    const trimmed = url.trim()
    if (!trimmed) return
    onInsert(trimmed)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={t.editorTools.insertImage} className="max-w-md">
      {/* Tabs */}
      <div className="-mx-5 -mt-5 mb-5 flex border-b border-slate-700">
        {([['upload', t.editorTools.tabUpload, Upload], ['url', t.editorTools.tabUrl, Link]] as [Tab, string, typeof Upload][]).map(([tabId, label, Icon]) => (
          <button
            key={tabId}
            onClick={() => { setTab(tabId); setError('') }}
            className={cn(
              'flex items-center justify-center gap-2 flex-1 py-2.5 text-sm font-medium transition-colors',
              tab === tabId
                ? 'text-primary-400 border-b-2 border-primary-500'
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
              'relative flex flex-col items-center justify-center gap-3 h-44 rounded-xl border-2 border-dashed cursor-pointer transition-colors',
              dragging
                ? 'border-primary-500 bg-primary-500/10'
                : 'border-slate-600 hover:border-slate-500',
              uploading && 'pointer-events-none',
            )}
          >
            {uploading ? (
              <>
                {preview && (
                  <img src={preview} alt="" className="absolute inset-0 w-full h-full object-contain rounded-xl opacity-30" />
                )}
                <div className="relative flex flex-col items-center gap-2">
                  <Loader2 size={24} className="animate-spin text-primary-400" />
                  <span className="text-xs text-slate-400">{t.editorTools.uploading}</span>
                </div>
              </>
            ) : preview ? (
              <img src={preview} alt="" className="w-full h-full object-contain rounded-xl" />
            ) : (
              <>
                <div className="w-11 h-11 rounded-xl bg-slate-700/50 flex items-center justify-center">
                  <ImageIcon size={20} className="text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-300">
                    {t.editorTools.dropOr}{' '}
                    <span className="text-primary-400 underline-offset-2 underline">{t.editorTools.chooseFile}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">PNG, JPG, GIF, WebP, SVG</p>
                </div>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">{t.editorTools.imageUrl}</label>
            <input
              autoFocus
              type="text"
              placeholder="https://example.com/image.png"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUrlInsert()}
              className="nb-input w-full"
            />
          </div>

          {url.trim() && (
            <div className="rounded-lg overflow-hidden border border-slate-700 h-36 flex items-center justify-center bg-slate-800/40">
              <img
                src={url}
                alt=""
                className="max-h-full max-w-full object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }}
              />
            </div>
          )}

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
