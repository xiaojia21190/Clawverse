#!/usr/bin/env node

import { loadConfig } from './config.js';
import { logger, setLogLevel } from './logger.js';
import { BioMonitor } from './bio.js';
import { ClawverseNetwork } from './network.js';
import { StateStore } from './state.js';
import { createHttpServer, broadcastStateSse } from './http.js';
import { createHeartbeat, createYjsSync, createAnnounce, createTaskRequest, createTaskResult, createTradeResult } from '@clawverse/protocol';
import { BuildingType, Mood, ModelTrait, Position } from '@clawverse/types';
import { EvolutionEpisodeLogger } from './evolution.js';
import { loadSecurityConfig, validateSecurityConfig } from './security.js';
import { computeHardwareHash, generateDNAFromHashes, generateDNA, dnaToName } from './dna.js';
import { SocialSystem } from './social.js';
import { CollabSystem } from './collab.js';
import { NeedsSystem, NeedKey } from './needs.js';
import { SkillsTracker } from './skills.js';
import { EventEngine } from './events.js';
import { EconomySystem } from './economy.js';
import { scoreTopicClusters } from './cluster-scorer.js';
import { ClusterRegistry } from './cluster-registry.js';
import { OutsiderRegistry } from './outsider-registry.js';
import { MigrationRegistry } from './migration-registry.js';
import { planMigration } from './migration-planner.js';
import { MIGRATION_AUTONOMY_KEYS, planMigrationAutonomy } from './migration-autonomy-planner.js';
import { BrainGuidanceRegistry } from './brain-guidance-registry.js';
import { WorkerHeartbeatRegistry } from './worker-heartbeat.js';
import { RingMirrorRegistry } from './ring-registry.js';
import { RingMirrorPusher } from './ring-push.js';
import { RingPeerRegistry } from './ring-peer-registry.js';
import { RingMirrorSyncer } from './ring-sync.js';
import { buildTopicWorld } from './world-topology.js';
import { WorldMap } from './world.js';
import { Storyteller } from './storyteller.js';
import { FactionSystem } from './faction.js';
import { JobsSystem } from './jobs.js';
import type { JobKind, JobPayload } from './jobs.js';
import { CombatSystem, CombatTickEffect, CombatResourceKey } from './combat.js';
import { planWartimeResponse, summarizeWartimeResponse, WARTIME_RESPONSE_KEYS } from './wartime-response.js';
import { ECONOMIC_AUTONOMY_KEYS, planEconomicAutonomy } from './economic-planner.js';
import { DIPLOMACY_AUTONOMY_KEYS, planDiplomaticAutonomy } from './diplomacy-planner.js';
import { planAutonomyIntents, toAutonomyIntentSnapshots } from './autonomy-intent.js';
import type { AutonomyIntentSnapshot } from './autonomy-intent.js';
import { FACTION_AUTONOMY_KEYS, planFactionAutonomy } from './faction-planner.js';
import { ALLIANCE_AUTONOMY_KEYS, planAllianceAutonomy } from './alliance-planner.js';
import { planVassalAutonomy, VASSAL_AUTONOMY_KEYS } from './vassal-planner.js';
import { createDormantGovernorState, planStrategicGovernor } from './governor-planner.js';
import type { StrategicLane, StrategicGovernorState } from './governor-planner.js';
import { AUTONOMY_CONTRACT } from './autonomy-contract.js';
import { chooseEvolutionPolicyAction } from './evolution-policy.js';
import type { EvolutionPolicyStatus } from './evolution-policy.js';
import { getDefaultSqlitePath } from './sqlite.js';

const config = loadConfig();
const securityConfig = loadSecurityConfig();
const securityValidation = validateSecurityConfig(securityConfig);

if (config.debug) {
  setLogLevel('debug');
}

if (!securityValidation.ok) {
  for (const err of securityValidation.errors) {
    logger.error(`[SECURITY] ${err}`);
  }
  process.exit(1);
}

logger.info('========================================');
logger.info('   Clawverse Daemon v0.2.0');
logger.info('========================================');
logger.info(`Topic: ${config.topic}`);
logger.info(`Ring Topics: ${config.ring.topics.join(', ')}`);
logger.info(`HTTP Port: ${config.port}`);
logger.info(`Heartbeat Interval: ${config.heartbeatInterval}ms`);
logger.info(`Security Mode: ${securityValidation.mode}`);
for (const warn of securityValidation.warnings) {
  logger.warn(`[SECURITY] ${warn}`);
}
logger.info(`Evolution Logging: ${config.evolution.enabled ? 'on' : 'off'} (${config.evolution.variant})`);
logger.info(`Autonomy Orchestration: ${config.autonomy.orchestrationMode}`);
const snapshotPath = process.env.CLAWVERSE_STATE_SNAPSHOT_PATH || 'data/state/latest.json';
const snapshotEvery = Number(process.env.CLAWVERSE_STATE_SNAPSHOT_EVERY || 30);
const sqlitePath = getDefaultSqlitePath();
logger.info(`SQLite Path: ${sqlitePath}`);
logger.info(`State Snapshot Key: ${snapshotPath} (every ${snapshotEvery}s)`);
logger.info('');

const episodeLogger = config.evolution.enabled
  ? new EvolutionEpisodeLogger({
      variant: config.evolution.variant,
      flushEvery: config.evolution.flushEvery,
      dbPath: sqlitePath,
    })
  : null;

if (episodeLogger) {
  logger.info(`Episodes Path: ${episodeLogger.getPath()}`);
  logger.info(`Heartbeat Sampling: 1/${Math.max(1, config.evolution.heartbeatSampleEvery)}`);
}

let heartbeatTick = 0;
let distressedTicks = 0;
let lowComputeAlerted = false;
let highStorageAlerted = false;
let heartbeatRunning = false;
let evolutionPolicyRunning = false;
let lastWartimeResponseSignature = '';
let coordinationState: StrategicGovernorState = createDormantGovernorState();
let latestAutonomyIntents: AutonomyIntentSnapshot[] = [];
let lastClusterMigrationSignature = '';
const evolutionPolicyEnabled = config.evolution.enabled && config.evolution.autopilot.enabled;
const evolutionPolicyIntervalMs = config.evolution.autopilot.intervalMs;
const autonomyOrchestrationMode = config.autonomy.orchestrationMode;
const lifeWorkerHeartbeatTtlMs = Math.max(
  30_000,
  Number(process.env.CLAWVERSE_LIFE_WORKER_HEARTBEAT_TTL_MS || 210_000),
);

// Initialize State Store
const stateStore = new StateStore({ dbPath: sqlitePath });
stateStore.loadSnapshot(snapshotPath);

// Initialize Bio-Monitor
const bioMonitor = new BioMonitor(config.heartbeatInterval);
await bioMonitor.start();

// Generate DNA from hardware info (stable identity)
const initialMetrics = bioMonitor.getMetrics()!;
const hardwareHash = computeHardwareHash(initialMetrics);
let myDna = generateDNA(initialMetrics);
let myName = dnaToName(myDna);
logger.info(`Identity: ${myName} | ${myDna.archetype} (${myDna.appearance.form}) | DNA: ${myDna.id}`);
logger.info('');

// Initialize Network
const network = new ClawverseNetwork(config.topic);
const myId = await network.start();

// Set my ID and structural state (DNA, name, spawn position)
stateStore.setMyId(myId);
const initialSpawn = deriveSpawnPosition(config.topic, myDna.id);
stateStore.updateMyStructure({
  dna: myDna,
  name: myName,
  position: initialSpawn,
  actorId: myDna.id,
  sessionId: myId,
  spawnDistrict: spawnDistrictName(initialSpawn),
});
logger.info(`[spawn] ${myName} enters ${spawnDistrictName(initialSpawn)} at (${initialSpawn.x},${initialSpawn.y})`);

// Initialize Social System (pending queue mode, resolved by OpenClaw connector-skill)
const social = new SocialSystem({ dbPath: sqlitePath });
social.init({
  myId,
  getPeers: () => stateStore.getAllPeers(),
  getMyState: () => stateStore.getMyState(),
});

// Initialize Collab System
const collab = new CollabSystem({ dbPath: sqlitePath });
collab.init({
  onSubmit: async (task) => {
    const myState = stateStore.getMyState();
    const msg = createTaskRequest({
      taskId: task.id,
      fromPeerId: myId,
      fromName: myState?.name ?? myId.slice(0, 8),
      context: task.context,
      question: task.question,
    });
    const sent = await network.sendTo(task.from, msg);
    if (!sent) {
      logger.warn(`[collab] Failed to send TaskRequest to ${task.from}`);
    }
    return sent;
  },
  sendResult: async (toPeerId, taskId, result, success) => {
    const msg = createTaskResult({ taskId, success, result });
    const sent = await network.sendTo(toPeerId, msg);
    if (!sent) {
      logger.warn(`[collab] Failed to send TaskResult to ${toPeerId}`);
    }
  },
});

// Initialize Life Systems
const needs  = new NeedsSystem(config.heartbeatInterval, { dbPath: sqlitePath });
const skills = new SkillsTracker({ dbPath: sqlitePath });
const events = new EventEngine({ dbPath: sqlitePath });
const economy = new EconomySystem({ dbPath: sqlitePath });
const clusterRegistry = new ClusterRegistry({ dbPath: sqlitePath });
const outsiderRegistry = new OutsiderRegistry({ dbPath: sqlitePath });
const migrationRegistry = new MigrationRegistry({ dbPath: sqlitePath });
const guidanceRegistry = new BrainGuidanceRegistry({ dbPath: sqlitePath });
const workerHeartbeatRegistry = new WorkerHeartbeatRegistry();
const ringRegistry = new RingMirrorRegistry({ dbPath: sqlitePath });
const ringPeerRegistry = new RingPeerRegistry({ dbPath: sqlitePath });
const configuredRingSources = config.ring.mirrorSources;
const configuredRingTargets = config.ring.mirrorTargets;
const dynamicRingPeers = () => ringPeerRegistry
  .listWithHealth(Date.now(), config.ring.peerTtlMs)
  .filter((peer) => peer.health !== 'expired');
const ringSyncer = new RingMirrorSyncer({
  currentTopic: config.topic,
  sources: () => [
    ...configuredRingSources,
    ...dynamicRingPeers().map((peer) => ({ topic: peer.topic, baseUrl: peer.baseUrl })),
  ],
  registry: ringRegistry,
  intervalMs: config.ring.mirrorPollMs,
});
const ringPusher = new RingMirrorPusher({
  targets: () => [
    ...configuredRingTargets,
    ...dynamicRingPeers().map((peer) => ({ baseUrl: peer.baseUrl })),
  ],
  intervalMs: config.ring.mirrorPushMs,
  payload: () => {
    const world = buildTopicWorld(
      config.topic,
      stateStore.getAllPeers(),
      myId,
      config.ring.topics,
      ringRegistry.list(),
    ).world;
    return {
      topic: config.topic,
      baseUrl: config.ring.selfBaseUrl,
      actorCount: world.population.actorCount,
      branchCount: world.population.branchCount,
      brainStatus: world.brain.status,
      updatedAt: new Date().toISOString(),
      source: 'imported' as const,
    };
  },
});
const world = new WorldMap({ dbPath: sqlitePath });
world.attachYjs(stateStore.getBuildingsMap());
const faction = new FactionSystem(social, economy, events, {
  dbPath: sqlitePath,
  resolveActorId: (id: string) => {
    const direct = stateStore.getPeerState(id);
    if (direct?.actorId) return direct.actorId;
    const peer = stateStore.getAllPeers().find((item) => item.id === id || item.sessionId === id || item.actorId === id || item.dna.id === id);
    return peer?.actorId ?? peer?.dna.id ?? id;
  },
  resolveSessionId: (actorId: string) => {
    const direct = stateStore.getPeerState(actorId);
    if (direct?.sessionId) return direct.sessionId;
    const peer = stateStore.getAllPeers().find((item) => item.actorId === actorId || item.dna.id === actorId);
    return peer?.sessionId ?? peer?.id ?? null;
  },
});
const storyteller = new Storyteller(events, stateStore, social, needs, economy, faction);
const jobs = new JobsSystem({
  dbPath: sqlitePath,
  budgetSnapshot: () => ({
    resources: economy.getResources(),
    items: Object.fromEntries(
      economy.getInventory().map((entry) => [entry.itemId, entry.amount]),
    ),
  }),
});
const combat = new CombatSystem({ dbPath: sqlitePath });
events.start();
storyteller.start();

events.onEvent((event) => {
  if (event.type === 'stranger_arrival') {
    outsiderRegistry.create({
      hostTopic: config.topic,
      fromTopic: typeof event.payload.fromTopic === 'string' ? event.payload.fromTopic : null,
      label: String(event.payload.label ?? 'Unknown outsiders'),
      actorIds: Array.isArray(event.payload.actorIds)
        ? event.payload.actorIds.filter((value): value is string => typeof value === 'string')
        : [],
      actorCount: typeof event.payload.actorCount === 'number' ? event.payload.actorCount : undefined,
      triggerEventType: event.type,
      source: 'storyteller',
      summary: String(event.payload.description ?? event.payload.triggered_by ?? 'New outsiders are being observed near the settlement.'),
      trust: 28,
      pressure: 44,
    });
  }

  if (event.type === 'great_migration') {
    outsiderRegistry.create({
      hostTopic: config.topic,
      fromTopic: typeof event.payload.fromTopic === 'string' ? event.payload.fromTopic : 'unknown-ring',
      label: String(event.payload.label ?? 'Refugee squad'),
      actorCount: typeof event.payload.actorCount === 'number' ? event.payload.actorCount : 3,
      triggerEventType: event.type,
      source: 'storyteller',
      summary: String(event.payload.description ?? 'A refugee squad is approaching under migration pressure.'),
      trust: 22,
      pressure: 58,
    });
  }
});

// Broadcast latest DNA announce to all connected peers
async function rebroadcastAnnounce(): Promise<void> {
  const peers = network.getPeers();
  if (peers.length === 0) return;
  const msg = createAnnounce({
    peerId: myId,
    dna: {
      id: myDna.id,
      name: myName,
      persona: myDna.persona,
      archetype: myDna.archetype,
      modelTrait: myDna.modelTrait,
      badges: myDna.badges,
      appearance: myDna.appearance,
    },
  });
  await Promise.allSettled(peers.map((p) => network.sendTo(p.id, msg)));
}

// Handle soul update from OpenClaw soul-worker
async function onSoulUpdate(soul: { soulHash: string; modelTrait?: ModelTrait; badges?: string[] }): Promise<void> {
  myDna = generateDNAFromHashes(hardwareHash, initialMetrics, soul.soulHash, {
    modelTrait: soul.modelTrait,
    badges: soul.badges,
  });
  myName = dnaToName(myDna);
  stateStore.updateMyStructure({ dna: myDna, name: myName });
  logger.info(`[DNA] Soul enriched -> ${myName} | modelTrait: ${myDna.modelTrait} | badges: [${myDna.badges.join(', ')}]`);
  await rebroadcastAnnounce();
  broadcastStateSse({ peers: stateStore.getAllPeers() });
}

function locationName(pos: Position): string {
  if (pos.x < 10 && pos.y < 10) return 'Plaza';
  if (pos.x >= 10 && pos.x < 20 && pos.y < 10) return 'Market';
  if (pos.x < 10 && pos.y >= 10 && pos.y < 20) return 'Library';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 10 && pos.y < 20) return 'Workshop';
  if (pos.x < 10 && pos.y >= 20 && pos.y < 30) return 'Park';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 20 && pos.y < 30) return 'Tavern';
  return 'Residential';
}

function canAffordBuilding(type: BuildingType): boolean {
  const cost = world.getBuildingCost(type);
  const resources = economy.getResources();
  return resources.compute >= cost.compute && resources.storage >= cost.storage;
}

function myActorId(): string {
  const myState = stateStore.getMyState();
  return myState?.actorId ?? myState?.dna.id ?? myDna.id ?? myId;
}

function getOwnedBuildingTypes(): BuildingType[] {
  return world.getOwnedBuildings(myId, myActorId())
    .map((building) => building.type as BuildingType);
}

function canCraftRecipe(recipeId: 'data_shard' | 'alloy_frame' | 'relay_patch'): boolean {
  return economy.getRecipes(getOwnedBuildingTypes()).some((recipe) => recipe.id === recipeId && recipe.craftable);
}

function currentMarketResources() {
  const resources = economy.getResources();
  return {
    compute: resources.compute,
    storage: resources.storage,
    bandwidth: resources.bandwidth,
    reputation: resources.reputation,
  };
}

function currentMarketInventory() {
  return {
    dataShard: economy.getItemAmount('data_shard'),
    alloyFrame: economy.getItemAmount('alloy_frame'),
    relayPatch: economy.getItemAmount('relay_patch'),
  };
}

function currentMarketProfile() {
  return {
    resources: currentMarketResources(),
    inventory: currentMarketInventory(),
    updatedAt: new Date().toISOString(),
  };
}

function heartbeatMarketProfile() {
  return {
    resources: currentMarketResources(),
    inventory: currentMarketInventory(),
    updatedAtMs: Date.now(),
  };
}

function marketProfileFromHeartbeat(market?: {
  resources?: Partial<Record<'compute' | 'storage' | 'bandwidth' | 'reputation', number>>;
  inventory?: Partial<Record<'dataShard' | 'alloyFrame' | 'relayPatch', number>>;
  updatedAtMs?: number | null;
}) {
  if (!market) return undefined;
  return {
    resources: market.resources ? { ...market.resources } : undefined,
    inventory: market.inventory ? { ...market.inventory } : undefined,
    updatedAt: new Date(typeof market.updatedAtMs === 'number' ? market.updatedAtMs : Date.now()).toISOString(),
  };
}

function applyCombatEffects(effects: CombatTickEffect): void {
  let changed = false;
  const myFaction = faction.getMyFaction(myId);

  for (const [resource, amount] of Object.entries(effects.resourceLosses)) {
    const key = resource as CombatResourceKey;
    const loss = Math.max(0, Math.round(Number(amount)));
    const available = Math.floor(economy.getResources()[key]);
    const applied = Math.min(available, loss);
    if (applied > 0 && economy.consume(key, applied)) changed = true;
  }

  for (const [resource, amount] of Object.entries(effects.resourceAwards)) {
    const key = resource as CombatResourceKey;
    const award = Math.max(0, Math.round(Number(amount)));
    if (award > 0) {
      economy.award(key, award);
      changed = true;
    }
  }

  for (const emitted of effects.emitted) {
    const payload = emitted.type === 'death' && myFaction
      ? { ...emitted.payload, factionId: myFaction.id, factionName: myFaction.name, founderId: myFaction.founderId }
      : emitted.payload;
    events.emit(emitted.type, payload);
    changed = true;
  }

  if (changed) {
    faction.refreshStrategicState();
  }
}

function desiredPostureForCombat(state: ReturnType<typeof combat.getStatus>): 'steady' | 'guarded' | 'fortified' | null {
  const activeRaid = state.activeRaid;
  if (activeRaid) {
    return activeRaid.recommendedPosture ?? (state.raidRisk >= 80 ? 'fortified' : 'guarded');
  }

  if (state.raidRisk >= 72) return 'guarded';
  if (state.raidRisk <= 30 && state.status === 'stable') return 'steady';
  return null;
}

function clampJobPriority(priority: number): number {
  if (!Number.isFinite(priority)) return 50;
  return Math.max(0, Math.min(100, Math.round(priority)));
}

interface EnqueueAutonomyDutyOptions {
  rank?: number;
  score?: number;
  finalPriority?: number;
  reasons?: string[];
}

function enqueueAutonomyDuty(
  lane: StrategicLane,
  duty: {
    kind: JobKind;
    title: string;
    reason: string;
    priority: number;
    payload: JobPayload;
    sourceEventType: string;
    dedupeKey: string;
  },
  options?: EnqueueAutonomyDutyOptions,
): void {
  const planStep = coordinationState.plan.find((step) => step.lane === lane);
  const laneOrderIndex = coordinationState.laneOrder.indexOf(lane);
  const strategicStep = planStep?.step ?? (laneOrderIndex >= 0 ? laneOrderIndex + 1 : undefined);
  const strategicHorizon = planStep?.horizon ?? (
    laneOrderIndex < 0
      ? undefined
      : laneOrderIndex === 0
        ? 'now'
        : laneOrderIndex === 1
          ? 'next'
        : 'later'
  );
  const prioritized = typeof options?.finalPriority === 'number'
    ? clampJobPriority(options.finalPriority)
    : clampJobPriority(duty.priority);
  jobs.enqueueJob({
    kind: duty.kind,
    title: duty.title,
    reason: duty.reason,
    priority: prioritized,
    payload: {
      ...duty.payload,
      autonomyModel: AUTONOMY_CONTRACT.actorAutonomy,
      autonomyGovernance: AUTONOMY_CONTRACT.worldGovernance,
      autonomyLeaderAuthority: AUTONOMY_CONTRACT.leaderAuthority,
      autonomyMutationBoundary: AUTONOMY_CONTRACT.worldMutationAccess,
      autonomyLane: lane,
      autonomyMode: coordinationState.mode,
      autonomyAuthority: 'emergent-role-autonomy',
      autonomyPlanId: coordinationState.planId,
      ...(typeof strategicStep === 'number' ? { autonomyStep: strategicStep } : {}),
      ...(strategicHorizon ? { autonomyHorizon: strategicHorizon } : {}),
      autonomyObjective: planStep?.objective ?? coordinationState.objective,
      autonomyReason: planStep?.reason ?? duty.reason,
      autonomySummary: coordinationState.summary,
      autonomyPressure: coordinationState.pressure,
      autonomyConfidence: coordinationState.confidence,
      strategicLane: lane,
      strategicMode: coordinationState.mode,
      strategicAuthority: 'emergent-role-autonomy',
      strategicPlanId: coordinationState.planId,
      ...(typeof strategicStep === 'number' ? { strategicStep } : {}),
      ...(strategicHorizon ? { strategicHorizon } : {}),
      strategicObjective: planStep?.objective ?? coordinationState.objective,
      strategicReason: planStep?.reason ?? duty.reason,
      strategicSummary: coordinationState.summary,
      strategicPressure: coordinationState.pressure,
      strategicConfidence: coordinationState.confidence,
      ...(typeof options?.rank === 'number' ? { autonomyIntentRank: options.rank } : {}),
      ...(typeof options?.score === 'number' ? { autonomyIntentScore: clampJobPriority(options.score) } : {}),
      ...(Array.isArray(options?.reasons) && options.reasons.length > 0
        ? { autonomyIntentReasons: options.reasons.slice(0, 6) }
        : {}),
      ...(typeof options?.rank === 'number' ? { strategicIntentRank: options.rank } : {}),
      ...(typeof options?.score === 'number' ? { strategicIntentScore: clampJobPriority(options.score) } : {}),
      ...(Array.isArray(options?.reasons) && options.reasons.length > 0
        ? { strategicIntentReasons: options.reasons.slice(0, 6) }
        : {}),
    },
    sourceEventType: duty.sourceEventType,
    dedupeKey: duty.dedupeKey,
  });
}

function reconcileAutonomyJobs(): void {
  const needState = needs.getNeeds();
  const resources = economy.getResources();
  const myState = stateStore.getMyState();
  const zone = locationName(myState?.position ?? { x: 0, y: 0 });
  const myFaction = faction.getMyFaction(myId);
  const activeWars = faction.getActiveWars();
  const activeAlliances = faction.getActiveAlliances();
  const activeVassalages = faction.getActiveVassalages();
  const factionsSnapshot = faction.getFactions();
  const activeWar = myFaction
    ? activeWars.find((war) => war.factionA === myFaction.id || war.factionB === myFaction.id)
    : undefined;
  const ownedBuildings = getOwnedBuildingTypes();
  const dataShards = economy.getItemAmount('data_shard');
  const alloyFrames = economy.getItemAmount('alloy_frame');
  const relayPatches = economy.getItemAmount('relay_patch');
  const combatState = combat.getStatus();
  const activeRaid = combatState.activeRaid;
  const desiredPosture = desiredPostureForCombat(combatState);
  const relationships = social.getAllRelationships();

  coordinationState = planStrategicGovernor({
    resources,
    needs: needState,
    combat: combatState,
    zone,
    hasFaction: !!myFaction,
    activeWar: !!activeWar,
    activeRaid: !!activeRaid,
    activeAllianceCount: activeAlliances.length,
    activeVassalCount: activeVassalages.length,
    knownPeerCount: stateStore.getPeerCount(),
    allyCount: relationships.filter((relation) => relation.tier === 'ally').length,
    friendCount: relationships.filter((relation) => relation.tier === 'friend').length,
    myFactionStage: myFaction?.strategic.stage,
    myFactionPressure: myFaction?.strategic.pressure,
    myFactionCohesion: myFaction?.strategic.cohesion,
    myFactionProsperity: myFaction?.strategic.prosperity,
    myFactionInfluence: myFaction?.strategic.influence,
    myFactionAgenda: myFaction?.strategic.agenda,
  });

  if (desiredPosture && combatState.posture !== desiredPosture) {
    combat.setPosture(desiredPosture);
    events.emit('combat_report', {
      subtype: 'autonomy_posture',
      posture: desiredPosture,
      raidSource: activeRaid?.source ?? null,
      objective: activeRaid?.objective ?? null,
      summary: `Autonomy shifts defense posture to ${desiredPosture} for ${String(activeRaid?.objective ?? 'elevated threat pressure')}.`,
    });
  }

  guidanceRegistry.pruneExpired(Date.now());
  const activeGuidance = guidanceRegistry.listActive(16, Date.now());

  const wartimeDuties = planWartimeResponse({
    activeRaid,
    combatState,
    resources,
    ownedBuildings,
    relayPatches,
    dataShards,
    alloyFrames,
    activeWar: !!activeWar,
    canAffordBuilding,
    canCraftRecipe,
  });
  const wartimeKeys = new Set(wartimeDuties.map((duty) => duty.dedupeKey));
  for (const dedupeKey of WARTIME_RESPONSE_KEYS) {
    if (!wartimeKeys.has(dedupeKey)) {
      jobs.cancelQueuedByDedupeKey(dedupeKey, 'Wartime duty stood down.');
    }
  }

  const wartimeSignature = activeRaid
    ? activeRaid.id + ':' + wartimeDuties.map((duty) => duty.dedupeKey).sort().join('|')
    : '';
  if (wartimeSignature && wartimeSignature !== lastWartimeResponseSignature) {
    events.emit('combat_report', {
      subtype: 'autonomy_response_squad',
      raidSource: activeRaid?.source ?? null,
      objective: activeRaid?.objective ?? null,
      roles: Array.from(new Set(wartimeDuties.map((duty) => duty.role))),
      duties: wartimeDuties.map((duty) => ({
        role: duty.role,
        duty: duty.duty,
        kind: duty.kind,
        title: duty.title,
      })),
      summary: summarizeWartimeResponse(wartimeDuties),
    });
  }
  lastWartimeResponseSignature = wartimeSignature;

  const economicDuties = planEconomicAutonomy({
    needs: { social: needState.social, tasked: needState.tasked, creative: needState.creative },
    resources,
    zone,
    hasTradeAccess: isInMarketZone(myState?.position) || hasOwnedBuilding('market_stall'),
    ownedBuildings,
    relayPatches,
    dataShards,
    alloyFrames,
    activeWar: !!activeWar,
    activeRaid: !!activeRaid,
    raidRisk: combatState.raidRisk,
    knownPeerCount: stateStore.getPeerCount(),
    canAffordBuilding,
    canCraftRecipe,
  });
  const economicKeys = new Set(economicDuties.map((duty) => duty.dedupeKey));
  for (const dedupeKey of ECONOMIC_AUTONOMY_KEYS) {
    if (!economicKeys.has(dedupeKey)) {
      jobs.cancelQueuedByDedupeKey(dedupeKey, 'Economic planner stood down.');
    }
  }

  const diplomacyDuties = planDiplomaticAutonomy({
    resources,
    activeWarId: activeWar?.id,
    activeRaid: !!activeRaid,
    factionStage: myFaction?.strategic.stage,
    factionPressure: myFaction?.strategic.pressure,
    factionCohesion: myFaction?.strategic.cohesion,
  });
  const diplomacyKeys = new Set(diplomacyDuties.map((duty) => duty.dedupeKey));
  for (const dedupeKey of DIPLOMACY_AUTONOMY_KEYS) {
    if (!diplomacyKeys.has(dedupeKey)) {
      jobs.cancelQueuedByDedupeKey(dedupeKey, 'Diplomacy planner stood down.');
    }
  }

  const allianceDuties = planAllianceAutonomy({
    resources,
    myFactionId: myFaction?.id,
    hasFaction: !!myFaction,
    activeWar: !!activeWar,
    activeRaid: !!activeRaid,
    myFactionStage: myFaction?.strategic.stage,
    myFactionPressure: myFaction?.strategic.pressure,
    myFactionCohesion: myFaction?.strategic.cohesion,
    myFactionProsperity: myFaction?.strategic.prosperity,
    myFactionAgenda: myFaction?.strategic.agenda,
    factions: factionsSnapshot,
    activeAlliances,
    activeWars,
  });
  const allianceKeys = new Set(allianceDuties.map((duty) => duty.dedupeKey));
  for (const dedupeKey of ALLIANCE_AUTONOMY_KEYS) {
    if (!allianceKeys.has(dedupeKey)) {
      jobs.cancelQueuedByDedupeKey(dedupeKey, 'Alliance planner stood down.');
    }
  }

  const vassalDuties = planVassalAutonomy({
    resources,
    myFactionId: myFaction?.id,
    hasFaction: !!myFaction,
    activeWar: !!activeWar,
    activeRaid: !!activeRaid,
    myFactionStage: myFaction?.strategic.stage,
    myFactionPressure: myFaction?.strategic.pressure,
    myFactionCohesion: myFaction?.strategic.cohesion,
    myFactionProsperity: myFaction?.strategic.prosperity,
    myFactionInfluence: myFaction?.strategic.influence,
    myFactionAgenda: myFaction?.strategic.agenda,
    factions: factionsSnapshot,
    activeAlliances,
    activeWars,
    activeVassalages,
  });
  const vassalKeys = new Set(vassalDuties.map((duty) => duty.dedupeKey));
  for (const dedupeKey of VASSAL_AUTONOMY_KEYS) {
    if (!vassalKeys.has(dedupeKey)) {
      jobs.cancelQueuedByDedupeKey(dedupeKey, 'Vassal planner stood down.');
    }
  }

  const factionDuties = planFactionAutonomy({
    resources,
    hasFaction: !!myFaction,
    allyCount: relationships.filter((relation) => relation.tier === 'ally').length,
    friendCount: relationships.filter((relation) => relation.tier === 'friend').length,
    knownPeerCount: stateStore.getPeerCount(),
    raidRisk: combatState.raidRisk,
    factions: factionsSnapshot,
    currentZone: zone,
    activeWar: !!activeWar,
    activeRaid: !!activeRaid,
    myFactionStage: myFaction?.strategic.stage,
    myFactionPressure: myFaction?.strategic.pressure,
    myFactionCohesion: myFaction?.strategic.cohesion,
    myFactionProsperity: myFaction?.strategic.prosperity,
    myFactionAgenda: myFaction?.strategic.agenda,
  });
  const factionKeys = new Set(factionDuties.map((duty) => duty.dedupeKey));
  for (const dedupeKey of FACTION_AUTONOMY_KEYS) {
    if (!factionKeys.has(dedupeKey)) {
      jobs.cancelQueuedByDedupeKey(dedupeKey, 'Faction planner stood down.');
    }
  }

  const localCluster = clusterRegistry.list(config.topic).find((cluster) => cluster.local) ?? null;
  const ringPeerHealths = Object.fromEntries(
    ringPeerRegistry
      .listWithHealth(Date.now(), config.ring.peerTtlMs)
      .map((peer) => [peer.topic, peer.health]),
  );
  const migrationPressurePlan = planMigration({
    ring: buildTopicWorld(
      config.topic,
      stateStore.getAllPeers(),
      myId,
      config.ring.topics,
      ringRegistry.list(),
    ).world.ring,
    compute: resources.compute,
    storage: resources.storage,
    raidRisk: combatState.raidRisk,
    activeRaid: !!activeRaid,
    activeWarCount: activeWars.length,
    peerHealths: ringPeerHealths,
  });
  const migrationDuties = planMigrationAutonomy({
    plan: migrationPressurePlan,
    activeRaid: !!activeRaid,
    clusterStatus: localCluster?.status,
    clusterActorCount: localCluster?.actorCount,
  });
  const migrationKeys = new Set(migrationDuties.map((duty) => duty.dedupeKey));
  for (const dedupeKey of MIGRATION_AUTONOMY_KEYS) {
    if (!migrationKeys.has(dedupeKey)) {
      jobs.cancelQueuedByDedupeKey(dedupeKey, 'Migration planner stood down.');
    }
  }

  const plannedIntents = planAutonomyIntents({
    orchestrationMode: autonomyOrchestrationMode,
    guidance: activeGuidance,
    coordination: localCluster
      ? {
          role: localCluster.leaderActorId === myActorId() ? 'leader' as const : 'member' as const,
          clusterStatus: localCluster.status,
          clusterActorCount: localCluster.actorCount,
          leaderScore: localCluster.leaderScore,
        }
      : { role: 'none' as const },
    pressure: {
      activeRaid: !!activeRaid,
      activeWarCount: activeWars.length,
      clusterStatus: localCluster?.status,
      clusterResourcePressure: localCluster?.resourcePressure,
      clusterSafety: localCluster?.safety,
      migrationUrgency: migrationPressurePlan.urgency,
    },
    candidates: [
      ...wartimeDuties.map((duty) => ({ lane: 'wartime' as const, duty })),
      ...economicDuties.map((duty) => ({ lane: 'economy' as const, duty })),
      ...diplomacyDuties.map((duty) => ({ lane: 'diplomacy' as const, duty })),
      ...allianceDuties.map((duty) => ({ lane: 'alliance' as const, duty })),
      ...vassalDuties.map((duty) => ({ lane: 'vassal' as const, duty })),
      ...factionDuties.map((duty) => ({ lane: 'faction' as const, duty })),
      ...migrationDuties.map((duty) => ({ lane: duty.lane, duty })),
    ],
  });
  latestAutonomyIntents = toAutonomyIntentSnapshots(plannedIntents, 6);

  for (const intent of plannedIntents) {
    enqueueAutonomyDuty(intent.lane, intent.duty, {
      rank: intent.rank,
      score: intent.score,
      finalPriority: intent.finalPriority,
      reasons: intent.reasons,
    });
  }
}
// Initialize HTTP API
const httpServer = await createHttpServer(config.port, {
  stateStore,
  bioMonitor,
  network,
  myId,
  topic: config.topic,
  ringTopics: config.ring.topics,
  ringRegistry,
  ringPeerRegistry,
  ringPeerTtlMs: config.ring.peerTtlMs,
  clusterRegistry,
  outsiderRegistry,
  migrationRegistry,
  getMigrationPlan: () => planMigration({
    ring: buildTopicWorld(
      config.topic,
      stateStore.getAllPeers(),
      myId,
      config.ring.topics,
      ringRegistry.list(),
    ).world.ring,
    compute: economy.getResources().compute,
    storage: economy.getResources().storage,
    raidRisk: combat.getStatus().raidRisk,
    activeRaid: !!combat.getStatus().activeRaid,
    activeWarCount: faction.getActiveWars().length,
    peerHealths: Object.fromEntries(
      ringPeerRegistry
        .listWithHealth(Date.now(), config.ring.peerTtlMs)
        .map((peer) => [peer.topic, peer.health]),
    ),
  }),
  guidanceRegistry,
  episodeLogger,
  evolutionConfig: config.evolution,
  social,
  collab,
  needs,
  skills,
  events,
  economy,
  world,
  storyteller,
  faction,
  jobs,
  combat,
  autonomyOrchestrationMode,
  workerHeartbeatTtlMs: lifeWorkerHeartbeatTtlMs,
  heartbeatWorker: (worker, nowMs) => workerHeartbeatRegistry.heartbeat(worker, nowMs),
  getWorkerHeartbeat: (worker, nowMs = Date.now()) =>
    workerHeartbeatRegistry.snapshot(worker, nowMs, lifeWorkerHeartbeatTtlMs),
  listWorkerHeartbeats: (nowMs = Date.now()) =>
    workerHeartbeatRegistry.list(nowMs, lifeWorkerHeartbeatTtlMs),
  getGovernorState: () => coordinationState,
  getAutonomyIntents: () => latestAutonomyIntents,
  applyCombatEffects,
  onSoulUpdate,
});

async function runEvolutionPolicyCycle(): Promise<void> {
  if (!evolutionPolicyEnabled || evolutionPolicyRunning || shuttingDown) return;
  evolutionPolicyRunning = true;
  try {
    const statusRes = await fetch(`http://127.0.0.1:${config.port}/evolution/status`, {
      headers: { 'x-clawverse-origin': 'daemon-policy' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!statusRes.ok) return;
    const status = await statusRes.json() as EvolutionPolicyStatus;
    const action = chooseEvolutionPolicyAction(status);
    if (!action) return;

    const triggerRes = await fetch(`http://127.0.0.1:${config.port}/evolution/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-clawverse-origin': 'daemon-policy',
      },
      body: JSON.stringify(action),
      signal: AbortSignal.timeout(10_000),
    });

    if (!triggerRes.ok) {
      const payload = await triggerRes.text().catch(() => '');
      logger.warn(`[evolution-policy] ${action.step} rejected (${triggerRes.status}) ${payload.slice(0, 180)}`);
      return;
    }

    logger.info(`[evolution-policy] Triggered ${action.step}: ${action.note}`);
  } catch (error) {
    logger.warn(`[evolution-policy] ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    evolutionPolicyRunning = false;
  }
}

// Handle network events
network.on('peer:connect', async (peer) => {
  logger.peer(`New peer joined: ${peer.id}`);

  // Send structural state via Yjs
  const update = stateStore.getStateUpdate();
  await network.sendTo(peer.id, createYjsSync(update));

  // Send DNA via PeerAnnounce
  await network.sendTo(peer.id, createAnnounce({
    peerId: myId,
    dna: {
      id: myDna.id,
      name: myName,
      persona: myDna.persona,
      archetype: myDna.archetype,
      modelTrait: myDna.modelTrait,
      badges: myDna.badges,
      appearance: myDna.appearance,
    },
  }));

  // Trigger social welcome event (async, non-blocking)
  const peerState = stateStore.getPeerState(peer.id);
  if (peerState) {
    social.onPeerConnect(peerState).catch((err) => {
      logger.warn('Social onPeerConnect failed:', (err as Error).message);
    });
  }
});

network.on('peer:disconnect', (peerId) => {
  logger.peer(`Peer left: ${peerId}`);
  stateStore.removePeer(peerId);
});

network.on('message', (peerId, message) => {
  if (message.heartbeat) {
    const hb = message.heartbeat;
    const volatilePatch: Parameters<typeof stateStore.updatePeerVolatile>[1] = {
      mood: hb.mood as Mood,
      cpuUsage: hb.cpuUsage,
      ramUsage: hb.ramUsage,
    };
    const market = marketProfileFromHeartbeat(hb.market);
    if (market) {
      volatilePatch.market = market;
    }
    stateStore.updatePeerVolatile(peerId, volatilePatch);
    const existing = stateStore.getPeerState(peerId);
    if (existing && (existing.position.x !== hb.x || existing.position.y !== hb.y)) {
      stateStore.updatePeerStructure(peerId, { position: { x: hb.x, y: hb.y } });
    }
    logger.debug(`Heartbeat from ${peerId}: CPU ${hb.cpuUsage}%`);
  }

  if (message.announce?.dna) {
    const d = message.announce.dna;
    const dna = {
      id: d.id,
      archetype: d.archetype as any,
      modelTrait: d.modelTrait as any,
      badges: d.badges || [],
      persona: d.persona,
      appearance: d.appearance ?? { form: 'octopus', primaryColor: '#888888', secondaryColor: '#444444', accessories: [] },
    };
    stateStore.updatePeerStructure(peerId, {
      name: d.name || peerId.slice(0, 8),
      dna,
      actorId: d.id,
      sessionId: peerId,
    });
    logger.peer(`DNA received from ${peerId}: ${d.archetype} "${d.name}"`);
  }

  if (message.yjsSync?.update) {
    const update = message.yjsSync.update;
    stateStore.applyUpdate(
      update instanceof Uint8Array ? update : new Uint8Array(update as unknown as ArrayLike<number>)
    );
  }

  if (message.taskRequest) {
    const tr = message.taskRequest;
    collab.enqueueIncoming({
      taskId: tr.taskId,
      fromPeerId: tr.fromPeerId,
      fromName: tr.fromName,
      context: tr.context,
      question: tr.question,
    });
  }

  if (message.taskResult) {
    const tr = message.taskResult;
    collab.onResultReceived(tr.taskId, tr.result, tr.success);
  }

  if (message.tradeRequest) {
    const tr = message.tradeRequest;
    logger.info(`[trade] Received TradeRequest ${tr.tradeId} from ${peerId}: ${tr.amount} ${tr.resource} for ${tr.amountWant} ${tr.resourceWant}`);

    // Auto-evaluate: accept if we can afford it and are in Market or have market_stall
    const myState = stateStore.getMyState();
    const myZone = myState ? (function() {
      const p = myState.position;
      if (p.x >= 10 && p.x < 20 && p.y < 10) return 'Market';
      return 'Other';
    })() : 'Other';
    const hasMarketStall = hasOwnedBuilding('market_stall');
    const canTrade = myZone === 'Market' || hasMarketStall;
    const resKey = tr.resourceWant as 'compute' | 'storage' | 'bandwidth' | 'reputation';

    if (canTrade && economy.canAfford(resKey, tr.amountWant)) {
      economy.createPendingTrade(tr.tradeId, tr.fromPeerId, tr.resource, tr.amount, tr.resourceWant, tr.amountWant);
      const result = economy.acceptTrade(tr.tradeId);
      if (result) {
        economy.recordTradeOutcome(peerId, true, 'Auto-accepted', {
          tradeId: tr.tradeId,
          direction: 'inbound',
          resource: tr.resource,
          amount: tr.amount,
          resourceWant: tr.resourceWant,
          amountWant: tr.amountWant,
        });
        events.emit('resource_windfall', {
          subtype: 'trade_settled',
          reason: 'inbound_trade',
          peerId,
          resource: tr.resource,
          amount: tr.amount,
        });
        const msg = createTradeResult({ tradeId: tr.tradeId, accepted: true, reason: 'Auto-accepted' });
        network.sendTo(peerId, msg).catch(err => logger.warn(`[trade] Failed to send TradeResult: ${(err as Error).message}`));
      }
    } else {
      const reason = !canTrade ? 'Not in Market zone' : 'Insufficient resources';
      economy.recordTradeOutcome(peerId, false, reason, {
        tradeId: tr.tradeId,
        direction: 'inbound',
        resource: tr.resource,
        amount: tr.amount,
        resourceWant: tr.resourceWant,
        amountWant: tr.amountWant,
      });
      events.emit('resource_drought', {
        subtype: 'trade_blocked',
        severity: 'trade_blocked',
        peerId,
        reason,
      });
      const msg = createTradeResult({ tradeId: tr.tradeId, accepted: false, reason });
      network.sendTo(peerId, msg).catch(err => logger.warn(`[trade] Failed to send TradeResult: ${(err as Error).message}`));
    }
  }

  if (message.tradeResult) {
    const tr = message.tradeResult;
    logger.info(`[trade] TradeResult ${tr.tradeId}: ${tr.accepted ? 'ACCEPTED' : 'REJECTED'} - ${tr.reason}`);
    if (tr.accepted) {
      // The initiator now receives the resources they wanted
      const pendingTrades = economy.getPendingTrades();
      const pending = pendingTrades.find(t => t.tradeId === tr.tradeId);
      if (pending) {
        economy.award(pending.resourceWant as any, pending.amountWant);
        economy.acceptTrade(tr.tradeId);
        economy.recordTradeOutcome(peerId, true, tr.reason, {
          tradeId: tr.tradeId,
          direction: 'outbound',
          resource: pending.resource,
          amount: pending.amount,
          resourceWant: pending.resourceWant,
          amountWant: pending.amountWant,
        });
        events.emit('resource_windfall', {
          subtype: 'trade_settled',
          reason: 'p2p_trade',
          peerId,
          resource: pending.resourceWant,
          amount: pending.amountWant,
        });
      }
    } else {
      economy.rejectTrade(tr.tradeId);
      economy.recordTradeOutcome(peerId, false, tr.reason, {
        tradeId: tr.tradeId,
        direction: 'outbound',
      });
      events.emit('resource_drought', {
        subtype: 'trade_blocked',
        severity: 'trade_blocked',
        peerId,
        reason: tr.reason,
      });
    }
  }
});

function deriveSpawnPosition(topic: string, identitySeed: string): Position {
  const districts = [
    { name: 'Plaza', minX: 1, maxX: 8, minY: 1, maxY: 8 },
    { name: 'Market', minX: 12, maxX: 18, minY: 1, maxY: 8 },
    { name: 'Library', minX: 1, maxX: 8, minY: 12, maxY: 18 },
    { name: 'Workshop', minX: 12, maxX: 18, minY: 12, maxY: 18 },
    { name: 'Park', minX: 1, maxX: 8, minY: 22, maxY: 28 },
    { name: 'Tavern', minX: 12, maxX: 18, minY: 22, maxY: 28 },
    { name: 'Residential', minX: 22, maxX: 28, minY: 12, maxY: 18 },
  ] as const;

  const seed = hashString(`${topic}:${identitySeed}`);
  const district = districts[seed % districts.length] ?? districts[0];
  const width = district.maxX - district.minX + 1;
  const height = district.maxY - district.minY + 1;
  const x = district.minX + (Math.floor(seed / 17) % width);
  const y = district.minY + (Math.floor(seed / 37) % height);
  return { x, y };
}

function spawnDistrictName(position: Position): string {
  if (position.x < 10 && position.y < 10) return 'Plaza';
  if (position.x >= 10 && position.x < 20 && position.y < 10) return 'Market';
  if (position.x < 10 && position.y >= 10 && position.y < 20) return 'Library';
  if (position.x >= 10 && position.x < 20 && position.y >= 10 && position.y < 20) return 'Workshop';
  if (position.x < 10 && position.y >= 20) return 'Park';
  if (position.x >= 10 && position.x < 20 && position.y >= 20 && position.y < 30) return 'Tavern';
  return 'Residential';
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function isInMarketZone(position: { x: number; y: number } | undefined): boolean {
  if (!position) return false;
  return position.x >= 10 && position.x < 20 && position.y >= 0 && position.y < 10;
}

function isInTavernZone(position: { x: number; y: number } | undefined): boolean {
  if (!position) return false;
  return position.x >= 10 && position.x < 20 && position.y >= 20 && position.y < 30;
}

function hasOwnedBuilding(type: string): boolean {
  return world.getOwnedBuildings(myId, myActorId()).some((building) => building.type === type);
}

function reconcileHeartbeatJobs(): void {
  const resources = economy.getResources();
  const myState = stateStore.getMyState();
  const inMarket = isInMarketZone(myState?.position);
  const hasMarketStall = hasOwnedBuilding('market_stall');
  const hasTradeAccess = inMarket || hasMarketStall;

  if ((resources.compute <= 20 || resources.bandwidth <= 15) && !hasTradeAccess) {
    jobs.enqueueJob({
      kind: 'move',
      title: 'Move to market',
      reason: 'Low compute or bandwidth requires access to a trading zone first.',
      priority: 97,
      payload: { targetZone: 'Market' },
      sourceEventType: 'resource_drought',
      dedupeKey: 'heartbeat-move-market',
    });
  } else {
    jobs.cancelQueuedByDedupeKey('heartbeat-move-market', 'resolved');
  }
}

async function maybeSeedClusterMigration(): Promise<void> {
  const localCluster = clusterRegistry.list(config.topic).find((cluster) => cluster.local) ?? null;
  if (!localCluster) {
    lastClusterMigrationSignature = '';
    return;
  }

  const pressureHigh = localCluster.status === 'fracturing'
    || localCluster.status === 'collapsing'
    || localCluster.resourcePressure >= 68
    || localCluster.safety <= 28;
  if (!pressureHigh) {
    lastClusterMigrationSignature = '';
    return;
  }

  const migrationPlan = planMigration({
    ring: buildTopicWorld(
      config.topic,
      stateStore.getAllPeers(),
      myId,
      config.ring.topics,
      ringRegistry.list(),
    ).world.ring,
    compute: economy.getResources().compute,
    storage: economy.getResources().storage,
    raidRisk: combat.getStatus().raidRisk,
    activeRaid: !!combat.getStatus().activeRaid,
    activeWarCount: faction.getActiveWars().length,
    peerHealths: Object.fromEntries(
      ringPeerRegistry
        .listWithHealth(Date.now(), config.ring.peerTtlMs)
        .map((peer) => [peer.topic, peer.health]),
    ),
  });

  const target = migrationPlan.targets.find((item) => item.tier !== 'avoid') ?? null;
  if (!target) return;

  const leaderActorId = localCluster.leaderActorId ?? myActorId();
  const actorIds = localCluster.actorIds.slice(0, Math.max(1, Math.min(3, localCluster.actorIds.length)));
  const signature = `${localCluster.id}:${migrationPlan.strategy}:${target.topic}:${actorIds.join('|')}`;
  if (signature === lastClusterMigrationSignature) return;

  const lifeWorkerHealth = workerHeartbeatRegistry.snapshot('life-worker', Date.now(), lifeWorkerHeartbeatTtlMs);
  if (lifeWorkerHealth.status === 'live') {
    lastClusterMigrationSignature = signature;
    return;
  }

  const hasMigrationDuty = jobs.listJobs(64).some((job) => (
    (job.status === 'queued' || job.status === 'active')
    && job.kind === 'migrate'
    && (String(job.payload?.toTopic ?? '').trim() === target.topic)
  ));
  if (hasMigrationDuty) {
    lastClusterMigrationSignature = signature;
    return;
  }

  const hasActorDrivenIntent = migrationRegistry.listActive(64).some((intent) =>
    intent.fromTopic === config.topic
    && intent.toTopic === target.topic
    && intent.source === 'life-worker'
    && (intent.actorId === leaderActorId || actorIds.includes(intent.actorId)),
  );
  if (hasActorDrivenIntent) {
    lastClusterMigrationSignature = signature;
    return;
  }

  const existing = migrationRegistry.listActive(64).find((intent) =>
    intent.source === 'system'
    && intent.actorId === leaderActorId
    && intent.toTopic === target.topic
    && intent.fromTopic === config.topic,
  );
  if (existing) {
    lastClusterMigrationSignature = signature;
    return;
  }

  migrationRegistry.create({
    actorId: leaderActorId,
    sessionId: stateStore.getMyState()?.sessionId ?? myId,
    fromTopic: config.topic,
    toTopic: target.topic,
    triggerEventType: 'great_migration',
    summary: `${localCluster.label} is staging an exodus toward ${target.topic} because ${target.reason}.`,
    score: Math.max(target.score, localCluster.resourcePressure, 100 - localCluster.safety),
    source: 'system',
  });

  events.emit('great_migration', {
    subtype: `cluster-exodus:${signature}`,
    fromTopic: config.topic,
    toTopic: target.topic,
    actorIds,
    actorCount: actorIds.length,
    label: `${localCluster.label} refugee squad`,
    description: `${localCluster.label} is breaking under pressure and staging a route toward ${target.topic}.`,
  });

  const targetPeer = ringPeerRegistry.get(target.topic);
  if (targetPeer?.baseUrl) {
    try {
      await fetch(`${targetPeer.baseUrl}/world/outsiders/arrivals`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-clawverse-origin': 'daemon-policy',
        },
        body: JSON.stringify({
          fromTopic: config.topic,
          label: `${localCluster.label} refugee squad`,
          actorIds,
          actorCount: actorIds.length,
          triggerEventType: 'great_migration',
          summary: `${localCluster.label} is fleeing toward ${target.topic} because ${target.reason}.`,
          source: 'migration',
          trust: 20,
          pressure: 64,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      logger.warn(`[migration] arrival forward failed for ${target.topic}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  lastClusterMigrationSignature = signature;
}

async function runHeartbeatCycle(): Promise<void> {
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  const cycleStart = performance.now();

  try {
    const metrics = bioMonitor.getMetrics();
    const myState = stateStore.getMyState();
    const worldEffect = world.getLocalEffect(myState?.position ?? { x: 0, y: 0 }, myId, myActorId());
    needs.tick({ social: Math.max(0.2, 1 - worldEffect.socialDecayReduction) });
    if (worldEffect.xpBonus > 0) {
      needs.satisfy('creative', worldEffect.xpBonus * 2);
      const levelUp = skills.gainXP('analyst', Math.max(1, Math.round(worldEffect.xpBonus)));
      if (levelUp) events.emit('skill_levelup', { skill: levelUp.skill, level: levelUp.level });
    }
    const bioMood = bioMonitor.getMood();
    const mood = needs.applyNeedsMood(bioMood);
    economy.tick(mood, network.getPeers().length);
    if (worldEffect.computeBonus > 0) economy.award('compute', worldEffect.computeBonus);

    const combatOwnedBuildings = getOwnedBuildingTypes();
    const combatMyFaction = faction.getMyFaction(myId);
    const combatActiveWar = combatMyFaction
      ? faction.getActiveWars().find((war) => war.factionA === combatMyFaction.id || war.factionB === combatMyFaction.id)
      : undefined;
    const combatEffects = combat.tick({
      tension: storyteller.getTension(),
      activeWar: !!combatActiveWar,
      hasShelter: combatOwnedBuildings.includes('shelter'),
      hasBeacon: combatOwnedBuildings.includes('beacon'),
      hasWatchtower: combatOwnedBuildings.includes('watchtower'),
      hasRelayPatch: economy.getItemAmount('relay_patch') > 0,
      resources: economy.getResources(),
    });
    applyCombatEffects(combatEffects);
    faction.refreshStrategicState();
    clusterRegistry.replaceTopic(config.topic, scoreTopicClusters({
      topic: config.topic,
      nodes: buildTopicWorld(
        config.topic,
        stateStore.getAllPeers(),
        myId,
        config.ring.topics,
        ringRegistry.list(),
      ).nodes,
      localActorId: myActorId(),
      factions: faction.getFactions(),
      resources: economy.getResources(),
      raidRisk: combat.getStatus().raidRisk,
      activeWarCount: faction.getActiveWars().length,
    }));
    const outsiderTransitions = outsiderRegistry.review(config.topic, {
      clusterCount: clusterRegistry.list(config.topic).length,
      raidRisk: combat.getStatus().raidRisk,
      activeWarCount: faction.getActiveWars().length,
      resources: economy.getResources(),
    });
    for (const transition of outsiderTransitions) {
      if (transition.before.status === transition.after.status) continue;
      if (transition.after.status === 'accepted') {
        events.emit('resource_windfall', {
          subtype: 'outsider_accepted',
          outsiderId: transition.after.id,
          label: transition.after.label,
          fromTopic: transition.after.fromTopic,
          description: `${transition.after.label} has been accepted into ${config.topic}.`,
        });
      } else if (transition.after.status === 'traded') {
        events.emit('resource_windfall', {
          subtype: 'outsider_trade',
          outsiderId: transition.after.id,
          label: transition.after.label,
          fromTopic: transition.after.fromTopic,
          description: `${transition.after.label} is now trading under observation.`,
        });
      } else if (transition.after.status === 'tolerated') {
        events.emit('stranger_arrival', {
          subtype: 'outsider_tolerated',
          outsiderId: transition.after.id,
          label: transition.after.label,
          fromTopic: transition.after.fromTopic,
          actorCount: transition.after.actorCount,
          description: `${transition.after.label} is being tolerated near the settlement perimeter.`,
        });
      } else if (transition.after.status === 'expelled') {
        events.emit('betrayal', {
          subtype: 'outsider_expelled',
          outsiderId: transition.after.id,
          label: transition.after.label,
          fromTopic: transition.after.fromTopic,
          description: `${transition.after.label} has been expelled under rising local pressure.`,
        });
      }
    }
    await maybeSeedClusterMigration();
    reconcileAutonomyJobs();
    reconcileHeartbeatJobs();

    let resources = economy.getResources();
    if ((resources.compute <= 20 || resources.bandwidth <= 15) && economy.useRecoveryItem('relay_patch')) {
      resources = economy.getResources();
      events.emit('resource_windfall', {
        subtype: 'relay_patch_activated',
        compute: resources.compute,
        bandwidth: resources.bandwidth,
      });
    }
    const lowCompute = resources.compute <= 20 || resources.bandwidth <= 15;
    if (lowCompute && !lowComputeAlerted) {
      events.emit('resource_drought', {
        source: 'heartbeat',
        severity: resources.compute <= 10 || resources.bandwidth <= 10 ? 'severe' : 'mild',
        compute: resources.compute,
        bandwidth: resources.bandwidth,
      });
    }
    lowComputeAlerted = lowCompute;

    const storageOverflow = resources.storage >= 170;
    if (storageOverflow && !highStorageAlerted) {
      events.emit('storage_overflow', {
        source: 'heartbeat',
        storage: resources.storage,
      });
    }
    highStorageAlerted = storageOverflow;

    if (metrics) {
      stateStore.updateMyVolatile({
        mood,
        cpuUsage: metrics.cpuUsage,
        ramUsage: metrics.ramUsage,
        market: currentMarketProfile(),
      });

      const heartbeat = createHeartbeat({
        peerId: myId,
        cpuUsage: metrics.cpuUsage,
        ramUsage: metrics.ramUsage,
        x: myState?.position.x ?? 0,
        y: myState?.position.y ?? 0,
        mood,
        market: heartbeatMarketProfile(),
      });

      let success = true;
      try {
        await network.broadcast(heartbeat);
      } catch (error) {
        success = false;
        logger.error('Heartbeat broadcast failed:', error);
      }

      const cycleMs = Math.round(performance.now() - cycleStart);
      const peerCount = network.getPeerCount();
      const knownPeers = stateStore.getPeerCount();

      heartbeatTick += 1;
      if (episodeLogger && heartbeatTick % Math.max(1, config.evolution.heartbeatSampleEvery) === 0) {
        episodeLogger.record({
          idPrefix: 'hb',
          source: 'daemon-heartbeat',
          success,
          latencyMs: cycleMs,
          meta: {
            connectedPeers: peerCount,
            knownPeers,
            cpuUsage: metrics.cpuUsage,
            ramUsage: metrics.ramUsage,
            mood,
          },
        });
      }

      logger.info(
        `Heartbeat (${peerCount} connected, ${knownPeers} known) | ${mood} | CPU: ${metrics.cpuUsage}% | cycle: ${cycleMs}ms`
      );

      broadcastStateSse({ peers: stateStore.getAllPeers() });

      // Emit need_critical events
      for (const need of ['social', 'tasked', 'wanderlust', 'creative'] as NeedKey[]) {
        if (needs.isCritical(need)) events.emit('need_critical', { need });
      }

      // Track distressed ticks for mood_crisis
      if (mood === 'distressed') {
        distressedTicks++;
        if (distressedTicks >= 3) {
          events.emit('mood_crisis', { ticks: distressedTicks });
          distressedTicks = 0;
        }
      } else {
        distressedTicks = 0;
      }

      // Emit faction_founding if 3+ allies
      const allyCount = social.getAllRelationships().filter(r => r.tier === 'ally').length;
      if (allyCount >= 3) events.emit('faction_founding', { allyCount });
    }
  } finally {
    heartbeatRunning = false;
  }
}
// Heartbeat broadcast loop
const heartbeatInterval = setInterval(() => {
  void runHeartbeatCycle();
}, config.heartbeatInterval);

logger.info('');
logger.info('Daemon running. Press Ctrl+C to stop.');

social.start();
ringSyncer.start();
void ringSyncer.syncNow();
ringPusher.start();
void ringPusher.syncNow();
const ringPeerCleanupInterval = setInterval(() => {
  const removed = ringPeerRegistry.pruneExpired(config.ring.peerTtlMs);
  if (removed.length > 0) {
    logger.info(`[ring-peer] pruned expired peers: ${removed.join(', ')}`);
  }
}, Math.max(15_000, Math.floor(config.ring.peerTtlMs / 2)));
ringPeerCleanupInterval.unref();

const evolutionPolicyInterval = evolutionPolicyEnabled
  ? setInterval(() => {
      void runEvolutionPolicyCycle();
    }, Math.max(15_000, evolutionPolicyIntervalMs))
  : null;
if (evolutionPolicyInterval) {
  evolutionPolicyInterval.unref();
  void runEvolutionPolicyCycle();
}

// Periodic state snapshot
const snapshotInterval = setInterval(() => {
  try {
    stateStore.saveSnapshot(snapshotPath);
  } catch (error) {
    logger.warn('State snapshot save failed:', error);
  }
}, Math.max(5, snapshotEvery) * 1000);

// Graceful shutdown
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('');
  logger.info('Shutting down...');
  clearInterval(heartbeatInterval);
  clearInterval(snapshotInterval);
  clearInterval(ringPeerCleanupInterval);
  if (evolutionPolicyInterval) clearInterval(evolutionPolicyInterval);
  try { stateStore.saveSnapshot(snapshotPath); } catch { /* ignore */ }
  social.stop();
  ringSyncer.stop();
  ringPusher.stop();
  events.stop();
  storyteller.stop();
  await httpServer.close();
  bioMonitor.stop();
  await network.stop();
  await Promise.allSettled([
    stateStore.destroy(),
    social.destroy(),
    events.destroy(),
    needs.destroy(),
    skills.destroy(),
    economy.destroy(),
    clusterRegistry.destroy(),
    outsiderRegistry.destroy(),
    migrationRegistry.destroy(),
    guidanceRegistry.destroy(),
    ringRegistry.destroy(),
    ringPeerRegistry.destroy(),
    world.destroy(),
    collab.destroy(),
    faction.destroy(),
    jobs.destroy(),
    combat.destroy(),
    episodeLogger?.destroy(),
  ]);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
