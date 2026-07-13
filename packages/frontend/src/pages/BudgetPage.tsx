import { useState, useEffect, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Plus, TrendingUp, TrendingDown, Wallet, Loader2, Trash2, Download, CreditCard, Banknote, PiggyBank, Building2, MoreHorizontal } from 'lucide-react'
import { budgetApi, type BudgetType, type BudgetEntry } from '@/api/client'
import { Header } from '@/components/layout/Header'
import { Modal } from '@/components/common/Modal'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { getDateLocale } from '@/i18n/dateLocale'
import { useT } from '@/i18n'
import { useLanguageStore } from '@/stores/languageStore'
import { getIntlLocale } from '@/i18n/dateLocale'

const CURRENCIES = [
  { code: 'RUB', symbol: '₽', label: 'Russian Ruble' },
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'GBP', symbol: '£', label: 'British Pound' },
  { code: 'CNY', symbol: '¥', label: 'Chinese Yuan' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen' },
  { code: 'CHF', symbol: 'Fr', label: 'Swiss Franc' },
  { code: 'CAD', symbol: 'CA$', label: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar' },
  { code: 'KZT', symbol: '₸', label: 'Kazakhstani Tenge' },
  { code: 'UAH', symbol: '₴', label: 'Ukrainian Hryvnia' },
  { code: 'BYN', symbol: 'Br', label: 'Belarusian Ruble' },
  { code: 'TRY', symbol: '₺', label: 'Turkish Lira' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee' },
  { code: 'PLN', symbol: 'zł', label: 'Polish Złoty' },
  { code: 'CZK', symbol: 'Kč', label: 'Czech Koruna' },
  { code: 'SEK', symbol: 'kr', label: 'Swedish Krona' },
  { code: 'NOK', symbol: 'kr', label: 'Norwegian Krone' },
  { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham' },
]

const ACCOUNT_ICON_MAP: Record<string, ReactNode> = {
  'Наличные': <Banknote size={14} />,
  'Cash': <Banknote size={14} />,
  'Наяўныя': <Banknote size={14} />,
  'Карта': <CreditCard size={14} />,
  'Card': <CreditCard size={14} />,
  'Счёт': <Building2 size={14} />,
  'Account': <Building2 size={14} />,
  'Рахунак': <Building2 size={14} />,
  'Накопления': <PiggyBank size={14} />,
  'Savings': <PiggyBank size={14} />,
  'Зберажэнні': <PiggyBank size={14} />,
  'Другое': <MoreHorizontal size={14} />,
  'Other': <MoreHorizontal size={14} />,
  'Іншае': <MoreHorizontal size={14} />,
}

function getAccountIcon(account: string) {
  return ACCOUNT_ICON_MAP[account] ?? <Wallet size={14} />
}

function getCurrencySymbol(code: string) {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code
}
const PIE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#84cc16', '#f97316']

export function BudgetPage() {
  const intl = getIntlLocale(useLanguageStore().language)
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const t = useT()
  const currentYear = new Date().getFullYear()

  const MONTH_NAMES = t.budget.monthNames
  const PRESET_ACCOUNTS = t.budget.presetAccounts
  const defaultAccount = localStorage.getItem('budget-account') || PRESET_ACCOUNTS[0]

  const [showCreate, setShowCreate] = useState(false)
  const [highlightEntryId] = useState(searchParams.get('entryId'))

  useEffect(() => {
    if (searchParams.get('entryId')) {
      setSearchParams({}, { replace: true })
      setTimeout(() => {
        document.getElementById(`entry-${highlightEntryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 500)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [filterType, setFilterType] = useState<BudgetType | ''>('')
  const [filterAccount, setFilterAccount] = useState<string>('all')
  const [displayCurrency, setDisplayCurrency] = useState(localStorage.getItem('budget-currency') ?? 'RUB')
  const [form, setForm] = useState({
    type: 'EXPENSE' as BudgetType,
    category: '',
    amount: '',
    currency: localStorage.getItem('budget-currency') ?? 'RUB',
    account: defaultAccount,
    date: new Date().toISOString().split('T')[0],
    description: '',
  })

  function changeDisplayCurrency(code: string) {
    setDisplayCurrency(code)
    localStorage.setItem('budget-currency', code)
    setForm((f) => ({ ...f, currency: code }))
  }

  const { data: summary } = useQuery({
    queryKey: ['budget-summary', projectId],
    queryFn: () => budgetApi.getSummary({ projectId }),
    enabled: !!projectId,
  })

  const { data: chartData = [] } = useQuery({
    queryKey: ['budget-chart', projectId, currentYear],
    queryFn: () => budgetApi.getMonthlyChart(projectId!, currentYear),
    enabled: !!projectId,
  })

  const { data: entries = [], isLoading: entriesLoading } = useQuery({
    queryKey: ['budget-entries', projectId, filterType, filterAccount],
    queryFn: () => budgetApi.list({
      projectId,
      type: filterType || undefined,
      account: filterAccount !== 'all' ? filterAccount : undefined,
    }),
    enabled: !!projectId,
  })

  const createEntry = useMutation({
    mutationFn: () =>
      budgetApi.create({
        projectId: projectId!,
        type: form.type,
        category: form.category.trim(),
        amount: parseFloat(form.amount),
        currency: form.currency,
        account: form.account,
        date: new Date(form.date).toISOString(),
        description: form.description.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['budget-summary', projectId] })
      qc.invalidateQueries({ queryKey: ['budget-chart', projectId] })
      setShowCreate(false)
      localStorage.setItem('budget-account', form.account)
      setForm({ type: 'EXPENSE', category: '', amount: '', currency: localStorage.getItem('budget-currency') ?? 'RUB', account: form.account, date: new Date().toISOString().split('T')[0], description: '' })
    },
  })

  const deleteEntry = useMutation({
    mutationFn: (id: string) => budgetApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-entries', projectId] })
      qc.invalidateQueries({ queryKey: ['budget-summary', projectId] })
      qc.invalidateQueries({ queryKey: ['budget-chart', projectId] })
    },
  })

  const balance = summary?.balance ?? {}
  const accountBalance = summary?.accountBalance ?? {}
  const totalBalance = balance[displayCurrency] ?? 0
  const totalIncome = summary?.byType.filter((b) => b.type === 'INCOME' && b.currency === displayCurrency).reduce((s, b) => s + Number(b._sum.amount ?? 0), 0) ?? 0
  const totalExpense = summary?.byType.filter((b) => b.type === 'EXPENSE' && b.currency === displayCurrency).reduce((s, b) => s + Number(b._sum.amount ?? 0), 0) ?? 0

  // Collect all accounts that have entries
  const accountsWithEntries = Array.from(
    new Set((summary?.byAccount ?? []).map((r) => r.account))
  ).sort()

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t.budget.title}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={displayCurrency}
              onChange={(e) => changeDisplayCurrency(e.target.value)}
              className="h-8 px-2 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-300 focus:outline-none focus:border-slate-500 cursor-pointer"
              title={t.budget.displayCurrency}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
              ))}
            </select>
            <div className="relative group">
              <button className="btn-ghost text-xs" title={t.budget.exportBudget}>
                <Download size={13} /> CSV
              </button>
              <div className="absolute right-0 top-full mt-1 z-20 hidden group-hover:block bg-surface-900 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[150px]">
                <button
                  onClick={() => window.open(`/api/v1/projects/${projectId}/budget/export?format=csv`, '_blank')}
                  className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  {t.budget.exportCsvAll}
                </button>
                <button
                  onClick={() => window.open(`/api/v1/projects/${projectId}/budget/export?format=csv&year=${currentYear}`, '_blank')}
                  className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  {t.budget.exportCsvYear.replace('{year}', String(currentYear))}
                </button>
                <button
                  onClick={() => window.open(`/api/v1/projects/${projectId}/budget/export?format=json`, '_blank')}
                  className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  {t.budget.exportJson}
                </button>
              </div>
            </div>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <Plus size={14} /> {t.budget.newEntry}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <SummaryCard
            label={t.budget.balance}
            value={totalBalance}
            currency={displayCurrency}
            icon={<Wallet size={18} />}
            color={totalBalance >= 0 ? 'text-green-400' : 'text-red-400'}
          />
          <SummaryCard
            label={t.budget.income}
            value={totalIncome}
            currency={displayCurrency}
            icon={<TrendingUp size={18} />}
            color="text-green-400"
          />
          <SummaryCard
            label={t.budget.expense}
            value={totalExpense}
            currency={displayCurrency}
            icon={<TrendingDown size={18} />}
            color="text-red-400"
          />
        </div>

        {/* Accounts section */}
        {accountsWithEntries.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t.budget.accounts}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {accountsWithEntries.map((acc) => {
                const bal = accountBalance[acc]?.[displayCurrency] ?? 0
                return (
                  <button
                    key={acc}
                    onClick={() => setFilterAccount(filterAccount === acc ? 'all' : acc)}
                    className={cn(
                      'flex flex-col gap-2 p-3 rounded-xl border text-left transition-all',
                      filterAccount === acc
                        ? 'bg-primary-600/20 border-primary-500 text-primary-300'
                        : 'bg-surface-900 border-slate-800 hover:border-slate-700 text-slate-300',
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-slate-400">
                      {getAccountIcon(acc)}
                      <span className="text-xs font-medium">{acc}</span>
                    </div>
                    <p className={cn('text-sm font-bold', bal >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {bal.toLocaleString(intl, { maximumFractionDigits: 2 })} {getCurrencySymbol(displayCurrency)}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Charts row */}
        {chartData.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 bg-surface-900 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-slate-300 mb-4">{t.budget.chartMonthly} {currentYear}</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData.map((d) => ({ ...d, month: MONTH_NAMES[d.month - 1] }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', fontSize: 12 }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Bar dataKey="income" name={t.budget.income} fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" name={t.budget.expense} fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {(summary?.byCategory?.length ?? 0) > 0 && (
              <div className="bg-surface-900 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-slate-300 mb-4">{t.budget.chartCategories}</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={summary!.byCategory.map((c) => ({ name: c.category, value: Number(c._sum.amount ?? 0) }))}
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      dataKey="value"
                    >
                      {summary!.byCategory.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', fontSize: 11 }}
                    />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Entries list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">{t.budget.transactions}</h3>
            <div className="flex gap-2">
              {(['', 'INCOME', 'EXPENSE'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={cn(
                    'text-xs px-2.5 py-1 rounded-md transition-colors',
                    filterType === type ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800',
                  )}
                >
                  {type === '' ? t.budget.allTypes : type === 'INCOME' ? t.budget.income : t.budget.expense}
                </button>
              ))}
            </div>
          </div>

          {/* Account filter tabs */}
          {accountsWithEntries.length > 0 && (
            <div className="flex gap-1.5 mb-3 flex-wrap">
              <button
                onClick={() => setFilterAccount('all')}
                className={cn(
                  'flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors',
                  filterAccount === 'all' ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800',
                )}
              >
                {t.budget.allAccounts}
              </button>
              {accountsWithEntries.map((acc) => (
                <button
                  key={acc}
                  onClick={() => setFilterAccount(filterAccount === acc ? 'all' : acc)}
                  className={cn(
                    'flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors',
                    filterAccount === acc ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800',
                  )}
                >
                  {getAccountIcon(acc)} {acc}
                </button>
              ))}
            </div>
          )}

          {entriesLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin text-primary-500" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-slate-800 rounded-xl">
              <Wallet size={32} className="mx-auto text-slate-700 mb-2" />
              <p className="text-slate-500 text-sm">{t.budget.noEntries}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} onDelete={() => {
                  if (confirm(t.budget.deleteConfirm)) deleteEntry.mutate(entry.id)
                }} highlight={entry.id === highlightEntryId} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t.budget.newEntryTitle}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (form.category.trim() && form.amount && parseFloat(form.amount) > 0) createEntry.mutate()
          }}
          className="space-y-3"
        >
          {/* Type toggle */}
          <div className="flex rounded-lg overflow-hidden border border-slate-700">
            {(['EXPENSE', 'INCOME'] as BudgetType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setForm((f) => ({ ...f, type }))}
                className={cn(
                  'flex-1 py-2 text-sm font-medium transition-colors',
                  form.type === type
                    ? type === 'INCOME' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                    : 'text-slate-400 hover:text-slate-200',
                )}
              >
                {type === 'INCOME' ? t.budget.types.INCOME : t.budget.types.EXPENSE}
              </button>
            ))}
          </div>

          <input
            autoFocus
            placeholder={t.budget.category}
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />

          {/* Account selector */}
          <div>
            <p className="text-xs text-slate-500 mb-1.5">{t.budget.accountLabel}</p>
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_ACCOUNTS.map((acc) => (
                <button
                  key={acc}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, account: acc }))}
                  className={cn(
                    'flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors',
                    form.account === acc
                      ? 'bg-primary-600/20 border-primary-500 text-primary-300'
                      : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300',
                  )}
                >
                  {getAccountIcon(acc)} {acc}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={t.budget.amount}
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="flex-1 bg-surface-950 border border-slate-700 rounded-l-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <span className="flex items-center px-3 bg-slate-800 border border-l-0 border-slate-700 rounded-r-md text-sm text-slate-400">
                {getCurrencySymbol(displayCurrency)} {displayCurrency}
              </span>
            </div>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <input
            placeholder={t.common.description}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full bg-surface-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost">{t.common.cancel}</button>
            <button type="submit" disabled={!form.category.trim() || !form.amount || createEntry.isPending} className="btn-primary">
              {createEntry.isPending ? <Loader2 size={14} className="animate-spin" /> : t.common.add}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function SummaryCard({ label, value, currency, icon, color }: {
  label: string; value: number; currency: string; icon: ReactNode; color: string
}) {
  const intl = getIntlLocale(useLanguageStore().language)
  return (
    <div className="bg-surface-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
      <div className={color}>{icon}</div>
      <div>
        <p className={cn('text-xl font-bold', color)}>
          {value.toLocaleString(intl, { maximumFractionDigits: 2 })} {currency}
        </p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  )
}

function EntryRow({ entry, onDelete, highlight }: { entry: BudgetEntry; onDelete: () => void; highlight?: boolean }) {
  const { language } = useLanguageStore()
  const isIncome = entry.type === 'INCOME'
  return (
    <div id={`entry-${entry.id}`} className={cn('group flex items-center gap-3 px-3 py-2.5 bg-surface-900 border rounded-lg hover:border-slate-700 transition-colors', highlight ? 'border-primary-500 ring-1 ring-primary-500/30' : 'border-slate-800')}>
      <div className={cn('w-2 h-2 rounded-full flex-shrink-0', isIncome ? 'bg-green-400' : 'bg-red-400')} />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-slate-200">{entry.category}</span>
        {entry.description && <span className="text-xs text-slate-500 ml-2">{entry.description}</span>}
      </div>
      {entry.account && (
        <span className="flex items-center gap-1 text-xs text-slate-600 flex-shrink-0">
          {getAccountIcon(entry.account)}
          {entry.account}
        </span>
      )}
      <span className={cn('text-sm font-semibold flex-shrink-0', isIncome ? 'text-green-400' : 'text-red-400')}>
        {isIncome ? '+' : '−'}{Number(entry.amount).toLocaleString()} {getCurrencySymbol(entry.currency)}
      </span>
      <span className="text-xs text-slate-600 flex-shrink-0">
        {format(new Date(entry.date), 'd MMM', { locale: getDateLocale(language) })}
      </span>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all flex-shrink-0"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}
