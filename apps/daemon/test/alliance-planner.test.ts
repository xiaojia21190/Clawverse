import test from 'node:test';
import assert from 'node:assert/strict';
import type { Faction, FactionAlliance, FactionWar, ResourceState } from '@clawverse/types';
import { ALLIANCE_AUTONOMY_KEYS, planAllianceAutonomy } from '../src/alliance-planner.js';

const baselineResources: ResourceState = {
  compute: 80,
  storage: 80,
  bandwidth: 60,
  reputation: 24,
  updatedAt: new Date().toISOString(),
};

function makeFaction(args: {
  id: string;
  name?: string;
  members?: string[];
  agenda?: Faction['strategic']['agenda'];
  stage?: Faction['strategic']['stage'];
  prosperity?: number;
  cohesion?: number;
  influence?: number;
  pressure?: number;
}): Faction {
  return {
    id: args.id,
    name: args.name ?? args.id,
    founderId: `${args.id}-founder`,
    members: args.members ?? [`${args.id}-founder`, `${args.id}-member`],
    createdAt: new Date().toISOString(),
    motto: `${args.id} motto`,
    strategic: {
      agenda: args.agenda ?? 'trade',
      prosperity: args.prosperity ?? 62,
      cohesion: args.cohesion ?? 66,
      influence: args.influence ?? 70,
      pressure: args.pressure ?? 24,
      stage: args.stage ?? 'rising',
      lastUpdatedAt: new Date().toISOString(),
    },
  };
}

function makeAlliance(
  factionA: string,
  factionB: string,
  opts?: { expiresAt?: string; lastRenewedAt?: string | null },
): FactionAlliance {
  const formedAt = new Date().toISOString();
  return {
    id: `all-${factionA}-${factionB}`,
    factionA,
    factionB,
    formedAt,
    expiresAt: opts?.expiresAt ?? new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    lastRenewedAt: opts?.lastRenewedAt ?? formedAt,
    endedAt: null,
    status: 'active',
  };
}

function makeWar(factionA: string, factionB: string): FactionWar {
  return {
    id: `war-${factionA}-${factionB}`,
    factionA,
    factionB,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'active',
  };
}

test('planner queues an alliance treaty for a stable rising faction', () => {
  const duties = planAllianceAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'rising',
    myFactionPressure: 32,
    myFactionCohesion: 61,
    myFactionProsperity: 58,
    myFactionAgenda: 'trade',
    factions: [
      makeFaction({ id: 'me', agenda: 'trade', stage: 'rising' }),
      makeFaction({ id: 'ally-target', agenda: 'knowledge', stage: 'dominant', influence: 78, cohesion: 70 }),
    ],
    activeAlliances: [],
    activeWars: [],
  });

  assert.ok(ALLIANCE_AUTONOMY_KEYS.includes('autonomy-form-alliance'));
  assert.ok(ALLIANCE_AUTONOMY_KEYS.includes('autonomy-renew-alliance'));
  assert.ok(ALLIANCE_AUTONOMY_KEYS.includes('autonomy-break-alliance'));
  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'form_alliance');
  assert.equal(duties[0]?.payload.factionId, 'ally-target');
  assert.equal(duties[0]?.sourceEventType, 'faction_founding');
});

test('planner prefers alliance treaty from a dominant stable faction', () => {
  const duties = planAllianceAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'dominant',
    myFactionPressure: 26,
    myFactionCohesion: 74,
    myFactionProsperity: 72,
    myFactionAgenda: 'knowledge',
    factions: [
      makeFaction({ id: 'me', agenda: 'knowledge', stage: 'dominant', influence: 82 }),
      makeFaction({ id: 'compact-bloc', agenda: 'trade', stage: 'rising', influence: 74, cohesion: 69 }),
    ],
    activeAlliances: [],
    activeWars: [],
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.sourceEventType, 'faction_ascendant');
  assert.equal(duties[0]?.dedupeKey, 'autonomy-form-alliance');
});

test('planner renews alliance when treaty is near expiry', () => {
  const duties = planAllianceAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'dominant',
    myFactionPressure: 28,
    myFactionCohesion: 72,
    myFactionProsperity: 74,
    myFactionAgenda: 'trade',
    factions: [
      makeFaction({ id: 'me', agenda: 'trade', stage: 'dominant' }),
      makeFaction({ id: 'ally-target', agenda: 'knowledge', stage: 'rising', influence: 74, cohesion: 68 }),
    ],
    activeAlliances: [
      makeAlliance('me', 'ally-target', {
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    ],
    activeWars: [],
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'renew_alliance');
  assert.equal(duties[0]?.dedupeKey, 'autonomy-renew-alliance');
  assert.equal(duties[0]?.payload.factionId, 'ally-target');
});

test('planner does not renew when reputation is insufficient', () => {
  const duties = planAllianceAutonomy({
    resources: { ...baselineResources, reputation: 6 },
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'dominant',
    myFactionPressure: 28,
    myFactionCohesion: 72,
    myFactionProsperity: 74,
    myFactionAgenda: 'trade',
    factions: [
      makeFaction({ id: 'me', agenda: 'trade', stage: 'dominant' }),
      makeFaction({ id: 'ally-target', agenda: 'knowledge', stage: 'rising', influence: 74, cohesion: 68 }),
    ],
    activeAlliances: [
      makeAlliance('me', 'ally-target', {
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    ],
    activeWars: [],
  });

  assert.equal(duties.length, 0);
});

test('planner stands down when the best target is already allied', () => {
  const duties = planAllianceAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'rising',
    myFactionPressure: 34,
    myFactionCohesion: 60,
    myFactionProsperity: 58,
    myFactionAgenda: 'trade',
    factions: [
      makeFaction({ id: 'me', agenda: 'trade', stage: 'rising' }),
      makeFaction({ id: 'ally-target', agenda: 'knowledge', stage: 'dominant', influence: 78, cohesion: 70 }),
    ],
    activeAlliances: [makeAlliance('me', 'ally-target')],
    activeWars: [],
  });

  assert.equal(duties.length, 0);
});

test('planner stands down during active war or raid', () => {
  const shared = {
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    myFactionStage: 'rising' as const,
    myFactionPressure: 34,
    myFactionCohesion: 60,
    myFactionProsperity: 58,
    myFactionAgenda: 'trade' as const,
    factions: [
      makeFaction({ id: 'me', agenda: 'trade', stage: 'rising' }),
      makeFaction({ id: 'ally-target', agenda: 'knowledge', stage: 'dominant', influence: 78, cohesion: 70 }),
    ],
    activeAlliances: [] as FactionAlliance[],
    activeWars: [makeWar('me', 'rival')] as FactionWar[],
  };

  assert.equal(planAllianceAutonomy({ ...shared, activeWar: true, activeRaid: false }).length, 0);
  assert.equal(planAllianceAutonomy({ ...shared, activeWar: false, activeRaid: true, activeWars: [] }).length, 0);
});

test('planner stands down for splintering or high-pressure factions', () => {
  const target = makeFaction({ id: 'ally-target', agenda: 'knowledge', stage: 'dominant', influence: 78, cohesion: 70 });

  assert.equal(planAllianceAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'splintering',
    myFactionPressure: 74,
    myFactionCohesion: 38,
    myFactionProsperity: 42,
    myFactionAgenda: 'trade',
    factions: [makeFaction({ id: 'me', agenda: 'trade', stage: 'splintering', pressure: 74, cohesion: 38 }), target],
    activeAlliances: [],
    activeWars: [],
  }).length, 0);

  assert.equal(planAllianceAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'rising',
    myFactionPressure: 62,
    myFactionCohesion: 58,
    myFactionProsperity: 58,
    myFactionAgenda: 'trade',
    factions: [makeFaction({ id: 'me', agenda: 'trade', stage: 'rising', pressure: 62, cohesion: 58 }), target],
    activeAlliances: [],
    activeWars: [],
  }).length, 0);
});
test('dominant faction expands its alliance bloc when below treaty cap', () => {
  const duties = planAllianceAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'dominant',
    myFactionPressure: 24,
    myFactionCohesion: 76,
    myFactionProsperity: 78,
    myFactionAgenda: 'trade',
    factions: [
      makeFaction({ id: 'me', agenda: 'trade', stage: 'dominant', influence: 86 }),
      makeFaction({ id: 'current-partner', agenda: 'knowledge', stage: 'rising', influence: 72, cohesion: 67 }),
      makeFaction({ id: 'stability-bloc', agenda: 'stability', stage: 'dominant', influence: 77, cohesion: 74, pressure: 21 }),
    ],
    activeAlliances: [makeAlliance('me', 'current-partner')],
    activeWars: [],
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'form_alliance');
  assert.equal(duties[0]?.payload.factionId, 'stability-bloc');
  assert.equal(duties[0]?.payload.blocExpansion, true);
  assert.equal(duties[0]?.sourceEventType, 'faction_alliance');
});

test('rising faction stands down once treaty cap is filled', () => {
  const duties = planAllianceAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'rising',
    myFactionPressure: 26,
    myFactionCohesion: 68,
    myFactionProsperity: 64,
    myFactionAgenda: 'trade',
    factions: [
      makeFaction({ id: 'me', agenda: 'trade', stage: 'rising', influence: 72 }),
      makeFaction({ id: 'current-partner', agenda: 'knowledge', stage: 'dominant', influence: 79, cohesion: 72 }),
      makeFaction({ id: 'extra-target', agenda: 'stability', stage: 'rising', influence: 74, cohesion: 69 }),
    ],
    activeAlliances: [makeAlliance('me', 'current-partner')],
    activeWars: [],
  });

  assert.equal(duties.length, 0);
});

test('dominant faction drops a weak alliance when a better bloc partner exists', () => {
  const duties = planAllianceAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'dominant',
    myFactionPressure: 24,
    myFactionCohesion: 78,
    myFactionProsperity: 80,
    myFactionAgenda: 'trade',
    factions: [
      makeFaction({ id: 'me', agenda: 'trade', stage: 'dominant', influence: 88 }),
      makeFaction({ id: 'weak-link', agenda: 'trade', stage: 'fragile', influence: 54, cohesion: 45, prosperity: 42, pressure: 67 }),
      makeFaction({ id: 'trusted-partner', agenda: 'knowledge', stage: 'rising', influence: 74, cohesion: 69 }),
      makeFaction({ id: 'stability-bloc', agenda: 'stability', stage: 'dominant', influence: 84, cohesion: 78, prosperity: 76, pressure: 18 }),
    ],
    activeAlliances: [makeAlliance('me', 'weak-link'), makeAlliance('me', 'trusted-partner')],
    activeWars: [],
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'break_alliance');
  assert.equal(duties[0]?.payload.allianceId, 'all-me-weak-link');
  assert.equal(duties[0]?.payload.factionId, 'weak-link');
  assert.equal(duties[0]?.payload.replacementFactionId, 'stability-bloc');
});

test('rising faction does not plan strategic betrayal when its single treaty turns weak', () => {
  const duties = planAllianceAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'rising',
    myFactionPressure: 28,
    myFactionCohesion: 67,
    myFactionProsperity: 64,
    myFactionAgenda: 'trade',
    factions: [
      makeFaction({ id: 'me', agenda: 'trade', stage: 'rising', influence: 74 }),
      makeFaction({ id: 'weak-link', agenda: 'trade', stage: 'fragile', influence: 50, cohesion: 45, prosperity: 40, pressure: 68 }),
      makeFaction({ id: 'better-target', agenda: 'stability', stage: 'dominant', influence: 80, cohesion: 75, prosperity: 74, pressure: 18 }),
    ],
    activeAlliances: [makeAlliance('me', 'weak-link')],
    activeWars: [],
  });

  assert.equal(duties.length, 0);
});
