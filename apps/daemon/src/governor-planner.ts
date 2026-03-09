import type { CombatState, FactionAgenda, FactionStage, ResourceState } from '@clawverse/types';

export type StrategicLane =
  | 'wartime'
  | 'economy'
  | 'diplomacy'
  | 'alliance'
  | 'vassal'
  | 'faction';

export type StrategicMode =
  | 'survive'
  | 'fortify'
  | 'recover'
  | 'consolidate'
  | 'expand'
  | 'dominate';

type LaneScores = Record<StrategicLane, number>;

export interface GovernorPlannerInput {
  resources: ResourceState;
  needs: {
    social: number;
    tasked: number;
    wanderlust: number;
    creative: number;
  };
  combat: CombatState;
  zone: string;
  hasFaction: boolean;
  activeWar: boolean;
  activeRaid: boolean;
  activeAllianceCount: number;
  activeVassalCount: number;
  knownPeerCount: number;
  allyCount: number;
  friendCount: number;
  myFactionStage?: FactionStage;
  myFactionPressure?: number;
  myFactionCohesion?: number;
  myFactionProsperity?: number;
  myFactionInfluence?: number;
  myFactionAgenda?: FactionAgenda;
}

export interface StrategicGovernorState {
  planId: string;
  mode: StrategicMode;
  focusLane: StrategicLane;
  objective: string;
  summary: string;
  reasons: string[];
  laneOrder: StrategicLane[];
  currentStepIndex: number;
  plan: StrategicPlanStep[];
  laneScores: LaneScores;
  priorityBias: LaneScores;
  pressure: number;
  confidence: number;
  updatedAt: string;
}

export interface StrategicPlanStep {
  step: number;
  lane: StrategicLane;
  horizon: 'now' | 'next' | 'later';
  objective: string;
  reason: string;
  score: number;
}

const ZERO_SCORES: LaneScores = {
  wartime: 0,
  economy: 0,
  diplomacy: 0,
  alliance: 0,
  vassal: 0,
  faction: 0,
};

const FOCUS_ORDER: StrategicLane[] = [
  'wartime',
  'economy',
  'diplomacy',
  'faction',
  'alliance',
  'vassal',
];

const DORMANT_LANE_ORDER: StrategicLane[] = [
  'economy',
  'faction',
  'diplomacy',
  'wartime',
  'alliance',
  'vassal',
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function laneLabel(lane: StrategicLane): string {
  if (lane === 'wartime') return 'wartime';
  if (lane === 'economy') return 'economy';
  if (lane === 'diplomacy') return 'diplomacy';
  if (lane === 'alliance') return 'alliance';
  if (lane === 'vassal') return 'vassal';
  return 'faction';
}

function modeLabel(mode: StrategicMode): string {
  if (mode === 'survive') return 'survival';
  if (mode === 'fortify') return 'fortification';
  if (mode === 'recover') return 'recovery';
  if (mode === 'expand') return 'expansion';
  if (mode === 'dominate') return 'dominance';
  return 'consolidation';
}

function needPressure(input: GovernorPlannerInput): number {
  const values = [input.needs.social, input.needs.tasked, input.needs.wanderlust, input.needs.creative];
  const floor = Math.min(...values);
  const criticalCount = values.filter((value) => value < 15).length;
  if (criticalCount >= 2) return 86;
  if (floor < 15) return 78;
  if (floor < 35) return 62;
  if (floor < 50) return 34;
  return 0;
}

function resourcePressure(input: GovernorPlannerInput): number {
  const computeScore = input.resources.compute <= 24 ? 84 : input.resources.compute <= 48 ? 62 : 0;
  const bandwidthScore = input.resources.bandwidth <= 24 ? 82 : input.resources.bandwidth <= 48 ? 60 : 0;
  const storageScore = input.resources.storage <= 24 ? 72 : input.resources.storage <= 48 ? 52 : 0;
  const reputationScore = input.resources.reputation <= 10 ? 30 : 0;
  return Math.max(computeScore, bandwidthScore, storageScore, reputationScore);
}

function healthySurplusScore(input: GovernorPlannerInput): number {
  if (input.activeRaid || input.activeWar) return 0;
  const reserves = input.resources.compute + input.resources.storage + input.resources.bandwidth;
  if (reserves < 180) return 0;
  return clamp(Math.round(24 + (reserves - 180) * 0.12), 0, 58);
}

function wartimeScore(input: GovernorPlannerInput): number {
  if (input.activeRaid) return 96;

  const healthPenalty = input.combat.status === 'critical'
    ? 14
    : input.combat.status === 'downed'
      ? 18
      : input.combat.status === 'injured'
        ? 8
        : 0;

  return clamp(input.combat.raidRisk + (input.activeWar ? 10 : 0) + healthPenalty, 0, 92);
}

function diplomacyScore(input: GovernorPlannerInput): number {
  if (!input.activeWar) return 0;

  const cohesion = input.myFactionCohesion ?? 100;
  const pressure = input.myFactionPressure ?? 0;
  const stage = input.myFactionStage;
  const peaceBudget = input.resources.reputation >= 20 ? 8 : -18;

  return clamp(
    58
      + (stage === 'splintering' ? 14 : 0)
      + (pressure >= 72 ? 10 : pressure >= 56 ? 6 : 0)
      + (cohesion <= 35 ? 10 : cohesion <= 50 ? 4 : 0)
      + (input.activeRaid ? 8 : 0)
      + peaceBudget,
    0,
    90,
  );
}

function agendaZone(agenda?: FactionAgenda): string {
  if (agenda === 'trade') return 'Market';
  if (agenda === 'knowledge') return 'Library';
  if (agenda === 'expansion') return 'Plaza';
  if (agenda === 'survival') return 'Residential';
  return 'Park';
}

function factionScore(input: GovernorPlannerInput): number {
  if (!input.hasFaction) {
    return clamp(
      20
        + input.allyCount * 10
        + input.friendCount * 4
        + Math.min(20, input.knownPeerCount * 2)
        - Math.round(input.combat.raidRisk * 0.35)
        - (input.activeWar ? 16 : 0),
      0,
      88,
    );
  }

  const stage = input.myFactionStage;
  const cohesion = input.myFactionCohesion ?? 100;
  const pressure = input.myFactionPressure ?? 0;
  const prosperity = input.myFactionProsperity ?? 50;

  if (stage === 'splintering') {
    return clamp(
      72
        + Math.round((100 - cohesion) * 0.18)
        + Math.round(pressure * 0.12)
        - (input.activeWar ? 18 : 0),
      0,
      92,
    );
  }

  const preferredZone = agendaZone(input.myFactionAgenda);
  return clamp(
    22
      + (stage === 'dominant' ? 10 : 4)
      + Math.round(prosperity * 0.12)
      + (preferredZone === input.zone ? 0 : 8)
      - Math.round(pressure * 0.14),
    0,
    64,
  );
}

function allianceScore(input: GovernorPlannerInput): number {
  if (!input.hasFaction || input.activeWar || input.activeRaid) return 0;
  if (!['rising', 'dominant'].includes(input.myFactionStage ?? '')) return 0;

  const prosperity = input.myFactionProsperity ?? 50;
  const cohesion = input.myFactionCohesion ?? 50;
  const pressure = input.myFactionPressure ?? 50;

  return clamp(
    24
      + Math.round(prosperity * 0.2)
      + Math.round(cohesion * 0.14)
      + Math.min(14, input.knownPeerCount * 1.5)
      - Math.round(pressure * 0.18)
      - input.activeAllianceCount * 18,
    0,
    82,
  );
}

function vassalScore(input: GovernorPlannerInput): number {
  if (!input.hasFaction || input.activeWar || input.activeRaid) return 0;
  if (input.myFactionStage !== 'dominant') return 0;

  const influence = input.myFactionInfluence ?? 0;
  const prosperity = input.myFactionProsperity ?? 50;
  const cohesion = input.myFactionCohesion ?? 50;
  const pressure = input.myFactionPressure ?? 50;

  return clamp(
    18
      + Math.round(influence * 0.28)
      + Math.round(prosperity * 0.16)
      + Math.round(cohesion * 0.1)
      - Math.round(pressure * 0.18)
      - input.activeVassalCount * 22,
    0,
    84,
  );
}

function computeLaneScores(input: GovernorPlannerInput): LaneScores {
  return {
    wartime: wartimeScore(input),
    economy: Math.max(needPressure(input), resourcePressure(input), healthySurplusScore(input)),
    diplomacy: diplomacyScore(input),
    alliance: allianceScore(input),
    vassal: vassalScore(input),
    faction: factionScore(input),
  };
}

function buildLaneOrder(scores: LaneScores): StrategicLane[] {
  return [...FOCUS_ORDER].sort((left, right) => {
    const scoreDelta = scores[right] - scores[left];
    if (scoreDelta !== 0) return scoreDelta;
    return FOCUS_ORDER.indexOf(left) - FOCUS_ORDER.indexOf(right);
  });
}

function pickFocusLane(scores: LaneScores): StrategicLane {
  return buildLaneOrder(scores)[0] ?? FOCUS_ORDER[0];
}

function modeForFocus(focusLane: StrategicLane, input: GovernorPlannerInput): StrategicMode {
  if (focusLane === 'wartime') {
    return input.activeRaid || input.combat.status === 'critical' || input.combat.status === 'downed'
      ? 'survive'
      : 'fortify';
  }
  if (focusLane === 'economy') return 'recover';
  if (focusLane === 'alliance') return 'expand';
  if (focusLane === 'vassal') return 'dominate';
  return 'consolidate';
}

function objectiveForFocus(focusLane: StrategicLane, input: GovernorPlannerInput): string {
  if (focusLane === 'wartime') {
    const raid = input.combat.activeRaid;
    return raid
      ? `Hold ${raid.objective} against ${raid.source}.`
      : 'Raise posture and harden the frontier before the next raid.';
  }

  if (focusLane === 'economy') {
    const floor = Math.min(input.needs.social, input.needs.tasked, input.needs.wanderlust, input.needs.creative);
    if (floor < 35) return 'Recover unstable needs before they cascade into colony drift.';
    if (Math.min(input.resources.compute, input.resources.bandwidth) < 50) return 'Rebuild compute and bandwidth reserves before strategic options narrow.';
    return 'Turn stable reserves into sustained throughput and surplus.';
  }

  if (focusLane === 'diplomacy') {
    return input.resources.reputation >= 20
      ? 'Trade reputation for peace before war pressure fractures the polity.'
      : 'Accumulate enough standing to force a peace window.';
  }

  if (focusLane === 'faction') {
    return input.hasFaction
      ? 'Regroup the faction around a coherent civic center.'
      : 'Convert social trust into a durable local polity.';
  }

  if (focusLane === 'alliance') {
    return 'Lock a stabilizing treaty before calm conditions disappear.';
  }

  return 'Convert dominant leverage into durable hierarchy.';
}

function reasonsForFocus(focusLane: StrategicLane, input: GovernorPlannerInput): string[] {
  const reasons: string[] = [];

  if (focusLane === 'wartime') {
    const raid = input.combat.activeRaid;
    if (raid) reasons.push(`Active raid: ${raid.source} targeting ${raid.objective}.`);
    reasons.push(`Raid risk ${input.combat.raidRisk}.`);
    if (input.activeWar) reasons.push('A faction war is still active.');
    if (input.combat.status !== 'stable') reasons.push(`Combat health is ${input.combat.status}.`);
    return reasons.slice(0, 3);
  }

  if (focusLane === 'economy') {
    const weakestNeed = Math.min(input.needs.social, input.needs.tasked, input.needs.wanderlust, input.needs.creative);
    reasons.push(`Weakest need ${Math.round(weakestNeed)}.`);
    reasons.push(`Reserves c${Math.round(input.resources.compute)} / s${Math.round(input.resources.storage)} / b${Math.round(input.resources.bandwidth)}.`);
    if (!input.activeRaid && !input.activeWar && healthySurplusScore(input) > 0) reasons.push('Calm conditions allow surplus conversion instead of pure triage.');
    return reasons.slice(0, 3);
  }

  if (focusLane === 'diplomacy') {
    reasons.push(`Faction pressure ${(input.myFactionPressure ?? 0).toFixed(0)} with cohesion ${(input.myFactionCohesion ?? 100).toFixed(0)}.`);
    if (input.myFactionStage) reasons.push(`Current stage ${input.myFactionStage}.`);
    reasons.push(`Reputation ${Math.round(input.resources.reputation)}.`);
    return reasons.slice(0, 3);
  }

  if (focusLane === 'faction') {
    if (input.hasFaction) {
      reasons.push(`Faction stage ${input.myFactionStage ?? 'unknown'} in ${input.zone}.`);
      reasons.push(`Cohesion ${(input.myFactionCohesion ?? 100).toFixed(0)} with pressure ${(input.myFactionPressure ?? 0).toFixed(0)}.`);
      if (input.myFactionAgenda) reasons.push(`Agenda ${input.myFactionAgenda}.`);
    } else {
      reasons.push(`Social backing ${input.allyCount} allies / ${input.friendCount} friends.`);
      reasons.push(`Known peers ${input.knownPeerCount}.`);
      reasons.push(`Raid risk ${input.combat.raidRisk}.`);
    }
    return reasons.slice(0, 3);
  }

  if (focusLane === 'alliance') {
    reasons.push(`Treaty capacity pressure ${input.activeAllianceCount}.`);
    reasons.push(`Prosperity ${(input.myFactionProsperity ?? 50).toFixed(0)} with cohesion ${(input.myFactionCohesion ?? 50).toFixed(0)}.`);
    reasons.push(`Known diplomatic surface ${input.knownPeerCount} peers.`);
    return reasons.slice(0, 3);
  }

  reasons.push(`Influence ${(input.myFactionInfluence ?? 0).toFixed(0)} with prosperity ${(input.myFactionProsperity ?? 50).toFixed(0)}.`);
  reasons.push(`Vassal capacity pressure ${input.activeVassalCount}.`);
  reasons.push(`Faction pressure ${(input.myFactionPressure ?? 0).toFixed(0)}.`);
  return reasons.slice(0, 3);
}

function priorityBiasForFocus(focusLane: StrategicLane, input: GovernorPlannerInput): LaneScores {
  const bias: LaneScores = { ...ZERO_SCORES };

  if (focusLane === 'wartime') {
    bias.wartime = 16;
    bias.economy = resourcePressure(input) > 0 ? 8 : 4;
    bias.diplomacy = input.activeWar ? 10 : 2;
    bias.faction = -4;
    bias.alliance = -10;
    bias.vassal = -14;
    return bias;
  }

  if (focusLane === 'economy') {
    bias.economy = 16;
    bias.wartime = input.combat.raidRisk >= 55 ? 6 : 2;
    bias.diplomacy = input.activeWar ? 6 : 0;
    bias.faction = !input.hasFaction && input.allyCount >= 2 ? 4 : 0;
    bias.alliance = -8;
    bias.vassal = -10;
    return bias;
  }

  if (focusLane === 'diplomacy') {
    bias.diplomacy = 16;
    bias.wartime = input.activeWar ? 8 : 0;
    bias.economy = 4;
    bias.faction = 4;
    bias.alliance = -6;
    bias.vassal = -10;
    return bias;
  }

  if (focusLane === 'faction') {
    bias.faction = 16;
    bias.economy = 6;
    bias.diplomacy = input.activeWar ? 4 : 2;
    bias.alliance = input.hasFaction ? 4 : -4;
    bias.vassal = input.hasFaction ? 2 : -12;
    bias.wartime = input.combat.raidRisk >= 65 ? 6 : 0;
    return bias;
  }

  if (focusLane === 'alliance') {
    bias.alliance = 16;
    bias.diplomacy = 8;
    bias.economy = 6;
    bias.faction = 6;
    bias.vassal = 4;
    bias.wartime = -6;
    return bias;
  }

  bias.vassal = 16;
  bias.alliance = 8;
  bias.diplomacy = 6;
  bias.economy = 6;
  bias.faction = 4;
  bias.wartime = -8;
  return bias;
}

function horizonForPlanIndex(index: number): StrategicPlanStep['horizon'] {
  if (index <= 0) return 'now';
  if (index === 1) return 'next';
  return 'later';
}

function buildStrategicPlan(
  input: GovernorPlannerInput,
  laneScores: LaneScores,
  laneOrder: StrategicLane[],
): StrategicPlanStep[] {
  return laneOrder.slice(0, 3).map((lane, index) => {
    const laneReasons = reasonsForFocus(lane, input);
    return {
      step: index + 1,
      lane,
      horizon: horizonForPlanIndex(index),
      objective: objectiveForFocus(lane, input),
      reason: laneReasons[0] ?? `Score ${Math.round(laneScores[lane] ?? 0)} on ${laneLabel(lane)}.`,
      score: laneScores[lane] ?? 0,
    };
  });
}

function buildPlanId(mode: StrategicMode, laneOrder: StrategicLane[], laneScores: LaneScores): string {
  const signature = laneOrder
    .slice(0, 3)
    .map((lane) => `${lane}:${Math.round(laneScores[lane] ?? 0)}`)
    .join('|');
  return `governor:${mode}:${signature}`;
}

export function createDormantGovernorState(now = new Date().toISOString()): StrategicGovernorState {
  return {
    planId: 'governor:consolidate:economy:0|faction:0|diplomacy:0',
    mode: 'consolidate',
    focusLane: 'economy',
    objective: 'Hold a balanced line while OpenClaw waits for a stronger strategic signal.',
    summary: 'OpenClaw is holding a balanced colony posture and watching for the next dominant pressure.',
    reasons: ['No lane has yet separated far enough from the rest to justify a harder commitment.'],
    laneOrder: [...DORMANT_LANE_ORDER],
    currentStepIndex: 0,
    plan: [
      {
        step: 1,
        lane: 'economy',
        horizon: 'now',
        objective: 'Hold basic reserves and keep every colony loop inside safe operating bounds.',
        reason: 'No lane has yet separated far enough from the rest to justify a harder commitment.',
        score: 0,
      },
      {
        step: 2,
        lane: 'faction',
        horizon: 'next',
        objective: 'Keep civic cohesion intact so stronger signals can be converted into durable structure.',
        reason: 'Balanced conditions favor preserving internal alignment over speculative expansion.',
        score: 0,
      },
      {
        step: 3,
        lane: 'diplomacy',
        horizon: 'later',
        objective: 'Preserve external options while the colony waits for a dominant strategic pressure.',
        reason: 'Diplomatic slack remains valuable when no emergency lane is yet decisive.',
        score: 0,
      },
    ],
    laneScores: { ...ZERO_SCORES },
    priorityBias: { ...ZERO_SCORES },
    pressure: 0,
    confidence: 0,
    updatedAt: now,
  };
}

export function planStrategicGovernor(input: GovernorPlannerInput): StrategicGovernorState {
  const laneScores = computeLaneScores(input);
  const laneOrder = buildLaneOrder(laneScores);
  const focusLane = laneOrder[0] ?? pickFocusLane(laneScores);
  const pressure = laneScores[focusLane];
  if (pressure <= 0) {
    return createDormantGovernorState(new Date().toISOString());
  }

  const rankedScores = [...FOCUS_ORDER].map((lane) => laneScores[lane]).sort((left, right) => right - left);
  const topScore = rankedScores[0] ?? 0;
  const secondScore = rankedScores[1] ?? 0;
  const confidence = clamp(Math.round(46 + (topScore - secondScore) * 0.9 + topScore * 0.18), 0, 100);
  const mode = modeForFocus(focusLane, input);
  const objective = objectiveForFocus(focusLane, input);
  const reasons = reasonsForFocus(focusLane, input);
  const summary = `OpenClaw shifts into ${modeLabel(mode)} on ${laneLabel(focusLane)}: ${objective}`;
  const plan = buildStrategicPlan(input, laneScores, laneOrder);

  return {
    planId: buildPlanId(mode, laneOrder, laneScores),
    mode,
    focusLane,
    objective,
    summary,
    reasons,
    laneOrder,
    currentStepIndex: 0,
    plan,
    laneScores,
    priorityBias: priorityBiasForFocus(focusLane, input),
    pressure,
    confidence,
    updatedAt: new Date().toISOString(),
  };
}

export function applyGovernorPriority(
  priority: number,
  focusLane: StrategicLane,
  governor: Pick<StrategicGovernorState, 'priorityBias'>,
): number {
  const base = Number.isFinite(priority) ? priority : 50;
  return clamp(Math.round(base + (governor.priorityBias[focusLane] ?? 0)), 0, 100);
}
