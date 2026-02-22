import * as Y from 'yjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  PeerState,
  Mood,
  Archetype,
  ModelTrait,
  HardwareMetrics,
  DNA,
  VolatileState,
} from '@clawverse/types';
import { logger } from './logger.js';

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

// Structural peer state stored in Yjs (DNA, name, position)
interface StructuralState {
  id: string;
  name: string;
  position: { x: number; y: number };
  dna: DNA;
}

export class StateStore {
  private doc: Y.Doc;
  private structural: Y.Map<StructuralState>;
  private volatile: Map<string, VolatileState> = new Map();
  private myId: string = '';
  private updateCallbacks: Array<(update: Uint8Array) => void> = [];

  constructor() {
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

  // Update structural (Yjs-synced) state: DNA, name, position
  updateMyStructure(patch: Partial<Pick<PeerState, 'name' | 'position' | 'dna'>>): void {
    if (!this.myId) return;
    const existing = this.structural.get(this.myId);
    this.structural.set(this.myId, {
      id: this.myId,
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
    if (patch.mood !== undefined || patch.hardware !== undefined) {
      this.updateMyVolatile({
        mood: patch.mood,
        cpuUsage: patch.hardware?.cpuUsage,
        ramUsage: patch.hardware?.ramUsage,
      });
    }
    if (!silent && (patch.name !== undefined || patch.position !== undefined || patch.dna !== undefined)) {
      this.updateMyStructure({ name: patch.name, position: patch.position, dna: patch.dna });
    }
  }

  updatePeerVolatile(peerId: string, v: Partial<VolatileState>): void {
    const existing = this.volatile.get(peerId) ?? {
      mood: 'idle' as Mood, cpuUsage: 0, ramUsage: 0, lastHeartbeat: 0,
    };
    this.volatile.set(peerId, { ...existing, ...v, lastHeartbeat: Date.now() });
  }

  updatePeerStructure(peerId: string, patch: Partial<Pick<PeerState, 'name' | 'position' | 'dna'>>): void {
    const existing = this.structural.get(peerId);
    this.structural.set(peerId, {
      id: peerId,
      name: patch.name ?? existing?.name ?? peerId.slice(0, 8),
      position: patch.position ?? existing?.position ?? { x: 0, y: 0 },
      dna: patch.dna ?? existing?.dna ?? { ...DEFAULT_DNA, id: peerId },
    });
  }

  // Legacy compatibility
  updatePeerState(peerId: string, state: Partial<PeerState>): void {
    if (state.mood !== undefined || state.hardware !== undefined) {
      this.updatePeerVolatile(peerId, {
        mood: state.mood,
        cpuUsage: state.hardware?.cpuUsage,
        ramUsage: state.hardware?.ramUsage,
      });
    }
    if (state.name !== undefined || state.position !== undefined || state.dna !== undefined) {
      this.updatePeerStructure(peerId, { name: state.name, position: state.position, dna: state.dna });
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

  saveSnapshot(path: string): void {
    const update = this.getStateUpdate();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({
      savedAt: new Date().toISOString(),
      updateBase64: Buffer.from(update).toString('base64'),
    }, null, 2));
  }

  loadSnapshot(path: string): boolean {
    try {
      const raw = readFileSync(path, 'utf8');
      const data = JSON.parse(raw) as { updateBase64?: string };
      if (!data.updateBase64) return false;
      this.applyUpdate(new Uint8Array(Buffer.from(data.updateBase64, 'base64')));
      logger.info(`State snapshot loaded: ${path}`);
      return true;
    } catch {
      return false;
    }
  }
}
