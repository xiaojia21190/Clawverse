#!/usr/bin/env node

import { loadConfig } from './config.js';
import { logger, setLogLevel } from './logger.js';
import { BioMonitor } from './bio.js';
import { ClawverseNetwork } from './network.js';
import { StateStore } from './state.js';
import { createHttpServer, broadcastStateSse } from './http.js';
import { createHeartbeat, createYjsSync, createAnnounce, createTaskRequest, createTaskResult } from '@clawverse/protocol';
import { Mood, ModelTrait } from '@clawverse/types';
import { EvolutionEpisodeLogger } from './evolution.js';
import { loadSecurityConfig, validateSecurityConfig } from './security.js';
import { computeHardwareHash, generateDNAFromHashes, generateDNA, dnaToName } from './dna.js';
import { SocialSystem } from './social.js';
import { CollabSystem } from './collab.js';

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
logger.info(`State Snapshot: ${snapshotPath} (every ${snapshotEvery}s)`);
logger.info('');

const episodeLogger = config.evolution.enabled
  ? new EvolutionEpisodeLogger({
      episodesPath: config.evolution.episodesPath,
      variant: config.evolution.variant,
      flushEvery: config.evolution.flushEvery,
    })
  : null;

if (episodeLogger) {
  logger.info(`Episodes Path: ${episodeLogger.getPath()}`);
  logger.info(`Heartbeat Sampling: 1/${Math.max(1, config.evolution.heartbeatSampleEvery)}`);
}

let heartbeatTick = 0;

// Initialize State Store
const stateStore = new StateStore();
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
const social = new SocialSystem();
social.init({
  myId,
  getPeers: () => stateStore.getAllPeers(),
  getMyState: () => stateStore.getMyState(),
});

// Initialize Collab System
const collab = new CollabSystem();
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
    await network.sendTo(task.from, msg).catch((err) => {
      logger.warn(`[collab] Failed to send TaskRequest to ${task.from}: ${(err as Error).message}`);
    });
  },
  sendResult: async (toPeerId, taskId, result, success) => {
    const msg = createTaskResult({ taskId, success, result });
    await network.sendTo(toPeerId, msg).catch((err) => {
      logger.warn(`[collab] Failed to send TaskResult to ${toPeerId}: ${(err as Error).message}`);
    });
  },
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
});

// Heartbeat broadcast loop
setInterval(async () => {
  const cycleStart = performance.now();

  const metrics = bioMonitor.getMetrics();
  const mood = bioMonitor.getMood();

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
  }
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
const shutdown = async () => {
  logger.info('');
  logger.info('Shutting down...');
  clearInterval(snapshotInterval);
  try { stateStore.saveSnapshot(snapshotPath); } catch { /* ignore */ }
  episodeLogger?.destroy();
  social.stop();
  await httpServer.close();
  bioMonitor.stop();
  await network.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
