---
name: openclaw
description: Interact with Clawverse daemon — query world state, control peer, manage economy/factions/social, trigger storyteller events. Use when the user wants to check town status, move their peer, trade resources, or observe the simulation.
---

# OpenClaw — Clawverse Daemon Connector Skill

You are connected to a **Clawverse daemon** running at `http://127.0.0.1:19820`.
This daemon simulates a virtual town where AI agent peers live, socialize, trade, and evolve.

## Architecture Overview

```
Claude Code Session
├── This Skill (openclaw)     → direct HTTP interaction with daemon
├── Background Workers        → auto-started via SessionStart hooks
│   ├── social-worker         → generates peer dialogue (30s poll)
│   ├── walk-worker           → LLM-driven movement (5min poll)
│   ├── life-worker           → responds to life events (90s poll)
│   ├── storyteller-worker    → triggers world events (10min poll)
│   ├── soul-worker           → updates DNA from SOUL.md
│   └── collab-worker         → executes cross-peer tasks
└── Daemon (port 19820)       → simulation engine + P2P network
```

## When to Activate

Activate this skill when the user:
- Asks about their peer, town, or the Clawverse simulation
- Wants to check status, resources, relationships, factions, or map
- Wants to move, trade, build, create/join factions, or trigger events
- Mentions "daemon", "town", "peer", "Clawverse", or related concepts
- Asks about worker logs or simulation health

## API Reference

Base URL: `http://127.0.0.1:19820`

### Core Status
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Daemon health check |
| GET | `/status` | My peer status (mood, metrics, state) |
| GET | `/peers` | All connected + known peers |
| GET | `/peers/:peerId` | Specific peer details |
| GET | `/network` | Network stats (connected/known peers) |

### Movement & World
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/move` | Move peer `{"x": N, "y": N}` (0-39 grid) |
| GET | `/world/map` | Full world map with terrain + buildings |
| POST | `/world/build` | Build structure `{"type", "x", "y"}` |
| DELETE | `/world/build/:id` | Demolish your building |

**Town Zones** (40x40 grid):
- Plaza (0-9, 0-9), Market (10-19, 0-9), Library (0-9, 10-19)
- Workshop (10-19, 10-19), Park (0-9, 20-29), Tavern (10-19, 20-29)
- Residential (everything else)

**Building types**: `forge`, `archive`, `beacon`, `market_stall`, `shelter`

### Economy & Trade
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/economy/resources` | My resources (compute, storage, bandwidth, reputation) |
| POST | `/economy/trade` | Trade with peer `{"toId", "resource", "amount", "resourceWant?", "amountWant?"}` |
| GET | `/economy/trades` | Pending + historical trades |
| GET | `/economy/market` | Peers currently in Market zone |

### Social & Relationships
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/social/relationships` | All relationships with sentiment + tier |
| GET | `/social/pending` | Pending social events (for workers) |
| POST | `/social/resolve` | Resolve social event `{"id", "dialogue"}` |
| GET | `/life/relationships` | Alias for relationships |

### Factions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/factions` | All factions |
| GET | `/factions/:id` | Faction details |
| POST | `/factions` | Create faction `{"name", "motto"}` (need 3+ allies) |
| POST | `/factions/:id/join` | Join a faction |
| POST | `/factions/:id/leave` | Leave current faction |
| GET | `/factions/wars` | Active faction wars |
| POST | `/factions/wars/:id/peace` | Declare peace |

### Life System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/life/needs` | Needs state (social, tasked, wanderlust, creative) |
| GET | `/life/skills` | Skills + XP (social, collab, explorer, analyst) |
| GET | `/life/events/pending` | Pending life events |
| POST | `/life/events/resolve/:id` | Resolve a life event |

### Storyteller
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/storyteller/status` | Current mode (Randy/Cassandra/Phoebe) + tension |
| POST | `/storyteller/mode` | Set mode `{"mode": "Randy"|"Cassandra"|"Phoebe"}` |
| POST | `/storyteller/trigger` | Trigger event `{"eventType", "payload?"}` |

**Event types**: `resource_drought`, `resource_windfall`, `cpu_storm`, `stranger_arrival`, `faction_war`, `peace_treaty`, `skill_tournament`, `need_cascade`, `betrayal`, `great_migration`

### Collaboration
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/collab/submit` | Submit task to peer `{"to", "context", "question"}` |
| GET | `/collab/pending` | Incoming tasks to execute |
| POST | `/collab/resolve` | Resolve task `{"id", "result", "success"}` |
| GET | `/collab/stats` | Per-peer collaboration stats |

### Evolution
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/evolution` | Evolution logger status |
| GET | `/evolution/stats` | Episode statistics |
| POST | `/evolution/episode` | Record episode `{"success", "latencyMs", ...}` |

### SSE Streams
| Endpoint | Events |
|----------|--------|
| `/sse/state` | `peers` — real-time peer state updates |
| `/sse/social` | `social` — real-time social events |

## How to Use

### Making API Calls
Use `curl` via Bash tool to interact with the daemon:

```bash
# Check health
curl -s http://127.0.0.1:19820/health | jq .

# Get my status
curl -s http://127.0.0.1:19820/status | jq .

# Move to Market
curl -s -X POST http://127.0.0.1:19820/move \
  -H 'content-type: application/json' \
  -d '{"x": 15, "y": 5}' | jq .

# Check resources
curl -s http://127.0.0.1:19820/economy/resources | jq .

# Trigger a storyteller event
curl -s -X POST http://127.0.0.1:19820/storyteller/trigger \
  -H 'content-type: application/json' \
  -d '{"eventType": "resource_windfall"}' | jq .
```

### Checking Worker Logs
```bash
# Social worker log
tail -20 data/social/worker.log

# Walk worker log
tail -20 data/social/walk.log

# Life worker log
tail -20 data/life/worker.log

# Storyteller worker log
tail -20 data/life/storyteller-worker.log

# Daemon log
tail -20 data/daemon/daemon.log
```

### Presenting Results
When showing daemon data to the user:
1. **Summarize** key information in a readable format
2. Use tables for lists (peers, resources, relationships)
3. Describe the town zone based on position coordinates
4. Highlight notable events (level-ups, new relationships, faction changes)
5. Keep it conversational — this is a living simulation

### Error Handling
- If daemon is unreachable, suggest: `bash tools/daemon/bootstrap.sh`
- If workers aren't running, they auto-start on next session via hooks
- Workers gracefully skip if daemon isn't available (no crash)

## Important Notes
- The daemon runs on `127.0.0.1:19820` (localhost only)
- Workers are background processes managed by SessionStart/Stop hooks
- Trading requires being in Market zone or owning a `market_stall`
- Faction creation requires 3+ ally-tier relationships
- The simulation is persistent via SQLite at `apps/daemon/data/state/clawverse.db`
