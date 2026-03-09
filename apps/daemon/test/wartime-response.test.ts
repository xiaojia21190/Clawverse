import test from 'node:test';
import assert from 'node:assert/strict';
import type { CombatState, RaidState, ResourceState } from '@clawverse/types';
import { planWartimeResponse, summarizeWartimeResponse } from '../src/wartime-response.js';

const healthyResources: ResourceState = {
  compute: 80,
  storage: 80,
  bandwidth: 60,
  reputation: 10,
  updatedAt: new Date().toISOString(),
};

function makeCombatState(activeRaid: RaidState | null, overrides: Partial<CombatState> = {}): CombatState {
  return {
    hp: 100,
    maxHp: 100,
    pain: 0,
    chronicPain: 0,
    careDebt: 0,
    posture: 'steady',
    status: 'stable',
    raidRisk: activeRaid ? 78 : 12,
    activeRaid,
    injuries: [],
    deaths: 0,
    updatedAt: new Date().toISOString(),
    lastRaidAt: null,
    lastDamageAt: null,
    ...overrides,
  };
}

function makeRaid(source: RaidState['source'], objective: string, recommendedPosture: RaidState['recommendedPosture'], countermeasure: string): RaidState {
  return {
    id: 'raid-1',
    source,
    severity: 'high',
    objective,
    recommendedPosture,
    countermeasure,
    startedAt: new Date().toISOString(),
    resolvedAt: null,
    active: true,
    summary: 'Raid pressure is active.',
  };
}

test('bandwidth pirate raids create marshal signal and quartermaster duties', () => {
  const raid = makeRaid('bandwidth_pirates', 'bandwidth lanes', 'guarded', 'Guard bandwidth lanes with beacon coverage to keep the mesh stable.');
  const duties = planWartimeResponse({
    activeRaid: raid,
    combatState: makeCombatState(raid),
    resources: { ...healthyResources, bandwidth: 12 },
    ownedBuildings: [],
    relayPatches: 0,
    dataShards: 1,
    alloyFrames: 1,
    activeWar: false,
    canAffordBuilding: () => true,
    canCraftRecipe: () => true,
  });

  assert.ok(duties.some((duty) => duty.role === 'marshal' && duty.kind === 'move'));
  assert.ok(duties.some((duty) => duty.role === 'signal_warden' && duty.dedupeKey === 'autonomy-build-beacon-doctrine'));
  assert.ok(duties.some((duty) => duty.role === 'quartermaster' && duty.dedupeKey === 'autonomy-raid-bandwidth-trade'));
  assert.ok(duties.some((duty) => duty.role === 'quartermaster' && duty.dedupeKey === 'autonomy-combat-relay-buffer'));
  assert.ok(duties.every((duty) => duty.payload.assignee === duty.role));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-build-beacon-doctrine' && duty.payload.lane === 'Library'));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-war-marshal-line' && duty.payload.lane === 'Market'));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-war-marshal-line' && duty.stage === 'stabilize' && duty.payload.stage === 'stabilize'));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-build-beacon-doctrine' && duty.stage === 'fortify' && duty.payload.stage === 'fortify'));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-raid-bandwidth-trade' && duty.stage === 'sustain' && duty.payload.stage === 'sustain'));
  assert.match(summarizeWartimeResponse(duties), /marshal/i);
});

test('blackout raids escalate into fortified engineering and medic duties', () => {
  const raid = makeRaid('blackout_raiders', 'compute and bandwidth disruption', 'fortified', 'Fortify the shell and keep relay patches ready to absorb blackout spikes.');
  const duties = planWartimeResponse({
    activeRaid: raid,
    combatState: makeCombatState(raid, { status: 'critical', hp: 34, pain: 68 }),
    resources: { ...healthyResources, compute: 18, bandwidth: 11 },
    ownedBuildings: [],
    relayPatches: 0,
    dataShards: 1,
    alloyFrames: 1,
    activeWar: false,
    canAffordBuilding: () => true,
    canCraftRecipe: () => true,
  });

  assert.ok(duties.some((duty) => duty.role === 'field_medic' && duty.kind === 'recover'));
  assert.ok(duties.some((duty) => duty.role === 'bulwark_engineer' && duty.dedupeKey === 'autonomy-build-watchtower'));
  assert.ok(duties.some((duty) => duty.role === 'bulwark_engineer' && duty.dedupeKey === 'autonomy-build-shelter-doctrine'));
  assert.ok(duties.some((duty) => duty.role === 'quartermaster' && duty.dedupeKey === 'autonomy-raid-compute-trade'));
  assert.ok(duties.every((duty) => duty.payload.assignee === duty.role));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-build-watchtower' && duty.payload.lane === 'Workshop'));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-build-shelter-doctrine' && duty.payload.lane === 'Residential'));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-recover-triage' && duty.stage === 'stabilize' && duty.payload.stage === 'stabilize'));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-build-watchtower' && duty.stage === 'fortify' && duty.payload.stage === 'fortify'));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-raid-compute-trade' && duty.stage === 'sustain' && duty.payload.stage === 'sustain'));
  assert.ok(duties.every((duty) => duty.payload.responseSquad === 'wartime'));
});
