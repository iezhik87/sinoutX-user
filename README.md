<div align="center">

# SinoutX

**The self-hosted second brain your AI can write to**

*Every other AI notebook lets an assistant read your notes. This one lets it keep your
medical record, your finances and your password vault — as typed data it fills in from a
photo, a voice note or a message in Telegram. Your server, your API keys, no markup on
tokens, and it plugs into Claude over MCP as long-term memory.*

[![License: FSL-1.1-MIT](https://img.shields.io/badge/License-FSL--1.1--MIT-purple.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)](packages/backend)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](packages/frontend)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](packages/backend/prisma)

**[See it in action →](https://sinout.dasp.top)** — screenshots and video of the app,
the modules and the assistant in Telegram, before you install anything.

</div>

---

## What is SinoutX?

> **Personal edition (`sinoutX-user`).** This is the single-user, self-hosted build: one person, no admin panel, no billing or cloud, no team/sharing. It ships with `SINOUT_EDITION=solo`. Same product core as the full SinoutX — updates flow from upstream.

SinoutX is a **self-hosted** workspace built around an assistant that *acts*. Write to it in the app, in Telegram or in Viber — it captures notes and tasks, recognizes documents and receipts, tracks calories and balances, searches the web and files everything into the right place. It is proactive: it sends morning briefs, reminds you, reacts to events and sets up its own recurring skills.

The part nobody else has is the **modules**. A module is not a folder of notes — it is a
set of typed registries the assistant fills in: lab results with reference ranges, blood
pressure and weight over time, prescriptions and doctor visits; accounts, transactions,
budgets and receipts read straight off a photo; passwords and cards encrypted at rest,
which the assistant can find for you but never reads back into a chat. Underneath sits a
full workspace — block editor, projects and tasks, knowledge graph, semantic search,
real-time collaboration — but that part you can get elsewhere.

You bring your own AI keys. Requests go straight to the provider you chose, with no markup on tokens and no vendor lock-in. An external agent (Claude Desktop, for example) can use the workspace as long-term memory over MCP.

> **Status: young and actively developed.** It runs in production and is used
> daily, but it is not a decade-old product — expect rough edges, and expect
> things to change between versions. Database migrations run on deploy; read the
> commit log before a big jump.
>
> What does not change: **your data stays yours and leaves whole.** Settings →
> Backup exports the entire workspace — every module, file and note — and the
> password Vault travels too, re-encrypted under a passphrase only you know. If
> this project ever stops, the self-hosted edition you already have keeps
> running on your own server, for free. Nothing here holds you hostage.
>
> Found something broken? Open an issue — at this stage a single report changes
> what gets built next.

### What it looks like

A module is not a folder of notes — it is a typed registry the assistant writes into.
Tell it what you spent and it files the row; hand it a receipt and it reads the numbers
off the photo.

![Finance module: accounts, monthly income and expenses, spending by category and a
budget with planned-versus-actual columns](docs/img/finance.jpg)

Every request runs on **your** provider key. There is no markup on tokens and no
middleman holding your data — pick a provider, paste the key, set the parameters.

![Settings, AI tab: DeepSeek selected as the language model with the API key, base URL,
a connection test and generation parameters](docs/img/byok.jpg)

### Why SinoutX?

| | Notion | Obsidian | SinoutX |
|---|---|---|---|
| Self-hosted | ❌ | ✅ | ✅ |
| Assistant that writes to your data | ❌ | ❌ | ✅ |
| Assistant in a messenger | ❌ | ❌ | ✅ Telegram + Viber |
| Web search + deep research | ❌ | ❌ | ✅ own SearXNG |
| Pluggable vertical modules | ❌ | ❌ | ✅ |
| Encrypted password vault | ❌ | ❌ | ✅ |
| MCP server for external agents | ❌ | ❌ | ✅ |
| Rich block editor | ✅ | ❌ | ✅ |
| Project management | ✅ | ❌ | ✅ |
| Knowledge graph | ❌ | ✅ | ✅ |
| Real-time collaboration | ✅ | ❌ | ✅ |
| Import from Notion / Obsidian | ❌ | partial | ✅ both |
| Multilingual UI | partial | partial | ✅ RU / EN / BE |
| Docker one-command | ❌ | ❌ | ✅ |

---

## Key Features

### 🤖 The assistant

- Lives in the **app, Telegram and Viber** — the same assistant, another channel
- **75+ tools**: projects, pages, tasks, events, notes, budget, registries, memory, graph, export
- **Proactive**: morning briefs, reminders, event triggers, and skills it schedules for itself
- Recognizes **photos and PDFs** (lab results, receipts), transcribes **voice messages**
- Long-term **memory** that survives a restarted conversation
- **BYOK** — your provider key, your model, no token markup

### 🌐 Web research

- Searches the web through the instance's own **SearXNG** (aggregates Google, Bing, DuckDuckGo)
- Reads the pages it finds and saves them as **linked sources**
- `deep_research` spans the web, Wikipedia and academic papers on top of your own base
- Project templates that *execute*: course work, dissertation, research, essay — structure, sources and pages included

### 🧩 Modules & registries

A module scaffolds a set of typed **registries** (Collections) with views and hints for the assistant. Install in one click.

| Module | What it holds |
|---|---|
| **Medical Record** | Labs, indicators with reference ranges, vitals, nutrition with calories and macros, visits, medications. Document OCR, PDF export. |
| **Finance** | Accounts, transactions, budget. Currency exchange at your own rate. Receipt OCR. |
| **Vault** | Passwords, cards, secrets. Encrypted at rest, masked in the UI, hidden from search and from the assistant's memory. Bitwarden import. |
| **Memory** | The assistant's long-term memory: core, facts, entities, episodes. |
| **Personal Growth** | Habits, OKR goals, journal. |

Field types: `text`, `longtext`, `number`, `date`, `datetime`, `select`, `multiselect`, `checkbox`, `relation`, `file`, `secret`.
Views: `table`, `form`, `chart`, `board`, `calendar`, `gallery`. Custom modules load from a manifest.

### 🛠️ Skills & custom tools

- The assistant **schedules its own skills** — a morning brief, a weekly finance report
- Any **HTTP API** becomes a tool it can call, usually assembled by the AI from your description
- Secrets encrypted, requests guarded against SSRF, with a timeout

### 🔒 Code sandbox

`execute_code` runs Python or bash in a **separate container**, never inside the backend. Two of them: one on an isolated network, one with internet access for admins only.

### 📄 Pages, tasks, search

- Block editor: 30+ block types, nested pages, version history, `md` / `docx` / `pdf` / `zip` export
- **Real-time collaboration** (Yjs) with live co-author cursors; share a project as Viewer or Editor
- Tasks: kanban, Gantt, burndown, time tracker, subtasks, recurrence, reminders
- Search in two layers: **Meilisearch** full-text plus a **semantic layer on embeddings**
- Knowledge graph and an infinite idea canvas

### ⚙️ Instance

- **Monitoring**: who is online, CPU / memory / network / disks, history and alerts
- **Backup**: user ZIP export and a scheduled full-instance backup
- **Import**: Notion ZIP (Markdown or HTML), Obsidian vault ZIP
- Themes: Dark, Light, Glass, HUD, Latte, Dawn · Languages: RU / EN / BE
- 2FA (TOTP), brute-force lockout, per-key REST API, Pomodoro timer, meeting transcription

---

## Architecture

```
            Browser · Telegram · Viber · Claude Desktop (MCP)
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │           Nginx  :8090         │
                    │         reverse proxy          │
                    └──┬───────┬────────┬────────┬───┘
                       │       │        │        │
          ┌────────────▼──┐ ┌──▼─────┐ ┌▼──────┐ │
          │ REST API      │ │ Collab │ │ MCP   │ │
          │ Fastify :3010 │ │ Yjs/WS │ │ :3011 │ │
          │               │ │ :3012  │ │       │ │
          └──┬────────────┘ └────────┘ └───────┘ │
             │                                    ▼
             │                            React SPA (nginx)
  ┌──────────┼───────────┬──────────────┬──────────────┐
  ▼          ▼           ▼              ▼              ▼
PostgreSQL Redis    Meilisearch       MinIO         SearXNG
 (data)  (cache,RT) (full-text)      (files)     (web search)

        faster-whisper          executor · executor-net
        (voice → text)     (code sandbox: isolated / online)
```

Only **nginx** publishes ports. Everything else talks over the internal Docker network, and `executor` sits on a network with no route out at all.

### Monorepo structure

```
sinout/
├── packages/
│   ├── backend/          # Fastify 5 + Prisma + TypeScript
│   │   ├── prisma/       # Schema & migrations
│   │   └── src/
│   │       ├── modules/  # auth, page, task, ai, collections, integration, admin, …
│   │       ├── lib/      # plans & capabilities, modules engine, crypto, cron, search
│   │       └── data/     # module manifests (medical-record, finance, vault, …)
│   ├── frontend/         # React 18 + Vite + Tailwind + TipTap
│   ├── collab-server/    # Yjs WebSocket server (Hocuspocus)
│   └── mcp-server/       # Model Context Protocol server (61 sinout_* tools)
├── executor/             # Sandbox container for execute_code
├── searxng/              # Private metasearch config
├── nginx/                # Reverse proxy config
├── scripts/              # Deployment helpers
└── docker-compose.yml
```

---

## Quick Start

### Prerequisites

- Docker + Docker Compose
- Git — the first step below clones the repository. Windows does not ship
  it: `winget install --id Git.Git -e`, then reopen the terminal so `git`
  lands in `PATH`. macOS: `xcode-select --install`. Most Linux distros
  already have it. (No Git? See «Without Git» after step 1.)
- 4 GB RAM (8 GB recommended — Meilisearch, SearXNG, Whisper and the
  embedder are hungry). The embedder can be turned off with
  `EMBEDDINGS_LOCAL_OFF=true` if memory is tight; semantic recall then
  needs an external provider or does nothing.

> **Windows / macOS:** this is memory *allocated to Docker Desktop* (Settings →
> Resources), not your total system RAM — Docker Desktop runs in its own VM/WSL2
> with its own cap, often left at a low default. Below ~4 GB, the frontend's
> production build can fail with `JavaScript heap out of memory` mid-install.

### 1. Clone

```bash
git clone https://github.com/iezhik87/sinoutX-user.git
cd sinoutX-user
```

**Without Git.** The app itself never uses Git, so an archive works too:
download the ZIP from the repository page (Code → Download ZIP) and unpack
it. The catch is updates — `deploy.sh` pulls with Git, so an archive install
has to be updated by hand. Installing Git is the easier path.

### 2. Configure

```bash
cp .env.example .env
nano .env
```

Required variables:

```env
# Database
DB_USER=sinout
DB_PASSWORD=your_strong_password

# Redis
REDIS_PASSWORD=your_redis_password

# Meilisearch
MEILI_KEY=your_meili_key_min_16_chars

# MinIO (file storage)
MINIO_USER=sinout
MINIO_PASSWORD=your_minio_password

# JWT (min 32 chars)
JWT_SECRET=your_very_long_random_jwt_secret

# Encrypts Vault secrets at rest — required, and back it up separately
ENCRYPTION_KEY=your_32_byte_random_key

# MCP gateway key (per-user API keys work too)
MCP_API_KEY=your_mcp_key

# App URL (CORS and links)
CORS_ORIGIN=http://localhost:8090
APP_URL=http://localhost:8090
```

> ⚠️ **`ENCRYPTION_KEY` protects the Vault.** Lose it and the secrets are gone —
> a backup restores the records but cannot decrypt the values. Keep it somewhere
> other than the archives.

Optional: `SMTP_*` (password reset, email verification).

### 3. Start

```bash
docker compose up -d
```

### 4. Open

Navigate to **http://localhost:8090**.

You land on a sign-in screen. Press **Create account** and register — the
instance does nothing until an account exists, and there is no seeded login.

The first registered user becomes the **owner** — every capability unlocked. After that, registration is **closed** (this is a single-user edition), so no one else can sign up.

Add your AI provider key in **Settings → AI** to switch the assistant on.

> **Reinstalling?** `docker compose down` leaves the database volume in place, so
> the next start finds the old account and refuses to register a new one. To begin
> from nothing, bring it down with `docker compose down -v` — the `-v` is what
> removes the data.

---

## AI Providers

Bring your own key; the model is picked per user. Requests go straight to the provider.

| Provider | |
|---|---|
| `anthropic` | Claude |
| `openai` | GPT |
| `google` | Gemini |
| `deepseek` | DeepSeek |
| `groq` | Groq |
| `mistral` | Mistral |
| `openrouter` | anything behind OpenRouter |
| `ollama` | local models, no key needed |

Every provider accepts a custom **Base URL**, so any OpenAI-compatible endpoint plugs in — a local LM Studio, your own proxy, a self-hosted gateway.

### Capability gating

Some tools sit behind a capability. As the sole owner you bypass all of them — they matter only on the multi-user / cloud edition.

| Capability | Unlocks |
|---|---|
| `assistant_full` | Proactivity: scheduled skills, triggers |
| `code_exec:python` | Python in the sandbox |
| `code_exec:bash` | Bash |
| `code_exec:net` | Sandbox with internet access — admins only |
| `vault:reveal` | The assistant may fetch and show a secret value |

---

## MCP Integration with Claude

SinoutX ships a built-in **MCP server** (Streamable HTTP transport) so an external agent can read and write your workspace as long-term memory. It is exposed at the `/mcp` path — e.g. `https://app.your-domain.tld/mcp`.

### Setup in Claude Desktop

Claude Desktop connects to remote HTTP MCP servers through the official [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge:

```json
{
  "mcpServers": {
    "sinout": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://app.your-domain.tld/mcp",
        "--header", "x-api-key:sk_sinoutx_your_key_here"
      ]
    }
  }
}
```

Create the key under **Settings → API Keys**, paste it into the header, restart Claude Desktop. The endpoint **rejects requests without a valid key** (`401`), and a key can be scoped to specific workspaces.

### Available MCP tools

**61 tools** across workspaces, projects, pages, tasks, notes, calendar, budget, registries, memory, graph, search and file upload. A sample:

| Tool | Description |
|---|---|
| `sinout_init_agent` | Pull instructions and registries so the agent knows where things belong |
| `sinout_search` | Search everything — by keyword and by meaning |
| `sinout_create_page` / `sinout_update_page` | Write pages |
| `sinout_create_task` / `sinout_update_task` | Manage tasks |
| `sinout_list_collections` / `sinout_query_records` | Read module registries |
| `sinout_create_records` / `sinout_delete_records` | Batch writes (up to 200 / 500) |
| `sinout_remember` / `sinout_recall` | Long-term memory |
| `sinout_get_graph` | The knowledge graph |

---

## Development

```bash
npm install
docker compose -f docker-compose.dev.yml up -d   # infra only
npm run dev --workspace=backend
npm run dev --workspace=frontend
```

Useful:

```bash
npm run build --workspace=frontend     # typecheck + build
npx prisma migrate dev                 # new migration (from packages/backend)
npx prisma studio                      # inspect the database
```

In production the frontend is **nginx serving a pre-built bundle**, not a dev server — any frontend change needs an image rebuild.

---

## Deployment

See [DEPLOY.md](DEPLOY.md) for the full walkthrough (domain, TLS, reverse proxy).

---

## Roadmap

- [x] Notion import (ZIP — HTML or Markdown) and Obsidian vault import
- [x] Two-factor authentication (TOTP)
- [x] Public REST API with scoped keys
- [x] Per-project sharing (Viewer / Editor) + audit log
- [x] Semantic search on embeddings
- [x] Per-key auth enforced on the MCP endpoint
- [x] Telegram assistant: photos, PDFs, voice, buttons, proactive briefs
- [x] Pluggable modules: Medical Record, Finance, Vault, Memory, Personal Growth
- [x] Sandboxed code execution + capability gating
- [x] Viber as a second messenger channel
- [ ] Combo skills, and external MCP servers as a skill source
- [ ] Mobile app (React Native)
- [ ] Offline-first mode (PWA)
- [ ] SSO / LDAP / SAML
- [ ] Google Calendar sync

> WhatsApp was evaluated and **dropped**. Its Business API forbids free-form
> outbound messages outside a 24-hour window, which kills the proactive briefs
> and reminders the assistant is built on. It also blocks message deletion (no
> Vault retrieval) and message editing (no live progress indicator).

---

## License

SinoutX is **source-available** under the [Functional Source License (FSL-1.1-MIT)](LICENSE).

**Free** for:
- Personal use
- Internal use within your organization
- Non-commercial education and research
- Self-hosting for your own team

**Requires a commercial license** for:
- Offering SinoutX (or a substantially similar product) to others as a
  commercial product or hosted service
- White-label / reselling
- Managed hosting of SinoutX for third parties

Each released version automatically converts to the **MIT License two
years after its release date** (the FSL "Grant of Future License").

For a commercial / Team license, managed hosting, or enterprise terms,
contact **sinout@dasp.top**, or join the community chat on Telegram: https://t.me/sinoutX

Bug reports and questions are welcome there — it is the fastest way to reach us.
