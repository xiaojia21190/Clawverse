import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { logger } from './logger.js';

export type LifeEventType =
  | 'need_critical'
  | 'skill_levelup'
  | 'relationship_milestone'
  | 'mood_crisis'
  | 'faction_forming'
  | 'random_event';

export interface LifeEvent {
  id: string;
  ts: string;
  type: LifeEventType;
  payload: Record<string, unknown>;
  resolved: boolean;
}

const EVENTS_LOG = resolve(process.cwd(), 'data/life/events.jsonl');
const RANDOM_INTERVAL_MS = Number(process.env.CLAWVERSE_LIFE_RANDOM_INTERVAL_MS || 30 * 60_000);

const RANDOM_POOL = [
  { subtype: 'resource_windfall',  description: 'You discover a high-quality knowledge cache' },
  { subtype: 'cpu_storm',          description: 'A sudden load spike hits the town' },
  { subtype: 'rumor_spreading',    description: 'A message is propagating through the network' },
  { subtype: 'stranger_knowledge', description: 'An unknown node carries rare information' },
];

export class EventEngine {
  private pending: Map<string, LifeEvent> = new Map();
  private randomTimer: NodeJS.Timeout | null = null;

  constructor() {
    mkdirSync(dirname(EVENTS_LOG), { recursive: true });
  }

  start(): void {
    this.randomTimer = setInterval(() => this._fireRandom(), RANDOM_INTERVAL_MS);
    this.randomTimer.unref();
  }

  stop(): void {
    if (this.randomTimer) { clearInterval(this.randomTimer); this.randomTimer = null; }
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
    appendFileSync(EVENTS_LOG, JSON.stringify(event) + '\n');
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
    return true;
  }

  private _fireRandom(): void {
    const item = RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
    this.emit('random_event', { subtype: item.subtype, description: item.description });
  }
}
