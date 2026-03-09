import { EventEmitter } from 'node:events';
import {
  SocialEvent,
  SocialRelationship,
  SocialTrigger,
  RelationshipTier,
  PeerState,
} from '@clawverse/types';
import { logger } from './logger.js';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

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
  fromActorId: string;
  fromSessionId: string;
  fromName: string;
  fromArchetype: string;
  fromMood: string;
  fromCpu: number;
  fromPos: { x: number; y: number };
  to: string;
  toActorId: string;
  toSessionId: string;
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
  private readonly dbHandle: ClawverseDbHandle;
  private relationships: Map<string, SocialRelationship> = new Map();
  private lastLlmCall: Map<string, number> = new Map();
  private lastEventTime: number = Date.now();
  private scanTimer: NodeJS.Timeout | null = null;
  private scanRunning = false;
  private myId: string = '';
  private pending: Map<string, PendingEvent> = new Map();

  private getPeers: () => PeerState[] = () => [];
  private getMyState: () => PeerState | undefined = () => undefined;

  constructor(opts?: { dbPath?: string }) {
    super();
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._loadRelationships();
    this._loadPending();
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
    this.scanTimer = setInterval(() => {
      void this._scanTick();
    }, SCAN_INTERVAL_MS);
    this.scanTimer.unref();
    logger.info('Social system started (OpenClaw-driven mode)');
  }

  stop(): void {
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
    this._saveRelationships();
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  async onPeerConnect(peer: PeerState): Promise<void> {
    const rel = this._getOrCreateRel(peer);
    rel.meetCount += 1;
    rel.lastMet = new Date().toISOString();
    await this._enqueuePending('new-peer', peer);
  }

  // Called by HTTP handler when OpenClaw resolves a pending event
  resolveEvent(
    id: string,
    dialogue: string,
    onTierChange?: (prev: RelationshipTier, next: RelationshipTier, peerId: string) => void,
  ): SocialEvent | null {
    const pending = this.pending.get(id);
    if (!pending) return null;

    pending.resolved = true;
    this.pending.delete(id);
    this.dbHandle.db.prepare(`
      UPDATE social_pending
      SET resolved = 1, payload_json = ?
      WHERE id = ?
    `).run(JSON.stringify(pending), id);

    const rel = this._getOrCreateRel(pending.toActorId || pending.to);
    const sentimentBefore = pending.sentimentBefore;
    rel.sentiment = Math.min(1, rel.sentiment + 0.05);
    rel.meetCount = pending.meetCount + 1;
    rel.lastMet = new Date().toISOString();
    rel.interactionCount = (rel.interactionCount ?? 0) + 1;

    this._recomputeTier(rel, (prev, next) => {
      if (onTierChange) onTierChange(prev, next, pending.to);
    }, pending.toName ?? '');

    const event: SocialEvent = {
      id: pending.id,
      ts: new Date().toISOString(),
      trigger: pending.trigger,
      from: pending.from,
      fromActorId: pending.fromActorId,
      fromSessionId: pending.fromSessionId,
      to: pending.to,
      toActorId: pending.toActorId,
      toSessionId: pending.toSessionId,
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
    const actorId = this._actorIdFor(peerId);
    const rel = this.relationships.get(actorId);
    return rel ? this._hydrateRelationship(rel) : undefined;
  }

  getAllRelationships(): SocialRelationship[] {
    return Array.from(this.relationships.values()).map((rel) => this._hydrateRelationship(rel));
  }

  private async _scanTick(): Promise<void> {
    if (this.scanRunning) return;
    this.scanRunning = true;
    try {
      await this._scan();
    } catch (err) {
      logger.warn(`Social scan failed: ${(err as Error).message}`);
    } finally {
      this.scanRunning = false;
    }
  }

  private async _scan(): Promise<void> {
    const me = this.getMyState();
    const myActorId = me ? this._actorIdFor(me) : this.myId;
    const peers = this.getPeers().filter((p) => this._actorIdFor(p) !== myActorId);

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

    const fromActorId = this._actorIdFor(me);
    const toActorId = this._actorIdFor(target);
    const pairKey = [fromActorId, toActorId].sort().join(':');
    const now = Date.now();
    if (now - (this.lastLlmCall.get(pairKey) ?? 0) < LLM_COOLDOWN_MS) return;
    this.lastLlmCall.set(pairKey, now);
    this.lastEventTime = now;

    const rel = this._getOrCreateRel(target);

    const pending: PendingEvent = {
      id: `soc-${now}-${Math.random().toString(16).slice(2, 6)}`,
      ts: new Date().toISOString(),
      trigger,
      from: this.myId,
      fromActorId,
      fromSessionId: this._sessionIdFor(me),
      fromName: me.name,
      fromArchetype: me.dna.archetype,
      fromMood: me.mood,
      fromCpu: me.hardware.cpuUsage,
      fromPos: me.position,
      to: target.id,
      toActorId,
      toSessionId: this._sessionIdFor(target),
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

  getTier(peerId: string): RelationshipTier {
    return this.relationships.get(this._actorIdFor(peerId))?.tier ?? 'stranger';
  }

  private _matchesPeerIdentity(peer: PeerState, id: string): boolean {
    return peer.id === id || peer.sessionId === id || peer.actorId === id || peer.dna.id === id;
  }

  private _findPeer(id: string): PeerState | undefined {
    const me = this.getMyState();
    if (me && this._matchesPeerIdentity(me, id)) return me;
    return this.getPeers().find((peer) => this._matchesPeerIdentity(peer, id));
  }

  private _actorIdFor(peerOrId: PeerState | string): string {
    if (typeof peerOrId !== 'string') return peerOrId.actorId ?? peerOrId.dna.id ?? peerOrId.id;
    return this._findPeer(peerOrId)?.actorId ?? this._findPeer(peerOrId)?.dna.id ?? peerOrId;
  }

  private _sessionIdFor(peerOrId: PeerState | string): string {
    if (typeof peerOrId !== 'string') return peerOrId.sessionId ?? peerOrId.id;
    return this._findPeer(peerOrId)?.sessionId ?? this._findPeer(peerOrId)?.id ?? peerOrId;
  }

  private _hydrateRelationship(rel: SocialRelationship): SocialRelationship {
    const actorId = rel.actorId ?? this._actorIdFor(rel.peerId);
    const peer = this._findPeer(actorId) ?? this._findPeer(rel.sessionId ?? rel.peerId);
    const sessionId = peer?.sessionId ?? peer?.id ?? rel.sessionId ?? rel.peerId;
    const peerIds = Array.from(new Set([
      ...(Array.isArray(rel.peerIds) ? rel.peerIds : []),
      rel.peerId,
      rel.sessionId,
      sessionId,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0)));

    return {
      ...rel,
      actorId,
      sessionId,
      peerId: sessionId,
      peerIds,
    };
  }

  private _recomputeTier(
    rel: SocialRelationship,
    onMilestone?: (prev: RelationshipTier, next: RelationshipTier, peerName: string) => void,
    peerName = '',
  ): void {
    const prev = rel.tier ?? 'stranger';
    const ic = rel.interactionCount ?? 0;
    const s = rel.sentiment;

    let tier: RelationshipTier = 'stranger';
    if      (ic >= 15 && s >  0.6) tier = 'ally';
    else if (ic >=  8 && s >  0.3) tier = 'friend';
    else if (ic >=  3 && s >  0  ) tier = 'acquaintance';
    else if (ic >=  8 && s < -0.5) tier = 'nemesis';
    else if (ic >=  3 && s < -0.2) tier = 'rival';

    rel.tier = tier;
    if (tier !== prev) {
      rel.notableEvents = [
        ...(rel.notableEvents ?? []).slice(-4),
        `became ${tier} with ${peerName || rel.peerId}`,
      ];
      if (onMilestone) onMilestone(prev, tier, peerName);
    }
  }

  private _getOrCreateRel(peerOrId: PeerState | string): SocialRelationship {
    const actorId = this._actorIdFor(peerOrId);
    if (!this.relationships.has(actorId)) {
      const sessionId = this._sessionIdFor(peerOrId);
      this.relationships.set(actorId, {
        peerId: sessionId,
        actorId,
        sessionId,
        peerIds: [sessionId],
        meetCount: 0,
        sentiment: 0,
        lastMet: new Date().toISOString(),
        tags: [],
        interactionCount: 0,
        tier: 'stranger',
        notableEvents: [],
      });
    }
    const rel = this.relationships.get(actorId)!;
    const hydrated = this._hydrateRelationship(rel);
    this.relationships.set(actorId, hydrated);
    return hydrated;
  }

  private _appendEvent(event: SocialEvent): void {
    this.dbHandle.db.prepare(`
      INSERT INTO social_events (id, ts, payload_json)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ts = excluded.ts,
        payload_json = excluded.payload_json
    `).run(event.id, event.ts, JSON.stringify(event));
  }

  private _appendPending(pending: PendingEvent): void {
    this.dbHandle.db.prepare(`
      INSERT INTO social_pending (id, ts, resolved, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ts = excluded.ts,
        resolved = excluded.resolved,
        payload_json = excluded.payload_json
    `).run(pending.id, pending.ts, pending.resolved ? 1 : 0, JSON.stringify(pending));
  }

  private _loadRelationships(): void {
    const rows = this.dbHandle.db.prepare(`
      SELECT peer_id, payload_json
      FROM social_relationships
    `).all() as Array<{ peer_id: string; payload_json: string }>;

    if (rows.length > 0) {
      for (const row of rows) {
        try {
          const rel = JSON.parse(row.payload_json) as SocialRelationship;
          const daysSince = (Date.now() - new Date(rel.lastMet).getTime()) / 86_400_000;
          rel.sentiment = Math.max(-1, rel.sentiment - 0.01 * daysSince);
          rel.actorId = rel.actorId ?? row.peer_id;
          rel.sessionId = rel.sessionId ?? rel.peerId ?? row.peer_id;
          rel.peerId = rel.peerId ?? rel.sessionId;
          rel.peerIds = Array.from(new Set([
            ...(Array.isArray(rel.peerIds) ? rel.peerIds : []),
            rel.peerId,
            rel.sessionId,
          ].filter((value): value is string => typeof value === 'string' && value.length > 0)));
          this.relationships.set(rel.actorId, rel);
        } catch {
          // ignore bad row
        }
      }
    }
  }

  private _saveRelationships(): void {
    const db = this.dbHandle.db;
    const upsert = this.dbHandle.db.prepare(`
      INSERT INTO social_relationships (peer_id, payload_json)
      VALUES (?, ?)
      ON CONFLICT(peer_id) DO UPDATE SET
        payload_json = excluded.payload_json
    `);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM social_relationships');
      for (const [actorId, rel] of this.relationships) {
        upsert.run(actorId, JSON.stringify(this._hydrateRelationship(rel)));
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    }
  }

  private _loadPending(): void {
    const rows = this.dbHandle.db.prepare(`
      SELECT payload_json
      FROM social_pending
      WHERE resolved = 0
      ORDER BY ts ASC
    `).all() as Array<{ payload_json: string }>;

    for (const row of rows) {
      try {
        const pending = JSON.parse(row.payload_json) as PendingEvent;
        if (!pending.resolved) {
          this.pending.set(pending.id, pending);
        }
      } catch {
        // ignore bad row
      }
    }
  }
}
