import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpServer } from '../src/http.js';
import { WorkerHeartbeatRegistry } from '../src/worker-heartbeat.js';

function makeEvolutionConfig() {
  return {
    enabled: true,
    variant: 'baseline-v1',
    flushEvery: 1,
    heartbeatSampleEvery: 10,
    autopilot: {
      enabled: false,
      intervalMs: 60_000,
      minEpisodeDelta: 10,
    },
    cooldowns: {
      globalMs: 30_000,
      stepMs: {
        propose: 60_000,
        evaluate: 60_000,
        decide: 60_000,
        healthCheck: 60_000,
        applyRollout: 90_000,
        cycle: 300_000,
        initRollout: 300_000,
      },
    },
  };
}

async function makeServer(ttlMs = 90_000) {
  const registry = new WorkerHeartbeatRegistry();
  const guidanceRecords: Array<{
    id: string;
    kind: string;
    message: string;
    payload: Record<string, unknown> | null;
    status: string;
    source: string;
    createdAt: string;
    updatedAt: string;
    expiresAt: string | null;
  }> = [];
  const context = {
    stateStore: {
      getMyState: () => null,
      getAllPeers: () => [],
      getPeerCount: () => 0,
      getPeerState: () => null,
    },
    bioMonitor: {
      getMetrics: () => ({
        cpuUsage: 8,
        ramUsage: 16,
        ramTotal: 16,
        diskFree: 128,
        uptime: 2048,
        platform: 'test',
        hostname: 'test-host',
        cpuModel: 'test-cpu',
        cpuCores: 8,
      }),
      getMood: () => 'idle',
    },
    network: {
      getPeers: () => [],
      getPeerCount: () => 0,
      sendTo: async () => false,
    },
    myId: 'peer-main',
    topic: 'topic-alpha',
    ringTopics: ['topic-alpha', 'topic-beta'],
    ringRegistry: {
      list: () => [],
      upsert: () => null,
      remove: () => null,
    },
    ringPeerRegistry: {
      listWithHealth: () => [],
      get: () => null,
      upsert: () => null,
      remove: () => null,
    },
    ringPeerTtlMs: 300_000,
    clusterRegistry: { list: () => [] },
    outsiderRegistry: {
      list: () => [],
      create: () => null,
      updateStatus: () => null,
      prune: () => 0,
    },
    migrationRegistry: {
      listActive: () => [],
      create: () => null,
      complete: () => null,
      prune: () => 0,
    },
    getMigrationPlan: () => ({
      strategy: 'hold',
      urgency: 10,
      summary: 'hold',
      recommendedTopic: 'topic-beta',
      targets: [],
    }),
    guidanceRegistry: {
      create: (input: {
        kind?: string;
        message?: string;
        payload?: Record<string, unknown> | null;
        source?: string;
      }) => {
        const now = new Date().toISOString();
        const record = {
          id: `guide-${guidanceRecords.length + 1}`,
          kind: input.kind ?? 'note',
          message: input.message ?? '',
          payload: input.payload && typeof input.payload === 'object' ? { ...input.payload } : null,
          status: 'active',
          source: input.source ?? 'operator',
          createdAt: now,
          updatedAt: now,
          expiresAt: null,
        };
        guidanceRecords.push(record);
        return record;
      },
      listActive: () => guidanceRecords.filter((record) => record.status === 'active'),
      consume: (id: string) => {
        const record = guidanceRecords.find((item) => item.id === id) ?? null;
        if (!record) return null;
        record.status = 'consumed';
        record.updatedAt = new Date().toISOString();
        return record;
      },
      dismiss: (id: string) => {
        const record = guidanceRecords.find((item) => item.id === id) ?? null;
        if (!record) return null;
        record.status = 'dismissed';
        record.updatedAt = new Date().toISOString();
        return record;
      },
      pruneExpired: () => 0,
    },
    episodeLogger: null,
    evolutionConfig: makeEvolutionConfig(),
    social: {
      on: () => undefined,
      getAllRelationships: () => [],
      getPendingEvents: () => [],
      resolveEvent: () => null,
      getTier: () => 'stranger',
    },
    collab: {
      submitTask: async () => null,
      getPendingIncoming: () => [],
      resolve: async () => false,
      getStats: () => ({ pendingIncoming: 0, pendingOutgoing: 0 }),
    },
    needs: {
      satisfy: () => undefined,
      getNeeds: () => ({ social: 80, tasked: 80, wanderlust: 80, creative: 80 }),
    },
    skills: {
      gainXP: () => null,
      getSkills: () => [],
    },
    events: {
      emit: () => undefined,
      getPending: () => [],
      resolve: () => false,
    },
    economy: {
      getResources: () => ({ compute: 80, storage: 80, bandwidth: 60, reputation: 10 }),
      getInventory: () => [],
      getRecipes: () => [],
      craft: () => ({ ok: false }),
      canAfford: () => true,
      consume: () => true,
      award: () => undefined,
      createPendingTrade: () => undefined,
      rejectTrade: () => undefined,
      recordTradeOutcome: () => undefined,
      recordTrade: () => undefined,
      getPendingTrades: () => [],
      getTradeHistory: () => [],
      getItemAmount: () => 0,
    },
    world: {
      getMap: () => ({ width: 40, height: 40, buildings: [] }),
      getBuildingCost: () => ({ compute: 10, storage: 10 }),
      build: () => null,
      demolish: () => false,
      getOwnedBuildings: () => [],
    },
    storyteller: {
      getStatus: () => ({ mode: 'Phoebe', pendingEvents: 0 }),
      setMode: () => undefined,
      triggerEvent: () => undefined,
    },
    faction: {
      getFactions: () => [],
      getActiveWars: () => [],
      getActiveAlliances: () => [],
      getActiveVassalages: () => [],
      createFaction: () => null,
      formAlliance: () => null,
      vassalizeFaction: () => null,
      breakAlliance: () => false,
      declarePeace: () => false,
    },
    jobs: {
      listJobs: () => [],
      getNextQueuedJob: () => null,
      enqueueJob: () => null,
      startJob: () => null,
      requeueActiveJob: () => null,
      retryActiveJob: () => null,
      completeJob: () => null,
      cancelJob: () => null,
      getJob: () => null,
    },
    combat: {
      getStatus: () => ({ posture: 'steady', activeRaid: null, raidRisk: 0 }),
      getLogs: () => [],
      setPosture: () => ({ posture: 'steady', activeRaid: null, raidRisk: 0 }),
      treat: () => ({ ok: false }),
    },
    autonomyOrchestrationMode: 'advisory',
    workerHeartbeatTtlMs: ttlMs,
    heartbeatWorker: (worker: string, nowMs?: number) => registry.heartbeat(worker, nowMs),
    getWorkerHeartbeat: (worker: string, nowMs = Date.now()) => registry.snapshot(worker, nowMs, ttlMs),
    listWorkerHeartbeats: (nowMs = Date.now()) => registry.list(nowMs, ttlMs),
    getGovernorState: () => ({ phase: 'peace' }),
    getAutonomyIntents: () => [],
    applyCombatEffects: () => undefined,
    onSoulUpdate: async () => undefined,
  } as any;
  const server = await createHttpServer(0, context);
  return { server, ttlMs };
}

test('workers heartbeat endpoint forbids direct mutation from non-worker requests', async () => {
  const { server } = await makeServer();
  try {
    const response = await server.inject({
      method: 'POST',
      url: '/workers/heartbeat',
      payload: {
        worker: 'life-worker',
      },
    });
    assert.equal(response.statusCode, 403);
    const body = response.json() as { error: string; action: string };
    assert.equal(body.error, 'direct_mutation_forbidden');
    assert.equal(body.action, 'workers_heartbeat');
  } finally {
    await server.close();
  }
});

test('workers heartbeat endpoint accepts life-worker source and surfaces live status', async () => {
  const { server, ttlMs } = await makeServer();
  try {
    const nowMs = Date.now();
    const beat = await server.inject({
      method: 'POST',
      url: '/workers/heartbeat',
      headers: {
        'x-clawverse-origin': 'life-worker',
      },
      payload: {
        nowMs,
      },
    });
    assert.equal(beat.statusCode, 200);
    const beatBody = beat.json() as {
      success: boolean;
      worker: {
        worker: string;
        status: string;
      };
    };
    assert.equal(beatBody.success, true);
    assert.equal(beatBody.worker.worker, 'life-worker');
    assert.equal(beatBody.worker.status, 'live');

    const health = await server.inject({ method: 'GET', url: '/workers/health' });
    assert.equal(health.statusCode, 200);
    const healthBody = health.json() as {
      ttlMs: number;
      lifeWorker: { status: string };
      workers: Array<{ worker: string }>;
    };
    assert.equal(healthBody.ttlMs, ttlMs);
    assert.equal(healthBody.lifeWorker.status, 'live');
    assert.equal(healthBody.workers.some((item) => item.worker === 'life-worker'), true);

    const status = await server.inject({ method: 'GET', url: '/status' });
    assert.equal(status.statusCode, 200);
    const statusBody = status.json() as {
      autonomy: {
        contract: {
          actorAutonomy: string;
          worldGovernance: string;
          operatorScope: string;
          worldMutationAccess: string;
          migrationUnit: string;
        };
        workerHealth: {
          ttlMs: number;
          lifeWorker: { status: string };
          workers: Array<{ worker: string }>;
        };
      };
      coordination: {
        mode: string;
        focusLane: string;
      } | null;
      governor: {
        mode: string;
        focusLane: string;
      } | null;
    };
    assert.equal(statusBody.autonomy.contract.actorAutonomy, 'openclaw-per-actor');
    assert.equal(statusBody.autonomy.contract.worldGovernance, 'emergent-social');
    assert.equal(statusBody.autonomy.contract.operatorScope, 'local-suggestion-only');
    assert.equal(statusBody.autonomy.contract.worldMutationAccess, 'worker-system-only');
    assert.equal(statusBody.autonomy.contract.migrationUnit, 'squad');
    assert.equal(statusBody.autonomy.workerHealth.ttlMs, ttlMs);
    assert.equal(statusBody.autonomy.workerHealth.lifeWorker.status, 'live');
    assert.equal(statusBody.autonomy.workerHealth.workers.some((item) => item.worker === 'life-worker'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(statusBody, 'coordination'), true);
    assert.equal(statusBody.coordination?.mode ?? null, statusBody.governor?.mode ?? null);
    assert.equal(statusBody.coordination?.focusLane ?? null, statusBody.governor?.focusLane ?? null);
  } finally {
    await server.close();
  }
});

test('brain guidance rejects targeting a different actor', async () => {
  const { server } = await makeServer();
  try {
    const response = await server.inject({
      method: 'POST',
      url: '/brain/guidance',
      payload: {
        kind: 'note',
        message: 'Prefer building perimeter shelter.',
        actorId: 'actor-other',
      },
    });
    assert.equal(response.statusCode, 403);
    const body = response.json() as {
      error: string;
      reason: string;
      requestedActorId: string;
      localActorId: string;
    };
    assert.equal(body.error, 'guidance_target_forbidden');
    assert.equal(body.reason, 'operator_can_only_target_local_actor');
    assert.equal(body.requestedActorId, 'actor-other');
    assert.equal(body.localActorId, 'peer-main');
  } finally {
    await server.close();
  }
});

test('brain guidance accepts local actor target and records local target metadata', async () => {
  const { server } = await makeServer();
  try {
    const response = await server.inject({
      method: 'POST',
      url: '/brain/guidance',
      payload: {
        kind: 'note',
        message: 'Prefer preserving compute before expansion.',
        actorId: 'peer-main',
        sessionId: 'peer-main',
        payload: {
          lane: 'economy',
        },
      },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      success: boolean;
      acceptedAsSuggestion: boolean;
      executionGuarantee: string;
      guidance: {
        payload: {
          lane: string;
          guidanceTargetActorId: string;
          guidanceTargetSessionId: string;
        } | null;
      } | null;
    };
    assert.equal(body.success, true);
    assert.equal(body.acceptedAsSuggestion, true);
    assert.equal(body.executionGuarantee, 'none');
    assert.ok(body.guidance);
    assert.equal(body.guidance?.payload?.lane, 'economy');
    assert.equal(body.guidance?.payload?.guidanceTargetActorId, 'peer-main');
    assert.equal(body.guidance?.payload?.guidanceTargetSessionId, 'peer-main');
  } finally {
    await server.close();
  }
});
