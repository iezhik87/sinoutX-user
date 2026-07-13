import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/common/Modal'
import { projectApi } from '@/api/client'
import { useLanguageStore } from '@/stores/languageStore'
import { Loader2, Trash2, UserPlus } from 'lucide-react'

/** Share a single project with another user by email (single-workspace model:
 *  collaboration happens at the project level, not the workspace level). */
export function ShareProjectModal({
  projectId,
  projectName,
  open,
  onClose,
}: {
  projectId: string
  projectName: string
  open: boolean
  onClose: () => void
}) {
  const { language } = useLanguageStore()
  const L = (en: string, ru: string, be: string) => (language === 'en' ? en : language === 'be' ? be : ru)
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'VIEWER' | 'EDITOR'>('EDITOR')
  const [error, setError] = useState('')

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectApi.listMembers(projectId),
    enabled: open,
  })

  const shareMut = useMutation({
    mutationFn: () => projectApi.share(projectId, email.trim().toLowerCase(), role),
    onSuccess: () => { setEmail(''); setError(''); qc.invalidateQueries({ queryKey: ['project-members', projectId] }) },
    onError: (e: { response?: { data?: { error?: string; message?: string } } }) => {
      const code = e.response?.data?.error
      setError(code === 'no_such_user' ? L('No user with this email', 'Нет пользователя с таким email', 'Няма карыстальніка з гэтым email')
        : code === 'already_member' ? L('Already has access', 'Уже есть доступ', 'Ужо мае доступ')
        : (e.response?.data?.message ?? L('Failed to share', 'Не удалось поделиться', 'Не атрымалася')))
    },
  })
  const removeMut = useMutation({
    mutationFn: (userId: string) => projectApi.removeMember(projectId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', projectId] }),
  })
  const roleMut = useMutation({
    mutationFn: ({ userId, r }: { userId: string; r: 'VIEWER' | 'EDITOR' }) => projectApi.updateMemberRole(projectId, userId, r),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', projectId] }),
  })

  return (
    <Modal open={open} onClose={onClose} title={`${L('Share', 'Поделиться', 'Падзяліцца')}: ${projectName}`}>
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          {L('Invite someone by email to collaborate on this project. They keep their own space — only this project is shared.',
            'Пригласи человека по email для работы над этим проектом. У него своё пространство — расшаривается только этот проект.',
            'Запрасі чалавека па email для працы над праектам.')}
        </p>

        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError('') }}
            onKeyDown={(e) => e.key === 'Enter' && email.trim() && shareMut.mutate()}
            placeholder="email@example.com"
            className="flex-1 bg-surface-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <select value={role} onChange={(e) => setRole(e.target.value as 'VIEWER' | 'EDITOR')}
            className="bg-surface-950 border border-slate-700 rounded-lg px-2 text-sm text-slate-200">
            <option value="EDITOR">{L('Editor', 'Редактор', 'Рэдактар')}</option>
            <option value="VIEWER">{L('Viewer', 'Чтение', 'Чытанне')}</option>
          </select>
          <button onClick={() => email.trim() && shareMut.mutate()} disabled={shareMut.isPending || !email.trim()} className="btn-primary">
            {shareMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}

        <div>
          <p className="text-xs text-slate-500 mb-2">{L('People with access', 'У кого есть доступ', 'Хто мае доступ')}</p>
          {isLoading ? (
            <Loader2 size={16} className="animate-spin text-primary-500" />
          ) : members.length === 0 ? (
            <p className="text-sm text-slate-600">{L('Not shared yet', 'Пока ни с кем', 'Пакуль ні з кім')}</p>
          ) : (
            <div className="space-y-1.5">
              {members.map((m) => (
                <div key={m.userId} className="flex items-center gap-2 px-3 py-2 bg-surface-900 border border-slate-800 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 truncate">{m.user.name}</p>
                    <p className="text-xs text-slate-600 truncate">{m.user.email}</p>
                  </div>
                  <select value={m.role} onChange={(e) => roleMut.mutate({ userId: m.userId, r: e.target.value as 'VIEWER' | 'EDITOR' })}
                    className="bg-surface-950 border border-slate-700 rounded-md px-1.5 py-1 text-xs text-slate-300">
                    <option value="EDITOR">{L('Editor', 'Редактор', 'Рэдактар')}</option>
                    <option value="VIEWER">{L('Viewer', 'Чтение', 'Чытанне')}</option>
                  </select>
                  <button onClick={() => removeMut.mutate(m.userId)} className="text-slate-600 hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
