import { api } from './client'
import type { AuthUser } from '@/stores/authStore'

export interface LoginResponse {
  token: string
  user: AuthUser
  /**
   * Итог погашения приглашений при регистрации. Приходит только при регистрации
   * по ссылке: joined — сколько доступов открылось, refused — сколько
   * отказано (мест по тарифу не осталось либо цель удалили).
   */
  invites?: { joined: number; refused: number }
}

export interface LoginResponseWith2FA {
  requiresTOTP: true
  tempToken: string
}

export interface RegisterResponseVerification {
  requiresVerification: true
  /** Тот же итог, что и в LoginResponse: приглашение могло не сработать. */
  invites?: { joined: number; refused: number }
}

export interface ApiKeyItem {
  id: string
  name: string
  prefix: string
  lastUsedAt: string | null
  expiresAt: string | null
  scopes: string[]
  workspaceIds: string[] // empty = all workspaces
  createdAt: string
  key?: string // only returned on creation
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse | LoginResponseWith2FA>('/auth/login', { email, password }).then((r) => r.data),

  // `inviteCode` is the instance-wide code; `invite` is a personal token from
  // a colleague's email, and it also grants the right to register at all.
  register: (data: { email: string; name: string; password: string; inviteCode?: string; invite?: string }) =>
    api.post<LoginResponse | RegisterResponseVerification>('/auth/register', data).then((r) => r.data),

  resendVerification: (email: string) =>
    api.post('/auth/resend-verification', { email }).then((r) => r.data),

  me: () => api.get<AuthUser>('/auth/me').then((r) => r.data),

  logout: () => api.post('/auth/logout'),

  listApiKeys: () => api.get<ApiKeyItem[]>('/auth/api-keys').then((r) => r.data),

  createApiKey: (name: string, opts?: { scopes?: string[]; workspaceIds?: string[] }) =>
    api.post<ApiKeyItem>('/auth/api-keys', { name, ...opts }).then((r) => r.data),

  updateApiKey: (id: string, patch: { name?: string; workspaceIds?: string[] }) =>
    api.patch<ApiKeyItem>(`/auth/api-keys/${id}`, patch).then((r) => r.data),

  deleteApiKey: (id: string) => api.delete(`/auth/api-keys/${id}`),
}
