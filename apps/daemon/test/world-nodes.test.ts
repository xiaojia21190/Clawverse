import test from 'node:test';
import assert from 'node:assert/strict';
import type { PeerState } from '@clawverse/types';
import { buildWorldNodes, findPeerByIdentity } from '../src/world-nodes.js';

function makePeer(input: {
  id: string;
  actorId: string;
  sessionId: string;
  name: string;
  x: number;
  y: number;
  mood?: PeerState['mood'];
  lastUpdate: string;
}): PeerState {
  return {
    id: input.id,
    actorId: input.actorId,
    sessionId: input.sessionId,
    name: input.name,
    position: { x: input.x, y: input.y },
    mood: input.mood ?? 'idle',
    hardware: {
      cpuUsage: 18,
      ramUsage: 33,
      ramTotal: 16,
      diskFree: 120,
      uptime: 1024,
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

test('buildWorldNodes merges sessions under one actor and keeps latest session as primary', () => {
  const peers = [
    makePeer({
      id: 'session-old',
      actorId: 'actor-1',
      sessionId: 'session-old',
      name: 'Alpha-old',
      x: 4,
      y: 5,
      lastUpdate: '2026-03-08T10:00:00.000Z',
    }),
    makePeer({
      id: 'session-new',
      actorId: 'actor-1',
      sessionId: 'session-new',
      name: 'Alpha-new',
      x: 6,
      y: 7,
      lastUpdate: '2026-03-08T10:05:00.000Z',
    }),
    makePeer({
      id: 'session-b',
      actorId: 'actor-2',
      sessionId: 'session-b',
      name: 'Beta',
      x: 11,
      y: 3,
      lastUpdate: '2026-03-08T09:55:00.000Z',
    }),
  ];

  const nodes = buildWorldNodes(peers);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0]?.actorId, 'actor-1');
  assert.equal(nodes[0]?.primarySessionId, 'session-new');
  assert.equal(nodes[0]?.state.id, 'session-new');
  assert.equal(nodes[0]?.state.name, 'Alpha-new');
  assert.deepEqual(nodes[0]?.sessionIds, ['session-new', 'session-old']);
  assert.equal(nodes[0]?.sessionCount, 2);
});

test('findPeerByIdentity resolves actor/session identity to the latest live session', () => {
  const peers = [
    makePeer({
      id: 'session-1',
      actorId: 'actor-x',
      sessionId: 'session-1',
      name: 'X-1',
      x: 2,
      y: 2,
      lastUpdate: '2026-03-08T10:00:00.000Z',
    }),
    makePeer({
      id: 'session-2',
      actorId: 'actor-x',
      sessionId: 'session-2',
      name: 'X-2',
      x: 3,
      y: 3,
      lastUpdate: '2026-03-08T10:03:00.000Z',
    }),
  ];

  assert.equal(findPeerByIdentity(peers, 'actor-x')?.id, 'session-2');
  assert.equal(findPeerByIdentity(peers, 'session-1')?.id, 'session-1');
  assert.equal(findPeerByIdentity(peers, 'missing'), undefined);
});
