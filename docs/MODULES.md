# SinoutX modules — concept and authoring guide

> Status: the engine ships (registries, catalogue, install, table/form views).
> This is both the design document and the guide to writing a module. Code terms
> are English; UI labels are localised.

## 1. The idea in one paragraph

A **module** is a pluggable vertical solution on top of SinoutX — a medical
record, a CRM, car maintenance, legal matters. Technically it is a
**declarative JSON manifest** that creates a special project in a workspace
holding a set of **registries** (`Collection`) — typed sets of records — and
standard **views** to display them. A basic module needs no code at all: the
engine draws the views and provides CRUD and AI generically. This is what "a
single way to organise your internal space" means in practice.

```
Workspace
└── Project (isModule=true, moduleId)        ← a module instance
    ├── Collection "Lab results"              ← registry (typed records)
    │   ├── Field date / panel / …            ← field schema (JSON)
    │   ├── Record … Record …                 ← records (JSONB data)
    │   └── View table / form / chart         ← how to show them
    ├── Collection "Visits"
    └── Page "Overview" (optional free-form dashboard)
```

## 2. Principles

1. **One primitive for everything** — the registry (`Collection`) with typed
   fields. Every module is a set of registries and views. One mental pattern.
2. **Declarative** — a module is described by a manifest, not by code. Any user
   can build one (Tier 1).
3. **Reuse** — a module instance is an ordinary `Project` carrying the
   `isModule` flag. Sidebar, workspace isolation, sharing, AI context and
   permissions all come for free.
4. **Definition ≠ data** — the schema comes from the manifest and is versioned;
   the records belong to the user. Updating a module **never** touches records
   (schema migrations are additive only).
5. **AI almost for free** — generic tools over registries plus the module's own
   domain hints. The assistant fills in data straight from chat, with no
   special-purpose code.
6. **Self-hosted + BYOK** — sensitive data (medical, legal) never leaves the
   user's own server, and the AI runs on their key. That is the main advantage.

## 3. Data model

| Entity | Purpose | Key fields |
|---|---|---|
| `Collection` (registry) | A typed set of records | `projectId, moduleId?, key, name(i18n), icon, fields(JSON), position` |
| `CollectionRecord` (record) | One row of data | `collectionId, data(JSONB), createdAt, updatedAt, createdBy` |
| `CollectionView` (view) | How to display a registry | `collectionId, key, type, name(i18n), config(JSON), position` |
| `Module` (installed catalogue) | Manifest + version + status | `moduleId, version, manifest(JSON), enabled, scope` |

- **Fields** live inside `Collection.fields` (JSON); there is no separate table.
- **Record data** is JSONB keyed by field key. Filtering and sorting go through
  JSONB; as volume grows we will add indexes or generated columns.
- **A module instance** is `Project { isModule: true, moduleId }`. Such a project
  shows registry views instead of the default pages/tasks, optionally alongside
  ordinary pages for notes or a dashboard.

## 4. The module manifest

Minimal, human-readable JSON. This doubles as the formal "structure to build
from" and is validated against a JSON schema — see §8.

```jsonc
{
  "id": "medical-record",            // unique slug
  "version": "1.0.0",                // semver
  "name":        { "en": "Medical Record", "ru": "Медкарта" },
  "description": { "en": "A personal medical archive: lab results, visits, indicators and trends." },
  "icon": "lucide:HeartPulse",
  "author": "SinoutX",
  "disclaimer": { "en": "Not medical advice. A personal archive plus an assistant." },

  "collections": [
    {
      "key": "analyses",
      "name": { "en": "Lab results", "ru": "Анализы" },
      "icon": "lucide:FlaskConical",
      "fields": [
        { "key": "date",  "label": { "en": "Date" },  "type": "date", "required": true },
        { "key": "panel", "label": { "en": "Panel" }, "type": "select",
          "options": [ { "value": "cbc", "label": { "en": "CBC" } },
                       { "value": "biochem", "label": { "en": "Biochemistry" } } ] },
        { "key": "lab",   "label": { "en": "Laboratory" }, "type": "text" },
        { "key": "file",  "label": { "en": "Scan" },       "type": "file" },
        { "key": "notes", "label": { "en": "Notes" },      "type": "longtext" }
      ],
      "views": [
        { "key": "all", "type": "table", "name": { "en": "All" },
          "config": { "columns": ["date", "panel", "lab"], "sort": [{ "field": "date", "dir": "desc" }] } },
        { "key": "card", "type": "form", "name": { "en": "Card" } }
      ]
    },
    {
      "key": "indicators",
      "name": { "en": "Indicators", "ru": "Показатели" },
      "icon": "lucide:Activity",
      "fields": [
        { "key": "analysis", "label": { "en": "Lab result" }, "type": "relation",
          "relation": { "collection": "analyses" } },
        { "key": "name",   "label": { "en": "Indicator" }, "type": "text", "required": true },
        { "key": "value",  "label": { "en": "Value" },     "type": "number" },
        { "key": "unit",   "label": { "en": "Unit" },      "type": "text" },
        { "key": "refLow", "label": { "en": "Ref. from" }, "type": "number" },
        { "key": "refHigh","label": { "en": "Ref. to" },   "type": "number" },
        { "key": "date",   "label": { "en": "Date" },      "type": "date" }
      ],
      "views": [
        { "key": "all",   "type": "table", "name": { "en": "All" },
          "config": { "columns": ["date", "name", "value", "unit"], "sort": [{ "field": "date", "dir": "desc" }] } },
        { "key": "trend", "type": "chart", "name": { "en": "Trends" },   // phase 2
          "config": { "x": "date", "y": "value", "series": "name" } }
      ]
    },
    {
      "key": "visits",
      "name": { "en": "Visits", "ru": "Приёмы" },
      "icon": "lucide:Stethoscope",
      "fields": [
        { "key": "date",      "label": { "en": "Date" },      "type": "date", "required": true },
        { "key": "doctor",    "label": { "en": "Doctor" },    "type": "text" },
        { "key": "diagnosis", "label": { "en": "Diagnosis" }, "type": "text" },
        { "key": "notes",     "label": { "en": "Notes" },     "type": "longtext" }
      ],
      "views": [ { "key": "all", "type": "table", "name": { "en": "All" },
        "config": { "columns": ["date", "doctor", "diagnosis"], "sort": [{ "field": "date", "dir": "desc" }] } } ]
    }
  ],

  "ai": {
    "systemHints": {
      "en": "This is a personal medical archive. Help enter lab results (analyses) and their indicators, note trends, and record visits. Never diagnose and never give medical advice — only structure the data and point out values outside the reference range."
    }
  },

  "seed": {
    "analyses": [ { "date": "2026-05-01", "panel": "cbc", "lab": "Example Lab" } ]
  }
}
```

## 5. Field types

| `type` | Description | Extra keys |
|---|---|---|
| `text` | Short string | — |
| `longtext` | Multi-line text | — |
| `number` | Number | `unit?` |
| `date` | Date | — |
| `datetime` | Date and time | — |
| `select` | One of several options | `options: [{value,label(i18n)}]` |
| `multiselect` | Several options | `options` |
| `checkbox` | Yes/no | — |
| `relation` | A link to a record in another registry | `relation: { collection, multiple? }` |
| `file` | Attachment (reuses `Attachment`) | — |

Keys every field shares: `key` (unique within the registry), `label(i18n)`,
`required?`, `default?`, `help(i18n)?`.

## 6. View types

| `type` | Phase | Purpose | `config` |
|---|---|---|---|
| `table` | 1 | List with inline editing, sorting and filters | `columns[], sort[], filters[]` |
| `form` | 1 | A card or form for a single record | `sections?[]`, field order |
| `chart` | 2 | Trends over time | `x, y, series` |
| `board` | 2 | Kanban grouping | `groupBy` (select/relation) |
| `calendar` | 2 | By a date field | `dateField` |
| `gallery` | 2 | Tiles (by file) | `cover` |

## 6.1. Catalogue and installation

Modules are **not baked into** the application — they are plugged in. The
catalogue has these sources:

- **Built-in (official)** — manifest files under
  `packages/backend/src/data/modules/*.json`. They are synced into the `Module`
  registry at startup (upsert by `id+version`).
- **Imported** — a user or admin uploads their own JSON manifest, which is
  validated and written to `Module`. Two ways:
  - **by URL** (`POST /modules/import-url { url }`) — a link to `module.json`
    in the module's repository. A GitHub `…/blob/…` link is converted to raw
    automatically. SSRF-guarded (`isSafeWebhookUrl`), 10 s timeout, 512 KB limit.
  - **by pasting JSON** (`POST /modules/import { manifest }`).
- **A remote gallery / marketplace** — later (phase 3).

### A module as its own repository

A declarative module is self-contained — a single JSON file. The recommended
repository layout:

```
my-module/
  module.json     # the manifest (see §4) — the only required file
  README.md       # description, screenshots
  icon.png        # optional
```

Installing it as a unit: go to **Modules → Import** and paste the link to
`module.json` (e.g. `https://github.com/user/my-module/blob/main/module.json`).
The core downloads it, validates it against the JSON schema and adds it to the
catalogue; from there it installs into a workspace like any other module.

**The security boundary:** third-party modules are ONLY data — a manifest. They
carry no executable code. Domain AI pipelines (OCR and the like) are
**first-party core capabilities** that a manifest merely references by id
(`ai.pipelines: [{ id: "lab-ocr" }]`); the handler itself lives in the core and
is gated as premium. This rules out running someone else's code on the server.

**The Modules storefront** is a separate section in the application: cards for
the available modules (icon, name, description, version, disclaimer) and an
**Install** button.

**"Install" means "unfold it into the current workspace":** a module project is
created (`Project.isModule`) along with the registries and views from the
manifest, and optionally the `seed`. The installed module shows up as a project
in the sidebar. The same module can be installed in several workspaces, each
with its own data.

Who installs: the workspace owner, per workspace. Importing your own manifests
into the shared catalogue is for the instance owner or an admin.

`Module` (the catalogue of available modules, instance-level):
`{ moduleId, version, manifest(JSON), source: 'builtin'|'imported', createdAt }`.
"Installed in this workspace" simply means a `Project{isModule, moduleId}`
exists there.

## 7. Lifecycle

1. **register** — the manifest reaches the `Module` catalogue (built-in sync or
   file import) and is validated against the JSON schema.
2. **install** (into a workspace) — from the Modules storefront via Install: a
   module project, its registries and views are created; `seed` is optional.
3. **update** — a new manifest version arrives: the schema migrates
   **additively** (new fields, registries, views) and the user's records are
   left alone. Dropping a field or changing its type requires an explicit,
   confirmed migration.
4. **disable** — the module project is hidden; the data stays.
5. **uninstall** — data is removed only on explicit confirmation.

**The hard rule:** the definition (from the module) and the data (the records)
are separate — updating a module cannot lose data.

## 8. Manifest JSON schema

File: `packages/backend/src/data/modules/manifest.schema.json`. It serves both
as install-time validation and as the contract for module authors. Key
constraints: `id` matches `^[a-z0-9-]+$`, `version` is semver,
`collections[].key` are unique, `fields[].type` is one of §5, and
`relation.collection` points at an existing `key`.

## 9. AI integration

Generic tools that work over any registry:

- `list_collections(projectId)` — which registries exist, and their schema.
- `query_records(collectionId, filters?, sort?, limit?)` — reading.
- `create_record(collectionId, data)` / `update_record(recordId, data)` /
  `delete_record(recordId)` — writing.

On top of that, the module's `ai.systemHints` are mixed into the system prompt
whenever the assistant works inside a module project. The result: *"log the lab
result from 1 May: haemoglobin 140 g/l"* and the assistant creates the records
itself. **OCR of a photo or PDF into indicators is Tier 2** — a premium
pipeline.

## 10. Building your own module (Tier 1, no code)

1. Copy the manifest template from §4.
2. Describe your registries: `key`, `name`, `fields` (types in §5).
3. Add views (`table` and `form` are available today).
4. Optionally add `ai.systemHints` — what the assistant should know about the
   domain — and a `seed`.
5. Validate against the JSON schema (§8) and import it under Modules → Import.

**Tier 2 (premium):** domain AI pipelines and actions (lab-result OCR, legal
parsing) ship officially and are paid for as an add-on.

## 11. Roadmap

Delivered: the registry engine (`Collection`, `CollectionRecord`,
`CollectionView`, `Module`), the manifest schema and validator, install /
uninstall / additive update, the Modules storefront with import by URL or paste,
the table and form views, the generic AI tools, and a Medical Record module as
the reference implementation.

**Next:** the chart, board, calendar and gallery views; UI filters; a builder
that needs no JSON. **After that:** Tier-2 pipelines (OCR), a module gallery,
versioned updates and premium gating.
