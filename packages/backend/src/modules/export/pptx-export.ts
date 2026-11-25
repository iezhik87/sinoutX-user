import PptxGenJS from 'pptxgenjs'

import { fetchImageBuffer } from './docx-export.js'

export interface SlideSpec {
  title: string
  /** Пункты списка слайда */
  bullets?: string[]
  /** Сплошной текст (если пунктов нет) */
  text?: string
  /** Ссылка на картинку: из проекта или из generate_image */
  imageUrl?: string
  /** Заметки докладчика */
  notes?: string
}

export interface PresentationSpec {
  title: string
  subtitle?: string
  slides: SlideSpec[]
}

const COLORS = { bg: 'FFFFFF', title: '1F2937', text: '374151', accent: '7C6AF7' }

/** Собирает .pptx в стандартном оформлении: титульный слайд + слайды с текстом и картинкой. */
export async function buildPresentationBuffer(spec: PresentationSpec): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE' // 13.33 x 7.5 дюймов
  pptx.title = spec.title

  const cover = pptx.addSlide()
  cover.background = { color: COLORS.accent }
  cover.addText(spec.title, {
    x: 0.8, y: 2.4, w: 11.7, h: 1.6,
    fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Calibri', valign: 'middle',
  })
  if (spec.subtitle) {
    cover.addText(spec.subtitle, {
      x: 0.8, y: 4.1, w: 11.7, h: 1,
      fontSize: 22, color: 'EDE9FE', fontFace: 'Calibri', valign: 'top',
    })
  }

  for (const s of spec.slides) {
    const slide = pptx.addSlide()
    slide.background = { color: COLORS.bg }
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: COLORS.accent } })
    slide.addText(s.title, {
      x: 0.7, y: 0.4, w: 12, h: 1,
      fontSize: 30, bold: true, color: COLORS.title, fontFace: 'Calibri', valign: 'middle',
    })

    const img = s.imageUrl ? await fetchImageBuffer(s.imageUrl) : null
    const textW = img ? 6.6 : 12
    const bullets = (s.bullets ?? []).filter((b) => b.trim())
    const textOpts = { x: 0.7, y: 1.6, w: textW, h: 5.2, fontSize: 20, color: COLORS.text, fontFace: 'Calibri', valign: 'top' as const }
    if (bullets.length) {
      slide.addText(bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), { ...textOpts, paraSpaceAfter: 8 })
    } else if (s.text?.trim()) {
      slide.addText(s.text, textOpts)
    }
    if (img) {
      slide.addImage({
        data: `image/png;base64,${img.toString('base64')}`,
        x: 7.6, y: 1.6, w: 5.1, h: 5.2,
        sizing: { type: 'contain', w: 5.1, h: 5.2 },
      })
    }
    if (s.notes) slide.addNotes(s.notes)
  }

  const out = await pptx.write({ outputType: 'nodebuffer' })
  return out as Buffer
}
