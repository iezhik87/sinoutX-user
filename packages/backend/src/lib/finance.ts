// Deterministic finance rollup — account balances, this-month cashflow and
// spend-by-category, computed from the raw records. The AI must READ these
// numbers instead of doing money arithmetic in its head (LLMs are unreliable at
// running sums). Shared by the module-overview route and the agent's
// finance_overview tool.
import type { PrismaClient } from '@prisma/client'

export interface FinanceOverview {
  accounts: { id: string; name: string; currency: string; balance: number }[]
  cashflow: { income: number; expense: number }
  spendByCategory: { category: string; total: number }[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function computeFinanceOverview(prisma: PrismaClient, projectId: string): Promise<FinanceOverview | null> {
  const collections = await prisma.collection.findMany({ where: { projectId }, select: { id: true, key: true } })
  const acctCol = collections.find((c) => c.key === 'accounts')
  const txCol = collections.find((c) => c.key === 'transactions')
  if (!acctCol || !txCol) return null

  const [accts, txs] = await Promise.all([
    prisma.collectionRecord.findMany({ where: { collectionId: acctCol.id } }),
    prisma.collectionRecord.findMany({ where: { collectionId: txCol.id } }),
  ])
  const bal = new Map<string, number>()
  const meta = new Map<string, { name: string; currency: string }>()
  for (const a of accts) {
    const d = a.data as Record<string, unknown>
    bal.set(a.id, Number(d.startBalance) || 0)
    meta.set(a.id, { name: String(d.name ?? ''), currency: String(d.currency ?? '') })
  }
  const ym = new Date().toISOString().slice(0, 7)
  const spend = new Map<string, number>()
  let income = 0, expense = 0
  for (const t of txs) {
    const d = t.data as Record<string, unknown>
    const amt = Number(d.amount) || 0
    const type = String(d.type ?? '')
    const acc = typeof d.account === 'string' ? d.account : null
    const to = typeof d.toAccount === 'string' ? d.toAccount : null
    if (type === 'expense' && acc) bal.set(acc, (bal.get(acc) ?? 0) - amt)
    else if (type === 'income' && acc) bal.set(acc, (bal.get(acc) ?? 0) + amt)
    else if (type === 'transfer') {
      // Cross-currency exchange: destination is credited toAmount (in its own
      // currency), not the debited amount. Empty toAmount = same-currency transfer.
      const toAmt = Number(d.toAmount) || amt
      if (acc) bal.set(acc, (bal.get(acc) ?? 0) - amt)
      if (to) bal.set(to, (bal.get(to) ?? 0) + toAmt)
    }
    if (d.date && String(d.date).slice(0, 7) === ym) {
      if (type === 'expense') { expense += amt; const cat = String(d.category ?? 'other'); spend.set(cat, (spend.get(cat) ?? 0) + amt) }
      else if (type === 'income') income += amt
    }
  }
  return {
    accounts: [...meta.entries()].map(([id, m]) => ({ id, name: m.name, currency: m.currency, balance: r2(bal.get(id) ?? 0) })),
    cashflow: { income: r2(income), expense: r2(expense) },
    spendByCategory: [...spend.entries()].map(([category, total]) => ({ category, total: r2(total) })).sort((a, b) => b.total - a.total),
  }
}
