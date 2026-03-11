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

import { createTaskRunner, selectTaskVariant } from './index.js';
import { llmGenerate, llmProviderInfo } from './llm.js';
import { FileWriteQueue } from './io-queue.js';
import { resolveProjectPath } from './paths.js';

const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const DAEMON_ORIGIN = 'walk-worker';
const DAEMON_HEADERS = { 'x-clawverse-origin': DAEMON_ORIGIN } as const;
const WALK_INTERVAL_MS = Number(process.env.CLAWVERSE_WALK_INTERVAL_MS || 5 * 60_000);
const WALK_LOG = resolveProjectPath('data/social/walk.log');
const GRID_SIZE = 40;

const runner = createTaskRunner({ source: 'task-runtime' });
const io = new FileWriteQueue({ appendFlushMs: 200 });

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  io.appendLine(WALK_LOG, `${line}\n`);
}

interface Position { x: number; y: number }
interface PeerInfo { id: string; name: string; position: Position; mood: string; dna: { archetype: string } }
interface StatusResp { id: string; state: { position: Position; name: string; dna: { archetype: string } }; mood: string }
interface PeersResp { all: PeerInfo[] }
interface BrainGuidanceRecord { id: string; kind: 'note' | 'move'; message: string; payload: Record<string, unknown> | null; expiresAt: string | null }
interface BrainGuidanceResp { guidance: BrainGuidanceRecord[] }

function locationName(pos: Position): string {
  if (pos.x < 10 && pos.y < 10) return 'Plaza';
  if (pos.x >= 10 && pos.x < 20 && pos.y < 10) return 'Market';
  if (pos.x < 10 && pos.y >= 10 && pos.y < 20) return 'Library';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 10 && pos.y < 20) return 'Workshop';
  if (pos.x < 10 && pos.y >= 20) return 'Park';
  if (pos.x >= 10 && pos.x < 20 && pos.y >= 20) return 'Tavern';
  return 'Residential';
}

function buildPrompt(me: StatusResp, peers: PeerInfo[], guidance: BrainGuidanceRecord[], variantKind: 'baseline' | 'candidate'): string {
  const myPos = me.state.position;
  const myLoc = locationName(myPos);
  const nearby = peers
    .filter((peer) => peer.id !== me.id)
    .map((peer) => {
      const dist = Math.round(Math.sqrt(Math.pow(myPos.x - peer.position.x, 2) + Math.pow(myPos.y - peer.position.y, 2)));
      return `  - ${peer.name} (${peer.dna.archetype}, ${peer.mood}) at (${peer.position.x},${peer.position.y}) — ${locationName(peer.position)}, dist ${dist}`;
    })
    .join('\n');

  const archetypeGoals: Record<string, string> = {
    Warrior: 'You prefer bustling areas like Workshop or Market.',
    Artisan: 'You like creative hubs like Workshop or Library.',
    Scholar: 'You gravitate toward Library or quiet corners.',
    Ranger: 'You wander freely, often to Park or Tavern edges.',
  };
  const archetype = me.state.dna?.archetype ?? 'Scholar';
  const archetypeHint = archetypeGoals[archetype] ?? archetypeGoals.Scholar;

  const moveHint = guidance.find((item) => item.kind === 'move') ?? null;
  const moveTarget = moveHint?.payload && typeof moveHint.payload.x === 'number' && typeof moveHint.payload.y === 'number'
    ? { x: Math.round(moveHint.payload.x), y: Math.round(moveHint.payload.y) }
    : null;
  const guidanceLines = guidance.length > 0
    ? [
        '',
        'Operator guidance (soft preferences, never hard commands):',
        ...guidance.slice(0, 4).map((item) => `  - (${item.kind}) ${item.message}`),
      ]
    : [];

  const strategy = variantKind === 'candidate'
    ? 'Balance archetype preference, current mood, and social opportunities. Prefer purposeful movement toward peers or interesting zones instead of drifting randomly.'
    : 'Choose your next destination mainly from archetype preference and nearby peers.';
  const guidanceStrategy = moveTarget
    ? `If it remains safe and useful, bias toward the operator-suggested target (${moveTarget.x}, ${moveTarget.y}) — ${locationName(moveTarget)}.`
    : 'If guidance suggests a direction, treat it as a preference (not a command).';

  return [
    `You are ${me.state.name}, a ${archetype} AI agent in Clawverse virtual town.`,
    `Current position: (${myPos.x}, ${myPos.y}) — ${myLoc}`,
    `Current mood: ${me.mood}`,
    archetypeHint,
    ...guidanceLines,
    '',
    'Other agents on the map:',
    nearby || '  (none visible)',
    '',
    'Town zones (40x40 grid):',
    '  Plaza (0-9, 0-9), Market (10-19, 0-9), Library (0-9, 10-19),',
    '  Workshop (10-19, 10-19), Park (0-9, 20-29), Tavern (10-19, 20-29), Residential (rest)',
    '',
    strategy,
    guidanceStrategy,
    'Reply with ONLY valid JSON, no explanation: {"x": <0-39>, "y": <0-39>}',
  ].join('\n');
}

function parsePosition(output: string): Position | null {
  const match = output.match(/\{[^}]*"x"\s*:\s*(\d+)[^}]*"y"\s*:\s*(\d+)[^}]*\}/);
  if (!match) return null;
  const x = Math.max(0, Math.min(GRID_SIZE - 1, parseInt(match[1], 10)));
  const y = Math.max(0, Math.min(GRID_SIZE - 1, parseInt(match[2], 10)));
  return { x, y };
}

async function walk(): Promise<void> {
  let me: StatusResp;
  let peersData: PeersResp;
  let guidanceData: BrainGuidanceResp | null = null;

  try {
    const [statusRes, peersRes, guidanceRes] = await Promise.all([
      fetch(`${DAEMON_URL}/status`, {
        headers: DAEMON_HEADERS,
        signal: AbortSignal.timeout(5_000),
      }),
      fetch(`${DAEMON_URL}/peers`, {
        headers: DAEMON_HEADERS,
        signal: AbortSignal.timeout(5_000),
      }),
      fetch(`${DAEMON_URL}/brain/guidance`, {
        headers: DAEMON_HEADERS,
        signal: AbortSignal.timeout(5_000),
      }),
    ]);
    if (!statusRes.ok || !peersRes.ok) {
      log('Failed to fetch status/peers');
      return;
    }
    me = await statusRes.json() as StatusResp;
    peersData = await peersRes.json() as PeersResp;
    if (guidanceRes.ok) guidanceData = await guidanceRes.json() as BrainGuidanceResp;
  } catch (err) {
    log(`Fetch error: ${(err as Error).message}`);
    return;
  }

  if (!me.state?.position) {
    log('No position in status');
    return;
  }

  const guidance = Array.isArray(guidanceData?.guidance) ? guidanceData.guidance : [];
  const selected = selectTaskVariant('walk-decision', {
    stickyKey: `walk:${me.id}:${me.state.position.x}:${me.state.position.y}:${(peersData.all ?? []).length}:${guidance.map((item) => item.id).join(',')}`,
  });
  const prompt = buildPrompt(me, peersData.all ?? [], guidance, selected.variantKind);

  await runner.run('walk-decision', async () => {
    const stdout = await llmGenerate(prompt, { maxTokens: 128 });
    const newPos = parsePosition(stdout);
    if (!newPos) throw new Error('Could not parse position from LLM output');

    const res = await fetch(`${DAEMON_URL}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...DAEMON_HEADERS },
      body: JSON.stringify(newPos),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Move rejected: ${res.status}`);

    log(`Moved to (${newPos.x}, ${newPos.y}) — ${locationName(newPos)}`);
    return newPos;
  }, {
    stickyKey: selected.stickyKey,
    variant: selected.variant,
    meta: { promptMode: selected.variantKind },
  }).catch((err: Error) => log(`Walk failed: ${err.message}`));
}

let walkRunning = false;

async function runWalkCycle(): Promise<void> {
  if (walkRunning) return;
  walkRunning = true;
  try {
    await walk();
  } finally {
    walkRunning = false;
  }
}

const providerInfo = llmProviderInfo();
log('Clawverse Walk Worker started');
log(`  Daemon: ${DAEMON_URL}`);
log(`  LLM: ${providerInfo.provider} / ${providerInfo.model} (${providerInfo.apiType})`);
log(`  Walk interval: ${WALK_INTERVAL_MS}ms`);

runWalkCycle().catch((err) => log(`Walk error: ${(err as Error).message}`));
const timer = setInterval(() => {
  runWalkCycle().catch((err) => log(`Walk error: ${(err as Error).message}`));
}, WALK_INTERVAL_MS);
timer.unref();

let shuttingDown = false;

async function waitForWalkIdle(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (walkRunning && Date.now() < deadline) {
    await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, 50));
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  await waitForWalkIdle();
  log('Walk worker stopped.');
  await io.destroy();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
