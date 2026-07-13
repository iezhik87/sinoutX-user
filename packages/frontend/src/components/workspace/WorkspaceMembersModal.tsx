import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, UserPlus, Trash2, Loader2, Crown, ShieldCheck, User, Eye, ChevronDown } from 'lucide-react'
import { workspaceApi, type WorkspaceMemberRole } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

const ROLE_ICONS: Record<WorkspaceMemberRole, React.ReactNode> = {
  OWNER: <Crown size={13} className="text-amber-400" />,
  ADMIN: <ShieldCheck size={13} className="text-sky-400" />,
  MEMBER: <User size={13} className="text-slate-400" />,
  VIEWER: <Eye size={13} className="text-slate-500" />,
}

const ROLE_LABELS: Record<WorkspaceMemberRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
}

export function WorkspaceMembersModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const t = useT()
  const [email, setEmail] = useState('')
  const [roleDropdown, setRoleDropdown] = useState<string | null>(null)
  const [inviteRole, setInviteRole] = useState<WorkspaceMemberRole>('MEMBER')

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => workspaceApi.listMembers(workspaceId),
  })

  const myRole = members.find((m) => m.userId === user?.id)?.role
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN'

  const [planLimitHit, setPlanLimitHit] = useState(false)

  const addMutation = useMutation({
    mutationFn: () => workspaceApi.addMember(workspaceId, { email, role: inviteRole }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-members', workspaceId] })
      setEmail('')
      setPlanLimitHit(false)
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string; resource?: string } } }
      setPlanLimitHit(e?.response?.data?.error === 'plan_limit')
    },
  })

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceMemberRole }) =>
      workspaceApi.updateMemberRole(workspaceId, userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-members', workspaceId] })
      setRoleDropdown(null)
    },
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) => workspaceApi.removeMember(workspaceId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace-members', workspaceId] }),
  })

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-surface-900 border border-slate-700/60 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-base font-semibold text-slate-100">{t.workspace.members.title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Invite form */}
        {canManage && (
          <div className="px-6 py-4 border-b border-slate-800">
            <p className="text-xs text-slate-500 mb-3">{t.workspace.members.inviteDesc}</p>
            <div className="flex flex-wrap gap-2">
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder={t.workspace.members.emailPlaceholder}
                className="flex-1 min-w-[160px] bg-surface-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-primary-500"
                onKeyDown={(e) => { if (e.key === 'Enter' && email) addMutation.mutate() }}
              />
              {/* Role select */}
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as WorkspaceMemberRole)}
                className="bg-surface-800 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-300 focus:outline-none focus:border-primary-500"
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
                <option value="VIEWER">Viewer (read-only)</option>
              </select>
              <button
                onClick={() => addMutation.mutate()}
                disabled={!email || addMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {addMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                {t.workspace.members.invite}
              </button>
            </div>
            {planLimitHit && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5">
                <Crown size={15} className="text-violet-300 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300">
                  <span className="font-semibold text-violet-200">{t.workspace.members.upgradeTitle}</span>
                  <span className="block text-slate-400 mt-0.5">{t.workspace.members.upgradeDesc}</span>
                  <a href="/buy?plan=team" className="inline-block mt-1.5 text-violet-300 hover:underline font-medium">
                    {t.workspace.members.upgradeCta} →
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Members list */}
        <div className="px-6 py-4 space-y-2 max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-slate-500" /></div>
          ) : members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-2">
              <div className="w-8 h-8 rounded-full bg-primary-600/20 flex items-center justify-center text-sm font-medium text-primary-300 flex-shrink-0">
                {m.user.name[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 truncate">{m.user.name}</p>
                <p className="text-xs text-slate-500 truncate">{m.user.email}</p>
              </div>

              {/* Role badge / dropdown */}
              <div className="relative">
                <button
                  disabled={!canManage || m.role === 'OWNER' || m.userId === user?.id}
                  onClick={() => setRoleDropdown(roleDropdown === m.id ? null : m.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors',
                    canManage && m.role !== 'OWNER' && m.userId !== user?.id
                      ? 'hover:bg-slate-700 cursor-pointer'
                      : 'cursor-default',
                  )}
                >
                  {ROLE_ICONS[m.role]}
                  <span className="text-slate-400">{ROLE_LABELS[m.role]}</span>
                  {canManage && m.role !== 'OWNER' && m.userId !== user?.id && <ChevronDown size={11} className="text-slate-600" />}
                </button>
                {roleDropdown === m.id && (
                  <div className="absolute right-0 top-full mt-1 bg-surface-800 border border-slate-700 rounded-lg shadow-xl z-10 py-1 min-w-[100px]">
                    {(['ADMIN', 'MEMBER', 'VIEWER'] as WorkspaceMemberRole[]).map((role) => (
                      <button key={role} onClick={() => roleMutation.mutate({ userId: m.userId, role })}
                        className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-slate-700 transition-colors', m.role === role && 'text-primary-400')}>
                        {ROLE_ICONS[role]} {ROLE_LABELS[role]}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Remove */}
              {canManage && m.role !== 'OWNER' && m.userId !== user?.id && (
                <button onClick={() => removeMutation.mutate(m.userId)}
                  disabled={removeMutation.isPending}
                  className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="px-6 pb-4 pt-2 text-xs text-slate-600 flex justify-between items-center border-t border-slate-800">
          <span>{members.length} {t.workspace.members.membersCount}</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">{t.common.close}</button>
        </div>
      </div>
    </div>
  )
}
