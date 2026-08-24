import { createCanvas } from '@napi-rs/canvas'

export interface RasterImage {
  base64: string
  mime: string
}

/** Renders PDF pages to PNG images, for feeding scanned (no text layer) PDFs to a vision model. */
export async function pdfPagesToImages(buffer: Buffer, maxPages = 20): Promise<RasterImage[]> {
  // pdfjs-dist ships ESM-only — a static import would be compiled to require() under
  // this package's CommonJS output and crash with ERR_REQUIRE_ESM, so load it dynamically.
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise

  const n = Math.min(doc.numPages, maxPages)
  const images: RasterImage[] = []
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx as any, viewport }).promise
    images.push({ base64: canvas.toBuffer('image/png').toString('base64'), mime: 'image/png' })
  }
  return images
}
