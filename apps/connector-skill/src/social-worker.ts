/**
 * Clawverse Social Worker
 * Runs inside OpenClaw environment — uses OpenClaw's configured LLM providers.
 *
 * Flow:
 *   1. Poll daemon GET /social/pending every 30s
 *   2. For each pending event:
 *      a. Load peer memory from data/social/memories/<peerId>.json
 *      b. Generate dialogue via OpenClaw LLM provider
 *      c. POST /social/resolve with dialogue
 *      d. Save notable dialogue snippet to peer memory file
 *      e. Send Telegram notification (reuses OpenClaw TG config)
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTaskRunner, selectTaskVariant } from './index.js';
import { llmGenerate, llmProviderInfo } from './llm.js';
import { FileWriteQueue } from './io-queue.js';
import { resolveProjectPath } from './paths.js';

const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const POLL_INTERVAL_MS = Number(process.env.CLAWVERSE_SOCIAL_POLL_MS || 30_000);
const MEMORIES_DIR = resolveProjectPath('data/social/memories');
const WORKER_LOG = resolveProjectPath('data/social/worker.log');
const MAX_MEMORY_SNIPPETS = 5;

const TG_BOT_TOKEN = process.env.CLAWVERSE_TELEGRAM_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.CLAWVERSE_TELEGRAM_CHAT_ID || '';
const NOTIFY_TRIGGERS = new Set(['new-peer']);

const runner = createTaskRunner({ source: 'task-runtime' });
const io = new FileWriteQueue({ appendFlushMs: 200, stateDebounceMs: 50 });
const memoryCache = new Map<string, PeerMemory>();

interface PendingEvent {
  id: string;
  ts: string;
  trigger: 'new-peer' | 'proximity' | 'random';
  from: string;
  fromActorId?: string;
  fromSessionId?: string;
  fromName: string;
  fromArchetype: string;
  fromMood: string;
  fromCpu: number;
  fromPos: { x: number; y: number };
  to: string;
  toActorId?: string;
  toSessionId?: string;
  toName: string;
  toArchetype: string;
  toMood: string;
  location: string;
  sentimentBefore: number;
  meetCount: number;
}

interface PeerMemory {
  actorId: string;
  peerIds: string[];
  recentDialogues: string[];
  lastUpdated: string;
}

function memoryKey(peerId: string, actorId?: string): string {
  return actorId || peerId;
}

function memoryPath(key: string): string {
  return resolve(MEMORIES_DIR, `${key}.json`);
}

function loadMemory(peerId: string, actorId?: string): PeerMemory {
  const key = memoryKey(peerId, actorId);
  const cached = memoryCache.get(key);
  if (cached) {
    return {
      actorId: cached.actorId,
      peerIds: [...cached.peerIds],
      recentDialogues: [...cached.recentDialogues],
      lastUpdated: cached.lastUpdated,
    };
  }

  const actorPath = memoryPath(key);
  const legacyPath = actorId && actorId !== peerId ? memoryPath(peerId) : actorPath;
  const sourcePath = existsSync(actorPath) ? actorPath : (existsSync(legacyPath) ? legacyPath : null);
  const empty: PeerMemory = { actorId: actorId ?? key, peerIds: [peerId], recentDialogues: [], lastUpdated: new Date().toISOString() };
  if (!sourcePath) {
    memoryCache.set(key, empty);
    return { ...empty, peerIds: [...empty.peerIds], recentDialogues: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(sourcePath, 'utf8')) as PeerMemory & { peerId?: string };
    const normalized: PeerMemory = {
      actorId: actorId ?? parsed.actorId ?? parsed.peerId ?? key,
      peerIds: Array.from(new Set([peerId, ...(Array.isArray(parsed.peerIds) ? parsed.peerIds : []), parsed.peerId].filter((value): value is string => typeof value === 'string' && value.length > 0))),
      recentDialogues: Array.isArray(parsed.recentDialogues) ? parsed.recentDialogues : [],
      lastUpdated: parsed.lastUpdated || new Date().toISOString(),
    };
    memoryCache.set(key, normalized);
    return { ...normalized, peerIds: [...normalized.peerIds], recentDialogues: [...normalized.recentDialogues] };
  } catch {
    memoryCache.set(key, empty);
    return { ...empty, peerIds: [...empty.peerIds], recentDialogues: [] };
  }
}

function saveMemory(peerId: string, actorId: string | undefined, dialogue: string): void {
  const key = memoryKey(peerId, actorId);
  const memory = loadMemory(peerId, actorId);
  memory.actorId = actorId ?? memory.actorId ?? key;
  memory.peerIds = Array.from(new Set([peerId, ...memory.peerIds]));
  memory.recentDialogues = [dialogue, ...memory.recentDialogues].slice(0, MAX_MEMORY_SNIPPETS);
  memory.lastUpdated = new Date().toISOString();
  memoryCache.set(key, { ...memory, peerIds: [...memory.peerIds], recentDialogues: [...memory.recentDialogues] });
  io.scheduleStateWrite(memoryPath(key), memory);
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  io.appendLine(WORKER_LOG, `${line}\n`);
}

function buildPrompt(event: PendingEvent, memory: PeerMemory, variantKind: 'baseline' | 'candidate'): string {
  const relationshipLabel =
    event.sentimentBefore > 0.8 ? 'Close friend' :
    event.sentimentBefore > 0.3 ? 'Acquaintance' :
    event.sentimentBefore < -0.3 ? 'Stranger (avoided)' :
    'Neutral acquaintance';

  const memoryContext = memory.recentDialogues.length > 0
    ? [
        `Past conversations with ${event.toName}:`,
        ...memory.recentDialogues.map((dialogue, index) => `  ${index + 1}. "${dialogue}"`),
      ].join('\n')
    : '';

  const triggerContext =
    event.trigger === 'new-peer' ? `${event.toName} just joined the town!` :
    event.trigger === 'proximity' ? `You're near ${event.toName} at ${event.location}.` :
    'You feel like chatting while idle.';

  const variantInstruction = variantKind === 'candidate'
    ? [
        `Speak naturally in 2-3 short sentences, staying in character as a ${event.fromArchetype} AI agent.`,
        'Reference the current location or mood when it helps, and reuse one memory detail naturally if available.',
        'End with one small intention or invitation so the exchange feels more alive.',
      ].join(' ')
    : `Speak naturally in 1-2 sentences, staying in character as a ${event.fromArchetype} AI agent. Be warm but brief.`;

  return [
    `You are in Clawverse virtual town at ${event.location}.`,
    '',
    'Your identity:',
    `  Name: ${event.fromName}`,
    `  Archetype: ${event.fromArchetype}`,
    `  CPU usage: ${event.fromCpu}%`,
    `  Mood: ${event.fromMood}`,
    '',
    `You ${event.trigger === 'new-peer' ? 'welcome' : 'meet'}: ${event.toName}`,
    `  Archetype: ${event.toArchetype}`,
    `  Mood: ${event.toMood}`,
    `  Relationship: ${relationshipLabel} (met ${event.meetCount} times)`,
    memoryContext,
    '',
    `Context: ${triggerContext}`,
    '',
    variantInstruction,
  ].filter(Boolean).join('\n');
}

async function generateDialogue(event: PendingEvent, variantKind: 'baseline' | 'candidate'): Promise<string> {
  const memory = loadMemory(event.to, event.toActorId);
  const prompt = buildPrompt(event, memory, variantKind);

  try {
    const dialogue = await llmGenerate(prompt, { maxTokens: 256 });
    if (dialogue) {
      saveMemory(event.to, event.toActorId, dialogue);
    }
    return dialogue;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`LLM generation failed: ${message}`);
    return `[${event.fromName} nods at ${event.toName}]`;
  }
}

async function sendTelegram(event: PendingEvent, dialogue: string): Promise<void> {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  if (!NOTIFY_TRIGGERS.has(event.trigger)) return;

  const text = [
    '🦀 *Clawverse Social Event*',
    `Trigger: ${event.trigger} @ ${event.location}`,
    `${event.fromName} (${event.fromArchetype}) → ${event.toName} (${event.toArchetype})`,
    dialogue ? `"${dialogue}"` : '*(silent encounter)*',
  ].join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    log(`Telegram failed: ${(err as Error).message}`);
  }
}

async function fetchPending(): Promise<PendingEvent[]> {
  try {
    const res = await fetch(`${DAEMON_URL}/social/pending`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    return (await res.json()) as PendingEvent[];
  } catch {
    return [];
  }
}

async function resolveEvent(id: string, dialogue: string): Promise<boolean> {
  try {
    const res = await fetch(`${DAEMON_URL}/social/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, dialogue }),
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function poll(): Promise<void> {
  const pending = await fetchPending();
  if (pending.length === 0) return;

  log(`Processing ${pending.length} pending social event(s)...`);

  for (const event of pending) {
    log(`  [${event.trigger}] ${event.fromName} → ${event.toName}`);
    const selected = selectTaskVariant('social-dialogue', { stickyKey: event.id });

    const dialogue = await runner.run('social-dialogue', async () => {
      const text = await generateDialogue(event, selected.variantKind);
      const ok = await resolveEvent(event.id, text);
      if (!ok) throw new Error(`Failed to resolve event ${event.id}`);
      return text;
    }, {
      stickyKey: event.id,
      variant: selected.variant,
      meta: { promptMode: selected.variantKind },
    }).catch((err: Error) => {
      log(`  Failed: ${err.message}`);
      return null;
    });

    if (dialogue) {
      log(`  Resolved: "${dialogue.slice(0, 80)}"`);
      await sendTelegram(event, dialogue);
    }
  }
}

let pollRunning = false;

async function runPollCycle(): Promise<void> {
  if (pollRunning) return;
  pollRunning = true;
  try {
    await poll();
  } finally {
    pollRunning = false;
  }
}

const providerInfo = llmProviderInfo();
log('Clawverse Social Worker started');
log(`  Daemon: ${DAEMON_URL}`);
log(`  LLM: ${providerInfo.provider} / ${providerInfo.model} (${providerInfo.apiType})`);
log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
log(`  Telegram: ${TG_BOT_TOKEN ? 'enabled' : 'disabled'}`);

runPollCycle().catch((err) => log(`Poll error: ${(err as Error).message}`));
const timer = setInterval(() => {
  runPollCycle().catch((err) => log(`Poll error: ${(err as Error).message}`));
}, POLL_INTERVAL_MS);
timer.unref();

let shuttingDown = false;

async function waitForPollIdle(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (pollRunning && Date.now() < deadline) {
    await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, 50));
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  await waitForPollIdle();
  log('Social worker stopped.');
  await io.destroy();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });