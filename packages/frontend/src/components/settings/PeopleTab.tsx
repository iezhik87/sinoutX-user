import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectApi } from '@/api/client'
import { useT } from '@/i18n/useT'
import { Loader2, UserPlus, Clock, X } from 'lucide-react'
import { renderIcon } from '@/components/common/EmojiPicker'
import { toast } from '@/stores/toastStore'

type Role = 'VIEWER' | 'EDITOR'

/**
 * Один экран на всех, кому что-то из моего видно.
 *
 * Доступ здесь НЕ новый: под каждой галочкой — тот же самый шаринг проекта, что
 * и в модалке «Поделиться». Пространство целиком по-прежнему расшарить нельзя,
 * это решение модели «один воркспейс на человека». Экран лишь избавляет от
 * обхода проектов по одному, когда людей и проектов становится больше двух.
 */
export function PeopleTab() {
  const t = useT()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('EDITOR')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['people'], queryFn: projectApi.people })
  const projects = data?.projects ?? []
  const people = data?.people ?? []
  const pending = data?.pending ?? []

  const refresh = () => qc.invalidateQueries({ queryKey: ['people'] })

  // Сервер отвечает 402, когда мест по тарифу больше нет. Ошибку надо назвать
  // своим именем: «Ошибка» рядом с работающей кнопкой ничего не объясняет.
  const failure = (e: unknown) => {
    const status = (e as { response?: { status?: number } })?.response?.status
    return status === 402 ? t.settings.peopleTab.seatLimit : t.common.error
  }

  const addMut = useMutation({
    mutationFn: async () => {
      const mail = email.trim().toLowerCase()
      // Доступ проектный, поэтому «добавить человека» — это выдача доступа к
      // каждому отмеченному проекту по отдельности.
      const results = await Promise.allSettled(
        [...picked].map((id) => projectApi.share(id, mail, role)),
      )
      const ok = results.filter((r) => r.status === 'fulfilled')
      // Ни одна выдача не прошла — это отказ целиком, а не «частично получилось».
      if (ok.length === 0) throw (results[0] as PromiseRejectedResult).reason
      const invited = ok.some((r) => (r.value as { invited?: boolean })?.invited)
      return { invited, partial: ok.length < results.length }
    },
    onSuccess: ({ invited, partial }) => {
      toast.success(invited ? t.settings.peopleTab.invited : t.settings.peopleTab.added)
      // Часть проектов не открылась — молчать об этом нельзя, галочки разъедутся
      // с тем, что человек на самом деле видит.
      if (partial) toast.error(t.settings.peopleTab.partial)
      setEmail('')
      setPicked(new Set())
      refresh()
    },
    onError: (e) => toast.error(failure(e)),
  })

  // Галочка на пересечении «человек × проект» — это выдача или отзыв доступа
  // ровно к этому проекту.
  const toggle = async (userId: string, email: string, projectId: string, has: boolean, r: Role) => {
    const key = `${userId}:${projectId}`
    setBusy(key)
    try {
      if (has) await projectApi.removeMember(projectId, userId)
      else await projectApi.share(projectId, email, r)
      refresh()
    } catch (e) {
      toast.error(failure(e))
    } finally {
      setBusy(null)
    }
  }

  const changeRole = async (userId: string, projectIds: string[], r: Role) => {
    setBusy(userId)
    try {
      await Promise.all(projectIds.map((id) => projectApi.updateMemberRole(id, userId, r)))
      refresh()
    } catch {
      toast.error(t.common.error)
    } finally {
      setBusy(null)
    }
  }

  const removeEverywhere = async (userId: string, name: string, projectIds: string[]) => {
    if (!window.confirm(t.settings.peopleTab.removeConfirm.replace('{name}', name))) return
    setBusy(userId)
    try {
      await Promise.all(projectIds.map((id) => projectApi.removeMember(id, userId)))
      toast.success(t.settings.peopleTab.removed)
      refresh()
    } catch {
      toast.error(t.common.error)
    } finally {
      setBusy(null)
    }
  }

  const revoke = async (id: string) => {
    setBusy(id)
    try {
      await projectApi.revokeInvite(id)
      toast.success(t.settings.peopleTab.revoked)
      refresh()
    } catch {
      toast.error(t.common.error)
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-500" size={22} /></div>
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-slate-400">{t.settings.peopleTab.subtitle}</p>

      {projects.length === 0 ? (
        <p className="text-sm text-slate-500 border border-slate-800 rounded-lg p-4">
          {t.settings.peopleTab.noProjects}
        </p>
      ) : (
        <>
          {/* ── добавить человека ─────────────────────────────────────────── */}
          <div className="border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.settings.peopleTab.invitePlaceholder}
                className="flex-1 min-w-[200px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-primary-500"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-primary-500"
              >
                <option value="EDITOR">{t.settings.peopleTab.editor}</option>
                <option value="VIEWER">{t.settings.peopleTab.viewer}</option>
              </select>
              <button
                onClick={() => {
                  if (picked.size === 0) return toast.error(t.settings.peopleTab.pickProject)
                  addMut.mutate()
                }}
                disabled={!email.trim() || addMut.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:hover:bg-primary-600 text-white text-sm font-medium transition-colors"
              >
                {addMut.isPending ? <Loader2 className="animate-spin" size={14} /> : <UserPlus size={14} />}
                {t.settings.peopleTab.add}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {projects.map((p) => {
                const on = picked.has(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      const next = new Set(picked)
                      if (on) next.delete(p.id); else next.add(p.id)
                      setPicked(next)
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors ${
                      on
                        ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                        : 'border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {renderIcon(p.icon, 12)}
                    {p.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── приглашения, которые ещё не приняли ───────────────────────── */}
          {pending.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 border border-amber-900/40 bg-amber-500/5 rounded-lg px-4 py-3">
              <Clock size={15} className="text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-200 truncate">{inv.email}</div>
                <div className="text-xs text-slate-500">
                  {t.settings.peopleTab.pending} · {t.settings.peopleTab.until}{' '}
                  {new Date(inv.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => revoke(inv.id)}
                disabled={busy === inv.id}
                className="text-xs text-slate-400 hover:text-red-400 transition-colors shrink-0"
              >
                {t.settings.peopleTab.revoke}
              </button>
            </div>
          ))}

          {/* ── люди и их доступы ─────────────────────────────────────────── */}
          {people.length === 0 && pending.length === 0 ? (
            <p className="text-sm text-slate-500 border border-slate-800 rounded-lg p-4">
              {t.settings.peopleTab.empty}
            </p>
          ) : (
            people.map((person) => {
              const granted = new Map(person.access.map((a) => [a.projectId, a.role]))
              const ids = person.access.map((a) => a.projectId)
              // Роль у человека может разъехаться по проектам; показываем ту,
              // что преобладает, а смена применяется ко всем его проектам сразу.
              const currentRole: Role = person.access.some((a) => a.role === 'EDITOR') ? 'EDITOR' : 'VIEWER'
              return (
                <div key={person.userId} className="border border-slate-800 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-200 truncate">{person.name}</div>
                      <div className="text-xs text-slate-500 truncate">{person.email}</div>
                    </div>
                    <select
                      value={currentRole}
                      onChange={(e) => changeRole(person.userId, ids, e.target.value as Role)}
                      disabled={busy === person.userId || ids.length === 0}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-primary-500"
                    >
                      <option value="EDITOR">{t.settings.peopleTab.editor}</option>
                      <option value="VIEWER">{t.settings.peopleTab.viewer}</option>
                    </select>
                    <button
                      onClick={() => removeEverywhere(person.userId, person.name, ids)}
                      disabled={busy === person.userId}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-400 transition-colors"
                    >
                      <X size={13} />
                      {t.settings.peopleTab.removeAll}
                    </button>
                  </div>

                  <div>
                    <div className="text-xs text-slate-500 mb-2">{t.settings.peopleTab.access}</div>
                    <div className="flex flex-wrap gap-2">
                      {projects.map((p) => {
                        const has = granted.has(p.id)
                        const key = `${person.userId}:${p.id}`
                        return (
                          <button
                            key={p.id}
                            onClick={() => toggle(person.userId, person.email, p.id, has, currentRole)}
                            disabled={busy === key}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors ${
                              has
                                ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                                : 'border-slate-700 text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            {busy === key ? <Loader2 className="animate-spin" size={12} /> : renderIcon(p.icon, 12)}
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </>
      )}
    </div>
  )
}
