# Clawverse × Rimworld Full System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade Clawverse from Alpha demo to a Rimworld-style AI node simulation world with economy, rich map, AI storyteller, and full visual UI.

**Architecture:** EventBus spine — existing EventEngine upgraded to typed pub/sub; EconomySystem + WorldMap publish events; Storyteller subscribes to all and orchestrates narrative arcs. Town Viewer rebuilt on HTML5 Canvas + Vue3 HUD layers.

**Tech Stack:** TypeScript ESM, Fastify 5, Yjs CRDT, Hyperswarm P2P, Vue 3, Vite, HTML5 Canvas, pnpm + turborepo.

---

## Phase 1: Economy System

### Task 1: Add Economy + World types to @clawverse/types

**Files:**
- Modify: `packages/types/src/index.ts`

**Step 1: Append to packages/types/src/index.ts**

Add after the existing `Location` interface (end of file):

```typescript
// =====================
// Economy System (live)
// =====================

export interface ResourceState {
  compute: number;     // ⚡ 0-200
  storage: number;     // 💾 0-200
  bandwidth: number;   // 🌐 0-200
  reputation: number;  // 🪙 0-∞
  updatedAt: string;
}

// =====================
// World Map
// =====================

export type BuildingType = 'forge' | 'archive' | 'beacon' | 'market_stall' | 'shelter';

export interface Building {
  id: string;
  type: BuildingType;
  position: Position;
  ownerId: string;
  ownerName: string;
  effect: string;
  createdAt: string;
}

export type TerrainType = 'grass' | 'road' | 'water';

// =====================
// Storyteller
// =====================

export type StorytellerMode = 'Randy' | 'Cassandra' | 'Phoebe';
```

**Step 2: Build types package**

```bash
cd D:/code/Clawverse && export PATH="$PATH:/d/Program Files/Git/bin" && pnpm --filter @clawverse/types build
```
Expected: `dist/index.js` and `dist/index.d.ts` regenerated, no errors.

**Step 3: Commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add packages/types/src/index.ts && git commit -m "feat(types): add ResourceState, Building, TerrainType, StorytellerMode"
```

---

### Task 2: Implement EconomySystem

**Files:**
- Create: `apps/daemon/src/economy.ts`

**Step 1: Write apps/daemon/src/economy.ts**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mood } from '@clawverse/types';
import type { ResourceState } from '@clawverse/types';
import { logger } from './logger.js';

export type { ResourceState };

const RESOURCES_PATH = resolve(process.cwd(), 'data/economy/resources.json');
const TRADES_PATH    = resolve(process.cwd(), 'data/economy/trades.jsonl');
const CAP = 200;

const INITIAL: ResourceState = {
  compute: 80, storage: 80, bandwidth: 60, reputation: 10,
  updatedAt: new Date().toISOString(),
};

export class EconomySystem {
  private state: ResourceState = { ...INITIAL };

  constructor() {
    mkdirSync(dirname(RESOURCES_PATH), { recursive: true });
    this._load();
  }

  // Called every heartbeat tick
  tick(mood: Mood, peerCount: number): void {
    const s = this.state;
    // compute: idle generates, busy consumes
    if (mood === 'idle')      s.compute = Math.min(CAP, s.compute + 1.5);
    else if (mood === 'working') s.compute = Math.min(CAP, s.compute + 0.5);
    else if (mood === 'busy')    s.compute = Math.max(0, s.compute - 1);
    else if (mood === 'stressed' || mood === 'distressed') s.compute = Math.max(0, s.compute - 2);

    // storage: passive growth
    s.storage = Math.min(CAP, s.storage + 0.3);

    // bandwidth: peer connections drive it
    if (peerCount > 0) s.bandwidth = Math.min(CAP, s.bandwidth + 0.5 * Math.min(peerCount, 4));
    else               s.bandwidth = Math.max(0, s.bandwidth - 0.2);

    s.updatedAt = new Date().toISOString();
    this._save();
  }

  consume(resource: keyof Omit<ResourceState, 'updatedAt'>, amount: number): boolean {
    if (this.state[resource] < amount) return false;
    (this.state[resource] as number) -= amount;
    this._save();
    return true;
  }

  award(resource: keyof Omit<ResourceState, 'updatedAt'>, amount: number): void {
    (this.state[resource] as number) = Math.min(
      resource === 'reputation' ? Infinity : CAP,
      (this.state[resource] as number) + amount
    );
    this._save();
  }

  canAfford(resource: keyof Omit<ResourceState, 'updatedAt'>, amount: number): boolean {
    return (this.state[resource] as number) >= amount;
  }

  getResources(): ResourceState { return { ...this.state }; }

  recordTrade(fromId: string, toId: string, resource: string, amount: number): void {
    const entry = JSON.stringify({ ts: new Date().toISOString(), fromId, toId, resource, amount });
    try {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(TRADES_PATH, entry + '\n');
    } catch { /* ignore */ }
  }

  private _load(): void {
    if (!existsSync(RESOURCES_PATH)) return;
    try { this.state = JSON.parse(readFileSync(RESOURCES_PATH, 'utf8')); } catch { /* use defaults */ }
  }

  private _save(): void {
    writeFileSync(RESOURCES_PATH, JSON.stringify(this.state, null, 2));
  }
}
```

**Step 2: Fix the async import (can't use await in non-async function)**

Replace the `recordTrade` method with:
```typescript
  recordTrade(fromId: string, toId: string, resource: string, amount: number): void {
    const entry = JSON.stringify({ ts: new Date().toISOString(), fromId, toId, resource, amount });
    try { appendFileSync(TRADES_PATH, entry + '\n'); } catch { /* ignore */ }
  }
```
And add `appendFileSync` to the top import: `import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';`

**Step 3: Build to verify TypeScript compiles**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/daemon build
```
Expected: no TypeScript errors.

**Step 4: Commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add apps/daemon/src/economy.ts && git commit -m "feat(economy): add EconomySystem with tick/consume/award logic"
```

---

### Task 3: Wire EconomySystem into daemon index.ts and http.ts

**Files:**
- Modify: `apps/daemon/src/index.ts`
- Modify: `apps/daemon/src/http.ts`

**Step 1: Add to apps/daemon/src/index.ts**

After `import { EventEngine } from './events.js';` add:
```typescript
import { EconomySystem } from './economy.js';
```

After `const events = new EventEngine();` add:
```typescript
const economy = new EconomySystem();
```

In the heartbeat setInterval block, after `needs.tick()` add:
```typescript
    economy.tick(mood, network.getPeers().length);
```

Pass `economy` into `createHttpServer` context (add to the context object literal).

**Step 2: Update apps/daemon/src/http.ts APIContext**

Add to `APIContext` interface:
```typescript
  economy: EconomySystem;
```

Add import at top:
```typescript
import { EconomySystem } from './economy.js';
```

Add economy HTTP endpoints before the SSE section:

```typescript
  // Economy endpoints
  fastify.get('/economy/resources', async () => context.economy.getResources());

  fastify.post('/economy/trade', async (request, reply) => {
    const { toId, resource, amount } = request.body as { toId: string; resource: string; amount: number };
    const resources = ['compute', 'storage', 'bandwidth', 'reputation'];
    if (!resources.includes(resource) || amount <= 0) {
      return reply.code(400).send({ error: 'invalid resource or amount' });
    }
    const myState = context.stateStore.getMyState();
    const myZone = locationName(myState?.position ?? { x: 0, y: 0 });
    if (myZone !== 'Market') {
      return reply.code(403).send({ error: 'trading only available in Market zone' });
    }
    const ok = context.economy.consume(resource as any, amount);
    if (!ok) return reply.code(400).send({ error: 'insufficient resources' });
    context.economy.recordTrade(context.myId, toId, resource, amount);
    return { success: true };
  });

  fastify.get('/economy/market', async () => {
    const peers = context.stateStore.getAllPeers();
    const marketPeers = peers.filter(p => {
      const zone = locationName(p.position);
      return zone === 'Market';
    });
    return { peers: marketPeers.map(p => ({ id: p.id, name: p.name, position: p.position })) };
  });
```

**Step 3: Build + verify**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/daemon build
```
Start daemon and test:
```bash
curl http://127.0.0.1:19820/economy/resources
```
Expected: `{"compute":80,"storage":80,"bandwidth":60,"reputation":10,"updatedAt":"..."}`

**Step 4: Commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add apps/daemon/src/index.ts apps/daemon/src/http.ts && git commit -m "feat(economy): wire EconomySystem into daemon + HTTP endpoints"
```

---

## Phase 2: World Map

### Task 4: Implement WorldMap

**Files:**
- Create: `apps/daemon/src/world.ts`

**Step 1: Write apps/daemon/src/world.ts**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type * as Y from 'yjs';
import type { Building, BuildingType, Position, TerrainType } from '@clawverse/types';
import { logger } from './logger.js';

export type { Building };

const MAP_PATH = resolve(process.cwd(), 'data/world/map.json');
const GRID = 40;

// Zone-based terrain generation (deterministic)
function initTerrain(): TerrainType[] {
  const cells: TerrainType[] = new Array(GRID * GRID).fill('grass');
  // Road: horizontal at y=10, y=20; vertical at x=10, x=20
  for (let i = 0; i < GRID; i++) {
    cells[10 * GRID + i] = 'road';
    cells[20 * GRID + i] = 'road';
    cells[i * GRID + 10] = 'road';
    cells[i * GRID + 20] = 'road';
  }
  // Water: bottom-right corner (30-39, 30-39)
  for (let y = 30; y < GRID; y++) {
    for (let x = 30; x < GRID; x++) {
      cells[y * GRID + x] = 'water';
    }
  }
  return cells;
}

export interface ZoneEffect {
  computeBonus: number;
  xpBonus: number;
  socialDecayReduction: number;
  tradingEnabled: boolean;
}

const ZONE_EFFECTS: Record<string, ZoneEffect> = {
  Plaza:       { computeBonus: 0,   xpBonus: 0,   socialDecayReduction: 0,   tradingEnabled: false },
  Market:      { computeBonus: 0,   xpBonus: 0,   socialDecayReduction: 0,   tradingEnabled: true  },
  Library:     { computeBonus: 0,   xpBonus: 0.5, socialDecayReduction: 0,   tradingEnabled: false },
  Workshop:    { computeBonus: 1,   xpBonus: 0.5, socialDecayReduction: 0,   tradingEnabled: false },
  Park:        { computeBonus: 0,   xpBonus: 0,   socialDecayReduction: 0.3, tradingEnabled: false },
  Tavern:      { computeBonus: 0,   xpBonus: 0,   socialDecayReduction: 0.2, tradingEnabled: false },
  Residential: { computeBonus: 0,   xpBonus: 0,   socialDecayReduction: 0.4, tradingEnabled: false },
};

const BUILDING_EFFECTS: Record<BuildingType, string> = {
  forge:        '+2 compute/tick within radius 3',
  archive:      '+1 XP/interaction within radius 3',
  beacon:       'Broadcasts position to all peers',
  market_stall: 'Enables trading outside Market zone',
  shelter:      'Reduces mood decay by 0.5x within radius 2',
};

const BUILDING_COST: Record<BuildingType, { compute: number; storage: number }> = {
  forge:        { compute: 30, storage: 20 },
  archive:      { compute: 20, storage: 40 },
  beacon:       { compute: 25, storage: 15 },
  market_stall: { compute: 15, storage: 25 },
  shelter:      { compute: 20, storage: 30 },
};

export class WorldMap {
  private terrain: TerrainType[] = initTerrain();
  private buildings: Map<string, Building> = new Map();
  private yjsBuildings: Y.Map<Building> | null = null;

  constructor() {
    mkdirSync(dirname(MAP_PATH), { recursive: true });
    this._load();
  }

  // Attach to Yjs doc so buildings sync across peers
  attachYjs(yjsMap: Y.Map<Building>): void {
    this.yjsBuildings = yjsMap;
    // Hydrate from Yjs on startup
    yjsMap.forEach((building, id) => this.buildings.set(id, building));
    // Stay in sync
    yjsMap.observe(() => {
      this.buildings.clear();
      yjsMap.forEach((b, id) => this.buildings.set(id, b));
    });
  }

  build(type: BuildingType, position: Position, ownerId: string, ownerName: string): Building | null {
    const cell = position.y * GRID + position.x;
    if (this.terrain[cell] === 'water') return null;
    const occupied = Array.from(this.buildings.values()).some(
      b => b.position.x === position.x && b.position.y === position.y
    );
    if (occupied) return null;

    const building: Building = {
      id: `bld-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      type, position, ownerId, ownerName,
      effect: BUILDING_EFFECTS[type],
      createdAt: new Date().toISOString(),
    };

    if (this.yjsBuildings) {
      this.yjsBuildings.set(building.id, building);
    } else {
      this.buildings.set(building.id, building);
    }
    this._save();
    logger.info(`[world] ${ownerName} built ${type} at (${position.x},${position.y})`);
    return building;
  }

  demolish(id: string, requesterId: string): boolean {
    const b = this.buildings.get(id);
    if (!b || b.ownerId !== requesterId) return false;
    if (this.yjsBuildings) this.yjsBuildings.delete(id);
    else this.buildings.delete(id);
    this._save();
    return true;
  }

  getZoneEffect(position: Position): ZoneEffect {
    const zone = this._zoneName(position);
    return ZONE_EFFECTS[zone] ?? ZONE_EFFECTS['Residential'];
  }

  getBuildingCost(type: BuildingType) { return BUILDING_COST[type]; }

  getMap() {
    return {
      terrain: this.terrain,
      buildings: Array.from(this.buildings.values()),
      gridSize: GRID,
    };
  }

  getBuildings(): Building[] { return Array.from(this.buildings.values()); }

  private _zoneName(pos: Position): string {
    if (pos.x < 10 && pos.y < 10) return 'Plaza';
    if (pos.x >= 10 && pos.x < 20 && pos.y < 10) return 'Market';
    if (pos.x < 10 && pos.y >= 10 && pos.y < 20) return 'Library';
    if (pos.x >= 10 && pos.x < 20 && pos.y >= 10 && pos.y < 20) return 'Workshop';
    if (pos.x < 10 && pos.y >= 20) return 'Park';
    if (pos.x >= 10 && pos.x < 20 && pos.y >= 20) return 'Tavern';
    return 'Residential';
  }

  private _load(): void {
    if (!existsSync(MAP_PATH)) return;
    try {
      const saved = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
      if (saved.buildings) {
        for (const b of saved.buildings) this.buildings.set(b.id, b);
      }
    } catch { /* use defaults */ }
  }

  private _save(): void {
    writeFileSync(MAP_PATH, JSON.stringify({
      buildings: Array.from(this.buildings.values()),
    }, null, 2));
  }
}
```

**Step 2: Build**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/daemon build
```
Expected: no errors.

**Step 3: Commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add apps/daemon/src/world.ts && git commit -m "feat(world): add WorldMap with terrain, buildings, zone effects"
```

---

### Task 5: Wire WorldMap into daemon + add HTTP endpoints

**Files:**
- Modify: `apps/daemon/src/index.ts`
- Modify: `apps/daemon/src/http.ts`
- Modify: `apps/daemon/src/state.ts` (add buildings Yjs map)

**Step 1: Add buildings map to state.ts**

In `StateStore`, add after `private structural`:
```typescript
  private buildingsMap: Y.Map<import('@clawverse/types').Building> | null = null;

  getBuildingsYjsMap(): Y.Map<import('@clawverse/types').Building> {
    if (!this.buildingsMap) {
      this.buildingsMap = this.doc.getMap('buildings');
    }
    return this.buildingsMap;
  }
```

**Step 2: Wire into index.ts**

Add import: `import { WorldMap } from './world.js';`

After `const economy = new EconomySystem();` add:
```typescript
const world = new WorldMap();
world.attachYjs(stateStore.getBuildingsYjsMap());
```

Pass `world` into `createHttpServer` context.

**Step 3: Add to http.ts APIContext**

```typescript
  world: WorldMap;  // add to APIContext
```

Add import: `import { WorldMap } from './world.js';`

Add world endpoints:
```typescript
  // World map endpoints
  fastify.get('/world/map', async () => context.world.getMap());

  fastify.post('/world/build', async (request, reply) => {
    const { type, x, y } = request.body as { type: string; x: number; y: number };
    const validTypes = ['forge', 'archive', 'beacon', 'market_stall', 'shelter'];
    if (!validTypes.includes(type)) return reply.code(400).send({ error: 'invalid building type' });
    const pos = { x: Math.max(0, Math.min(39, x)), y: Math.max(0, Math.min(39, y)) };
    const cost = context.world.getBuildingCost(type as any);
    if (!context.economy.canAfford('compute', cost.compute)) {
      return reply.code(400).send({ error: `need ${cost.compute} compute` });
    }
    if (!context.economy.canAfford('storage', cost.storage)) {
      return reply.code(400).send({ error: `need ${cost.storage} storage` });
    }
    const myState = context.stateStore.getMyState();
    const building = context.world.build(type as any, pos, context.myId, myState?.name ?? context.myId.slice(0, 8));
    if (!building) return reply.code(409).send({ error: 'position occupied or invalid' });
    context.economy.consume('compute', cost.compute);
    context.economy.consume('storage', cost.storage);
    context.skills.gainXP('explorer', 5);
    context.events.emit('building_completed' as any, { buildingType: type, position: pos });
    broadcastStateSse({ peers: context.stateStore.getAllPeers() });
    return { success: true, building };
  });

  fastify.delete('/world/build/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = context.world.demolish(id, context.myId);
    if (!ok) return reply.code(404).send({ error: 'building not found or not yours' });
    return { success: true };
  });
```

**Step 4: Build + verify**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/daemon build
```
Start daemon:
```bash
curl http://127.0.0.1:19820/world/map | head -c 200
```
Expected: JSON with `terrain` array (1600 items) and `buildings: []`.

**Step 5: Commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add apps/daemon/src/world.ts apps/daemon/src/state.ts apps/daemon/src/index.ts apps/daemon/src/http.ts && git commit -m "feat(world): wire WorldMap into daemon + /world/map /world/build endpoints"
```

---

## Phase 3: EventEngine Expansion + Storyteller

### Task 6: Expand EventEngine to 20 event types

**Files:**
- Modify: `apps/daemon/src/events.ts`

**Step 1: Replace LifeEventType union in events.ts**

Replace the current `LifeEventType` definition with:
```typescript
export type LifeEventType =
  // Original 6
  | 'need_critical'
  | 'skill_levelup'
  | 'relationship_milestone'
  | 'mood_crisis'
  | 'faction_forming'
  | 'random_event'
  // Survival
  | 'resource_drought'
  | 'cpu_storm'
  | 'storage_overflow'
  | 'need_cascade'
  // Social
  | 'stranger_arrival'
  | 'faction_war'
  | 'peace_treaty'
  | 'betrayal'
  // Achievement
  | 'skill_tournament'
  | 'resource_windfall'
  | 'legendary_builder'
  | 'epic_journey'
  | 'legacy_event'
  // Narrative
  | 'faction_founding'
  | 'great_migration'
  | 'building_completed';
```

Also expand `RANDOM_POOL`:
```typescript
const RANDOM_POOL = [
  { subtype: 'resource_windfall',  description: 'A high-quality knowledge cache surfaces nearby' },
  { subtype: 'cpu_storm',          description: 'A sudden load spike hits the town' },
  { subtype: 'rumor_spreading',    description: 'A message propagates through the network' },
  { subtype: 'stranger_knowledge', description: 'An unknown node carries rare information' },
  { subtype: 'resource_drought',   description: 'Compute resources are running scarce across the town' },
  { subtype: 'skill_tournament',   description: 'A challenge has been issued — compete for glory' },
];
```

**Step 2: Build**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/daemon build
```

**Step 3: Commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add apps/daemon/src/events.ts && git commit -m "feat(events): expand LifeEventType to 22 types + richer random pool"
```

---

### Task 7: Implement Storyteller

**Files:**
- Create: `apps/daemon/src/storyteller.ts`

**Step 1: Write apps/daemon/src/storyteller.ts**

```typescript
import type { StorytellerMode } from '@clawverse/types';
import type { EventEngine, LifeEventType } from './events.js';
import type { StateStore } from './state.js';
import type { SocialSystem } from './social.js';
import type { NeedsSystem } from './needs.js';
import type { EconomySystem } from './economy.js';
import { logger } from './logger.js';

export type { StorytellerMode };

interface WorldSnapshot {
  peerCount: number;
  distressedCount: number;
  allyCount: number;
  nemesisCount: number;
  avgCompute: number;
  criticalNeedsCount: number;
  factionCount: number;
}

function computeTension(snap: WorldSnapshot): number {
  let t = 0;
  t += snap.distressedCount * 20;
  t += snap.nemesisCount * 15;
  t += snap.criticalNeedsCount * 10;
  t += Math.max(0, 50 - snap.avgCompute);  // resource pressure
  t -= snap.allyCount * 5;                 // alliances reduce tension
  return Math.max(0, Math.min(100, t));
}

export class Storyteller {
  private mode: StorytellerMode = 'Cassandra';
  private scanTimer: NodeJS.Timeout | null = null;
  private lastScan = 0;
  private chainTimers: NodeJS.Timeout[] = [];

  constructor(
    private readonly events: EventEngine,
    private readonly state: StateStore,
    private readonly social: SocialSystem,
    private readonly needs: NeedsSystem,
    private readonly economy: EconomySystem,
  ) {}

  setMode(mode: StorytellerMode): void {
    this.mode = mode;
    logger.info(`[storyteller] Mode set to ${mode}`);
  }

  getMode(): StorytellerMode { return this.mode; }

  start(): void {
    const interval = 60_000;
    this.scanTimer = setInterval(() => this._scan(), interval);
    this.scanTimer.unref();
    logger.info(`[storyteller] Started in ${this.mode} mode`);
  }

  stop(): void {
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
    this.chainTimers.forEach(t => clearTimeout(t));
    this.chainTimers = [];
  }

  getTensionScore(): number {
    return computeTension(this._snapshot());
  }

  private _snapshot(): WorldSnapshot {
    const peers = this.state.getAllPeers();
    const rels = this.social.getAllRelationships();
    const needsState = this.needs.getNeeds();
    const resources = this.economy.getResources();
    const criticalNeeds = Object.values(needsState).filter(v => typeof v === 'number' && v < 15).length;

    return {
      peerCount: peers.length,
      distressedCount: peers.filter(p => p.mood === 'distressed').length,
      allyCount: rels.filter(r => r.tier === 'ally').length,
      nemesisCount: rels.filter(r => r.tier === 'nemesis').length,
      avgCompute: resources.compute,
      criticalNeedsCount: criticalNeeds,
      factionCount: rels.filter(r => r.tier === 'ally').length >= 3 ? 1 : 0,
    };
  }

  private _scan(): void {
    const snap = this._snapshot();
    const tension = computeTension(snap);
    logger.info(`[storyteller] Tension=${tension} | mode=${this.mode} | peers=${snap.peerCount}`);

    if (this.mode === 'Randy') this._randy(snap, tension);
    else if (this.mode === 'Cassandra') this._cassandra(snap, tension);
    else this._phoebe(snap, tension);
  }

  private _randy(snap: WorldSnapshot, tension: number): void {
    // Randy: pure chaos — random event regardless of tension
    const pool: LifeEventType[] = [
      'resource_windfall', 'cpu_storm', 'skill_tournament',
      'resource_drought', 'stranger_arrival', 'great_migration',
    ];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.events.emit(pick, { source: 'storyteller', mode: 'Randy' });
  }

  private _cassandra(snap: WorldSnapshot, tension: number): void {
    if (tension < 20) {
      // Too calm — escalate
      this.events.emit('resource_drought', { source: 'storyteller', severity: 'mild' });
      // Chain: if not resolved, escalate to need_cascade in 3 min
      const t = setTimeout(() => {
        if (this.getTensionScore() < 30) {
          this.events.emit('need_cascade', { source: 'storyteller', triggered_by: 'resource_drought' });
        }
      }, 3 * 60_000);
      this.chainTimers.push(t);
    } else if (tension > 75) {
      // Too intense — provide relief
      this.events.emit('resource_windfall', { source: 'storyteller', reason: 'mercy' });
    } else {
      // Normal — check for milestone events
      if (snap.allyCount >= 3) {
        this.events.emit('faction_founding', { source: 'storyteller', allyCount: snap.allyCount });
      }
      if (snap.distressedCount >= 2) {
        this.events.emit('mood_crisis', { source: 'storyteller', count: snap.distressedCount });
      }
    }
  }

  private _phoebe(snap: WorldSnapshot, tension: number): void {
    if (tension < 10) {
      // Gentle push: social event
      this.events.emit('stranger_arrival', { source: 'storyteller', mode: 'Phoebe' });
    } else if (tension > 60) {
      // Phoebe always softens crises
      this.events.emit('peace_treaty', { source: 'storyteller', reason: 'Phoebe intervention' });
      this.events.emit('resource_windfall', { source: 'storyteller', reason: 'Phoebe blessing' });
    }
  }
}
```

**Step 2: Build**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/daemon build
```

**Step 3: Commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add apps/daemon/src/storyteller.ts && git commit -m "feat(storyteller): add Storyteller with Randy/Cassandra/Phoebe modes + tension engine"
```

---

### Task 8: Wire Storyteller into daemon + add HTTP endpoints

**Files:**
- Modify: `apps/daemon/src/index.ts`
- Modify: `apps/daemon/src/http.ts`

**Step 1: Wire in index.ts**

Add import: `import { Storyteller } from './storyteller.js';`

After economy + world init:
```typescript
const storyteller = new Storyteller(events, stateStore, social, needs, economy);
```

After `events.start();` add:
```typescript
storyteller.start();
```

In shutdown function, add: `storyteller.stop();`

Pass `storyteller` into `createHttpServer` context.

**Step 2: Add to http.ts APIContext**

```typescript
  storyteller: Storyteller;
```
Add import: `import { Storyteller } from './storyteller.js';`

Add endpoints:
```typescript
  // Storyteller endpoints
  fastify.get('/storyteller/status', async () => ({
    mode: context.storyteller.getMode(),
    tension: context.storyteller.getTensionScore(),
  }));

  fastify.post('/storyteller/mode', async (request, reply) => {
    const { mode } = request.body as { mode: string };
    const validModes = ['Randy', 'Cassandra', 'Phoebe'];
    if (!validModes.includes(mode)) return reply.code(400).send({ error: 'invalid mode' });
    context.storyteller.setMode(mode as any);
    return { success: true, mode };
  });

  fastify.post('/storyteller/trigger', async (request, reply) => {
    const { eventType, payload } = request.body as { eventType: string; payload?: Record<string, unknown> };
    context.events.emit(eventType as any, { ...payload, source: 'manual' });
    return { success: true };
  });
```

**Step 3: Build + verify**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/daemon build
```
Test:
```bash
curl http://127.0.0.1:19820/storyteller/status
```
Expected: `{"mode":"Cassandra","tension":0}`

**Step 4: Commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add apps/daemon/src/index.ts apps/daemon/src/http.ts && git commit -m "feat(storyteller): wire into daemon + /storyteller/* endpoints"
```

---

### Task 9: Add storyteller-worker.ts (Claude-driven narrative decisions)

**Files:**
- Create: `apps/connector-skill/src/storyteller-worker.ts`

**Step 1: Write apps/connector-skill/src/storyteller-worker.ts**

```typescript
/**
 * Clawverse Storyteller Worker
 * Runs inside OpenClaw environment.
 *
 * Flow (every STORYTELLER_INTERVAL_MS):
 *   1. GET /storyteller/status + /status + /peers → world snapshot
 *   2. Build narrative prompt
 *   3. claude --print → { event_type, target?, reason }
 *   4. POST /storyteller/trigger
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createTaskRunner } from './index.js';

const execFileAsync = promisify(execFile);
const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const INTERVAL_MS = Number(process.env.CLAWVERSE_STORYTELLER_INTERVAL_MS || 10 * 60_000);
const CLAUDE_MODEL = process.env.CLAWVERSE_STORYTELLER_MODEL || 'claude-haiku-4-5';
const LOG_PATH = resolve(process.cwd(), 'data/life/storyteller-worker.log');

mkdirSync(dirname(LOG_PATH), { recursive: true });
const runner = createTaskRunner({ source: 'task-runtime' });

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + '\n');
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${DAEMON_URL}${path}`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

function buildPrompt(status: any, peers: any, storyteller: any, events: any): string {
  const peerSummary = (peers.all ?? [])
    .slice(0, 8)
    .map((p: any) => `  - ${p.name} (${p.dna?.archetype}, mood:${p.mood}) at (${p.position.x},${p.position.y})`)
    .join('\n');

  return [
    `You are the Storyteller AI for Clawverse virtual town — mode: ${storyteller.mode}.`,
    `Current tension score: ${storyteller.tension}/100`,
    ``,
    `My status: ${status.state?.name}, mood=${status.mood}, compute=${status.economy?.compute ?? '?'}`,
    ``,
    `Town peers:`,
    peerSummary || '  (none)',
    ``,
    `Pending events: ${(events.pending ?? []).length} unresolved`,
    ``,
    `Available event types to trigger:`,
    `  resource_drought, resource_windfall, cpu_storm, stranger_arrival,`,
    `  faction_war, peace_treaty, skill_tournament, need_cascade, betrayal,`,
    `  great_migration, epic_journey, legendary_builder, legacy_event`,
    ``,
    `Based on the current world state and your storyteller mode, choose ONE event to trigger.`,
    `Reply ONLY with valid JSON: {"event_type": "<type>", "reason": "<one sentence>"}`,
    `If the situation needs no intervention, reply: {"event_type": "none", "reason": "..."}`,
  ].join('\n');
}

async function run(): Promise<void> {
  log('Starting storyteller decision...');

  const [status, peers, storyteller, lifeEvents] = await Promise.all([
    fetchJson('/status'),
    fetchJson('/peers'),
    fetchJson('/storyteller/status'),
    fetchJson('/life/events/pending'),
  ]).catch((err: Error) => { log(`Fetch failed: ${err.message}`); return [null, null, null, null]; });

  if (!status || !peers || !storyteller) { log('Skipping: daemon unreachable'); return; }

  const prompt = buildPrompt(status, peers, storyteller, lifeEvents ?? { pending: [] });

  await runner.run('storyteller-decision', async () => {
    const { stdout } = await execFileAsync(
      'claude', ['--print', '--model', CLAUDE_MODEL, '-p', prompt], { timeout: 30_000 }
    );

    const match = stdout.match(/\{[^}]+\}/);
    if (!match) { log('Could not parse JSON from claude output'); return null; }

    const parsed = JSON.parse(match[0]);
    if (parsed.event_type === 'none') { log(`No intervention needed: ${parsed.reason}`); return null; }

    log(`Triggering: ${parsed.event_type} — ${parsed.reason}`);
    const res = await fetch(`${DAEMON_URL}/storyteller/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventType: parsed.event_type, payload: { reason: parsed.reason } }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Trigger failed: ${res.status}`);
    return parsed;
  }).catch((err: Error) => log(`Storyteller worker error: ${err.message}`));
}

run().catch((err) => {
  log(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});

// Loop mode
if (INTERVAL_MS > 0) {
  setInterval(run, INTERVAL_MS);
}
```

**Step 2: Add pnpm script in root package.json**

In the `scripts` section of `package.json`, add:
```json
"storyteller:worker": "pnpm --filter @clawverse/connector-skill exec tsx src/storyteller-worker.ts",
"storyteller:start": "bash tools/storyteller/start-storyteller-worker.sh",
"storyteller:stop": "bash tools/storyteller/stop-storyteller-worker.sh",
```

**Step 3: Create tools/storyteller/ scripts**

Create `tools/storyteller/start-storyteller-worker.sh`:
```bash
#!/usr/bin/env bash
PID_FILE="$(dirname "$0")/storyteller-worker.pid"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "[storyteller-worker] Already running (PID $(cat "$PID_FILE"))"
  exit 0
fi
nohup pnpm storyteller:worker >> data/life/storyteller-worker.log 2>&1 &
echo $! > "$PID_FILE"
echo "[storyteller-worker] Started (PID $!)"
```

Create `tools/storyteller/stop-storyteller-worker.sh`:
```bash
#!/usr/bin/env bash
PID_FILE="$(dirname "$0")/storyteller-worker.pid"
if [ -f "$PID_FILE" ]; then
  kill "$(cat "$PID_FILE")" 2>/dev/null && echo "[storyteller-worker] Stopped" || echo "[storyteller-worker] Not running"
  rm -f "$PID_FILE"
else
  echo "[storyteller-worker] No PID file found"
fi
```

**Step 4: Add OpenClaw hook**

In `openclaw-hooks/` (check existing hook files for pattern), add storyteller-worker to SessionStart hook (same pattern as social-worker and life-worker).

**Step 5: Build + commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/connector-skill build
```
```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add apps/connector-skill/src/storyteller-worker.ts package.json tools/storyteller/ && git commit -m "feat(storyteller): add storyteller-worker with Claude-driven narrative decisions"
```

---

## Phase 4: Town Viewer Complete Overhaul

### Task 10: Update vite proxy + add data composables

**Files:**
- Modify: `apps/town-viewer/vite.config.ts`
- Create: `apps/town-viewer/src/composables/useEconomy.ts`
- Create: `apps/town-viewer/src/composables/useWorldMap.ts`
- Create: `apps/town-viewer/src/composables/useStoryteller.ts`

**Step 1: Update vite.config.ts proxy**

Add these proxy entries:
```typescript
'/economy': { target: 'http://127.0.0.1:19820', changeOrigin: true },
'/world':   { target: 'http://127.0.0.1:19820', changeOrigin: true },
'/storyteller': { target: 'http://127.0.0.1:19820', changeOrigin: true },
'/life':    { target: 'http://127.0.0.1:19820', changeOrigin: true },
```

**Step 2: Create composables**

`apps/town-viewer/src/composables/useEconomy.ts`:
```typescript
import { ref, onMounted, onUnmounted } from 'vue';

export interface ResourceState {
  compute: number; storage: number; bandwidth: number; reputation: number; updatedAt: string;
}

export function useEconomy() {
  const resources = ref<ResourceState | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const res = await fetch('/economy/resources');
      if (res.ok) resources.value = await res.json();
    } catch { /* ignore */ }
  }

  onMounted(() => { refresh(); timer = setInterval(refresh, 5000); });
  onUnmounted(() => { if (timer) clearInterval(timer); });

  return { resources };
}
```

`apps/town-viewer/src/composables/useWorldMap.ts`:
```typescript
import { ref, onMounted } from 'vue';

export interface Building {
  id: string; type: string; position: { x: number; y: number };
  ownerId: string; ownerName: string; effect: string; createdAt: string;
}

export interface WorldMapData {
  terrain: string[];
  buildings: Building[];
  gridSize: number;
}

export function useWorldMap() {
  const worldMap = ref<WorldMapData | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/world/map');
      if (res.ok) worldMap.value = await res.json();
    } catch { /* ignore */ }
  }

  async function build(type: string, x: number, y: number): Promise<boolean> {
    const res = await fetch('/world/build', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, x, y }),
    });
    if (res.ok) await refresh();
    return res.ok;
  }

  onMounted(refresh);

  return { worldMap, refresh, build };
}
```

`apps/town-viewer/src/composables/useStoryteller.ts`:
```typescript
import { ref, onMounted } from 'vue';

export function useStoryteller() {
  const mode = ref('Cassandra');
  const tension = ref(0);

  async function refresh() {
    try {
      const res = await fetch('/storyteller/status');
      if (res.ok) { const d = await res.json(); mode.value = d.mode; tension.value = d.tension; }
    } catch { /* ignore */ }
  }

  async function setMode(newMode: string) {
    await fetch('/storyteller/mode', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: newMode }),
    });
    await refresh();
  }

  onMounted(refresh);
  return { mode, tension, setMode, refresh };
}
```

**Step 3: Build viewer**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/town-viewer build
```

**Step 4: Commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add apps/town-viewer/ && git commit -m "feat(viewer): add economy/world/storyteller composables + proxy config"
```

---

### Task 11: Implement TownMapCanvas.vue (Canvas renderer)

**Files:**
- Create: `apps/town-viewer/src/components/TownMapCanvas.vue`

**Step 1: Write TownMapCanvas.vue**

```vue
<template>
  <div class="map-wrapper" ref="wrapperRef">
    <canvas ref="canvasRef" class="map-canvas" @click="onCanvasClick" @mousemove="onMouseMove" @mouseleave="hoveredPeer = null" />
    <div v-if="hoveredPeer" class="tooltip" :style="tooltipStyle">
      <div class="tip-name">{{ hoveredPeer.name }}</div>
      <div class="tip-info">{{ hoveredPeer.dna?.archetype }} · {{ hoveredPeer.mood }}</div>
      <div class="tip-pos">({{ hoveredPeer.position.x }}, {{ hoveredPeer.position.y }})</div>
    </div>
    <div v-if="moveError" class="move-error">{{ moveError }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import type { PeerState } from '../composables/usePeers';
import type { WorldMapData, Building } from '../composables/useWorldMap';

const props = defineProps<{
  peers: Map<string, PeerState>;
  myId: string | null;
  worldMap: WorldMapData | null;
  showRelations?: boolean;
}>();

const emit = defineEmits<{ move: [{ x: number; y: number }] }>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const wrapperRef = ref<HTMLDivElement | null>(null);
const hoveredPeer = ref<PeerState | null>(null);
const tooltipStyle = ref('');
const moveError = ref('');

const GRID = 40;
const TERRAIN_COLORS: Record<string, string> = {
  grass: '#1a2e1a', road: '#3a2e1a', water: '#0d1a2e',
};
const ZONE_COLORS: Record<string, string> = {
  Plaza: '#2a3a2a', Market: '#2a2a3a', Library: '#1a2a3a',
  Workshop: '#2a1a1a', Park: '#1a3a1a', Tavern: '#3a2a1a', Residential: '#1a1a2a',
};
const ARCHETYPE_EMOJIS: Record<string, string> = {
  Warrior: '🦀', Artisan: '🦐', Scholar: '🐙', Ranger: '🦑',
};
const BUILDING_EMOJIS: Record<string, string> = {
  forge: '⚒', archive: '📚', beacon: '🔦', market_stall: '🏪', shelter: '⛺',
};
const MOOD_COLORS: Record<string, string> = {
  idle: '#4a8c4a', working: '#4a7a8c', busy: '#8c8c4a',
  stressed: '#8c5a4a', distressed: '#8c2a2a', sleeping: '#4a4a6a',
};

function getCellSize(): number {
  const canvas = canvasRef.value;
  if (!canvas) return 12;
  return Math.floor(Math.min(canvas.width, canvas.height) / GRID);
}

function zoneName(x: number, y: number): string {
  if (x < 10 && y < 10) return 'Plaza';
  if (x >= 10 && x < 20 && y < 10) return 'Market';
  if (x < 10 && y >= 10 && y < 20) return 'Library';
  if (x >= 10 && x < 20 && y >= 10 && y < 20) return 'Workshop';
  if (x < 10 && y >= 20) return 'Park';
  if (x >= 10 && x < 20 && y >= 20) return 'Tavern';
  return 'Residential';
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cs = getCellSize();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Layer 0: terrain
  const terrain = props.worldMap?.terrain ?? [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const t = terrain[y * GRID + x] ?? 'grass';
      const zone = zoneName(x, y);
      ctx.fillStyle = t === 'grass' ? (ZONE_COLORS[zone] ?? '#1a1a2a')
                    : t === 'road'  ? '#3a2e1a'
                    : '#0d1a2e';
      ctx.fillRect(x * cs, y * cs, cs, cs);
    }
  }

  // Zone borders (subtle 1px line at zone boundaries)
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  for (const bx of [10, 20]) {
    ctx.beginPath(); ctx.moveTo(bx * cs, 0); ctx.lineTo(bx * cs, GRID * cs); ctx.stroke();
  }
  for (const by of [10, 20]) {
    ctx.beginPath(); ctx.moveTo(0, by * cs); ctx.lineTo(GRID * cs, by * cs); ctx.stroke();
  }

  // Layer 1: buildings
  const buildings = props.worldMap?.buildings ?? [];
  for (const b of buildings) {
    const bx = b.position.x * cs;
    const by = b.position.y * cs;
    ctx.fillStyle = '#2a2040';
    ctx.fillRect(bx + 1, by + 1, cs - 2, cs - 2);
    ctx.font = `${Math.max(8, cs - 4)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(BUILDING_EMOJIS[b.type] ?? '🏠', bx + cs / 2, by + cs / 2);
  }

  // Layer 2: relation lines
  if (props.showRelations) {
    // drawn between peers (simplified: just draw lines, no tier color for now)
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    const peerList = Array.from(props.peers.values());
    for (const a of peerList) {
      for (const b of peerList) {
        if (a.id >= b.id) continue;
        ctx.strokeStyle = '#58a6ff';
        ctx.beginPath();
        ctx.moveTo(a.position.x * cs + cs / 2, a.position.y * cs + cs / 2);
        ctx.lineTo(b.position.x * cs + cs / 2, b.position.y * cs + cs / 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Layer 3: peers
  for (const peer of props.peers.values()) {
    const px = peer.position.x * cs + cs / 2;
    const py = peer.position.y * cs + cs / 2;
    const r = Math.max(4, cs / 2 - 1);
    const isMe = peer.id === props.myId;

    // Mood ring
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = MOOD_COLORS[peer.mood] ?? '#4a4a4a';
    ctx.fill();

    // "Mine" highlight
    if (isMe) {
      ctx.strokeStyle = '#3fb950';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Archetype emoji
    if (cs >= 14) {
      ctx.font = `${Math.max(8, cs - 6)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ARCHETYPE_EMOJIS[peer.dna?.archetype ?? ''] ?? '🐚', px, py);
    }
  }
}

function resize() {
  const canvas = canvasRef.value;
  const wrapper = wrapperRef.value;
  if (!canvas || !wrapper) return;
  const size = Math.min(wrapper.clientWidth, wrapper.clientHeight);
  canvas.width = size;
  canvas.height = size;
  draw();
}

function onMouseMove(e: MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const cs = getCellSize();
  const gx = Math.floor((e.clientX - rect.left) / cs);
  const gy = Math.floor((e.clientY - rect.top) / cs);
  hoveredPeer.value = Array.from(props.peers.values()).find(
    p => p.position.x === gx && p.position.y === gy
  ) ?? null;
  if (hoveredPeer.value) {
    tooltipStyle.value = `left:${e.clientX - rect.left + 12}px;top:${e.clientY - rect.top}px`;
  }
}

async function onCanvasClick(e: MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas || !props.myId) return;
  const rect = canvas.getBoundingClientRect();
  const cs = getCellSize();
  const x = Math.floor((e.clientX - rect.left) / cs);
  const y = Math.floor((e.clientY - rect.top) / cs);
  const occupied = Array.from(props.peers.values()).some(p => p.position.x === x && p.position.y === y);
  if (occupied) return;

  moveError.value = '';
  try {
    const res = await fetch('/move', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x, y }),
    });
    if (!res.ok) moveError.value = `Move failed (${res.status})`;
    else emit('move', { x, y });
  } catch (err) {
    moveError.value = `Move error: ${(err as Error).message}`;
  } finally {
    setTimeout(() => { moveError.value = ''; }, 2000);
  }
}

watch([() => props.peers, () => props.worldMap], draw, { deep: true });

const ro = new ResizeObserver(resize);
onMounted(() => {
  if (wrapperRef.value) ro.observe(wrapperRef.value);
  resize();
});
onUnmounted(() => ro.disconnect());
</script>

<style scoped>
.map-wrapper { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #0d1117; }
.map-canvas { cursor: crosshair; display: block; image-rendering: pixelated; }
.tooltip { position: absolute; background: #1c2128; border: 1px solid #30363d; border-radius: 6px; padding: 6px 10px; pointer-events: none; font-size: 12px; color: #e6edf3; z-index: 10; white-space: nowrap; }
.tip-name { font-weight: 600; color: #58a6ff; }
.tip-info { color: #8b949e; font-size: 11px; margin-top: 2px; }
.tip-pos { color: #6e7681; font-size: 10px; }
.move-error { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); background: #3d1a1a; color: #f85149; padding: 4px 10px; border-radius: 4px; font-size: 11px; }
</style>
```

**Step 2: Build viewer**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/town-viewer build
```

**Step 3: Commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add apps/town-viewer/src/components/TownMapCanvas.vue && git commit -m "feat(viewer): add Canvas-based TownMapCanvas with terrain/buildings/peer rendering"
```

---

### Task 12: Add PeerInspector.vue + ResourceBar.vue

**Files:**
- Create: `apps/town-viewer/src/components/PeerInspector.vue`
- Create: `apps/town-viewer/src/components/ResourceBar.vue`

**Step 1: PeerInspector.vue**

```vue
<template>
  <div v-if="peer" class="inspector">
    <div class="header">
      <span class="peer-icon" :style="{ color: peer.dna?.appearance?.primaryColor ?? '#58a6ff' }">
        {{ archetypeIcon(peer.dna?.archetype) }}
      </span>
      <div class="identity">
        <div class="name">{{ peer.name }}</div>
        <div class="traits">{{ peer.dna?.archetype }} · {{ peer.dna?.modelTrait }} · Lv.{{ explorerLevel }}</div>
      </div>
      <div class="mood-badge" :class="peer.mood">{{ peer.mood }}</div>
    </div>
    <div class="needs-row">
      <NeedBar label="social" :value="0" />
      <NeedBar label="tasked" :value="0" />
      <NeedBar label="wander" :value="0" />
      <NeedBar label="creative" :value="0" />
    </div>
    <div class="badges" v-if="peer.dna?.badges?.length">
      <span v-for="b in peer.dna.badges" :key="b" class="badge">{{ b }}</span>
    </div>
    <div class="hw-row">
      <span>CPU {{ Math.round(peer.hardware?.cpuUsage ?? 0) }}%</span>
      <span>RAM {{ Math.round(peer.hardware?.ramUsage ?? 0) }}%</span>
      <span>{{ peer.hardware?.hostname ?? '?' }}</span>
    </div>
  </div>
  <div v-else class="inspector empty">
    <span>Click a peer to inspect</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PeerState } from '../composables/usePeers';

const props = defineProps<{ peer: PeerState | null }>();

const explorerLevel = computed(() => 1); // placeholder until /life endpoint exposed per-peer

function archetypeIcon(a: string | undefined): string {
  return { Warrior: '🦀', Artisan: '🦐', Scholar: '🐙', Ranger: '🦑' }[a ?? ''] ?? '🐚';
}
</script>

<!-- NeedBar is a simple inline component -->
<script lang="ts">
// inline sub-component not supported in SFC, so NeedBar is just a styled div
</script>

<style scoped>
.inspector { background: #0d1117; border-top: 1px solid #30363d; padding: 8px 12px; font-size: 12px; color: #e6edf3; }
.inspector.empty { color: #6e7681; text-align: center; padding: 12px; }
.header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.peer-icon { font-size: 24px; }
.name { font-weight: 600; font-size: 14px; }
.traits { color: #8b949e; font-size: 11px; }
.mood-badge { margin-left: auto; padding: 2px 8px; border-radius: 10px; font-size: 11px; text-transform: capitalize; }
.mood-badge.idle { background: #1a3a1a; color: #3fb950; }
.mood-badge.working { background: #1a2a3a; color: #58a6ff; }
.mood-badge.busy { background: #3a3a1a; color: #d29922; }
.mood-badge.stressed { background: #3a2a1a; color: #f0883e; }
.mood-badge.distressed { background: #3a1a1a; color: #f85149; }
.needs-row { display: flex; gap: 8px; margin-bottom: 6px; }
.badges { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.badge { background: #2a1f3a; color: #a371f7; padding: 1px 6px; border-radius: 8px; font-size: 10px; }
.hw-row { color: #6e7681; font-size: 11px; display: flex; gap: 16px; }
</style>
```

**Step 2: ResourceBar.vue**

```vue
<template>
  <div class="resource-bar">
    <ResourcePill icon="⚡" label="compute" :value="r.compute" :max="200" color="#f0883e" />
    <ResourcePill icon="💾" label="storage" :value="r.storage" :max="200" color="#58a6ff" />
    <ResourcePill icon="🌐" label="bandwidth" :value="r.bandwidth" :max="200" color="#3fb950" />
    <ResourcePill icon="🪙" label="reputation" :value="r.reputation" :max="200" color="#d29922" />
  </div>
</template>

<script setup lang="ts">
import type { ResourceState } from '../composables/useEconomy';
defineProps<{ r: ResourceState }>();
</script>

<style scoped>
.resource-bar { display: flex; gap: 12px; align-items: center; }
</style>
```

Create `apps/town-viewer/src/components/ResourcePill.vue`:
```vue
<template>
  <div class="pill">
    <span class="icon">{{ icon }}</span>
    <div class="bar-wrap">
      <div class="bar-fill" :style="{ width: pct + '%', background: color }"></div>
    </div>
    <span class="val">{{ Math.round(value) }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ icon: string; label: string; value: number; max: number; color: string }>();
const pct = computed(() => Math.min(100, (props.value / props.max) * 100));
</script>

<style scoped>
.pill { display: flex; align-items: center; gap: 4px; font-size: 11px; }
.icon { font-size: 13px; }
.bar-wrap { width: 40px; height: 6px; background: #21262d; border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
.val { color: #8b949e; min-width: 24px; text-align: right; }
</style>
```

**Step 3: Build + commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/town-viewer build
git add apps/town-viewer/src/components/PeerInspector.vue apps/town-viewer/src/components/ResourceBar.vue apps/town-viewer/src/components/ResourcePill.vue && git commit -m "feat(viewer): add PeerInspector + ResourceBar + ResourcePill components"
```

---

### Task 13: Add StorytellerFeed.vue + RelationshipGraph.vue

**Files:**
- Create: `apps/town-viewer/src/components/StorytellerFeed.vue`
- Create: `apps/town-viewer/src/components/StorytellerMode.vue`

**Step 1: StorytellerFeed.vue** (replaces EventFeed.vue)

```vue
<template>
  <div class="feed">
    <div class="feed-header">
      <span class="title">📖 Story</span>
      <span class="tension" :class="tensionClass">T:{{ tension }}</span>
    </div>
    <div class="events-list">
      <div v-for="e in events" :key="e.id" class="event-item" :class="e.type">
        <span class="time">{{ formatTime(e.ts) }}</span>
        <span class="type-badge">{{ e.type.replace(/_/g, ' ') }}</span>
        <span class="desc">{{ describe(e) }}</span>
      </div>
      <div v-if="events.length === 0" class="empty">Waiting for events...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export interface FeedEvent {
  id: string; ts: string; type: string; payload: Record<string, unknown>; resolved: boolean;
}

const props = defineProps<{ events: FeedEvent[]; tension: number }>();

const tensionClass = computed(() => {
  if (props.tension > 60) return 'high';
  if (props.tension > 30) return 'mid';
  return 'low';
});

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function describe(e: FeedEvent): string {
  const p = e.payload;
  if (e.type === 'resource_drought') return 'Compute resources depleting across town';
  if (e.type === 'resource_windfall') return 'A knowledge cache surfaces — resources replenished';
  if (e.type === 'need_critical') return `${p.need} need is critical`;
  if (e.type === 'faction_founding') return `A faction forms — ${p.allyCount} allies united`;
  if (e.type === 'skill_levelup') return `${p.skill} leveled up to ${p.level}`;
  if (e.type === 'mood_crisis') return `Distress spreading through ${p.count ?? 1} nodes`;
  if (e.type === 'building_completed') return `A ${p.buildingType} was constructed`;
  if (e.type === 'betrayal') return 'An ally has become a nemesis';
  if (e.type === 'peace_treaty') return 'Old rivals have made peace';
  return p.description as string ?? p.reason as string ?? e.type;
}
</script>

<style scoped>
.feed { display: flex; flex-direction: column; height: 100%; background: #0d1117; }
.feed-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #21262d; }
.title { font-weight: 600; font-size: 13px; color: #e6edf3; }
.tension { margin-left: auto; padding: 1px 6px; border-radius: 8px; font-size: 11px; font-weight: 600; }
.tension.low { background: #1a3a1a; color: #3fb950; }
.tension.mid { background: #3a3a1a; color: #d29922; }
.tension.high { background: #3a1a1a; color: #f85149; }
.events-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.event-item { display: grid; grid-template-columns: 44px auto 1fr; gap: 6px; padding: 4px 12px; font-size: 11px; border-bottom: 1px solid #161b22; align-items: start; }
.event-item:hover { background: #161b22; }
.time { color: #6e7681; white-space: nowrap; }
.type-badge { color: #a371f7; white-space: nowrap; font-size: 10px; }
.desc { color: #8b949e; }
.empty { color: #6e7681; text-align: center; padding: 20px; font-size: 12px; }
</style>
```

**Step 2: StorytellerMode.vue**

```vue
<template>
  <div class="mode-selector">
    <span class="label">Storyteller:</span>
    <button v-for="m in modes" :key="m" :class="['mode-btn', { active: currentMode === m }]" @click="$emit('setMode', m)">
      {{ m }}
    </button>
    <span class="tension-label">Tension: <strong>{{ tension }}</strong></span>
  </div>
</template>

<script setup lang="ts">
defineProps<{ currentMode: string; tension: number }>();
defineEmits<{ setMode: [string] }>();
const modes = ['Randy', 'Cassandra', 'Phoebe'];
</script>

<style scoped>
.mode-selector { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.label { color: #8b949e; }
.mode-btn { background: #21262d; border: 1px solid #30363d; color: #8b949e; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; }
.mode-btn.active { background: #1f2a3a; border-color: #58a6ff; color: #58a6ff; }
.mode-btn:hover { border-color: #58a6ff; }
.tension-label { margin-left: 8px; color: #6e7681; }
.tension-label strong { color: #d29922; }
</style>
```

**Step 3: Build + commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/town-viewer build && git add apps/town-viewer/src/components/ && git commit -m "feat(viewer): add StorytellerFeed + StorytellerMode components"
```

---

### Task 14: Add BuildMenu.vue

**Files:**
- Create: `apps/town-viewer/src/components/BuildMenu.vue`

**Step 1: Write BuildMenu.vue**

```vue
<template>
  <div class="build-menu">
    <div class="title">🏗 Build</div>
    <button
      v-for="b in BUILDINGS"
      :key="b.type"
      class="build-btn"
      :title="b.effect"
      @click="$emit('build', b.type)"
    >
      {{ b.emoji }} {{ b.label }}
      <span class="cost">⚡{{ b.cost.compute }} 💾{{ b.cost.storage }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
defineEmits<{ build: [string] }>();

const BUILDINGS = [
  { type: 'forge',        emoji: '⚒',  label: 'Forge',        cost: { compute: 30, storage: 20 }, effect: '+2 compute/tick nearby' },
  { type: 'archive',      emoji: '📚', label: 'Archive',      cost: { compute: 20, storage: 40 }, effect: '+1 XP nearby' },
  { type: 'beacon',       emoji: '🔦', label: 'Beacon',       cost: { compute: 25, storage: 15 }, effect: 'Broadcast position' },
  { type: 'market_stall', emoji: '🏪', label: 'Market Stall', cost: { compute: 15, storage: 25 }, effect: 'Enable trade anywhere' },
  { type: 'shelter',      emoji: '⛺', label: 'Shelter',      cost: { compute: 20, storage: 30 }, effect: 'Reduce mood decay nearby' },
];
</script>

<style scoped>
.build-menu { display: flex; flex-direction: column; gap: 4px; padding: 8px; }
.title { font-size: 12px; font-weight: 600; color: #8b949e; margin-bottom: 4px; }
.build-btn { display: flex; align-items: center; gap: 6px; background: #161b22; border: 1px solid #30363d; color: #e6edf3; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; text-align: left; }
.build-btn:hover { border-color: #58a6ff; background: #1f2a3a; }
.cost { margin-left: auto; color: #6e7681; font-size: 10px; }
</style>
```

**Step 2: Build + commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/town-viewer build && git add apps/town-viewer/src/components/BuildMenu.vue && git commit -m "feat(viewer): add BuildMenu component"
```

---

### Task 15: Rewrite App.vue to full Rimworld-style HUD

**Files:**
- Modify: `apps/town-viewer/src/App.vue`
- Modify: `apps/town-viewer/src/components/MetricsPanel.vue` (add life events feed)

**Step 1: Read current App.vue fully**

```bash
# Review current App.vue before editing (read it fully)
```

**Step 2: Rewrite App.vue**

Replace contents of `apps/town-viewer/src/App.vue`:

```vue
<template>
  <div class="app">
    <!-- Top bar -->
    <header class="topbar">
      <div class="brand">🦀 Clawverse</div>
      <div class="conn">
        <span :class="['dot', connected ? 'online' : 'offline']"></span>
        <span>{{ connected ? 'Online' : 'Connecting...' }}</span>
        <span class="sep">|</span>
        <span>{{ peers.size }} peer{{ peers.size !== 1 ? 's' : '' }}</span>
      </div>
      <ResourceBar v-if="resources" :r="resources" class="res-bar" />
      <StorytellerMode :current-mode="storytellerMode" :tension="tension" @set-mode="onSetMode" class="st-mode" />
    </header>

    <!-- Main area -->
    <div class="main">
      <!-- Left: map -->
      <div class="map-col">
        <TownMapCanvas
          :peers="peers"
          :my-id="myId"
          :world-map="worldMap"
          :show-relations="showRelations"
          @move="onMove"
          class="map-area"
        />
        <div class="map-controls">
          <button class="ctrl-btn" @click="showRelations = !showRelations">
            {{ showRelations ? '🔗 Relations ON' : '🔗 Relations OFF' }}
          </button>
          <button class="ctrl-btn" @click="showBuildMenu = !showBuildMenu">🏗 Build</button>
          <BuildMenu v-if="showBuildMenu" @build="onBuild" class="build-float" />
        </div>
      </div>

      <!-- Right: feed + inspector -->
      <div class="side-col">
        <StorytellerFeed :events="lifeEvents" :tension="tension" class="story-feed" />
        <div class="social-feed-mini">
          <div class="sfeed-header">💬 Social</div>
          <div v-for="se in socialEvents.slice(0, 8)" :key="se.id" class="sfeed-item">
            <span class="sfeed-names">{{ se.fromName }} → {{ se.toName }}</span>
            <span class="sfeed-dial">{{ se.dialogue?.slice(0, 60) }}{{ (se.dialogue?.length ?? 0) > 60 ? '…' : '' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom: peer inspector -->
    <PeerInspector :peer="selectedPeer" class="inspector-bar" @close="selectedPeer = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import TownMapCanvas from './components/TownMapCanvas.vue';
import StorytellerFeed from './components/StorytellerFeed.vue';
import StorytellerMode from './components/StorytellerMode.vue';
import ResourceBar from './components/ResourceBar.vue';
import PeerInspector from './components/PeerInspector.vue';
import BuildMenu from './components/BuildMenu.vue';

import { usePeers } from './composables/usePeers';
import { useSocialFeed } from './composables/useSocialFeed';
import { useEconomy } from './composables/useEconomy';
import { useWorldMap } from './composables/useWorldMap';
import { useStoryteller } from './composables/useStoryteller';

const { peers, connected, myId } = usePeers();
const { events: socialEvents } = useSocialFeed();
const { resources } = useEconomy();
const { worldMap, build } = useWorldMap();
const { mode: storytellerMode, tension, setMode } = useStoryteller();

const selectedPeer = ref(null);
const showRelations = ref(false);
const showBuildMenu = ref(false);
const lifeEvents = ref<any[]>([]);

// Poll life events
async function refreshLifeEvents() {
  try {
    const res = await fetch('/life/events/pending');
    if (res.ok) lifeEvents.value = (await res.json()).pending ?? [];
  } catch { /* ignore */ }
}
setInterval(refreshLifeEvents, 5000);
refreshLifeEvents();

function onMove({ x, y }: { x: number; y: number }) {
  // handled in TownMapCanvas, just refresh if needed
}

async function onBuild(type: string) {
  const me = myId.value ? Array.from(peers.value.values()).find(p => p.id === myId.value) : null;
  if (!me) return;
  const x = Math.max(0, Math.min(39, me.position.x + 1));
  const y = me.position.y;
  await build(type, x, y);
  showBuildMenu.value = false;
}

async function onSetMode(mode: string) {
  await setMode(mode);
}
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d1117; color: #e6edf3; font-family: 'Segoe UI', sans-serif; overflow: hidden; }
</style>

<style scoped>
.app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.topbar { display: flex; align-items: center; gap: 12px; padding: 6px 14px; background: #161b22; border-bottom: 1px solid #30363d; flex-shrink: 0; }
.brand { font-weight: 700; font-size: 15px; color: #58a6ff; }
.conn { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot.online { background: #3fb950; }
.dot.offline { background: #f85149; }
.sep { color: #30363d; }
.res-bar { margin-left: 12px; }
.st-mode { margin-left: auto; }
.main { flex: 1; display: flex; overflow: hidden; }
.map-col { flex: 0 0 60%; display: flex; flex-direction: column; position: relative; }
.map-area { flex: 1; }
.map-controls { display: flex; gap: 8px; padding: 6px 10px; background: #0d1117; border-top: 1px solid #21262d; position: relative; }
.ctrl-btn { background: #21262d; border: 1px solid #30363d; color: #8b949e; padding: 3px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
.ctrl-btn:hover { border-color: #58a6ff; color: #e6edf3; }
.build-float { position: absolute; bottom: 40px; left: 50px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; z-index: 20; }
.side-col { flex: 1; display: flex; flex-direction: column; border-left: 1px solid #21262d; overflow: hidden; }
.story-feed { flex: 1; overflow: hidden; }
.social-feed-mini { flex: 0 0 160px; border-top: 1px solid #21262d; overflow-y: auto; }
.sfeed-header { padding: 6px 12px; font-size: 12px; font-weight: 600; color: #8b949e; border-bottom: 1px solid #161b22; }
.sfeed-item { padding: 4px 12px; border-bottom: 1px solid #161b22; font-size: 10px; }
.sfeed-names { color: #58a6ff; display: block; }
.sfeed-dial { color: #6e7681; }
.inspector-bar { flex-shrink: 0; border-top: 1px solid #21262d; }
</style>
```

**Step 3: Build + verify in browser**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm --filter @clawverse/town-viewer build
```
Run dev server:
```bash
pnpm viewer:dev
```
Open http://localhost:5173 — should see full HUD layout.

**Step 4: Commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add apps/town-viewer/src/App.vue && git commit -m "feat(viewer): rewrite App.vue to full Rimworld-style HUD layout"
```

---

## Final Integration Check

### Task 16: Full integration test + cleanup

**Step 1: Full build**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && pnpm build
```
Expected: All packages compile without errors.

**Step 2: Start daemon and verify all endpoints**

```bash
pnpm daemon:start
```
Then test:
```bash
curl http://127.0.0.1:19820/health
curl http://127.0.0.1:19820/economy/resources
curl http://127.0.0.1:19820/world/map | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('terrain len:', d.terrain.length, 'buildings:', d.buildings.length)"
curl http://127.0.0.1:19820/storyteller/status
```
Expected:
- economy: `{"compute":80,...}`
- world: `terrain len: 1600 buildings: 0`
- storyteller: `{"mode":"Cassandra","tension":0}`

**Step 3: Test a build**

```bash
curl -X POST http://127.0.0.1:19820/world/build \
  -H 'content-type: application/json' \
  -d '{"type":"forge","x":5,"y":5}'
```
Expected: `{"success":true,"building":{...}}` (if resources sufficient)

**Step 4: Open Town Viewer**

```bash
pnpm viewer:dev
```
Open http://localhost:5173. Verify:
- Top bar shows resources + storyteller mode
- Canvas map shows terrain zones + roads
- Build menu shows buildings
- Storyteller feed shows events

**Step 5: Final commit**

```bash
export PATH="$PATH:/d/Program Files/Git/bin" && cd /d/code/Clawverse && git add -A && git commit -m "feat: complete Rimworld-style upgrade — Economy/WorldMap/Storyteller/TownViewer"
```

---

## Appendix: New pnpm scripts to add

In root `package.json` scripts:
```json
"storyteller:worker": "pnpm --filter @clawverse/connector-skill exec tsx src/storyteller-worker.ts",
"storyteller:start": "bash tools/storyteller/start-storyteller-worker.sh",
"storyteller:stop": "bash tools/storyteller/stop-storyteller-worker.sh"
```

## Appendix: openclaw-hooks SessionStart addition

Add to whichever hook file runs the other workers (check `openclaw-hooks/` directory):
```bash
# Storyteller worker
if curl -s http://127.0.0.1:19820/health > /dev/null 2>&1; then
  bash tools/storyteller/start-storyteller-worker.sh
else
  echo "[storyteller-worker] daemon not running, skipping"
fi
```
