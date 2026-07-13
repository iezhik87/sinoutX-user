import { PrismaClient, Prisma } from '@prisma/client'
import { CreateBudgetEntryInput, UpdateBudgetEntryInput, ListBudgetQuery } from './budget.schema.js'

export class BudgetService {
  constructor(private prisma: PrismaClient) {}

  async list(query: ListBudgetQuery) {
    const where: Prisma.BudgetEntryWhereInput = {}
    if (query.projectId) where.projectId = query.projectId
    if (query.type) where.type = query.type
    if (query.category) where.category = query.category
    if (query.currency) where.currency = query.currency
    if (query.account) where.account = query.account
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      }
    }
    if (query.workspaceId && !query.projectId) {
      where.project = { workspaceId: query.workspaceId }
    }

    return this.prisma.budgetEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { project: { select: { id: true, name: true } } },
    })
  }

  async getById(id: string) {
    return this.prisma.budgetEntry.findUnique({ where: { id } })
  }

  async create(data: CreateBudgetEntryInput) {
    return this.prisma.budgetEntry.create({
      data: {
        ...data,
        amount: data.amount,
        date: new Date(data.date),
      },
    })
  }

  async update(id: string, data: UpdateBudgetEntryInput) {
    return this.prisma.budgetEntry.update({
      where: { id },
      data: {
        ...data,
        date: data.date ? new Date(data.date) : undefined,
      },
    })
  }

  async delete(id: string) {
    return this.prisma.budgetEntry.delete({ where: { id } })
  }

  /** Сводка по бюджету */
  async getSummary(query: { projectId?: string; workspaceId?: string; from?: string; to?: string }) {
    const where: Prisma.BudgetEntryWhereInput = {}
    if (query.projectId) where.projectId = query.projectId
    if (query.workspaceId && !query.projectId) where.project = { workspaceId: query.workspaceId }
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      }
    }

    const [byType, byCategory, entries, byAccount] = await this.prisma.$transaction([
      // Сумма по типу (доходы / расходы)
      this.prisma.budgetEntry.groupBy({
        by: ['type', 'currency'],
        where,
        orderBy: { type: 'asc' },
        _sum: { amount: true },
        _count: true,
      }),
      // Топ категорий по расходам
      this.prisma.budgetEntry.groupBy({
        by: ['category', 'type'],
        where: { ...where, type: 'EXPENSE' },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10,
      }),
      // Последние 5 записей
      this.prisma.budgetEntry.findMany({
        where,
        orderBy: { date: 'desc' },
        take: 5,
      }),
      // Сводка по счетам
      this.prisma.budgetEntry.groupBy({
        by: ['account', 'type', 'currency'],
        where,
        _sum: { amount: true },
        _count: true,
        orderBy: { account: 'asc' },
      }),
    ])

    // Считаем баланс по каждой валюте
    const balance: Record<string, number> = {}
    for (const row of byType) {
      const cur = row.currency
      const amt = Number(row._sum?.amount ?? 0)
      if (!balance[cur]) balance[cur] = 0
      balance[cur] += row.type === 'INCOME' ? amt : -amt
    }

    // Считаем баланс по счетам и валютам
    const accountBalance: Record<string, Record<string, number>> = {}
    for (const row of byAccount) {
      const acc = row.account
      const cur = row.currency
      const amt = Number(row._sum?.amount ?? 0)
      if (!accountBalance[acc]) accountBalance[acc] = {}
      if (!accountBalance[acc][cur]) accountBalance[acc][cur] = 0
      accountBalance[acc][cur] += row.type === 'INCOME' ? amt : -amt
    }

    return { byType, byCategory, recentEntries: entries, balance, byAccount, accountBalance }
  }

  /** Данные для графика по месяцам */
  async getMonthlyChart(projectId: string, year: number) {
    const from = new Date(`${year}-01-01T00:00:00.000Z`)
    const to = new Date(`${year}-12-31T23:59:59.999Z`)

    const entries = await this.prisma.budgetEntry.findMany({
      where: { projectId, date: { gte: from, lte: to } },
      select: { type: true, amount: true, date: true },
      orderBy: { date: 'asc' },
    })

    // Группируем по месяцу
    const months: Record<number, { income: number; expense: number }> = {}
    for (let m = 1; m <= 12; m++) months[m] = { income: 0, expense: 0 }

    for (const e of entries) {
      const m = e.date.getMonth() + 1
      const amt = Number(e.amount)
      if (e.type === 'INCOME') months[m].income += amt
      else months[m].expense += amt
    }

    return Object.entries(months).map(([month, data]) => ({
      month: Number(month),
      ...data,
      net: data.income - data.expense,
    }))
  }
}
