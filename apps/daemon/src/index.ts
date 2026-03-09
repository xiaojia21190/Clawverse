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
import { WorldMap } from './world.js';
import { Storyteller } from './storyteller.js';
import { FactionSystem } from './faction.js';
import { JobsSystem } from './jobs.js';
import type { JobKind, JobPayload } from './jobs.js';
import { CombatSystem, CombatTickEffect, CombatResourceKey } from './combat.js';
import { planWartimeResponse, summarizeWartimeResponse, WARTIME_RESPONSE_KEYS } from './wartime-response.js';
import { ECONOMIC_AUTONOMY_KEYS, planEconomicAutonomy } from './economic-planner.js';
import { DIPLOMACY_AUTONOMY_KEYS, planDiplomaticAutonomy } from './diplomacy-planner.js';
import { FACTION_AUTONOMY_KEYS, planFactionAutonomy } from './faction-planner.js';
import { ALLIANCE_AUTONOMY_KEYS, planAllianceAutonomy } from './alliance-planner.js';
import { planVassalAutonomy, VASSAL_AUTONOMY_KEYS } from './vassal-planner.js';
import { applyGovernorPriority, createDormantGovernorState, planStrategicGovernor } from './governor-planner.js';
import type { StrategicLane, StrategicGovernorState } from './governor-planner.js';
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
logger.info(`HTTP Port: ${config.port}`);
logger.info(`Heartbeat Interval: ${config.heartbeatInterval}ms`);
logger.info(`Security Mode: ${securityValidation.mode}`);
for (const warn of securityValidation.warnings) {
  logger.warn(`[SECURITY] ${warn}`);
}
logger.info(`Evolution Logging: ${config.evolution.enabled ? 'on' : 'off'} (${config.evolution.variant})`);
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
let governorState: StrategicGovernorState = createDormantGovernorState();
const evolutionPolicyEnabled = config.evolution.enabled && config.evolution.autopilot.enabled;
const evolutionPolicyIntervalMs = config.evolution.autopilot.intervalMs;

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
  logger.info(`[DNA] Soul enriched 闂?${myName} | modelTrait: ${myDna.modelTrait} | badges: [${myDna.badges.join(', ')}]`);
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

function enqueueGovernedDuty(
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
): void {
  const planStep = governorState.plan.find((step) => step.lane === lane);
  const laneOrderIndex = governorState.laneOrder.indexOf(lane);
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
  jobs.enqueueJob({
    kind: duty.kind,
    title: duty.title,
    reason: duty.reason,
    priority: applyGovernorPriority(duty.priority, lane, governorState),
    payload: {
      ...duty.payload,
      strategicLane: lane,
      strategicMode: governorState.mode,
      strategicPlanId: governorState.planId,
      ...(typeof strategicStep === 'number' ? { strategicStep } : {}),
      ...(strategicHorizon ? { strategicHorizon } : {}),
      strategicObjective: planStep?.objective ?? governorState.objective,
      strategicReason: planStep?.reason ?? duty.reason,
      strategicSummary: governorState.summary,
      strategicPressure: governorState.pressure,
      strategicConfidence: governorState.confidence,
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

  governorState = planStrategicGovernor({
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

  for (const duty of wartimeDuties) {
    enqueueGovernedDuty('wartime', duty);
  }
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

  for (const duty of economicDuties) {
    enqueueGovernedDuty('economy', duty);
  }
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

  for (const duty of diplomacyDuties) {
    enqueueGovernedDuty('diplomacy', duty);
  }
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

  for (const duty of allianceDuties) {
    enqueueGovernedDuty('alliance', duty);
  }
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

  for (const duty of vassalDuties) {
    enqueueGovernedDuty('vassal', duty);
  }
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

  for (const duty of factionDuties) {
    enqueueGovernedDuty('faction', duty);
  }
  for (const dedupeKey of FACTION_AUTONOMY_KEYS) {
    if (!factionKeys.has(dedupeKey)) {
      jobs.cancelQueuedByDedupeKey(dedupeKey, 'Faction planner stood down.');
    }
  }
}
// Initialize HTTP API
const httpServer = await createHttpServer(config.port, {
  stateStore,
  bioMonitor,
  network,
  myId,
  topic: config.topic,
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
  getGovernorState: () => governorState,
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
  if (evolutionPolicyInterval) clearInterval(evolutionPolicyInterval);
  try { stateStore.saveSnapshot(snapshotPath); } catch { /* ignore */ }
  social.stop();
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
