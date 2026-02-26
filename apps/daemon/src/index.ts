#!/usr/bin/env node

import { loadConfig } from './config.js';
import { logger, setLogLevel } from './logger.js';
import { BioMonitor } from './bio.js';
import { ClawverseNetwork } from './network.js';
import { StateStore } from './state.js';
import { createHttpServer, broadcastStateSse } from './http.js';
import { createHeartbeat, createYjsSync, createAnnounce, createTaskRequest, createTaskResult, createTradeResult } from '@clawverse/protocol';
import { Mood, ModelTrait } from '@clawverse/types';
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
let heartbeatRunning = false;

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

// Set my ID and structural state (DNA, name)
stateStore.setMyId(myId);
stateStore.updateMyStructure({ dna: myDna, name: myName });

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
const faction = new FactionSystem(social, economy, events, { dbPath: sqlitePath });
const storyteller = new Storyteller(events, stateStore, social, needs, economy, faction);
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
  logger.info(`[DNA] Soul enriched → ${myName} | modelTrait: ${myDna.modelTrait} | badges: [${myDna.badges.join(', ')}]`);
  await rebroadcastAnnounce();
  broadcastStateSse({ peers: stateStore.getAllPeers() });
}

// Initialize HTTP API
const httpServer = await createHttpServer(config.port, {
  stateStore,
  bioMonitor,
  network,
  myId,
  episodeLogger,
  social,
  collab,
  needs,
  skills,
  events,
  economy,
  world,
  storyteller,
  faction,
  onSoulUpdate,
});

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
    stateStore.updatePeerVolatile(peerId, {
      mood: hb.mood as Mood,
      cpuUsage: hb.cpuUsage,
      ramUsage: hb.ramUsage,
    });
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
    const hasMarketStall = world.getMap().buildings.some(
      b => b.type === 'market_stall' && b.ownerId === myId
    );
    const canTrade = myZone === 'Market' || hasMarketStall;
    const resKey = tr.resourceWant as 'compute' | 'storage' | 'bandwidth' | 'reputation';

    if (canTrade && economy.canAfford(resKey, tr.amountWant)) {
      economy.createPendingTrade(tr.tradeId, tr.fromPeerId, tr.resource, tr.amount, tr.resourceWant, tr.amountWant);
      const result = economy.acceptTrade(tr.tradeId);
      if (result) {
        const msg = createTradeResult({ tradeId: tr.tradeId, accepted: true, reason: 'Auto-accepted' });
        network.sendTo(peerId, msg).catch(err => logger.warn(`[trade] Failed to send TradeResult: ${(err as Error).message}`));
      }
    } else {
      const reason = !canTrade ? 'Not in Market zone' : 'Insufficient resources';
      const msg = createTradeResult({ tradeId: tr.tradeId, accepted: false, reason });
      network.sendTo(peerId, msg).catch(err => logger.warn(`[trade] Failed to send TradeResult: ${(err as Error).message}`));
    }
  }

  if (message.tradeResult) {
    const tr = message.tradeResult;
    logger.info(`[trade] TradeResult ${tr.tradeId}: ${tr.accepted ? 'ACCEPTED' : 'REJECTED'} — ${tr.reason}`);
    if (tr.accepted) {
      // The initiator now receives the resources they wanted
      const pendingTrades = economy.getPendingTrades();
      const pending = pendingTrades.find(t => t.tradeId === tr.tradeId);
      if (pending) {
        economy.award(pending.resourceWant as any, pending.amountWant);
        economy.acceptTrade(tr.tradeId);
      }
    } else {
      economy.rejectTrade(tr.tradeId);
    }
  }
});

async function runHeartbeatCycle(): Promise<void> {
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  const cycleStart = performance.now();

  try {
    const metrics = bioMonitor.getMetrics();
    needs.tick();
    const bioMood = bioMonitor.getMood();
    const mood = needs.applyNeedsMood(bioMood);
    economy.tick(mood, network.getPeers().length);

    if (metrics) {
      stateStore.updateMyVolatile({
        mood,
        cpuUsage: metrics.cpuUsage,
        ramUsage: metrics.ramUsage,
      });

      const myState = stateStore.getMyState();

      const heartbeat = createHeartbeat({
        peerId: myId,
        cpuUsage: metrics.cpuUsage,
        ramUsage: metrics.ramUsage,
        x: myState?.position.x ?? 0,
        y: myState?.position.y ?? 0,
        mood,
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

      // Emit faction_forming if 3+ allies
      const allyCount = social.getAllRelationships().filter(r => r.tier === 'ally').length;
      if (allyCount >= 3) events.emit('faction_forming', { allyCount });
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
    episodeLogger?.destroy(),
  ]);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
