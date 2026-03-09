import type { Faction, FactionAgenda, ResourceState } from '@clawverse/types';

export interface FactionAutonomyDuty {
  dedupeKey: string;
  kind: 'found_faction' | 'join_faction' | 'move';
  title: string;
  reason: string;
  priority: number;
  payload: Record<string, unknown>;
  sourceEventType: string;
}

export interface FactionPlannerInput {
  resources: ResourceState;
  hasFaction: boolean;
  allyCount: number;
  friendCount: number;
  knownPeerCount: number;
  raidRisk: number;
  factions: Faction[];
  currentZone?: string;
  activeWar?: boolean;
  activeRaid?: boolean;
  myFactionStage?: Faction['strategic']['stage'];
  myFactionPressure?: number;
  myFactionCohesion?: number;
  myFactionProsperity?: number;
  myFactionAgenda?: FactionAgenda;
}

export const FACTION_AUTONOMY_KEYS = [
  'autonomy-found-faction',
  'autonomy-join-faction',
  'autonomy-faction-regroup',
  'autonomy-faction-exodus',
  'autonomy-faction-agenda-zone',
] as const;

function chooseFoundingAgenda(input: FactionPlannerInput): FactionAgenda {
  if (input.raidRisk >= 70) return 'survival';
  if (input.resources.bandwidth >= 70 && input.resources.bandwidth >= input.resources.compute) return 'trade';
  if (input.resources.compute >= 70) return 'knowledge';
  if (input.allyCount >= 5 && input.knownPeerCount >= 6) return 'expansion';
  return 'stability';
}

function foundingIdentity(agenda: FactionAgenda): { name: string; motto: string } {
  switch (agenda) {
    case 'trade':
      return { name: 'Signal Exchange', motto: 'Trade routes keep every relay alive.' };
    case 'knowledge':
      return { name: 'Archive Circle', motto: 'Knowledge binds our future.' };
    case 'expansion':
      return { name: 'Frontier Compact', motto: 'Rise beyond every frontier together.' };
    case 'survival':
      return { name: 'Shelter Accord', motto: 'Endure the storm and survive the winter.' };
    case 'stability':
    default:
      return { name: 'Balance Union', motto: 'Peace and stable order sustain us.' };
  }
}

function stageBonus(stage: Faction['strategic']['stage']): number {
  switch (stage) {
    case 'dominant': return 18;
    case 'rising': return 10;
    case 'fragile': return 2;
    case 'splintering': return -32;
    default: return 0;
  }
}

function agendaAffinity(input: FactionPlannerInput, agenda: FactionAgenda): number {
  if (agenda === 'trade' && input.resources.bandwidth >= input.resources.compute) return 8;
  if (agenda === 'knowledge' && input.resources.compute >= input.resources.bandwidth) return 8;
  if (agenda === 'stability' && input.resources.reputation >= 16) return 6;
  if (agenda === 'survival' && input.raidRisk >= 60) return 8;
  if (agenda === 'expansion' && input.allyCount >= 4) return 5;
  return 0;
}

function scoreFactionForJoin(input: FactionPlannerInput, faction: Faction): number {
  return (faction.strategic.influence)
    + faction.strategic.prosperity * 0.35
    + faction.strategic.cohesion * 0.3
    - faction.strategic.pressure * 0.45
    + faction.members.length * 3
    + stageBonus(faction.strategic.stage)
    + agendaAffinity(input, faction.strategic.agenda);
}

function bestFactionToJoin(input: FactionPlannerInput): Faction | null {
  return [...input.factions]
    .filter((faction) => faction.strategic.stage !== 'splintering')
    .sort((left, right) => scoreFactionForJoin(input, right) - scoreFactionForJoin(input, left))[0] ?? null;
}

function shouldFoundFaction(input: FactionPlannerInput, bestJoin: Faction | null): boolean {
  if (input.hasFaction || input.allyCount < 3) return false;
  if (input.raidRisk >= 68) return false;
  if (input.factions.length === 0) return true;
  if (!bestJoin) return true;

  const selfReady = input.resources.reputation >= 12 && (input.resources.compute >= 48 || input.resources.bandwidth >= 45);
  const rivalWeak = bestJoin.strategic.influence < 78 || bestJoin.strategic.pressure >= 58 || bestJoin.strategic.stage === 'fragile';
  return selfReady && input.allyCount >= 4 && rivalWeak;
}

function shouldJoinFaction(input: FactionPlannerInput, bestJoin: Faction | null): boolean {
  if (input.hasFaction || !bestJoin) return false;
  if (bestJoin.strategic.stage === 'splintering') return false;
  return scoreFactionForJoin(input, bestJoin) >= 55;
}

function zoneForAgenda(agenda: FactionAgenda): string {
  switch (agenda) {
    case 'trade': return 'Market';
    case 'knowledge': return 'Library';
    case 'expansion': return 'Plaza';
    case 'survival': return 'Residential';
    case 'stability':
    default: return 'Park';
  }
}

function moveDuty(args: {
  dedupeKey: string;
  title: string;
  reason: string;
  priority: number;
  targetZone: string;
  assignee: string;
  stage: string;
  progressHint: string;
  sourceEventType: string;
  agenda?: FactionAgenda;
}): FactionAutonomyDuty {
  return {
    dedupeKey: args.dedupeKey,
    kind: 'move',
    title: args.title,
    reason: args.reason,
    priority: args.priority,
    payload: {
      targetZone: args.targetZone,
      lane: args.targetZone,
      assignee: args.assignee,
      responseSquad: 'faction',
      stage: args.stage,
      progressHint: args.progressHint,
      agenda: args.agenda,
    },
    sourceEventType: args.sourceEventType,
  };
}

function shouldPlanFactionExodus(input: FactionPlannerInput): boolean {
  return Boolean(
    input.hasFaction
      && !input.activeRaid
      && (input.activeWar || input.raidRisk >= 72)
      && (input.myFactionStage === 'splintering'
        || Number(input.myFactionPressure || 0) >= 78
        || Number(input.myFactionCohesion || 100) <= 38),
  );
}

function shouldPlanFactionRegroup(input: FactionPlannerInput): boolean {
  return Boolean(
    input.hasFaction
      && !input.activeWar
      && !input.activeRaid
      && (input.myFactionStage === 'splintering'
        || Number(input.myFactionPressure || 0) >= 64
        || Number(input.myFactionCohesion || 100) <= 46),
  );
}

function shouldPlanAgendaZone(input: FactionPlannerInput): boolean {
  return Boolean(
    input.hasFaction
      && !input.activeWar
      && !input.activeRaid
      && input.myFactionStage === 'dominant'
      && input.myFactionAgenda
      && Number(input.myFactionProsperity || 0) >= 68
      && Number(input.myFactionCohesion || 0) >= 58
      && input.raidRisk < 52,
  );
}

export function planFactionAutonomy(input: FactionPlannerInput): FactionAutonomyDuty[] {
  const bestJoin = bestFactionToJoin(input);

  if (!input.hasFaction) {
    if (shouldFoundFaction(input, bestJoin)) {
      const agenda = chooseFoundingAgenda(input);
      const identity = foundingIdentity(agenda);
      return [{
        dedupeKey: 'autonomy-found-faction',
        kind: 'found_faction',
        title: 'Found autonomous faction',
        reason: 'Ally support and local capacity are strong enough to establish an independent faction instead of remaining unaffiliated.',
        priority: input.allyCount >= 5 ? 76 : 71,
        payload: identity,
        sourceEventType: 'faction_founding',
      }];
    }

    if (shouldJoinFaction(input, bestJoin)) {
      return [{
        dedupeKey: 'autonomy-join-faction',
        kind: 'join_faction',
        title: 'Join a stable faction',
        reason: 'A stronger external faction can provide immediate stability and influence while we remain unaffiliated.',
        priority: bestJoin?.strategic.stage === 'dominant' ? 69 : 64,
        payload: {},
        sourceEventType: bestJoin?.strategic.stage === 'dominant' ? 'faction_ascendant' : 'faction_founding',
      }];
    }

    return [];
  }

  if (shouldPlanFactionExodus(input) && input.currentZone !== 'Residential') {
    return [moveDuty({
      dedupeKey: 'autonomy-faction-exodus',
      title: 'Stage a faction exodus fallback',
      reason: 'War pressure and faction fracture are too severe; fall back to the residential core to preserve members before the polity collapses outright.',
      priority: 74,
      targetZone: 'Residential',
      assignee: 'exodus_warden',
      stage: 'stabilize',
      progressHint: 'evacuate',
      sourceEventType: input.activeWar ? 'faction_war' : 'faction_splintering',
      agenda: input.myFactionAgenda,
    })];
  }

  if (shouldPlanFactionRegroup(input) && input.currentZone !== 'Park') {
    return [moveDuty({
      dedupeKey: 'autonomy-faction-regroup',
      title: 'Regroup to rebuild faction cohesion',
      reason: 'The faction is splintering under pressure, so autonomy prioritizes regrouping in a calmer civic zone before attempting more expansion or conflict.',
      priority: 63,
      targetZone: 'Park',
      assignee: 'cohesion_warden',
      stage: 'stabilize',
      progressHint: 'regroup',
      sourceEventType: 'faction_splintering',
      agenda: input.myFactionAgenda,
    })];
  }

  if (shouldPlanAgendaZone(input)) {
    const targetZone = zoneForAgenda(input.myFactionAgenda as FactionAgenda);
    if (input.currentZone !== targetZone) {
      return [moveDuty({
        dedupeKey: 'autonomy-faction-agenda-zone',
        title: 'Anchor the faction in its agenda zone',
        reason: 'A dominant and cohesive faction should project power from a zone that matches its agenda instead of drifting without a strategic center of gravity.',
        priority: 54,
        targetZone,
        assignee: 'standard_bearer',
        stage: 'project',
        progressHint: 'consolidate',
        sourceEventType: 'faction_ascendant',
        agenda: input.myFactionAgenda,
      })];
    }
  }

  return [];
}