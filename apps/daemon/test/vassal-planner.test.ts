import test from 'node:test';
import assert from 'node:assert/strict';
import type { Faction, FactionAlliance, FactionVassalage, FactionWar, ResourceState } from '@clawverse/types';
import { VASSAL_AUTONOMY_KEYS, planVassalAutonomy } from '../src/vassal-planner.js';

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

function makeVassalage(overlordId: string, vassalId: string): FactionVassalage {
  return {
    id: `vsl-${overlordId}-${vassalId}`,
    overlordId,
    vassalId,
    formedAt: new Date().toISOString(),
    endedAt: null,
    status: 'active',
  };
}

test('planner queues vassalization for a dominant stable faction facing a fragile target', () => {
  const duties = planVassalAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'dominant',
    myFactionPressure: 28,
    myFactionCohesion: 72,
    myFactionInfluence: 84,
    factions: [
      makeFaction({ id: 'me', stage: 'dominant', influence: 84, cohesion: 72, pressure: 28, prosperity: 74 }),
      makeFaction({ id: 'weak-polity', stage: 'fragile', influence: 51, cohesion: 43, pressure: 68, prosperity: 40 }),
      makeFaction({ id: 'too-strong', stage: 'rising', influence: 78, cohesion: 68, pressure: 30, prosperity: 70 }),
    ],
    activeWars: [] as FactionWar[],
    activeAlliances: [] as FactionAlliance[],
    activeVassalages: [] as FactionVassalage[],
  });

  assert.ok(VASSAL_AUTONOMY_KEYS.includes('autonomy-vassalize-faction'));
  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'vassalize_faction');
  assert.equal(duties[0]?.payload.factionId, 'weak-polity');
  assert.equal(duties[0]?.dedupeKey, 'autonomy-vassalize-faction');
});

test('planner stands down under active war or raid pressure', () => {
  const shared = {
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    myFactionStage: 'dominant' as const,
    myFactionPressure: 30,
    myFactionCohesion: 70,
    myFactionInfluence: 82,
    factions: [
      makeFaction({ id: 'me', stage: 'dominant', influence: 82, cohesion: 70, pressure: 30 }),
      makeFaction({ id: 'weak-polity', stage: 'fragile', influence: 52, cohesion: 44, pressure: 64 }),
    ],
    activeWars: [] as FactionWar[],
    activeAlliances: [] as FactionAlliance[],
    activeVassalages: [] as FactionVassalage[],
  };

  assert.equal(planVassalAutonomy({ ...shared, activeWar: true, activeRaid: false }).length, 0);
  assert.equal(planVassalAutonomy({ ...shared, activeWar: false, activeRaid: true }).length, 0);
});

test('planner stands down when vassal cap is already full', () => {
  const duties = planVassalAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'dominant',
    myFactionPressure: 26,
    myFactionCohesion: 74,
    myFactionInfluence: 86,
    factions: [
      makeFaction({ id: 'me', stage: 'dominant', influence: 86, cohesion: 74, pressure: 26 }),
      makeFaction({ id: 'vassal-a', stage: 'fragile', influence: 48, cohesion: 42, pressure: 70 }),
      makeFaction({ id: 'vassal-b', stage: 'rising', influence: 54, cohesion: 50, pressure: 58 }),
      makeFaction({ id: 'new-target', stage: 'fragile', influence: 50, cohesion: 43, pressure: 66 }),
    ],
    activeWars: [] as FactionWar[],
    activeAlliances: [] as FactionAlliance[],
    activeVassalages: [makeVassalage('me', 'vassal-a'), makeVassalage('me', 'vassal-b')],
  });

  assert.equal(duties.length, 0);
});

test('planner stands down for a non-dominant faction', () => {
  const duties = planVassalAutonomy({
    resources: baselineResources,
    myFactionId: 'me',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    myFactionStage: 'rising',
    myFactionPressure: 30,
    myFactionCohesion: 68,
    myFactionInfluence: 72,
    factions: [
      makeFaction({ id: 'me', stage: 'rising', influence: 72, cohesion: 68, pressure: 30 }),
      makeFaction({ id: 'weak-polity', stage: 'fragile', influence: 49, cohesion: 42, pressure: 66 }),
    ],
    activeWars: [] as FactionWar[],
    activeAlliances: [] as FactionAlliance[],
    activeVassalages: [] as FactionVassalage[],
  });

  assert.equal(duties.length, 0);
});