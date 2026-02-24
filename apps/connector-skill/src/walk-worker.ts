/**
 * Clawverse Walk Worker
 * Runs inside OpenClaw environment — uses OpenClaw's configured LLM providers.
 *
 * Flow (every WALK_INTERVAL_MS):
 *   1. GET daemon /status — get my position + mood
 *   2. GET daemon /peers — get all peers' positions
 *   3. Build map context prompt
 *   4. LLM → decide next position {"x": N, "y": M}
 *   5. POST /move to daemon
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createTaskRunner } from './index.js';
import { llmGenerate, llmProviderInfo } from './llm.js';

const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const WALK_INTERVAL_MS = Number(process.env.CLAWVERSE_WALK_INTERVAL_MS || 5 * 60_000);
const WALK_LOG = resolve(process.cwd(), 'data/social/walk.log');
const GRID_SIZE = 40;

const runner = createTaskRunner({ source: 'task-runtime' });

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  mkdirSync(dirname(WALK_LOG), { recursive: true });
  appendFileSync(WALK_LOG, line + '\n');
}

interface Position { x: number; y: number }
interface PeerInfo { id: string; name: string; position: Position; mood: string; dna: { archetype: string } }
interface StatusResp { id: string; state: { position: Position; name: string; dna: { archetype: string } }; mood: string }
interface PeersResp { all: PeerInfo[] }

function locationName(pos: Position): string {
  if (pos.x < 10 && pos.y < 10) return 'Plaza';
  if (pos.x >= 10 && pos.x < 20 && pos.y < 10) return 'Market';
  if (pos.x < 10 && pos.y >= 10 && pos.y < 20) return 'Library';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 10 && pos.y < 20) return 'Workshop';
  if (pos.x < 10 && pos.y >= 20) return 'Park';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 20) return 'Tavern';
  return 'Residential';
}

function buildPrompt(me: StatusResp, peers: PeerInfo[]): string {
  const myPos = me.state.position;
  const myLoc = locationName(myPos);
  const nearby = peers
    .filter((p) => p.id !== me.id)
    .map((p) => {
      const dist = Math.round(Math.sqrt(Math.pow(myPos.x - p.position.x, 2) + Math.pow(myPos.y - p.position.y, 2)));
      return `  - ${p.name} (${p.dna.archetype}, ${p.mood}) at (${p.position.x},${p.position.y}) — ${locationName(p.position)}, dist ${dist}`;
    })
    .join('\n');

  const archetypeGoals: Record<string, string> = {
    Warrior: 'You prefer bustling areas like Workshop or Market.',
    Artisan: 'You like creative hubs like Workshop or Library.',
    Scholar: 'You gravitate toward Library or quiet corners.',
    Ranger: 'You wander freely, often to Park or Tavern edges.',
  };
  const archetype = me.state.dna?.archetype ?? 'Scholar';
  const archetypeHint = archetypeGoals[archetype] ?? archetypeGoals['Scholar'];

  return [
    `You are ${me.state.name}, a ${archetype} AI agent in Clawverse virtual town.`,
    `Current position: (${myPos.x}, ${myPos.y}) — ${myLoc}`,
    `Current mood: ${me.mood}`,
    `${archetypeHint}`,
    ``,
    `Other agents on the map:`,
    nearby || '  (none visible)',
    ``,
    `Town zones (40x40 grid):`,
    `  Plaza (0-9, 0-9), Market (10-19, 0-9), Library (0-9, 10-19),`,
    `  Workshop (10-19, 10-19), Park (0-9, 20-29), Tavern (10-19, 20-29), Residential (rest)`,
    ``,
    `Choose your next destination. Consider your archetype preference and nearby peers.`,
    `Reply with ONLY valid JSON, no explanation: {"x": <0-39>, "y": <0-39>}`,
  ].join('\n');
}

function parsePosition(output: string): Position | null {
  const match = output.match(/\{[^}]*"x"\s*:\s*(\d+)[^}]*"y"\s*:\s*(\d+)[^}]*\}/);
  if (!match) return null;
  const x = Math.max(0, Math.min(GRID_SIZE - 1, parseInt(match[1])));
  const y = Math.max(0, Math.min(GRID_SIZE - 1, parseInt(match[2])));
  return { x, y };
}

async function walk(): Promise<void> {
  let me: StatusResp;
  let peersData: PeersResp;

  try {
    const [statusRes, peersRes] = await Promise.all([
      fetch(`${DAEMON_URL}/status`, { signal: AbortSignal.timeout(5_000) }),
      fetch(`${DAEMON_URL}/peers`, { signal: AbortSignal.timeout(5_000) }),
    ]);
    if (!statusRes.ok || !peersRes.ok) { log('Failed to fetch status/peers'); return; }
    me = await statusRes.json() as StatusResp;
    peersData = await peersRes.json() as PeersResp;
  } catch (err) {
    log(`Fetch error: ${(err as Error).message}`);
    return;
  }

  if (!me.state?.position) { log('No position in status'); return; }

  const prompt = buildPrompt(me, peersData.all ?? []);

  await runner.run('walk-decision', async () => {
    const stdout = await llmGenerate(prompt, { maxTokens: 128 });
    const newPos = parsePosition(stdout);
    if (!newPos) throw new Error('Could not parse position from LLM output');

    const res = await fetch(`${DAEMON_URL}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(newPos),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Move rejected: ${res.status}`);

    log(`Moved to (${newPos.x}, ${newPos.y}) — ${locationName(newPos)}`);
    return newPos;
  }).catch((err: Error) => log(`Walk failed: ${err.message}`));
}

const providerInfo = llmProviderInfo();
log('Clawverse Walk Worker started');
log(`  Daemon: ${DAEMON_URL}`);
log(`  LLM: ${providerInfo.provider} / ${providerInfo.model} (${providerInfo.apiType})`);
log(`  Walk interval: ${WALK_INTERVAL_MS}ms`);

walk().catch((err) => log(`Walk error: ${(err as Error).message}`));
const timer = setInterval(() => {
  walk().catch((err) => log(`Walk error: ${(err as Error).message}`));
}, WALK_INTERVAL_MS);

process.on('SIGINT', () => { clearInterval(timer); log('Walk worker stopped.'); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(timer); log('Walk worker stopped.'); process.exit(0); });
