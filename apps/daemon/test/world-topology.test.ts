import test from 'node:test';
import assert from 'node:assert/strict';
import type { PeerState } from '@clawverse/types';
import { buildRingWorld, buildTopicWorld } from '../src/world-topology.js';

function makePeer(input: {
  id: string;
  actorId: string;
  sessionId: string;
  name: string;
  x: number;
  y: number;
  lastUpdate: string;
}): PeerState {
  return {
    id: input.id,
    actorId: input.actorId,
    sessionId: input.sessionId,
    name: input.name,
    position: { x: input.x, y: input.y },
    mood: 'idle',
    hardware: {
      cpuUsage: 12,
      ramUsage: 21,
      ramTotal: 16,
      diskFree: 200,
      uptime: 2048,
      platform: 'linux',
      hostname: input.id,
      cpuModel: 'test',
      cpuCores: 8,
    },
    dna: {
      id: input.actorId,
      archetype: 'Scholar',
      modelTrait: 'Engineer',
      badges: [],
      persona: '',
      appearance: { form: 'octopus', primaryColor: '#000000', secondaryColor: '#111111', accessories: [] },
    },
    lastUpdate: new Date(input.lastUpdate),
  };
}

test('buildTopicWorld summarizes same-topic actors as one world and sessions as branches', () => {
  const peers = [
    makePeer({
      id: 'local-old',
      actorId: 'actor-local',
      sessionId: 'local-old',
      name: 'Local-old',
      x: 2,
      y: 2,
      lastUpdate: '2026-03-08T10:00:00.000Z',
    }),
    makePeer({
      id: 'local-new',
      actorId: 'actor-local',
      sessionId: 'local-new',
      name: 'Local-new',
      x: 3,
      y: 3,
      lastUpdate: '2026-03-08T10:05:00.000Z',
    }),
    makePeer({
      id: 'remote-1',
      actorId: 'actor-remote',
      sessionId: 'remote-1',
      name: 'Remote',
      x: 14,
      y: 4,
      lastUpdate: '2026-03-08T10:02:00.000Z',
    }),
  ];

  const summary = buildTopicWorld('clawverse-alpha', peers, 'local-new');

  assert.equal(summary.topic, 'clawverse-alpha');
  assert.equal(summary.nodes.length, 2);
  assert.equal(summary.world.population.actorCount, 2);
  assert.equal(summary.world.population.branchCount, 3);
  assert.equal(summary.world.population.districtCount, 2);
  assert.equal(summary.world.hierarchy.ringMode, 'single-topic');
  assert.deepEqual(
    summary.world.hierarchy.layers.map((layer) => ({ key: layer.key, value: layer.value, count: layer.count ?? null })),
    [
      { key: 'ring-world', value: 'single-topic shell', count: 1 },
      { key: 'topic-world', value: 'clawverse-alpha', count: null },
      { key: 'local-brain', value: 'Local-new', count: null },
      { key: 'big-nodes', value: '2', count: 2 },
      { key: 'small-nodes', value: '3', count: 3 },
    ],
  );
  assert.equal(summary.world.brain.controller, 'openclaw');
  assert.equal(summary.world.brain.controlMode, 'local-brain');
  assert.equal(summary.world.brain.status, 'authoritative');
  assert.equal(summary.world.brain.actorId, 'actor-local');
  assert.equal(summary.world.brain.sessionId, 'local-new');
  assert.equal(summary.world.brain.branchCount, 2);
  assert.equal(summary.world.brain.district, 'Plaza');
  assert.equal(summary.world.brain.authority, 'self-owned-role');
  assert.equal(summary.world.brain.executionGuarantee, 'none');
  assert.deepEqual(summary.world.governance, {
    model: 'emergent-social',
    leadership: 'soft-influence',
    operatorScope: 'local-suggestion-only',
    mutationBoundary: 'worker-system-only',
  });
  assert.deepEqual(summary.world.ring.shells, [
    {
      topic: 'clawverse-alpha',
      active: true,
      status: 'active',
      actorCount: 2,
      branchCount: 3,
      brainStatus: 'authoritative',
      source: 'live',
      updatedAt: '2026-03-08T10:05:00.000Z',
    },
  ]);
  assert.deepEqual(
    summary.world.districts
      .filter((district) => district.actorCount > 0)
      .map((district) => ({ name: district.name, actorCount: district.actorCount, branchCount: district.branchCount })),
    [
      { name: 'Plaza', actorCount: 1, branchCount: 2 },
      { name: 'Market', actorCount: 1, branchCount: 1 },
    ],
  );
});

test('buildTopicWorld keeps an openclaw brain placeholder when local state is not present yet', () => {
  const peers = [
    makePeer({
      id: 'remote-only',
      actorId: 'actor-remote',
      sessionId: 'remote-only',
      name: 'Remote',
      x: 24,
      y: 24,
      lastUpdate: '2026-03-08T10:00:00.000Z',
    }),
  ];

  const summary = buildTopicWorld('clawverse-alpha', peers, 'missing-local');

  assert.equal(summary.world.population.actorCount, 1);
  assert.equal(summary.world.population.branchCount, 1);
  assert.equal(summary.world.hierarchy.ringMode, 'single-topic');
  assert.equal(summary.world.hierarchy.layers[2]?.value, 'pending');
  assert.equal(summary.world.brain.status, 'pending');
  assert.equal(summary.world.brain.actorId, null);
  assert.equal(summary.world.brain.sessionId, null);
  assert.equal(summary.world.brain.branchCount, 0);
  assert.equal(summary.world.brain.district, null);
  assert.equal(summary.world.brain.authority, 'self-owned-role');
  assert.equal(summary.world.brain.executionGuarantee, 'none');
  assert.deepEqual(summary.world.governance, {
    model: 'emergent-social',
    leadership: 'soft-influence',
    operatorScope: 'local-suggestion-only',
    mutationBoundary: 'worker-system-only',
  });
  assert.deepEqual(summary.world.ring.shells, [
    {
      topic: 'clawverse-alpha',
      active: true,
      status: 'active',
      actorCount: 1,
      branchCount: 1,
      brainStatus: 'pending',
      source: 'live',
      updatedAt: null,
    },
  ]);
});

test('buildTopicWorld exposes configured multi-topic ring shells without pretending remote topics are active', () => {
  const peers = [
    makePeer({
      id: 'local-1',
      actorId: 'actor-local',
      sessionId: 'local-1',
      name: 'Local',
      x: 8,
      y: 8,
      lastUpdate: '2026-03-08T10:00:00.000Z',
    }),
  ];

  const summary = buildTopicWorld('topic-beta', peers, 'local-1', ['topic-alpha', 'topic-beta', 'topic-gamma']);

  assert.equal(summary.world.ring.mode, 'configured-multi-topic');
  assert.equal(summary.world.ring.topicCount, 3);
  assert.equal(summary.world.ring.currentTopic, 'topic-beta');
  assert.equal(summary.world.ring.currentIndex, 1);
  assert.deepEqual(summary.world.ring.shells, [
    {
      topic: 'topic-alpha',
      active: false,
      status: 'configured',
      actorCount: 0,
      branchCount: 0,
      brainStatus: 'inactive',
      source: null,
      updatedAt: null,
    },
    {
      topic: 'topic-beta',
      active: true,
      status: 'active',
      actorCount: 1,
      branchCount: 1,
      brainStatus: 'authoritative',
      source: 'live',
      updatedAt: '2026-03-08T10:00:00.000Z',
    },
    {
      topic: 'topic-gamma',
      active: false,
      status: 'configured',
      actorCount: 0,
      branchCount: 0,
      brainStatus: 'inactive',
      source: null,
      updatedAt: null,
    },
  ]);
  assert.equal(summary.world.hierarchy.ringMode, 'configured-multi-topic');
  assert.equal(summary.world.hierarchy.layers[0]?.value, 'configured ring (3 topics)');
  assert.equal(summary.world.hierarchy.layers[0]?.count, 3);
});

test('buildRingWorld returns the same independent ring registry used by topic worlds', () => {
  const peers = [
    makePeer({
      id: 'local-1',
      actorId: 'actor-local',
      sessionId: 'local-1',
      name: 'Local',
      x: 8,
      y: 8,
      lastUpdate: '2026-03-08T10:00:00.000Z',
    }),
  ];

  const topicWorld = buildTopicWorld('topic-beta', peers, 'local-1', ['topic-alpha', 'topic-beta']);
  const ringWorld = buildRingWorld('topic-beta', peers, 'local-1', ['topic-alpha', 'topic-beta']);

  assert.equal(ringWorld.topic, 'topic-beta');
  assert.deepEqual(ringWorld.ring, topicWorld.world.ring);
});

test('buildRingWorld merges mirrored topic shells into configured ring slots', () => {
  const peers = [
    makePeer({
      id: 'local-1',
      actorId: 'actor-local',
      sessionId: 'local-1',
      name: 'Local',
      x: 8,
      y: 8,
      lastUpdate: '2026-03-08T10:00:00.000Z',
    }),
  ];

  const ringWorld = buildRingWorld('topic-beta', peers, 'local-1', ['topic-alpha', 'topic-beta'], [
    {
      topic: 'topic-alpha',
      actorCount: 4,
      branchCount: 7,
      brainStatus: 'authoritative',
      updatedAt: '2026-03-08T11:00:00.000Z',
      source: 'mirror',
    },
  ]);

  assert.deepEqual(ringWorld.ring.shells, [
    {
      topic: 'topic-alpha',
      active: false,
      status: 'mirrored',
      actorCount: 4,
      branchCount: 7,
      brainStatus: 'authoritative',
      source: 'mirror',
      updatedAt: '2026-03-08T11:00:00.000Z',
    },
    {
      topic: 'topic-beta',
      active: true,
      status: 'active',
      actorCount: 1,
      branchCount: 1,
      brainStatus: 'authoritative',
      source: 'live',
      updatedAt: '2026-03-08T10:00:00.000Z',
    },
  ]);
});
