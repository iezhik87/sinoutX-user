import type { PrismaClient, Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import pdfParse from 'pdf-parse'
import { runExtraction, parseJsonLoose, type OcrConfig } from './vision.js'
import { uploadFile } from '../storage.js'
import { toStorableImage, MAX_SIDE_SCAN } from '../images.js'

const asJson = (v: unknown) => v as Prisma.InputJsonValue
const VALID_PANELS = ['cbc', 'biochem', 'hormones', 'other']
const STUDY_TYPES = ['usg', 'mri', 'ct', 'xray', 'ecg', 'endo', 'other']
const DOC_TYPES = ['certificate', 'extract', 'report', 'referral', 'other']

function scanPrompt(profile: { sex?: string; age?: number | null }): string {
  const who = [profile.sex ? `sex: ${profile.sex}` : '', (profile.age ?? null) !== null ? `age: ${profile.age}` : ''].filter(Boolean).join(', ')
  return `You are a medical document parser. The document may be in Russian, English or Belarusian.
First CLASSIFY it, then extract. ${who ? `Patient (${who}) — use for choosing sex/age reference ranges.` : ''}
Return ONLY valid JSON, no prose:
{
  "kind": "lab" | "imaging" | "encounter" | "document",

  // ALWAYS, for ANY kind: established diagnoses set in this document.
  // Include ONLY confirmed / final diagnoses that are clearly stated.
  // EXCLUDE anything tentative: "под вопросом", "?", differential diagnoses,
  // "susp.", "rule out", "to exclude", "предварительный" — leave those out.
  "confirmedDiagnoses": [ { "name": "diagnosis as stated", "icd": "ICD-10 code or empty" } ],

  // when kind = "lab" (blood/urine/biochemistry test with numeric indicators):
  "date": "YYYY-MM-DD or null",
  "lab": "lab name or empty",
  "groups": [ { "panel": "cbc|biochem|hormones|other",
    "indicators": [ { "name": "as printed", "canonical": "standard English name", "value": number,
      "unit": "standard notation", "refLow": number-or-null, "refHigh": number-or-null, "refEst": false } ] } ],

  // when kind = "imaging" (ultrasound/MRI/CT/X-ray/ECG/endoscopy report):
  "study": { "date": "YYYY-MM-DD or null", "studyType": "usg|mri|ct|xray|ecg|endo|other",
    "area": "organ/region, e.g. почки / брюшная полость", "doctor": "", "conclusion": "the full readable findings/conclusion text" },

  // when kind = "encounter" (a doctor's visit/examination/consultation — осмотр, приём, консультация, заключение специалиста):
  "encounter": { "date": "YYYY-MM-DD or null", "doctor": "specialty or doctor name",
    "complaints": "chief complaints, or empty", "recommendations": "plan / recommendations text, or empty",
    "medications": [ { "name": "drug name", "dose": "e.g. 50 mg", "schedule": "e.g. 2x/day 10 days" } ] },

  // when kind = "document" (certificate, discharge, referral, misc — справка, выписка, направление):
  "document": { "date": "YYYY-MM-DD or null", "title": "short title", "docType": "certificate|extract|report|referral|other",
    "recommendations": "free-text recommendations / plan from the document, or empty",
    "medications": [ { "name": "drug name", "dose": "e.g. 50 mg", "schedule": "e.g. 2x/day 10 days" } ] }
}
Rules: choose exactly ONE kind and fill only that section, BUT always fill "confirmedDiagnoses" when the document states a final diagnosis (regardless of kind). A doctor's examination/consultation with complaints, findings and a plan is "encounter", not "document". For "imaging" copy the readable findings verbatim into "conclusion". For "lab": numbers as numbers, take reference ranges from the report (if missing you may give a typical sex/age range and set refEst=true), keep units verbatim (only SI-prefix normalisation, no cross-unit conversion). For "encounter" and "document" extract prescribed medications and the recommendations text if present. Output JSON only.`
}

interface Indicator { name?: string; canonical?: string; value?: number; unit?: string; refLow?: number | null; refHigh?: number | null; refEst?: boolean }
interface Med { name?: string; dose?: string; schedule?: string }
type Diagnosis = { name?: string; icd?: string } | string
interface ScanResult {
  kind?: string
  confirmedDiagnoses?: Diagnosis[]
  date?: string | null; lab?: string; panel?: string; indicators?: Indicator[]
  groups?: { panel?: string; indicators?: Indicator[] }[]
  study?: { date?: string | null; studyType?: string; area?: string; doctor?: string; conclusion?: string }
  encounter?: { date?: string | null; doctor?: string; complaints?: string; recommendations?: string; medications?: Med[] }
  document?: { date?: string | null; title?: string; docType?: string; recommendations?: string; medications?: Med[] }
}

export interface ScanSummary { kind: 'lab' | 'imaging' | 'encounter' | 'document' | 'none'; indicators: number; analyses: number; medications?: number; diagnoses?: number; collectionKey?: string }

async function pdfText(buffer: Buffer): Promise<string> {
  try { return (await pdfParse(buffer)).text ?? '' } catch { return '' }
}

const today = () => new Date().toISOString().slice(0, 10)
const safeDate = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today())

// Archive the document and return a {id,filename} reference. Recognition already
// ran on the full-resolution buffer, so what lands on disk is a downscaled copy
// the user can still read — the original is not kept.
async function archiveFile(prisma: PrismaClient, workspaceId: string, projectId: string, file: { buffer: Buffer; mime: string; filename: string }): Promise<{ id: string; filename: string }> {
  const small = await toStorableImage(file.buffer, file.mime, file.filename, MAX_SIDE_SCAN)
  const stored = small ?? file
  const ext = (stored.filename.split('.').pop() || 'bin').toLowerCase()
  const key = `${workspaceId}/${randomUUID()}.${ext}`
  await uploadFile(key, stored.buffer, stored.mime, stored.buffer.byteLength)
  const att = await prisma.attachment.create({
    data: { workspaceId, projectId, filename: stored.filename, mimeType: stored.mime, size: stored.buffer.byteLength, storagePath: key, metadata: { source: 'medical-scan' } },
  })
  return { id: att.id, filename: att.filename }
}

async function addDocument(prisma: PrismaClient, colId: string, data: { date: string; title: string; type: string; file?: { id: string; filename: string } }, userId: string | null) {
  await prisma.collectionRecord.create({ data: { collectionId: colId, createdBy: userId, data: asJson(data) } })
}

// Distribute prescribed medications into the Medications collection.
async function addMedications(prisma: PrismaClient, medsCol: { id: string } | undefined, meds: Med[] | undefined, date: string, sourceNote: string, userId: string | null): Promise<number> {
  if (!medsCol || !Array.isArray(meds)) return 0
  let n = 0
  for (const m of meds) {
    if (!m?.name) continue
    await prisma.collectionRecord.create({ data: { collectionId: medsCol.id, createdBy: userId, data: asJson({ name: m.name, dose: m.dose ?? '', schedule: m.schedule ?? '', since: date, status: 'active', notes: sourceNote }) } })
    n++
  }
  return n
}

// Add ESTABLISHED diagnoses to the problem list (Состояния). De-duplicates by
// name (case-insensitive) against existing records so re-scanning is idempotent.
async function addConditions(prisma: PrismaClient, condCol: { id: string } | undefined, diagnoses: Diagnosis[] | undefined, date: string, doctor: string | undefined, userId: string | null): Promise<number> {
  if (!condCol || !Array.isArray(diagnoses) || diagnoses.length === 0) return 0
  const existing = await prisma.collectionRecord.findMany({ where: { collectionId: condCol.id }, select: { data: true } })
  const seen = new Set(existing.map((r) => String((r.data as Record<string, unknown>)?.name ?? '').trim().toLowerCase()).filter(Boolean))
  let n = 0
  for (const dg of diagnoses) {
    const name = (typeof dg === 'string' ? dg : dg?.name)?.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const icd = typeof dg === 'object' && dg ? (dg.icd ?? '') : ''
    await prisma.collectionRecord.create({ data: { collectionId: condCol.id, createdBy: userId, data: asJson({ name, status: 'active', onset: date, icd, doctor: doctor ?? '', notes: '' }) } })
    n++
  }
  return n
}

// First-party pipeline: recognise ANY medical document (photo/PDF, scan or
// digital) and route it — lab → analyses+indicators, imaging → studies, other →
// documents. The original file always lands in the Documents archive.
export async function runMedicalScan(
  prisma: PrismaClient, workspaceId: string, projectId: string, ocr: OcrConfig,
  file: { buffer: Buffer; mime: string; filename: string }, userId: string | null,
): Promise<ScanSummary> {
  const cols = await prisma.collection.findMany({ where: { projectId }, select: { id: true, key: true } })
  const col = (k: string) => cols.find((c) => c.key === k)

  // Patient context (sex/age) for reference ranges.
  const profile: { sex?: string; age?: number | null } = {}
  const profileCol = col('profile')
  if (profileCol) {
    const p = await prisma.collectionRecord.findFirst({ where: { collectionId: profileCol.id }, orderBy: { createdAt: 'asc' } })
    const d = (p?.data as Record<string, unknown>) ?? {}
    if (typeof d.sex === 'string') profile.sex = d.sex
    if (typeof d.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.birthDate)) {
      profile.age = Math.max(0, Math.floor((Date.now() - new Date(d.birthDate).getTime()) / (365.25 * 24 * 3600_000)))
    }
  }

  // Digital PDF → text (cheap, any model); otherwise the image/scan.
  const prompt = scanPrompt(profile)
  let raw: string
  if (file.mime === 'application/pdf') {
    const text = await pdfText(file.buffer)
    raw = text.trim().length >= 40
      ? await runExtraction(ocr, { text }, prompt)
      : await runExtraction(ocr, { images: [{ base64: file.buffer.toString('base64'), mime: file.mime }] }, prompt)
  } else {
    raw = await runExtraction(ocr, { images: [{ base64: file.buffer.toString('base64'), mime: file.mime }] }, prompt)
  }
  const parsed = parseJsonLoose(raw) as ScanResult
  const docCol = col('documents')

  // ── Lab ──────────────────────────────────────────────────────────────────
  const hasLab = parsed.kind === 'lab' || (!parsed.kind && (parsed.groups?.length || parsed.indicators?.length))
  if (hasLab && col('analyses')) {
    const date = safeDate(parsed.date)
    const lab = parsed.lab ?? ''
    const groups = (parsed.groups?.length ? parsed.groups : [{ panel: parsed.panel, indicators: parsed.indicators }])
      .map((g) => ({
        panel: VALID_PANELS.includes(g.panel ?? '') ? g.panel! : 'other',
        indicators: (g.indicators ?? []).filter((i) => i?.name && typeof i.value === 'number' && Number.isFinite(i.value)),
      }))
      .filter((g) => g.indicators.length > 0)
    const total = groups.reduce((n, g) => n + g.indicators.length, 0)
    if (total === 0) return { kind: 'none', indicators: 0, analyses: 0 }

    const fileRef = await archiveFile(prisma, workspaceId, projectId, file)
    const analysesCol = col('analyses')!, indCol = col('indicators')
    for (const g of groups) {
      const analysis = await prisma.collectionRecord.create({ data: { collectionId: analysesCol.id, createdBy: userId, data: asJson({ date, panel: g.panel, lab, file: fileRef }) } })
      if (indCol) for (const ind of g.indicators) {
        await prisma.collectionRecord.create({ data: { collectionId: indCol.id, createdBy: userId, data: asJson({ analysis: analysis.id, name: ind.name, canonical: ind.canonical ?? '', value: ind.value, unit: ind.unit ?? '', refLow: ind.refLow ?? null, refHigh: ind.refHigh ?? null, refEst: !!ind.refEst, date }) } })
      }
    }
    if (docCol) await addDocument(prisma, docCol.id, { date, title: [lab, date].filter(Boolean).join(' · ') || date, type: 'report', file: fileRef }, userId)
    return { kind: 'lab', indicators: total, analyses: groups.length, collectionKey: 'analyses' }
  }

  // ── Imaging / instrumental study ───────────────────────────────────────────
  if (parsed.kind === 'imaging' && parsed.study && col('studies')) {
    const s = parsed.study
    const date = safeDate(s.date)
    const fileRef = await archiveFile(prisma, workspaceId, projectId, file)
    const type = STUDY_TYPES.includes(s.studyType ?? '') ? s.studyType! : 'other'
    await prisma.collectionRecord.create({ data: { collectionId: col('studies')!.id, createdBy: userId, data: asJson({ date, type, area: s.area ?? '', conclusion: s.conclusion ?? '', doctor: s.doctor ?? '', file: fileRef }) } })
    const dxCount = await addConditions(prisma, col('conditions'), parsed.confirmedDiagnoses, date, s.doctor, userId)
    if (docCol) await addDocument(prisma, docCol.id, { date, title: [s.area, date].filter(Boolean).join(' · ') || date, type: 'report', file: fileRef }, userId)
    return { kind: 'imaging', indicators: 0, analyses: 0, diagnoses: dxCount, collectionKey: 'studies' }
  }

  // ── Doctor's visit / examination → Visits (Приёмы) ─────────────────────────
  if (parsed.kind === 'encounter' && col('visits')) {
    const e = parsed.encounter ?? {}
    const date = safeDate(e.date)
    const fileRef = await archiveFile(prisma, workspaceId, projectId, file)
    const dxNames = (parsed.confirmedDiagnoses ?? []).map((d) => (typeof d === 'string' ? d : d?.name)?.trim()).filter(Boolean) as string[]
    const notes = [e.complaints?.trim(), e.recommendations?.trim()].filter(Boolean).join('\n\n')
    await prisma.collectionRecord.create({ data: { collectionId: col('visits')!.id, createdBy: userId, data: asJson({ date, doctor: e.doctor ?? '', diagnosis: dxNames.join(', '), notes }) } })
    const medCount = await addMedications(prisma, col('medications'), e.medications, date, e.doctor ? `🩺 ${e.doctor}` : '', userId)
    const dxCount = await addConditions(prisma, col('conditions'), parsed.confirmedDiagnoses, date, e.doctor, userId)
    if (docCol) await addDocument(prisma, docCol.id, { date, title: [e.doctor, date].filter(Boolean).join(' · ') || date, type: 'report', file: fileRef }, userId)
    return { kind: 'encounter', indicators: 0, analyses: 0, medications: medCount, diagnoses: dxCount, collectionKey: 'visits' }
  }

  // ── Any other medical document → Documents archive + distribute meds/recs ──
  if (docCol) {
    const d = parsed.document ?? {}
    const date = safeDate(d.date)
    const fileRef = await archiveFile(prisma, workspaceId, projectId, file)
    await prisma.collectionRecord.create({ data: { collectionId: docCol.id, createdBy: userId, data: asJson({ date, title: d.title || file.filename, type: DOC_TYPES.includes(d.docType ?? '') ? d.docType : 'other', file: fileRef, notes: d.recommendations ?? '' }) } })
    const medCount = await addMedications(prisma, col('medications'), d.medications, date, d.title ? `📄 ${d.title}` : '', userId)
    const dxCount = await addConditions(prisma, col('conditions'), parsed.confirmedDiagnoses, date, undefined, userId)
    return { kind: 'document', indicators: 0, analyses: 0, medications: medCount, diagnoses: dxCount, collectionKey: 'documents' }
  }

  return { kind: 'none', indicators: 0, analyses: 0 }
}

// ─── Finance pipeline: recognise a receipt or a bank statement ───────────────
const FIN_CATS = ['groceries', 'eatingout', 'transport', 'housing', 'utilities', 'health', 'shopping', 'entertainment', 'education', 'salary', 'gift', 'other']

function receiptPrompt(): string {
  return `You are a personal-finance document parser. The document may be in Russian, English or Belarusian.
First CLASSIFY, then extract. Return ONLY valid JSON, no prose:
{
  "kind": "receipt" | "statement",
  // receipt = a single store/payment receipt (one purchase):
  "receipt": { "date": "YYYY-MM-DD or null", "merchant": "store/payee", "total": number,
    "currency": "RUB|USD|EUR|BYN|...", "category": "groceries|eatingout|transport|housing|utilities|health|shopping|entertainment|education|gift|other" },
  // statement = a bank/card statement listing many operations:
  "statement": { "transactions": [ { "date": "YYYY-MM-DD", "amount": number, "type": "expense|income",
    "merchant": "", "category": "groceries|eatingout|transport|housing|utilities|health|shopping|entertainment|education|salary|gift|other" } ] }
}
Rules: amounts are POSITIVE numbers. A receipt total is an expense. In a statement classify each line: debit/withdrawal → expense, credit/deposit → income. Pick the closest category from the list (else "other"). Output JSON only.`
}

interface ReceiptResult {
  kind?: string
  receipt?: { date?: string | null; merchant?: string; total?: number; currency?: string; category?: string }
  statement?: { transactions?: { date?: string | null; amount?: number; type?: string; merchant?: string; category?: string }[] }
}

export interface ReceiptSummary { kind: 'receipt' | 'statement' | 'none'; transactions: number; collectionKey?: string }

const finCat = (c?: string) => (FIN_CATS.includes(c ?? '') ? c! : 'other')

// Recognise a receipt (→ one expense) or a bank statement (→ many operations)
// and write them into the Finance module's `transactions` collection. The
// account is left to the single existing account when unambiguous.
export async function runReceiptScan(
  prisma: PrismaClient, workspaceId: string, projectId: string, ocr: OcrConfig,
  file: { buffer: Buffer; mime: string; filename: string }, userId: string | null,
): Promise<ReceiptSummary> {
  const cols = await prisma.collection.findMany({ where: { projectId }, select: { id: true, key: true } })
  const txCol = cols.find((c) => c.key === 'transactions')
  if (!txCol) return { kind: 'none', transactions: 0 }
  const acctCol = cols.find((c) => c.key === 'accounts')

  // Default account: the sole account, if there's exactly one.
  let defaultAccount: string | null = null
  if (acctCol) {
    const accts = await prisma.collectionRecord.findMany({ where: { collectionId: acctCol.id }, select: { id: true } })
    if (accts.length === 1) defaultAccount = accts[0].id
  }

  const prompt = receiptPrompt()
  let raw: string
  if (file.mime === 'application/pdf') {
    const text = await pdfText(file.buffer)
    raw = text.trim().length >= 40
      ? await runExtraction(ocr, { text }, prompt)
      : await runExtraction(ocr, { images: [{ base64: file.buffer.toString('base64'), mime: file.mime }] }, prompt)
  } else {
    raw = await runExtraction(ocr, { images: [{ base64: file.buffer.toString('base64'), mime: file.mime }] }, prompt)
  }
  const parsed = parseJsonLoose(raw) as ReceiptResult

  // ── Statement → many operations ───────────────────────────────────────────
  if (parsed.kind === 'statement' && parsed.statement?.transactions?.length) {
    let n = 0
    for (const t of parsed.statement.transactions) {
      const amt = Number(t.amount)
      if (!Number.isFinite(amt) || amt <= 0) continue
      await prisma.collectionRecord.create({ data: { collectionId: txCol.id, createdBy: userId, data: asJson({
        date: safeDate(t.date), type: t.type === 'income' ? 'income' : 'expense', amount: amt,
        category: finCat(t.category), account: defaultAccount, merchant: t.merchant ?? '',
      }) } })
      n++
    }
    if (n === 0) return { kind: 'none', transactions: 0 }
    return { kind: 'statement', transactions: n, collectionKey: 'transactions' }
  }

  // ── Receipt → one expense (with the scan attached) ────────────────────────
  const r = parsed.receipt ?? {}
  const total = Number(r.total)
  if (!Number.isFinite(total) || total <= 0) return { kind: 'none', transactions: 0 }
  const fileRef = await archiveFile(prisma, workspaceId, projectId, file)
  await prisma.collectionRecord.create({ data: { collectionId: txCol.id, createdBy: userId, data: asJson({
    date: safeDate(r.date), type: 'expense', amount: total, category: finCat(r.category),
    account: defaultAccount, merchant: r.merchant ?? '', file: fileRef,
  }) } })
  return { kind: 'receipt', transactions: 1, collectionKey: 'transactions' }
}
