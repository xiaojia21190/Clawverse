/**
 * Clawverse Soul Worker
 * Runs inside OpenClaw environment (has access to Claude config files).
 *
 * Flow:
 *   1. Read ~/.claude/SOUL.md (if exists) — represents Claude's "soul"
 *   2. List installed skills from ~/.claude/skills/
 *   3. Get model name via `claude --version`
 *   4. Compute soulHash = SHA256(soulContent + skillsList)
 *   5. POST to daemon POST /dna/soul — daemon regenerates DNA with real soul hash
 *
 * Runs once at startup, then exits. The daemon handles re-broadcast.
 */

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const execFileAsync = promisify(execFile);

const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const CLAUDE_DIR = join(homedir(), '.claude');

function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function readSoulMd(): string {
  const path = join(CLAUDE_DIR, 'SOUL.md');
  if (!existsSync(path)) return '';
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

function listSkills(): string[] {
  const dir = join(CLAUDE_DIR, 'skills');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md') || f.endsWith('.yml') || f.endsWith('.yaml'))
      .sort();
  } catch { return []; }
}

async function getModelTrait(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('claude', ['--version'], { timeout: 5_000 });
    const version = stdout.trim();
    if (/opus/i.test(version)) return 'Polymath';
    if (/sonnet/i.test(version)) return 'Engineer';
    if (/haiku/i.test(version)) return 'Poet';
    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}

function buildBadges(soulContent: string, skills: string[]): string[] {
  const badges: string[] = [];
  if (soulContent.length > 100) badges.push('has-soul');
  if (skills.length > 0) badges.push(`${skills.length}-skills`);
  if (skills.length >= 5) badges.push('skilled');
  return badges;
}

async function reportEpisode(success: boolean, latencyMs: number): Promise<void> {
  try {
    await fetch(`${DAEMON_URL}/evolution/episode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success, latencyMs, source: 'task-runtime', variant: 'soul-enrichment' }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch { /* non-critical */ }
}

async function run(): Promise<void> {
  const t0 = Date.now();
  console.log('[soul-worker] Starting soul enrichment...');

  const soulContent = readSoulMd();
  const skills = listSkills();
  const modelTrait = await getModelTrait() as any;

  if (soulContent) {
    console.log(`[soul-worker] SOUL.md found (${soulContent.length} chars)`);
  } else {
    console.log('[soul-worker] No SOUL.md found, using empty soul');
  }
  console.log(`[soul-worker] Skills: [${skills.join(', ')}]`);
  console.log(`[soul-worker] Model trait: ${modelTrait}`);

  const soulHash = sha256hex(soulContent + skills.join(','));
  const badges = buildBadges(soulContent, skills);

  console.log(`[soul-worker] soulHash: ${soulHash.slice(0, 16)}...`);
  console.log(`[soul-worker] badges: [${badges.join(', ')}]`);

  try {
    const res = await fetch(`${DAEMON_URL}/dna/soul`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ soulHash, modelTrait, badges }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[soul-worker] Daemon rejected soul update: ${err}`);
      await reportEpisode(false, Date.now() - t0);
      process.exit(1);
    }

    const result = await res.json() as any;
    console.log(`[soul-worker] DNA enriched: ${result.dna?.id ?? 'unknown'} (${result.dna?.archetype})`);
    console.log('[soul-worker] Done.');
    await reportEpisode(true, Date.now() - t0);
  } catch (err) {
    console.error(`[soul-worker] Failed to reach daemon: ${(err as Error).message}`);
    await reportEpisode(false, Date.now() - t0);
    process.exit(1);
  }
}

run();
