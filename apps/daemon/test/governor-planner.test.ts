import test from 'node:test';
import assert from 'node:assert/strict';
import type { CombatState, ResourceState } from '@clawverse/types';
import { applyGovernorPriority, planStrategicGovernor } from '../src/governor-planner.js';

const healthyResources: ResourceState = {
  compute: 90,
  storage: 90,
  bandwidth: 90,
  reputation: 40,
  updatedAt: new Date().toISOString(),
};

function makeCombat(overrides: Partial<CombatState> = {}): CombatState {
  return {
    hp: 100,
    maxHp: 100,
    pain: 0,
    chronicPain: 0,
    careDebt: 0,
    posture: 'steady',
    status: 'stable',
    raidRisk: 18,
    activeRaid: null,
    injuries: [],
    deaths: 0,
    updatedAt: new Date().toISOString(),
    lastRaidAt: null,
    lastDamageAt: null,
    ...overrides,
  };
}

test('governor focuses wartime survival during an active raid', () => {
  const governor = planStrategicGovernor({
    resources: healthyResources,
    needs: { social: 72, tasked: 68, wanderlust: 74, creative: 70 },
    combat: makeCombat({
      raidRisk: 88,
      activeRaid: {
        id: 'raid-1',
        source: 'blackout_raiders',
        severity: 'high',
        objective: 'relay grid',
        recommendedPosture: 'fortified',
        countermeasure: 'watchtower',
        startedAt: new Date().toISOString(),
        resolvedAt: null,
        active: true,
        summary: 'Blackout raiders are targeting relay grid capacity.',
      },
    }),
    zone: 'Workshop',
    hasFaction: true,
    activeWar: true,
    activeRaid: true,
    activeAllianceCount: 0,
    activeVassalCount: 0,
    knownPeerCount: 6,
    allyCount: 2,
    friendCount: 1,
    myFactionStage: 'rising',
    myFactionPressure: 64,
    myFactionCohesion: 58,
    myFactionProsperity: 56,
    myFactionInfluence: 54,
    myFactionAgenda: 'survival',
  });

  assert.equal(governor.focusLane, 'wartime');
  assert.equal(governor.mode, 'survive');
  assert.equal(governor.priorityBias.wartime, 16);
  assert.ok(governor.summary.includes('survival'));
});

test('governor focuses recovery when needs and reserves collapse', () => {
  const governor = planStrategicGovernor({
    resources: { ...healthyResources, compute: 26, bandwidth: 28, storage: 34, reputation: 12 },
    needs: { social: 24, tasked: 18, wanderlust: 52, creative: 61 },
    combat: makeCombat({ raidRisk: 22 }),
    zone: 'Residential',
    hasFaction: false,
    activeWar: false,
    activeRaid: false,
    activeAllianceCount: 0,
    activeVassalCount: 0,
    knownPeerCount: 4,
    allyCount: 1,
    friendCount: 2,
  });

  assert.equal(governor.focusLane, 'economy');
  assert.equal(governor.mode, 'recover');
  assert.equal(governor.priorityBias.economy, 16);
  assert.ok(governor.objective.includes('Recover'));
});

test('governor prefers diplomacy when war pressure is high but peace is affordable', () => {
  const governor = planStrategicGovernor({
    resources: { ...healthyResources, reputation: 28 },
    needs: { social: 66, tasked: 62, wanderlust: 70, creative: 68 },
    combat: makeCombat({ raidRisk: 42 }),
    zone: 'Park',
    hasFaction: true,
    activeWar: true,
    activeRaid: false,
    activeAllianceCount: 0,
    activeVassalCount: 0,
    knownPeerCount: 5,
    allyCount: 2,
    friendCount: 2,
    myFactionStage: 'splintering',
    myFactionPressure: 84,
    myFactionCohesion: 28,
    myFactionProsperity: 44,
    myFactionInfluence: 48,
    myFactionAgenda: 'stability',
  });

  assert.equal(governor.focusLane, 'diplomacy');
  assert.equal(governor.mode, 'consolidate');
  assert.equal(governor.priorityBias.diplomacy, 16);
});

test('governor moves into alliance expansion during a calm rising polity', () => {
  const governor = planStrategicGovernor({
    resources: healthyResources,
    needs: { social: 74, tasked: 71, wanderlust: 69, creative: 73 },
    combat: makeCombat({ raidRisk: 16 }),
    zone: 'Market',
    hasFaction: true,
    activeWar: false,
    activeRaid: false,
    activeAllianceCount: 0,
    activeVassalCount: 0,
    knownPeerCount: 7,
    allyCount: 3,
    friendCount: 2,
    myFactionStage: 'rising',
    myFactionPressure: 18,
    myFactionCohesion: 82,
    myFactionProsperity: 84,
    myFactionInfluence: 72,
    myFactionAgenda: 'trade',
  });

  assert.equal(governor.focusLane, 'alliance');
  assert.equal(governor.mode, 'expand');
  assert.equal(governor.priorityBias.alliance, 16);
});

test('applyGovernorPriority clamps weighted priorities into job bounds', () => {
  const governor = planStrategicGovernor({
    resources: healthyResources,
    needs: { social: 72, tasked: 68, wanderlust: 74, creative: 70 },
    combat: makeCombat({
      raidRisk: 88,
      activeRaid: {
        id: 'raid-2',
        source: 'bandwidth_pirates',
        severity: 'medium',
        objective: 'market uplinks',
        recommendedPosture: 'guarded',
        countermeasure: 'beacon',
        startedAt: new Date().toISOString(),
        resolvedAt: null,
        active: true,
        summary: 'Bandwidth pirates are hitting market uplinks.',
      },
    }),
    zone: 'Market',
    hasFaction: true,
    activeWar: true,
    activeRaid: true,
    activeAllianceCount: 1,
    activeVassalCount: 0,
    knownPeerCount: 5,
    allyCount: 2,
    friendCount: 1,
    myFactionStage: 'rising',
    myFactionPressure: 62,
    myFactionCohesion: 60,
    myFactionProsperity: 58,
    myFactionInfluence: 55,
    myFactionAgenda: 'survival',
  });

  assert.equal(applyGovernorPriority(90, 'wartime', governor), 100);
  assert.equal(applyGovernorPriority(4, 'vassal', governor), 0);
});
