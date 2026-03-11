import test from 'node:test';
import assert from 'node:assert/strict';
import type { BrainGuidanceRecord } from '../src/brain-guidance-registry.js';
import { planAutonomyIntents } from '../src/autonomy-intent.js';

function makeGuidance(message: string): BrainGuidanceRecord {
  const now = new Date().toISOString();
  return {
    id: `guide-${Math.random().toString(16).slice(2, 8)}`,
    kind: 'note',
    message,
    payload: null,
    status: 'active',
    source: 'operator',
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
  };
}

test('advisory mode keeps base duty priorities without governor bias', () => {
  const intents = planAutonomyIntents({
    orchestrationMode: 'advisory',
    guidance: [],
    candidates: [
      {
        lane: 'wartime',
        duty: {
          dedupeKey: 'w1',
          kind: 'move',
          title: 'Hold line',
          reason: 'test',
          priority: 60,
          payload: {},
          sourceEventType: 'raid_alert',
        },
      },
      {
        lane: 'economy',
        duty: {
          dedupeKey: 'e1',
          kind: 'trade',
          title: 'Rebalance market',
          reason: 'test',
          priority: 60,
          payload: {},
          sourceEventType: 'resource_drought',
        },
      },
    ],
  });

  assert.equal(intents[0]?.finalPriority, 60);
  assert.equal(intents[1]?.finalPriority, 60);
});

test('advisory mode ignores governor bias and keeps equal base priorities', () => {
  const intents = planAutonomyIntents({
    orchestrationMode: 'advisory',
    guidance: [],
    candidates: [
      {
        lane: 'wartime',
        duty: {
          dedupeKey: 'w2',
          kind: 'move',
          title: 'Hold line',
          reason: 'test',
          priority: 60,
          payload: {},
          sourceEventType: 'raid_alert',
        },
      },
      {
        lane: 'economy',
        duty: {
          dedupeKey: 'e2',
          kind: 'trade',
          title: 'Rebalance market',
          reason: 'test',
          priority: 60,
          payload: {},
          sourceEventType: 'resource_drought',
        },
      },
    ],
  });

  const wartime = intents.find((intent) => intent.lane === 'wartime');
  const economy = intents.find((intent) => intent.lane === 'economy');
  assert.equal(wartime?.finalPriority, 60);
  assert.equal(economy?.finalPriority, 60);
});

test('directive compatibility input no longer injects governor lane bias', () => {
  const intents = planAutonomyIntents({
    orchestrationMode: 'directive',
    guidance: [],
    candidates: [
      {
        lane: 'wartime',
        duty: {
          dedupeKey: 'w-directive',
          kind: 'move',
          title: 'Hold line',
          reason: 'test',
          priority: 60,
          payload: {},
          sourceEventType: 'raid_alert',
        },
      },
      {
        lane: 'economy',
        duty: {
          dedupeKey: 'e-directive',
          kind: 'trade',
          title: 'Rebalance market',
          reason: 'test',
          priority: 60,
          payload: {},
          sourceEventType: 'resource_drought',
        },
      },
    ],
  });

  const wartime = intents.find((intent) => intent.lane === 'wartime');
  const economy = intents.find((intent) => intent.lane === 'economy');
  assert.equal(wartime?.finalPriority, 60);
  assert.equal(economy?.finalPriority, 60);
  assert.ok((wartime?.reasons ?? []).includes('central_bias:bypassed'));
});

test('operator guidance only shifts inclination by boosting matching lane intents', () => {
  const intents = planAutonomyIntents({
    orchestrationMode: 'advisory',
    guidance: [makeGuidance('Please prioritize peace treaty and diplomacy this cycle.')],
    candidates: [
      {
        lane: 'diplomacy',
        duty: {
          dedupeKey: 'd1',
          kind: 'declare_peace',
          title: 'Negotiate peace',
          reason: 'test',
          priority: 58,
          payload: {},
          sourceEventType: 'faction_war',
        },
      },
      {
        lane: 'economy',
        duty: {
          dedupeKey: 'e3',
          kind: 'trade',
          title: 'Recover reserves',
          reason: 'test',
          priority: 58,
          payload: {},
          sourceEventType: 'resource_drought',
        },
      },
    ],
  });

  assert.equal(intents[0]?.lane, 'diplomacy');
  assert.ok((intents[0]?.finalPriority ?? 0) > (intents[1]?.finalPriority ?? 0));
});

test('high survival pressure keeps survival lanes ahead of guidance-preferred lanes', () => {
  const intents = planAutonomyIntents({
    orchestrationMode: 'advisory',
    guidance: [makeGuidance('Please prioritize peace treaty and diplomacy right now.')],
    pressure: {
      activeRaid: true,
      activeWarCount: 2,
      clusterStatus: 'collapsing',
      clusterResourcePressure: 88,
      clusterSafety: 18,
      migrationUrgency: 86,
    },
    candidates: [
      {
        lane: 'wartime',
        duty: {
          dedupeKey: 'w-pressure',
          kind: 'move',
          title: 'Hold line',
          reason: 'test',
          priority: 63,
          payload: {},
          sourceEventType: 'raid_alert',
        },
      },
      {
        lane: 'economy',
        duty: {
          dedupeKey: 'e-pressure',
          kind: 'trade',
          title: 'Secure emergency stock',
          reason: 'test',
          priority: 63,
          payload: {},
          sourceEventType: 'resource_drought',
        },
      },
      {
        lane: 'diplomacy',
        duty: {
          dedupeKey: 'd-pressure',
          kind: 'declare_peace',
          title: 'Negotiate peace',
          reason: 'test',
          priority: 68,
          payload: {},
          sourceEventType: 'faction_war',
        },
      },
    ],
  });

  assert.equal(intents[0]?.lane, 'wartime');
  const wartime = intents.find((intent) => intent.lane === 'wartime');
  const diplomacy = intents.find((intent) => intent.lane === 'diplomacy');
  assert.ok((wartime?.finalPriority ?? 0) >= (diplomacy?.finalPriority ?? 0));
  assert.ok((diplomacy?.reasons ?? []).includes('guidance_weight:0.35'));
});

test('final intent priority is always clamped between 0 and 100', () => {
  const intents = planAutonomyIntents({
    orchestrationMode: 'advisory',
    guidance: [makeGuidance('war war defend raid now')],
    candidates: [
      {
        lane: 'wartime',
        duty: {
          dedupeKey: 'w3',
          kind: 'move',
          title: 'Hold line',
          reason: 'test',
          priority: 99,
          payload: {},
          sourceEventType: 'raid_alert',
        },
      },
    ],
  });

  assert.equal(intents[0]?.finalPriority, 100);
});

test('cluster leader only applies a soft coordination bias instead of hard control', () => {
  const intents = planAutonomyIntents({
    orchestrationMode: 'advisory',
    guidance: [],
    coordination: {
      role: 'leader',
      clusterStatus: 'stable',
      clusterActorCount: 4,
      leaderScore: 72,
    },
    candidates: [
      {
        lane: 'faction',
        duty: {
          dedupeKey: 'f1',
          kind: 'move',
          title: 'Regroup cluster',
          reason: 'test',
          priority: 54,
          payload: {},
          sourceEventType: 'faction_splintering',
        },
      },
      {
        lane: 'economy',
        duty: {
          dedupeKey: 'e4',
          kind: 'trade',
          title: 'Stabilize stock',
          reason: 'test',
          priority: 54,
          payload: {},
          sourceEventType: 'resource_drought',
        },
      },
    ],
  });

  assert.equal(intents[0]?.lane, 'faction');
  assert.ok((intents[0]?.finalPriority ?? 0) > 54);
  assert.ok((intents[1]?.finalPriority ?? 0) > 54);
  assert.ok((intents[0]?.finalPriority ?? 0) - 54 <= 8);
});
