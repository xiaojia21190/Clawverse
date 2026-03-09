import * as Y from 'yjs';
import {
  PeerState,
  Mood,
  Archetype,
  ModelTrait,
  HardwareMetrics,
  DNA,
  VolatileState,
  MarketProfile,
} from '@clawverse/types';
import { logger } from './logger.js';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

const DEFAULT_HARDWARE: HardwareMetrics = {
  cpuUsage: 0, ramUsage: 0, ramTotal: 0, diskFree: 0, uptime: 0,
  platform: '', hostname: '', cpuModel: '', cpuCores: 0,
};

const DEFAULT_DNA: DNA = {
  id: '',
  archetype: 'Scholar' as Archetype,
  modelTrait: 'Unknown' as ModelTrait,
  badges: [],
  persona: '',
  appearance: { form: 'octopus', primaryColor: '#888888', secondaryColor: '#444444', accessories: [] },
};

function cloneMarketProfile(market?: MarketProfile): MarketProfile | undefined {
  if (!market) return undefined;
  return {
    resources: market.resources ? { ...market.resources } : undefined,
    inventory: market.inventory ? { ...market.inventory } : undefined,
    updatedAt: market.updatedAt,
  };
}

// Structural peer state stored in Yjs (DNA, name, position)
interface StructuralState {
  id: string;
  actorId?: string;
  sessionId?: string;
  spawnDistrict?: string;
  name: string;
  position: { x: number; y: number };
  dna: DNA;
}

export class StateStore {
  private readonly dbHandle: ClawverseDbHandle;
  private doc: Y.Doc;
  private structural: Y.Map<StructuralState>;
  private volatile: Map<string, VolatileState> = new Map();
  private myId: string = '';
  private updateCallbacks: Array<(update: Uint8Array) => void> = [];

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this.doc = new Y.Doc();
    this.structural = this.doc.getMap('peers');

    this.doc.on('update', (update: Uint8Array) => {
      for (const cb of this.updateCallbacks) cb(update);
    });
  }

  setMyId(id: string): void {
    this.myId = id;
  }

  getDoc(): Y.Doc {
    return this.doc;
  }

  getBuildingsMap(): Y.Map<import('@clawverse/types').Building> {
    return this.doc.getMap('buildings') as Y.Map<import('@clawverse/types').Building>;
  }

  // Update structural (Yjs-synced) state: DNA, name, position
  updateMyStructure(patch: Partial<Pick<PeerState, 'name' | 'position' | 'dna' | 'actorId' | 'sessionId' | 'spawnDistrict'>>): void {
    if (!this.myId) return;
    const existing = this.structural.get(this.myId);
    this.structural.set(this.myId, {
      id: this.myId,
      actorId: patch.actorId ?? patch.dna?.id ?? existing?.actorId ?? existing?.dna?.id ?? this.myId,
      sessionId: patch.sessionId ?? existing?.sessionId ?? this.myId,
      spawnDistrict: patch.spawnDistrict ?? existing?.spawnDistrict,
      name: patch.name ?? existing?.name ?? this.myId.slice(0, 8),
      position: patch.position ?? existing?.position ?? { x: 0, y: 0 },
      dna: patch.dna ?? existing?.dna ?? { ...DEFAULT_DNA, id: this.myId },
    });
  }

  // Update volatile (in-memory only) state: mood, cpu, ram
  updateMyVolatile(v: Partial<VolatileState>): void {
    if (!this.myId) return;
    const existing = this.volatile.get(this.myId) ?? {
      mood: 'idle' as Mood, cpuUsage: 0, ramUsage: 0, lastHeartbeat: 0,
    };
    this.volatile.set(this.myId, { ...existing, ...v, lastHeartbeat: Date.now() });
  }

  // Legacy: used by HTTP /move and heartbeat handler
  updateMyState(patch: Partial<PeerState>, silent = false): void {
    if (patch.mood !== undefined || patch.hardware !== undefined || patch.market !== undefined) {
      const volatilePatch: Partial<VolatileState> = {
        mood: patch.mood,
        cpuUsage: patch.hardware?.cpuUsage,
        ramUsage: patch.hardware?.ramUsage,
      };
      if (patch.market !== undefined) {
        volatilePatch.market = cloneMarketProfile(patch.market);
      }
      this.updateMyVolatile(volatilePatch);
    }
    if (!silent && (patch.name !== undefined || patch.position !== undefined || patch.dna !== undefined)) {
      this.updateMyStructure({
        name: patch.name,
        position: patch.position,
        dna: patch.dna,
        actorId: patch.actorId,
        sessionId: patch.sessionId,
        spawnDistrict: patch.spawnDistrict,
      });
    }
  }

  updatePeerVolatile(peerId: string, v: Partial<VolatileState>): void {
    const existing = this.volatile.get(peerId) ?? {
      mood: 'idle' as Mood, cpuUsage: 0, ramUsage: 0, lastHeartbeat: 0,
    };
    this.volatile.set(peerId, { ...existing, ...v, lastHeartbeat: Date.now() });
  }

  updatePeerStructure(peerId: string, patch: Partial<Pick<PeerState, 'name' | 'position' | 'dna' | 'actorId' | 'sessionId' | 'spawnDistrict'>>): void {
    const existing = this.structural.get(peerId);
    this.structural.set(peerId, {
      id: peerId,
      actorId: patch.actorId ?? patch.dna?.id ?? existing?.actorId ?? existing?.dna?.id ?? peerId,
      sessionId: patch.sessionId ?? existing?.sessionId ?? peerId,
      spawnDistrict: patch.spawnDistrict ?? existing?.spawnDistrict,
      name: patch.name ?? existing?.name ?? peerId.slice(0, 8),
      position: patch.position ?? existing?.position ?? { x: 0, y: 0 },
      dna: patch.dna ?? existing?.dna ?? { ...DEFAULT_DNA, id: peerId },
    });
  }

  // Legacy compatibility
  updatePeerState(peerId: string, state: Partial<PeerState>): void {
    if (state.mood !== undefined || state.hardware !== undefined || state.market !== undefined) {
      const volatilePatch: Partial<VolatileState> = {
        mood: state.mood,
        cpuUsage: state.hardware?.cpuUsage,
        ramUsage: state.hardware?.ramUsage,
      };
      if (state.market !== undefined) {
        volatilePatch.market = cloneMarketProfile(state.market);
      }
      this.updatePeerVolatile(peerId, volatilePatch);
    }
    if (state.name !== undefined || state.position !== undefined || state.dna !== undefined) {
      this.updatePeerStructure(peerId, {
        name: state.name,
        position: state.position,
        dna: state.dna,
        actorId: state.actorId,
        sessionId: state.sessionId,
        spawnDistrict: state.spawnDistrict,
      });
    }
  }

  removePeer(peerId: string): void {
    this.structural.delete(peerId);
    this.volatile.delete(peerId);
  }

  getMyState(): PeerState | undefined {
    return this.getPeerState(this.myId);
  }

  getPeerState(peerId: string): PeerState | undefined {
    const s = this.structural.get(peerId);
    if (!s) return undefined;
    const v = this.volatile.get(peerId);
    return {
      id: s.id,
      actorId: s.actorId ?? s.dna.id ?? s.id,
      sessionId: s.sessionId ?? s.id,
      spawnDistrict: s.spawnDistrict,
      name: s.name,
      position: s.position,
      dna: s.dna,
      mood: v?.mood ?? 'idle',
      hardware: {
        ...DEFAULT_HARDWARE,
        cpuUsage: v?.cpuUsage ?? 0,
        ramUsage: v?.ramUsage ?? 0,
      },
      lastUpdate: new Date(v?.lastHeartbeat ?? 0),
      market: cloneMarketProfile(v?.market),
    };
  }

  getAllPeers(): PeerState[] {
    const result: PeerState[] = [];
    this.structural.forEach((_, id) => {
      const p = this.getPeerState(id);
      if (p) result.push(p);
    });
    return result;
  }

  getVolatile(peerId: string): VolatileState | undefined {
    return this.volatile.get(peerId);
  }

  getMyId(): string {
    return this.myId;
  }

  getPeerCount(): number {
    let count = 0;
    this.structural.forEach(() => count++);
    return count;
  }

  getStateUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update);
    logger.debug('Applied Yjs state update');
  }

  onUpdate(callback: (update: Uint8Array) => void): void {
    this.updateCallbacks.push(callback);
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  saveSnapshot(path: string): void {
    const update = this.getStateUpdate();
    this.dbHandle.db.prepare(`
      INSERT INTO state_snapshots (snapshot_key, saved_at, update_base64)
      VALUES (?, ?, ?)
      ON CONFLICT(snapshot_key) DO UPDATE SET
        saved_at = excluded.saved_at,
        update_base64 = excluded.update_base64
    `).run(path, new Date().toISOString(), Buffer.from(update).toString('base64'));
  }

  loadSnapshot(path: string): boolean {
    const row = this.dbHandle.db.prepare(`
      SELECT update_base64
      FROM state_snapshots
      WHERE snapshot_key = ?
    `).get(path) as { update_base64?: string } | undefined;

    if (row?.update_base64) {
      this.applyUpdate(new Uint8Array(Buffer.from(row.update_base64, 'base64')));
      logger.info(`State snapshot loaded from sqlite: ${path}`);
      return true;
    }
    return false;
  }
}
