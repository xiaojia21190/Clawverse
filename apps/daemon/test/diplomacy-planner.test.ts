import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResourceState } from '@clawverse/types';
import { DIPLOMACY_AUTONOMY_KEYS, planDiplomaticAutonomy } from '../src/diplomacy-planner.js';

const baselineResources: ResourceState = {
  compute: 80,
  storage: 80,
  bandwidth: 60,
  reputation: 24,
  updatedAt: new Date().toISOString(),
};

test('planner stands down when peace reputation cost is not met', () => {
  const duties = planDiplomaticAutonomy({
    resources: { ...baselineResources, reputation: 19 },
    activeWarId: 'war-1',
    activeRaid: false,
    factionStage: 'rising',
    factionPressure: 58,
    factionCohesion: 61,
  });

  assert.equal(duties.length, 0);
});

test('planner queues a stable peace attempt for an active war with sufficient reputation', () => {
  const duties = planDiplomaticAutonomy({
    resources: baselineResources,
    activeWarId: 'war-2',
    activeRaid: false,
    factionStage: 'rising',
    factionPressure: 54,
    factionCohesion: 60,
  });

  assert.ok(DIPLOMACY_AUTONOMY_KEYS.includes('autonomy-declare-peace'));
  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.dedupeKey, 'autonomy-declare-peace');
  assert.equal(duties[0]?.priority, 88);
  assert.equal(duties[0]?.sourceEventType, 'faction_war');
  assert.equal(duties[0]?.payload.warHintId, 'war-2');
  assert.equal('warId' in (duties[0]?.payload ?? {}), false);
});

test('planner escalates peace priority when war pressure is splintering the faction', () => {
  const duties = planDiplomaticAutonomy({
    resources: baselineResources,
    activeWarId: 'war-3',
    activeRaid: true,
    factionStage: 'splintering',
    factionPressure: 81,
    factionCohesion: 28,
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.sourceEventType, 'faction_splintering');
  assert.ok((duties[0]?.priority ?? 0) > 90);
  assert.match(duties[0]?.reason ?? '', /cohesion|pressure/i);
});