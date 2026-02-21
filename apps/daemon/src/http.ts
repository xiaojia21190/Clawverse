import Fastify, { FastifyInstance } from 'fastify';
import { StateStore } from './state.js';
import { BioMonitor } from './bio.js';
import { ClawverseNetwork } from './network.js';
import { logger } from './logger.js';
import { EvolutionEpisodeLogger } from './evolution.js';

interface APIContext {
  stateStore: StateStore;
  bioMonitor: BioMonitor;
  network: ClawverseNetwork;
  myId: string;
  episodeLogger: EvolutionEpisodeLogger | null;
}

export async function createHttpServer(
  port: number,
  context: APIContext
): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  // Health check
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      peerId: context.myId,
      timestamp: new Date().toISOString()
    };
  });

  // Get my status
  fastify.get('/status', async () => {
    const metrics = context.bioMonitor.getMetrics();
    const mood = context.bioMonitor.getMood();
    const peers = context.network.getPeers();
    const myState = context.stateStore.getMyState();

    return {
      id: context.myId,
      mood,
      metrics,
      state: myState,
      connectedPeers: peers.length,
      knownPeers: context.stateStore.getPeerCount(),
    };
  });

  // Get all peers
  fastify.get('/peers', async () => {
    return {
      connected: context.network.getPeers(),
      all: context.stateStore.getAllPeers(),
    };
  });

  // Get specific peer
  fastify.get<{ Params: { peerId: string } }>('/peers/:peerId', async (request, reply) => {
    const state = context.stateStore.getPeerState(request.params.peerId);
    if (!state) {
      reply.code(404);
      return { error: 'Peer not found' };
    }
    return state;
  });

  // Move to position
  fastify.post<{ Body: { x: number; y: number } }>('/move', async (request, reply) => {
    const { x, y } = request.body || {};
    if (typeof x !== 'number' || typeof y !== 'number') {
      reply.code(400);
      return { error: 'x and y must be numbers' };
    }
    context.stateStore.updateMyState({
      position: { x, y },
    });
    return { success: true, position: { x, y } };
  });

  // Get current position
  fastify.get('/position', async () => {
    const myState = context.stateStore.getMyState();
    return {
      position: myState?.position || { x: 0, y: 0 },
    };
  });

  // Network stats
  fastify.get('/network', async () => {
    return {
      myId: context.myId,
      connectedPeers: context.network.getPeerCount(),
      knownPeers: context.stateStore.getPeerCount(),
      peers: context.network.getPeers(),
    };
  });

  // Evolution logger status
  fastify.get('/evolution', async () => {
    return {
      enabled: !!context.episodeLogger,
      variant: context.episodeLogger?.getVariant() ?? null,
      episodesPath: context.episodeLogger?.getPath() ?? null,
    };
  });

  // Record task/manual episode for evolution evaluation
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

  // Start server
  try {
    await fastify.listen({ port, host: '127.0.0.1' });
    logger.info(`HTTP API listening on http://127.0.0.1:${port}`);
  } catch (err) {
    logger.error('Failed to start HTTP server:', err);
    throw err;
  }

  return fastify;
}
