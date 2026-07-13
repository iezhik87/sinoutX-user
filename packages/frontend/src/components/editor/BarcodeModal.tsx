import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import JsBarcode from 'jsbarcode'
import { Modal } from '@/components/common/Modal'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

type Tab = 'qr' | 'barcode'

const BARCODE_FORMATS = [
  { value: 'CODE128', label: 'Code 128' },
  { value: 'CODE39', label: 'Code 39' },
  { value: 'EAN13', label: 'EAN-13' },
  { value: 'EAN8', label: 'EAN-8' },
  { value: 'UPC', label: 'UPC-A' },
  { value: 'ITF14', label: 'ITF-14' },
  { value: 'MSI', label: 'MSI' },
  { value: 'pharmacode', label: 'Pharmacode' },
]

export function BarcodeModal({
  initialTab = 'qr',
  onInsert,
  onClose,
}: {
  initialTab?: Tab
  onInsert: (svgDataUrl: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [tab, setTab]       = useState<Tab>(initialTab)
  const [text, setText]     = useState('')
  const [format, setFormat] = useState('CODE128')
  const [qrSvg, setQrSvg]  = useState<string>('')
  const [bcError, setBcError] = useState(false)
  const barcodeSvgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (tab !== 'qr' || !text.trim()) { setQrSvg(''); return }
    QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then(svg => setQrSvg(svg))
      .catch(() => setQrSvg(''))
  }, [text, tab])

  useEffect(() => {
    if (tab !== 'barcode' || !barcodeSvgRef.current || !text.trim()) {
      setBcError(false)
      return
    }
    try {
      JsBarcode(barcodeSvgRef.current as unknown as HTMLElement, text, {
        format,
        displayValue: true,
        background: '#ffffff',
        lineColor: '#000000',
        margin: 10,
        fontSize: 14,
      })
      setBcError(false)
    } catch {
      setBcError(true)
    }
  }, [text, format, tab])

  function toBase64Svg(svg: string): string {
    const bytes = new TextEncoder().encode(svg)
    let binary = ''
    bytes.forEach(b => { binary += String.fromCharCode(b) })
    return `data:image/svg+xml;base64,${btoa(binary)}`
  }

  function getSvgDataUrl(): string {
    if (tab === 'qr') return toBase64Svg(qrSvg)
    return toBase64Svg(barcodeSvgRef.current?.outerHTML ?? '')
  }

  const canInsert = tab === 'qr'
    ? !!qrSvg
    : !!text.trim() && !bcError

  return (
    <Modal open onClose={onClose} title={t.editorTools.insertBarcode} className="max-w-md">
      {/* Tabs */}
      <div className="-mx-5 -mt-5 mb-5 flex border-b border-slate-700">
        {([['qr', t.editorTools.qrCodeTab], ['barcode', t.editorTools.barcodeTab]] as [Tab, string][]).map(([tabId, label]) => (
          <button
            key={tabId}
            onClick={() => { setTab(tabId); setText(''); setBcError(false) }}
            className={cn(
              'flex-1 py-2.5 text-sm font-medium transition-colors',
              tab === tabId
                ? 'text-teal-400 border-b-2 border-teal-500'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {tab === 'barcode' && (
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">{t.editorTools.format}</label>
            <select
              value={format}
              onChange={e => setFormat(e.target.value)}
              className="nb-input w-full"
            >
              {BARCODE_FORMATS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">
            {tab === 'qr' ? t.editorTools.qrTextOrUrl : t.editorTools.barcodeData}
          </label>
          <input
            autoFocus
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={tab === 'qr' ? 'https://example.com' : '123456789'}
            className="nb-input w-full"
          />
        </div>

        {/* Preview */}
        <div className="flex justify-center min-h-[120px] items-center rounded-xl bg-white p-3">
          {tab === 'qr' ? (
            qrSvg
              ? <div dangerouslySetInnerHTML={{ __html: qrSvg }} style={{ width: 120, height: 120 }} />
              : <span className="text-xs text-slate-400">{t.editorTools.enterTextPreview}</span>
          ) : (
            <>
              <svg ref={barcodeSvgRef} style={{ display: text.trim() && !bcError ? 'block' : 'none' }} />
              {(!text.trim() || bcError) && (
                <span className="text-xs text-slate-400">
                  {bcError ? t.editorTools.invalidData : t.editorTools.enterDataPreview}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">{t.common.cancel}</button>
          <button
            onClick={() => { onInsert(getSvgDataUrl()); onClose() }}
            disabled={!canInsert}
            className="btn-primary"
          >
            {t.editorTools.insert}
          </button>
        </div>
      </div>
    </Modal>
  )
}
