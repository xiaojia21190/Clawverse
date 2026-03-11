/**
 * Clawverse Collab Worker
 * Runs inside OpenClaw environment — uses OpenClaw's configured LLM providers.
 *
 * Flow (every POLL_INTERVAL_MS):
 *   1. GET /collab/pending — fetch tasks submitted by remote peers
 *   2. LLM → answer the question
 *   3. POST /collab/resolve with result
 */

import { createTaskRunner, selectTaskVariant } from './index.js';
import { llmGenerate, llmProviderInfo } from './llm.js';
import { FileWriteQueue } from './io-queue.js';
import { resolveProjectPath } from './paths.js';

const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const DAEMON_ORIGIN = 'collab-worker';
const DAEMON_HEADERS = { 'x-clawverse-origin': DAEMON_ORIGIN } as const;
const POLL_INTERVAL_MS = Number(process.env.CLAWVERSE_COLLAB_POLL_MS || 60_000);
const COLLAB_LOG = resolveProjectPath('data/collab/worker.log');

const runner = createTaskRunner({ source: 'task-runtime' });
const io = new FileWriteQueue({ appendFlushMs: 200 });

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  io.appendLine(COLLAB_LOG, `${line}\n`);
}

interface CollabTask {
  id: string;
  fromName: string;
  context: string;
  question: string;
}

function buildPrompt(task: CollabTask, variantKind: 'baseline' | 'candidate'): string {
  const instruction = variantKind === 'candidate'
    ? 'Answer concisely and helpfully. Give one direct recommendation and one brief caution or follow-up if useful.'
    : 'Answer concisely and helpfully.';

  return [
    `${task.fromName} asks for your help:`,
    '',
    task.context,
    '',
    task.question,
    '',
    instruction,
  ].join('\n');
}

async function poll(): Promise<void> {
  let tasks: CollabTask[];
  try {
    const res = await fetch(`${DAEMON_URL}/collab/pending`, {
      headers: DAEMON_HEADERS,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return;
    tasks = (await res.json()) as CollabTask[];
  } catch {
    return;
  }

  if (tasks.length === 0) return;
  log(`Processing ${tasks.length} pending collab task(s)...`);

  for (const task of tasks) {
    log(`  Task from ${task.fromName}: "${task.question.slice(0, 60)}"`);
    const selected = selectTaskVariant('collab-execution', { stickyKey: task.id });
    const prompt = buildPrompt(task, selected.variantKind);

    let result = '';
    let success = false;

    try {
      result = await runner.run('collab-execution', async () => {
        const text = await llmGenerate(prompt, { maxTokens: 512 });
        if (!text) throw new Error('Empty LLM response');
        return text;
      }, {
        stickyKey: task.id,
        variant: selected.variant,
        meta: { promptMode: selected.variantKind },
      });
      success = true;
    } catch (err) {
      log(`  LLM generation failed: ${(err as Error).message}`);
    }

    try {
      const res = await fetch(`${DAEMON_URL}/collab/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...DAEMON_HEADERS },
        body: JSON.stringify({ id: task.id, result, success }),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        log(`  Resolved: "${result.slice(0, 80)}"`);
      } else {
        log(`  Resolve rejected: ${res.status}`);
      }
    } catch (err) {
      log(`  Resolve error: ${(err as Error).message}`);
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
log('Clawverse Collab Worker started');
log(`  Daemon: ${DAEMON_URL}`);
log(`  LLM: ${providerInfo.provider} / ${providerInfo.model} (${providerInfo.apiType})`);
log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);

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
  log('Collab worker stopped.');
  await io.destroy();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });