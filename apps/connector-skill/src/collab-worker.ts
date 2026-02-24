/**
 * Clawverse Collab Worker
 * Runs inside OpenClaw environment — uses OpenClaw's configured LLM providers.
 *
 * Flow (every POLL_INTERVAL_MS):
 *   1. GET /collab/pending — fetch tasks submitted by remote peers
 *   2. LLM → answer the question
 *   3. POST /collab/resolve with result
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createTaskRunner } from './index.js';
import { llmGenerate, llmProviderInfo } from './llm.js';

const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const POLL_INTERVAL_MS = Number(process.env.CLAWVERSE_COLLAB_POLL_MS || 60_000);
const COLLAB_LOG = resolve(process.cwd(), 'data/collab/worker.log');

const runner = createTaskRunner({ source: 'task-runtime' });

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  mkdirSync(dirname(COLLAB_LOG), { recursive: true });
  appendFileSync(COLLAB_LOG, line + '\n');
}

interface CollabTask {
  id: string;
  fromName: string;
  context: string;
  question: string;
}

async function poll(): Promise<void> {
  let tasks: CollabTask[];
  try {
    const res = await fetch(`${DAEMON_URL}/collab/pending`, {
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

    const prompt = [
      `${task.fromName} asks for your help:`,
      ``,
      task.context,
      ``,
      task.question,
      ``,
      `Answer concisely and helpfully.`,
    ].join('\n');

    let result = '';
    let success = false;

    try {
      result = await runner.run('collab-execution', async () => {
        const text = await llmGenerate(prompt, { maxTokens: 512 });
        if (!text) throw new Error('Empty LLM response');
        return text;
      });
      success = true;
    } catch (err) {
      log(`  LLM generation failed: ${(err as Error).message}`);
    }

    try {
      const res = await fetch(`${DAEMON_URL}/collab/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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

const providerInfo = llmProviderInfo();
log('Clawverse Collab Worker started');
log(`  Daemon: ${DAEMON_URL}`);
log(`  LLM: ${providerInfo.provider} / ${providerInfo.model} (${providerInfo.apiType})`);
log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);

poll().catch((err) => log(`Poll error: ${(err as Error).message}`));
const timer = setInterval(() => {
  poll().catch((err) => log(`Poll error: ${(err as Error).message}`));
}, POLL_INTERVAL_MS);

process.on('SIGINT', () => { clearInterval(timer); log('Collab worker stopped.'); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(timer); log('Collab worker stopped.'); process.exit(0); });
