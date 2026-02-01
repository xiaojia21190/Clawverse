#!/usr/bin/env node

import { loadConfig } from './config.js';
import { logger, setLogLevel } from './logger.js';
import { BioMonitor } from './bio.js';
import { ClawverseNetwork } from './network.js';
import { StateStore } from './state.js';
import { createHttpServer } from './http.js';
import { createHeartbeat, createYjsSync } from '@clawverse/protocol';
import { Mood } from '@clawverse/types';

const config = loadConfig();

if (config.debug) {
  setLogLevel('debug');
}

logger.info('========================================');
logger.info('   Clawverse Daemon v0.1.0');
logger.info('========================================');
logger.info(`Topic: ${config.topic}`);
logger.info(`HTTP Port: ${config.port}`);
logger.info(`Heartbeat Interval: ${config.heartbeatInterval}ms`);
logger.info('');

// Initialize State Store
const stateStore = new StateStore();

// Initialize Bio-Monitor
const bioMonitor = new BioMonitor(config.heartbeatInterval);
await bioMonitor.start();

logger.info('');

// Initialize Network
const network = new ClawverseNetwork(config.topic);
const myId = await network.start();

// Set my ID in state store
stateStore.setMyId(myId);

// Initialize HTTP API
const httpServer = await createHttpServer(config.port, {
  stateStore,
  bioMonitor,
  network,
  myId,
});

// Handle network events
network.on('peer:connect', async (peer) => {
  logger.peer(`New peer joined: ${peer.id}`);

  // Send our current state to the new peer
  const update = stateStore.getStateUpdate();
  const message = createYjsSync(update);
  await network.sendTo(peer.id, message);
});

network.on('peer:disconnect', (peerId) => {
  logger.peer(`Peer left: ${peerId}`);
  stateStore.removePeer(peerId);
});

network.on('message', (peerId, message) => {
  // Handle heartbeat messages
  if (message.heartbeat) {
    const hb = message.heartbeat;
    stateStore.updatePeerState(peerId, {
      position: { x: hb.x, y: hb.y },
      mood: hb.mood as Mood,
      hardware: {
        cpuUsage: hb.cpuUsage,
        ramUsage: hb.ramUsage,
        ramTotal: 0,
        diskFree: 0,
        uptime: 0,
        platform: '',
        hostname: '',
        cpuModel: '',
        cpuCores: 0,
      },
    });
    logger.debug(`Heartbeat from ${peerId}: CPU ${hb.cpuUsage}%`);
  }

  // Handle Yjs sync messages
  if (message.yjsSync && message.yjsSync.update) {
    const update = message.yjsSync.update;
    if (update instanceof Uint8Array) {
      stateStore.applyUpdate(update);
    } else {
      // Handle case where it might come as a regular array
      stateStore.applyUpdate(new Uint8Array(update as unknown as ArrayLike<number>));
    }
  }
});

// Heartbeat broadcast loop
setInterval(async () => {
  const metrics = bioMonitor.getMetrics();
  const mood = bioMonitor.getMood();

  if (metrics) {
    // Update local state
    stateStore.updateMyState({
      mood: mood,
      hardware: metrics,
    });

    // Broadcast heartbeat
    const heartbeat = createHeartbeat({
      peerId: myId,
      cpuUsage: metrics.cpuUsage,
      ramUsage: metrics.ramUsage,
      x: stateStore.getMyState()?.position.x || 0,
      y: stateStore.getMyState()?.position.y || 0,
      mood: mood,
    });

    await network.broadcast(heartbeat);

    const peerCount = network.getPeerCount();
    const knownPeers = stateStore.getPeerCount();
    logger.info(`Heartbeat (${peerCount} connected, ${knownPeers} known) | ${mood} | CPU: ${metrics.cpuUsage}%`);
  }
}, config.heartbeatInterval);

logger.info('');
logger.info('Daemon running. Press Ctrl+C to stop.');

// Graceful shutdown
const shutdown = async () => {
  logger.info('');
  logger.info('Shutting down...');
  await httpServer.close();
  bioMonitor.stop();
  await network.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
