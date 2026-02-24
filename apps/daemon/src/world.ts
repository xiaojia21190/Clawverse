import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type * as Y from 'yjs';
import type { Building, BuildingType, Position, TerrainType } from '@clawverse/types';
import { logger } from './logger.js';

export type { Building };

const MAP_PATH = resolve(process.cwd(), 'data/world/map.json');
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
  beacon:       'Broadcasts position to all peers',
  market_stall: 'Enables trading outside Market zone',
  shelter:      'Reduces mood decay by 0.5x within radius 2',
};

export const BUILDING_COST: Record<BuildingType, { compute: number; storage: number }> = {
  forge:        { compute: 30, storage: 20 },
  archive:      { compute: 20, storage: 40 },
  beacon:       { compute: 25, storage: 15 },
  market_stall: { compute: 15, storage: 25 },
  shelter:      { compute: 20, storage: 30 },
};

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
  private terrain: TerrainType[] = initTerrain();
  private buildings: Map<string, Building> = new Map();
  private yjsBuildings: Y.Map<Building> | null = null;

  constructor() {
    mkdirSync(dirname(MAP_PATH), { recursive: true });
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
    return ZONE_EFFECTS[zoneName(position)] ?? ZONE_EFFECTS['Residential'];
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

  private _load(): void {
    if (!existsSync(MAP_PATH)) return;
    try {
      const saved = JSON.parse(readFileSync(MAP_PATH, 'utf8')) as { buildings?: Building[] };
      if (saved.buildings) {
        for (const b of saved.buildings) this.buildings.set(b.id, b);
      }
    } catch { /* use defaults */ }
  }

  private _save(): void {
    try {
      writeFileSync(MAP_PATH, JSON.stringify({
        buildings: Array.from(this.buildings.values()),
      }, null, 2));
    } catch { /* ignore */ }
  }
}
