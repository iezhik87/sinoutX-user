/* eslint-disable @typescript-eslint/no-var-requires */
import type { PrismaClient } from '@prisma/client'

// Reuse pdfmake the same way as the page exporter (Roboto vfs supports Cyrillic).
const pdfMakeLib = require('pdfmake/build/pdfmake') as { createPdf: (def: unknown) => { getBuffer: (cb: (data: Uint8Array) => void) => void }; vfs: unknown }
const vfsFonts = require('pdfmake/build/vfs_fonts') as { pdfMake?: { vfs: unknown }; vfs?: unknown }
pdfMakeLib.vfs = (vfsFonts.pdfMake ?? vfsFonts).vfs

interface Field { key: string; type: string; label?: Record<string, string>; unit?: string | Record<string, string>; options?: { value: string; label: Record<string, string> }[]; relation?: { collection: string } }
const pick = (m: Record<string, string> | undefined | null, lang: string) => (m ? (m[lang] ?? m.ru ?? m.en ?? Object.values(m)[0] ?? '') : '')
const pickUnit = (u: Field['unit'], lang: string) => (typeof u === 'string' ? u : pick(u, lang))

// Build a printable PDF of a whole module-project: every collection as a table.
export async function buildModulePdf(prisma: PrismaClient, projectId: string, lang = 'ru'): Promise<Buffer> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } })
  const collections = await prisma.collection.findMany({ where: { projectId }, orderBy: { position: 'asc' }, include: { views: true } })

  // Labels for relation rendering: collectionKey → (recordId → label).
  const recordsByCol = new Map<string, { id: string; data: Record<string, unknown> }[]>()
  for (const c of collections) {
    const recs = await prisma.collectionRecord.findMany({ where: { collectionId: c.id }, orderBy: { createdAt: 'asc' }, take: 500 })
    recordsByCol.set(c.key, recs.map((r) => ({ id: r.id, data: (r.data as Record<string, unknown>) ?? {} })))
  }
  const labelOf = (key: string, fields: Field[], rec: { data: Record<string, unknown> }) => {
    const tf = fields.find((f) => (f.type === 'text' || f.type === 'longtext') && rec.data[f.key])
    return tf ? String(rec.data[tf.key]) : (Object.values(rec.data).find((v) => v != null && v !== '') ?? '').toString()
  }

  const fmt = (f: Field, v: unknown, colFields: Field[]): string => {
    if (v == null || v === '') return '—'
    switch (f.type) {
      case 'checkbox': return v ? '✓' : '—'
      case 'select': return pick(f.options?.find((o) => o.value === v)?.label, lang) || String(v)
      case 'multiselect': return (Array.isArray(v) ? v : [v]).map((x) => pick(f.options?.find((o) => o.value === x)?.label, lang) || String(x)).join(', ')
      case 'relation': {
        const target = f.relation && collections.find((c) => c.key === f.relation!.collection)
        if (!target) return String(v)
        const recs = recordsByCol.get(target.key) ?? []
        const r = recs.find((x) => x.id === v)
        return r ? labelOf('', (target.fields as unknown as Field[]), r) : String(v)
      }
      case 'file': return (v as { filename?: string })?.filename ?? 'файл'
      case 'number': { const u = pickUnit(f.unit, lang); return u ? `${v} ${u}` : String(v) }
      default: return String(v)
    }
  }

  const content: unknown[] = [{ text: project?.name ?? 'Карта', style: 'title' }, { text: new Date().toLocaleString(lang === 'en' ? 'en' : lang === 'be' ? 'be' : 'ru'), style: 'sub', margin: [0, 0, 0, 12] }]

  for (const c of collections) {
    const fields = (c.fields as unknown as Field[]) ?? []
    const recs = recordsByCol.get(c.key) ?? []
    content.push({ text: pick(c.name as Record<string, string>, lang), style: 'h2', margin: [0, 10, 0, 4] })
    if (recs.length === 0) { content.push({ text: '—', style: 'sub' }); continue }
    const tableView = c.views.find((v) => v.type === 'table')
    const cols = ((tableView?.config as { columns?: string[] })?.columns) ?? fields.filter((f) => f.type !== 'longtext').map((f) => f.key)
    const colFields = cols.map((k) => fields.find((f) => f.key === k)).filter((f): f is Field => !!f)
    const header = colFields.map((f) => ({ text: pick(f.label, lang), bold: true, fontSize: 9 }))
    const body = recs.map((r) => colFields.map((f) => ({ text: fmt(f, r.data[f.key], colFields), fontSize: 9 })))
    content.push({ table: { headerRows: 1, widths: colFields.map(() => '*'), body: [header, ...body] }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 6] })
  }

  const docDefinition = {
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    styles: { title: { fontSize: 18, bold: true }, h2: { fontSize: 13, bold: true, color: '#7C3AED' }, sub: { fontSize: 9, color: '#888' } },
    pageMargins: [32, 32, 32, 32],
  }
  return new Promise((resolve) => pdfMakeLib.createPdf(docDefinition).getBuffer((data) => resolve(Buffer.from(data))))
}

// ─── Medical Record: curated clinical summary («Выписка») ────────────────────
const SUMMARY_T = {
  ru: { title: 'Выписка из медкарты', generated: 'Сформировано', period: 'период', patient: 'Пациент', dob: 'Дата рождения', age: 'возраст', sex: 'Пол', blood: 'Группа крови', height: 'Рост', weight: 'Вес', allergies: 'Аллергии', conditions: 'Активные диагнозы', meds: 'Принимаемые лекарства', studies: 'Последние обследования', analyses: 'Последние анализы', visits: 'Последние приёмы', diagnosis: 'Диагноз', medication: 'Препарат', status: 'Статус', since: 'С какого времени', icd: 'МКБ', doctor: 'Врач', dose: 'Доза', schedule: 'Схема', start: 'Начало', date: 'Дата', type: 'Тип', area: 'Область', conclusion: 'Заключение', indicator: 'Показатель', value: 'Значение', norm: 'Норма', none: 'нет данных', yShort: 'г', mShort: 'мес' },
  en: { title: 'Medical Record Summary', generated: 'Generated', period: 'period', patient: 'Patient', dob: 'Date of birth', age: 'age', sex: 'Sex', blood: 'Blood type', height: 'Height', weight: 'Weight', allergies: 'Allergies', conditions: 'Active diagnoses', meds: 'Current medications', studies: 'Recent studies', analyses: 'Recent lab results', visits: 'Recent visits', diagnosis: 'Diagnosis', medication: 'Medication', status: 'Status', since: 'Since', icd: 'ICD', doctor: 'Doctor', dose: 'Dose', schedule: 'Schedule', start: 'Since', date: 'Date', type: 'Type', area: 'Area', conclusion: 'Conclusion', indicator: 'Indicator', value: 'Value', norm: 'Reference', none: 'no data', yShort: 'y', mShort: 'm' },
  be: { title: 'Выпіска з медкарты', generated: 'Сфармавана', period: 'перыяд', patient: 'Пацыент', dob: 'Дата нараджэння', age: 'узрост', sex: 'Пол', blood: 'Група крыві', height: 'Рост', weight: 'Вага', allergies: 'Алергіі', conditions: 'Актыўныя дыягназы', meds: 'Прымаемыя лекі', studies: 'Апошнія даследаванні', analyses: 'Апошнія аналізы', visits: 'Апошнія прыёмы', diagnosis: 'Дыягназ', medication: 'Прэпарат', status: 'Статус', since: 'З якога часу', icd: 'МКХ', doctor: 'Урач', dose: 'Доза', schedule: 'Схема', start: 'Пачатак', date: 'Дата', type: 'Тып', area: 'Вобласць', conclusion: 'Заключэнне', indicator: 'Паказчык', value: 'Значэнне', norm: 'Норма', none: 'няма даных', yShort: 'г', mShort: 'мес' },
} as const

export async function buildMedcardSummaryPdf(prisma: PrismaClient, projectId: string, lang = 'ru', periodMonths = 12): Promise<Buffer> {
  const T = SUMMARY_T[(lang in SUMMARY_T ? lang : 'ru') as keyof typeof SUMMARY_T]
  const collections = await prisma.collection.findMany({ where: { projectId }, select: { id: true, key: true, fields: true } })
  const byKey = (k: string) => collections.find((c) => c.key === k)
  const fieldsOf = (k: string) => ((byKey(k)?.fields as unknown as Field[]) ?? [])
  const recs = async (k: string): Promise<Record<string, unknown>[]> => {
    const c = byKey(k); if (!c) return []
    const r = await prisma.collectionRecord.findMany({ where: { collectionId: c.id } })
    return r.map((x) => ({ id: x.id, ...((x.data as Record<string, unknown>) ?? {}) }))
  }
  const opt = (k: string, fieldKey: string, v: unknown) => {
    const f = fieldsOf(k).find((ff) => ff.key === fieldKey)
    return pick(f?.options?.find((o) => o.value === v)?.label, lang) || (v != null ? String(v) : '')
  }
  const d10 = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '')
  const since = (v: unknown): string => {
    const s = d10(v); if (!s) return ''
    const from = new Date(s); const now = new Date()
    let mo = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth())
    if (mo < 0) mo = 0
    const y = Math.floor(mo / 12), m = mo % 12
    const dur = [y ? `${y} ${T.yShort}` : '', m ? `${m} ${T.mShort}` : ''].filter(Boolean).join(' ')
    return dur ? `${s} (${dur})` : s
  }
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - periodMonths)
  const within = (v: unknown) => { const s = d10(v); return s ? new Date(s) >= cutoff : true }
  const desc = (a: Record<string, unknown>, b: Record<string, unknown>, key: string) => String(b[key] ?? '').localeCompare(String(a[key] ?? ''))

  const [profileArr, conditions, meds, studies, analyses, indicators, visits] = await Promise.all([
    recs('profile'), recs('conditions'), recs('medications'), recs('studies'), recs('analyses'), recs('indicators'), recs('visits'),
  ])
  const p = profileArr[0] ?? {}

  const content: unknown[] = [
    { text: T.title, style: 'title' },
    { text: `${T.generated}: ${new Date().toLocaleDateString(lang === 'en' ? 'en' : lang === 'be' ? 'be' : 'ru')} · ${T.period}: ${periodMonths} ${T.mShort}`, style: 'sub', margin: [0, 0, 0, 12] },
  ]
  const section = (title: string) => content.push({ text: title, style: 'h2', margin: [0, 12, 0, 4] })
  const table = (header: string[], body: string[][]) => {
    if (body.length === 0) { content.push({ text: T.none, style: 'sub' }); return }
    content.push({
      table: { headerRows: 1, widths: header.map(() => '*'), body: [header.map((h) => ({ text: h, bold: true, fontSize: 9 })), ...body.map((row) => row.map((c) => ({ text: c, fontSize: 9 })))] },
      layout: 'lightHorizontalLines', margin: [0, 0, 0, 4],
    })
  }

  // Patient
  section(T.patient)
  const age = (() => { const s = d10(p.birthDate); if (!s) return ''; return String(Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / (365.25 * 864e5)))) })()
  const pLines = [
    p.fullName ? `${String(p.fullName)}` : '',
    p.birthDate ? `${T.dob}: ${d10(p.birthDate)}${age ? ` (${T.age} ${age})` : ''}` : '',
    p.sex ? `${T.sex}: ${opt('profile', 'sex', p.sex)}` : '',
    p.bloodType ? `${T.blood}: ${opt('profile', 'bloodType', p.bloodType)}` : '',
    p.height ? `${T.height}: ${p.height}` : '', p.weight ? `${T.weight}: ${p.weight}` : '',
    p.allergies ? `${T.allergies}: ${String(p.allergies)}` : '',
  ].filter(Boolean)
  content.push({ text: pLines.length ? pLines.join('  ·  ') : T.none, fontSize: 10, margin: [0, 0, 0, 2] })

  // Active diagnoses
  section(T.conditions)
  const activeCond = conditions.filter((c) => ['active', 'chronic', 'remission'].includes(String(c.status ?? 'active'))).sort((a, b) => desc(a, b, 'onset'))
  table([T.diagnosis, T.status, T.since, T.icd, T.doctor],
    activeCond.map((c) => [String(c.name ?? ''), opt('conditions', 'status', c.status), since(c.onset), String(c.icd ?? ''), String(c.doctor ?? '')]))

  // Current medications
  section(T.meds)
  const activeMeds = meds.filter((m) => !m.status || m.status === 'active')
  table([T.medication, T.dose, T.schedule, T.start, T.doctor],
    activeMeds.map((m) => [String(m.name ?? ''), String(m.dose ?? ''), String(m.schedule ?? ''), d10(m.since), String(m.doctor ?? '')]))

  // Recent studies
  section(T.studies)
  const recentStudies = studies.filter((s) => within(s.date)).sort((a, b) => desc(a, b, 'date')).slice(0, 12)
  table([T.date, T.type, T.area, T.conclusion, T.doctor],
    recentStudies.map((s) => [d10(s.date), opt('studies', 'type', s.type), String(s.area ?? ''), String(s.conclusion ?? '').slice(0, 140), String(s.doctor ?? '')]))

  // Recent lab results (latest 2 analyses within period, with indicators)
  section(T.analyses)
  const recentAnalyses = analyses.filter((a) => within(a.date)).sort((a, b) => desc(a, b, 'date')).slice(0, 2)
  if (recentAnalyses.length === 0) content.push({ text: T.none, style: 'sub' })
  for (const a of recentAnalyses) {
    content.push({ text: `${d10(a.date)} · ${opt('analyses', 'panel', a.panel)}${a.lab ? ` · ${String(a.lab)}` : ''}`, bold: true, fontSize: 9, margin: [0, 4, 0, 2] })
    const inds = indicators.filter((i) => i.analysis === a.id)
    table([T.indicator, T.value, T.norm], inds.map((i) => {
      const val = Number(i.value), lo = i.refLow == null ? null : Number(i.refLow), hi = i.refHigh == null ? null : Number(i.refHigh)
      const flag = lo != null && val < lo ? ' ↓' : hi != null && val > hi ? ' ↑' : ''
      const norm = lo != null || hi != null ? `${lo ?? ''}–${hi ?? ''}` : ''
      return [String(i.name ?? ''), `${i.value ?? ''} ${i.unit ?? ''}${flag}`, norm]
    }))
  }

  // Recent visits
  section(T.visits)
  const recentVisits = visits.filter((v) => within(v.date)).sort((a, b) => desc(a, b, 'date')).slice(0, 8)
  table([T.date, T.doctor, T.diagnosis], recentVisits.map((v) => [d10(v.date), String(v.doctor ?? ''), String(v.diagnosis ?? '')]))

  const docDefinition = {
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    styles: { title: { fontSize: 18, bold: true }, h2: { fontSize: 13, bold: true, color: '#7C3AED' }, sub: { fontSize: 9, color: '#888' } },
    pageMargins: [32, 36, 32, 36],
  }
  return new Promise((resolve) => pdfMakeLib.createPdf(docDefinition).getBuffer((data) => resolve(Buffer.from(data))))
}
