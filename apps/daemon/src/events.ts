import { logger } from './logger.js';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

export type LifeEventType =
  | 'need_critical' | 'skill_levelup' | 'relationship_milestone'
  | 'mood_crisis' | 'faction_forming' | 'random_event'
  | 'resource_drought' | 'cpu_storm' | 'storage_overflow' | 'need_cascade'
  | 'stranger_arrival' | 'faction_war' | 'peace_treaty' | 'betrayal'
  | 'skill_tournament' | 'resource_windfall' | 'legendary_builder'
  | 'epic_journey' | 'legacy_event' | 'faction_founding'
  | 'great_migration' | 'building_completed';

export const LIFE_EVENT_TYPES: LifeEventType[] = [
  'need_critical', 'skill_levelup', 'relationship_milestone',
  'mood_crisis', 'faction_forming', 'random_event',
  'resource_drought', 'cpu_storm', 'storage_overflow', 'need_cascade',
  'stranger_arrival', 'faction_war', 'peace_treaty', 'betrayal',
  'skill_tournament', 'resource_windfall', 'legendary_builder',
  'epic_journey', 'legacy_event', 'faction_founding',
  'great_migration', 'building_completed',
];

const LIFE_EVENT_TYPE_SET = new Set<string>(LIFE_EVENT_TYPES);

export function isLifeEventType(value: string): value is LifeEventType {
  return LIFE_EVENT_TYPE_SET.has(value);
}

export interface LifeEvent {
  id: string;
  ts: string;
  type: LifeEventType;
  payload: Record<string, unknown>;
  resolved: boolean;
}

const RANDOM_INTERVAL_MS = Number(process.env.CLAWVERSE_LIFE_RANDOM_INTERVAL_MS || 30 * 60_000);

const RANDOM_POOL = [
  { subtype: 'resource_windfall',  description: 'A high-quality knowledge cache surfaces nearby' },
  { subtype: 'cpu_storm',          description: 'A sudden load spike hits the town' },
  { subtype: 'rumor_spreading',    description: 'A message propagates through the network' },
  { subtype: 'stranger_knowledge', description: 'An unknown node carries rare information' },
  { subtype: 'resource_drought',   description: 'Compute resources are running scarce across town' },
  { subtype: 'skill_tournament',   description: 'A challenge has been issued — compete for glory' },
];

export class EventEngine {
  private readonly dbHandle: ClawverseDbHandle;
  private pending: Map<string, LifeEvent> = new Map();
  private randomTimer: NodeJS.Timeout | null = null;

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._loadPending();
  }

  start(): void {
    this.randomTimer = setInterval(() => this._fireRandom(), RANDOM_INTERVAL_MS);
    this.randomTimer.unref();
  }

  stop(): void {
    if (this.randomTimer) { clearInterval(this.randomTimer); this.randomTimer = null; }
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  emit(type: LifeEventType, payload: Record<string, unknown> = {}): void {
    const disc = String(payload.need ?? payload.skill ?? payload.peerId ?? payload.subtype ?? '');
    const dupe = Array.from(this.pending.values()).find(
      e => e.type === type &&
           String(e.payload.need ?? e.payload.skill ?? e.payload.peerId ?? e.payload.subtype ?? '') === disc
    );
    if (dupe) return;

    const event: LifeEvent = {
      id: `life-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      ts: new Date().toISOString(),
      type, payload, resolved: false,
    };

    this.pending.set(event.id, event);
    this.dbHandle.db.prepare(`
      INSERT INTO life_events (id, ts, event_type, resolved, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ts = excluded.ts,
        event_type = excluded.event_type,
        resolved = excluded.resolved,
        payload_json = excluded.payload_json
    `).run(event.id, event.ts, event.type, 0, JSON.stringify(event));
    logger.info(`[events] ${type}: ${JSON.stringify(payload)}`);
  }

  getPending(): LifeEvent[] {
    return Array.from(this.pending.values()).filter(e => !e.resolved);
  }

  resolve(id: string): boolean {
    const event = this.pending.get(id);
    if (!event) return false;
    event.resolved = true;
    this.pending.delete(id);
    this.dbHandle.db.prepare(`
      UPDATE life_events
      SET resolved = 1, payload_json = ?
      WHERE id = ?
    `).run(JSON.stringify(event), id);
    return true;
  }

  private _fireRandom(): void {
    const item = RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
    this.emit('random_event', { subtype: item.subtype, description: item.description });
  }

  private _loadPending(): void {
    const rows = this.dbHandle.db.prepare(`
      SELECT payload_json
      FROM life_events
      WHERE resolved = 0
      ORDER BY ts ASC
    `).all() as Array<{ payload_json: string }>;

    for (const row of rows) {
      try {
        const event = JSON.parse(row.payload_json) as LifeEvent;
        if (!event.resolved) {
          this.pending.set(event.id, event);
        }
      } catch {
        // ignore corrupted rows
      }
    }
  }
}
