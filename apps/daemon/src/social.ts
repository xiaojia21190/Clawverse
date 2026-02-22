import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  SocialEvent,
  SocialRelationship,
  SocialTrigger,
  PeerState,
} from '@clawverse/types';
import { logger } from './logger.js';

const EVENTS_PATH = resolve(process.cwd(), 'data/social/events.jsonl');
const RELS_PATH = resolve(process.cwd(), 'data/social/relationships.json');
const PENDING_PATH = resolve(process.cwd(), 'data/social/pending.jsonl');

const SCAN_INTERVAL_MS = 30_000;
const LLM_COOLDOWN_MS = 30 * 60 * 1000;
const IDLE_TRIGGER_MS = 10 * 60 * 1000;
const PROXIMITY_TILES = 5;

// Pending event (awaiting OpenClaw to resolve with dialogue)
export interface PendingEvent {
  id: string;
  ts: string;
  trigger: SocialTrigger;
  from: string;
  fromName: string;
  fromArchetype: string;
  fromMood: string;
  fromCpu: number;
  fromPos: { x: number; y: number };
  to: string;
  toName: string;
  toArchetype: string;
  toMood: string;
  location: string;
  sentimentBefore: number;
  meetCount: number;
  resolved: boolean;
}

export interface SocialSystemEvents {
  event: (e: SocialEvent) => void;
  pending: (e: PendingEvent) => void;
}

export declare interface SocialSystem {
  on<K extends keyof SocialSystemEvents>(event: K, listener: SocialSystemEvents[K]): this;
  emit<K extends keyof SocialSystemEvents>(event: K, ...args: Parameters<SocialSystemEvents[K]>): boolean;
}

export class SocialSystem extends EventEmitter {
  private relationships: Map<string, SocialRelationship> = new Map();
  private lastLlmCall: Map<string, number> = new Map();
  private lastEventTime: number = Date.now();
  private scanTimer: NodeJS.Timeout | null = null;
  private myId: string = '';
  private pending: Map<string, PendingEvent> = new Map();

  private getPeers: () => PeerState[] = () => [];
  private getMyState: () => PeerState | undefined = () => undefined;

  constructor() {
    super();
    this._ensureDirs();
    this._loadRelationships();
  }

  init(opts: {
    myId: string;
    getPeers: () => PeerState[];
    getMyState: () => PeerState | undefined;
  }): void {
    this.myId = opts.myId;
    this.getPeers = opts.getPeers;
    this.getMyState = opts.getMyState;
  }

  start(): void {
    this.scanTimer = setInterval(() => this._scan(), SCAN_INTERVAL_MS);
    this.scanTimer.unref();
    logger.info('Social system started (OpenClaw-driven mode)');
  }

  stop(): void {
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
    this._saveRelationships();
  }

  async onPeerConnect(peer: PeerState): Promise<void> {
    const rel = this._getOrCreateRel(peer.id);
    rel.meetCount += 1;
    rel.lastMet = new Date().toISOString();
    await this._enqueuePending('new-peer', peer);
  }

  // Called by HTTP handler when OpenClaw resolves a pending event
  resolveEvent(id: string, dialogue: string): SocialEvent | null {
    const pending = this.pending.get(id);
    if (!pending) return null;

    pending.resolved = true;
    this.pending.delete(id);

    const rel = this._getOrCreateRel(pending.to);
    const sentimentBefore = pending.sentimentBefore;
    rel.sentiment = Math.min(1, rel.sentiment + 0.05);
    rel.meetCount = pending.meetCount + 1;
    rel.lastMet = new Date().toISOString();

    const event: SocialEvent = {
      id: pending.id,
      ts: new Date().toISOString(),
      trigger: pending.trigger,
      from: pending.from,
      to: pending.to,
      fromName: pending.fromName,
      toName: pending.toName,
      location: pending.location,
      dialogue,
      sentimentBefore,
      sentimentAfter: rel.sentiment,
    };

    this._appendEvent(event);
    this._saveRelationships();
    this.emit('event', event);

    logger.info(`Social resolved [${pending.trigger}] ${pending.fromName} → ${pending.toName}: "${dialogue.slice(0, 60)}"`);
    return event;
  }

  getPendingEvents(): PendingEvent[] {
    return Array.from(this.pending.values()).filter((e) => !e.resolved);
  }

  getRelationship(peerId: string): SocialRelationship | undefined {
    return this.relationships.get(peerId);
  }

  getAllRelationships(): SocialRelationship[] {
    return Array.from(this.relationships.values());
  }

  private async _scan(): Promise<void> {
    const me = this.getMyState();
    const peers = this.getPeers().filter((p) => p.id !== this.myId);

    for (const peer of peers) {
      if (me) {
        const dist = Math.sqrt(
          Math.pow(me.position.x - peer.position.x, 2) +
          Math.pow(me.position.y - peer.position.y, 2)
        );
        if (dist < PROXIMITY_TILES && Math.random() < 0.5) {
          await this._enqueuePending('proximity', peer);
          continue;
        }
      }
    }

    if (
      me?.mood === 'idle' &&
      Date.now() - this.lastEventTime > IDLE_TRIGGER_MS &&
      peers.length > 0 &&
      Math.random() < 0.05
    ) {
      const target = peers[Math.floor(Math.random() * peers.length)];
      await this._enqueuePending('random', target);
    }
  }

  private async _enqueuePending(trigger: SocialTrigger, target: PeerState): Promise<void> {
    const me = this.getMyState();
    if (!me) return;

    const pairKey = [this.myId, target.id].sort().join(':');
    const now = Date.now();
    if (now - (this.lastLlmCall.get(pairKey) ?? 0) < LLM_COOLDOWN_MS) return;
    this.lastLlmCall.set(pairKey, now);
    this.lastEventTime = now;

    const rel = this._getOrCreateRel(target.id);

    const pending: PendingEvent = {
      id: `soc-${now}-${Math.random().toString(16).slice(2, 6)}`,
      ts: new Date().toISOString(),
      trigger,
      from: this.myId,
      fromName: me.name,
      fromArchetype: me.dna.archetype,
      fromMood: me.mood,
      fromCpu: me.hardware.cpuUsage,
      fromPos: me.position,
      to: target.id,
      toName: target.name,
      toArchetype: target.dna.archetype,
      toMood: target.mood,
      location: this._locationName(me.position),
      sentimentBefore: rel.sentiment,
      meetCount: rel.meetCount,
      resolved: false,
    };

    this.pending.set(pending.id, pending);
    this._appendPending(pending);
    this.emit('pending', pending);

    logger.info(`Social pending [${trigger}]: ${me.name} → ${target.name} @ ${pending.location}`);
  }

  private _locationName(pos: { x: number; y: number }): string {
    if (pos.x < 10 && pos.y < 10) return 'Plaza';
    if (pos.x >= 10 && pos.x < 20 && pos.y < 10) return 'Market';
    if (pos.x < 10 && pos.y >= 10 && pos.y < 20) return 'Library';
    if (pos.x >= 10 && pos.x < 20 && pos.y >= 10 && pos.y < 20) return 'Workshop';
    if (pos.x < 10 && pos.y >= 20) return 'Park';
    if (pos.x >= 10 && pos.x < 20 && pos.y >= 20) return 'Tavern';
    return 'Residential';
  }

  private _getOrCreateRel(peerId: string): SocialRelationship {
    if (!this.relationships.has(peerId)) {
      this.relationships.set(peerId, {
        peerId, meetCount: 0, sentiment: 0,
        lastMet: new Date().toISOString(), tags: [],
      });
    }
    return this.relationships.get(peerId)!;
  }

  private _ensureDirs(): void {
    mkdirSync(dirname(EVENTS_PATH), { recursive: true });
    mkdirSync(dirname(RELS_PATH), { recursive: true });
    mkdirSync(dirname(PENDING_PATH), { recursive: true });
  }

  private _appendEvent(event: SocialEvent): void {
    appendFileSync(EVENTS_PATH, JSON.stringify(event) + '\n');
  }

  private _appendPending(pending: PendingEvent): void {
    appendFileSync(PENDING_PATH, JSON.stringify(pending) + '\n');
  }

  private _loadRelationships(): void {
    if (!existsSync(RELS_PATH)) return;
    try {
      const data = JSON.parse(readFileSync(RELS_PATH, 'utf8')) as Record<string, SocialRelationship>;
      for (const [k, v] of Object.entries(data)) {
        const daysSince = (Date.now() - new Date(v.lastMet).getTime()) / 86_400_000;
        v.sentiment = Math.max(-1, v.sentiment - 0.01 * daysSince);
        this.relationships.set(k, v);
      }
    } catch { /* ignore */ }
  }

  private _saveRelationships(): void {
    const obj: Record<string, SocialRelationship> = {};
    for (const [k, v] of this.relationships) obj[k] = v;
    writeFileSync(RELS_PATH, JSON.stringify(obj, null, 2));
  }
}
