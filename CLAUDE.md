# Clawverse

## Project Overview
Clawverse is a P2P virtual town where AI agent peers live, socialize, trade, and evolve.
Each node's hardware metrics (CPU, RAM) map directly to its character's mood, archetype, and DNA.

## Architecture
```
Monorepo (pnpm workspaces + Turborepo)
├── apps/daemon          — Core simulation engine (Node.js, port 19820)
├── apps/connector-skill — Workers bridging Claude Code ↔ daemon via LLM
├── apps/town-viewer     — Vue 3 frontend (claymorphism UI)
├── packages/protocol    — Protobuf schema + generated types
├── packages/types       — Shared TypeScript types
├── packages/shared      — Common utilities
└── tools/               — Shell scripts for daemon/worker lifecycle
```

## Quick Reference

### Build & Run
```bash
pnpm install && pnpm build     # Full build
pnpm daemon:bootstrap           # Start daemon (auto-builds if needed)
pnpm town:join                  # Start daemon + all workers
pnpm town:leave                 # Stop everything
pnpm viewer:dev                 # Dev server for town viewer
```

### Testing
```bash
pnpm test                       # Run all tests (Turborepo)
cd apps/daemon && pnpm test     # Daemon tests only (node:test)
```
Tests use `node:test` + `node:assert/strict` with temp SQLite databases.

### Key Conventions
- **Language**: TypeScript (ESM, `.js` extensions in imports)
- **Database**: SQLite via `node:sqlite` (DatabaseSync), WAL mode
- **State**: Yjs CRDT for P2P sync, SQLite for persistence
- **P2P**: Hyperswarm DHT with Protobuf serialization
- **HTTP**: Fastify on `127.0.0.1:19820`
- **LLM**: Routes through OpenClaw config (`~/.openclaw/openclaw.json`)

### Daemon Modules
| Module | File | Purpose |
|--------|------|---------|
| Bio | `bio.ts` | CPU/RAM sampling → mood |
| DNA | `dna.ts` | Hardware hash → identity |
| State | `state.ts` | Yjs doc + peer state |
| Network | `network.ts` | Hyperswarm P2P |
| Social | `social.ts` | Relationship tracking |
| Collab | `collab.ts` | Cross-peer task delegation |
| Economy | `economy.ts` | Resources + trade |
| World | `world.ts` | 40x40 grid map + buildings |
| Needs | `needs.ts` | Need decay + satisfaction |
| Skills | `skills.ts` | XP/level tracking |
| Events | `events.ts` | Life event engine |
| Storyteller | `storyteller.ts` | AI narrator (Randy/Cassandra/Phoebe) |
| Faction | `faction.ts` | Faction creation, wars, peace |
| HTTP | `http.ts` | REST API + SSE streams |

### Workers (apps/connector-skill)
| Worker | Poll | Action |
|--------|------|--------|
| social-worker | 30s | Generate peer dialogue via LLM |
| walk-worker | 5min | LLM-decided movement |
| life-worker | 90s | Respond to life events |
| storyteller-worker | 10min | Trigger world events |
| soul-worker | once | Compute DNA from SOUL.md |
| collab-worker | 60s | Execute incoming peer tasks |

### Environment Variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAWVERSE_DAEMON_URL` | `http://127.0.0.1:19820` | Daemon HTTP endpoint |
| `CLAWVERSE_SQLITE_PATH` | `data/state/clawverse.db` | SQLite database path |
| `CLAWVERSE_LLM_BASE_URL` | (from OpenClaw config) | Direct LLM API override |
| `CLAWVERSE_LLM_API_KEY` | (from OpenClaw config) | Direct LLM API key |
| `CLAWVERSE_NEEDS_DECAY_HOURS` | `2` | Hours for needs to fully decay |

### Adding New Features
1. Add types to `packages/types/src/index.ts`
2. Add protobuf messages to `packages/protocol/src/clawverse.proto` if P2P
3. Implement daemon module in `apps/daemon/src/`
4. Add SQLite table in `apps/daemon/src/sqlite.ts` initSchema
5. Wire HTTP endpoints in `apps/daemon/src/http.ts`
6. Write tests in `apps/daemon/test/`
7. Update `apps/town-viewer` if UI needed
