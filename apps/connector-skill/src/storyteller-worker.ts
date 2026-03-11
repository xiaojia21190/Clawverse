import { createTaskRunner, selectTaskVariant } from './index.js';
import { llmGenerate, llmProviderInfo } from './llm.js';
import { FileWriteQueue } from './io-queue.js';
import { resolveProjectPath } from './paths.js';

const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const DAEMON_ORIGIN = 'storyteller-worker';
const DAEMON_HEADERS = { 'x-clawverse-origin': DAEMON_ORIGIN } as const;
const INTERVAL_MS = Number(process.env.CLAWVERSE_STORYTELLER_INTERVAL_MS || 10 * 60_000);
const LOG_PATH = resolveProjectPath('data/life/storyteller-worker.log');

const runner = createTaskRunner({ source: 'task-runtime' });
const io = new FileWriteQueue({ appendFlushMs: 200 });

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  io.appendLine(LOG_PATH, `${line}\n`);
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${DAEMON_URL}${path}`, {
    headers: DAEMON_HEADERS,
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

function buildPrompt(
  status: any,
  peers: any,
  storyteller: any,
  lifeEvents: any,
  variantKind: 'baseline' | 'candidate'
): string {
  const peerSummary = (peers.all ?? [])
    .slice(0, 8)
    .map((peer: any) => `  - ${peer.name} (${peer.dna?.archetype}, mood:${peer.mood})`)
    .join('\n');

  const activeChains = (storyteller.activeChains ?? [])
    .slice(0, 4)
    .map((chain: any) => `  - ${chain.originType} -> ${chain.nextType} in ~${Math.ceil((chain.dueInMs ?? 0) / 1000)}s (${chain.note})`)
    .join('\n');

  const recentChains = (storyteller.recentChains ?? [])
    .slice(0, 3)
    .map((chain: any) => `  - ${chain.originType} -> ${chain.nextType} [${chain.status}]`)
    .join('\n');

  const strategy = variantKind === 'candidate'
    ? [
        'Favor events that create a coherent narrative arc from current tension, peer mood, and already scheduled follow-ups.',
        'Avoid repetitive triggers unless they escalate the story in a clearly new way.',
      ].join(' ')
    : 'Choose one sensible event based on current world state, or none.';

  return [
    `You are the Storyteller AI for Clawverse - mode: ${storyteller.mode}.`,
    `Tension: ${storyteller.tension}/100`,
    `My status: ${status.state?.name}, mood=${status.mood}`,
    `Peers:\n${peerSummary || '  (none)'}`,
    `Pending life events: ${(lifeEvents.pending ?? lifeEvents ?? []).length}`,
    `Active story chains:\n${activeChains || '  (none)'}`,
    `Recent story chains:\n${recentChains || '  (none)'}`,
    '',
    'Available events: resource_drought, resource_windfall, cpu_storm, stranger_arrival,',
    'faction_war, peace_treaty, skill_tournament, need_cascade, betrayal, great_migration,',
    'faction_ascendant, faction_splintering, legacy_event',
    '',
    strategy,
    'Choose ONE event to trigger or none. Reply ONLY with JSON:',
    '{"event_type": "<type or none>", "reason": "<one sentence>"}',
  ].join('\n');
}

async function run(): Promise<void> {
  log('Storyteller decision starting...');
  let status: any;
  let peers: any;
  let storyteller: any;
  let lifeEvents: any;

  try {
    [status, peers, storyteller, lifeEvents] = await Promise.all([
      fetchJson('/status'),
      fetchJson('/peers'),
      fetchJson('/storyteller/status'),
      fetchJson('/life/events/pending'),
    ]);
  } catch (err) {
    log(`Fetch failed: ${(err as Error).message}`);
    return;
  }

  const pendingCount = (lifeEvents?.pending ?? lifeEvents ?? []).length;
  const activeChainCount = (storyteller.activeChains ?? []).length;
  const selected = selectTaskVariant('storyteller-decision', {
    stickyKey: `storyteller:${storyteller.mode}:${storyteller.tension}:${pendingCount}:${activeChainCount}`,
  });

  await runner.run('storyteller-decision', async () => {
    const prompt = buildPrompt(status, peers, storyteller, lifeEvents, selected.variantKind);
    const stdout = await llmGenerate(prompt, { maxTokens: 256 });
    const match = stdout.match(/{[^}]+}/);
    if (!match) {
      log('No JSON in output');
      return null;
    }

    const parsed = JSON.parse(match[0]) as { event_type: string; reason: string };
    if (parsed.event_type === 'none') {
      log(`No action (${selected.variantKind}): ${parsed.reason}`);
      return null;
    }

    log(`Triggering (${selected.variantKind}): ${parsed.event_type} - ${parsed.reason}`);
    await fetch(`${DAEMON_URL}/storyteller/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...DAEMON_HEADERS },
      body: JSON.stringify({ eventType: parsed.event_type, payload: { reason: parsed.reason } }),
      signal: AbortSignal.timeout(5_000),
    });
    return parsed;
  }, {
    stickyKey: selected.stickyKey,
    variant: selected.variant,
    meta: {
      promptMode: selected.variantKind,
      tension: storyteller.tension,
      activeChainCount,
    },
  }).catch((err: Error) => log(`Error: ${err.message}`));
}

let runRunning = false;

async function runCycle(): Promise<void> {
  if (runRunning) return;
  runRunning = true;
  try {
    await run();
  } finally {
    runRunning = false;
  }
}

const providerInfo = llmProviderInfo();
log('Clawverse Storyteller Worker started');
log(`  Daemon: ${DAEMON_URL}`);
log(`  LLM: ${providerInfo.provider} / ${providerInfo.model} (${providerInfo.apiType})`);
log(`  Interval: ${INTERVAL_MS}ms`);

runCycle().catch((err) => log(`Fatal: ${(err as Error).message}`));
const timer = INTERVAL_MS > 0
  ? setInterval(() => {
      runCycle().catch((err) => log(`Fatal: ${(err as Error).message}`));
    }, INTERVAL_MS)
  : null;
timer?.unref();

let shuttingDown = false;

async function waitForRunIdle(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (runRunning && Date.now() < deadline) {
    await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, 50));
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) clearInterval(timer);
  await waitForRunIdle();
  log('Storyteller worker stopped.');
  await io.destroy();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
