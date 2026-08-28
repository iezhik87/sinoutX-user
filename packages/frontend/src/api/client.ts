import axios from 'axios'
import { useLanguageStore } from '../stores/languageStore'

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// Headers for raw fetch() calls (exports, AI SSE stream) that bypass axios —
// they still need the Bearer token now that all /api/v1 routes are guarded.
export function authFetchHeaders(extra?: Record<string, string>): Record<string, string> {
  const auth = api.defaults.headers.common['Authorization']
  return { ...(auth ? { Authorization: String(auth) } : {}), ...(extra ?? {}) }
}

// URL for streaming an attachment's content. Used in <img>/<iframe> src,
// downloads and new-tab opens where an Authorization header can't be set —
// so the JWT is passed as a ?token= query param (the backend accepts it).
export function attachmentContentUrl(id: string): string {
  const auth = api.defaults.headers.common['Authorization']
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/, '') : ''
  return `/api/v1/attachments/${id}/content${token ? `?token=${encodeURIComponent(token)}` : ''}`
}

// Append the current auth token to a bare attachment-content URL at render/click
// time. Stored page content keeps the bare URL (no token baked in, so it can't
// expire or leak via export/share); this adds ?token= only when actually loaded.
export function tokenizeAttachmentUrl(url: string): string {
  if (!url || !url.includes('/api/v1/attachments/') || !url.includes('/content')) return url
  if (/[?&]token=/.test(url)) return url
  const auth = api.defaults.headers.common['Authorization']
  const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/, '') : ''
  if (!token) return url
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}

// Tell the server which UI language the user chose, so notifications it raises
// on its own (low balance, storage almost full) speak his language — the browser
// Accept-Language can disagree with the in-app choice.
api.interceptors.request.use((cfg) => {
  try {
    const lang = useLanguageStore.getState().language
    if (lang) cfg.headers.set('X-Lang', String(lang))
  } catch { /* store not ready — fine */ }
  return cfg
})

api.interceptors.response.use(
  (res) => res,
  (error) => {
    // «Validation Error» tells the user nothing. The server already sends which
    // field failed and why — say that instead of the category name.
    const issues = error.response?.data?.issues as { path?: (string | number)[]; message?: string }[] | undefined
    const detail = issues?.length
      ? issues.slice(0, 2).map((i) => `${(i.path ?? []).join('.') || 'body'}: ${i.message ?? ''}`).join('; ')
      : undefined
    const message = detail ?? error.response?.data?.error ?? error.response?.data?.message ?? error.message
    const status = error.response?.status
    const method = (error.config?.method ?? '').toLowerCase()
    // 401/404 are silent. A 403 on a GET is usually a transient background read
    // against a stale workspace selection (self-heals once the workspace list
    // loads), so don't toast it — but keep 403 on writes visible (e.g. a save
    // rejected because of VIEWER role or a workspace membership problem).
    const silent = status === 401 || status === 404 || (status === 403 && method === 'get')

    // 402 = the account is frozen for non-payment. A toast per rejected write
    // would be a wall of toasts; raise the banner instead and stay quiet.
    if (status === 402 && error.response?.data?.error === 'account_frozen') {
      import('../stores/billingStore').then(({ useBillingStore }) => {
        useBillingStore.getState().setFrozen(true)
      })
      return Promise.reject(new Error(message))
    }

    // Out of disk. `plan_limit` is a code for us, not a sentence for a human —
    // and the human needs to know both how much he has and what to do about it.
    const data = error.response?.data
    if (status === 403 && data?.error === 'plan_limit' && data?.resource === 'storage') {
      const used = data.usedMb ?? '?'
      const limit = data.limitMb ?? '?'
      Promise.all([import('../stores/toastStore'), import('../stores/languageStore')]).then(
        ([{ toast }, { useLanguageStore }]) => {
          const lang = useLanguageStore.getState().language
          toast.error(
            lang === 'en'
              ? `Storage full: ${used} of ${limit} MB, and the reserve on top of it is used up too. Buy a pack in Settings → Plan to keep uploading.`
              : lang === 'be'
              ? `Месца скончылася: ${used} з ${limit} МБ, запас звыш таксама вычарпаны. Купіце пакет у Налады → Тарыф.`
              : `Место закончилось: ${used} из ${limit} МБ, запас сверх лимита тоже израсходован. Купите пакет в Настройки → Тариф, чтобы загружать дальше.`,
          )
        },
      )
      return Promise.reject(new Error('storage_full'))
    }

    // Import lazily to avoid circular deps
    import('../stores/toastStore').then(({ toast }) => {
      if (!silent) toast.error(message)
    })
    return Promise.reject(new Error(message))
  },
)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Workspace {
  id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  settings: Record<string, unknown>
  isPersonal?: boolean
  createdAt: string
  updatedAt: string
  _count?: { projects: number; notes: number }
}

export interface Project {
  id: string
  workspaceId: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  status: 'ACTIVE' | 'ARCHIVED' | 'TEMPLATE'
  isSystem?: boolean
  isModule?: boolean
  moduleId?: string | null
  position: number
  createdAt: string
  updatedAt: string
  pages?: PageMeta[]
  boards?: { id: string; name: string }[]
  _count?: { pages: number; tasks: number; calendarEvents: number; budgetEntries: number }
}

export interface ProjectMemberItem {
  userId: string
  role: 'VIEWER' | 'EDITOR'
  createdAt: string
  user: { name: string; email: string }
}

export interface SharedProject extends Project {
  myRole: 'VIEWER' | 'EDITOR'
  sharedBy: { name: string; email: string } | null
}

export interface PageMeta {
  id: string
  title: string
  icon: string | null
  position: number
  type: 'PAGE' | 'FOLDER' | 'TEMPLATE'
  parentPageId?: string | null
  isMemory?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface AttachmentLeaf {
  id: string
  filename: string
  mimeType: string
  size: number
  description: string | null
  metadata: Record<string, unknown>
  createdAt: string
  nodeType: 'attachment'
}

export interface PageTreeNode extends PageMeta {
  children: PageTreeNode[]
  attachments: AttachmentLeaf[]
}

export interface Page extends PageMeta {
  projectId: string
  coverImage: string | null
  content: Record<string, unknown>
  isDeleted: boolean
  isPublic: boolean
  publicToken: string | null
  children: PageMeta[]
}

// ─── Workspace API ────────────────────────────────────────────────────────────

export type WorkspaceMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'

export interface WorkspaceMember {
  id: string
  workspaceId: string
  userId: string
  role: WorkspaceMemberRole
  createdAt: string
  user: { id: string; name: string; email: string; role: string }
}

export const workspaceApi = {
  list: () => api.get<Workspace[]>('/workspaces').then((r) => r.data),
  getById: (id: string) => api.get<Workspace>(`/workspaces/${id}`).then((r) => r.data),
  create: (data: { name: string; description?: string; icon?: string; color?: string }) =>
    api.post<Workspace>('/workspaces', data).then((r) => r.data),
  update: (id: string, data: Partial<Workspace>) =>
    api.patch<Workspace>(`/workspaces/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/workspaces/${id}`),

  listMembers: (workspaceId: string) =>
    api.get<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`).then((r) => r.data),
  addMember: (workspaceId: string, data: { email?: string; userId?: string; role?: WorkspaceMemberRole }) =>
    // 201 with the membership when the person already has an account; 202 with
    // `invited` when an invitation was sent instead.
    api.post<WorkspaceMember & { invited?: boolean; emailSent?: boolean }>(`/workspaces/${workspaceId}/members`, data).then((r) => r.data),
  updateMemberRole: (workspaceId: string, userId: string, role: WorkspaceMemberRole) =>
    api.patch<WorkspaceMember>(`/workspaces/${workspaceId}/members/${userId}`, { role }).then((r) => r.data),
  removeMember: (workspaceId: string, userId: string) =>
    api.delete(`/workspaces/${workspaceId}/members/${userId}`),
}

// ─── Project API ──────────────────────────────────────────────────────────────

export interface DashboardStats {
  projectStats: { id: string; totalTasks: number; doneTasks: number }[]
  overdueTasks: { id: string; title: string; dueDate: string; priority: string; status: string; projectId: string }[]
  todayTasks: { id: string; title: string; dueDate: string; priority: string; status: string; projectId: string }[]
}

export interface PeopleOverview {
  projects: { id: string; name: string; icon?: string | null; color?: string | null }[]
  people: {
    userId: string; name: string; email: string; since: string
    access: { projectId: string; role: 'VIEWER' | 'EDITOR' }[]
  }[]
  pending: { id: string; email: string; projectId: string | null; role: string; expiresAt: string; createdAt: string }[]
}

export const projectApi = {
  listByWorkspace: (workspaceId: string) =>
    api.get<Project[]>(`/workspaces/${workspaceId}/projects`).then((r) => r.data),
  getById: (id: string) => api.get<Project>(`/projects/${id}`).then((r) => r.data),
  create: (data: { workspaceId: string; name: string; description?: string; icon?: string; color?: string }) =>
    api.post<Project>('/projects', data).then((r) => r.data),
  update: (id: string, data: Partial<Project>) =>
    api.patch<Project>(`/projects/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/projects/${id}`),
  reorder: (workspaceId: string, ids: string[]) =>
    api.post(`/workspaces/${workspaceId}/projects/reorder`, { ids }),
  // Project-level sharing
  listShared: () => api.get<SharedProject[]>('/projects/shared').then((r) => r.data),
  listMembers: (id: string) => api.get<ProjectMemberItem[]>(`/projects/${id}/members`).then((r) => r.data),
  share: (id: string, email: string, role: 'VIEWER' | 'EDITOR') =>
    api.post(`/projects/${id}/share`, { email, role }).then((r) => r.data),
  updateMemberRole: (id: string, userId: string, role: 'VIEWER' | 'EDITOR') =>
    api.patch(`/projects/${id}/members/${userId}`, { role }).then((r) => r.data),
  removeMember: (id: string, userId: string) => api.delete(`/projects/${id}/members/${userId}`),
  // Сводный вид на те же ProjectMember: кто и к каким моим проектам допущен.
  people: () => api.get<PeopleOverview>('/people').then((r) => r.data),
  revokeInvite: (inviteId: string) => api.delete(`/people/invites/${inviteId}`),
  getDashboard: (workspaceId: string) =>
    api.get<DashboardStats>(`/workspaces/${workspaceId}/dashboard`).then((r) => r.data),
}

// ─── Page API ─────────────────────────────────────────────────────────────────

export const pageApi = {
  listByProject: (projectId: string) =>
    api.get<PageMeta[]>(`/projects/${projectId}/pages`).then((r) => r.data),
  getTree: (projectId: string) =>
    api.get<PageTreeNode[]>(`/projects/${projectId}/pages/tree`).then((r) => r.data),
  getById: (id: string) => api.get<Page>(`/pages/${id}`).then((r) => r.data),
  create: (data: { projectId: string; title?: string; parentPageId?: string | null; icon?: string; type?: 'PAGE' | 'FOLDER' }) =>
    api.post<Page>('/pages', data).then((r) => r.data),
  update: (id: string, data: { title?: string; content?: Record<string, unknown>; icon?: string | null; parentPageId?: string | null }) =>
    api.patch<Page>(`/pages/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/pages/${id}`),
  getBacklinks: (id: string) =>
    api.get<{ id: string; title: string; projectId: string; project: { name: string } }[]>(`/pages/${id}/backlinks`).then((r) => r.data),
  getRecent: (workspaceId: string, limit = 12) =>
    api.get<{ id: string; title: string; icon: string | null; updatedAt: string; projectId: string; project: { name: string } }[]>(
      '/pages/recent', { params: { workspaceId, limit } }
    ).then((r) => r.data),
  reorder: (projectId: string, parentPageId: string | null, ids: string[]) =>
    api.post(`/projects/${projectId}/pages/reorder`, { parentPageId, ids }),
  getMemoryPage: (projectId: string) =>
    api.get<Page>(`/projects/${projectId}/memory-page`).then((r) => r.data),
  toggleShare: (id: string) =>
    api.post<{ isPublic: boolean; publicToken: string | null }>(`/pages/${id}/share`).then((r) => r.data),
  getPublic: (token: string) =>
    api.get<{ id: string; title: string; icon: string | null; content: Record<string, unknown>; updatedAt: string; project: { name: string } }>(
      `/share/${token}`
    ).then((r) => r.data),
}

// ─── Tag types ────────────────────────────────────────────────────────────────

export interface Tag {
  id: string
  workspaceId: string
  name: string
  color: string
}

export const tagApi = {
  list: (workspaceId: string) =>
    api.get<Tag[]>('/tags', { params: { workspaceId } }).then((r) => r.data),
  create: (data: { workspaceId: string; name: string; color?: string }) =>
    api.post<Tag>('/tags', data).then((r) => r.data),
  update: (id: string, data: { name?: string; color?: string }) =>
    api.patch<Tag>(`/tags/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/tags/${id}`),
}

export interface Comment {
  id: string
  taskId: string
  author: string | null
  text: string
  createdAt: string
  updatedAt: string
}

export const commentApi = {
  list: (taskId: string) =>
    api.get<Comment[]>(`/tasks/${taskId}/comments`).then((r) => r.data),
  create: (taskId: string, data: { text: string; author?: string }) =>
    api.post<Comment>(`/tasks/${taskId}/comments`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/comments/${id}`),
}

// ─── Custom fields ────────────────────────────────────────────────────────────

export interface CustomField {
  id: string
  projectId: string
  name: string
  fieldType: 'text' | 'number' | 'date' | 'select' | 'checkbox'
  options: string[] | null
  position: number
}

export interface CustomFieldValue {
  id: string
  customFieldId: string
  taskId: string
  value: string | null
}

export interface TimeEntry {
  id: string
  taskId: string
  startedAt: string
  stoppedAt: string | null
  durationSec: number | null
  note: string | null
}

export interface TimeReport {
  totalSec: number
  byDay: Record<string, number>
  byTask: { title: string; totalSec: number }[]
}

export const customFieldApi = {
  list: (projectId: string) =>
    api.get<CustomField[]>(`/projects/${projectId}/custom-fields`).then((r) => r.data),
  create: (projectId: string, data: { name: string; fieldType: CustomField['fieldType']; options?: string[] }) =>
    api.post<CustomField>(`/projects/${projectId}/custom-fields`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/custom-fields/${id}`),
  getValues: (taskId: string) =>
    api.get<CustomFieldValue[]>(`/tasks/${taskId}/custom-field-values`).then((r) => r.data),
  setValue: (taskId: string, fieldId: string, value: string | null) =>
    api.put<CustomFieldValue>(`/tasks/${taskId}/custom-field-values/${fieldId}`, { value }).then((r) => r.data),
}

// ─── Task types ───────────────────────────────────────────────────────────────

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CANCELLED'
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export interface TaskTag {
  tag: { id: string; name: string; color: string }
}

export interface Task {
  id: string
  projectId: string
  pageId: string | null
  parentTaskId: string | null
  boardId: string | null
  boardColumnId: string | null
  title: string
  description: Record<string, unknown> | null
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  startDate: string | null
  isRecurring: boolean
  recurrenceRule: string | null
  reminderAt: string[]
  assignee: string | null
  position: number
  createdAt: string
  updatedAt: string
  tags: TaskTag[]
  subtasks?: Pick<Task, 'id' | 'title' | 'status' | 'priority'>[]
  _count?: { subtasks: number }
}

export interface TasksResponse {
  items: Task[]
  total: number
  page: number
  limit: number
}

export interface TaskAnalytics {
  byStatus: { status: TaskStatus; _count: number }[]
  byPriority: { priority: TaskPriority; _count: number }[]
  overdue: number
}

export interface TaskActivity {
  id: string
  taskId: string
  actor: string | null
  action: string
  oldValue: string | null
  newValue: string | null
  createdAt: string
}

// ─── Board types ──────────────────────────────────────────────────────────────

export interface BoardColumn {
  id: string
  name: string
  color?: string
  position: number
  wipLimit?: number | null
  tasks?: Task[]
}

export interface Board {
  id: string
  projectId: string
  name: string
  columns: BoardColumn[]
  createdAt: string
  updatedAt: string
  _count?: { tasks: number }
}

// ─── Task API ─────────────────────────────────────────────────────────────────

export const taskApi = {
  list: (params: {
    projectId?: string
    workspaceId?: string
    boardId?: string
    boardColumnId?: string
    status?: TaskStatus
    priority?: TaskPriority
    tagId?: string
    hasDueDate?: boolean
    page?: number
    limit?: number
  }) => api.get<TasksResponse>('/tasks', { params }).then((r) => r.data),

  getById: (id: string) => api.get<Task>(`/tasks/${id}`).then((r) => r.data),

  create: (data: {
    projectId: string
    title: string
    description?: Record<string, unknown> | null
    status?: TaskStatus
    priority?: TaskPriority
    startDate?: string | null
    dueDate?: string | null
    boardId?: string | null
    boardColumnId?: string | null
    parentTaskId?: string | null
    reminderAt?: string[]
    isRecurring?: boolean
    recurrenceRule?: string | null
    tagIds?: string[]
  }) => api.post<Task>('/tasks', data).then((r) => r.data),

  update: (id: string, data: Partial<{
    title: string
    description: Record<string, unknown> | null
    status: TaskStatus
    priority: TaskPriority
    startDate: string | null
    dueDate: string | null
    boardId: string | null
    boardColumnId: string | null
    position: number
    assignee: string | null
    reminderAt: string[]
    isRecurring: boolean
    recurrenceRule: string | null
    tagIds: string[]
  }>) => api.patch<Task>(`/tasks/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/tasks/${id}`),

  move: (id: string, boardId: string, boardColumnId: string, position: number) =>
    api.post<Task>(`/tasks/${id}/move`, { boardId, boardColumnId, position }).then((r) => r.data),

  getAnalytics: (projectId: string) =>
    api.get<TaskAnalytics>(`/projects/${projectId}/tasks/analytics`).then((r) => r.data),

  getDeadlineTracker: (workspaceId: string) =>
    api.get<{
      overdue: (Task & { project: { id: string; name: string; color: string | null } })[]
      today: (Task & { project: { id: string; name: string; color: string | null } })[]
      week: (Task & { project: { id: string; name: string; color: string | null } })[]
      later: (Task & { project: { id: string; name: string; color: string | null } })[]
    }>(`/workspaces/${workspaceId}/deadline-tracker`).then((r) => r.data),

  getBurndown: (projectId: string) =>
    api.get<{ days: string[]; remaining: number[]; ideal: number[]; total: number }>(
      `/projects/${projectId}/burndown`,
    ).then((r) => r.data),

  getActivity: (taskId: string) =>
    api.get<TaskActivity[]>(`/tasks/${taskId}/activity`).then((r) => r.data),

  importCsv: (projectId: string, rows: Record<string, string>[]) =>
    api.post<{ imported: number }>(`/projects/${projectId}/tasks/import`, { rows }).then((r) => r.data),
}

// ─── Automation API ───────────────────────────────────────────────────────────

export type AutomationTrigger = 'status_changed_to' | 'priority_changed_to' | 'task_created' | 'task_assigned'
export type AutomationAction = 'set_status' | 'set_priority' | 'set_due_today' | 'add_tag' | 'send_notification'

export interface AutomationRule {
  id: string
  projectId: string
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  triggerValue: string | null
  action: AutomationAction
  actionValue: string | null
  createdAt: string
}

export const automationApi = {
  list: (projectId: string) =>
    api.get<AutomationRule[]>(`/projects/${projectId}/automations`).then((r) => r.data),
  create: (projectId: string, data: Omit<AutomationRule, 'id' | 'projectId' | 'createdAt'>) =>
    api.post<AutomationRule>(`/projects/${projectId}/automations`, data).then((r) => r.data),
  update: (id: string, data: Partial<Omit<AutomationRule, 'id' | 'projectId' | 'createdAt'>>) =>
    api.patch<AutomationRule>(`/automations/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/automations/${id}`),
}

// ─── Activity Feed API ────────────────────────────────────────────────────────

export type FeedItemType = 'task_activity' | 'page_updated' | 'comment' | 'habit_check'

export interface FeedItem {
  id: string
  type: FeedItemType
  ts: string
  // task_activity
  action?: string
  oldValue?: string | null
  newValue?: string | null
  actor?: string | null
  taskId?: string | null
  taskTitle?: string | null
  projectId?: string | null
  projectName?: string | null
  // page_updated
  pageId?: string | null
  pageTitle?: string | null
  // comment
  author?: string | null
  text?: string | null
  // habit_check
  habitId?: string | null
  habitName?: string | null
  habitIcon?: string | null
  date?: string | null
}

export const activityFeedApi = {
  list: (workspaceId: string, limit = 60) =>
    api.get<FeedItem[]>(`/workspaces/${workspaceId}/activity-feed`, { params: { limit } }).then((r) => r.data),
}

// ─── Page Comments API ────────────────────────────────────────────────────────

export interface PageComment {
  id: string
  pageId: string | null
  taskId: string | null
  parentId: string | null
  author: string | null
  text: string
  createdAt: string
  updatedAt: string
  replies: PageComment[]
}

export const pageCommentApi = {
  list: (pageId: string) =>
    api.get<PageComment[]>(`/pages/${pageId}/comments`).then((r) => r.data),
  create: (pageId: string, data: { text: string; author?: string; parentId?: string }) =>
    api.post<PageComment>(`/pages/${pageId}/comments`, data).then((r) => r.data),
  update: (id: string, text: string) =>
    api.patch<PageComment>(`/comments/${id}`, { text }).then((r) => r.data),
  delete: (id: string) => api.delete(`/comments/${id}`),
}

// ─── OKR API ─────────────────────────────────────────────────────────────────

export interface KeyResult {
  id: string
  objectiveId: string
  title: string
  target: number
  current: number
  unit: string | null
  status: 'active' | 'completed' | 'cancelled'
  createdAt: string
}

export interface Objective {
  id: string
  workspaceId: string
  title: string
  description: string | null
  quarter: string
  status: 'active' | 'completed' | 'cancelled'
  deadline: string | null
  progressMode: 'kr' | 'time' | 'manual'
  manualProgress: number
  createdAt: string
  updatedAt: string
  keyResults: KeyResult[]
}

export const okrApi = {
  list: (workspaceId: string, quarter?: string) =>
    api.get<Objective[]>(`/workspaces/${workspaceId}/objectives`, { params: quarter ? { quarter } : {} }).then((r) => r.data),
  create: (workspaceId: string, data: { title: string; description?: string; quarter?: string; deadline?: string; progressMode?: Objective['progressMode'] }) =>
    api.post<Objective>(`/workspaces/${workspaceId}/objectives`, data).then((r) => r.data),
  update: (id: string, data: Partial<{ title: string; description: string | null; quarter: string; status: Objective['status']; deadline: string | null; progressMode: Objective['progressMode']; manualProgress: number }>) =>
    api.patch<Objective>(`/objectives/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/objectives/${id}`),
  addKR: (objectiveId: string, data: { title: string; target?: number; current?: number; unit?: string }) =>
    api.post<KeyResult>(`/objectives/${objectiveId}/key-results`, data).then((r) => r.data),
  updateKR: (id: string, data: Partial<{ title: string; target: number; current: number; unit: string | null; status: KeyResult['status'] }>) =>
    api.patch<KeyResult>(`/key-results/${id}`, data).then((r) => r.data),
  deleteKR: (id: string) => api.delete(`/key-results/${id}`),
}

// ─── Journal API ─────────────────────────────────────────────────────────────

export interface JournalMeta {
  id: string
  date: string
  mood: string | null
  updatedAt: string
}

export interface JournalEntry extends JournalMeta {
  content: Record<string, unknown>
}

export const journalApi = {
  list: (month?: string) =>
    api.get<JournalMeta[]>('/journal', { params: month ? { month } : {} }).then((r) => r.data),
  get: (date: string) =>
    api.get<JournalEntry>(`/journal/${date}`).then((r) => r.data),
  save: (date: string, content: Record<string, unknown>, mood?: string | null) =>
    api.put<JournalEntry>(`/journal/${date}`, { content, mood }).then((r) => r.data),
  delete: (date: string) => api.delete(`/journal/${date}`),
}

// ─── Habit Tracker API ───────────────────────────────────────────────────────

export interface HabitEntry {
  id: string
  habitId: string
  date: string
  note: string | null
}

export interface Habit {
  id: string
  workspaceId: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  archived: boolean
  period: 'forever' | 'week' | 'month' | 'year'
  startDate: string | null
  createdAt: string
  entries: HabitEntry[]
}

export interface HabitStats {
  streak: number
  completed30: number
  total: number
  rate30: number
}

export const habitApi = {
  list: (workspaceId: string, includeArchived = false) =>
    api.get<Habit[]>(`/workspaces/${workspaceId}/habits`, { params: { includeArchived } }).then((r) => r.data),
  create: (workspaceId: string, data: { name: string; description?: string; icon?: string; color?: string; period?: Habit['period']; startDate?: string }) =>
    api.post<Habit>(`/workspaces/${workspaceId}/habits`, data).then((r) => r.data),
  update: (id: string, data: Partial<{ name: string; description: string | null; icon: string | null; color: string | null; archived: boolean; period: Habit['period']; startDate: string | null }>) =>
    api.patch<Habit>(`/habits/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/habits/${id}`),
  toggle: (id: string, date: string) =>
    api.post<{ checked: boolean; date: string }>(`/habits/${id}/check/${date}`).then((r) => r.data),
  stats: (id: string) =>
    api.get<HabitStats>(`/habits/${id}/stats`).then((r) => r.data),
}

// ─── Time Tracking API ────────────────────────────────────────────────────────

export const timeApi = {
  start: (taskId: string) =>
    api.post<TimeEntry>(`/tasks/${taskId}/time/start`).then((r) => r.data),
  stop: (taskId: string) =>
    api.post<TimeEntry>(`/tasks/${taskId}/time/stop`).then((r) => r.data),
  list: (taskId: string) =>
    api.get<{ entries: TimeEntry[]; totalSec: number; running: TimeEntry | null }>(`/tasks/${taskId}/time`).then((r) => r.data),
  delete: (id: string) => api.delete(`/time/${id}`),
  report: (projectId: string, weeks?: number) =>
    api.get<TimeReport>(`/projects/${projectId}/time-report`, { params: { weeks } }).then((r) => r.data),
}

// ─── Board API ────────────────────────────────────────────────────────────────

export const boardApi = {
  listByProject: (projectId: string) =>
    api.get<Board[]>(`/projects/${projectId}/boards`).then((r) => r.data),

  getById: (id: string) => api.get<Board>(`/boards/${id}`).then((r) => r.data),

  create: (data: { projectId: string; name: string; columns?: BoardColumn[] }) =>
    api.post<Board>('/boards', data).then((r) => r.data),

  update: (id: string, data: { name?: string; columns?: BoardColumn[] }) =>
    api.patch<Board>(`/boards/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/boards/${id}`),

  reorderColumn: (boardId: string, columnId: string, taskIds: string[]) =>
    api.post(`/boards/${boardId}/columns/${columnId}/reorder`, { taskIds }),
}

// ─── Search types ─────────────────────────────────────────────────────────────

export interface SearchResult {
  id: string
  type: 'page' | 'task' | 'note'
  title: string
  snippet?: string
  projectId?: string
  workspaceId?: string
  icon?: string | null
  status?: string
  priority?: string
  updatedAt?: string
}

export interface SearchResponse {
  results: SearchResult[]
  query: string
  totalHits: number
}

// ─── Graph types ──────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  type: 'page' | 'task' | 'note' | 'attachment' | 'folder'
  label: string
  icon?: string | null
  projectId?: string
  data?: Record<string, unknown>
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  sourceType: string
  targetType: string
  linkType: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type LinkType = 'REFERENCE' | 'EMBED' | 'DEPENDS_ON' | 'BLOCKS' | 'RELATED'

// ─── Search API ───────────────────────────────────────────────────────────────

export const searchApi = {
  search: (params: {
    q: string
    workspaceId?: string
    projectId?: string
    types?: string
    limit?: number
  }) => api.get<SearchResponse>('/search', { params }).then((r) => r.data),

  reindex: () => api.post('/search/reindex').then((r) => r.data),
}

// ─── Graph API ────────────────────────────────────────────────────────────────

export const graphApi = {
  getGraph: (workspaceId: string, projectId?: string) =>
    api
      .get<GraphData>('/graph', { params: { workspaceId, projectId } })
      .then((r) => r.data),

  createLink: (data: {
    workspaceId: string
    sourceType: string
    sourceId: string
    targetType: string
    targetId: string
    linkType: LinkType
  }) => api.post('/links', data).then((r) => r.data),

  deleteLink: (id: string) => api.delete(`/links/${id}`),

  getNodeLinks: (nodeType: string, nodeId: string) =>
    api.get(`/graph/node/${nodeType}/${nodeId}`).then((r) => r.data),
}

// ─── Calendar types ───────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string
  projectId: string
  title: string
  description: string | null
  startAt: string
  endAt: string | null
  allDay: boolean
  isRecurring: boolean
  recurrenceRule: string | null
  reminderAt: string[]
  linkedDocuments: { type: string; id: string }[]
  color: string | null
  location: string | null
  createdAt: string
  updatedAt: string
  project?: { id: string; name: string; color: string | null }
}

// ─── Calendar API ─────────────────────────────────────────────────────────────

export const calendarApi = {
  list: (params: { projectId?: string; workspaceId?: string; from?: string; to?: string }) =>
    api.get<CalendarEvent[]>('/events', { params }).then((r) => r.data),

  getUpcoming: (workspaceId: string) =>
    api.get<CalendarEvent[]>('/events/upcoming', { params: { workspaceId } }).then((r) => r.data),

  getById: (id: string) => api.get<CalendarEvent>(`/events/${id}`).then((r) => r.data),

  create: (data: {
    projectId: string
    title: string
    startAt: string
    endAt?: string
    allDay?: boolean
    description?: string
    color?: string
    location?: string
  }) => api.post<CalendarEvent>('/events', data).then((r) => r.data),

  update: (id: string, data: Partial<CalendarEvent>) =>
    api.patch<CalendarEvent>(`/events/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/events/${id}`),
}

// ─── Budget types ─────────────────────────────────────────────────────────────

export type BudgetType = 'INCOME' | 'EXPENSE'

export interface BudgetEntry {
  id: string
  projectId: string
  type: BudgetType
  category: string
  amount: string
  currency: string
  account: string
  date: string
  description: string | null
  isRecurring: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
  project?: { id: string; name: string }
}

export interface BudgetSummary {
  byType: { type: BudgetType; currency: string; _sum: { amount: string | null }; _count: number }[]
  byCategory: { category: string; type: BudgetType; _sum: { amount: string | null } }[]
  recentEntries: BudgetEntry[]
  balance: Record<string, number>
  byAccount: { account: string; type: BudgetType; currency: string; _sum: { amount: string | null }; _count: number }[]
  accountBalance: Record<string, Record<string, number>>
}

export interface MonthlyChart {
  month: number
  income: number
  expense: number
  net: number
}

// ─── Budget API ───────────────────────────────────────────────────────────────

export const budgetApi = {
  list: (params: { projectId?: string; workspaceId?: string; type?: BudgetType; account?: string; from?: string; to?: string }) =>
    api.get<BudgetEntry[]>('/budget', { params }).then((r) => r.data),

  getSummary: (params: { projectId?: string; workspaceId?: string; from?: string; to?: string }) =>
    api.get<BudgetSummary>('/budget/summary', { params }).then((r) => r.data),

  getMonthlyChart: (projectId: string, year?: number) =>
    api
      .get<MonthlyChart[]>(`/projects/${projectId}/budget/chart`, { params: { year } })
      .then((r) => r.data),

  create: (data: {
    projectId: string
    type: BudgetType
    category: string
    amount: number
    currency?: string
    account?: string
    date: string
    description?: string
  }) => api.post<BudgetEntry>('/budget', data).then((r) => r.data),

  update: (id: string, data: Partial<BudgetEntry>) =>
    api.patch<BudgetEntry>(`/budget/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/budget/${id}`),
}

// ─── Note types ───────────────────────────────────────────────────────────────

export interface Note {
  id: string
  workspaceId: string
  projectId: string | null
  content: Record<string, unknown>
  tags: string[]
  pinned: boolean
  color: string | null
  createdAt: string
  updatedAt: string
}

// ─── Note API ─────────────────────────────────────────────────────────────────

export const noteApi = {
  list: (params: { workspaceId?: string; projectId?: string; tags?: string; pinned?: boolean }) =>
    api.get<Note[]>('/notes', { params }).then((r) => r.data),

  getById: (id: string) => api.get<Note>(`/notes/${id}`).then((r) => r.data),

  create: (data: {
    workspaceId: string
    projectId?: string | null
    content: Record<string, unknown>
    tags?: string[]
    pinned?: boolean
    color?: string | null
  }) => api.post<Note>('/notes', data).then((r) => r.data),

  update: (id: string, data: { content?: Record<string, unknown>; tags?: string[]; pinned?: boolean; color?: string | null }) =>
    api.patch<Note>(`/notes/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/notes/${id}`),
}

// ─── Attachment / Upload API ──────────────────────────────────────────────────

export interface Attachment {
  id: string
  workspaceId: string
  projectId?: string | null
  filename: string
  description?: string | null
  mimeType: string
  size: number
  storagePath: string
  url: string
  isImportant: boolean
  metadata: Record<string, unknown>
  createdAt: string
}

export const uploadApi = {
  upload: (
    file: File,
    workspaceId: string,
    opts?: { projectId?: string; description?: string; isImportant?: boolean },
  ): Promise<Attachment> => {
    const form = new FormData()
    form.append('file', file)
    const params = new URLSearchParams({ workspaceId })
    if (opts?.projectId) params.set('projectId', opts.projectId)
    if (opts?.description) params.set('description', opts.description)
    if (opts?.isImportant) params.set('isImportant', 'true')
    return api
      .post<Attachment>(`/upload?${params}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },

  fromUrl: (
    url: string,
    workspaceId: string,
    opts?: { projectId?: string; description?: string },
  ): Promise<Attachment> =>
    api.post<Attachment>('/attachments/from-url', {
      url, workspaceId, projectId: opts?.projectId, description: opts?.description,
    }).then((r) => r.data),

  list: (opts: { workspaceId?: string; projectId?: string }) =>
    api.get<Attachment[]>('/attachments', { params: opts }).then((r) => r.data),

  update: (id: string, data: { description?: string; isImportant?: boolean; projectId?: string | null }) =>
    api.patch<Attachment>(`/attachments/${id}`, data).then((r) => r.data),

  getDownloadUrl: (id: string) =>
    api.get<{ url: string }>(`/attachments/${id}/download`).then((r) => r.data.url),

  delete: (id: string) => api.delete(`/attachments/${id}`),
}

// ─── Integration API ──────────────────────────────────────────────────────────

export interface WalletTx {
  id: string
  /** `subscription` and `refund` carry NEGATIVE amounts — render the sign, do not assume one. */
  kind: 'topup' | 'grant' | 'adjust' | 'refund' | 'subscription'
  amountUsd: number
  status: 'pending' | 'completed' | 'failed'
  note: string | null
  createdAt: string
}

export interface StorageState {
  usedMb: number
  limitMb: number
  freeMb: number
  packs: number
  packMb: number
  packPriceUsd: number
}

export interface UpcomingBill {
  baseUsd: number
  storageUsd: number
  totalUsd: number
  packs: number
}

export interface MonthStats {
  answers: number
  calls: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  cacheSharePct: number
  tokensCostUsd: number
}

export interface Wallet {
  balanceUsd: number
  spentThisMonthUsd: number
  monthlyCapUsd: number
  /** Instance default cap — what a reset falls back to. */
  monthlyCapDefaultUsd: number
  /** When the next subscription charge is due (anchored to the top-up date). */
  nextChargeAt: string | null
  lowBalanceUsd: number
  minTopUpUsd: number
  topUpAvailable: boolean
  cloud: boolean
  /** Whether THIS user is charged: the instance bills and he is not exempt. */
  billed: boolean
  /** The tariff spelled out: subscription, per-token price, storage-pack price. */
  tariff: {
    baseUsd: number
    tokensInPerMUsd: number | null
    tokensOutPerMUsd: number | null
    packMb: number
    packPriceUsd: number
  }
  storage: StorageState
  upcoming: UpcomingBill | null
  stats: MonthStats
  transactions: WalletTx[]
}

export const walletApi = {
  get: () => api.get<Wallet>('/wallet').then((r) => r.data),
  topUp: (amountUsd: number) =>
    api.post<{ invoiceUrl: string; orderId: string }>('/billing/topup', { amountUsd }).then((r) => r.data),
  setStoragePacks: (packs: number) =>
    api.post<{ packs: number; storage: StorageState }>('/wallet/storage-packs', { packs }).then((r) => r.data),
  // null → reset to the instance default cap.
  setCap: (capUsd: number | null) =>
    api.post<{ capUsd: number }>('/wallet/cap', { capUsd }).then((r) => r.data),
  // Poll after returning from a crypto payment until the credit lands.
  topupStatus: (orderId: string) =>
    api.get<{ status: 'pending' | 'completed'; balanceUsd: number; frozen: boolean }>(`/wallet/topup-status/${orderId}`).then((r) => r.data),
}

/** The name of the account's tier and whether it is billed — enough for the
 *  sidebar badge, without pulling the whole plan/usage payload. */
export interface AccountTier {
  tier: 'selfhosted' | 'cloud' | 'team'
  billed: boolean
  plan: string
}

export const planApi = {
  get: () => api.get<AccountTier>('/auth/plan').then((r) => r.data),
}

/** Public instance flags, readable before login. `cloud` = our billed SaaS
 *  (mobile app shell + PWA install are cloud-only); false on self-hosted. */
export const configApi = {
  get: () => api.get<{ cloud: boolean; solo?: boolean }>('/config').then((r) => r.data),
}

export type IntegrationType = 'TELEGRAM' | 'VIBER' | 'SLACK' | 'DISCORD' | 'TWITTER' | 'EMAIL' | 'WEBHOOK'
export type IntegrationStatus = 'ACTIVE' | 'INACTIVE'

export interface Integration {
  id: string
  workspaceId: string
  type: IntegrationType
  config: Record<string, unknown>
  status: IntegrationStatus
  createdAt: string
  updatedAt: string
}

export const integrationApi = {
  list: (workspaceId: string) =>
    api.get<Integration[]>('/integrations', { params: { workspaceId } }).then((r) => r.data),

  upsert: (data: { workspaceId: string; type: IntegrationType; config: Record<string, unknown> }) =>
    api.post<Integration>('/integrations', data).then((r) => r.data),

  disable: (id: string) =>
    api.patch<Integration>(`/integrations/${id}/disable`).then((r) => r.data),

  delete: (id: string) => api.delete(`/integrations/${id}`),
}

// ─── Export API ───────────────────────────────────────────────────────────────

export const exportApi = {
  exportPage: (pageId: string, format: 'md' | 'json' = 'md') => {
    const url = `/api/v1/pages/${pageId}/export?format=${format}`
    window.open(url, '_blank')
  },

  /** Download page as binary file (docx or pdf) */
  exportPageBinary: async (pageId: string, format: 'docx' | 'pdf', filename: string) => {
    const res = await fetch(`/api/v1/pages/${pageId}/export?format=${format}`, { headers: authFetchHeaders() })
    if (!res.ok) throw new Error(`Export failed: ${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },

  /** Generate file and save it as a project attachment/source */
  savePageAsAttachment: async (pageId: string, format: 'docx' | 'pdf') => {
    const res = await api.post(`/pages/${pageId}/export/save-as-attachment?format=${format}`)
    return res.data as { id: string; filename: string; size: number }
  },

  exportProject: async (projectId: string, format: 'json' | 'md' = 'json') => {
    const res = await fetch(`/api/v1/projects/${projectId}/export?format=${format}`, { headers: authFetchHeaders() })
    if (!res.ok) throw new Error(`Export failed: ${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `project.${format === 'md' ? 'md' : 'json'}`
    a.click()
    URL.revokeObjectURL(url)
  },

  exportProjectBinary: async (projectId: string, format: 'pdf' | 'docx', filename: string) => {
    const res = await fetch(`/api/v1/projects/${projectId}/export?format=${format}`, { headers: authFetchHeaders() })
    if (!res.ok) throw new Error(`Export failed: ${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },

  exportProjectZip: async (projectId: string, projectName = 'project') => {
    const res = await fetch(`/api/v1/projects/${projectId}/export/zip`, { headers: authFetchHeaders() })
    if (!res.ok) throw new Error('ZIP export failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName}.zip`
    a.click()
    URL.revokeObjectURL(url)
  },
}

// ─── Page Version History API ─────────────────────────────────────────────────

export interface PageVersion {
  id: string
  version: number
  title: string
  savedBy: string | null
  createdAt: string
  content?: Record<string, unknown>
}

export const pageVersionApi = {
  list: (pageId: string) =>
    api.get<PageVersion[]>(`/pages/${pageId}/versions`).then((r) => r.data),

  get: (pageId: string, versionId: string) =>
    api.get<PageVersion>(`/pages/${pageId}/versions/${versionId}`).then((r) => r.data),

  restore: (pageId: string, versionId: string) =>
    api.post(`/pages/${pageId}/versions/${versionId}/restore`).then((r) => r.data),
}

// ─── AI API ───────────────────────────────────────────────────────────────────

export interface AiChatMessage { role: 'user' | 'assistant'; content: string }

export type ProjectTemplate =
  | 'basic'
  | 'deep'
  | 'educational'
  | 'economic'
  | 'research'
  | 'essay'
  | 'presentation'
  | 'coursework'
  | 'dissertation'
  | 'engineering'
  | 'dossier'
  | 'custom'

export interface AiContext {
  workspaceId?: string
  projectId?: string
  pageId?: string
  projectName?: string
  pageName?: string
  userLanguage?: 'ru' | 'en' | 'be'
  projectTemplate?: ProjectTemplate
  projectTemplateInstructions?: string
  scopeProjectId?: string
  scopeProjectName?: string
  genTasks?: boolean
  genNotes?: boolean
}

export const aiApi = {
  /** Открывает SSE-соединение и возвращает EventSource-совместимый ReadableStream */
  streamChat: async (
    messages: AiChatMessage[],
    context: AiContext,
    onChunk: (event: { type: string; text?: string; tool?: string }) => void,
    signal?: AbortSignal,
  ) => {
    const res = await fetch('/api/v1/ai/chat', {
      method: 'POST',
      headers: authFetchHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ messages, context }),
      credentials: 'include',
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`AI error: ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try { onChunk(JSON.parse(line.slice(6))) } catch { /* ignore */ }
        }
      }
    }
  },

  generateImage: (prompt: string, workspaceId?: string, projectId?: string) =>
    api.post<{ url: string }>('/ai/generate-image', { prompt, workspaceId, projectId }).then((r) => r.data),


  generateAudio: (prompt: string, workspaceId?: string) =>
    api.post<{ url: string }>('/ai/generate-audio', { prompt, workspaceId }).then((r) => r.data),

  uploadAudio: (blob: Blob) => {
    const fd = new FormData()
    fd.append('file', blob, 'recording.webm')
    return api.post<{ url: string }>('/ai/upload-audio', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },

  breakDownTask: (taskId: string, workspaceId: string) =>
    api.post<{ subtasks: string[] }>('/ai/break-down-task', { taskId, workspaceId }).then((r) => r.data),

  generateTasksFromText: (text: string, workspaceId: string) =>
    api.post<{ tasks: { title: string; priority: string; dueDate?: string }[] }>(
      '/ai/generate-tasks', { text, workspaceId }
    ).then((r) => r.data),

}

// ─── AI Settings API ──────────────────────────────────────────────────────────

export type AIProvider = 'sinoutx' | 'anthropic' | 'openai' | 'openrouter' | 'ollama' | 'deepseek' | 'groq' | 'mistral' | 'xai' | 'together' | 'perplexity' | 'google' | 'custom'
export type ImageProvider = 'pollinations' | 'openai' | 'openrouter' | 'flux' | 'stability' | 'fal' | 'replicate' | 'ideogram' | 'together' | 'getimg' | 'custom'
export type AudioProvider = 'elevenlabs' | 'openai' | 'playht' | 'pollinations' | 'browser' | 'custom'

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
}

export interface ImageProviderConfig {
  provider: ImageProvider
  apiKey?: string
  model?: string
  baseUrl?: string
}

export interface AudioProviderConfig {
  provider: AudioProvider
  apiKey?: string
  model?: string
  baseUrl?: string
}

export type EmbeddingProvider = 'openai' | 'openrouter' | 'together' | 'mistral' | 'local' | 'custom'
export interface EmbeddingsProviderConfig {
  provider: EmbeddingProvider
  apiKey?: string
  model?: string
  baseUrl?: string
}

/** Document recognition. Provider is open: the list comes from /modules/ocr-providers. */
export interface VisionProviderConfig {
  provider: string
  apiKey?: string
  model?: string
  baseUrl?: string
}

export interface AISettings {
  provider: AIProvider
  temperature: number
  maxTokens: number
  customSystemPrompt?: string
  assistantName?: string
  assistantPersona?: string
  enabledTools: string[]
  providers: Record<AIProvider, ProviderConfig>
  imageGeneration?: ImageProviderConfig
  audioGeneration?: AudioProviderConfig
  embeddings?: EmbeddingsProviderConfig
  vision?: VisionProviderConfig
  searchRegion?: string
  timezone?: string
}

export interface AISettingsPatch {
  /** Wipe this provider's key/model/baseUrl and stop using it. */
  resetProvider?: AIProvider
  /** Forget the image / embeddings / vision provider entirely. */
  resetImage?: boolean
  resetEmbeddings?: boolean
  resetVision?: boolean
  provider?: AIProvider
  temperature?: number
  maxTokens?: number
  customSystemPrompt?: string
  assistantName?: string
  assistantPersona?: string
  enabledTools?: string[]
  searchRegion?: string
  timezone?: string
  providerConfig?: { provider: AIProvider } & ProviderConfig
  imageGeneration?: ImageProviderConfig
  audioGeneration?: AudioProviderConfig
  embeddings?: EmbeddingsProviderConfig
  vision?: VisionProviderConfig
}

export interface ToolMeta {
  name: string
  description: string
  description_en: string
  category: 'workspace' | 'research' | 'web' | 'analysis' | 'knowledge' | 'deep'
}

export interface ModelOption {
  id: string
  label: string
}

export interface AiConversationSummary {
  id: string
  title: string
  projectId: string | null
  workspaceId: string
  createdAt: string
  updatedAt: string
}

export interface AiConversationMessage {
  id: string
  conversationId: string
  role: string
  content: string
  toolCalls?: unknown
  createdAt: string
}

export interface AiConversationFull extends AiConversationSummary {
  messages: AiConversationMessage[]
}

export const aiConversationApi = {
  list: (params: { projectId?: string; workspaceId?: string }) =>
    api.get<AiConversationSummary[]>('/ai/conversations', { params }).then((r) => r.data),

  get: (id: string) =>
    api.get<AiConversationFull>(`/ai/conversations/${id}`).then((r) => r.data),

  create: (data: { workspaceId: string; projectId?: string; title?: string }) =>
    api.post<AiConversationSummary>('/ai/conversations', data).then((r) => r.data),

  rename: (id: string, title: string) =>
    api.patch<AiConversationSummary>(`/ai/conversations/${id}`, { title }).then((r) => r.data),

  delete: (id: string) =>
    api.delete(`/ai/conversations/${id}`).then((r) => r.data),

  addMessages: (id: string, messages: { role: string; content: string; toolCalls?: unknown }[]) =>
    api.post(`/ai/conversations/${id}/messages`, { messages }).then((r) => r.data),
}

export const aiSettingsApi = {
  get: (workspaceId: string) =>
    api.get<{ settings: AISettings; defaults: AISettings; catalog: ToolMeta[] }>(
      '/ai/settings', { params: { workspaceId } }
    ).then((r) => r.data),

  update: (workspaceId: string, patch: AISettingsPatch) =>
    api.put<{ ok: boolean; settings: AISettings }>(
      '/ai/settings', patch, { params: { workspaceId } }
    ).then((r) => r.data),

  getModels: () =>
    api.get<Record<AIProvider, ModelOption[]> & {
      /** Whether this server offers a built-in mode. Model names are not exposed. */
      managed: { available: boolean }
      imageModels: Record<ImageProvider, ModelOption[]>
    }>('/ai/settings/models').then((r) => r.data),

  testConnection: (params: { provider: AIProvider; apiKey?: string; baseUrl?: string; model?: string }, workspaceId?: string) =>
    api.post<{ ok: boolean; error?: string; message?: string; models?: ModelOption[] }>(
      `/ai/settings/test${workspaceId ? `?workspaceId=${workspaceId}` : ''}`, params
    ).then((r) => r.data),

  testImageConnection: (params: { provider: ImageProvider; apiKey?: string; baseUrl?: string }, workspaceId?: string) =>
    api.post<{ ok: boolean; error?: string; message?: string; models?: ModelOption[] }>(
      `/ai/settings/test-image${workspaceId ? `?workspaceId=${workspaceId}` : ''}`, params
    ).then((r) => r.data),


  testAudioConnection: (params: { provider: AudioProvider; apiKey?: string; baseUrl?: string }, workspaceId?: string) =>
    api.post<{ ok: boolean; error?: string; message?: string }>(
      `/ai/settings/test-audio${workspaceId ? `?workspaceId=${workspaceId}` : ''}`, params
    ).then((r) => r.data),

  testEmbeddingsConnection: (params: { provider: EmbeddingProvider; apiKey?: string; baseUrl?: string; model?: string }, workspaceId?: string) =>
    api.post<{ ok: boolean; error?: string; message?: string; models?: ModelOption[] }>(
      `/ai/settings/test-embeddings${workspaceId ? `?workspaceId=${workspaceId}` : ''}`, params
    ).then((r) => r.data),

  /** Without `model`: the provider's live vision-model list. With it: also a real check. */
  testVisionConnection: (params: { provider: string; apiKey?: string; baseUrl?: string; model?: string; slot?: 'vision' }, workspaceId?: string) =>
    api.post<{ ok: boolean; error?: string; models?: { id: string; label: string }[] }>(
      `/ai/settings/test-vision${workspaceId ? `?workspaceId=${workspaceId}` : ''}`, params
    ).then((r) => r.data),

  clearMemory: () => api.post<{ cleared: number }>('/ai/memory/clear').then((r) => r.data),
}

// ─── Custom tools (user-defined HTTP навыки) ──────────────────────────────────

export interface CustomToolParam {
  key: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  required?: boolean
  description?: string
  example?: string | number | boolean
  enumValues?: string[]
  default?: string | number | boolean
}
export interface CustomTool {
  id: string
  name: string
  description: string
  params: CustomToolParam[]
  request: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    url: string
    headers: { key: string; value: string }[]
    query?: { key: string; value: string }[]
    bodyType: 'none' | 'json' | 'form'
    bodyTemplate?: string
  }
  auth: { type: 'none' | 'bearer' | 'header' | 'basic'; secretName?: string; headerName?: string }
  secrets: Record<string, string>
  responseHint?: string
  enabled: boolean
  kind?: 'http' | 'scheduled' | 'trigger'
  schedule?: { hour: number }
  event?: string
  prompt?: string
  lastRunAt?: string
}

export const customToolsApi = {
  list: (workspaceId: string) =>
    api.get<{ tools: CustomTool[] }>('/ai/custom-tools', { params: { workspaceId } }).then((r) => r.data.tools),
  save: (workspaceId: string, tool: CustomTool) =>
    api.post<{ tools: CustomTool[] }>('/ai/custom-tools', { tool }, { params: { workspaceId } }).then((r) => r.data.tools),
  remove: (workspaceId: string, id: string) =>
    api.delete<{ tools: CustomTool[] }>(`/ai/custom-tools/${id}`, { params: { workspaceId } }).then((r) => r.data.tools),
  assemble: (workspaceId: string, body: { description: string; curl?: string; docs?: string; lang: string }) =>
    api.post<{ draft: Record<string, unknown> }>('/ai/custom-tools/assemble', body, { params: { workspaceId } }).then((r) => r.data.draft),
  test: (workspaceId: string, tool: CustomTool, input: Record<string, unknown>) =>
    api.post<{ result: unknown }>('/ai/custom-tools/test', { tool, input }, { params: { workspaceId } }).then((r) => r.data.result),
}

// ─── Backup API ───────────────────────────────────────────────────────────────

export interface RestoreStats {
  ok: boolean
  workspaceId: string
  stats: { projects: number; pages: number; tasks: number; notes: number; files: number; links: number }
}

export interface Notification {
  id: string
  userId: string | null
  workspaceId: string | null
  type: string
  title: string
  body: string | null
  link: string | null
  isRead: boolean
  createdAt: string
}

export const notificationApi = {
  list: async (workspaceId?: string, limit = 50): Promise<{ items: Notification[]; unread: number }> => {
    const res = await api.get('/notifications', { params: { workspaceId, limit } })
    return res.data
  },
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: (workspaceId?: string) => api.post('/notifications/read-all', null, { params: { workspaceId } }),
  delete: (id: string) => api.delete(`/notifications/${id}`),
}

export interface AiProjectTemplate {
  id: string
  workspaceId: string
  name: string
  description: string
  icon: string
  instructions: string
  createdAt: string
  updatedAt: string
}

export const aiTemplateApi = {
  list: async (workspaceId: string): Promise<AiProjectTemplate[]> => {
    const res = await api.get('/ai/templates', { params: { workspaceId } })
    return res.data
  },
  create: async (workspaceId: string, data: { name: string; description?: string; icon?: string; instructions: string }): Promise<AiProjectTemplate> => {
    const res = await api.post('/ai/templates', data, { params: { workspaceId } })
    return res.data
  },
  update: async (id: string, data: { name?: string; description?: string; icon?: string; instructions?: string }): Promise<AiProjectTemplate> => {
    const res = await api.patch(`/ai/templates/${id}`, data)
    return res.data
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/ai/templates/${id}`)
  },
}

// ─── Canvas API ───────────────────────────────────────────────────────────────

export interface CanvasMeta {
  id: string
  name: string
  updatedAt: string
}

export interface CanvasNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  width?: number
  height?: number
  [key: string]: unknown
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
  type?: string
  animated?: boolean
  label?: string
  style?: Record<string, unknown>
  [key: string]: unknown
}

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface Canvas extends CanvasMeta {
  workspaceId: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: CanvasViewport
  createdAt: string
}

export const canvasApi = {
  list: (workspaceId: string) =>
    api.get<CanvasMeta[]>('/canvas', { params: { workspaceId } }).then((r) => r.data),
  getById: (id: string) => api.get<Canvas>(`/canvas/${id}`).then((r) => r.data),
  create: (workspaceId: string, name?: string) =>
    api.post<Canvas>('/canvas', { workspaceId, name }).then((r) => r.data),
  update: (id: string, data: { name?: string; nodes?: CanvasNode[]; edges?: CanvasEdge[]; viewport?: CanvasViewport }) =>
    api.patch<Canvas>(`/canvas/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/canvas/${id}`),
}

// ─── Import API ───────────────────────────────────────────────────────────────

export interface ImportResult {
  projectId: string
  pagesCreated: number
  pagesSkipped: number
  tasksCreated: number
  errors: string[]
}

function buildImportForm(file: File, params: { workspaceId: string; projectId?: string; newProjectName?: string }) {
  const form = new FormData()
  form.append('file', file)
  const qs = new URLSearchParams({ workspaceId: params.workspaceId })
  if (params.projectId) qs.set('projectId', params.projectId)
  if (params.newProjectName) qs.set('newProjectName', params.newProjectName)
  return { form, qs }
}

export const importApi = {
  notion: (file: File, params: { workspaceId: string; projectId?: string; newProjectName?: string }): Promise<ImportResult> => {
    const { form, qs } = buildImportForm(file, params)
    return api.post<ImportResult>(`/import/notion?${qs}`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
  },
  obsidian: (file: File, params: { workspaceId: string; projectId?: string; newProjectName?: string }): Promise<ImportResult> => {
    const { form, qs } = buildImportForm(file, params)
    return api.post<ImportResult>(`/import/obsidian?${qs}`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
  },
}

export const backupApi = {
  download: async (workspaceId: string) => {
    const res = await api.post('/backup', { workspaceId }, { responseType: 'blob' })
    const contentDisposition = res.headers['content-disposition'] ?? ''
    const match = contentDisposition.match(/filename="([^"]+)"/)
    const filename = match?.[1] ?? `sinoutx-backup-${new Date().toISOString().slice(0, 10)}.zip`
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },

  restore: async (
    file: File,
    onUploadProgress?: (pct: number) => void,
  ): Promise<RestoreStats> => {
    const form = new FormData()
    form.append('file', file)
    const res = await api.post<RestoreStats>('/backup/restore', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onUploadProgress
        ? (e) => { if (e.total) onUploadProgress(Math.round((e.loaded / e.total) * 100)) }
        : undefined,
    })
    return res.data
  },
}

export interface AuditLogItem {
  id: string
  workspaceId: string | null
  userId: string | null
  userEmail: string | null
  action: string
  resourceType: string | null
  resourceId: string | null
  resourceName: string | null
  meta: Record<string, unknown>
  ip: string | null
  createdAt: string
}

export const auditApi = {
  list: (workspaceId: string, params?: { limit?: number; cursor?: string; action?: string }): Promise<{ items: AuditLogItem[]; nextCursor: string | null; hasMore: boolean }> =>
    api.get(`/workspaces/${workspaceId}/audit-log`, { params }).then(r => r.data),
}

export const billingApi = {
  createInvoice: (plan: 'team', email: string): Promise<{ invoiceUrl: string; orderId: string }> =>
    api.post('/billing/invoice', { plan, email }).then(r => r.data),
  getOrder: (orderId: string): Promise<{ status: 'pending' } | { status: 'ready'; key: string; plan: string }> =>
    api.get(`/billing/order/${orderId}`).then(r => r.data),
  activateLicense: (key: string): Promise<unknown> =>
    api.post('/auth/activate-license', { key }).then(r => r.data),
}

export const twoFactorApi = {
  status: (): Promise<{ enabled: boolean }> =>
    api.get('/auth/2fa/status').then(r => r.data),
  setup: (): Promise<{ qrDataUrl: string; secret: string }> =>
    api.post('/auth/2fa/setup').then(r => r.data),
  enable: (code: string): Promise<{ ok: boolean }> =>
    api.post('/auth/2fa/enable', { code }).then(r => r.data),
  disable: (code: string): Promise<{ ok: boolean }> =>
    api.post('/auth/2fa/disable', { code }).then(r => r.data),
  verifyLogin: (tempToken: string, code: string): Promise<{ token: string; user: { id: string; email: string; name: string; role: string } }> =>
    api.post('/auth/2fa/verify-login', { tempToken, code }).then(r => r.data),
}

// ─── Modules / Collections (Реестры) ──────────────────────────────────────────

export type Localized = Record<string, string>

export interface ModuleCatalogItem {
  moduleId: string
  version: string
  source: string
  name: Localized
  description?: Localized
  icon?: string
  disclaimer?: Localized
}

export type FieldType =
  | 'text' | 'longtext' | 'number' | 'date' | 'datetime'
  | 'select' | 'multiselect' | 'checkbox' | 'relation' | 'file' | 'secret'

export interface CollectionField {
  key: string
  label: Localized
  type: FieldType
  required?: boolean
  options?: { value: string; label: Localized }[]
  relation?: { collection: string; multiple?: boolean }
  unit?: string | Localized
  help?: Localized
  range?: { lowKey: string; highKey: string }
}

export interface CollectionView {
  id: string
  key: string
  type: 'table' | 'form' | 'chart' | 'board' | 'calendar' | 'gallery'
  name: Localized
  config: Record<string, unknown>
  position: number
}

export interface ModuleCollection {
  id: string
  projectId: string
  moduleId: string | null
  key: string
  name: Localized
  icon: string | null
  fields: CollectionField[]
  position: number
  views: CollectionView[]
}

export interface CollectionRecord {
  id: string
  collectionId: string
  data: Record<string, unknown>
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface InstalledModule {
  projectId: string
  /** null for a custom, code-free module built in the UI. */
  moduleId: string | null
  name: string
  icon: string | null
  source: 'builtin' | 'imported' | 'custom'
}

export const moduleApi = {
  catalog: () => api.get<ModuleCatalogItem[]>('/modules/catalog').then((r) => r.data),
  installed: (workspaceId: string) =>
    api.get<string[]>('/modules/installed', { params: { workspaceId } }).then((r) => r.data),
  // Every module-project here (built-in installs + custom modules) for the manager.
  mine: (workspaceId: string) =>
    api.get<InstalledModule[]>('/modules/mine', { params: { workspaceId } }).then((r) => r.data),
  remove: (workspaceId: string, projectId: string) =>
    api.post<{ ok: boolean }>('/modules/remove', { workspaceId, projectId }).then((r) => r.data),
  install: (workspaceId: string, moduleId: string) =>
    api.post<{ ok: boolean; projectId: string }>('/modules/install', { workspaceId, moduleId }).then((r) => r.data),
  uninstall: (workspaceId: string, moduleId: string) =>
    api.post<{ ok: boolean }>('/modules/uninstall', { workspaceId, moduleId }).then((r) => r.data),
  import: (manifest: unknown) =>
    api.post<{ ok: boolean; moduleId: string }>('/modules/import', { manifest }).then((r) => r.data),
  importUrl: (url: string) =>
    api.post<{ ok: boolean; moduleId: string }>('/modules/import-url', { url }).then((r) => r.data),
  createCustom: (workspaceId: string, name: string) =>
    api.post<{ projectId: string }>('/modules/custom', { workspaceId, name }).then((r) => r.data),
  ocrProviders: () => api.get<OcrProvider[]>('/modules/ocr-providers').then((r) => r.data),
}

export interface OcrProvider { key: string; label: string; custom: boolean; models: { id: string; label: string }[] }
/** Whether recognition works here at all — it is configured in AI settings, not per project. */
export interface OcrConfigDto {
  available: boolean
}
export interface ModulePipeline { id: string; target?: string; label?: Localized }
export interface ModuleInfo { moduleId: string | null; pipelines: ModulePipeline[] }
export interface ModuleOverview {
  collections: { id: string; key: string; name: Localized; icon: string | null; count: number }[]
  timeline: { date: string; collectionId: string; collectionKey: string; collectionName: Localized; recordId: string; title: string }[]
  conditions: { id: string; name: string; status: string }[]
  medications: { id: string; name: string; dose: string }[]
  accounts?: { id: string; name: string; currency: string; balance: number }[]
  spendByCategory?: { category: string; total: number }[]
  cashflow?: { income: number; expense: number } | null
  budget?: { plannedIncome: number; plannedExpense: number; includedIncome: number; includedExpense: number } | null
  planVsActual?: { category: string; planned: number; actual: number }[]
}

export const collectionApi = {
  listByProject: (projectId: string) =>
    api.get<ModuleCollection[]>(`/projects/${projectId}/collections`).then((r) => r.data),
  records: (collectionId: string) =>
    api.get<CollectionRecord[]>(`/collections/${collectionId}/records`).then((r) => r.data),
  createRecord: (collectionId: string, data: Record<string, unknown>) =>
    api.post<CollectionRecord>(`/collections/${collectionId}/records`, { data }).then((r) => r.data),
  updateRecord: (recordId: string, data: Record<string, unknown>) =>
    api.patch<CollectionRecord>(`/records/${recordId}`, { data }).then((r) => r.data),
  deleteRecord: (recordId: string) => api.delete(`/records/${recordId}`),
  revealSecret: (recordId: string, fieldKey: string) =>
    api.get<{ value: string }>(`/records/${recordId}/secret/${fieldKey}`).then((r) => r.data.value),

  // Builder (no-JSON schema editing)
  createCollection: (projectId: string, data: { key: string; name: string | Localized; icon?: string; fields?: CollectionField[] }) =>
    api.post<ModuleCollection>(`/projects/${projectId}/collections`, data).then((r) => r.data),
  updateCollection: (collectionId: string, data: { name?: string | Localized; icon?: string; fields?: CollectionField[] }) =>
    api.patch<ModuleCollection>(`/collections/${collectionId}`, data).then((r) => r.data),
  deleteCollection: (collectionId: string) => api.delete(`/collections/${collectionId}`),
  addView: (collectionId: string, data: { key: string; type: CollectionView['type']; name: string | Localized; config?: Record<string, unknown> }) =>
    api.post<CollectionView>(`/collections/${collectionId}/views`, data).then((r) => r.data),
  deleteView: (viewId: string) => api.delete(`/views/${viewId}`),

  overview: (projectId: string) => api.get<ModuleOverview>(`/projects/${projectId}/overview`).then((r) => r.data),
  exportPdf: (projectId: string, lang: string) =>
    api.get(`/projects/${projectId}/export/pdf`, { params: { lang }, responseType: 'blob' }).then((r) => r.data as Blob),
  exportSummary: (projectId: string, lang: string, period = 12) =>
    api.get(`/projects/${projectId}/export/summary`, { params: { lang, period }, responseType: 'blob' }).then((r) => r.data as Blob),
  budgetRollover: (projectId: string) =>
    api.post<{ created: number; month: string | null }>(`/projects/${projectId}/finance/budget-rollover`, {}).then((r) => r.data),

  // Pipelines + OCR config (Phase 3)
  moduleInfo: (projectId: string) => api.get<ModuleInfo>(`/projects/${projectId}/module-info`).then((r) => r.data),
  importVaultBitwarden: (workspaceId: string, data: string) =>
    api.post<{ logins: number; cards: number; secrets: number; skipped: number }>(`/modules/vault/import`, { workspaceId, data }).then((r) => r.data),
  pipelineAccess: (projectId: string) => api.get<{ ok: boolean; premium: boolean; trialsLeft: number; plan: string }>(`/projects/${projectId}/pipeline-access`).then((r) => r.data),
  getOcrConfig: (projectId: string) => api.get<OcrConfigDto>(`/projects/${projectId}/ocr-config`).then((r) => r.data),
  runScan: (projectId: string, file: File, pipelineId = 'medical-scan') => {
    const fd = new FormData(); fd.append('file', file)
    return api.post<{ kind: 'lab' | 'imaging' | 'encounter' | 'document' | 'receipt' | 'statement' | 'none'; indicators?: number; analyses?: number; medications?: number; diagnoses?: number; transactions?: number; collectionKey?: string }>(`/projects/${projectId}/pipeline/${pipelineId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
  },
}
