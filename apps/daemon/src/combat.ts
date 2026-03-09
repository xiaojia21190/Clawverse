import type {
  CombatLogEntry,
  CombatSeverity,
  CombatState,
  DefensePosture,
  HealthStatus,
  InjuryState,
  RaidState,
  ResourceState,
} from '@clawverse/types';
import type { LifeEventType } from './events.js';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';
import { logger } from './logger.js';

export type CombatResourceKey = keyof Omit<ResourceState, 'updatedAt'>;

export interface CombatTickInput {
  tension: number;
  activeWar: boolean;
  hasShelter: boolean;
  hasBeacon?: boolean;
  hasWatchtower?: boolean;
  hasRelayPatch: boolean;
  resources: ResourceState;
}

export interface CombatTickEffect {
  emitted: Array<{ type: LifeEventType; payload: Record<string, unknown> }>;
  resourceLosses: Partial<Record<CombatResourceKey, number>>;
  resourceAwards: Partial<Record<CombatResourceKey, number>>;
}

const MAX_HP = 100;
const DEFAULT_RAID_COOLDOWN_MS = Number(process.env.CLAWVERSE_COMBAT_RAID_COOLDOWN_MS || 45_000);

const INITIAL_STATE: CombatState = {
  hp: MAX_HP,
  maxHp: MAX_HP,
  pain: 0,
  chronicPain: 0,
  careDebt: 0,
  posture: 'steady',
  status: 'stable',
  raidRisk: 0,
  activeRaid: null,
  injuries: [],
  deaths: 0,
  updatedAt: new Date().toISOString(),
  lastRaidAt: null,
  lastDamageAt: null,
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function baseDamageFor(severity: CombatSeverity): number {
  if (severity === 'fatal') return 42;
  if (severity === 'high') return 28;
  if (severity === 'medium') return 18;
  return 10;
}

function baseLossesFor(severity: CombatSeverity): Partial<Record<CombatResourceKey, number>> {
  if (severity === 'fatal') return { compute: 18, storage: 14, bandwidth: 12, reputation: 8 };
  if (severity === 'high') return { compute: 14, storage: 12, bandwidth: 9, reputation: 4 };
  if (severity === 'medium') return { compute: 9, storage: 8, bandwidth: 6, reputation: 2 };
  return { compute: 5, storage: 4, bandwidth: 3 };
}

function raidObjectiveFor(source: string): string {
  if (source === 'blackout_raiders') return 'compute and bandwidth disruption';
  if (source === 'bandwidth_pirates') return 'bandwidth lanes';
  if (source === 'compute_scavengers') return 'compute caches';
  if (source === 'faction_war') return 'frontline infrastructure';
  return 'settlement stability';
}

function recommendedPostureFor(source: string): DefensePosture {
  if (source === 'faction_war' || source === 'blackout_raiders') return 'fortified';
  if (source === 'bandwidth_pirates' || source === 'compute_scavengers') return 'guarded';
  return 'guarded';
}

function countermeasureFor(source: string): string {
  if (source === 'blackout_raiders') return 'Fortify the shell and keep relay patches ready to absorb blackout spikes.';
  if (source === 'bandwidth_pirates') return 'Guard bandwidth lanes with beacon coverage to keep the mesh stable.';
  if (source === 'compute_scavengers') return 'Guard weakened compute caches with watchtower coverage and rapid rerouting.';
  if (source === 'faction_war') return 'Fortify the perimeter and shelter core infrastructure from war pressure.';
  return 'Raise a guarded perimeter and keep early warning online.';
}

function doctrineBonusFor(
  raid: RaidState,
  input: CombatTickInput,
  posture: DefensePosture,
): { mitigation: number; resourceShield: number; activated: boolean } {
  let mitigation = 0;
  let resourceShield = 0;

  if (raid.source === 'bandwidth_pirates') {
    if (posture === 'guarded' || posture === 'fortified') mitigation += 1;
    if (input.hasBeacon) {
      mitigation += 2;
      resourceShield += 3;
    }
    if (input.hasWatchtower) resourceShield += 1;
  } else if (raid.source === 'compute_scavengers') {
    if (posture === 'guarded' || posture === 'fortified') mitigation += 1;
    if (input.hasWatchtower) {
      mitigation += 2;
      resourceShield += 2;
    }
    if (input.hasBeacon) resourceShield += 1;
  } else if (raid.source === 'blackout_raiders') {
    if (posture === 'fortified') mitigation += 2;
    if (input.hasRelayPatch) {
      mitigation += 2;
      resourceShield += 2;
    }
    if (input.hasBeacon || input.hasWatchtower) {
      mitigation += 1;
      resourceShield += 1;
    }
  } else if (raid.source === 'faction_war') {
    if (posture === 'fortified') mitigation += 2;
    if (input.hasShelter) {
      mitigation += 2;
      resourceShield += 1;
    }
    if (input.hasWatchtower) {
      mitigation += 1;
      resourceShield += 1;
    }
  } else {
    if (posture !== 'steady') mitigation += 1;
    if (input.hasBeacon || input.hasWatchtower) resourceShield += 1;
  }

  return {
    mitigation,
    resourceShield,
    activated: mitigation > 0 || resourceShield > 0,
  };
}

function applyRaidFocus(
  source: string,
  losses: Partial<Record<CombatResourceKey, number>>,
): Partial<Record<CombatResourceKey, number>> {
  const adjusted: Partial<Record<CombatResourceKey, number>> = { ...losses };

  if (source === 'blackout_raiders') {
    adjusted.compute = (adjusted.compute ?? 0) + 3;
    adjusted.bandwidth = (adjusted.bandwidth ?? 0) + 2;
    adjusted.storage = Math.max(0, (adjusted.storage ?? 0) - 1);
  } else if (source === 'bandwidth_pirates') {
    adjusted.bandwidth = (adjusted.bandwidth ?? 0) + 5;
    adjusted.compute = Math.max(0, (adjusted.compute ?? 0) - 2);
  } else if (source === 'compute_scavengers') {
    adjusted.compute = (adjusted.compute ?? 0) + 5;
    adjusted.storage = Math.max(0, (adjusted.storage ?? 0) - 2);
  } else if (source === 'faction_war') {
    adjusted.storage = (adjusted.storage ?? 0) + 2;
    adjusted.compute = (adjusted.compute ?? 0) + 1;
    adjusted.reputation = (adjusted.reputation ?? 0) + 2;
  } else if (source === 'storyteller_pressure') {
    adjusted.storage = (adjusted.storage ?? 0) + 3;
    adjusted.reputation = (adjusted.reputation ?? 0) + 1;
  }

  return adjusted;
}

function salvageAwardsFor(
  source: string,
  severity: CombatSeverity,
): Partial<Record<CombatResourceKey, number>> {
  const scale = severity === 'fatal' ? 3 : severity === 'high' ? 2 : 1;
  if (source === 'blackout_raiders') return { compute: 2 * scale, bandwidth: scale };
  if (source === 'bandwidth_pirates') return { bandwidth: 2 * scale, reputation: scale };
  if (source === 'compute_scavengers') return { compute: 2 * scale, storage: scale };
  if (source === 'faction_war') return { reputation: 2 * scale, storage: scale };
  return { storage: scale, reputation: scale };
}

function deriveSeverity(raidRisk: number, activeWar: boolean): CombatSeverity {
  if (raidRisk >= 92) return 'fatal';
  if (raidRisk >= 80 || activeWar) return 'high';
  if (raidRisk >= 68) return 'medium';
  return 'low';
}

function downgradeSeverity(severity: CombatSeverity): CombatSeverity {
  if (severity === 'fatal') return 'high';
  if (severity === 'high') return 'medium';
  if (severity === 'medium') return 'low';
  return 'low';
}

function describeRaidProfile(
  input: CombatTickInput,
  raidRisk: number,
): { source: string; summary: string; severity: CombatSeverity } {
  let severity = deriveSeverity(raidRisk, input.activeWar);
  if (!input.activeWar && (input.hasBeacon || input.hasWatchtower)) {
    severity = downgradeSeverity(severity);
  }

  if (input.activeWar) {
    return {
      source: 'faction_war',
      severity,
      summary: input.hasBeacon || input.hasWatchtower
        ? 'Beacon sweeps spotted hostile faction signatures early, buying a brief defensive window.'
        : 'Faction conflict spills into a direct raid on the settlement.',
    };
  }

  if (input.resources.compute <= 20 && input.resources.bandwidth <= 15) {
    return {
      source: 'blackout_raiders',
      severity,
      summary: input.hasBeacon || input.hasWatchtower
        ? 'Beacon nets catch blackout raiders massing at the edge of town.'
        : 'Blackout raiders surge toward the settlement while systems are weakened.',
    };
  }

  if (input.resources.bandwidth <= 15) {
    return {
      source: 'bandwidth_pirates',
      severity,
      summary: input.hasBeacon || input.hasWatchtower
        ? 'Beacon intercepts flag bandwidth pirates before they breach the mesh.'
        : 'Bandwidth pirates dive through the mesh looking for exposed traffic lanes.',
    };
  }

  if (input.resources.compute <= 20) {
    return {
      source: 'compute_scavengers',
      severity,
      summary: input.hasBeacon || input.hasWatchtower
        ? 'Beacon scans reveal scavenger packs circling weakened compute nodes.'
        : 'Compute scavengers close in as the colony power budget thins.',
    };
  }

  return {
    source: 'storyteller_pressure',
    severity,
    summary: input.hasBeacon || input.hasWatchtower
      ? 'Beacon sweeps catch a pressure raid before it reaches the town center.'
      : 'Rising tension hardens into a sudden hostile incursion.',
  };
}

function postureRiskModifier(posture: DefensePosture): number {
  if (posture === 'fortified') return 16;
  if (posture === 'guarded') return 8;
  return 0;
}

function postureMitigation(posture: DefensePosture): number {
  if (posture === 'fortified') return 7;
  if (posture === 'guarded') return 3;
  return 0;
}

function injuryLabel(severity: CombatSeverity): string {
  if (severity === 'fatal') return 'Core collapse';
  if (severity === 'high') return 'Deep signal fracture';
  if (severity === 'medium') return 'Cracked plating';
  return 'Bruised shell';
}

function injuryPressure(severity: CombatSeverity): number {
  if (severity === 'fatal') return 4;
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

function chronicPainFloorFor(severity: CombatSeverity): number {
  if (severity === 'fatal') return 14;
  if (severity === 'high') return 8;
  return 0;
}

function summarizeStatus(hp: number, pain: number, activeInjuries: InjuryState[], chronicPain = 0): HealthStatus {
  const totalPain = Math.min(100, pain + chronicPain);
  if (hp <= 0) return 'dead';
  if (hp <= 20 || totalPain >= 85) return 'downed';
  if (hp <= 45 || totalPain >= 60) return 'critical';
  if (hp <= 80 || activeInjuries.length > 0 || totalPain >= 20) return 'injured';
  return 'stable';
}

export class CombatSystem {
  private readonly dbHandle: ClawverseDbHandle;
  private state: CombatState = { ...INITIAL_STATE };

  constructor(opts?: { dbPath?: string; raidCooldownMs?: number }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this.raidCooldownMs = opts?.raidCooldownMs ?? DEFAULT_RAID_COOLDOWN_MS;
    this._load();
  }

  private readonly raidCooldownMs: number;

  getStatus(): CombatState {
    return {
      ...this.state,
      activeRaid: this.state.activeRaid ? { ...this.state.activeRaid } : null,
      injuries: this.state.injuries.map((injury: InjuryState) => ({ ...injury })),
    };
  }

  setPosture(posture: DefensePosture): CombatState {
    this.state.posture = posture;
    this.state.updatedAt = nowIso();
    this._appendLog('combat', `Defense posture shifted to ${posture}.`, { posture });
    this._save();
    return this.getStatus();
  }

  treat(opts: { hasShelter: boolean; canUseRelayPatch: boolean }): { ok: boolean; reason?: string; healed: number; effect: CombatTickEffect; status: CombatState } {
    const effect: CombatTickEffect = { emitted: [], resourceLosses: {}, resourceAwards: {} };
    if (this.state.status === 'dead') return { ok: false, reason: 'dead', healed: 0, effect, status: this.getStatus() };

    const activeInjuries = this._activeInjuries();
    if (this.state.hp >= this.state.maxHp && activeInjuries.length === 0 && this.state.pain === 0 && this.state.chronicPain === 0) {
      return { ok: false, reason: 'no_treatment_needed', healed: 0, effect, status: this.getStatus() };
    }

    const needsFullSupport = activeInjuries.some((injury) =>
      injury.severity === 'high' || injury.severity === 'fatal' || injury.complication === 'untreated'
    );
    if (!opts.hasShelter && !opts.canUseRelayPatch && (needsFullSupport || this.state.status === 'critical' || this.state.status === 'downed')) {
      const painBefore = this.state.pain;
      this.state.pain = clamp(this.state.pain + 4);
      this.state.careDebt = clamp(this.state.careDebt + 2);
      for (const injury of this.state.injuries) {
        if (!injury.active) continue;
        if (!injury.complication) injury.complication = 'untreated';
      }
      this.state.status = summarizeStatus(this.state.hp, this.state.pain, this._activeInjuries(), this.state.chronicPain);
      this.state.updatedAt = nowIso();
      const summary = 'Treatment failed because no shelter or relay patch was available for severe injuries.';
      this._appendLog('recovery', summary, {
        painBefore,
        painAfter: this.state.pain,
        chronicPain: this.state.chronicPain,
        careDebt: this.state.careDebt,
        statusAfter: this.state.status,
      });
      effect.emitted.push({
        type: 'combat_report',
        payload: {
          subtype: 'treatment_failed',
          reason: 'insufficient_medical_support',
          pain: this.state.pain,
          chronicPain: this.state.chronicPain,
          careDebt: this.state.careDebt,
          status: this.state.status,
          summary,
        },
      });
      this._save();
      return { ok: false, reason: 'insufficient_medical_support', healed: 0, effect, status: this.getStatus() };
    }

    const hpBefore = this.state.hp;
    const painBefore = this.state.pain;
    const chronicPainBefore = this.state.chronicPain;
    const previousStatus = this.state.status;
    const healPenalty = this.state.careDebt >= 6 ? 2 : 0;
    const heal = Math.max(2, (opts.hasShelter ? 14 : 8) + (opts.canUseRelayPatch && this.state.status !== 'injured' ? 4 : 0) - healPenalty);
    this.state.hp = clamp(this.state.hp + heal, 0, this.state.maxHp);
    this.state.pain = clamp(this.state.pain - (opts.hasShelter ? 18 : 10));
    this.state.chronicPain = clamp(this.state.chronicPain - (opts.hasShelter ? (opts.canUseRelayPatch ? 6 : 3) : 1));
    this.state.careDebt = Math.max(0, this.state.careDebt - (opts.hasShelter ? 3 : 1));
    effect.resourceLosses.compute = 5;
    effect.resourceLosses.storage = opts.hasShelter ? 4 : 3;

    let healedInjury = false;
    for (const injury of this.state.injuries) {
      if (!injury.active) continue;
      const threshold = injury.severity === 'low' ? 68 : injury.severity === 'medium' ? 80 : 92;
      const painThreshold = injury.severity === 'low' ? 32 : injury.severity === 'medium' ? 20 : 10;
      if (this.state.hp >= threshold && this.state.pain <= painThreshold) {
        injury.active = false;
        injury.healedAt = nowIso();
        if (injury.severity === 'high' || injury.severity === 'fatal') {
          injury.complication = 'chronic_pain';
          this.state.chronicPain = clamp(Math.max(this.state.chronicPain, chronicPainFloorFor(injury.severity)));
        }
        healedInjury = true;
        break;
      }
    }

    this.state.status = summarizeStatus(this.state.hp, this.state.pain, this._activeInjuries(), this.state.chronicPain);
    this.state.updatedAt = nowIso();
    const healed = this.state.hp - hpBefore;
    const lingeringPain = this.state.chronicPain > chronicPainBefore;
    const summary = healedInjury
      ? lingeringPain
        ? `Medical treatment healed injuries, restored ${healed} HP, but lingering chronic pain remains.`
        : `Medical treatment healed injuries and restored ${healed} HP.`
      : `Medical treatment restored ${healed} HP and reduced pain.`;
    this._appendLog('recovery', summary, { hpBefore, hpAfter: this.state.hp, painBefore, painAfter: this.state.pain, chronicPainBefore, chronicPainAfter: this.state.chronicPain, careDebt: this.state.careDebt, statusBefore: previousStatus, statusAfter: this.state.status, hasShelter: opts.hasShelter });
    effect.emitted.push({
      type: 'combat_report',
      payload: { subtype: 'treatment', healed, hp: this.state.hp, pain: this.state.pain, chronicPain: this.state.chronicPain, careDebt: this.state.careDebt, status: this.state.status, summary },
    });
    this._save();
    return { ok: true, healed, effect, status: this.getStatus() };
  }

  getLogs(limit = 12): CombatLogEntry[] {
    const safeLimit = Math.max(1, Math.min(50, Math.round(limit)));
    const rows = this.dbHandle.db.prepare(`
      SELECT payload_json
      FROM combat_logs
      ORDER BY ts DESC, id DESC
      LIMIT ?
    `).all(safeLimit) as Array<{ payload_json: string }>;

    return rows.flatMap((row) => {
      try {
        return [JSON.parse(row.payload_json) as CombatLogEntry];
      } catch {
        return [];
      }
    });
  }

  tick(input: CombatTickInput): CombatTickEffect {
    const effect: CombatTickEffect = {
      emitted: [],
      resourceLosses: {},
      resourceAwards: {},
    };

    this.state.raidRisk = clamp(Math.round(
      input.tension * 0.58 +
      (input.activeWar ? 22 : 0) +
      (input.resources.compute <= 20 ? 10 : 0) +
      (input.resources.bandwidth <= 15 ? 10 : 0) -
      (input.hasShelter ? 18 : 0) -
      (input.hasRelayPatch ? 6 : 0) -
      (input.hasBeacon ? 6 : 0) -
      (input.hasWatchtower ? 9 : 0) -
      postureRiskModifier(this.state.posture),
    ));

    if (this.state.hp <= 0) {
      this._save();
      return effect;
    }

    if (this.state.activeRaid) {
      this._resolveRaid(input, effect);
      this._save();
      return effect;
    }

    if (this._shouldStartRaid(input)) {
      const profile = describeRaidProfile(input, this.state.raidRisk);
      const raid: RaidState = {
        id: `raid-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        source: profile.source,
        severity: profile.severity,
        objective: raidObjectiveFor(profile.source),
        recommendedPosture: recommendedPostureFor(profile.source),
        countermeasure: countermeasureFor(profile.source),
        startedAt: nowIso(),
        resolvedAt: null,
        active: true,
        summary: profile.summary,
      };
      this.state.activeRaid = raid;
      this.state.updatedAt = nowIso();
      this._appendLog('raid', raid.summary, {
        raidId: raid.id,
        severity: raid.severity,
        source: raid.source,
        objective: raid.objective,
        raidRisk: this.state.raidRisk,
      });
      effect.emitted.push({
        type: 'raid_alert',
        payload: {
          raidId: raid.id,
          severity: raid.severity,
          source: raid.source,
          objective: raid.objective,
          recommendedPosture: raid.recommendedPosture,
          countermeasure: raid.countermeasure,
          raidRisk: this.state.raidRisk,
          description: raid.summary,
        },
      });
      logger.info(`[combat] Raid alert ${raid.id} severity=${raid.severity} source=${raid.source}`);
      this._save();
      return effect;
    }

    this._applyMedicalDeterioration(input, effect);
    if (this.state.hp <= 0) {
      this._save();
      return effect;
    }
    this._recover(input, effect);
    this._save();
    return effect;
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private _shouldStartRaid(input: CombatTickInput): boolean {
    if (this.state.activeRaid) return false;
    if (this.state.raidRisk < (input.activeWar ? 58 : 74)) return false;
    if (!this.state.lastRaidAt) return true;
    return Date.now() - new Date(this.state.lastRaidAt).getTime() >= this.raidCooldownMs;
  }

  private _resolveRaid(input: CombatTickInput, effect: CombatTickEffect): void {
    const raid = this.state.activeRaid;
    if (!raid) return;

    const doctrine = doctrineBonusFor(raid, input, this.state.posture);
    const mitigation =
      (input.hasShelter ? 5 : 0) +
      (input.hasRelayPatch ? 2 : 0) +
      (input.hasBeacon ? 2 : 0) +
      (input.hasWatchtower ? 4 : 0) +
      postureMitigation(this.state.posture) +
      doctrine.mitigation;
    const damage = Math.max(4, baseDamageFor(raid.severity) - mitigation);
    const baseLosses = applyRaidFocus(raid.source, baseLossesFor(raid.severity));
    const resourceShield =
      (input.hasShelter ? 2 : 0) +
      (input.hasBeacon ? 1 : 0) +
      (input.hasWatchtower ? 2 : 0) +
      (this.state.posture === 'fortified' ? 2 : this.state.posture === 'guarded' ? 1 : 0) +
      doctrine.resourceShield;
    const losses = Object.fromEntries(
      Object.entries(baseLosses).map(([resource, amount]) => {
        const numeric = Number(amount);
        if (resource === 'reputation') return [resource, numeric];
        return [resource, Math.max(0, numeric - resourceShield)];
      }),
    ) as Partial<Record<CombatResourceKey, number>>;
    const previousStatus = this.state.status;
    const previousHp = this.state.hp;

    this.state.hp = clamp(this.state.hp - damage, 0, this.state.maxHp);
    this.state.pain = clamp(this.state.pain + Math.round(damage * 1.4));
    this.state.lastRaidAt = nowIso();
    this.state.lastDamageAt = this.state.lastRaidAt;
    this.state.activeRaid = null;

    for (const [resource, amount] of Object.entries(losses)) {
      effect.resourceLosses[resource as CombatResourceKey] = Number(amount);
    }

    let injury: InjuryState | null = null;
    if (damage >= 8) {
      injury = {
        id: `inj-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        label: injuryLabel(raid.severity),
        severity: raid.severity,
        source: 'raid',
        createdAt: nowIso(),
        healedAt: null,
        active: true,
        complication: null,
      };
      this.state.injuries.unshift(injury);
      this.state.injuries = this.state.injuries.slice(0, 8);
    }

    this.state.status = summarizeStatus(this.state.hp, this.state.pain, this._activeInjuries(), this.state.chronicPain);
    this.state.updatedAt = nowIso();

    const salvageAwards = this.state.status !== 'dead' ? salvageAwardsFor(raid.source, raid.severity) : {};

    if (this.state.status !== 'dead') {
      effect.resourceAwards.reputation = (effect.resourceAwards.reputation ?? 0) + (raid.severity === 'high' || raid.severity === 'fatal' ? 4 : 2);
      for (const [resource, amount] of Object.entries(salvageAwards)) {
        const key = resource as CombatResourceKey;
        effect.resourceAwards[key] = (effect.resourceAwards[key] ?? 0) + Number(amount);
      }
    } else {
      this.state.deaths += 1;
    }

    const summary = doctrine.activated
      ? `Raid resolved with ${damage} damage after doctrine response: ${raid.countermeasure} HP ${previousHp} -> ${this.state.hp}.`
      : `Raid resolved with ${damage} damage. HP ${previousHp} -> ${this.state.hp}.`;
    this._appendLog('combat', summary, {
      raidId: raid.id,
      severity: raid.severity,
      damage,
      losses,
      hpBefore: previousHp,
      hpAfter: this.state.hp,
      statusBefore: previousStatus,
      statusAfter: this.state.status,
      mitigation,
      resourceShield,
      recommendedPosture: raid.recommendedPosture,
      countermeasure: raid.countermeasure,
      doctrineActivated: doctrine.activated,
      doctrineMitigation: doctrine.mitigation,
      doctrineResourceShield: doctrine.resourceShield,
    });

    effect.emitted.push({
      type: 'combat_report',
      payload: {
        subtype: 'raid_resolved',
        raidId: raid.id,
        severity: raid.severity,
        damage,
        hp: this.state.hp,
        source: raid.source,
        objective: raid.objective,
        recommendedPosture: raid.recommendedPosture,
        countermeasure: raid.countermeasure,
        doctrineActivated: doctrine.activated,
        summary,
      },
    });

    if (injury) {
      this._appendLog('injury', `Injury recorded: ${injury.label}.`, {
        injuryId: injury.id,
        severity: injury.severity,
        label: injury.label,
      });
      effect.emitted.push({
        type: 'injury',
        payload: {
          injuryId: injury.id,
          severity: injury.severity,
          label: injury.label,
          source: injury.source,
          hp: this.state.hp,
        },
      });
    }

    if (this.state.hp <= 0) {
      this._appendLog('death', 'The settlement core collapsed during the raid.', {
        raidId: raid.id,
        severity: raid.severity,
      });
      effect.emitted.push({
        type: 'death',
        payload: {
          cause: 'raid',
          raidId: raid.id,
          severity: raid.severity,
          objective: raid.objective,
          description: 'The settlement core collapsed under raid pressure.',
        },
      });
      logger.warn(`[combat] Fatal raid ${raid.id}`);
      return;
    }

    effect.emitted.push({
      type: 'resource_drought',
      payload: {
        subtype: 'raid_damage',
        severity: raid.severity,
        computeLoss: losses.compute ?? 0,
        storageLoss: losses.storage ?? 0,
        bandwidthLoss: losses.bandwidth ?? 0,
        source: raid.source,
        objective: raid.objective,
        recommendedPosture: raid.recommendedPosture,
        countermeasure: raid.countermeasure,
      },
    });
  }

  private _applyMedicalDeterioration(input: CombatTickInput, effect: CombatTickEffect): void {
    const activeInjuries = this._activeInjuries();
    if (activeInjuries.length === 0) return;

    if (input.hasShelter || input.hasRelayPatch) {
      this.state.careDebt = Math.max(0, this.state.careDebt - 1);
      return;
    }

    const pressure = Math.max(...activeInjuries.map((injury) => injuryPressure(injury.severity)));
    this.state.careDebt = clamp(this.state.careDebt + pressure);
    if (this.state.careDebt < 4) return;

    const hpBefore = this.state.hp;
    const painBefore = this.state.pain;
    const chronicPainBefore = this.state.chronicPain;
    const previousStatus = this.state.status;
    const hpLoss = this.state.careDebt >= 10 ? 2 : 1;
    const painGain = pressure + (this.state.careDebt >= 8 ? 2 : 1);
    const chronicGain = this.state.careDebt >= 8 ? (pressure >= 3 ? 2 : 1) : 0;

    this.state.hp = clamp(this.state.hp - hpLoss, 0, this.state.maxHp);
    this.state.pain = clamp(this.state.pain + painGain);
    this.state.chronicPain = clamp(this.state.chronicPain + chronicGain);
    for (const injury of this.state.injuries) {
      if (!injury.active) continue;
      if (!injury.complication) injury.complication = 'untreated';
    }
    this.state.status = summarizeStatus(this.state.hp, this.state.pain, this._activeInjuries(), this.state.chronicPain);
    this.state.updatedAt = nowIso();

    const summary = this.state.chronicPain > chronicPainBefore
      ? 'Untreated injuries are worsening and building chronic pain.'
      : 'Untreated injuries are worsening because no medical support is available.';
    this._appendLog('injury', summary, {
      hpBefore,
      hpAfter: this.state.hp,
      painBefore,
      painAfter: this.state.pain,
      chronicPainBefore,
      chronicPainAfter: this.state.chronicPain,
      careDebt: this.state.careDebt,
      statusBefore: previousStatus,
      statusAfter: this.state.status,
    });
    effect.emitted.push({
      type: 'combat_report',
      payload: {
        subtype: 'deterioration',
        hp: this.state.hp,
        pain: this.state.pain,
        chronicPain: this.state.chronicPain,
        careDebt: this.state.careDebt,
        status: this.state.status,
        summary,
      },
    });

    if (this.state.hp <= 0) {
      this.state.deaths += 1;
      this._appendLog('death', 'The settlement core failed after untreated injuries spiraled out of control.', {
        cause: 'untreated_injury',
      });
      effect.emitted.push({
        type: 'death',
        payload: {
          cause: 'untreated_injury',
          description: 'The settlement core failed after untreated injuries spiraled out of control.',
        },
      });
      logger.warn('[combat] Fatal untreated injuries');
    }
  }

  private _recover(input: CombatTickInput, effect: CombatTickEffect): void {
    const activeInjuries = this._activeInjuries();
    const previousStatus = this.state.status;
    const previousHp = this.state.hp;

    if (this.state.hp >= this.state.maxHp && activeInjuries.length === 0 && this.state.pain === 0 && this.state.chronicPain === 0) {
      return;
    }
    if (input.resources.compute < 18 || input.resources.storage < 12) {
      return;
    }
    if (activeInjuries.length > 0 && !input.hasShelter && !input.hasRelayPatch) {
      return;
    }

    const heal = input.hasShelter ? 6 : 3;
    this.state.hp = clamp(this.state.hp + heal, 0, this.state.maxHp);
    this.state.pain = clamp(this.state.pain - (input.hasShelter ? 10 : 6));
    this.state.chronicPain = clamp(this.state.chronicPain - (input.hasShelter ? 2 : 1));
    this.state.careDebt = Math.max(0, this.state.careDebt - (input.hasShelter ? 2 : 1));
    effect.resourceLosses.compute = (effect.resourceLosses.compute ?? 0) + 2;
    effect.resourceLosses.storage = (effect.resourceLosses.storage ?? 0) + 2;

    let healedInjury: InjuryState | null = null;
    for (const injury of this.state.injuries) {
      if (!injury.active) continue;
      const canHealLow = injury.severity === 'low' && this.state.hp >= 72 && this.state.pain <= 35;
      const canHealMedium = injury.severity === 'medium' && this.state.hp >= 84 && this.state.pain <= 24;
      const canHealHigh = injury.severity === 'high' && this.state.hp >= 94 && this.state.pain <= 12;
      if (canHealLow || canHealMedium || canHealHigh) {
        injury.active = false;
        injury.healedAt = nowIso();
        healedInjury = { ...injury };
        break;
      }
    }

    this.state.status = summarizeStatus(this.state.hp, this.state.pain, this._activeInjuries(), this.state.chronicPain);
    this.state.updatedAt = nowIso();

    if (this.state.hp !== previousHp && (previousStatus !== this.state.status || healedInjury)) {
      const summary = healedInjury
        ? `Recovery stabilized the colony and healed ${healedInjury.label}.`
        : `Recovery stabilized the colony. HP ${previousHp} -> ${this.state.hp}.`;
      this._appendLog('recovery', summary, {
        hpBefore: previousHp,
        hpAfter: this.state.hp,
        chronicPain: this.state.chronicPain,
        careDebt: this.state.careDebt,
        statusBefore: previousStatus,
        statusAfter: this.state.status,
        healedInjury: healedInjury?.label ?? null,
      });
      effect.emitted.push({
        type: 'combat_report',
        payload: {
          subtype: 'recovery',
          healed: this.state.hp - previousHp,
          healedInjury: healedInjury?.label ?? null,
          hp: this.state.hp,
          chronicPain: this.state.chronicPain,
          careDebt: this.state.careDebt,
          status: this.state.status,
          summary,
        },
      });
    }
  }

  private _activeInjuries(): InjuryState[] {
    return this.state.injuries.filter((injury: InjuryState) => injury.active);
  }

  private _appendLog(kind: CombatLogEntry['kind'], summary: string, payload: Record<string, unknown>): void {
    const entry: CombatLogEntry = {
      id: `combat-log-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      ts: nowIso(),
      kind,
      summary,
      payload,
    };
    this.dbHandle.db.prepare(`
      INSERT INTO combat_logs (id, ts, kind, payload_json)
      VALUES (?, ?, ?, ?)
    `).run(entry.id, entry.ts, entry.kind, JSON.stringify(entry));
  }

  private _save(): void {
    this.dbHandle.db.prepare(`
      INSERT INTO combat_state (id, payload_json, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(JSON.stringify(this.state), this.state.updatedAt);
  }

  private _load(): void {
    const row = this.dbHandle.db.prepare(`
      SELECT payload_json
      FROM combat_state
      WHERE id = 1
    `).get() as { payload_json: string } | undefined;

    if (!row) {
      this.state = { ...INITIAL_STATE };
      this._save();
      return;
    }

    try {
      const parsed = JSON.parse(row.payload_json) as Partial<CombatState>;
      this.state = {
        ...INITIAL_STATE,
        ...parsed,
        posture: parsed.posture ?? 'steady',
        activeRaid: parsed.activeRaid ?? null,
        injuries: Array.isArray(parsed.injuries)
          ? parsed.injuries.map((injury) => ({ ...injury, complication: injury.complication ?? null }))
          : [],
      };
      this.state.status = summarizeStatus(this.state.hp, this.state.pain, this._activeInjuries(), this.state.chronicPain);
      this.state.updatedAt = this.state.updatedAt || nowIso();
    } catch {
      this.state = { ...INITIAL_STATE };
      this._save();
    }
  }
}

