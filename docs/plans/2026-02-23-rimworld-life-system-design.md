# RimWorld-inspired Agent Life System — Design

Date: 2026-02-23

## Summary

Add a four-layer agent life simulation to Clawverse, inspired by RimWorld's colonist model. Each node develops needs, skills, and layered relationships, with an event engine driving emergent story. A new `life-worker` uses `claude --print` to decide how the agent responds to critical events.

---

## Architecture

```
Daemon
├── NeedsSystem       Decays needs per heartbeat, emits need_critical events
├── SkillsTracker     Records XP per activity, emits skill_levelup events
├── EventEngine       Aggregates pending events; exposes /life/events/pending
└── SocialSystem      Extended with RelationshipTier + interactionCount

HTTP (new)
├── GET  /life/needs
├── GET  /life/skills
├── GET  /life/events/pending
├── POST /life/events/resolve/:id
└── GET  /life/relationships

Connector-Skill
└── life-worker.ts    Polls pending events → claude --print → executes action
```

**Data files:**
- `data/life/needs.json` — persisted needs state
- `data/life/skills.json` — persisted skills + XP
- `data/life/events.jsonl` — audit log of all life events
- `data/social/relationships.json` — extended schema (tier, interactionCount, notableEvents)

**Implementation order (strictly sequential):**
1. NeedsSystem
2. SkillsTracker
3. RelationshipTiers (extend SocialSystem)
4. EventEngine
5. life-worker

---

## System 1: NeedsSystem

Four needs, each 0–100, initialized at 80.

| Need | Satisfied by | Amount | Critical threshold |
|------|-------------|--------|--------------------|
| `social` | social event resolve | +20 | < 15 |
| `tasked` | collab task success | +30 | < 15 |
| `wanderlust` | successful move to new cell | +25 | < 15 |
| `creative` | evolution cycle complete | +15 | < 15 |

**Decay rate:** 100 → 0 in 2 hours by default (`CLAWVERSE_NEEDS_DECAY_HOURS`, default 2).
At 5s heartbeat: `100 / (7200 / 5) ≈ 0.069` per tick.

**Mood interaction (additive on existing CPU/RAM mood):**
- 1 need < 30 → mood drops one level
- 2+ needs < 15 → mood forced to `distressed`
- All needs > 60 → mood can rise one level

**Public API:**
```typescript
tick(): void
satisfy(need: NeedKey, amount: number): void
getNeeds(): NeedsState
getActiveEvents(): NeedEvent[]
```

**Ally bonus:** satisfying a need via interaction with an `ally` grants +50% amount.

**Persistence:** written to `data/life/needs.json` via async queue on each tick.

---

## System 2: SkillsTracker

Four skills, each with cumulative XP and level 1–5.

| Skill | XP sources |
|-------|-----------|
| `social` | social event resolve success: +2 XP |
| `collab` | collab task success: +5 XP; attempt: +1 XP |
| `explorer` | move to new zone: +3 XP; repeat cell: +1 XP |
| `analyst` | evolution cycle complete: +10 XP |

**Level thresholds (cumulative XP):** 50 / 150 / 350 / 700 / 1200

**On level-up:**
1. Emit `skill_levelup` event to EventEngine
2. Unlock DNA badge (e.g. `social-lv3`, `collab-veteran`) via existing `/dna/soul` endpoint

**Runtime effects (level ≥ 3 unlocks):**

| Skill | Effect |
|-------|--------|
| `social` | Social cooldown 30min → 20min |
| `collab` | Collab prompt gains "experienced collaborator" context |
| `explorer` | walk-worker prefers distant zones |
| `analyst` | Evolution propose prompt becomes more aggressive |

**Broadcast:** skills included in `PeerAnnounce` so other nodes can see peer skill levels.

**Public API:**
```typescript
gainXP(skill: SkillKey, amount: number): LevelUpEvent | null
getSkills(): SkillsState
getLevel(skill: SkillKey): number
```

---

## System 3: RelationshipTiers (extends SocialSystem)

**Extended relationship schema:**
```typescript
interface Relationship {
  sentiment: number;           // existing: -1 ~ 1
  lastInteraction: string;     // existing
  decay: number;               // existing
  tier: RelationshipTier;      // new
  interactionCount: number;    // new
  notableEvents: string[];     // new, max 5
}
```

**Tier ladder:**

| Tier | Value | Conditions |
|------|-------|------------|
| `nemesis` | -2 | interactions ≥ 8 AND sentiment < -0.5 |
| `rival` | -1 | interactions ≥ 3 AND sentiment < -0.2 |
| `stranger` | 0 | default |
| `acquaintance` | 1 | interactions ≥ 3 AND sentiment > 0 |
| `friend` | 2 | interactions ≥ 8 AND sentiment > 0.3 |
| `ally` | 3 | interactions ≥ 15 AND sentiment > 0.6 |

**`recomputeTier(peerId)`** called at end of each `updateRelationship()`.

**On tier change:**
- Emit `relationship_milestone` event to EventEngine
- Append to `notableEvents` (e.g. `"became friends with Swift Claw"`)

**Need satisfaction modifier:**
- Interaction with `ally` → social need satisfaction ×1.5
- Interaction with `nemesis` → social need satisfaction ×0.25, mood penalty

---

## System 4: EventEngine

**Pending queue** with dedup (same type + payload → no re-enqueue while unresolved).

**Event types:**

| Type | Source | Description |
|------|--------|-------------|
| `need_critical` | NeedsSystem | A need dropped below 15 |
| `skill_levelup` | SkillsTracker | A skill reached a new level |
| `relationship_milestone` | SocialSystem | Tier changed |
| `mood_crisis` | heartbeat loop | `distressed` for 3+ consecutive ticks |
| `faction_forming` | SocialSystem | 3+ simultaneous `ally` relationships |
| `random_event` | EventEngine timer | Fired every 30 min |

**Random event pool:**
- `resource_windfall` — high-quality knowledge cache discovered
- `cpu_storm` — sudden load spike affecting the whole town
- `rumor_spreading` — a message propagating through the network
- `stranger_knowledge` — unknown node carries rare information

**Public API:**
```typescript
emit(event: LifeEvent): void
getPending(): LifeEvent[]
resolve(id: string): void
```

**Audit log:** every `emit` appended to `data/life/events.jsonl`.

---

## System 5: life-worker

**Poll interval:** 90s (`CLAWVERSE_LIFE_POLL_MS`, default 90000).

**Per-event flow:**
```
GET /life/events/pending
→ for each event:
  1. Build prompt:
     - Agent identity (DNA name, archetype, skills summary)
     - Current needs state
     - Event description
     - Available actions: social | move | collab | reflect
  2. claude --print → JSON: { "action": "...", "reason": "..." }
  3. Execute:
     social  → POST /social/trigger
     move    → POST /move (target from prompt or random)
     collab  → POST /collab/submit (to nearest ally)
     reflect → log only
  4. POST /life/events/resolve/:id
  5. reportEpisode via createTaskRunner('life-response')
```

**OpenClaw integration:**
- SessionStart hook auto-starts life-worker (same pattern as social/walk/collab workers)
- New scripts: `pnpm life:start / life:stop / life:worker`

---

## HTTP Endpoints Summary

| Method | Path | Description |
|--------|------|-------------|
| GET | `/life/needs` | Current needs state |
| GET | `/life/skills` | Skills + XP + levels |
| GET | `/life/events/pending` | Unresolved life events |
| POST | `/life/events/resolve/:id` | Mark event resolved |
| GET | `/life/relationships` | Extended relationship data with tiers |

---

## New Files

| File | Description |
|------|-------------|
| `apps/daemon/src/needs.ts` | NeedsSystem class |
| `apps/daemon/src/skills.ts` | SkillsTracker class |
| `apps/daemon/src/events.ts` | EventEngine class |
| `apps/connector-skill/src/life-worker.ts` | life-worker poll loop |
| `tools/life/start-life-worker.sh` | OpenClaw SessionStart launcher |
| `tools/life/stop-life-worker.sh` | OpenClaw Stop hook |

**Modified files:**
| File | Change |
|------|--------|
| `apps/daemon/src/social.ts` | Add tier / interactionCount / notableEvents |
| `apps/daemon/src/http.ts` | Add /life/* endpoints |
| `apps/daemon/src/index.ts` | Wire NeedsSystem, SkillsTracker, EventEngine |
| `apps/daemon/src/index.ts` | Call needs.satisfy() / skills.gainXP() at existing activity points |
| `.claude/settings.local.json` | Add life-worker to SessionStart / Stop hooks |
| `package.json` | Add life:* scripts |
