import { resolve } from 'node:path';
import { createTaskRunner } from './index.js';
import { llmGenerate, llmProviderInfo } from './llm.js';
import { FileWriteQueue } from './io-queue.js';

const DAEMON_URL    = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const POLL_INTERVAL = Number(process.env.CLAWVERSE_LIFE_POLL_MS || 90_000);
const LIFE_LOG      = resolve(process.cwd(), 'data/life/worker.log');

const runner = createTaskRunner({ source: 'task-runtime' });
const io = new FileWriteQueue({ appendFlushMs: 200 });

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  io.appendLine(LIFE_LOG, `${line}\n`);
}

interface LifeEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

interface StatusResp {
  state: {
    name: string;
    dna: { archetype: string };
    position: { x: number; y: number };
  };
  mood: string;
}

interface NeedsState { social: number; tasked: number; wanderlust: number; creative: number }
interface SkillsState { social: { level: number }; collab: { level: number }; explorer: { level: number }; analyst: { level: number } }

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${DAEMON_URL}${path}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch { return null; }
}

function buildPrompt(event: LifeEvent, me: StatusResp, needs: NeedsState, skills: SkillsState): string {
  const needsSummary = Object.entries(needs)
    .map(([k, v]) => `${k}: ${Math.round(v as number)}`)
    .join(', ');
  const skillsSummary = (Object.entries(skills) as [string, { level: number }][])
    .filter(([k]) => k !== 'updatedAt')
    .map(([k, v]) => `${k} lv${v.level}`)
    .join(', ');

  return [
    `You are ${me.state.name}, a ${me.state.dna.archetype} AI agent in Clawverse virtual town.`,
    `Current mood: ${me.mood}`,
    `Current needs (0-100, lower = more urgent): ${needsSummary}`,
    `Skills: ${skillsSummary}`,
    ``,
    `Life event: ${event.type}`,
    `Details: ${JSON.stringify(event.payload)}`,
    ``,
    `Choose how to respond. Available actions:`,
    `  social  — initiate a social interaction with a nearby peer`,
    `  move    — walk to a new location in the town`,
    `  collab  — send a collaboration request to an ally`,
    `  reflect — do nothing, internalize the experience`,
    ``,
    `Reply with ONLY valid JSON, no explanation:`,
    `{"action":"social"|"move"|"collab"|"reflect","reason":"<one sentence>"}`,
  ].join('\n');
}

async function executeAction(action: string): Promise<void> {
  if (action === 'move') {
    const x = Math.floor(Math.random() * 40);
    const y = Math.floor(Math.random() * 40);
    await fetch(`${DAEMON_URL}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x, y }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
    log(`  Action: move → (${x}, ${y})`);
    return;
  }

  if (action === 'collab') {
    const rels = await fetchJson<{ peerId: string; tier: string }[]>('/life/relationships');
    const ally = rels?.find(r => r.tier === 'ally');
    if (ally) {
      await fetch(`${DAEMON_URL}/collab/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: ally.peerId,
          context: 'I am experiencing a life event and could use some perspective.',
          question: 'What do you think I should focus on right now?',
        }),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {});
      log(`  Action: collab → ${ally.peerId}`);
    } else {
      log('  Action: collab — no ally found, reflecting instead');
    }
    return;
  }

  if (action === 'social') {
    log('  Action: social — awaiting next social-worker scan cycle');
    return;
  }

  log('  Action: reflect');
}

async function poll(): Promise<void> {
  const events = await fetchJson<LifeEvent[]>('/life/events/pending');
  if (!events?.length) return;

  log(`Processing ${events.length} life event(s)...`);

  const [me, needs, skills] = await Promise.all([
    fetchJson<StatusResp>('/status'),
    fetchJson<NeedsState>('/life/needs'),
    fetchJson<SkillsState>('/life/skills'),
  ]);

  if (!me || !needs || !skills) { log('Could not fetch context, skipping'); return; }

  for (const event of events) {
    log(`  [${event.type}] ${JSON.stringify(event.payload)}`);

    await runner.run('life-response', async () => {
      const prompt = buildPrompt(event, me, needs, skills);
      const stdout = await llmGenerate(prompt, { maxTokens: 256 });

      let action = 'reflect';
      try {
        const parsed = JSON.parse(stdout.match(/\{[^}]+\}/)?.[0] ?? '{}');
        if (['social', 'move', 'collab', 'reflect'].includes(parsed.action)) {
          action = parsed.action;
          log(`  Decision: ${action} — ${parsed.reason ?? ''}`);
        }
      } catch { log('  Could not parse action, defaulting to reflect'); }

      await executeAction(action);

      await fetch(`${DAEMON_URL}/life/events/resolve/${event.id}`, {
        method: 'POST', signal: AbortSignal.timeout(5_000),
      }).catch(() => {});

      return action;
    }).catch((err: Error) => log(`  Event failed: ${err.message}`));
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
log('Clawverse Life Worker started');
log(`  Daemon: ${DAEMON_URL}`);
log(`  LLM: ${providerInfo.provider} / ${providerInfo.model} (${providerInfo.apiType})`);
log(`  Poll interval: ${POLL_INTERVAL}ms`);

runPollCycle().catch(err => log(`Poll error: ${(err as Error).message}`));
const timer = setInterval(() => {
  runPollCycle().catch(err => log(`Poll error: ${(err as Error).message}`));
}, POLL_INTERVAL);
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
  log('Life worker stopped.');
  await io.destroy();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
