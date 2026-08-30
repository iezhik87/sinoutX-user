import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, X, FolderKanban, FileText, Sparkles, Download, Brain, CreditCard } from 'lucide-react'
import { useT } from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { useBillingStore } from '@/stores/billingStore'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'sinoutx-onboarded'

const STEP_ICONS = [
  <Brain size={36} className="text-primary-400" />,
  <FolderKanban size={36} className="text-emerald-400" />,
  <FileText size={36} className="text-sky-400" />,
  <Sparkles size={36} className="text-violet-400" />,
  <Download size={36} className="text-amber-400" />,
]

const STEP_COLORS = [
  'from-primary-500/20 to-primary-700/10',
  'from-emerald-500/20 to-emerald-700/10',
  'from-sky-500/20 to-sky-700/10',
  'from-violet-500/20 to-violet-700/10',
  'from-amber-500/20 to-amber-700/10',
]

export function OnboardingModal() {
  const t = useT()
  const o = t.onboarding
  const { user } = useAuthStore()

  const storageKey = user ? `${STORAGE_KEY}-${user.id}` : null
  // Тур, отложенный до оплаты. Ключ отдельный: сам тур ещё НЕ пройден, и гасить
  // его нельзя — иначе оплативший не увидит его никогда.
  const pendingKey = storageKey ? `${storageKey}-pending` : null
  const frozen = useBillingStore((s) => s.frozen)
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!storageKey || !pendingKey) return
    if (localStorage.getItem(storageKey)) return
    // Тур — для НОВЫХ аккаунтов. Раньше он гейтился только localStorage, поэтому
    // всплывал у существующего пользователя на новом устройстве/в чистом браузере
    // (и при каждом заходе через автоматизацию без постоянного профиля). Аккаунтам
    // старше 48 часов больше не показываем. createdAt приходит из /auth/me с
    // небольшой задержкой — пока его нет, решение откладываем (эффект перезапустится).
    if (!user?.createdAt) return

    // Заморожен — значит на облаке, где аккаунт заморожен с первой минуты. Тур
    // зовёт создать проект, начать печатать, подключить провайдера, импортировать
    // из Notion — на всё это сервер ответит 402. Показывать его сейчас значит
    // начать знакомство с пяти обещаний, ни одно из которых не сбудется.
    if (frozen) {
      localStorage.setItem(pendingKey, '1')
      // В этой сессии окно уже закрывали — не навязываемся, плашка сверху и так
      // висит постоянно.
      if (sessionStorage.getItem(pendingKey)) return
      setStep(0)
      setVisible(true)
      return
    }

    const ageMs = Date.now() - new Date(user.createdAt).getTime()
    // Отложенный тур возрастом не гасится: оплативший на третий день заслуживает
    // то же знакомство, что и оплативший сразу.
    if (ageMs < 48 * 3600 * 1000 || localStorage.getItem(pendingKey)) {
      localStorage.removeItem(pendingKey)
      setVisible(true)
    } else {
      localStorage.setItem(storageKey, '1') // существующий аккаунт — гасим навсегда
    }
  }, [storageKey, pendingKey, user?.createdAt, frozen])

  function dismiss() {
    // Экран оплаты закрывается только на сессию: тур впереди, он ещё не пройден.
    if (frozen) {
      if (pendingKey) sessionStorage.setItem(pendingKey, '1')
      setVisible(false)
      return
    }
    if (storageKey) localStorage.setItem(storageKey, '1')
    setVisible(false)
  }

  function finish() {
    dismiss()
    // Last step — go to settings/import or just close
  }

  if (!visible) return null

  // Замороженный аккаунт видит не тур, а один экран: за что платит и куда нажать.
  const paywall = frozen
  const current = paywall ? o.paywall : o.steps[step]
  const isLast = step === o.steps.length - 1

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg bg-surface-900 border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden">
        {/* Gradient accent top */}
        <div className={cn('h-1 w-full bg-gradient-to-r', STEP_COLORS[step])} />

        {/* Close */}
        <button onClick={dismiss}
          className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors">
          <X size={16} />
        </button>

        {/* Step counter — у экрана оплаты шагов нет */}
        {!paywall && (
          <div className="flex gap-1.5 absolute top-5 left-1/2 -translate-x-1/2">
            {o.steps.map((_, i) => (
              <button key={i} onClick={() => setStep(i)}
                className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-primary-400' : 'w-1.5 bg-slate-600 hover:bg-slate-500')} />
            ))}
          </div>
        )}

        {/* Content */}
        <div className="px-8 pt-12 pb-8">
          {/* Icon */}
          <div className={cn('w-16 h-16 rounded-2xl flex items-center justify-center mb-6 bg-gradient-to-br',
            paywall ? 'from-amber-500/20 to-amber-700/10' : STEP_COLORS[step])}>
            {paywall ? <CreditCard size={36} className="text-amber-400" /> : STEP_ICONS[step]}
          </div>

          <h2 className="text-xl font-semibold text-slate-100 mb-3">{current.title}</h2>
          <p className="text-sm text-slate-300 leading-relaxed mb-4">{current.desc}</p>

          {/* Hint box */}
          <div className="bg-surface-800 border border-slate-700/50 rounded-lg px-4 py-3 mb-8">
            <p className="text-xs text-slate-400">{current.hint}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button onClick={dismiss}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              {paywall ? o.paywall.later : o.skip}
            </button>

            {paywall ? (
              <button
                onClick={() => { dismiss(); navigate('/billing') }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors">
                {o.paywall.cta}
                <ChevronRight size={14} />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">
                  {o.step} {step + 1} {o.of} {o.steps.length}
                </span>
                <button
                  onClick={() => { if (isLast) { finish() } else { setStep(s => s + 1) } }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition-colors">
                  {isLast ? o.finish : o.next}
                  {!isLast && <ChevronRight size={14} />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
