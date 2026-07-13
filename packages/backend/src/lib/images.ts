// ─── Image downscaling on ingest ──────────────────────────────────────────────
// A phone photo of a receipt is 4-6 MB; the readable copy of it is ~300 KB. We
// store the copy, not the original — 200 MB of free quota is ~40 photos raw and
// ~600 downscaled, and the difference decides whether the free tier is usable.
//
// ORDER MATTERS: recognition (OCR/vision) must run on the ORIGINAL buffer, in
// memory, BEFORE this is called. Then the full resolution is never a trade-off:
// the model sees every pixel, the disk keeps a copy a human can still read.
import sharp from 'sharp'

/** Long edge, in pixels. A receipt stays legible; a scan of dense A4 wants more. */
export const MAX_SIDE_PHOTO = 2000
export const MAX_SIDE_SCAN = 2400

const QUALITY = 82
/** Below this a re-encode saves nothing worth the CPU. */
const SKIP_BELOW_BYTES = 300 * 1024

// Vector (svg) has no pixels to drop; gif may be animated and sharp would
// flatten it to the first frame — a silent data loss, so both are left alone.
const RESIZABLE = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/heic', 'image/heif', 'image/tiff', 'image/avif',
])

export const isResizableImage = (mime: string | undefined): boolean =>
  !!mime && RESIZABLE.has(mime.toLowerCase())

export interface StorableImage {
  buffer: Buffer
  mime: string
  filename: string
}

const withExt = (filename: string, ext: string): string => {
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  return `${stem}.${ext}`
}

/**
 * Shrink a photo to a copy that is still readable by a human.
 *
 * Returns `null` when the original should be stored untouched — callers treat
 * that as "nothing to do" rather than as an error. That happens when the file
 * is not a raster image, is already small, or when the re-encode came out
 * bigger than what we started with (screenshots of text do this).
 */
export async function toStorableImage(
  buffer: Buffer,
  mime: string | undefined,
  filename: string,
  maxSide: number = MAX_SIDE_PHOTO,
): Promise<StorableImage | null> {
  if (!isResizableImage(mime)) return null

  try {
    // `rotate()` with no argument applies the EXIF orientation and then drops it,
    // so a portrait photo does not come back on its side once EXIF is stripped.
    const pipeline = sharp(buffer, { failOn: 'none' }).rotate()
    const meta = await pipeline.metadata()
    if (!meta.width || !meta.height) return null
    if (meta.pages && meta.pages > 1) return null // animated webp/heif

    const longest = Math.max(meta.width, meta.height)
    if (longest <= maxSide && buffer.byteLength <= SKIP_BELOW_BYTES) return null

    const resized = pipeline.resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })

    // JPEG has no alpha: flattening a transparent PNG would paint the background
    // white. Keep such images in PNG and only take the resize.
    const out = meta.hasAlpha
      ? { buf: await resized.png({ compressionLevel: 9 }).toBuffer(), mime: 'image/png', ext: 'png' }
      : { buf: await resized.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer(), mime: 'image/jpeg', ext: 'jpg' }

    if (out.buf.byteLength >= buffer.byteLength) return null // never grow a file

    return { buffer: out.buf, mime: out.mime, filename: withExt(filename, out.ext) }
  } catch {
    // A corrupt or exotic image is stored as it came in. Losing the upload would
    // be a worse failure than losing the compression.
    return null
  }
}
