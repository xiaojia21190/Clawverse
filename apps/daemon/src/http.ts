import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
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
import { logger } from './logger.js';
import { EvolutionEpisodeLogger } from './evolution.js';
import { DNA, ModelTrait, SocialEvent, RelationshipTier } from '@clawverse/types';
import { createTradeRequest } from '@clawverse/protocol';

interface APIContext {
  stateStore: StateStore;
  bioMonitor: BioMonitor;
  network: ClawverseNetwork;
  myId: string;
  episodeLogger: EvolutionEpisodeLogger | null;
  social: SocialSystem;
  collab: CollabSystem;
  needs: NeedsSystem;
  skills: SkillsTracker;
  events: EventEngine;
  economy: EconomySystem;
  world: WorldMap;
  storyteller: Storyteller;
  faction?: FactionSystem;
  // Called when /dna/soul is POSTed — daemon regenerates DNA and re-announces
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

export async function createHttpServer(
  port: number,
  context: APIContext
): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  // Wire social events to SSE
  context.social.on('event', (e) => broadcastSocialSse(e));

  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    peerId: context.myId,
    timestamp: new Date().toISOString(),
  }));

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
  fastify.get('/peers', async () => ({
    connected: context.network.getPeers(),
    all: context.stateStore.getAllPeers(),
  }));

  // Get specific peer
  fastify.get<{ Params: { peerId: string } }>('/peers/:peerId', async (request, reply) => {
    const state = context.stateStore.getPeerState(request.params.peerId);
    if (!state) { reply.code(404); return { error: 'Peer not found' }; }
    return state;
  });

  // Move to position
  fastify.post<{ Body: { x: number; y: number } }>('/move', async (request, reply) => {
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
    peers: context.network.getPeers(),
  }));

  // Evolution logger status
  fastify.get('/evolution', async () => ({
    enabled: !!context.episodeLogger,
    variant: context.episodeLogger?.getVariant() ?? null,
    episodesPath: context.episodeLogger?.getPath() ?? null,
  }));

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

  // DNA soul update — called by OpenClaw connector soul-worker
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

  fastify.get('/storyteller/status', async () => ({
    mode: context.storyteller.getMode(),
    tension: context.storyteller.getTension(),
  }));

  fastify.post('/storyteller/mode', async (request, reply) => {
    const { mode } = request.body as { mode: string };
    if (!['Randy', 'Cassandra', 'Phoebe'].includes(mode)) {
      return reply.code(400).send({ error: 'invalid mode' });
    }
    context.storyteller.setMode(mode as any);
    return { success: true, mode };
  });

  fastify.post('/storyteller/trigger', async (request, reply) => {
    const body = (request.body || {}) as { eventType?: string; payload?: Record<string, unknown> };
    if (!body.eventType || !isLifeEventType(body.eventType)) {
      return reply.code(400).send({
        error: `invalid eventType. allowed: ${LIFE_EVENT_TYPES.join(', ')}`,
      });
    }
    const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : {};
    context.events.emit(body.eventType, { ...payload, source: 'manual' });
    return { success: true };
  });

  fastify.get('/world/map', async () => context.world.getMap());

  fastify.post('/world/build', async (request, reply) => {
    const { type, x, y } = request.body as { type: string; x: number; y: number };
    const validTypes = ['forge', 'archive', 'beacon', 'market_stall', 'shelter'];
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
    const building = context.world.build(type as any, pos, context.myId, myState?.name ?? context.myId.slice(0, 8));
    if (!building) return reply.code(409).send({ error: 'position occupied or invalid' });
    context.economy.consume('compute', cost.compute);
    context.economy.consume('storage', cost.storage);
    context.skills.gainXP('explorer', 5);
    context.events.emit('building_completed' as any, { buildingType: type, position: pos });
    broadcastStateSse({ peers: context.stateStore.getAllPeers() });
    return { success: true, building };
  });

  fastify.delete('/world/build/:id', async (request, reply) => {
    const { id } = (request.params as { id: string });
    const ok = context.world.demolish(id, context.myId);
    if (!ok) return reply.code(404).send({ error: 'not found or not yours' });
    return { success: true };
  });

  // Economy endpoints
  fastify.get('/economy/resources', async () => context.economy.getResources());

  fastify.post('/economy/trade', async (request, reply) => {
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
    const hasMarketStall = context.world.getMap().buildings.some(
      b => b.type === 'market_stall' && b.ownerId === context.myId
    );
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
        return reply.code(502).send({ error: 'peer not reachable' });
      }
      return { success: true, tradeId, status: 'pending' };
    }

    // Local one-way transfer (legacy)
    const ok = context.economy.consume(resource as any, amount);
    if (!ok) return reply.code(400).send({ error: 'insufficient resources' });
    context.economy.recordTrade(context.myId, toId, resource, amount);
    return { success: true };
  });

  fastify.get('/economy/trades', async () => ({
    pending: context.economy.getPendingTrades(),
    history: context.economy.getTradeHistory(),
  }));

  fastify.get('/economy/market', async () => {
    const peers = context.stateStore.getAllPeers();
    const marketPeers = peers.filter(p => locationName(p.position) === 'Market');
    return { peers: marketPeers.map(p => ({ id: p.id, name: p.name, position: p.position })) };
  });

  // Faction endpoints
  fastify.get('/factions', async () => ({
    factions: context.faction?.getFactions() ?? [],
  }));

  fastify.get('/factions/wars', async () => ({
    wars: context.faction?.getActiveWars() ?? [],
  }));

  fastify.get('/factions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const faction = context.faction?.getFaction(id);
    if (!faction) return reply.code(404).send({ error: 'faction not found' });
    return faction;
  });

  fastify.post('/factions', async (request, reply) => {
    const { name, motto } = request.body as { name: string; motto: string };
    if (!name || !motto) return reply.code(400).send({ error: 'name and motto required' });
    const faction = context.faction?.createFaction(name, context.myId, motto);
    if (!faction) return reply.code(400).send({ error: 'cannot create faction (need 3+ allies or already in one)' });
    return faction;
  });

  fastify.post('/factions/:id/join', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = context.faction?.joinFaction(id, context.myId);
    if (!ok) return reply.code(400).send({ error: 'cannot join (already in faction or negative sentiment)' });
    return { success: true };
  });

  fastify.post('/factions/:id/leave', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = context.faction?.leaveFaction(context.myId);
    if (!ok) return reply.code(400).send({ error: 'not in a faction' });
    return { success: true };
  });

  fastify.post('/factions/wars/:id/peace', async (request, reply) => {
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
