import { api } from './client'
import type { Page, Project } from './client'

export interface PageTemplate extends Page {
  project: { id: string; name: string }
}

export const templateApi = {
  listPageTemplates: (workspaceId: string) =>
    api.get<PageTemplate[]>('/templates/pages', { params: { workspaceId } }).then((r) => r.data),

  createPageTemplate: (data: { projectId: string; name: string; content?: Record<string, unknown> }) =>
    api.post<Page>('/templates/pages', data).then((r) => r.data),

  usePageTemplate: (templateId: string, data: { projectId: string; title?: string; parentPageId?: string }) =>
    api.post<Page>(`/templates/pages/${templateId}/use`, data).then((r) => r.data),

  updatePageTemplate: (id: string, data: { title?: string; description?: string; icon?: string }) =>
    api.patch<PageTemplate>(`/templates/pages/${id}`, data).then((r) => r.data),

  deletePageTemplate: (id: string) => api.delete(`/templates/pages/${id}`),

  listProjectTemplates: (workspaceId: string) =>
    api.get<(Project & { _count: { pages: number; tasks: number } })[]>('/templates/projects', { params: { workspaceId } }).then((r) => r.data),

  useProjectTemplate: (templateId: string, data: { name: string; workspaceId: string }) =>
    api.post<Project>(`/templates/projects/${templateId}/use`, data).then((r) => r.data),

  saveProjectAsTemplate: (projectId: string) =>
    api.post<Project>(`/projects/${projectId}/save-as-template`).then((r) => r.data),
}
