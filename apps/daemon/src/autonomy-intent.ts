import type { AutonomyOrchestrationMode } from '@clawverse/types';
import type { BrainGuidanceRecord } from './brain-guidance-registry.js';
import type { StrategicLane } from './governor-planner.js';
import type { JobKind, JobPayload } from './jobs.js';

export interface AutonomyIntentDuty {
  kind: JobKind;
  title: string;
  reason: string;
  priority: number;
  payload: JobPayload;
  sourceEventType: string;
  dedupeKey: string;
}

export interface AutonomyIntentCandidate {
  lane: StrategicLane;
  duty: AutonomyIntentDuty;
}

export interface PlannedAutonomyIntent {
  lane: StrategicLane;
  duty: AutonomyIntentDuty;
  rank: number;
  score: number;
  finalPriority: number;
  reasons: string[];
}

export interface AutonomyIntentSnapshot {
  rank: number;
  lane: StrategicLane;
  kind: JobKind;
  title: string;
  sourceEventType: string;
  dedupeKey: string;
  basePriority: number;
  finalPriority: number;
  score: number;
  reasons: string[];
}

export interface AutonomyIntentPlannerInput {
  orchestrationMode: AutonomyOrchestrationMode | 'directive';
  guidance: BrainGuidanceRecord[];
  candidates: AutonomyIntentCandidate[];
  coordination?: {
    role: 'leader' | 'member' | 'none';
    clusterStatus?: 'forming' | 'stable' | 'strained' | 'fracturing' | 'collapsing';
    clusterActorCount?: number;
    leaderScore?: number;
  };
  pressure?: {
    activeRaid?: boolean;
    activeWarCount?: number;
    clusterStatus?: 'forming' | 'stable' | 'strained' | 'fracturing' | 'collapsing';
    clusterResourcePressure?: number;
    clusterSafety?: number;
    migrationUrgency?: number;
  };
}

const LANE_KEYWORDS: Record<StrategicLane, string[]> = {
  wartime: [
    'raid', 'war', 'combat', 'defend', 'defense', 'retreat', 'heal', 'shelter', 'frontline',
    '袭击', '战争', '战斗', '防御', '撤退', '救治', '避难',
  ],
  economy: [
    'economy', 'resource', 'trade', 'market', 'build', 'craft', 'compute', 'storage', 'bandwidth',
    '经济', '资源', '交易', '市场', '建造', '制造', '算力', '存储', '带宽',
  ],
  diplomacy: [
    'peace', 'treaty', 'diplomacy', 'negotiate', 'ceasefire',
    '和平', '和谈', '条约', '停战', '外交', '谈判',
  ],
  alliance: [
    'alliance', 'ally', 'coalition', 'bloc',
    '联盟', '盟友', '同盟', '结盟',
  ],
  vassal: [
    'vassal', 'overlord', 'tribute',
    '附庸', '宗主', '纳贡', '朝贡',
  ],
  faction: [
    'faction', 'cohesion', 'regroup', 'agenda', 'exodus',
    '派系', '凝聚', '集结', '议程', '撤离',
  ],
};

const ZONE_LANE_BIAS: Record<string, StrategicLane> = {
  market: 'economy',
  workshop: 'economy',
  residential: 'wartime',
  park: 'faction',
  plaza: 'faction',
  library: 'faction',
  tavern: 'faction',
};

const ZERO_LANE_BIAS: Record<StrategicLane, number> = {
  wartime: 0,
  economy: 0,
  diplomacy: 0,
  alliance: 0,
  vassal: 0,
  faction: 0,
};

function clampPriority(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function guidanceKeywordBoost(lane: StrategicLane, guidance: BrainGuidanceRecord[]): number {
  const keywords = LANE_KEYWORDS[lane];
  if (keywords.length === 0) return 0;
  let boost = 0;

  for (const entry of guidance) {
    if (entry.status !== 'active') continue;
    const text = normalizeText(entry.message);
    if (!text) continue;
    if (!keywords.some((keyword) => text.includes(keyword))) continue;
    boost += entry.source === 'operator' ? 4 : 2;
  }

  return Math.min(12, boost);
}

function guidanceMoveBoost(lane: StrategicLane, guidance: BrainGuidanceRecord[]): number {
  let boost = 0;
  for (const entry of guidance) {
    if (entry.status !== 'active' || entry.kind !== 'move') continue;
    const zone = typeof entry.payload?.targetZone === 'string'
      ? normalizeText(entry.payload.targetZone)
      : '';
    if (!zone) continue;
    if (ZONE_LANE_BIAS[zone] === lane) {
      boost += entry.source === 'operator' ? 3 : 1;
    }
  }
  return Math.min(6, boost);
}

function guidanceBoost(lane: StrategicLane, guidance: BrainGuidanceRecord[]): number {
  return Math.min(16, guidanceKeywordBoost(lane, guidance) + guidanceMoveBoost(lane, guidance));
}

function coordinationBoost(
  lane: StrategicLane,
  coordination: AutonomyIntentPlannerInput['coordination'],
): { value: number; reason: string } {
  if (!coordination || coordination.role !== 'leader') {
    return { value: 0, reason: 'leader_bias:+0' };
  }

  const clusterActorCount = Math.max(0, Math.round(coordination.clusterActorCount ?? 0));
  const clusterStatus = coordination.clusterStatus ?? 'forming';
  let boost = 0;

  if (lane === 'wartime') {
    boost = clusterStatus === 'fracturing' || clusterStatus === 'collapsing' ? 6 : 2;
  } else if (lane === 'faction') {
    boost = clusterActorCount >= 3 ? 6 : 3;
  } else if (lane === 'economy') {
    boost = clusterActorCount >= 3 ? 4 : 2;
  } else if ((lane === 'alliance' || lane === 'diplomacy') && clusterStatus === 'stable' && clusterActorCount >= 4) {
    boost = 3;
  }

  return {
    value: Math.min(8, boost),
    reason: `leader_bias:+${Math.min(8, boost)}`,
  };
}

function basePriority(candidate: AutonomyIntentCandidate): { value: number; reason: string } {
  const base = clampPriority(candidate.duty.priority);
  return {
    value: base,
    reason: `base:${base}`,
  };
}

interface SurvivalPressureSnapshot {
  level: number;
  guidanceWeight: number;
  laneBias: Record<StrategicLane, number>;
}

type ClusterPressureStatus = NonNullable<AutonomyIntentPlannerInput['pressure']>['clusterStatus'];

function collapsePressureByStatus(status: ClusterPressureStatus): number {
  if (status === 'collapsing') return 34;
  if (status === 'fracturing') return 22;
  if (status === 'strained') return 10;
  if (status === 'forming') return 6;
  return 0;
}

function resolveSurvivalPressure(pressure: AutonomyIntentPlannerInput['pressure']): SurvivalPressureSnapshot {
  const clusterResourcePressure = clampPriority(Number(pressure?.clusterResourcePressure ?? 0));
  const clusterSafety = clampPriority(Number(pressure?.clusterSafety ?? 100));
  const migrationUrgency = clampPriority(Number(pressure?.migrationUrgency ?? 0));
  const activeWarCount = Math.max(0, Math.round(Number(pressure?.activeWarCount ?? 0)));

  const level = clampPriority(
    (pressure?.activeRaid ? 34 : 0)
      + Math.min(24, activeWarCount * 8)
      + collapsePressureByStatus(pressure?.clusterStatus)
      + Math.round(clusterResourcePressure * 0.22)
      + Math.round(Math.max(0, 45 - clusterSafety) * 0.42)
      + Math.round(migrationUrgency * 0.25),
  );

  const laneBias: Record<StrategicLane, number> = { ...ZERO_LANE_BIAS };
  if (level >= 80) {
    laneBias.wartime = 14;
    laneBias.economy = 10;
    laneBias.faction = 6;
    laneBias.diplomacy = -3;
    laneBias.alliance = -6;
    laneBias.vassal = -8;
  } else if (level >= 60) {
    laneBias.wartime = 9;
    laneBias.economy = 6;
    laneBias.faction = 4;
    laneBias.alliance = -3;
    laneBias.vassal = -4;
  } else if (level >= 40) {
    laneBias.wartime = 5;
    laneBias.economy = 3;
    laneBias.faction = 2;
  }

  const guidanceWeight = level >= 80
    ? 0.35
    : level >= 65
      ? 0.55
      : level >= 45
        ? 0.75
        : 1;

  return {
    level,
    guidanceWeight,
    laneBias,
  };
}

export function planAutonomyIntents(input: AutonomyIntentPlannerInput): PlannedAutonomyIntent[] {
  const survivalPressure = resolveSurvivalPressure(input.pressure);
  const planned = input.candidates.map((candidate, index) => {
    const base = basePriority(candidate);
    const guidanceRaw = guidanceBoost(candidate.lane, input.guidance);
    const guidance = Math.round(guidanceRaw * survivalPressure.guidanceWeight);
    const coordination = coordinationBoost(candidate.lane, input.coordination);
    const pressureLaneBias = survivalPressure.laneBias[candidate.lane] ?? 0;
    // Ranking is driven by survival pressure + social coordination + operator guidance.
    const score = clampPriority(base.value + guidance + coordination.value + pressureLaneBias);
    const reasons = [
      base.reason,
      guidance > 0 ? `guidance:+${guidance}` : 'guidance:+0',
      `guidance_weight:${survivalPressure.guidanceWeight.toFixed(2)}`,
      `pressure:${survivalPressure.level}`,
      pressureLaneBias !== 0 ? `pressure_lane:${pressureLaneBias >= 0 ? '+' : ''}${pressureLaneBias}` : 'pressure_lane:+0',
      'central_bias:bypassed',
      `authority:${input.orchestrationMode === 'directive' ? 'directive-compat' : 'advisory'}`,
      coordination.reason,
      `lane:${candidate.lane}`,
    ];

    return {
      lane: candidate.lane,
      duty: candidate.duty,
      rank: 0,
      score,
      finalPriority: score,
      reasons,
      _index: index,
    };
  });

  planned.sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) return scoreDelta;
    return left._index - right._index;
  });

  return planned.map((entry, index) => ({
    lane: entry.lane,
    duty: entry.duty,
    rank: index + 1,
    score: entry.score,
    finalPriority: entry.finalPriority,
    reasons: entry.reasons,
  }));
}

export function toAutonomyIntentSnapshots(
  intents: PlannedAutonomyIntent[],
  limit = 6,
): AutonomyIntentSnapshot[] {
  return intents
    .slice(0, Math.max(1, limit))
    .map((intent) => ({
      rank: intent.rank,
      lane: intent.lane,
      kind: intent.duty.kind,
      title: intent.duty.title,
      sourceEventType: intent.duty.sourceEventType,
      dedupeKey: intent.duty.dedupeKey,
      basePriority: clampPriority(intent.duty.priority),
      finalPriority: intent.finalPriority,
      score: intent.score,
      reasons: intent.reasons.slice(0, 6),
    }));
}
