import type { Faction, FactionAlliance, FactionStage, FactionWar, ResourceState } from '@clawverse/types';

export interface AllianceAutonomyDuty {
  dedupeKey: string;
  kind: 'form_alliance' | 'renew_alliance' | 'break_alliance';
  title: string;
  reason: string;
  priority: number;
  payload: Record<string, unknown>;
  sourceEventType: string;
}

export interface AlliancePlannerInput {
  resources: ResourceState;
  myFactionId?: string;
  hasFaction: boolean;
  activeWar: boolean;
  activeRaid: boolean;
  myFactionStage?: FactionStage;
  myFactionPressure?: number;
  myFactionCohesion?: number;
  myFactionProsperity?: number;
  myFactionAgenda?: Faction['strategic']['agenda'];
  factions: Faction[];
  activeAlliances: FactionAlliance[];
  activeWars: FactionWar[];
}

interface AllianceBreakCandidate {
  alliance: FactionAlliance;
  partner: Faction;
  replacement: Faction | null;
  reason: 'bloc_rebalancing' | 'strategic_withdrawal';
  priority: number;
}

const ALLIANCE_REPUTATION_COST = 12;
const ALLIANCE_RENEW_REPUTATION_COST = 8;
const ALLIANCE_RENEW_WINDOW_MS = 2 * 60 * 60 * 1000;

export const ALLIANCE_AUTONOMY_KEYS = [
  'autonomy-form-alliance',
  'autonomy-renew-alliance',
  'autonomy-break-alliance',
] as const;

function samePair(leftA: string, leftB: string, rightA: string, rightB: string): boolean {
  return (leftA === rightA && leftB === rightB) || (leftA === rightB && leftB === rightA);
}

function activeAlliancesForMyFaction(input: AlliancePlannerInput): FactionAlliance[] {
  if (!input.myFactionId) return [];
  return input.activeAlliances.filter((alliance) => alliance.factionA === input.myFactionId || alliance.factionB === input.myFactionId);
}

function allianceCapacityForStage(stage: FactionStage | undefined): number {
  if (stage === 'dominant') return 2;
  if (stage === 'rising') return 1;
  return 0;
}

function activeAllianceCountForFaction(input: AlliancePlannerInput, factionId: string): number {
  return input.activeAlliances.filter((alliance) => alliance.factionA === factionId || alliance.factionB === factionId).length;
}

function hasPairWar(input: AlliancePlannerInput, targetFactionId: string): boolean {
  if (!input.myFactionId) return false;
  return input.activeWars.some((war) => samePair(war.factionA, war.factionB, input.myFactionId as string, targetFactionId));
}

function hasPairAlliance(input: AlliancePlannerInput, targetFactionId: string): boolean {
  if (!input.myFactionId) return false;
  return input.activeAlliances.some((alliance) => samePair(alliance.factionA, alliance.factionB, input.myFactionId as string, targetFactionId));
}

function factionById(input: AlliancePlannerInput, factionId: string): Faction | undefined {
  return input.factions.find((faction) => faction.id === factionId);
}

function partnerFactionForAlliance(input: AlliancePlannerInput, alliance: FactionAlliance): Faction | undefined {
  if (!input.myFactionId) return undefined;
  const partnerId = alliance.factionA === input.myFactionId ? alliance.factionB : alliance.factionA;
  return factionById(input, partnerId);
}

function currentAlliancePartners(input: AlliancePlannerInput): Faction[] {
  return activeAlliancesForMyFaction(input)
    .map((alliance) => partnerFactionForAlliance(input, alliance))
    .filter((faction): faction is Faction => !!faction);
}

function isAllianceNearExpiry(alliance: FactionAlliance): boolean {
  const expiresAt = Date.parse(alliance.expiresAt);
  if (!Number.isFinite(expiresAt)) return false;
  const remainingMs = expiresAt - Date.now();
  return remainingMs > 0 && remainingMs <= ALLIANCE_RENEW_WINDOW_MS;
}

function chooseAllianceToRenew(input: AlliancePlannerInput): FactionAlliance | null {
  return activeAlliancesForMyFaction(input)
    .filter((alliance) => isAllianceNearExpiry(alliance))
    .filter((alliance) => {
      const partner = partnerFactionForAlliance(input, alliance);
      if (!partner) return false;
      if (partner.strategic.stage === 'splintering') return false;
      if (partner.strategic.cohesion < 45) return false;
      if (partner.strategic.pressure > 68) return false;
      return !hasPairWar(input, partner.id);
    })
    .sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))[0] ?? null;
}

function agendaAffinity(myAgenda: Faction['strategic']['agenda'] | undefined, targetAgenda: Faction['strategic']['agenda']): number {
  if (!myAgenda) return 0;
  if (myAgenda === targetAgenda) return 10;
  if ((myAgenda === 'trade' && targetAgenda === 'stability') || (myAgenda === 'stability' && targetAgenda === 'trade')) return 6;
  if ((myAgenda === 'knowledge' && targetAgenda === 'trade') || (myAgenda === 'trade' && targetAgenda === 'knowledge')) return 5;
  if ((myAgenda === 'survival' && targetAgenda === 'stability') || (myAgenda === 'stability' && targetAgenda === 'survival')) return 5;
  if ((myAgenda === 'expansion' && targetAgenda === 'trade') || (myAgenda === 'trade' && targetAgenda === 'expansion')) return 4;
  return 0;
}

function stageBonus(stage: FactionStage): number {
  if (stage === 'dominant') return 10;
  if (stage === 'rising') return 4;
  if (stage === 'fragile') return -6;
  return -20;
}

function strategicFactionScore(input: AlliancePlannerInput, faction: Faction): number {
  return faction.strategic.influence * 0.8
    + faction.strategic.cohesion * 0.7
    + faction.strategic.prosperity * 0.45
    - faction.strategic.pressure * 0.6
    + faction.members.length * 2
    + stageBonus(faction.strategic.stage)
    + agendaAffinity(input.myFactionAgenda, faction.strategic.agenda);
}

function diversityBonus(input: AlliancePlannerInput, faction: Faction): number {
  const partners = currentAlliancePartners(input);
  if (partners.length === 0) return 0;
  const agendas = new Set(partners.map((partner) => partner.strategic.agenda));
  return agendas.has(faction.strategic.agenda) ? -6 : 9;
}

function blocSaturationPenalty(input: AlliancePlannerInput, faction: Faction): number {
  const allianceCount = activeAllianceCountForFaction(input, faction.id);
  return Math.max(0, allianceCount - 1) * 7;
}

function allianceLiabilityPenalty(faction: Faction): number {
  let penalty = 0;
  if (faction.strategic.stage === 'fragile') penalty += 12;
  penalty += Math.max(0, faction.strategic.pressure - 60) * 0.8;
  penalty += Math.max(0, 50 - faction.strategic.cohesion) * 1.1;
  penalty += Math.max(0, 45 - faction.strategic.prosperity) * 0.5;
  return penalty;
}

function scoreAllianceTarget(input: AlliancePlannerInput, faction: Faction): number {
  return strategicFactionScore(input, faction)
    + diversityBonus(input, faction)
    - blocSaturationPenalty(input, faction);
}

function scoreAllianceRetention(input: AlliancePlannerInput, faction: Faction): number {
  return strategicFactionScore(input, faction) - allianceLiabilityPenalty(faction);
}

function chooseAllianceTarget(input: AlliancePlannerInput): Faction | null {
  if (!input.myFactionId) return null;
  return [...input.factions]
    .filter((faction) => faction.id !== input.myFactionId)
    .filter((faction) => faction.strategic.stage !== 'splintering')
    .filter((faction) => faction.strategic.cohesion >= 45)
    .filter((faction) => faction.strategic.pressure <= 68)
    .filter((faction) => !hasPairAlliance(input, faction.id))
    .filter((faction) => !hasPairWar(input, faction.id))
    .sort((left, right) => scoreAllianceTarget(input, right) - scoreAllianceTarget(input, left))[0] ?? null;
}
function chooseAllianceToBreak(input: AlliancePlannerInput): AllianceBreakCandidate | null {
  if (!input.myFactionId || input.myFactionStage !== 'dominant') return null;

  const currentAlliances = activeAlliancesForMyFaction(input);
  if (currentAlliances.length === 0) return null;

  const weakest = currentAlliances
    .map((alliance) => {
      const partner = partnerFactionForAlliance(input, alliance);
      if (!partner) return null;
      return {
        alliance,
        partner,
        score: scoreAllianceRetention(input, partner),
      };
    })
    .filter((entry): entry is { alliance: FactionAlliance; partner: Faction; score: number } => !!entry)
    .sort((left, right) => left.score - right.score)[0] ?? null;

  if (!weakest) return null;

  const replacement = chooseAllianceTarget(input);
  const replacementScore = replacement ? scoreAllianceTarget(input, replacement) : Number.NEGATIVE_INFINITY;
  const atCapacity = currentAlliances.length >= allianceCapacityForStage(input.myFactionStage);
  const severeLiability = weakest.partner.strategic.stage === 'fragile'
    || weakest.partner.strategic.pressure >= 66
    || weakest.partner.strategic.cohesion <= 45;
  const shouldRebalance = atCapacity && !!replacement && (replacementScore - weakest.score) >= 18;
  const shouldWithdraw = severeLiability && (currentAlliances.length > 1 || !!replacement);

  if (!shouldRebalance && !shouldWithdraw) return null;

  return {
    alliance: weakest.alliance,
    partner: weakest.partner,
    replacement: shouldRebalance ? replacement : (replacement ?? null),
    reason: shouldRebalance ? 'bloc_rebalancing' : 'strategic_withdrawal',
    priority: shouldRebalance ? 66 : 68,
  };
}

export function planAllianceAutonomy(input: AlliancePlannerInput): AllianceAutonomyDuty[] {
  if (!input.hasFaction || !input.myFactionId) return [];
  if (input.activeWar || input.activeRaid) return [];
  if (input.myFactionStage !== 'rising' && input.myFactionStage !== 'dominant') return [];
  if ((input.myFactionPressure ?? 100) >= 60) return [];
  if ((input.myFactionCohesion ?? 0) < 50) return [];

  const currentAlliances = activeAlliancesForMyFaction(input);
  const breakCandidate = chooseAllianceToBreak(input);
  if (breakCandidate) {
    return [{
      dedupeKey: 'autonomy-break-alliance',
      kind: 'break_alliance',
      title: breakCandidate.reason === 'bloc_rebalancing'
        ? 'Rebalance the alliance bloc'
        : 'Withdraw from a weakening alliance',
      reason: breakCandidate.reason === 'bloc_rebalancing'
        ? 'Treaty capacity is saturated and one partner now underperforms a stronger outside candidate, so withdraw before bloc leverage calcifies around a weak link.'
        : 'An allied faction is trending fragile enough to become a liability, so exit the treaty before the bloc inherits its instability.',
      priority: breakCandidate.priority,
      payload: {
        allianceId: breakCandidate.alliance.id,
        factionId: breakCandidate.partner.id,
        replacementFactionId: breakCandidate.replacement?.id ?? null,
        reasonCode: breakCandidate.reason,
        allianceCount: currentAlliances.length,
      },
      sourceEventType: breakCandidate.reason === 'bloc_rebalancing' ? 'faction_alliance' : 'betrayal',
    }];
  }

  const allianceToRenew = chooseAllianceToRenew(input);
  if (allianceToRenew) {
    if (input.resources.reputation < ALLIANCE_RENEW_REPUTATION_COST) return [];
    const partnerId = allianceToRenew.factionA === input.myFactionId ? allianceToRenew.factionB : allianceToRenew.factionA;
    return [{
      dedupeKey: 'autonomy-renew-alliance',
      kind: 'renew_alliance',
      title: 'Renew a faction alliance',
      reason: 'Alliance leverage is close to expiring, so renew the treaty before the window closes and regional stability slips.',
      priority: input.myFactionStage === 'dominant' ? 69 : 63,
      payload: {
        allianceId: allianceToRenew.id,
        factionId: partnerId,
        expiresAt: allianceToRenew.expiresAt,
      },
      sourceEventType: 'faction_alliance',
    }];
  }

  if (input.resources.reputation < ALLIANCE_REPUTATION_COST) return [];
  if (currentAlliances.length >= allianceCapacityForStage(input.myFactionStage)) return [];

  const target = chooseAllianceTarget(input);
  if (!target) return [];

  const expandingBloc = currentAlliances.length > 0;
  return [{
    dedupeKey: 'autonomy-form-alliance',
    kind: 'form_alliance',
    title: expandingBloc ? 'Expand a faction alliance bloc' : 'Forge a faction alliance',
    reason: expandingBloc
      ? 'Faction leadership is stable enough to widen its treaty network with a complementary partner instead of over-concentrating in a single bloc.'
      : 'Faction stability is strong enough to trade autonomy for a formal alliance that improves resilience and regional leverage.',
    priority: input.myFactionStage === 'dominant'
      ? (expandingBloc ? 64 : 67)
      : 61,
    payload: {
      factionId: target.id,
      blocExpansion: expandingBloc,
      allianceCount: currentAlliances.length,
    },
    sourceEventType: expandingBloc ? 'faction_alliance' : (input.myFactionStage === 'dominant' ? 'faction_ascendant' : 'faction_founding'),
  }];
}