import test from 'node:test';
import assert from 'node:assert/strict';
import type { Faction, ResourceState } from '@clawverse/types';
import { FACTION_AUTONOMY_KEYS, planFactionAutonomy } from '../src/faction-planner.js';

const healthyResources: ResourceState = {
  compute: 82,
  storage: 84,
  bandwidth: 64,
  reputation: 18,
  updatedAt: new Date().toISOString(),
};

function faction(input: Partial<Faction> & Pick<Faction, 'id' | 'name' | 'founderId' | 'members' | 'createdAt' | 'motto' | 'strategic'>): Faction {
  return input;
}

test('planner founds a faction when ally support is strong and no strong polity exists', () => {
  const duties = planFactionAutonomy({
    resources: healthyResources,
    hasFaction: false,
    allyCount: 4,
    friendCount: 2,
    knownPeerCount: 5,
    raidRisk: 24,
    factions: [],
  });

  assert.ok(FACTION_AUTONOMY_KEYS.includes('autonomy-found-faction'));
  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'found_faction');
  assert.equal(typeof duties[0]?.payload.name, 'string');
  assert.equal(typeof duties[0]?.payload.motto, 'string');
});

test('planner joins a dominant stable faction when unaffiliated and allies are insufficient to found', () => {
  const duties = planFactionAutonomy({
    resources: { ...healthyResources, reputation: 10 },
    hasFaction: false,
    allyCount: 2,
    friendCount: 3,
    knownPeerCount: 6,
    raidRisk: 30,
    factions: [
      faction({
        id: 'fac-1',
        name: 'Market League',
        founderId: 'peer-1',
        members: ['peer-1', 'peer-2', 'peer-3'],
        createdAt: new Date().toISOString(),
        motto: 'Trade routes forever',
        strategic: {
          agenda: 'trade',
          prosperity: 78,
          cohesion: 72,
          influence: 86,
          pressure: 24,
          stage: 'dominant',
          lastUpdatedAt: new Date().toISOString(),
        },
      }),
    ],
  });

  assert.ok(FACTION_AUTONOMY_KEYS.includes('autonomy-join-faction'));
  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'join_faction');
  assert.deepEqual(duties[0]?.payload, {});
});

test('planner prefers joining over founding under heavy raid pressure', () => {
  const duties = planFactionAutonomy({
    resources: healthyResources,
    hasFaction: false,
    allyCount: 5,
    friendCount: 2,
    knownPeerCount: 7,
    raidRisk: 74,
    factions: [
      faction({
        id: 'fac-2',
        name: 'Shelter Accord',
        founderId: 'peer-4',
        members: ['peer-4', 'peer-5'],
        createdAt: new Date().toISOString(),
        motto: 'Endure the storm',
        strategic: {
          agenda: 'survival',
          prosperity: 58,
          cohesion: 68,
          influence: 63,
          pressure: 36,
          stage: 'rising',
          lastUpdatedAt: new Date().toISOString(),
        },
      }),
    ],
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'join_faction');
  assert.equal(duties[0]?.dedupeKey, 'autonomy-join-faction');
});

test('planner regroups a splintering faction into the park when war is not active', () => {
  const duties = planFactionAutonomy({
    resources: healthyResources,
    hasFaction: true,
    allyCount: 5,
    friendCount: 4,
    knownPeerCount: 8,
    raidRisk: 34,
    factions: [],
    currentZone: 'Market',
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'splintering',
    myFactionPressure: 72,
    myFactionCohesion: 41,
    myFactionProsperity: 46,
    myFactionAgenda: 'stability',
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'move');
  assert.equal(duties[0]?.dedupeKey, 'autonomy-faction-regroup');
  assert.equal(duties[0]?.payload.targetZone, 'Park');
  assert.equal(duties[0]?.sourceEventType, 'faction_splintering');
});

test('planner falls back to the residential core during war-driven faction fracture', () => {
  const duties = planFactionAutonomy({
    resources: healthyResources,
    hasFaction: true,
    allyCount: 5,
    friendCount: 4,
    knownPeerCount: 8,
    raidRisk: 79,
    factions: [],
    currentZone: 'Market',
    activeWar: true,
    activeRaid: false,
    myFactionStage: 'splintering',
    myFactionPressure: 83,
    myFactionCohesion: 34,
    myFactionProsperity: 38,
    myFactionAgenda: 'survival',
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'move');
  assert.equal(duties[0]?.dedupeKey, 'autonomy-faction-exodus');
  assert.equal(duties[0]?.payload.targetZone, 'Residential');
  assert.equal(duties[0]?.sourceEventType, 'faction_war');
});

test('planner anchors a dominant trade faction in its agenda zone', () => {
  const duties = planFactionAutonomy({
    resources: healthyResources,
    hasFaction: true,
    allyCount: 5,
    friendCount: 4,
    knownPeerCount: 8,
    raidRisk: 18,
    factions: [],
    currentZone: 'Residential',
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'dominant',
    myFactionPressure: 28,
    myFactionCohesion: 73,
    myFactionProsperity: 82,
    myFactionAgenda: 'trade',
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'move');
  assert.equal(duties[0]?.dedupeKey, 'autonomy-faction-agenda-zone');
  assert.equal(duties[0]?.payload.targetZone, 'Market');
  assert.equal(duties[0]?.sourceEventType, 'faction_ascendant');
});

test('planner stands down once already in the correct dominant agenda zone', () => {
  const duties = planFactionAutonomy({
    resources: healthyResources,
    hasFaction: true,
    allyCount: 5,
    friendCount: 4,
    knownPeerCount: 8,
    raidRisk: 18,
    factions: [],
    currentZone: 'Market',
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'dominant',
    myFactionPressure: 28,
    myFactionCohesion: 73,
    myFactionProsperity: 82,
    myFactionAgenda: 'trade',
  });

  assert.equal(duties.length, 0);
});