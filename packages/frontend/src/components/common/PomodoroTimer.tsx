import { useState, useEffect, useRef, useCallback } from 'react'
import { Timer, X, SkipForward, RotateCcw, Coffee } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

type Phase = 'work' | 'short' | 'long'

const PHASES: Record<Phase, number> = {
  work:  25 * 60,
  short:  5 * 60,
  long:  15 * 60,
}

function fmt(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, '0')
  const ss = (s % 60).toString().padStart(2, '0')
  return `${m}:${ss}`
}

interface Props {
  onClose: () => void
}

export function PomodoroTimer({ onClose }: Props) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>('work')
  const [remaining, setRemaining] = useState(PHASES.work)
  const [running, setRunning] = useState(false)
  const [sessions, setSessions] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const total = PHASES[phase]
  const progress = 1 - remaining / total

  const nextPhase = useCallback((current: Phase, count: number): Phase => {
    if (current !== 'work') return 'work'
    const next = count + 1
    return next % 4 === 0 ? 'long' : 'short'
  }, [])

  const advance = useCallback(() => {
    setRunning(false)
    setPhase((p) => {
      const n = nextPhase(p, sessions)
      setRemaining(PHASES[n])
      if (p === 'work') setSessions((s) => s + 1)
      return n
    })
    // Browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Pomodoro', { body: phase === 'work' ? t.pomodoro.breakTime : t.pomodoro.workTime, icon: '/favicon.ico' })
    }
  }, [phase, sessions, nextPhase, t])

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) { advance(); return 0 }
          return r - 1
        })
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running, advance])

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const reset = () => {
    setRunning(false)
    setRemaining(PHASES[phase])
  }

  const radius = 48
  const circ = 2 * Math.PI * radius
  const dashOffset = circ * (1 - progress)

  const phaseColor = phase === 'work' ? '#6366f1' : phase === 'short' ? '#22c55e' : '#f59e0b'

  return (
    <div
      className="fixed bottom-24 right-6 z-50 bg-surface-800 border border-slate-700 rounded-2xl shadow-2xl p-5 w-56 select-none"
      style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.4)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <Timer size={11} />
          {phase === 'work' ? t.pomodoro.work : phase === 'short' ? t.pomodoro.shortBreak : t.pomodoro.longBreak}
        </span>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300">
          <X size={13} />
        </button>
      </div>

      {/* SVG circle */}
      <div className="flex justify-center mb-3 relative">
        <svg width={120} height={120} className="-rotate-90">
          <circle cx={60} cy={60} r={radius} fill="none" stroke="#1e293b" strokeWidth={6} />
          <circle
            cx={60} cy={60} r={radius} fill="none"
            stroke={phaseColor}
            strokeWidth={6}
            strokeDasharray={circ}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.5s linear, stroke 0.3s' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-mono font-bold text-slate-100">{fmt(remaining)}</span>
          <span className="text-[10px] text-slate-500 mt-0.5">
            {sessions} {t.pomodoro.sessions}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        <button onClick={reset} className="text-slate-500 hover:text-slate-300 p-1.5 rounded-lg hover:bg-surface-700">
          <RotateCcw size={14} />
        </button>
        <button
          onClick={() => setRunning((v) => !v)}
          className="px-5 py-1.5 rounded-full text-sm font-medium text-white transition-colors"
          style={{ background: running ? '#475569' : phaseColor }}
        >
          {running ? t.pomodoro.pause : t.pomodoro.start}
        </button>
        <button onClick={advance} className="text-slate-500 hover:text-slate-300 p-1.5 rounded-lg hover:bg-surface-700">
          <SkipForward size={14} />
        </button>
      </div>

      {/* Phase switcher */}
      <div className="flex gap-1 mt-3">
        {(['work', 'short', 'long'] as Phase[]).map((p) => (
          <button
            key={p}
            onClick={() => { setPhase(p); setRemaining(PHASES[p]); setRunning(false) }}
            className={cn(
              'flex-1 py-1 rounded text-[10px] transition-colors',
              phase === p ? 'bg-surface-700 text-slate-200' : 'text-slate-600 hover:text-slate-400',
            )}
          >
            {p === 'work' ? '25m' : p === 'short' ? <Coffee size={10} className="mx-auto" /> : '15m'}
          </button>
        ))}
      </div>
    </div>
  )
}
