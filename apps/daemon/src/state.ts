import * as Y from 'yjs';
import { PeerState, Position, Mood, Archetype, ModelTrait, HardwareMetrics, DNA } from '@clawverse/types';
import { logger } from './logger.js';

// Default hardware metrics
const DEFAULT_HARDWARE: HardwareMetrics = {
  cpuUsage: 0,
  ramUsage: 0,
  ramTotal: 0,
  diskFree: 0,
  uptime: 0,
  platform: '',
  hostname: '',
  cpuModel: '',
  cpuCores: 0,
};

// Default DNA
const DEFAULT_DNA: DNA = {
  id: '',
  archetype: 'Scholar' as Archetype,
  modelTrait: 'Unknown' as ModelTrait,
  badges: [],
  persona: '',
  appearance: {
    form: 'octopus',
    primaryColor: '#888888',
    secondaryColor: '#444444',
    accessories: [],
  },
};

export class StateStore {
  private doc: Y.Doc;
  private peers: Y.Map<PeerState>;
  private myId: string = '';
  private updateCallbacks: Array<(update: Uint8Array) => void> = [];

  constructor() {
    this.doc = new Y.Doc();
    this.peers = this.doc.getMap('peers');

    // Listen for document updates
    this.doc.on('update', (update: Uint8Array) => {
      for (const callback of this.updateCallbacks) {
        callback(update);
      }
    });
  }

  setMyId(id: string): void {
    this.myId = id;
  }

  getDoc(): Y.Doc {
    return this.doc;
  }

  updateMyState(state: Partial<PeerState>): void {
    if (!this.myId) return;

    const existing = this.peers.get(this.myId);
    const updated: PeerState = {
      id: this.myId,
      name: state.name || existing?.name || this.myId.slice(0, 8),
      position: state.position || existing?.position || { x: 0, y: 0 },
      mood: state.mood || existing?.mood || 'idle',
      hardware: state.hardware || existing?.hardware || DEFAULT_HARDWARE,
      dna: state.dna || existing?.dna || { ...DEFAULT_DNA, id: this.myId },
      lastUpdate: new Date(),
    };

    this.peers.set(this.myId, updated);
    logger.debug('My state updated');
  }

  updatePeerState(peerId: string, state: Partial<PeerState>): void {
    const existing = this.peers.get(peerId);

    const updated: PeerState = {
      id: peerId,
      name: state.name || existing?.name || peerId.slice(0, 8),
      position: state.position || existing?.position || { x: 0, y: 0 },
      mood: state.mood || existing?.mood || 'idle',
      hardware: state.hardware || existing?.hardware || DEFAULT_HARDWARE,
      dna: state.dna || existing?.dna || { ...DEFAULT_DNA, id: peerId },
      lastUpdate: new Date(),
    };

    this.peers.set(peerId, updated);
    logger.debug(`Peer ${peerId} state updated`);
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
    logger.debug(`Removed peer state: ${peerId}`);
  }

  getPeerState(peerId: string): PeerState | undefined {
    return this.peers.get(peerId);
  }

  getMyState(): PeerState | undefined {
    return this.peers.get(this.myId);
  }

  getAllPeers(): PeerState[] {
    const result: PeerState[] = [];
    this.peers.forEach((value) => {
      result.push(value);
    });
    return result;
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

  getPeerCount(): number {
    let count = 0;
    this.peers.forEach(() => count++);
    return count;
  }
}
