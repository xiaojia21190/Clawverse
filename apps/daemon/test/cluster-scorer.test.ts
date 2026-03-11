import test from 'node:test';
import assert from 'node:assert/strict';
import type { Faction, PeerState } from '@clawverse/types';
import { buildWorldNodes } from '../src/world-nodes.js';
import { scoreTopicClusters } from '../src/cluster-scorer.js';

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

function makeFaction(id: string, name: string, memberActorIds: string[]): Faction {
  return {
    id,
    name,
    founderId: memberActorIds[0] ?? id,
    founderActorId: memberActorIds[0] ?? id,
    members: [...memberActorIds],
    memberActorIds: [...memberActorIds],
    createdAt: '2026-03-11T00:00:00.000Z',
    motto: `${name} endures`,
    strategic: {
      agenda: 'stability',
      prosperity: 60,
      cohesion: 68,
      influence: 72,
      pressure: 24,
      stage: 'rising',
      lastUpdatedAt: '2026-03-11T00:00:00.000Z',
    },
    treasury: {
      compute: 20,
      storage: 20,
      bandwidth: 20,
      reputation: 20,
      updatedAt: '2026-03-11T00:00:00.000Z',
    },
  };
}

test('scoreTopicClusters groups nearby actors into stable settlement clusters', () => {
  const peers = [
    makePeer({ id: 'p1', actorId: 'a1', sessionId: 'p1', name: 'One', x: 2, y: 2, lastUpdate: '2026-03-11T00:00:00.000Z' }),
    makePeer({ id: 'p2', actorId: 'a2', sessionId: 'p2', name: 'Two', x: 4, y: 3, lastUpdate: '2026-03-11T00:00:00.000Z' }),
    makePeer({ id: 'p3', actorId: 'a3', sessionId: 'p3', name: 'Three', x: 5, y: 4, lastUpdate: '2026-03-11T00:00:00.000Z' }),
    makePeer({ id: 'p4', actorId: 'a4', sessionId: 'p4', name: 'Four', x: 26, y: 15, lastUpdate: '2026-03-11T00:00:00.000Z' }),
  ];

  const clusters = scoreTopicClusters({
    topic: 'topic-alpha',
    nodes: buildWorldNodes(peers),
    localActorId: 'a1',
    resources: { compute: 86, storage: 80, bandwidth: 72 },
    raidRisk: 18,
    activeWarCount: 0,
  });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.actorCount, 3);
  assert.equal(clusters[0]?.district, 'Plaza');
  assert.equal(clusters[0]?.local, true);
  assert.equal(clusters[0]?.status, 'stable');
  assert.equal(typeof clusters[0]?.leaderName, 'string');
});

test('scoreTopicClusters recognizes dominant faction anchors and collapse pressure', () => {
  const peers = [
    makePeer({ id: 'p1', actorId: 'a1', sessionId: 'p1', name: 'One', x: 12, y: 22, lastUpdate: '2026-03-11T00:00:00.000Z' }),
    makePeer({ id: 'p2', actorId: 'a2', sessionId: 'p2', name: 'Two', x: 13, y: 23, lastUpdate: '2026-03-11T00:00:00.000Z' }),
    makePeer({ id: 'p3', actorId: 'a3', sessionId: 'p3', name: 'Three', x: 14, y: 22, lastUpdate: '2026-03-11T00:00:00.000Z' }),
  ];

  const clusters = scoreTopicClusters({
    topic: 'topic-beta',
    nodes: buildWorldNodes(peers),
    localActorId: 'a1',
    factions: [makeFaction('fac-1', 'Shelter Accord', ['a1', 'a2'])],
    resources: { compute: 18, storage: 24, bandwidth: 14 },
    raidRisk: 88,
    activeWarCount: 2,
  });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.dominantFactionName, 'Shelter Accord');
  assert.ok((clusters[0]?.resourcePressure ?? 0) >= 55);
  assert.ok((clusters[0]?.safety ?? 100) <= 35);
  assert.ok(['fracturing', 'collapsing', 'strained'].includes(clusters[0]?.status ?? ''));
});
