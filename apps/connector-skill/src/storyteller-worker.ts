import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createTaskRunner } from './index.js';

const execFileAsync = promisify(execFile);
const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const INTERVAL_MS = Number(process.env.CLAWVERSE_STORYTELLER_INTERVAL_MS || 10 * 60_000);
const CLAUDE_MODEL = process.env.CLAWVERSE_STORYTELLER_MODEL || 'claude-haiku-4-5';
const LOG_PATH = resolve(process.cwd(), 'data/life/storyteller-worker.log');

mkdirSync(dirname(LOG_PATH), { recursive: true });
const runner = createTaskRunner({ source: 'task-runtime' });

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + '\n');
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${DAEMON_URL}${path}`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

function buildPrompt(status: any, peers: any, storyteller: any, lifeEvents: any): string {
  const peerSummary = (peers.all ?? [])
    .slice(0, 8)
    .map((p: any) => `  - ${p.name} (${p.dna?.archetype}, mood:${p.mood})`)
    .join('\n');

  return [
    `You are the Storyteller AI for Clawverse — mode: ${storyteller.mode}.`,
    `Tension: ${storyteller.tension}/100`,
    `My status: ${status.state?.name}, mood=${status.mood}`,
    `Peers:\n${peerSummary || '  (none)'}`,
    `Pending life events: ${(lifeEvents.pending ?? lifeEvents ?? []).length}`,
    ``,
    `Available events: resource_drought, resource_windfall, cpu_storm, stranger_arrival,`,
    `faction_war, peace_treaty, skill_tournament, need_cascade, betrayal, great_migration`,
    ``,
    `Choose ONE event to trigger or none. Reply ONLY with JSON:`,
    `{"event_type": "<type or none>", "reason": "<one sentence>"}`,
  ].join('\n');
}

async function run(): Promise<void> {
  log('Storyteller decision starting...');
  let status: any, peers: any, storyteller: any, lifeEvents: any;
  try {
    [status, peers, storyteller, lifeEvents] = await Promise.all([
      fetchJson('/status'), fetchJson('/peers'),
      fetchJson('/storyteller/status'), fetchJson('/life/events/pending'),
    ]);
  } catch (err) {
    log(`Fetch failed: ${(err as Error).message}`);
    return;
  }

  await runner.run('storyteller-decision', async () => {
    const prompt = buildPrompt(status, peers, storyteller, lifeEvents);
    const { stdout } = await execFileAsync(
      'claude', ['--print', '--model', CLAUDE_MODEL, '-p', prompt], { timeout: 30_000 }
    );
    const match = stdout.match(/\{[^}]+\}/);
    if (!match) { log('No JSON in output'); return null; }
    const parsed = JSON.parse(match[0]) as { event_type: string; reason: string };
    if (parsed.event_type === 'none') { log(`No action: ${parsed.reason}`); return null; }
    log(`Triggering: ${parsed.event_type} — ${parsed.reason}`);
    await fetch(`${DAEMON_URL}/storyteller/trigger`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventType: parsed.event_type, payload: { reason: parsed.reason } }),
      signal: AbortSignal.timeout(5_000),
    });
    return parsed;
  }).catch((err: Error) => log(`Error: ${err.message}`));
}

run().catch(err => { log(`Fatal: ${(err as Error).message}`); process.exit(1); });
if (INTERVAL_MS > 0) setInterval(run, INTERVAL_MS);
