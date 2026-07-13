import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as api from '../client.js'

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })

// Trim a collection to the essentials an agent needs (id, key, name, field schema).
const slim = (c: any) => ({ id: c.id, key: c.key, name: c.name, icon: c.icon, fields: c.fields, projectId: c.projectId })

export function registerCollectionTools(server: McpServer) {
  // List registries (collections) of a module — by project, or aggregated across a workspace.
  server.tool(
    'sinout_list_collections',
    'List collections (реестры — typed datasets) of installed modules, e.g. Medical Record measurements/medications or Finance transactions. Pass projectId for one module project, or workspaceId to list across all module projects. Each collection returns its field schema (use those field keys when creating records).',
    {
      projectId: z.string().optional().describe('Module project ID (from sinout_list_projects, has a moduleId)'),
      workspaceId: z.string().optional().describe('Workspace ID — aggregate collections across all module projects'),
    },
    async ({ projectId, workspaceId }) => {
      if (projectId) {
        const cols = await api.collections.listByProject(projectId)
        return ok((cols as any[]).map(slim))
      }
      if (workspaceId) {
        const projects = (await api.projects.listByWorkspace(workspaceId)) as any[]
        const modProjects = projects.filter((p) => p.isModule || p.moduleId)
        const out: any[] = []
        for (const p of modProjects) {
          const cols = (await api.collections.listByProject(p.id)) as any[]
          out.push({ projectId: p.id, projectName: p.name, moduleId: p.moduleId, collections: cols.map(slim) })
        }
        return ok(out)
      }
      throw new Error('Provide projectId or workspaceId')
    },
  )

  // Read records of a collection.
  server.tool(
    'sinout_query_records',
    'Read records of a collection (реестр) — e.g. blood-pressure measurements, lab results, finance transactions. Get collectionId from sinout_list_collections.',
    {
      collectionId: z.string().describe('Collection ID from sinout_list_collections'),
    },
    async ({ collectionId }) => ok(await api.collections.records(collectionId)),
  )

  // Create a record.
  server.tool(
    'sinout_create_record',
    'Add a record to a collection (реестр) — e.g. log a blood-pressure measurement into Medical Record, or a transaction into Finance. The `data` keys must match the collection field keys from sinout_list_collections (the `fields` schema). Numbers as numbers, dates as ISO (YYYY-MM-DD).',
    {
      collectionId: z.string().describe('Target collection ID'),
      data: z.record(z.string(), z.any()).describe('Record fields, keyed by the collection field keys (e.g. {"systolic":120,"diastolic":80,"date":"2026-06-26"})'),
    },
    async ({ collectionId, data }) => ok(await api.collections.createRecord(collectionId, data)),
  )

  // Bulk create records — one call instead of N.
  server.tool(
    'sinout_create_records',
    'Bulk-add MANY records to a collection in ONE call (much faster than calling sinout_create_record repeatedly, and easier on the session). Each item is a record whose keys match the collection field keys. Up to 200 items.',
    {
      collectionId: z.string().describe('Target collection ID'),
      items: z.array(z.record(z.string(), z.any())).min(1).max(200).describe('Array of record-data objects, each keyed by the collection field keys'),
    },
    async ({ collectionId, items }) => ok(await api.collections.createRecordsBatch(collectionId, items)),
  )

  // Bulk delete records — one call instead of N (great for de-duplication / cleanup).
  server.tool(
    'sinout_delete_records',
    'Bulk-delete MANY records by their IDs in ONE call (use for de-duplication or cleanup instead of calling sinout_delete_record N times). Up to 500 IDs. Returns the count deleted.',
    {
      ids: z.array(z.string()).min(1).max(500).describe('Record IDs to delete (from sinout_query_records)'),
    },
    async ({ ids }) => ok(await api.collections.deleteRecordsBatch(ids)),
  )

  // Update a record (replaces its data).
  server.tool(
    'sinout_update_record',
    'Replace the data of an existing collection record. Get recordId from sinout_query_records. Pass the FULL new data object (it replaces the old one).',
    {
      recordId: z.string().describe('Record ID from sinout_query_records'),
      data: z.record(z.string(), z.any()).describe('Full new record data (replaces existing)'),
    },
    async ({ recordId, data }) => ok(await api.collections.updateRecord(recordId, data)),
  )

  // Delete a record.
  server.tool(
    'sinout_delete_record',
    'Delete a record from a collection (реестр) by its ID.',
    {
      recordId: z.string().describe('Record ID from sinout_query_records'),
    },
    async ({ recordId }) => {
      await api.collections.deleteRecord(recordId)
      return ok({ deleted: recordId })
    },
  )
}
