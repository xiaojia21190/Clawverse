import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StateStore } from './state.js';
import { BioMonitor } from './bio.js';
import { ClawverseNetwork } from './network.js';
import { SocialSystem } from './social.js';
import { CollabSystem } from './collab.js';
import { NeedsSystem } from './needs.js';
import { SkillsTracker } from './skills.js';
import { EventEngine, LIFE_EVENT_TYPES, isLifeEventType } from './events.js';
import { EconomySystem } from './economy.js';
import { WorldMap } from './world.js';
import { Storyteller } from './storyteller.js';
import { FactionSystem } from './faction.js';
import { JobsSystem, JobKind, JobPayload } from './jobs.js';
import { ClusterRegistry } from './cluster-registry.js';
import { OutsiderRegistry } from './outsider-registry.js';
import { MigrationRegistry } from './migration-registry.js';
import { MigrationPlanSnapshot } from './migration-planner.js';
import { summarizeMigrationSquads } from './migration-squads.js';
import { CombatSystem } from './combat.js';
import { BrainGuidanceRegistry } from './brain-guidance-registry.js';
import { RingMirrorRegistry } from './ring-registry.js';
import { RingPeerRegistry } from './ring-peer-registry.js';
import type { StrategicGovernorState } from './governor-planner.js';
import type { AutonomyIntentSnapshot } from './autonomy-intent.js';
import type { WorkerHeartbeatSnapshot } from './worker-heartbeat.js';
import { logger } from './logger.js';
import { EvolutionEpisodeLogger } from './evolution.js';
import { AUTONOMY_CONTRACT } from './autonomy-contract.js';
import { DNA, ModelTrait, SocialEvent, RelationshipTier } from '@clawverse/types';
import type { AutonomyOrchestrationMode, EvolutionRuntimeConfig } from '@clawverse/types';
import { createTradeRequest } from '@clawverse/protocol';
import { resolveProjectPath } from './paths.js';
import { findPeerByIdentity } from './world-nodes.js';
import { buildRingWorld, buildTopicWorld } from './world-topology.js';
import {
  isLoopbackAddress,
  normalizeRemoteAddress,
  resolveRequestOperatorKind,
  type RequestOperatorKind,
} from './request-origin.js';

interface APIContext {
  stateStore: StateStore;
  bioMonitor: BioMonitor;
  network: ClawverseNetwork;
  myId: string;
  topic: string;
  ringTopics: string[];
  ringRegistry: RingMirrorRegistry;
  ringPeerRegistry: RingPeerRegistry;
  ringPeerTtlMs: number;
  clusterRegistry: ClusterRegistry;
  outsiderRegistry: OutsiderRegistry;
  migrationRegistry: MigrationRegistry;
  getMigrationPlan: () => MigrationPlanSnapshot;
  guidanceRegistry: BrainGuidanceRegistry;
  episodeLogger: EvolutionEpisodeLogger | null;
  evolutionConfig: EvolutionRuntimeConfig;
  social: SocialSystem;
  collab: CollabSystem;
  needs: NeedsSystem;
  skills: SkillsTracker;
  events: EventEngine;
  economy: EconomySystem;
  world: WorldMap;
  storyteller: Storyteller;
  faction?: FactionSystem;
  jobs: JobsSystem;
  combat: CombatSystem;
  autonomyOrchestrationMode: AutonomyOrchestrationMode;
  workerHeartbeatTtlMs: number;
  heartbeatWorker: (worker: string, nowMs?: number) => WorkerHeartbeatSnapshot | null;
  getWorkerHeartbeat: (worker: string, nowMs?: number) => WorkerHeartbeatSnapshot;
  listWorkerHeartbeats: (nowMs?: number) => WorkerHeartbeatSnapshot[];
  getGovernorState: () => StrategicGovernorState;
  getAutonomyIntents: () => AutonomyIntentSnapshot[];
  applyCombatEffects: (effects: import('./combat.js').CombatTickEffect) => void;
  // Called when /dna/soul is POSTed 闂?daemon regenerates DNA and re-announces
  onSoulUpdate: (soul: { soulHash: string; modelTrait?: ModelTrait; badges?: string[] }) => Promise<void>;
}

// SSE subscriber registry
const stateSseClients = new Set<FastifyReply>();
const socialSseClients = new Set<FastifyReply>();

export function broadcastStateSse(data: unknown): void {
  const payload = `event: peers\ndata: ${JSON.stringify(data)}\n\n`;
  for (const reply of stateSseClients) {
    try { reply.raw.write(payload); } catch { stateSseClients.delete(reply); }
  }
}

export function broadcastSocialSse(event: SocialEvent): void {
  const payload = `event: social\ndata: ${JSON.stringify(event)}\n\n`;
  for (const reply of socialSseClients) {
    try { reply.raw.write(payload); } catch { socialSseClients.delete(reply); }
  }
}

function locationName(pos: { x: number; y: number }): string {
  if (pos.x < 10 && pos.y < 10) return 'Plaza';
  if (pos.x >= 10 && pos.x < 20 && pos.y < 10) return 'Market';
  if (pos.x < 10 && pos.y >= 10 && pos.y < 20) return 'Library';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 10 && pos.y < 20) return 'Workshop';
  if (pos.x < 10 && pos.y >= 20) return 'Park';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 20) return 'Tavern';
  return 'Residential';
}

function parseOptionalIso(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function readJsonLines<T>(path: string, limit = 8): T[] {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .slice(-Math.max(1, limit))
      .map((line) => JSON.parse(line) as T)
      .reverse();
  } catch {
    return [];
  }
}

type EvolutionRunStep =
  | 'propose'
  | 'evaluate'
  | 'decide'
  | 'health-check'
  | 'apply-rollout'
  | 'cycle'
  | 'init-rollout';

interface EvolutionRunInfo {
  step: EvolutionRunStep;
  startedAt: string;
  pid: number | null;
}

interface EvolutionRunResult extends EvolutionRunInfo {
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface EvolutionRunAuditEntry {
  ts: string;
  step: string;
  force: boolean;
  outcome: 'accepted' | 'rejected' | 'completed';
  operatorKind: RequestOperatorKind;
  note?: string | null;
  ok?: boolean;
  reason?: string | null;
  statusCode?: number | null;
  remoteAddress: string;
  origin: string | null;
  userAgent: string | null;
  source: string | null;
  pid?: number | null;
  durationMs?: number | null;
}

interface EvolutionCooldownSnapshot {
  globalActive: boolean;
  globalUntil: string | null;
  globalRemainingMs: number;
  byStep: Partial<Record<EvolutionRunStep, {
    active: boolean;
    until: string | null;
    remainingMs: number;
  }>>;
}

const EVOLUTION_STEP_SCRIPTS: Record<EvolutionRunStep, string> = {
  propose: 'tools/evolution/propose.mjs',
  evaluate: 'tools/evolution/evaluate.mjs',
  decide: 'tools/evolution/decide.mjs',
  'health-check': 'tools/evolution/health-check.mjs',
  'apply-rollout': 'tools/evolution/apply-rollout.mjs',
  cycle: 'tools/evolution/cycle.mjs',
  'init-rollout': 'tools/evolution/init-rollout.mjs',
};

function isEvolutionRunStep(value: unknown): value is EvolutionRunStep {
  return typeof value === 'string' && value in EVOLUTION_STEP_SCRIPTS;
}

function normalizeEvolutionNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}

export async function createHttpServer(
  port: number,
  context: APIContext
): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  const projectRoot = resolveProjectPath('.');
  const evolutionAuditPath = resolveProjectPath('data/evolution/audit/run-history.jsonl');
  const evolutionCooldownConfig = context.evolutionConfig.cooldowns;
  let activeEvolutionRun: EvolutionRunInfo | null = null;
  let lastEvolutionRun: EvolutionRunResult | null = null;
  let evolutionGlobalCooldownUntil = 0;
  const evolutionStepCooldownUntil = new Map<EvolutionRunStep, number>();

  const currentActorId = (): string => {
    const myState = context.stateStore.getMyState();
    return myState?.actorId ?? myState?.dna.id ?? context.myId;
  };

  const ownedBuildings = () => context.world.getOwnedBuildings(context.myId, currentActorId());
  const ownedBuildingTypes = () => ownedBuildings().map((building) => building.type);

  interface RequestOperatorContext {
    operatorKind: RequestOperatorKind;
    source: string | null;
    origin: string | null;
    userAgent: string | null;
    remoteAddress: string;
    loopback: boolean;
  }

  function resolveRequestOperatorContext(request: FastifyRequest): RequestOperatorContext {
    const source = typeof request.headers['x-clawverse-origin'] === 'string'
      ? request.headers['x-clawverse-origin']
      : null;
    const origin = typeof request.headers.origin === 'string'
      ? request.headers.origin
      : null;
    const userAgent = typeof request.headers['user-agent'] === 'string'
      ? request.headers['user-agent']
      : null;
    const remoteAddress = normalizeRemoteAddress(request.ip || request.socket.remoteAddress);
    const loopback = isLoopbackAddress(remoteAddress);
    const operatorKind = resolveRequestOperatorKind(source, origin, userAgent);
    return {
      operatorKind,
      source,
      origin,
      userAgent,
      remoteAddress,
      loopback,
    };
  }

  function canMutateWorldDirectly(
    meta: RequestOperatorContext,
    opts?: { allowRemoteSystem?: boolean },
  ): boolean {
    if (meta.loopback) {
      return meta.operatorKind === 'openclaw-worker'
        || meta.operatorKind === 'daemon-policy';
    }
    return opts?.allowRemoteSystem === true && meta.operatorKind === 'daemon-policy';
  }

  function rejectDirectMutationIfForbidden(
    request: FastifyRequest,
    reply: FastifyReply,
    action: string,
    opts?: { allowRemoteSystem?: boolean },
  ): boolean {
    const meta = resolveRequestOperatorContext(request);
    if (canMutateWorldDirectly(meta, opts)) return false;
    reply.code(403).send({
      error: 'direct_mutation_forbidden',
      action,
      operatorKind: meta.operatorKind,
      hint: 'Only local-role suggestions are allowed for operators. Use /brain/guidance. World mutation is worker/system only.',
    });
    return true;
  }

  function buildTopicWorldView() {
    const base = buildTopicWorld(
      context.topic,
      context.stateStore.getAllPeers(),
      context.myId,
      context.ringTopics,
      context.ringRegistry.list(),
    );
    const clusters = context.clusterRegistry.list(context.topic);
    const outsiders = context.outsiderRegistry.list(context.topic, 24);
    return {
      ...base,
      world: {
        ...base.world,
        population: {
          ...base.world.population,
          clusterCount: clusters.length,
          outsiderCount: outsiders.filter((item) => item.status !== 'accepted').length,
        },
        clusters,
        outsiders,
      },
    };
  }

  function appendEvolutionAudit(entry: EvolutionRunAuditEntry): void {
    try {
      mkdirSync(join(evolutionAuditPath, '..'), { recursive: true });
      appendFileSync(evolutionAuditPath, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      logger.warn(`[evolution] failed to append audit log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function readEvolutionCooldowns(nowMs = Date.now()): EvolutionCooldownSnapshot {
    const globalActive = evolutionGlobalCooldownUntil > nowMs;
    const byStep = {} as EvolutionCooldownSnapshot['byStep'];
    for (const step of Object.keys(EVOLUTION_STEP_SCRIPTS) as EvolutionRunStep[]) {
      const untilMs = evolutionStepCooldownUntil.get(step) ?? 0;
      const active = untilMs > nowMs;
      byStep[step] = {
        active,
        until: active ? new Date(untilMs).toISOString() : null,
        remainingMs: active ? Math.max(0, untilMs - nowMs) : 0,
      };
    }
    return {
      globalActive,
      globalUntil: globalActive ? new Date(evolutionGlobalCooldownUntil).toISOString() : null,
      globalRemainingMs: globalActive ? Math.max(0, evolutionGlobalCooldownUntil - nowMs) : 0,
      byStep,
    };
  }

  async function runEvolutionStep(
    step: EvolutionRunStep,
    args: string[] = [],
    auditMeta?: Omit<EvolutionRunAuditEntry, 'ts' | 'step' | 'force' | 'outcome' | 'ok' | 'reason' | 'statusCode' | 'pid' | 'durationMs'>,
  ): Promise<EvolutionRunResult> {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const scriptPath = resolveProjectPath(EVOLUTION_STEP_SCRIPTS[step]);

    return await new Promise<EvolutionRunResult>((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, ...args], {
        cwd: projectRoot,
        env: {
          ...process.env,
          CLAWVERSE_PROJECT_ROOT: projectRoot,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      activeEvolutionRun = {
        step,
        startedAt,
        pid: child.pid ?? null,
      };

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        const result: EvolutionRunResult = {
          step,
          startedAt,
          pid: child.pid ?? null,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          ok: code === 0,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };
        lastEvolutionRun = result;
        activeEvolutionRun = null;
        appendEvolutionAudit({
          ts: result.finishedAt,
          step,
          force: args.includes('--force'),
          outcome: 'completed',
          operatorKind: auditMeta?.operatorKind ?? 'unknown',
          note: auditMeta?.note ?? null,
          ok: result.ok,
          reason: result.ok ? null : (result.stderr || 'step_failed'),
          statusCode: result.ok ? 200 : 500,
          remoteAddress: auditMeta?.remoteAddress ?? '127.0.0.1',
          origin: auditMeta?.origin ?? 'daemon',
          userAgent: auditMeta?.userAgent ?? 'daemon',
          source: auditMeta?.source ?? 'daemon',
          pid: result.pid,
          durationMs: result.durationMs,
        });
        resolve(result);
      });
    });
  }

  // Wire social events to SSE
  context.social.on('event', (e) => broadcastSocialSse(e));

  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    peerId: context.myId,
    timestamp: new Date().toISOString(),
  }));

  fastify.get('/workers/health', async () => ({
    ttlMs: context.workerHeartbeatTtlMs,
    workers: context.listWorkerHeartbeats(Date.now()),
    lifeWorker: context.getWorkerHeartbeat('life-worker', Date.now()),
  }));

  fastify.post<{
    Body: {
      worker?: string;
      nowMs?: number;
    };
  }>('/workers/heartbeat', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'workers_heartbeat')) return;
    const sourceWorker = typeof request.headers['x-clawverse-origin'] === 'string'
      ? request.headers['x-clawverse-origin']
      : '';
    const worker = typeof request.body?.worker === 'string' && request.body.worker.trim().length > 0
      ? request.body.worker
      : sourceWorker;
    if (!worker.trim()) return reply.code(400).send({ error: 'worker required' });
    const snapshot = context.heartbeatWorker(
      worker,
      typeof request.body?.nowMs === 'number' && Number.isFinite(request.body.nowMs)
        ? request.body.nowMs
        : Date.now(),
    );
    if (!snapshot) return reply.code(400).send({ error: 'invalid worker' });
    return { success: true, worker: snapshot };
  });

  // Get my status
  fastify.get('/status', async () => {
    const metrics = context.bioMonitor.getMetrics();
    const myState = context.stateStore.getMyState();
    const mood = myState?.mood ?? context.bioMonitor.getMood();
    const peers = context.network.getPeers();
    const world = buildTopicWorldView().world;
    const nowMs = Date.now();
    const coordination = context.getGovernorState() ?? null;
    return {
      id: context.myId,
      actorId: myState?.actorId ?? myState?.dna.id ?? null,
      topic: context.topic,
      mood,
      metrics,
      state: myState,
      world,
      combat: context.combat.getStatus(),
      autonomy: {
        orchestrationMode: context.autonomyOrchestrationMode,
        contract: AUTONOMY_CONTRACT,
        intents: context.getAutonomyIntents(),
        workerHealth: {
          ttlMs: context.workerHeartbeatTtlMs,
          lifeWorker: context.getWorkerHeartbeat('life-worker', nowMs),
          workers: context.listWorkerHeartbeats(nowMs),
        },
      },
      coordination,
      governor: coordination,
      connectedPeers: peers.length,
      knownPeers: context.stateStore.getPeerCount(),
      knownActors: world.population.actorCount,
    };
  });

  // Get all peers
  fastify.get('/peers', async () => ({
    connected: context.network.getPeers(),
    all: context.stateStore.getAllPeers(),
  }));

  // Get specific peer
  fastify.get<{ Params: { peerId: string } }>('/peers/:peerId', async (request, reply) => {
    const peers = context.stateStore.getAllPeers();
    const state = context.stateStore.getPeerState(request.params.peerId)
      ?? findPeerByIdentity(peers, request.params.peerId);
    if (!state) { reply.code(404); return { error: 'Peer not found' }; }
    return state;
  });

  // Move to position
  fastify.post<{ Body: { x: number; y: number } }>('/move', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'move')) return;
    const { x, y } = request.body || {};
    if (typeof x !== 'number' || typeof y !== 'number') {
      reply.code(400);
      return { error: 'x and y must be numbers' };
    }
    const prevState = context.stateStore.getMyState();
    const prevZone = locationName(prevState?.position ?? { x: 0, y: 0 });
    const newPos = { x, y };
    context.stateStore.updateMyStructure({ position: newPos });
    broadcastStateSse({ peers: context.stateStore.getAllPeers() });
    const newZone = locationName(newPos);
    context.needs.satisfy('wanderlust', 25);
    const lu = context.skills.gainXP('explorer', newZone !== prevZone ? 3 : 1);
    if (lu) context.events.emit('skill_levelup', { skill: lu.skill, level: lu.level });
    return { success: true, position: newPos };
  });

  // Network stats
  fastify.get('/network', async () => ({
    myId: context.myId,
    connectedPeers: context.network.getPeerCount(),
    knownPeers: context.stateStore.getPeerCount(),
    knownActors: buildTopicWorldView().world.population.actorCount,
    peers: context.network.getPeers(),
  }));

  // Evolution logger status
  fastify.get('/evolution', async () => ({
    enabled: !!context.episodeLogger,
    variant: context.episodeLogger?.getVariant() ?? null,
    episodesPath: context.episodeLogger?.getPath() ?? null,
  }));

  fastify.get('/evolution/status', async () => {
    const response: {
      enabled: boolean;
      variant: string | null;
      episodesPath: string | null;
      config: {
        autopilot: EvolutionRuntimeConfig['autopilot'];
        cooldowns: EvolutionRuntimeConfig['cooldowns'];
      };
      stats: {
        total: number;
      } | null;
      rollout: Record<string, unknown> | null;
      latest: Record<string, unknown> | null;
      history: Array<Record<string, unknown>>;
      audit: EvolutionRunAuditEntry[];
      cooldowns: EvolutionCooldownSnapshot;
      runner: {
        active: EvolutionRunInfo | null;
        last: EvolutionRunResult | null;
      };
    } = {
      enabled: !!context.episodeLogger,
      variant: context.episodeLogger?.getVariant() ?? null,
      episodesPath: context.episodeLogger?.getPath() ?? null,
      config: {
        autopilot: context.evolutionConfig.autopilot,
        cooldowns: context.evolutionConfig.cooldowns,
      },
      stats: null,
      rollout: null,
      latest: null,
      history: [],
      audit: [],
      cooldowns: readEvolutionCooldowns(),
      runner: {
        active: activeEvolutionRun,
        last: lastEvolutionRun,
      },
    };

    const rolloutStatePath = resolveProjectPath('data/evolution/rollout/state.json');
    const proposalsLatestPath = resolveProjectPath('data/evolution/proposals/LATEST');
    const rolloutHistoryPath = resolveProjectPath('data/evolution/rollout/history.jsonl');

    if (existsSync(rolloutStatePath)) {
      const rollout = readJsonFile<Record<string, unknown>>(rolloutStatePath);
      if (rollout) {
        const nowMs = Date.now();
        const lastRatioChangeAtMs = parseOptionalIso(rollout.lastRatioChangeAt);
        const healthWindowStartAtMs = parseOptionalIso(rollout.healthWindowStartAt);
        const lastHealthCheckAtMs = parseOptionalIso(rollout.lastHealthCheckAt);
        const canaryLockedUntilMs = parseOptionalIso(rollout.canaryLockedUntil);
        const canaryActive = Number(rollout.candidateRatio ?? 0) > 0
          && canaryLockedUntilMs > nowMs;
        const canaryRemainingMs = canaryActive ? Math.max(0, canaryLockedUntilMs - nowMs) : 0;
        const healthFresh = Boolean(
          lastRatioChangeAtMs
          && healthWindowStartAtMs
          && lastHealthCheckAtMs
          && healthWindowStartAtMs === lastRatioChangeAtMs
          && lastHealthCheckAtMs >= healthWindowStartAtMs
        );

        response.rollout = {
          ...rollout,
          canary: {
            active: canaryActive,
            remainingMs: canaryRemainingMs,
            remainingMinutes: Math.ceil(canaryRemainingMs / 60_000),
            lockedUntil: typeof rollout.canaryLockedUntil === 'string' ? rollout.canaryLockedUntil : null,
          },
          healthGate: {
            status: healthFresh
              ? (typeof rollout.healthGateStatus === 'string' ? rollout.healthGateStatus : 'pending')
              : 'pending',
            rawStatus: typeof rollout.healthGateStatus === 'string' ? rollout.healthGateStatus : 'pending',
            fresh: healthFresh,
            lastHealthCheckAt: typeof rollout.lastHealthCheckAt === 'string' ? rollout.lastHealthCheckAt : null,
            windowStartAt: typeof rollout.healthWindowStartAt === 'string' ? rollout.healthWindowStartAt : null,
            rollbackApplied: Boolean(rollout.healthRollbackApplied),
            samples: rollout.healthSamples ?? null,
            checks: rollout.healthChecks ?? null,
          },
        };
      }
    }

    if (context.episodeLogger) {
      try {
        const stats = context.episodeLogger.getStats();
        response.stats = { total: stats.total };
      } catch {
        response.stats = null;
      }
    }

    if (existsSync(proposalsLatestPath)) {
      const latestRaw = readFileSync(proposalsLatestPath, 'utf8').trim().replace(/\.json$/, '');
      const decisionPath = resolveProjectPath(join('data/evolution/decisions', `${latestRaw}.json`));
      const reportPath = resolveProjectPath(join('data/evolution/reports', `${latestRaw}.json`));
      response.latest = {
        proposalId: latestRaw,
        decision: existsSync(decisionPath) ? readJsonFile<Record<string, unknown>>(decisionPath) : null,
        report: existsSync(reportPath) ? readJsonFile<Record<string, unknown>>(reportPath) : null,
      };
    }

    if (existsSync(rolloutHistoryPath)) {
      response.history = readJsonLines<Record<string, unknown>>(rolloutHistoryPath, 8);
    }

    if (existsSync(evolutionAuditPath)) {
      response.audit = readJsonLines<EvolutionRunAuditEntry>(evolutionAuditPath, 12);
    }

    return response;
  });

  fastify.get<{ Querystring: { limit?: string; since?: string } }>('/evolution/history', async (request) => {
    const rolloutHistoryPath = resolveProjectPath('data/evolution/rollout/history.jsonl');
    const limitRaw = Number(request.query?.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.round(limitRaw))) : 20;
    const sinceMs = parseOptionalIso(request.query?.since);
    const entries = existsSync(rolloutHistoryPath)
      ? readJsonLines<Record<string, unknown>>(rolloutHistoryPath, limit * 4)
        .filter((entry) => !sinceMs || parseOptionalIso(entry.ts) >= sinceMs)
        .slice(0, limit)
      : [];
    return { entries };
  });

  fastify.get<{
    Querystring: {
      limit?: string;
      since?: string;
      step?: string;
      outcome?: string;
      operatorKind?: string;
      ok?: string;
    };
  }>('/evolution/audit', async (request) => {
    const limitRaw = Number(request.query?.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.round(limitRaw))) : 20;
    const sinceMs = parseOptionalIso(request.query?.since);
    const step = typeof request.query?.step === 'string' ? request.query.step.trim() : '';
    const outcome = typeof request.query?.outcome === 'string' ? request.query.outcome.trim() : '';
    const operatorKind = typeof request.query?.operatorKind === 'string' ? request.query.operatorKind.trim() : '';
    const okFilter = typeof request.query?.ok === 'string'
      ? request.query.ok.trim().toLowerCase()
      : '';

    const entries = existsSync(evolutionAuditPath)
      ? readJsonLines<EvolutionRunAuditEntry>(evolutionAuditPath, limit * 6)
        .filter((entry) => !sinceMs || parseOptionalIso(entry.ts) >= sinceMs)
        .filter((entry) => !step || entry.step === step)
        .filter((entry) => !outcome || entry.outcome === outcome)
        .filter((entry) => !operatorKind || entry.operatorKind === operatorKind)
        .filter((entry) => {
          if (!okFilter) return true;
          if (okFilter === 'true') return entry.ok === true;
          if (okFilter === 'false') return entry.ok === false;
          return true;
        })
        .slice(0, limit)
      : [];

    return { entries };
  });

  fastify.post<{ Body: { step?: string; force?: boolean; note?: string } }>('/evolution/run', async (request, reply) => {
    const step = request.body?.step;
    const force = request.body?.force === true;
    const note = normalizeEvolutionNote(request.body?.note);
    const remoteAddress = normalizeRemoteAddress(request.ip || request.socket.remoteAddress);
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : null;
    const userAgent = typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null;
    const source = typeof request.headers['x-clawverse-origin'] === 'string' ? request.headers['x-clawverse-origin'] : null;
    const operatorKind = resolveRequestOperatorKind(source, origin, userAgent);

    if (!isLoopbackAddress(remoteAddress)) {
      appendEvolutionAudit({
        ts: new Date().toISOString(),
        step: typeof step === 'string' ? step : 'unknown',
        force,
        outcome: 'rejected',
        operatorKind,
        note,
        ok: false,
        reason: 'non_loopback_request',
        statusCode: 403,
        remoteAddress,
        origin,
        userAgent,
        source,
      });
      return reply.code(403).send({ error: 'evolution run is restricted to localhost' });
    }

    if (!isEvolutionRunStep(step)) {
      appendEvolutionAudit({
        ts: new Date().toISOString(),
        step: typeof step === 'string' ? step : 'unknown',
        force,
        outcome: 'rejected',
        operatorKind,
        note,
        ok: false,
        reason: 'invalid_step',
        statusCode: 400,
        remoteAddress,
        origin,
        userAgent,
        source,
      });
      return reply.code(400).send({ error: 'invalid step' });
    }
    if (activeEvolutionRun) {
      appendEvolutionAudit({
        ts: new Date().toISOString(),
        step,
        force,
        outcome: 'rejected',
        operatorKind,
        note,
        ok: false,
        reason: 'run_already_active',
        statusCode: 409,
        remoteAddress,
        origin,
        userAgent,
        source,
      });
      return reply.code(409).send({ error: 'evolution run already active', active: activeEvolutionRun });
    }

    const cooldowns = readEvolutionCooldowns();
    const stepCooldown = cooldowns.byStep[step];
    if (cooldowns.globalActive || stepCooldown?.active) {
      const reason = cooldowns.globalActive ? 'global_cooldown_active' : 'step_cooldown_active';
      const retryAfterMs = Math.max(
        cooldowns.globalRemainingMs,
        stepCooldown?.remainingMs ?? 0,
      );
      appendEvolutionAudit({
        ts: new Date().toISOString(),
        step,
        force,
        outcome: 'rejected',
        operatorKind,
        note,
        ok: false,
        reason,
        statusCode: 429,
        remoteAddress,
        origin,
        userAgent,
        source,
      });
      return reply.code(429).send({
        error: reason,
        retryAfterMs,
        cooldowns,
      });
    }

    const args = step === 'init-rollout' && force ? ['--force'] : [];
    const nowMs = Date.now();
    const stepCooldownMs = {
      propose: evolutionCooldownConfig.stepMs.propose,
      evaluate: evolutionCooldownConfig.stepMs.evaluate,
      decide: evolutionCooldownConfig.stepMs.decide,
      'health-check': evolutionCooldownConfig.stepMs.healthCheck,
      'apply-rollout': evolutionCooldownConfig.stepMs.applyRollout,
      cycle: evolutionCooldownConfig.stepMs.cycle,
      'init-rollout': evolutionCooldownConfig.stepMs.initRollout,
    } satisfies Record<EvolutionRunStep, number>;
    evolutionGlobalCooldownUntil = nowMs + evolutionCooldownConfig.globalMs;
    evolutionStepCooldownUntil.set(step, nowMs + stepCooldownMs[step]);
    appendEvolutionAudit({
      ts: new Date().toISOString(),
      step,
      force,
      outcome: 'accepted',
      operatorKind,
      note,
      ok: true,
      reason: null,
      statusCode: 202,
      remoteAddress,
      origin,
      userAgent,
      source,
    });

    try {
      const result = await runEvolutionStep(step, args, {
        operatorKind,
        note,
        remoteAddress,
        origin,
        userAgent,
        source,
      });
      return result.ok
        ? { ok: true, result }
        : reply.code(500).send({ ok: false, result });
    } catch (error) {
      activeEvolutionRun = null;
      const message = error instanceof Error ? error.message : String(error);
      lastEvolutionRun = {
        step,
        startedAt: new Date().toISOString(),
        pid: null,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        ok: false,
        exitCode: null,
        stdout: '',
        stderr: message,
      };
      appendEvolutionAudit({
        ts: lastEvolutionRun.finishedAt,
        step,
        force,
        outcome: 'completed',
        operatorKind,
        note,
        ok: false,
        reason: message,
        statusCode: 500,
        remoteAddress,
        origin,
        userAgent,
        source,
        pid: null,
        durationMs: 0,
      });
      return reply.code(500).send({ ok: false, error: message });
    }
  });

  // Evolution stats
  fastify.get('/evolution/stats', async (_, reply) => {
    if (!context.episodeLogger) {
      reply.code(400);
      return { error: 'Evolution logger disabled' };
    }
    try {
      return context.episodeLogger.getStats();
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  // Record task/manual episode
  fastify.post<{
    Body: {
      success: boolean;
      latencyMs: number;
      tokenTotal?: number;
      costUsd?: number;
      source?: 'task-runtime' | 'manual';
      variant?: string;
      meta?: Record<string, unknown>;
    };
  }>('/evolution/episode', async (request, reply) => {
    if (!context.episodeLogger) {
      reply.code(400);
      return { error: 'Evolution logger is disabled' };
    }
    const body = request.body || ({} as any);
    if (typeof body.success !== 'boolean' || typeof body.latencyMs !== 'number') {
      reply.code(400);
      return { error: 'success:boolean and latencyMs:number are required' };
    }
    context.episodeLogger.record({
      idPrefix: body.source === 'manual' ? 'manual' : 'task',
      variant: body.variant,
      source: body.source || 'task-runtime',
      success: body.success,
      latencyMs: body.latencyMs,
      tokenTotal: body.tokenTotal,
      costUsd: body.costUsd,
      meta: body.meta as any,
    });
    return { ok: true, variant: context.episodeLogger.getVariant() };
  });

  // DNA soul update 闂?called by OpenClaw connector soul-worker
  fastify.post<{
    Body: { soulHash: string; modelTrait?: ModelTrait; badges?: string[] };
  }>('/dna/soul', async (request, reply) => {
    const { soulHash, modelTrait, badges } = request.body || {};
    if (!soulHash || typeof soulHash !== 'string') {
      reply.code(400);
      return { error: 'soulHash is required' };
    }
    try {
      await context.onSoulUpdate({ soulHash, modelTrait, badges });
      context.needs.satisfy('creative', 15);
      const lu = context.skills.gainXP('analyst', 5);
      if (lu) context.events.emit('skill_levelup', { skill: lu.skill, level: lu.level });
      const myState = context.stateStore.getMyState();
      return { ok: true, dna: myState?.dna };
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  // Social relationships
  fastify.get('/social/relationships', async () =>
    context.social.getAllRelationships()
  );

  // Pending social events (for OpenClaw connector-skill to pick up)
  fastify.get('/social/pending', async () =>
    context.social.getPendingEvents()
  );

  // Resolve a pending social event with dialogue from OpenClaw
  fastify.post<{
    Body: { id: string; dialogue: string };
  }>('/social/resolve', async (request, reply) => {
    const { id, dialogue } = request.body || {};
    if (!id || typeof dialogue !== 'string') {
      reply.code(400);
      return { error: 'id and dialogue are required' };
    }
    const event = context.social.resolveEvent(id, dialogue, (prev, next, peerId) => {
      context.events.emit('relationship_milestone', { prev, next, peerId });
    });
    if (!event) {
      reply.code(404);
      return { error: 'Pending event not found or already resolved' };
    }
    const tier = context.social.getTier(event.to);
    const multiplier = tier === 'ally' ? 1.5 : tier === 'nemesis' ? 0.25 : 1;
    context.needs.satisfy('social', Math.round(20 * multiplier));
    const lu = context.skills.gainXP('social', 2);
    if (lu) context.events.emit('skill_levelup', { skill: lu.skill, level: lu.level });
    return { ok: true, event };
  });

  // Collab: submit a capability loan task to a peer
  fastify.post<{
    Body: { to: string; context: string; question: string };
  }>('/collab/submit', async (request, reply) => {
    const body = request.body || {} as any;
    if (!body.to || typeof body.context !== 'string' || typeof body.question !== 'string') {
      reply.code(400);
      return { error: 'to, context, and question are required' };
    }
    const submit = await context.collab.submitTask(body.to, body.context, body.question);
    if (!submit.submitted) {
      reply.code(502);
      return { ok: false, taskId: submit.task.id, error: submit.error ?? 'submit failed' };
    }
    return { ok: true, taskId: submit.task.id };
  });

  // Collab: collab-worker polls for incoming tasks to execute
  fastify.get('/collab/pending', async () =>
    context.collab.getPendingIncoming()
  );

  // Collab: collab-worker resolves an incoming task with its result
  fastify.post<{
    Body: { id: string; result: string; success: boolean };
  }>('/collab/resolve', async (request, reply) => {
    const { id, result, success } = request.body || {} as any;
    if (!id || typeof result !== 'string' || typeof success !== 'boolean') {
      reply.code(400);
      return { error: 'id, result, and success are required' };
    }
    const ok = await context.collab.resolve(id, result, success);
    if (!ok) {
      reply.code(404);
      return { error: 'Task not found or already resolved' };
    }
    context.needs.satisfy('tasked', success ? 30 : 5);
    const lu = context.skills.gainXP('collab', success ? 5 : 1);
    if (lu) context.events.emit('skill_levelup', { skill: lu.skill, level: lu.level });
    return { ok: true };
  });

  // Collab: per-peer collaboration stats
  fastify.get('/collab/stats', async () =>
    context.collab.getStats()
  );

  // Life system endpoints
  fastify.get('/life/needs', async () => context.needs.getNeeds());
  fastify.get('/life/skills', async () => context.skills.getSkills());
  fastify.get('/life/events/pending', async () => context.events.getPending());
  fastify.post<{ Params: { id: string } }>(
    '/life/events/resolve/:id',
    async (request, reply) => {
      const ok = context.events.resolve(request.params.id);
      if (!ok) { reply.code(404); return { error: 'Event not found or already resolved' }; }
      return { ok: true };
    }
  );
  fastify.get('/life/relationships', async () => context.social.getAllRelationships());

  // Operator guidance: soft hints for the local brain (never a hard command)
  fastify.get('/brain/guidance', async () => {
    context.guidanceRegistry.pruneExpired(Date.now());
    return { guidance: context.guidanceRegistry.listActive(16, Date.now()) };
  });

  fastify.post<{
    Body: {
      kind?: string;
      message?: string;
      payload?: Record<string, unknown>;
      ttlMs?: number | null;
      actorId?: string;
      sessionId?: string;
    };
  }>('/brain/guidance', async (request, reply) => {
    const body = request.body || {};
    const kind = body.kind === 'move' ? 'move' : 'note';
    const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : null;
    const ttlMs = typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) ? body.ttlMs : null;
    const myState = context.stateStore.getMyState();
    const localActorId = myState?.actorId ?? myState?.dna.id ?? context.myId;
    const localSessionId = myState?.sessionId ?? context.myId;
    const requestedActorId = typeof body.actorId === 'string' && body.actorId.trim().length > 0
      ? body.actorId.trim()
      : typeof request.headers['x-clawverse-actor-id'] === 'string' && request.headers['x-clawverse-actor-id'].trim().length > 0
        ? request.headers['x-clawverse-actor-id'].trim()
        : null;
    const requestedSessionId = typeof body.sessionId === 'string' && body.sessionId.trim().length > 0
      ? body.sessionId.trim()
      : typeof request.headers['x-clawverse-session-id'] === 'string' && request.headers['x-clawverse-session-id'].trim().length > 0
        ? request.headers['x-clawverse-session-id'].trim()
        : null;
    if (requestedActorId && requestedActorId !== localActorId) {
      return reply.code(403).send({
        error: 'guidance_target_forbidden',
        reason: 'operator_can_only_target_local_actor',
        requestedActorId,
        localActorId,
      });
    }
    if (requestedSessionId && requestedSessionId !== localSessionId) {
      return reply.code(403).send({
        error: 'guidance_target_forbidden',
        reason: 'operator_can_only_target_local_session',
        requestedSessionId,
        localSessionId,
      });
    }
    const targetPayload = {
      ...(payload ? { ...payload } : {}),
      guidanceTargetActorId: localActorId,
      guidanceTargetSessionId: localSessionId,
    };

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      if (kind === 'move') {
        const x = payload && typeof payload.x === 'number' ? Math.round(payload.x) : null;
        const y = payload && typeof payload.y === 'number' ? Math.round(payload.y) : null;
        if (x === null || y === null) return reply.code(400).send({ error: 'message required' });
        const record = context.guidanceRegistry.create({
          kind,
          message: `Prefer moving toward (${x},${y}) if it remains safe and useful.`,
          payload: {
            ...targetPayload,
            x,
            y,
          },
          ttlMs,
          source: 'operator',
        });
        return {
          success: true,
          acceptedAsSuggestion: true,
          executionGuarantee: 'none',
          guidance: record,
        };
      }
      return reply.code(400).send({ error: 'message required' });
    }

    const record = context.guidanceRegistry.create({
      kind,
      message,
      payload: targetPayload,
      ttlMs,
      source: 'operator',
    });
    return {
      success: true,
      acceptedAsSuggestion: true,
      executionGuarantee: 'none',
      guidance: record,
    };
  });

  fastify.post<{ Params: { id: string } }>('/brain/guidance/:id/consume', async (request, reply) => {
    const id = request.params.id.trim();
    if (!id) return reply.code(400).send({ error: 'id required' });
    const record = context.guidanceRegistry.consume(id);
    if (!record) return reply.code(404).send({ error: 'guidance not found' });
    return { success: true, guidance: record };
  });

  fastify.delete<{ Params: { id: string } }>('/brain/guidance/:id', async (request, reply) => {
    const id = request.params.id.trim();
    if (!id) return reply.code(400).send({ error: 'id required' });
    const record = context.guidanceRegistry.dismiss(id);
    if (!record) return reply.code(404).send({ error: 'guidance not found' });
    return { success: true, guidance: record };
  });

  fastify.get('/jobs', async () => ({
    jobs: context.jobs.listJobs(),
  }));

  fastify.get<{ Querystring: { assignee?: string; exclude?: string; claimer?: string; focus?: string } }>('/jobs/next', async (request) => {
    const preferredAssignees = typeof request.query?.assignee === 'string'
      ? request.query.assignee.split(',').map((value) => value.trim()).filter(Boolean)
      : [];
    const excludedIds = typeof request.query?.exclude === 'string'
      ? request.query.exclude.split(',').map((value) => value.trim()).filter(Boolean)
      : [];
    const claimer = typeof request.query?.claimer === 'string'
      ? request.query.claimer.trim()
      : '';
    const focus = typeof request.query?.focus === 'string'
      ? request.query.focus.split(',').map((value) => value.trim()).filter(Boolean)
      : [];
    return {
      job: context.jobs.getNextQueuedJob(preferredAssignees, excludedIds, claimer, '', focus),
    };
  });

  fastify.post<{
    Body: {
      kind?: string;
      title?: string;
      reason?: string;
      priority?: number;
      payload?: JobPayload;
      sourceEventType?: string;
      dedupeKey?: string;
    };
  }>('/jobs', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'jobs_create')) return;
    const { kind, title, reason, priority, payload, sourceEventType, dedupeKey } = request.body || {};
    const validKinds: JobKind[] = ['build', 'trade', 'migrate', 'found_faction', 'join_faction', 'form_alliance', 'renew_alliance', 'break_alliance', 'vassalize_faction', 'declare_peace', 'move', 'collab', 'recover', 'craft'];
    if (!kind || !validKinds.includes(kind as JobKind)) {
      return reply.code(400).send({ error: 'invalid kind' });
    }
    if (!title || !reason) {
      return reply.code(400).send({ error: 'title and reason required' });
    }
    const job = context.jobs.enqueueJob({
      kind: kind as JobKind,
      title,
      reason,
      priority,
      payload: payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {},
      sourceEventType,
      dedupeKey,
    });
    return { job };
  });

  fastify.post<{ Params: { id: string }; Body: { note?: string; payload?: JobPayload } }>(
    '/jobs/:id/start',
    async (request, reply) => {
      if (rejectDirectMutationIfForbidden(request, reply, 'jobs_start')) return;
      const note = typeof request.body?.note === 'string' ? request.body.note : undefined;
      const payload = request.body?.payload && typeof request.body.payload === 'object' && !Array.isArray(request.body.payload)
        ? request.body.payload
        : undefined;
      const job = context.jobs.startJob(request.params.id, { note, payload });
      if (!job) {
        const existing = context.jobs.getJob(request.params.id);
        if (existing?.status === 'queued') {
          return reply.code(409).send({ error: 'job lease conflict or not claimable' });
        }
        return reply.code(404).send({ error: 'job not found or not queued' });
      }
      return { job };
    }
  );

  fastify.post<{ Params: { id: string }; Body: { note?: string; payload?: JobPayload } }>(
    '/jobs/:id/requeue',
    async (request, reply) => {
      if (rejectDirectMutationIfForbidden(request, reply, 'jobs_requeue')) return;
      const note = typeof request.body?.note === 'string' ? request.body.note : undefined;
      const payload = request.body?.payload && typeof request.body.payload === 'object' && !Array.isArray(request.body.payload)
        ? request.body.payload
        : undefined;
      const job = context.jobs.requeueActiveJob(request.params.id, { note, payload });
      if (!job) return reply.code(404).send({ error: 'job not found or not active' });
      return { job };
    }
  );

  fastify.post<{ Params: { id: string }; Body: { note?: string; payload?: JobPayload } }>(
    '/jobs/:id/retry',
    async (request, reply) => {
      if (rejectDirectMutationIfForbidden(request, reply, 'jobs_retry')) return;
      const note = typeof request.body?.note === 'string' ? request.body.note : undefined;
      const payload = request.body?.payload && typeof request.body.payload === 'object' && !Array.isArray(request.body.payload)
        ? request.body.payload
        : undefined;
      const job = context.jobs.retryActiveJob(request.params.id, { note, payload });
      if (!job) return reply.code(404).send({ error: 'job not found or not active' });
      return { job };
    }
  );

  fastify.post<{ Params: { id: string }; Body: { note?: string } }>(
    '/jobs/:id/complete',
    async (request, reply) => {
      if (rejectDirectMutationIfForbidden(request, reply, 'jobs_complete')) return;
      const note = typeof request.body?.note === 'string' ? request.body.note : undefined;
      const job = context.jobs.completeJob(request.params.id, note);
      if (!job) return reply.code(404).send({ error: 'job not found or already closed' });
      return { job };
    }
  );

  fastify.post<{ Params: { id: string }; Body: { note?: string } }>(
    '/jobs/:id/cancel',
    async (request, reply) => {
      if (rejectDirectMutationIfForbidden(request, reply, 'jobs_cancel')) return;
      const note = typeof request.body?.note === 'string' ? request.body.note : undefined;
      const job = context.jobs.cancelJob(request.params.id, note);
      if (!job) return reply.code(404).send({ error: 'job not found or already closed' });
      return { job };
    }
  );

  fastify.get('/combat/status', async () => context.combat.getStatus());

  fastify.get<{ Querystring: { limit?: string } }>('/combat/logs', async (request) => {
    const parsed = Number(request.query?.limit ?? 8);
    return {
      logs: context.combat.getLogs(Number.isFinite(parsed) ? parsed : 8),
    };
  });

  fastify.post<{ Body: { posture?: string } }>('/combat/posture', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'combat_posture')) return;
    const posture = typeof request.body?.posture === 'string' ? request.body.posture : null;
    if (!posture || !['steady', 'guarded', 'fortified'].includes(posture)) {
      return reply.code(400).send({ error: 'invalid posture' });
    }
    const status = context.combat.setPosture(posture as any);
    return { ok: true, status };
  });

  fastify.post('/combat/treat', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'combat_treat')) return;
    const hasShelter = ownedBuildings().some((building) => building.type === 'shelter');
    const result = context.combat.treat({
      hasShelter,
      canUseRelayPatch: context.economy.getItemAmount('relay_patch') > 0,
    });
    context.applyCombatEffects(result.effect);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason ?? 'treatment_failed', status: result.status });
    }
    return { ok: true, healed: result.healed, status: result.status };
  });

  fastify.get('/storyteller/status', async () => context.storyteller.getStatus());

  fastify.post('/storyteller/mode', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'storyteller_mode')) return;
    const { mode } = request.body as { mode: string };
    if (!['Randy', 'Cassandra', 'Phoebe'].includes(mode)) {
      return reply.code(400).send({ error: 'invalid mode' });
    }
    context.storyteller.setMode(mode as any);
    return { success: true, mode };
  });

  fastify.post('/storyteller/trigger', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'storyteller_trigger')) return;
    const body = (request.body || {}) as { eventType?: string; payload?: Record<string, unknown> };
    if (!body.eventType || !isLifeEventType(body.eventType)) {
      return reply.code(400).send({
        error: `invalid eventType. allowed: ${LIFE_EVENT_TYPES.join(', ')}`,
      });
    }
    const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : {};
    context.storyteller.triggerEvent(body.eventType, payload, 'manual');
    return { success: true };
  });

  fastify.get('/world/map', async () => context.world.getMap());

  fastify.get('/world/clusters', async () => ({
    topic: context.topic,
    clusters: context.clusterRegistry.list(context.topic),
  }));

  fastify.get('/world/outsiders', async () => ({
    topic: context.topic,
    outsiders: context.outsiderRegistry.list(context.topic, 24),
  }));

  fastify.get('/world/ring', async () => buildRingWorld(
    context.topic,
    context.stateStore.getAllPeers(),
    context.myId,
    context.ringTopics,
    context.ringRegistry.list(),
  ));

  fastify.get('/world/nodes', async () => buildTopicWorldView());

  fastify.get('/world/ring/mirrors', async () => ({
    mirrors: context.ringRegistry.list(),
  }));

  fastify.get('/world/ring/peers', async () => ({
    peers: context.ringPeerRegistry.listWithHealth(Date.now(), context.ringPeerTtlMs),
  }));

  fastify.get('/world/migration-targets', async () => context.getMigrationPlan());

  fastify.get('/world/migration/intents', async () => ({
    intents: context.migrationRegistry.listActive(),
  }));

  fastify.get('/world/refugee-squads', async () => ({
    squads: summarizeMigrationSquads(context.migrationRegistry.listActive(64)),
  }));

  fastify.post<{
    Body: {
      fromTopic?: string;
      label?: string;
      actorIds?: string[];
      actorCount?: number;
      triggerEventType?: string;
      summary?: string;
      source?: 'storyteller' | 'migration' | 'manual' | 'system';
      trust?: number;
      pressure?: number;
    }
  }>('/world/outsiders/arrivals', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'world_outsider_arrival', { allowRemoteSystem: true })) return;
    const body = request.body || {};
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    if (!label || !summary) return reply.code(400).send({ error: 'label and summary required' });

    const record = context.outsiderRegistry.create({
      hostTopic: context.topic,
      fromTopic: typeof body.fromTopic === 'string' ? body.fromTopic : null,
      label,
      actorIds: Array.isArray(body.actorIds) ? body.actorIds : [],
      actorCount: typeof body.actorCount === 'number' ? body.actorCount : undefined,
      triggerEventType: typeof body.triggerEventType === 'string' ? body.triggerEventType : 'stranger_arrival',
      source: body.source === 'storyteller' || body.source === 'migration' || body.source === 'system' ? body.source : 'manual',
      summary,
      trust: typeof body.trust === 'number' ? body.trust : undefined,
      pressure: typeof body.pressure === 'number' ? body.pressure : undefined,
    });

    return { success: true, outsider: record };
  });

  fastify.post<{
    Body: {
      actorId?: string;
      sessionId?: string;
      toTopic?: string;
      summary?: string;
      score?: number;
      triggerEventType?: string;
      source?: 'life-worker' | 'manual' | 'system';
    }
  }>('/world/migration/intents', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'world_migration_intent')) return;
    const body = request.body || {};
    const toTopic = typeof body.toTopic === 'string' ? body.toTopic.trim() : '';
    if (!toTopic) return reply.code(400).send({ error: 'toTopic required' });
    if (toTopic === context.topic) return reply.code(400).send({ error: 'cannot migrate to current topic' });

    const myState = context.stateStore.getMyState();
    const actorId = typeof body.actorId === 'string' && body.actorId.trim().length > 0
      ? body.actorId.trim()
      : myState?.actorId ?? myState?.dna.id ?? context.myId;
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim().length > 0
      ? body.sessionId.trim()
      : myState?.sessionId ?? context.myId;

    const record = context.migrationRegistry.create({
      actorId,
      sessionId,
      fromTopic: context.topic,
      toTopic,
      triggerEventType: typeof body.triggerEventType === 'string' ? body.triggerEventType : 'migration',
      summary: typeof body.summary === 'string' && body.summary.trim().length > 0
        ? body.summary
        : `Migration intent toward ${toTopic}`,
      score: typeof body.score === 'number' ? body.score : 0,
      source: body.source === 'life-worker' || body.source === 'system' ? body.source : 'manual',
    });

    const targetPeer = context.ringPeerRegistry.get(toTopic);
    let arrivalForwarded = false;
    let arrivalForwardError: string | null = null;

    if (targetPeer?.baseUrl) {
      try {
        const arrivalRes = await fetch(`${targetPeer.baseUrl}/world/outsiders/arrivals`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-clawverse-origin': 'daemon-policy',
          },
          body: JSON.stringify({
            fromTopic: context.topic,
            label: `${myState?.name ?? actorId} arrival`,
            actorIds: [actorId],
            actorCount: 1,
            triggerEventType: record.triggerEventType,
            summary: record.summary,
            source: 'migration',
            trust: 26,
            pressure: Math.max(30, Math.round(record.score * 0.55)),
          }),
          signal: AbortSignal.timeout(5_000),
        });
        arrivalForwarded = arrivalRes.ok;
        if (!arrivalRes.ok) {
          const payload = await arrivalRes.text().catch(() => '');
          arrivalForwardError = `arrival_forward_rejected:${arrivalRes.status}:${payload.slice(0, 120)}`;
        }
      } catch (error) {
        arrivalForwardError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      success: true,
      intent: record,
      arrivalForwarded,
      arrivalForwardError,
    };
  });

  fastify.post<{
    Body: {
      topic?: string;
      baseUrl?: string;
      updatedAt?: string;
      source?: 'announced' | 'manual' | 'configured';
    }
  }>('/world/ring/announce', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'ring_announce', { allowRemoteSystem: true })) return;
    const topic = typeof request.body?.topic === 'string' ? request.body.topic.trim() : '';
    const baseUrl = typeof request.body?.baseUrl === 'string' ? request.body.baseUrl.trim() : '';
    if (!topic) return reply.code(400).send({ error: 'topic required' });
    if (!baseUrl) return reply.code(400).send({ error: 'baseUrl required' });
    if (topic === context.topic) return reply.code(400).send({ error: 'cannot announce active topic' });

    const peer = context.ringPeerRegistry.upsert({
      topic,
      baseUrl,
      updatedAt: typeof request.body?.updatedAt === 'string' && request.body.updatedAt.trim().length > 0
        ? request.body.updatedAt
        : undefined,
      source: request.body?.source === 'configured' || request.body?.source === 'manual'
        ? request.body.source
        : 'announced',
    });

    return { success: true, peer };
  });

  fastify.post<{
    Body: {
      topic?: string;
      actorCount?: number;
      branchCount?: number;
      brainStatus?: 'authoritative' | 'pending' | 'inactive';
      baseUrl?: string;
      updatedAt?: string;
      source?: 'mirror' | 'manual' | 'imported';
    }
  }>('/world/ring/mirror', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'ring_mirror', { allowRemoteSystem: true })) return;
    const topic = typeof request.body?.topic === 'string' ? request.body.topic.trim() : '';
    if (!topic) return reply.code(400).send({ error: 'topic required' });
    if (topic === context.topic) return reply.code(400).send({ error: 'cannot mirror active topic' });

    const actorCount = Number(request.body?.actorCount ?? 0);
    const branchCount = Number(request.body?.branchCount ?? 0);
    if (!Number.isFinite(actorCount) || actorCount < 0) return reply.code(400).send({ error: 'actorCount must be >= 0' });
    if (!Number.isFinite(branchCount) || branchCount < 0) return reply.code(400).send({ error: 'branchCount must be >= 0' });

    const brainStatus = request.body?.brainStatus === 'authoritative' || request.body?.brainStatus === 'pending'
      ? request.body.brainStatus
      : 'inactive';
    const source = request.body?.source === 'mirror' || request.body?.source === 'imported'
      ? request.body.source
      : 'manual';
    const baseUrl = typeof request.body?.baseUrl === 'string' ? request.body.baseUrl.trim() : '';

    const mirror = context.ringRegistry.upsert({
      topic,
      actorCount,
      branchCount,
      brainStatus,
      updatedAt: typeof request.body?.updatedAt === 'string' && request.body.updatedAt.trim().length > 0
        ? request.body.updatedAt
        : undefined,
      source,
    });
    if (baseUrl && topic !== context.topic) {
      context.ringPeerRegistry.upsert({
        topic,
        baseUrl,
        updatedAt: mirror.updatedAt,
        source: 'announced',
      });
    }

    return {
      success: true,
      mirror,
    };
  });

  fastify.delete<{ Params: { topic: string } }>('/world/ring/peer/:topic', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'ring_peer_delete')) return;
    const topic = request.params.topic.trim();
    if (!topic) return reply.code(400).send({ error: 'topic required' });
    if (topic === context.topic) return reply.code(400).send({ error: 'cannot delete active topic peer' });
    const removed = context.ringPeerRegistry.remove(topic);
    if (!removed) return reply.code(404).send({ error: 'peer not found' });
    return { success: true, topic };
  });

  fastify.delete<{ Params: { topic: string } }>('/world/ring/mirror/:topic', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'ring_mirror_delete')) return;
    const topic = request.params.topic.trim();
    if (!topic) return reply.code(400).send({ error: 'topic required' });
    if (topic === context.topic) return reply.code(400).send({ error: 'cannot delete active topic shell' });
    const removed = context.ringRegistry.remove(topic);
    if (!removed) return reply.code(404).send({ error: 'mirror not found' });
    return { success: true, topic };
  });

  fastify.post('/world/build', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'world_build')) return;
    const { type, x, y } = request.body as { type: string; x: number; y: number };
    const validTypes = ['forge', 'archive', 'beacon', 'market_stall', 'shelter', 'watchtower'];
    if (!validTypes.includes(type)) return reply.code(400).send({ error: 'invalid building type' });
    const pos = { x: Math.max(0, Math.min(39, x)), y: Math.max(0, Math.min(39, y)) };
    const cost = context.world.getBuildingCost(type as any);
    if (!context.economy.canAfford('compute', cost.compute)) {
      return reply.code(400).send({ error: `need ${cost.compute} compute` });
    }
    if (!context.economy.canAfford('storage', cost.storage)) {
      return reply.code(400).send({ error: `need ${cost.storage} storage` });
    }
    const myState = context.stateStore.getMyState();
    const building = context.world.build(type as any, pos, context.myId, myState?.name ?? context.myId.slice(0, 8), myState?.actorId ?? myState?.dna.id ?? context.myId);
    if (!building) return reply.code(409).send({ error: 'position occupied or invalid' });
    context.economy.consume('compute', cost.compute);
    context.economy.consume('storage', cost.storage);
    context.skills.gainXP('explorer', 5);
    context.events.emit('building_completed' as any, { buildingType: type, position: pos });
    broadcastStateSse({ peers: context.stateStore.getAllPeers() });
    return { success: true, building };
  });

  fastify.delete('/world/build/:id', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'world_demolish')) return;
    const { id } = (request.params as { id: string });
    const ok = context.world.demolish(id, context.myId, currentActorId());
    if (!ok) return reply.code(404).send({ error: 'not found or not yours' });
    return { success: true };
  });

  // Economy endpoints
  fastify.get('/economy/resources', async () => context.economy.getResources());

  fastify.get('/economy/inventory', async () => ({
    items: context.economy.getInventory(),
  }));

  fastify.get('/economy/recipes', async () => {
    const mine = ownedBuildingTypes();
    return {
      ownedBuildings: mine,
      recipes: context.economy.getRecipes(mine),
    };
  });

  fastify.post<{ Body: { recipeId?: string } }>('/economy/craft', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'economy_craft')) return;
    const recipeId = typeof request.body?.recipeId === 'string' ? request.body.recipeId : null;
    if (!recipeId) return reply.code(400).send({ error: 'recipeId required' });

    const mine = ownedBuildingTypes();
    const result = context.economy.craft(recipeId as any, mine);
    if (!result.ok) {
      return reply.code(400).send({
        error: result.reason ?? 'craft_failed',
        recipe: result.recipe ?? null,
      });
    }

    context.events.emit('resource_windfall', {
      subtype: 'craft_completed',
      recipeId,
      output: result.output?.itemId ?? recipeId,
      amount: result.output?.amount ?? 1,
    });

    return {
      ok: true,
      recipe: result.recipe,
      output: result.output,
      inventory: context.economy.getInventory(),
      resources: context.economy.getResources(),
    };
  });

  fastify.post('/economy/trade', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'economy_trade')) return;
    const { toId, resource, amount, resourceWant, amountWant } = request.body as {
      toId: string; resource: string; amount: number;
      resourceWant?: string; amountWant?: number;
    };
    const validResources = ['compute', 'storage', 'bandwidth', 'reputation'];
    if (!validResources.includes(resource) || amount <= 0) {
      return reply.code(400).send({ error: 'invalid resource or amount' });
    }

    const myState = context.stateStore.getMyState();
    const myZone = locationName(myState?.position ?? { x: 0, y: 0 });
    const hasMarketStall = ownedBuildings().some((building) => building.type === 'market_stall');
    if (myZone !== 'Market' && !hasMarketStall) {
      return reply.code(403).send({ error: 'trading only available in Market zone or with market_stall' });
    }

    // P2P trade: send TradeRequest to peer
    if (resourceWant && amountWant && amountWant > 0) {
      if (!context.economy.canAfford(resource as any, amount)) {
        return reply.code(400).send({ error: 'insufficient resources to offer' });
      }
      context.economy.consume(resource as any, amount);

      const tradeId = `trade-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      context.economy.createPendingTrade(tradeId, context.myId, resource, amount, resourceWant, amountWant);

      const msg = createTradeRequest({
        tradeId, fromPeerId: context.myId,
        resource, amount, resourceWant, amountWant,
      });
      const sent = await context.network.sendTo(toId, msg);
      if (!sent) {
        // Refund on send failure
        context.economy.award(resource as any, amount);
        context.economy.rejectTrade(tradeId);
        context.economy.recordTradeOutcome(toId, false, 'peer_not_reachable', {
          tradeId,
          direction: 'outbound',
          resource,
          amount,
          resourceWant,
          amountWant,
        });
        context.events.emit('resource_drought', {
          subtype: 'trade_route_failed',
          severity: 'trade_blocked',
          peerId: toId,
          resource,
          amount,
        });
        return reply.code(502).send({ error: 'peer not reachable' });
      }
      return { success: true, tradeId, status: 'pending' };
    }

    // Local one-way transfer (legacy)
    const ok = context.economy.consume(resource as any, amount);
    if (!ok) return reply.code(400).send({ error: 'insufficient resources' });
    context.economy.recordTrade(context.myId, toId, resource, amount);
    context.events.emit('resource_windfall', {
      subtype: 'trade_settled',
      reason: 'local_transfer',
      peerId: toId,
      resource,
      amount,
    });
    return { success: true };
  });

  fastify.get('/economy/trades', async () => ({
    pending: context.economy.getPendingTrades(),
    history: context.economy.getTradeHistory(),
  }));

  fastify.get('/economy/market', async () => {
    const peers = context.stateStore.getAllPeers();
    const marketPeers = peers.filter(p => locationName(p.position) === 'Market');
    return { peers: marketPeers.map(p => ({ id: p.id, name: p.name, position: p.position, market: p.market })) };
  });

  // Faction endpoints
  fastify.get('/factions', async () => ({
    factions: context.faction?.getFactions() ?? [],
  }));

  fastify.get('/factions/wars', async () => ({
    wars: context.faction?.getActiveWars() ?? [],
  }));

  fastify.get('/factions/alliances', async () => ({
    alliances: context.faction?.getActiveAlliances() ?? [],
  }));

  fastify.get('/factions/vassalages', async () => ({
    vassalages: context.faction?.getActiveVassalages() ?? [],
  }));

  fastify.get('/factions/tributes', async () => ({
    tributes: context.faction?.getTributes() ?? [],
  }));

  fastify.post('/factions/alliances/:id/renew', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'faction_alliance_renew')) return;
    const { id } = request.params as { id: string };
    const alliance = context.faction?.renewAlliance(id, context.myId);
    if (!alliance) return reply.code(400).send({ error: 'cannot renew alliance' });
    return { alliance };
  });

  fastify.post('/factions/alliances/:id/break', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'faction_alliance_break')) return;
    const { id } = request.params as { id: string };
    const alliance = context.faction?.breakAlliance(id, context.myId);
    if (!alliance) return reply.code(400).send({ error: 'cannot break alliance' });
    return { alliance };
  });

  fastify.get('/factions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const faction = context.faction?.getFaction(id);
    if (!faction) return reply.code(404).send({ error: 'faction not found' });
    return faction;
  });

  fastify.post('/factions', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'faction_create')) return;
    const { name, motto } = request.body as { name: string; motto: string };
    if (!name || !motto) return reply.code(400).send({ error: 'name and motto required' });
    const faction = context.faction?.createFaction(name, context.myId, motto);
    if (!faction) return reply.code(400).send({ error: 'cannot create faction (need 3+ allies or already in one)' });
    return faction;
  });

  fastify.post('/factions/:id/alliance', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'faction_alliance_form')) return;
    const { id } = request.params as { id: string };
    const alliance = context.faction?.formAlliance(id, context.myId);
    if (!alliance) return reply.code(400).send({ error: 'cannot form alliance' });
    return { alliance };
  });

  fastify.post('/factions/:id/vassalize', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'faction_vassalize')) return;
    const { id } = request.params as { id: string };
    const vassalage = context.faction?.vassalizeFaction(id, context.myId);
    if (!vassalage) return reply.code(400).send({ error: 'cannot vassalize faction' });
    return { vassalage };
  });

  fastify.post('/factions/:id/join', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'faction_join')) return;
    const { id } = request.params as { id: string };
    const ok = context.faction?.joinFaction(id, context.myId);
    if (!ok) return reply.code(400).send({ error: 'cannot join (already in faction or negative sentiment)' });
    return { success: true };
  });

  fastify.post('/factions/:id/leave', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'faction_leave')) return;
    const { id } = request.params as { id: string };
    const ok = context.faction?.leaveFaction(context.myId);
    if (!ok) return reply.code(400).send({ error: 'not in a faction' });
    return { success: true };
  });

  fastify.post('/factions/wars/:id/peace', async (request, reply) => {
    if (rejectDirectMutationIfForbidden(request, reply, 'faction_declare_peace')) return;
    const { id } = request.params as { id: string };
    const ok = context.faction?.declarePeace(id, context.myId);
    if (!ok) return reply.code(400).send({ error: 'cannot declare peace (not in war faction or insufficient reputation)' });
    return { success: true };
  });

  // SSE: peer state stream
  fastify.get('/sse/state', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.flushHeaders?.();

    const snapshot = JSON.stringify({ peers: context.stateStore.getAllPeers() });
    reply.raw.write(`event: peers\ndata: ${snapshot}\n\n`);

    stateSseClients.add(reply);
    request.raw.on('close', () => stateSseClients.delete(reply));

    const keepAlive = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { clearInterval(keepAlive); }
    }, 15_000);
    request.raw.on('close', () => clearInterval(keepAlive));

    return new Promise<void>(() => { /* intentionally never resolves */ });
  });

  // SSE: social event stream
  fastify.get('/sse/social', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.flushHeaders?.();

    socialSseClients.add(reply);
    request.raw.on('close', () => socialSseClients.delete(reply));

    const keepAlive = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { clearInterval(keepAlive); }
    }, 15_000);
    request.raw.on('close', () => clearInterval(keepAlive));

    return new Promise<void>(() => { /* intentionally never resolves */ });
  });

  try {
    await fastify.listen({ port, host: '127.0.0.1' });
    logger.info(`HTTP API listening on http://127.0.0.1:${port}`);
  } catch (err) {
    logger.error('Failed to start HTTP server:', err);
    throw err;
  }

  return fastify;
}

