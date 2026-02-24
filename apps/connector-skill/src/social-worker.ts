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

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createTaskRunner } from './index.js';
import { llmGenerate, llmProviderInfo } from './llm.js';

// ─── Config ────────────────────────────────────────────────────────────────

const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const POLL_INTERVAL_MS = Number(process.env.CLAWVERSE_SOCIAL_POLL_MS || 30_000);
const MEMORIES_DIR = resolve(process.cwd(), 'data/social/memories');
const WORKER_LOG = resolve(process.cwd(), 'data/social/worker.log');
const MAX_MEMORY_SNIPPETS = 5;

// Telegram (same env vars as evolve:notify)
const TG_BOT_TOKEN = process.env.CLAWVERSE_TELEGRAM_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.CLAWVERSE_TELEGRAM_CHAT_ID || '';
const NOTIFY_TRIGGERS = new Set(['new-peer']);

const runner = createTaskRunner({ source: 'task-runtime' });

// ─── Types ──────────────────────────────────────────────────────────────────

interface PendingEvent {
  id: string;
  ts: string;
  trigger: 'new-peer' | 'proximity' | 'random';
  from: string;
  fromName: string;
  fromArchetype: string;
  fromMood: string;
  fromCpu: number;
  fromPos: { x: number; y: number };
  to: string;
  toName: string;
  toArchetype: string;
  toMood: string;
  location: string;
  sentimentBefore: number;
  meetCount: number;
}

interface PeerMemory {
  peerId: string;
  recentDialogues: string[];
  lastUpdated: string;
}

// ─── Memory helpers ─────────────────────────────────────────────────────────

function memoryPath(peerId: string): string {
  return resolve(MEMORIES_DIR, `${peerId}.json`);
}

function loadMemory(peerId: string): PeerMemory {
  const path = memoryPath(peerId);
  if (!existsSync(path)) {
    return { peerId, recentDialogues: [], lastUpdated: new Date().toISOString() };
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PeerMemory;
  } catch {
    return { peerId, recentDialogues: [], lastUpdated: new Date().toISOString() };
  }
}

function saveMemory(peerId: string, dialogue: string): void {
  mkdirSync(MEMORIES_DIR, { recursive: true });
  const mem = loadMemory(peerId);
  mem.recentDialogues = [dialogue, ...mem.recentDialogues].slice(0, MAX_MEMORY_SNIPPETS);
  mem.lastUpdated = new Date().toISOString();
  writeFileSync(memoryPath(peerId), JSON.stringify(mem, null, 2));
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  mkdirSync(dirname(WORKER_LOG), { recursive: true });
  appendFileSync(WORKER_LOG, line + '\n');
}

// ─── Dialogue generation via OpenClaw LLM ────────────────────────────────────

function buildPrompt(event: PendingEvent, memory: PeerMemory): string {
  const relationshipLabel =
    event.sentimentBefore > 0.8 ? 'Close friend' :
    event.sentimentBefore > 0.3 ? 'Acquaintance' :
    event.sentimentBefore < -0.3 ? 'Stranger (avoided)' : 'Neutral acquaintance';

  const memoryContext = memory.recentDialogues.length > 0
    ? `\nPast conversations with ${event.toName}:\n${memory.recentDialogues.map((d, i) => `  ${i + 1}. "${d}"`).join('\n')}`
    : '';

  const triggerContext =
    event.trigger === 'new-peer' ? `${event.toName} just joined the town!` :
    event.trigger === 'proximity' ? `You're near ${event.toName} at ${event.location}.` :
    `You feel like chatting while idle.`;

  return [
    `You are in Clawverse virtual town at ${event.location}.`,
    ``,
    `Your identity:`,
    `  Name: ${event.fromName}`,
    `  Archetype: ${event.fromArchetype}`,
    `  CPU usage: ${event.fromCpu}%`,
    `  Mood: ${event.fromMood}`,
    ``,
    `You ${event.trigger === 'new-peer' ? 'welcome' : 'meet'}: ${event.toName}`,
    `  Archetype: ${event.toArchetype}`,
    `  Mood: ${event.toMood}`,
    `  Relationship: ${relationshipLabel} (met ${event.meetCount} times)`,
    memoryContext,
    ``,
    `Context: ${triggerContext}`,
    ``,
    `Speak naturally in 1-2 sentences, staying in character as a ${event.fromArchetype} AI agent. Be warm but brief.`,
  ].filter(Boolean).join('\n');
}

async function generateDialogue(event: PendingEvent): Promise<string> {
  const memory = loadMemory(event.to);
  const prompt = buildPrompt(event, memory);

  try {
    const dialogue = await llmGenerate(prompt, { maxTokens: 256 });
    if (dialogue) {
      saveMemory(event.to, dialogue);
    }
    return dialogue;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`LLM generation failed: ${msg}`);
    return `[${event.fromName} nods at ${event.toName}]`;
  }
}

// ─── Telegram notification ───────────────────────────────────────────────────

async function sendTelegram(event: PendingEvent, dialogue: string): Promise<void> {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  if (!NOTIFY_TRIGGERS.has(event.trigger)) return;

  const text = [
    `🦀 *Clawverse Social Event*`,
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

// ─── Daemon HTTP calls ────────────────────────────────────────────────────────

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

// ─── Main poll loop ───────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  const pending = await fetchPending();
  if (pending.length === 0) return;

  log(`Processing ${pending.length} pending social event(s)...`);

  for (const event of pending) {
    log(`  [${event.trigger}] ${event.fromName} → ${event.toName}`);

    const dialogue = await runner.run('social-dialogue', async () => {
      const text = await generateDialogue(event);
      const ok = await resolveEvent(event.id, text);
      if (!ok) throw new Error(`Failed to resolve event ${event.id}`);
      return text;
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

// ─── Entry point ─────────────────────────────────────────────────────────────

const providerInfo = llmProviderInfo();
log('Clawverse Social Worker started');
log(`  Daemon: ${DAEMON_URL}`);
log(`  LLM: ${providerInfo.provider} / ${providerInfo.model} (${providerInfo.apiType})`);
log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
log(`  Telegram: ${TG_BOT_TOKEN ? 'enabled' : 'disabled'}`);

poll().catch((err) => log(`Poll error: ${(err as Error).message}`));
const timer = setInterval(() => {
  poll().catch((err) => log(`Poll error: ${(err as Error).message}`));
}, POLL_INTERVAL_MS);

process.on('SIGINT', () => { clearInterval(timer); log('Social worker stopped.'); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(timer); log('Social worker stopped.'); process.exit(0); });
