import { MeiliSearch } from 'meilisearch'
import { config } from '../config/index.js'

export const meili = new MeiliSearch({
  host: config.MEILI_URL,
  apiKey: config.MEILI_KEY,
})

// Индексы
export const INDEX_PAGES = 'pages'
export const INDEX_TASKS = 'tasks'
export const INDEX_NOTES = 'notes'

async function ensureIndex(uid: string, primaryKey: string) {
  try {
    await meili.createIndex(uid, { primaryKey })
  } catch {
    // index already exists — ignore
  }
  return meili.index(uid)
}

export async function setupMeiliIndexes() {
  // Pages index
  const pagesIdx = await ensureIndex(INDEX_PAGES, 'id')
  await pagesIdx.updateSettings({
    searchableAttributes: ['title', 'textContent'],
    filterableAttributes: ['projectId', 'workspaceId', 'isDeleted'],
    sortableAttributes: ['updatedAt'],
    displayedAttributes: ['id', 'title', 'textContent', 'projectId', 'workspaceId', 'icon', 'updatedAt'],
  })

  // Tasks index
  const tasksIdx = await ensureIndex(INDEX_TASKS, 'id')
  await tasksIdx.updateSettings({
    searchableAttributes: ['title'],
    filterableAttributes: ['projectId', 'status', 'priority', 'isDeleted'],
    sortableAttributes: ['updatedAt', 'dueDate'],
    displayedAttributes: ['id', 'title', 'projectId', 'status', 'priority', 'dueDate', 'updatedAt'],
  })

  // Notes index
  const notesIdx = await ensureIndex(INDEX_NOTES, 'id')
  await notesIdx.updateSettings({
    searchableAttributes: ['textContent'],
    filterableAttributes: ['workspaceId', 'projectId'],
    sortableAttributes: ['updatedAt'],
    displayedAttributes: ['id', 'textContent', 'workspaceId', 'projectId', 'updatedAt'],
  })
}

/** Извлечь plain-text из TipTap JSON */
export function extractText(doc: Record<string, unknown>): string {
  const parts: string[] = []

  function walk(node: Record<string, unknown>) {
    if (node.type === 'text' && typeof node.text === 'string') {
      parts.push(node.text)
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content as Record<string, unknown>[]) {
        walk(child)
      }
    }
  }

  walk(doc)
  return parts.join(' ')
}
