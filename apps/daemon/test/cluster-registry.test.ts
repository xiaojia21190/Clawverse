import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClusterRegistry } from '../src/cluster-registry.js';

test('cluster registry persists and replaces topic snapshots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-cluster-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const registry = new ClusterRegistry({ dbPath });
    registry.replaceTopic('topic-alpha', [
      {
        id: 'clu-1',
        topic: 'topic-alpha',
        label: 'Plaza cluster',
        district: 'Plaza',
        center: { x: 4, y: 4 },
        actorIds: ['a1', 'a2'],
        actorCount: 2,
        branchCount: 3,
        local: true,
        dominantFactionId: null,
        dominantFactionName: null,
        dominantFactionRatio: 0,
        leaderActorId: 'a1',
        leaderName: 'Lead One',
        leaderScore: 62,
        cohesion: 72,
        safety: 70,
        resourcePressure: 24,
        stability: 74,
        status: 'stable',
        reasons: ['2 actors are holding around Plaza.'],
        updatedAt: '2026-03-11T00:00:00.000Z',
      },
    ]);
    await registry.destroy();

    const reopened = new ClusterRegistry({ dbPath });
    assert.equal(reopened.list('topic-alpha').length, 1);
    assert.equal(reopened.list('topic-alpha')[0]?.label, 'Plaza cluster');

    reopened.replaceTopic('topic-alpha', [
      {
        id: 'clu-2',
        topic: 'topic-alpha',
        label: 'Market outpost',
        district: 'Market',
        center: { x: 14, y: 4 },
        actorIds: ['a3'],
        actorCount: 1,
        branchCount: 1,
        local: false,
        dominantFactionId: null,
        dominantFactionName: null,
        dominantFactionRatio: 0,
        leaderActorId: 'a3',
        leaderName: 'Lead Three',
        leaderScore: 39,
        cohesion: 30,
        safety: 44,
        resourcePressure: 48,
        stability: 38,
        status: 'forming',
        reasons: ['1 actors are holding around Market.'],
        updatedAt: '2026-03-11T00:01:00.000Z',
      },
    ]);

    const clusters = reopened.list('topic-alpha');
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]?.id, 'clu-2');
    await reopened.destroy();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
