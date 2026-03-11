import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PeerState, ResourceState } from '@clawverse/types';
import { planEconomicAutonomy } from '../src/economic-planner.js';
import { planAutonomyIntents } from '../src/autonomy-intent.js';
import { buildWorldNodes } from '../src/world-nodes.js';
import { scoreTopicClusters } from '../src/cluster-scorer.js';
import { buildRingWorld } from '../src/world-topology.js';
import { planMigration } from '../src/migration-planner.js';
import { MigrationRegistry } from '../src/migration-registry.js';
import { summarizeMigrationSquads } from '../src/migration-squads.js';

const healthyResources: ResourceState = {
  compute: 84,
  storage: 82,
  bandwidth: 68,
  reputation: 24,
  updatedAt: new Date().toISOString(),
};

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

test('autonomy still emits self-driven intents when no operator guidance is present', () => {
  const duties = planEconomicAutonomy({
    needs: { social: 80, tasked: 80, creative: 80 },
    resources: healthyResources,
    zone: 'Residential',
    hasTradeAccess: true,
    ownedBuildings: [],
    relayPatches: 1,
    dataShards: 0,
    alloyFrames: 0,
    activeWar: false,
    activeRaid: false,
    raidRisk: 71,
    knownPeerCount: 6,
    canAffordBuilding: (type) => type === 'archive' || type === 'forge',
    canCraftRecipe: () => false,
  });
  assert.ok(duties.length > 0);

  const intents = planAutonomyIntents({
    orchestrationMode: 'advisory',
    guidance: [],
    candidates: duties.map((duty) => ({
      lane: 'economy' as const,
      duty,
    })),
  });

  assert.ok(intents.length > 0);
  assert.ok(intents.every((intent) => intent.reasons.includes('guidance:+0')));
  assert.ok(intents.every((intent) => intent.finalPriority >= 0 && intent.finalPriority <= 100));
});

test('resource collapse can cascade into migration planning and staged refugee squads', async () => {
  const peers = [
    makePeer({ id: 'local-1', actorId: 'actor-a', sessionId: 'local-1', name: 'A', x: 12, y: 22, lastUpdate: '2026-03-11T00:00:00.000Z' }),
    makePeer({ id: 'local-2', actorId: 'actor-b', sessionId: 'local-2', name: 'B', x: 13, y: 23, lastUpdate: '2026-03-11T00:00:00.000Z' }),
    makePeer({ id: 'local-3', actorId: 'actor-c', sessionId: 'local-3', name: 'C', x: 14, y: 22, lastUpdate: '2026-03-11T00:00:00.000Z' }),
  ];

  const clusters = scoreTopicClusters({
    topic: 'topic-alpha',
    nodes: buildWorldNodes(peers),
    localActorId: 'actor-a',
    resources: { compute: 12, storage: 10, bandwidth: 8 },
    raidRisk: 94,
    activeWarCount: 2,
  });
  assert.ok(clusters.length > 0);
  const localCluster = clusters.find((cluster) => cluster.local) ?? clusters[0];
  assert.ok(localCluster);
  assert.ok(['fracturing', 'collapsing'].includes(localCluster!.status));

  const ring = buildRingWorld('topic-alpha', peers, 'local-1', ['topic-alpha', 'topic-beta'], [
    {
      topic: 'topic-beta',
      actorCount: 6,
      branchCount: 10,
      brainStatus: 'authoritative',
      updatedAt: '2026-03-11T00:00:00.000Z',
      source: 'mirror',
    },
  ]).ring;

  const migrationPlan = planMigration({
    ring,
    compute: 12,
    storage: 10,
    raidRisk: 94,
    activeRaid: true,
    activeWarCount: 2,
    peerHealths: {
      'topic-beta': 'live',
    },
  });

  assert.equal(migrationPlan.strategy, 'evacuate');
  assert.equal(migrationPlan.recommendedTopic, 'topic-beta');
  assert.ok(migrationPlan.urgency >= 75);

  const root = mkdtempSync(join(tmpdir(), 'clawverse-autonomy-flow-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const registry = new MigrationRegistry({ dbPath });
    registry.create({
      actorId: localCluster!.leaderActorId ?? localCluster!.actorIds[0] ?? 'actor-a',
      sessionId: 'session-autonomy',
      fromTopic: 'topic-alpha',
      toTopic: migrationPlan.recommendedTopic ?? 'topic-beta',
      triggerEventType: 'great_migration',
      summary: `${localCluster!.label} is fleeing collapse pressure.`,
      score: Math.max(migrationPlan.urgency, localCluster!.resourcePressure),
      source: 'system',
    });

    const squads = summarizeMigrationSquads(registry.listActive(12));
    assert.equal(squads.length, 1);
    assert.equal(squads[0]?.fromTopic, 'topic-alpha');
    assert.equal(squads[0]?.toTopic, 'topic-beta');
    assert.equal(squads[0]?.status, 'staged');
    assert.equal(squads[0]?.triggerEventType, 'great_migration');

    await registry.destroy();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
