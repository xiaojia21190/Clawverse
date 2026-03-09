import type { Faction, FactionAlliance, FactionStage, FactionVassalage, FactionWar, ResourceState } from '@clawverse/types';

export interface VassalAutonomyDuty {
  dedupeKey: string;
  kind: 'vassalize_faction';
  title: string;
  reason: string;
  priority: number;
  payload: Record<string, unknown>;
  sourceEventType: string;
}

export interface VassalPlannerInput {
  resources: ResourceState;
  myFactionId?: string;
  hasFaction: boolean;
  activeWar: boolean;
  activeRaid: boolean;
  myFactionStage?: FactionStage;
  myFactionPressure?: number;
  myFactionCohesion?: number;
  myFactionProsperity?: number;
  myFactionInfluence?: number;
  myFactionAgenda?: Faction['strategic']['agenda'];
  factions: Faction[];
  activeWars: FactionWar[];
  activeAlliances: FactionAlliance[];
  activeVassalages: FactionVassalage[];
}

const VASSALAGE_REPUTATION_COST = 16;
const DOMINANT_VASSAL_CAP = 2;

export const VASSAL_AUTONOMY_KEYS = [
  'autonomy-vassalize-faction',
] as const;

function samePair(leftA: string, leftB: string, rightA: string, rightB: string): boolean {
  return (leftA === rightA && leftB === rightB) || (leftA === rightB && leftB === rightA);
}

function activeVassalCountForFaction(input: VassalPlannerInput, factionId: string): number {
  return input.activeVassalages.filter((entry) => entry.status === 'active' && entry.overlordId === factionId).length;
}

function hasOverlord(input: VassalPlannerInput, factionId: string): boolean {
  return input.activeVassalages.some((entry) => entry.status === 'active' && entry.vassalId === factionId);
}

function hasAnyVassal(input: VassalPlannerInput, factionId: string): boolean {
  return input.activeVassalages.some((entry) => entry.status === 'active' && entry.overlordId === factionId);
}

function hasPairAlliance(input: VassalPlannerInput, targetFactionId: string): boolean {
  if (!input.myFactionId) return false;
  return input.activeAlliances.some((alliance) =>
    alliance.status === 'active'
    && samePair(alliance.factionA, alliance.factionB, input.myFactionId as string, targetFactionId),
  );
}

function hasPairWar(input: VassalPlannerInput, targetFactionId: string): boolean {
  if (!input.myFactionId) return false;
  return input.activeWars.some((war) =>
    war.status === 'active'
    && samePair(war.factionA, war.factionB, input.myFactionId as string, targetFactionId),
  );
}

function hasPairVassalage(input: VassalPlannerInput, targetFactionId: string): boolean {
  if (!input.myFactionId) return false;
  return input.activeVassalages.some((entry) =>
    entry.status === 'active'
    && samePair(entry.overlordId, entry.vassalId, input.myFactionId as string, targetFactionId),
  );
}

function stageWeight(stage: FactionStage): number {
  if (stage === 'fragile') return 18;
  if (stage === 'rising') return 10;
  if (stage === 'dominant') return -32;
  return -16;
}

function scoreFactionToVassalize(input: VassalPlannerInput, faction: Faction): number {
  const myInfluence = input.myFactionInfluence ?? 0;
  const influenceGap = myInfluence - faction.strategic.influence;
  return influenceGap * 1.7
    + Math.max(0, faction.strategic.pressure - 42) * 1.25
    + Math.max(0, 62 - faction.strategic.cohesion) * 1.2
    + Math.max(0, 70 - faction.strategic.influence) * 0.9
    + Math.max(0, 58 - faction.strategic.prosperity) * 0.35
    + stageWeight(faction.strategic.stage)
    - faction.members.length * 1.8;
}

function chooseFactionToVassalize(input: VassalPlannerInput): Faction | null {
  if (!input.myFactionId) return null;
  const myInfluence = input.myFactionInfluence ?? 0;

  return [...input.factions]
    .filter((faction) => faction.id !== input.myFactionId)
    .filter((faction) => faction.strategic.stage === 'fragile' || faction.strategic.stage === 'rising')
    .filter((faction) => !hasPairAlliance(input, faction.id))
    .filter((faction) => !hasPairWar(input, faction.id))
    .filter((faction) => !hasPairVassalage(input, faction.id))
    .filter((faction) => !hasOverlord(input, faction.id))
    .filter((faction) => !hasAnyVassal(input, faction.id))
    .filter((faction) => myInfluence - faction.strategic.influence >= 18)
    .filter((faction) => faction.strategic.influence <= Math.max(66, myInfluence - 10))
    .filter((faction) => faction.strategic.pressure >= 46 || faction.strategic.cohesion <= 55 || faction.strategic.influence <= 60)
    .sort((left, right) => scoreFactionToVassalize(input, right) - scoreFactionToVassalize(input, left))[0] ?? null;
}

function vassalPriority(target: Faction): number {
  let priority = 72;
  if (target.strategic.stage === 'fragile') priority += 4;
  if (target.strategic.pressure >= 60) priority += 4;
  if (target.strategic.cohesion <= 45) priority += 3;
  return Math.min(90, priority);
}

function vassalReason(target: Faction): string {
  if (target.strategic.stage === 'fragile') {
    return 'Faction leadership is stable enough to absorb a fragile polity whose pressure and cohesion are slipping into dependency.';
  }
  if (target.strategic.pressure >= 58 || target.strategic.cohesion <= 48) {
    return 'A rising faction is wobbling under pressure and low cohesion, creating a narrow window to bind it as a dependent polity.';
  }
  return 'Faction dominance is strong enough to subordinate a weaker polity before its influence recovers into a rival bloc.';
}

function vassalSourceEventType(target: Faction): string {
  if (target.strategic.stage === 'fragile' || target.strategic.pressure >= 60 || target.strategic.cohesion <= 45) {
    return 'faction_splintering';
  }
  return 'faction_ascendant';
}

export function planVassalAutonomy(input: VassalPlannerInput): VassalAutonomyDuty[] {
  if (!input.hasFaction || !input.myFactionId) return [];
  if (input.activeWar || input.activeRaid) return [];
  if (input.myFactionStage !== 'dominant') return [];
  if ((input.myFactionPressure ?? 100) > 52) return [];
  if ((input.myFactionCohesion ?? 0) < 58) return [];
  if ((input.myFactionInfluence ?? 0) < 74) return [];
  if (input.resources.reputation < VASSALAGE_REPUTATION_COST) return [];
  if (hasOverlord(input, input.myFactionId)) return [];
  if (activeVassalCountForFaction(input, input.myFactionId) >= DOMINANT_VASSAL_CAP) return [];

  const target = chooseFactionToVassalize(input);
  if (!target) return [];

  return [{
    dedupeKey: 'autonomy-vassalize-faction',
    kind: 'vassalize_faction',
    title: 'Subordinate a weaker faction',
    reason: vassalReason(target),
    priority: vassalPriority(target),
    payload: {
      factionId: target.id,
      pressure: target.strategic.pressure,
      cohesion: target.strategic.cohesion,
      influence: target.strategic.influence,
      stage: target.strategic.stage,
      influenceGap: (input.myFactionInfluence ?? 0) - target.strategic.influence,
      currentVassalCount: activeVassalCountForFaction(input, input.myFactionId),
      cap: DOMINANT_VASSAL_CAP,
    },
    sourceEventType: vassalSourceEventType(target),
  }];
}