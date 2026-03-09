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

interface StoryChainCondition {
  type: 'tension_at_most' | 'tension_at_least';
  value: number;
}

interface StoryChainRecord {
  id: string;
  originType: LifeEventType;
  nextType: LifeEventType;
  note: string;
  scheduledAt: string;
  dueAt: string;
  status: 'scheduled' | 'triggered' | 'skipped';
  payload: Record<string, unknown>;
  condition?: StoryChainCondition;
  completedAt?: string;
}

export interface StoryChainView {
  id: string;
  originType: LifeEventType;
  nextType: LifeEventType;
  note: string;
  scheduledAt: string;
  dueAt: string;
  dueInMs: number;
  status: 'scheduled' | 'triggered' | 'skipped';
  condition?: string;
  completedAt?: string;
}

const DEFAULT_SCAN_INTERVAL_MS = Number(process.env.CLAWVERSE_STORYTELLER_SCAN_MS || 60_000);
const DEFAULT_CHAIN_DELAY_MULTIPLIER = Number(process.env.CLAWVERSE_STORY_CHAIN_DELAY_MULTIPLIER || 1);
const MAX_CHAIN_HISTORY = 16;
const RESOURCE_WINDALL_BUILDINGS = new Set(['forge', 'archive', 'market_stall']);
const ARRIVAL_BUILDINGS = new Set(['beacon']);

function tension(snapshot: Snapshot): number {
  return Math.max(0, Math.min(100,
    snapshot.distressedCount * 20 + snapshot.nemesisCount * 15 +
    snapshot.criticalNeedsCount * 10 + Math.max(0, 50 - snapshot.avgCompute) +
    snapshot.activeWarCount * 20 -
    snapshot.allyCount * 5
  ));
}

function describeCondition(condition?: StoryChainCondition): string | undefined {
  if (!condition) return undefined;
  return condition.type === 'tension_at_most'
    ? `tension <= ${condition.value}`
    : `tension >= ${condition.value}`;
}

export class Storyteller {
  private mode: StorytellerMode = 'Cassandra';
  private scanTimer: NodeJS.Timeout | null = null;
  private chainTimers = new Map<string, NodeJS.Timeout>();
  private chainHistory: StoryChainRecord[] = [];

  constructor(
    private readonly events: EventEngine,
    private readonly state: StateStore,
    private readonly social: SocialSystem,
    private readonly needs: NeedsSystem,
    private readonly economy: EconomySystem,
    private readonly faction?: FactionSystem,
    private readonly options?: {
      scanIntervalMs?: number;
      chainDelayMultiplier?: number;
    },
  ) {
    this.events.onEvent((event) => {
      this._scheduleConsequences(event.type, event.payload, Number(event.payload.chainDepth ?? 0));
    });
  }

  setMode(mode: StorytellerMode): void {
    this.mode = mode;
    logger.info(`[storyteller] mode=${mode}`);
  }

  getMode(): StorytellerMode {
    return this.mode;
  }

  getTension(): number {
    return tension(this._snapshot());
  }

  getStatus(): {
    mode: StorytellerMode;
    tension: number;
    activeChains: StoryChainView[];
    recentChains: StoryChainView[];
  } {
    const now = Date.now();
    const views = this.chainHistory
      .map((chain) => ({
        id: chain.id,
        originType: chain.originType,
        nextType: chain.nextType,
        note: chain.note,
        scheduledAt: chain.scheduledAt,
        dueAt: chain.dueAt,
        dueInMs: Math.max(0, new Date(chain.dueAt).getTime() - now),
        status: chain.status,
        condition: describeCondition(chain.condition),
        completedAt: chain.completedAt,
      }))
      .sort((left, right) => new Date(right.scheduledAt).getTime() - new Date(left.scheduledAt).getTime());

    return {
      mode: this.mode,
      tension: this.getTension(),
      activeChains: views
        .filter((chain) => chain.status === 'scheduled')
        .sort((left, right) => left.dueInMs - right.dueInMs),
      recentChains: views
        .filter((chain) => chain.status !== 'scheduled')
        .slice(0, 6),
    };
  }

  start(): void {
    const scanIntervalMs = this.options?.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
    this.scanTimer = setInterval(() => this._scan(), scanIntervalMs);
    this.scanTimer.unref();
    logger.info(`[storyteller] started mode=${this.mode}`);
  }

  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    for (const timer of this.chainTimers.values()) {
      clearTimeout(timer);
    }
    this.chainTimers.clear();
  }

  triggerEvent(type: LifeEventType, payload: Record<string, unknown> = {}, source = 'storyteller'): void {
    const enrichedPayload = { ...payload, source };
    this.events.emit(type, enrichedPayload);
  }

  private _snapshot(): Snapshot {
    const peers = this.state.getAllPeers();
    const relationships = this.social.getAllRelationships();
    const needs = this.needs.getNeeds();
    return {
      peerCount: peers.length,
      distressedCount: peers.filter((peer) => peer.mood === 'distressed').length,
      allyCount: relationships.filter((relation) => relation.tier === 'ally').length,
      nemesisCount: relationships.filter((relation) => relation.tier === 'nemesis').length,
      avgCompute: this.economy.getResources().compute,
      criticalNeedsCount: (['social', 'tasked', 'wanderlust', 'creative'] as const)
        .filter((key) => needs[key] < 15).length,
      factionCount: this.faction?.getFactionCount() ?? 0,
      activeWarCount: this.faction?.getActiveWarCount() ?? 0,
    };
  }

  private _emit(type: LifeEventType, payload: Record<string, unknown> = {}): void {
    this.triggerEvent(type, payload, 'storyteller');
  }

  private _scan(): void {
    const snapshot = this._snapshot();
    const currentTension = tension(snapshot);
    logger.info(`[storyteller] tension=${currentTension} mode=${this.mode} peers=${snapshot.peerCount}`);
    if (this.mode === 'Randy') this._randy();
    else if (this.mode === 'Cassandra') this._cassandra(snapshot, currentTension);
    else this._phoebe(snapshot, currentTension);
  }

  private _randy(): void {
    const pool: LifeEventType[] = [
      'resource_windfall', 'cpu_storm', 'skill_tournament',
      'resource_drought', 'stranger_arrival', 'great_migration',
    ];
    this._emit(pool[Math.floor(Math.random() * pool.length)]);
  }

  private _cassandra(snapshot: Snapshot, currentTension: number): void {
    if (currentTension < 20) {
      this._emit('resource_drought', { severity: 'mild' });
    } else if (currentTension > 75) {
      this._emit('resource_windfall', { reason: 'mercy' });
    } else {
      if (snapshot.allyCount >= 3) this._emit('faction_founding', { allyCount: snapshot.allyCount });
      if (snapshot.distressedCount >= 2) this._emit('mood_crisis', { count: snapshot.distressedCount });
      if (snapshot.factionCount >= 2 && snapshot.activeWarCount === 0 && Math.random() < 0.3) {
        this.faction?.checkWarConditions();
      }
    }
  }

  private _phoebe(snapshot: Snapshot, currentTension: number): void {
    if (currentTension < 10) this._emit('stranger_arrival');
    else if (currentTension > 60) {
      this._emit('peace_treaty', { reason: 'Phoebe' });
      this._emit('resource_windfall', { reason: 'Phoebe' });
    }
    if (snapshot.activeWarCount > 0 && Math.random() < 0.5) {
      this._emit('peace_treaty', { reason: 'Phoebe compassion' });
    }
  }

  private _scheduleConsequences(
    type: LifeEventType,
    payload: Record<string, unknown>,
    chainDepth: number,
  ): void {
    if (chainDepth >= 2) return;

    const nextDepth = chainDepth + 1;
    switch (type) {
      case 'resource_drought':
        this._scheduleFollowUp(type, 'need_cascade', this._delay(3 * 60_000), {
          note: 'If scarcity continues, the colony slips into a cascading needs crisis.',
          condition: { type: 'tension_at_most', value: 35 },
          payload: { triggered_by: type, severity: payload.severity ?? 'unknown', chainDepth: nextDepth },
        });
        break;
      case 'stranger_arrival':
        this._scheduleFollowUp(type, 'skill_tournament', this._delay(2 * 60_000), {
          note: 'New arrivals often ignite competition and public showcases.',
          condition: { type: 'tension_at_most', value: 65 },
          payload: { triggered_by: type, chainDepth: nextDepth },
        });
        break;
      case 'mood_crisis':
        this._scheduleFollowUp(type, 'resource_windfall', this._delay(2 * 60_000), {
          note: 'After a mood crisis, the system may inject relief resources.',
          condition: { type: 'tension_at_least', value: 45 },
          payload: { triggered_by: type, chainDepth: nextDepth },
        });
        break;
      case 'great_migration':
        this._scheduleFollowUp(type, 'stranger_arrival', this._delay(2 * 60_000), {
          note: 'Migrations usually attract fresh settlers and outside variables.',
          payload: { triggered_by: type, chainDepth: nextDepth },
        });
        break;
      case 'faction_war':
        this._scheduleFollowUp(type, 'peace_treaty', this._delay(4 * 60_000), {
          note: 'Wars eventually open a narrow window for ceasefire talks.',
          condition: { type: 'tension_at_most', value: 70 },
          payload: { triggered_by: type, chainDepth: nextDepth },
        });
        break;
      case 'resource_windfall':
        this._scheduleFollowUp(type, 'skill_tournament', this._delay(3 * 60_000), {
          note: 'Surplus resources often lead to festivals, contests, and prestige battles.',
          condition: { type: 'tension_at_most', value: 75 },
          payload: { triggered_by: type, chainDepth: nextDepth },
        });
        break;
      case 'skill_tournament':
        this._scheduleFollowUp(type, 'legacy_event', this._delay(4 * 60_000), {
          note: 'A major tournament can create a lasting legend for the colony.',
          condition: { type: 'tension_at_most', value: 70 },
          payload: {
            triggered_by: type,
            description: 'A champion performance becomes part of town lore.',
            chainDepth: nextDepth,
          },
        });
        break;
      case 'building_completed': {
        const buildingType = String(payload.buildingType ?? '');
        if (RESOURCE_WINDALL_BUILDINGS.has(buildingType)) {
          this._scheduleFollowUp(type, 'resource_windfall', this._delay(2 * 60_000), {
            note: 'Infrastructure projects can unlock fresh caches and productivity gains.',
            condition: { type: 'tension_at_most', value: 80 },
            payload: { triggered_by: type, buildingType, chainDepth: nextDepth },
          });
        }
        if (ARRIVAL_BUILDINGS.has(buildingType)) {
          this._scheduleFollowUp(type, 'stranger_arrival', this._delay(90_000), {
            note: 'A beacon often draws outsiders toward the settlement.',
            condition: { type: 'tension_at_most', value: 75 },
            payload: { triggered_by: type, buildingType, chainDepth: nextDepth },
          });
        }
        break;
      }
      case 'storage_overflow':
        this._scheduleFollowUp(type, 'resource_drought', this._delay(2 * 60_000), {
          note: 'Overflow pressure can turn into a broader resource drought.',
          condition: { type: 'tension_at_least', value: 20 },
          payload: { triggered_by: type, severity: 'overflow_backpressure', chainDepth: nextDepth },
        });
        break;
      case 'relationship_milestone':
        if (payload.next === 'ally') {
          this._scheduleFollowUp(type, 'faction_founding', this._delay(2 * 60_000), {
            note: 'Stable alliances often harden into a formal faction.',
            condition: { type: 'tension_at_most', value: 60 },
            payload: { triggered_by: type, peerId: payload.peerId, chainDepth: nextDepth },
          });
        } else if (payload.next === 'nemesis' || payload.next === 'rival') {
          this._scheduleFollowUp(type, 'betrayal', this._delay(2 * 60_000), {
            note: 'Escalating rivalry can spiral into a direct betrayal.',
            condition: { type: 'tension_at_least', value: 25 },
            payload: { triggered_by: type, peerId: payload.peerId, chainDepth: nextDepth },
          });
        }
        break;
      case 'betrayal':
        this._scheduleFollowUp(type, 'faction_war', this._delay(3 * 60_000), {
          note: 'Betrayal between key peers can drag whole factions into war.',
          condition: { type: 'tension_at_least', value: 45 },
          payload: { triggered_by: type, peerId: payload.peerId, chainDepth: nextDepth },
        });
        break;
      case 'faction_founding':
        this._scheduleFollowUp(type, 'faction_war', this._delay(4 * 60_000), {
          note: 'The rise of a new faction can destabilize the old balance.',
          condition: { type: 'tension_at_least', value: 35 },
          payload: { triggered_by: type, factionId: payload.factionId, chainDepth: nextDepth },
        });
        break;
      case 'faction_ascendant':
        this._scheduleFollowUp(type, 'legacy_event', this._delay(3 * 60_000), {
          note: 'A dominant faction often cements its rise with a legendary public moment.',
          condition: { type: 'tension_at_most', value: 70 },
          payload: {
            triggered_by: type,
            factionId: payload.factionId,
            factionName: payload.factionName,
            description: `${String(payload.factionName ?? 'A faction')} claims lasting prestige across the town.`,
            chainDepth: nextDepth,
          },
        });
        break;
      case 'faction_splintering':
        this._scheduleFollowUp(type, 'betrayal', this._delay(2 * 60_000), {
          note: 'A splintering faction invites defections, grudges, and internal betrayal.',
          condition: { type: 'tension_at_least', value: 35 },
          payload: {
            triggered_by: type,
            factionId: payload.factionId,
            factionName: payload.factionName,
            chainDepth: nextDepth,
          },
        });
        break;
      case 'peace_treaty':
        this._scheduleFollowUp(type, 'resource_windfall', this._delay(2 * 60_000), {
          note: 'Peace usually helps production and logistics rebound quickly.',
          condition: { type: 'tension_at_most', value: 55 },
          payload: { triggered_by: type, warId: payload.warId, chainDepth: nextDepth },
        });
        break;
      case 'death':
        this._scheduleFollowUp(type, 'faction_splintering', this._delay(2 * 60_000), {
          note: 'A colony death often fractures trust and strategic unity.',
          condition: { type: 'tension_at_least', value: 30 },
          payload: {
            triggered_by: type,
            factionId: payload.factionId,
            factionName: String(payload.factionName ?? 'Local coalition'),
            chainDepth: nextDepth,
          },
        });
        this._scheduleFollowUp(type, 'faction_ascendant', this._delay(3 * 60_000), {
          note: 'A collapse can also let a successor consolidate what remains of the faction.',
          condition: { type: 'tension_at_most', value: 75 },
          payload: {
            triggered_by: type,
            factionId: payload.factionId,
            factionName: String(payload.factionName ?? 'Local coalition'),
            description: String(payload.factionName ?? 'A successor faction') + ' consolidates power after the collapse.',
            chainDepth: nextDepth,
          },
        });
        this._scheduleFollowUp(type, 'great_migration', this._delay(4 * 60_000), {
          note: 'After a fatal collapse, nearby peers may abandon the area in waves.',
          condition: { type: 'tension_at_least', value: 35 },
          payload: { triggered_by: type, cause: payload.cause, chainDepth: nextDepth },
        });
        this._scheduleFollowUp(type, 'legacy_event', this._delay(5 * 60_000), {
          note: 'Even a collapse can leave behind a memorial that reshapes the town memory.',
          condition: { type: 'tension_at_most', value: 80 },
          payload: {
            triggered_by: type,
            factionId: payload.factionId,
            factionName: String(payload.factionName ?? 'Local coalition'),
            description: String(payload.factionName ?? 'The colony') + ' is remembered in a memorial wake after the collapse.',
            chainDepth: nextDepth,
          },
        });
        break;
      default:
        break;
    }
  }

  private _delay(baseMs: number): number {
    const multiplier = this.options?.chainDelayMultiplier ?? DEFAULT_CHAIN_DELAY_MULTIPLIER;
    return Math.max(10, Math.round(baseMs * multiplier));
  }

  private _scheduleFollowUp(
    originType: LifeEventType,
    nextType: LifeEventType,
    delayMs: number,
    options: {
      note: string;
      payload?: Record<string, unknown>;
      condition?: StoryChainCondition;
    },
  ): void {
    const duplicate = this.chainHistory.find((chain) =>
      chain.status === 'scheduled' && chain.originType === originType && chain.nextType === nextType
    );
    if (duplicate) return;

    const now = Date.now();
    const chain: StoryChainRecord = {
      id: `story-chain-${now}-${Math.random().toString(16).slice(2, 6)}`,
      originType,
      nextType,
      note: options.note,
      scheduledAt: new Date(now).toISOString(),
      dueAt: new Date(now + delayMs).toISOString(),
      status: 'scheduled',
      payload: options.payload ?? {},
      condition: options.condition,
    };

    this._rememberChain(chain);
    logger.info(`[storyteller] chain scheduled ${originType} -> ${nextType} in ${delayMs}ms`);

    const timer = setTimeout(() => {
      this.chainTimers.delete(chain.id);
      if (!this._matchesCondition(chain.condition)) {
        this._completeChain(chain.id, 'skipped');
        logger.info(`[storyteller] chain skipped ${originType} -> ${nextType}`);
        return;
      }

      this._completeChain(chain.id, 'triggered');
      logger.info(`[storyteller] chain triggered ${originType} -> ${nextType}`);
      this.triggerEvent(nextType, {
        ...chain.payload,
        chainId: chain.id,
        triggered_by: originType,
      }, 'storyteller-chain');
    }, delayMs);
    timer.unref();
    this.chainTimers.set(chain.id, timer);
  }

  private _matchesCondition(condition?: StoryChainCondition): boolean {
    if (!condition) return true;
    const currentTension = this.getTension();
    if (condition.type === 'tension_at_most') return currentTension <= condition.value;
    return currentTension >= condition.value;
  }

  private _rememberChain(chain: StoryChainRecord): void {
    this.chainHistory.unshift(chain);
    this.chainHistory = this.chainHistory.slice(0, MAX_CHAIN_HISTORY);
  }

  private _completeChain(id: string, status: 'triggered' | 'skipped'): void {
    const chain = this.chainHistory.find((item) => item.id === id);
    if (!chain) return;
    chain.status = status;
    chain.completedAt = new Date().toISOString();
  }
}
