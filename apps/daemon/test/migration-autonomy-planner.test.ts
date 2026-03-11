import test from 'node:test';
import assert from 'node:assert/strict';
import type { MigrationPlanSnapshot } from '../src/migration-planner.js';
import { planMigrationAutonomy } from '../src/migration-autonomy-planner.js';

function makePlan(overrides: Partial<MigrationPlanSnapshot> = {}): MigrationPlanSnapshot {
  return {
    strategy: 'hold',
    urgency: 36,
    summary: 'hold',
    recommendedTopic: 'topic-beta',
    targets: [
      {
        topic: 'topic-beta',
        score: 72,
        tier: 'safe_haven',
        actorCount: 4,
        branchCount: 8,
        shellStatus: 'mirrored',
        peerHealth: 'live',
        reason: 'stable mirrored world',
      },
    ],
    ...overrides,
  };
}

test('prepare migration produces a soft migrate duty with lane bias', () => {
  const duties = planMigrationAutonomy({
    plan: makePlan({
      strategy: 'prepare_migration',
      urgency: 61,
    }),
    activeRaid: false,
    clusterStatus: 'stable',
    clusterActorCount: 3,
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'migrate');
  assert.equal(duties[0]?.lane, 'economy');
  assert.equal(duties[0]?.dedupeKey, 'autonomy-migrate-prepare');
  assert.equal(duties[0]?.payload.toTopic, 'topic-beta');
});

test('prepare migration under fracture pressure routes through faction lane', () => {
  const duties = planMigrationAutonomy({
    plan: makePlan({
      strategy: 'prepare_migration',
      urgency: 68,
    }),
    activeRaid: false,
    clusterStatus: 'fracturing',
    clusterActorCount: 4,
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.lane, 'faction');
  assert.equal(duties[0]?.sourceEventType, 'faction_splintering');
});

test('evacuate migration produces wartime migrate duty', () => {
  const duties = planMigrationAutonomy({
    plan: makePlan({
      strategy: 'evacuate',
      urgency: 91,
    }),
    activeRaid: true,
    clusterStatus: 'collapsing',
    clusterActorCount: 5,
  });

  assert.equal(duties.length, 1);
  assert.equal(duties[0]?.kind, 'migrate');
  assert.equal(duties[0]?.lane, 'wartime');
  assert.equal(duties[0]?.dedupeKey, 'autonomy-migrate-evacuate');
  assert.ok((duties[0]?.priority ?? 0) >= 84);
});

test('hold strategy stands down migration autonomy duties', () => {
  const duties = planMigrationAutonomy({
    plan: makePlan({
      strategy: 'hold',
      urgency: 24,
    }),
    activeRaid: false,
    clusterStatus: 'stable',
    clusterActorCount: 2,
  });

  assert.deepEqual(duties, []);
});
