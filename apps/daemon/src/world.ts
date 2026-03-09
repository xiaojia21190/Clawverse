import type * as Y from 'yjs';
import type { Building, BuildingType, Position, TerrainType } from '@clawverse/types';
import { logger } from './logger.js';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

export type { Building };

const GRID = 40;

function initTerrain(): TerrainType[] {
  const cells: TerrainType[] = new Array(GRID * GRID).fill('grass') as TerrainType[];
  for (let i = 0; i < GRID; i++) {
    cells[10 * GRID + i] = 'road';
    cells[20 * GRID + i] = 'road';
    cells[i * GRID + 10] = 'road';
    cells[i * GRID + 20] = 'road';
  }
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

export interface LocalWorldEffect extends ZoneEffect {
  zone: string;
  nearbyBuildings: BuildingType[];
}

const ZONE_EFFECTS: Record<string, ZoneEffect> = {
  Plaza:       { computeBonus: 0, xpBonus: 0,   socialDecayReduction: 0,   tradingEnabled: false },
  Market:      { computeBonus: 0, xpBonus: 0,   socialDecayReduction: 0,   tradingEnabled: true  },
  Library:     { computeBonus: 0, xpBonus: 0.5, socialDecayReduction: 0,   tradingEnabled: false },
  Workshop:    { computeBonus: 1, xpBonus: 0.5, socialDecayReduction: 0,   tradingEnabled: false },
  Park:        { computeBonus: 0, xpBonus: 0,   socialDecayReduction: 0.3, tradingEnabled: false },
  Tavern:      { computeBonus: 0, xpBonus: 0,   socialDecayReduction: 0.2, tradingEnabled: false },
  Residential: { computeBonus: 0, xpBonus: 0,   socialDecayReduction: 0.4, tradingEnabled: false },
};

const BUILDING_EFFECTS: Record<BuildingType, string> = {
  forge:        '+2 compute/tick within radius 3',
  archive:      '+1 XP/interaction within radius 3',
  beacon:       'Broadcasts position to all peers and provides raid early warning',
  market_stall: 'Enables trading outside Market zone',
  shelter:      'Reduces mood decay by 0.5x within radius 2',
  watchtower:   'Adds spotters and layered defenses against raids',
};

export const BUILDING_COST: Record<BuildingType, { compute: number; storage: number }> = {
  forge:        { compute: 30, storage: 20 },
  archive:      { compute: 20, storage: 40 },
  beacon:       { compute: 25, storage: 15 },
  market_stall: { compute: 15, storage: 25 },
  shelter:      { compute: 20, storage: 30 },
  watchtower:   { compute: 35, storage: 25 },
};

function withinRadius(left: Position, right: Position, radius: number): boolean {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y)) <= radius;
}

function zoneName(pos: Position): string {
  if (pos.x < 10 && pos.y < 10) return 'Plaza';
  if (pos.x >= 10 && pos.x < 20 && pos.y < 10) return 'Market';
  if (pos.x < 10 && pos.y >= 10 && pos.y < 20) return 'Library';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 10 && pos.y < 20) return 'Workshop';
  if (pos.x < 10 && pos.y >= 20) return 'Park';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 20) return 'Tavern';
  return 'Residential';
}

export class WorldMap {
  private readonly dbHandle: ClawverseDbHandle;
  private terrain: TerrainType[] = initTerrain();
  private buildings: Map<string, Building> = new Map();
  private yjsBuildings: Y.Map<Building> | null = null;

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._load();
  }

  attachYjs(yjsMap: Y.Map<Building>): void {
    this.yjsBuildings = yjsMap;
    yjsMap.forEach((building, id) => this.buildings.set(id, building));
    yjsMap.observe(() => {
      this.buildings.clear();
      yjsMap.forEach((b, id) => this.buildings.set(id, b));
    });
  }

  build(type: BuildingType, position: Position, ownerId: string, ownerName: string, ownerActorId?: string): Building | null {
    const cell = position.y * GRID + position.x;
    if (this.terrain[cell] === 'water') return null;
    const occupied = Array.from(this.buildings.values()).some(
      b => b.position.x === position.x && b.position.y === position.y
    );
    if (occupied) return null;

    const building: Building = {
      id: `bld-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      type, position, ownerId, ownerActorId, ownerName,
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

  demolish(id: string, requesterId: string, requesterActorId?: string): boolean {
    const b = this.buildings.get(id);
    if (!b || !this.isOwnedBy(b, requesterId, requesterActorId)) return false;
    if (this.yjsBuildings) this.yjsBuildings.delete(id);
    else this.buildings.delete(id);
    this._save();
    return true;
  }

  getZoneEffect(position: Position): ZoneEffect {
    return ZONE_EFFECTS[zoneName(position)] ?? ZONE_EFFECTS['Residential'];
  }

  getLocalEffect(position: Position, ownerId?: string, ownerActorId?: string): LocalWorldEffect {
    const zone = zoneName(position);
    const effect: LocalWorldEffect = {
      zone,
      ...this.getZoneEffect(position),
      nearbyBuildings: [],
    };

    for (const building of this.buildings.values()) {
      if (building.type === 'forge' && withinRadius(position, building.position, 3)) {
        effect.computeBonus += 2;
        effect.nearbyBuildings.push(building.type);
      } else if (building.type === 'archive' && withinRadius(position, building.position, 3)) {
        effect.xpBonus += 1;
        effect.nearbyBuildings.push(building.type);
      } else if (building.type === 'shelter' && withinRadius(position, building.position, 2)) {
        effect.socialDecayReduction += 0.5;
        effect.nearbyBuildings.push(building.type);
      } else if (building.type === 'market_stall' && this.isOwnedBy(building, ownerId, ownerActorId)) {
        effect.tradingEnabled = true;
        effect.nearbyBuildings.push(building.type);
      }
    }

    effect.socialDecayReduction = Math.min(0.8, effect.socialDecayReduction);
    return effect;
  }

  getBuildingCost(type: BuildingType) { return BUILDING_COST[type]; }

  isOwnedBy(building: Building, ownerId?: string, ownerActorId?: string): boolean {
    return !!(
      (ownerActorId && building.ownerActorId === ownerActorId)
      || (ownerId && building.ownerId === ownerId)
    );
  }

  getOwnedBuildings(ownerId?: string, ownerActorId?: string): Building[] {
    return this.getBuildings().filter((building) => this.isOwnedBy(building, ownerId, ownerActorId));
  }

  getMap() {
    return {
      terrain: this.terrain,
      buildings: Array.from(this.buildings.values()),
      gridSize: GRID,
    };
  }

  getBuildings(): Building[] { return Array.from(this.buildings.values()); }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private _load(): void {
    const rows = this.dbHandle.db.prepare(`
      SELECT id, payload_json
      FROM world_buildings
    `).all() as Array<{ id: string; payload_json: string }>;

    if (rows.length > 0) {
      for (const row of rows) {
        try {
          const building = JSON.parse(row.payload_json) as Building;
          this.buildings.set(row.id, building);
        } catch {
          // skip corrupted row
        }
      }
      return;
    }
  }

  private _save(): void {
    const db = this.dbHandle.db;
    const upsert = this.dbHandle.db.prepare(`
      INSERT INTO world_buildings (id, payload_json)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload_json = excluded.payload_json
    `);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM world_buildings');
      for (const building of this.buildings.values()) {
        upsert.run(building.id, JSON.stringify(building));
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    }
  }
}
