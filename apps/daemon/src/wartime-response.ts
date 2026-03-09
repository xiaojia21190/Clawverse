import type { BuildingType, CombatState, RaidState, ResourceState } from '@clawverse/types';

export type WartimeRole =
  | 'marshal'
  | 'field_medic'
  | 'signal_warden'
  | 'bulwark_engineer'
  | 'quartermaster';

export type WartimeStage = 'stabilize' | 'fortify' | 'sustain';

export interface WartimeDuty {
  dedupeKey: string;
  role: WartimeRole;
  stage: WartimeStage;
  duty: string;
  kind: 'move' | 'recover' | 'build' | 'trade' | 'craft';
  title: string;
  reason: string;
  priority: number;
  payload: Record<string, unknown>;
  sourceEventType: string;
}

export interface WartimeResponseInput {
  activeRaid: RaidState | null;
  combatState: CombatState;
  resources: ResourceState;
  ownedBuildings: BuildingType[];
  relayPatches: number;
  dataShards: number;
  alloyFrames: number;
  activeWar: boolean;
  canAffordBuilding: (type: BuildingType) => boolean;
  canCraftRecipe: (recipeId: 'data_shard' | 'alloy_frame' | 'relay_patch') => boolean;
}

export const WARTIME_RESPONSE_KEYS = [
  'autonomy-war-marshal-line',
  'autonomy-recover-triage',
  'autonomy-build-shelter',
  'autonomy-build-watchtower',
  'autonomy-build-beacon-doctrine',
  'autonomy-build-shelter-doctrine',
  'autonomy-raid-bandwidth-trade',
  'autonomy-raid-compute-trade',
  'autonomy-combat-relay-buffer',
] as const;

function defenseZoneFor(raid: RaidState | null): string {
  if (!raid) return 'Residential';
  if (raid.source === 'bandwidth_pirates') return 'Market';
  if (raid.source === 'compute_scavengers') return 'Workshop';
  if (raid.source === 'blackout_raiders') return 'Residential';
  if (raid.source === 'faction_war') return 'Residential';
  return 'Plaza';
}

function sourceLabel(raid: RaidState | null): string {
  return String(raid?.objective ?? raid?.source ?? 'threat pressure');
}

function inferDutyLane(payload: Record<string, unknown>): string {
  if (typeof payload.lane === 'string') return payload.lane;
  if (typeof payload.preferredZone === 'string') return payload.preferredZone;
  if (typeof payload.targetZone === 'string') return payload.targetZone;
  if (typeof payload.zone === 'string') return payload.zone;
  return 'Residential';
}

function withPayloadMeta(input: WartimeDuty): WartimeDuty {
  return {
    ...input,
    payload: {
      ...input.payload,
      role: input.role,
      stage: input.stage,
      duty: input.duty,
      assignee: input.role,
      lane: inferDutyLane(input.payload),
      responseSquad: 'wartime',
    },
  };
}

export function planWartimeResponse(input: WartimeResponseInput): WartimeDuty[] {
  const duties: WartimeDuty[] = [];
  const { activeRaid, combatState, resources, ownedBuildings, relayPatches, dataShards, alloyFrames, activeWar } = input;
  const wartimeActive = !!activeRaid || activeWar || combatState.raidRisk >= 55;
  if (!wartimeActive) return duties;

  duties.push(withPayloadMeta({
    dedupeKey: 'autonomy-war-marshal-line',
    role: 'marshal',
    stage: 'stabilize',
    duty: 'hold_line',
    kind: 'move',
    title: 'Marshal the defensive line',
    reason: `Wartime pressure is active, so the response marshal anchors the ${defenseZoneFor(activeRaid)} front for ${sourceLabel(activeRaid)}.`,
    priority: activeRaid?.severity === 'fatal' ? 95 : activeRaid ? 88 : 76,
    payload: {
      targetZone: defenseZoneFor(activeRaid),
      raidSource: activeRaid?.source ?? null,
      objective: activeRaid?.objective ?? null,
    },
    sourceEventType: activeRaid ? 'raid_alert' : 'faction_war',
  }));

  if (['injured', 'critical', 'downed'].includes(combatState.status)) {
    duties.push(withPayloadMeta({
      dedupeKey: 'autonomy-recover-triage',
      role: 'field_medic',
      stage: 'stabilize',
      duty: 'triage',
      kind: 'recover',
      title: 'Run field triage',
      reason: 'Combat injuries require a dedicated medic response before the defense line collapses.',
      priority: combatState.status === 'downed' ? 94 : combatState.status === 'critical' ? 90 : 82,
      payload: {
        targetZone: 'Residential',
        raidSource: activeRaid?.source ?? null,
      },
      sourceEventType: 'injury',
    }));
  }

  if (['injured', 'critical', 'downed'].includes(combatState.status) && !ownedBuildings.includes('shelter') && input.canAffordBuilding('shelter')) {
    duties.push(withPayloadMeta({
      dedupeKey: 'autonomy-build-shelter',
      role: 'field_medic',
      stage: 'fortify',
      duty: 'stabilize_triage_bay',
      kind: 'build',
      title: 'Build shelter triage bay',
      reason: 'Medical response needs a protected triage bay to keep recovery online under pressure.',
      priority: 86,
      payload: {
        preferredType: 'shelter',
        preferredZone: 'Residential',
        raidSource: activeRaid?.source ?? null,
      },
      sourceEventType: 'injury',
    }));
  }

  if ((combatState.raidRisk >= 58 || activeWar) && !ownedBuildings.includes('watchtower') && input.canAffordBuilding('watchtower')) {
    duties.push(withPayloadMeta({
      dedupeKey: 'autonomy-build-watchtower',
      role: 'bulwark_engineer',
      stage: 'fortify',
      duty: 'raise_perimeter',
      kind: 'build',
      title: 'Raise watchtower perimeter',
      reason: 'The bulwark engineer needs elevated sightlines to blunt the first hostile impact.',
      priority: activeWar ? 90 : 84,
      payload: {
        preferredType: 'watchtower',
        preferredZone: 'Workshop',
        raidSource: activeRaid?.source ?? null,
      },
      sourceEventType: activeRaid ? 'raid_alert' : 'faction_war',
    }));
  }

  if (activeRaid && ['bandwidth_pirates', 'compute_scavengers', 'blackout_raiders'].includes(activeRaid.source) && !ownedBuildings.includes('beacon') && input.canAffordBuilding('beacon')) {
    duties.push(withPayloadMeta({
      dedupeKey: 'autonomy-build-beacon-doctrine',
      role: 'signal_warden',
      stage: 'fortify',
      duty: 'raise_early_warning',
      kind: 'build',
      title: 'Raise doctrine beacon',
      reason: String(activeRaid.countermeasure ?? 'Current raid pressure favors early warning coverage.'),
      priority: activeRaid.source === 'blackout_raiders' ? 90 : 85,
      payload: {
        preferredType: 'beacon',
        preferredZone: 'Library',
        raidSource: activeRaid.source,
        objective: activeRaid.objective,
      },
      sourceEventType: 'raid_alert',
    }));
  }

  if (activeRaid && ['faction_war', 'blackout_raiders'].includes(activeRaid.source) && !ownedBuildings.includes('shelter') && input.canAffordBuilding('shelter')) {
    duties.push(withPayloadMeta({
      dedupeKey: 'autonomy-build-shelter-doctrine',
      role: 'bulwark_engineer',
      stage: 'fortify',
      duty: 'harden_core',
      kind: 'build',
      title: 'Raise doctrine shelter',
      reason: String(activeRaid.countermeasure ?? 'Current raid pressure favors shelter hardening.'),
      priority: 89,
      payload: {
        preferredType: 'shelter',
        preferredZone: 'Residential',
        raidSource: activeRaid.source,
        objective: activeRaid.objective,
      },
      sourceEventType: 'raid_alert',
    }));
  }

  if (activeRaid?.source === 'bandwidth_pirates' && resources.bandwidth <= 35) {
    duties.push(withPayloadMeta({
      dedupeKey: 'autonomy-raid-bandwidth-trade',
      role: 'quartermaster',
      stage: 'sustain',
      duty: 'restore_bandwidth',
      kind: 'trade',
      title: 'Harden bandwidth lanes',
      reason: 'The quartermaster should pre-stage bandwidth reserves before the next pirate strike lands.',
      priority: 89,
      payload: {
        offerResource: resources.reputation >= 8 ? 'reputation' : 'storage',
        wantResource: 'bandwidth',
        offerAmount: resources.reputation >= 8 ? 8 : 10,
        wantAmount: 12,
        targetZone: 'Market',
        raidSource: activeRaid.source,
        objective: activeRaid.objective,
      },
      sourceEventType: 'raid_alert',
    }));
  }

  if ((activeRaid?.source === 'compute_scavengers' || activeRaid?.source === 'blackout_raiders') && resources.compute <= 40) {
    duties.push(withPayloadMeta({
      dedupeKey: 'autonomy-raid-compute-trade',
      role: 'quartermaster',
      stage: 'sustain',
      duty: 'restore_compute',
      kind: 'trade',
      title: 'Protect compute reserves',
      reason: 'The quartermaster should rebuild compute reserves before attrition compounds.',
      priority: 88,
      payload: {
        offerResource: resources.reputation >= 8 ? 'reputation' : 'bandwidth',
        wantResource: 'compute',
        offerAmount: resources.reputation >= 8 ? 8 : 10,
        wantAmount: 12,
        targetZone: 'Market',
        raidSource: activeRaid?.source ?? null,
        objective: activeRaid?.objective ?? null,
      },
      sourceEventType: 'raid_alert',
    }));
  }

  if ((combatState.raidRisk >= 55 || activeRaid) && dataShards >= 1 && alloyFrames >= 1 && relayPatches < 2 && input.canCraftRecipe('relay_patch')) {
    duties.push(withPayloadMeta({
      dedupeKey: 'autonomy-combat-relay-buffer',
      role: 'quartermaster',
      stage: 'sustain',
      duty: 'stock_relay_buffer',
      kind: 'craft',
      title: 'Build combat relay buffer',
      reason: 'The quartermaster should stock extra relay patches for emergency mitigation and recovery.',
      priority: 86,
      payload: {
        recipeId: 'relay_patch',
        raidSource: activeRaid?.source ?? null,
        objective: activeRaid?.objective ?? null,
      },
      sourceEventType: activeRaid ? 'raid_alert' : 'resource_drought',
    }));
  }

  return duties;
}

export function summarizeWartimeResponse(duties: WartimeDuty[]): string {
  if (duties.length === 0) return 'No wartime duties are active.';
  const roles = Array.from(new Set(duties.map((duty) => duty.role)));
  return `Response squad online: ${roles.join(', ')} across ${duties.length} wartime duties.`;
}
