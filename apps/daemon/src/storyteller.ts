import type { StorytellerMode } from '@clawverse/types';
import type { EventEngine, LifeEventType } from './events.js';
import type { StateStore } from './state.js';
import type { SocialSystem } from './social.js';
import type { NeedsSystem } from './needs.js';
import type { EconomySystem } from './economy.js';
import type { FactionSystem } from './faction.js';
import { logger } from './logger.js';

export type { StorytellerMode };

interface Snapshot {
  peerCount: number;
  distressedCount: number;
  allyCount: number;
  nemesisCount: number;
  avgCompute: number;
  criticalNeedsCount: number;
  factionCount: number;
  activeWarCount: number;
}

function tension(s: Snapshot): number {
  return Math.max(0, Math.min(100,
    s.distressedCount * 20 + s.nemesisCount * 15 +
    s.criticalNeedsCount * 10 + Math.max(0, 50 - s.avgCompute) +
    s.activeWarCount * 20 -
    s.allyCount * 5
  ));
}

export class Storyteller {
  private mode: StorytellerMode = 'Cassandra';
  private scanTimer: NodeJS.Timeout | null = null;
  private chainTimers: NodeJS.Timeout[] = [];

  constructor(
    private readonly events: EventEngine,
    private readonly state: StateStore,
    private readonly social: SocialSystem,
    private readonly needs: NeedsSystem,
    private readonly economy: EconomySystem,
    private readonly faction?: FactionSystem,
  ) {}

  setMode(mode: StorytellerMode): void {
    this.mode = mode;
    logger.info(`[storyteller] mode=${mode}`);
  }

  getMode(): StorytellerMode { return this.mode; }

  getTension(): number { return tension(this._snap()); }

  start(): void {
    this.scanTimer = setInterval(() => this._scan(), 60_000);
    this.scanTimer.unref();
    logger.info(`[storyteller] started mode=${this.mode}`);
  }

  stop(): void {
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
    this.chainTimers.forEach(clearTimeout);
    this.chainTimers = [];
  }

  private _snap(): Snapshot {
    const peers = this.state.getAllPeers();
    const rels = this.social.getAllRelationships();
    const n = this.needs.getNeeds();
    return {
      peerCount: peers.length,
      distressedCount: peers.filter(p => p.mood === 'distressed').length,
      allyCount: rels.filter(r => r.tier === 'ally').length,
      nemesisCount: rels.filter(r => r.tier === 'nemesis').length,
      avgCompute: this.economy.getResources().compute,
      criticalNeedsCount: (['social', 'tasked', 'wanderlust', 'creative'] as const)
        .filter(k => n[k] < 15).length,
      factionCount: this.faction?.getFactionCount() ?? 0,
      activeWarCount: this.faction?.getActiveWarCount() ?? 0,
    };
  }

  private _emit(type: LifeEventType, payload: Record<string, unknown> = {}): void {
    this.events.emit(type, { ...payload, source: 'storyteller' });
  }

  private _scan(): void {
    const snap = this._snap();
    const t = tension(snap);
    logger.info(`[storyteller] tension=${t} mode=${this.mode} peers=${snap.peerCount}`);
    if (this.mode === 'Randy') this._randy();
    else if (this.mode === 'Cassandra') this._cassandra(snap, t);
    else this._phoebe(snap, t);
  }

  private _randy(): void {
    const pool: LifeEventType[] = [
      'resource_windfall', 'cpu_storm', 'skill_tournament',
      'resource_drought', 'stranger_arrival', 'great_migration',
    ];
    this._emit(pool[Math.floor(Math.random() * pool.length)]);
  }

  private _cassandra(snap: Snapshot, t: number): void {
    if (t < 20) {
      this._emit('resource_drought', { severity: 'mild' });
      const timer = setTimeout(() => {
        if (this.getTension() < 30) this._emit('need_cascade', { triggered_by: 'resource_drought' });
      }, 3 * 60_000);
      this.chainTimers.push(timer);
    } else if (t > 75) {
      this._emit('resource_windfall', { reason: 'mercy' });
    } else {
      if (snap.allyCount >= 3) this._emit('faction_founding', { allyCount: snap.allyCount });
      if (snap.distressedCount >= 2) this._emit('mood_crisis', { count: snap.distressedCount });
      if (snap.factionCount >= 2 && snap.activeWarCount === 0 && Math.random() < 0.3) {
        this.faction?.checkWarConditions();
      }
    }
  }

  private _phoebe(snap: Snapshot, t: number): void {
    if (t < 10) this._emit('stranger_arrival');
    else if (t > 60) {
      this._emit('peace_treaty', { reason: 'Phoebe' });
      this._emit('resource_windfall', { reason: 'Phoebe' });
    }
    // Phoebe actively seeks peace during wars
    if (snap.activeWarCount > 0 && Math.random() < 0.5) {
      this._emit('peace_treaty', { reason: 'Phoebe compassion' });
    }
  }
}
