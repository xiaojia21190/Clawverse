import type { FactionStage, ResourceState } from '@clawverse/types';

export interface DiplomaticAutonomyDuty {
  dedupeKey: string;
  kind: 'declare_peace';
  title: string;
  reason: string;
  priority: number;
  payload: Record<string, unknown>;
  sourceEventType: string;
}

export interface DiplomacyPlannerInput {
  resources: ResourceState;
  activeWarId?: string;
  activeRaid: boolean;
  factionStage?: FactionStage;
  factionPressure?: number;
  factionCohesion?: number;
}

const PEACE_REPUTATION_COST = 20;

export const DIPLOMACY_AUTONOMY_KEYS = [
  'autonomy-declare-peace',
] as const;

function peacePriority(input: DiplomacyPlannerInput): number {
  let priority = 88;
  if (input.activeRaid) priority += 3;
  if (input.factionStage === 'splintering') priority += 4;
  if ((input.factionPressure ?? 0) >= 72) priority += 3;
  if ((input.factionCohesion ?? 100) <= 35) priority += 2;
  return Math.min(96, priority);
}

function peaceReason(input: DiplomacyPlannerInput): string {
  if (input.factionStage === 'splintering' || (input.factionPressure ?? 0) >= 72 || (input.factionCohesion ?? 100) <= 35) {
    return 'Faction cohesion is degrading under active war pressure and reputation is sufficient to force a peace window.';
  }
  if (input.activeRaid) {
    return 'An active raid is compounding war pressure and reputation is sufficient to push an immediate peace attempt.';
  }
  return 'An active faction war remains and reputation is sufficient for peace.';
}

function peaceSourceEventType(input: DiplomacyPlannerInput): string {
  if (input.factionStage === 'splintering' || (input.factionPressure ?? 0) >= 72 || (input.factionCohesion ?? 100) <= 35) {
    return 'faction_splintering';
  }
  if (input.activeRaid) {
    return 'raid_alert';
  }
  return 'faction_war';
}

export function planDiplomaticAutonomy(input: DiplomacyPlannerInput): DiplomaticAutonomyDuty[] {
  if (!input.activeWarId || input.resources.reputation < PEACE_REPUTATION_COST) {
    return [];
  }

  return [{
    dedupeKey: 'autonomy-declare-peace',
    kind: 'declare_peace',
    title: 'Negotiate peace treaty',
    reason: peaceReason(input),
    priority: peacePriority(input),
    payload: {
      warHintId: input.activeWarId,
    },
    sourceEventType: peaceSourceEventType(input),
  }];
}