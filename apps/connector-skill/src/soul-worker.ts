/**
 * Clawverse Soul Worker
 * Runs inside OpenClaw environment — reads OpenClaw workspace files for soul data.
 *
 * Flow:
 *   1. Read SOUL.md from OpenClaw workspace (or ~/.claude/SOUL.md fallback)
 *   2. List installed skills from workspace or ~/.claude/skills/
 *   3. Determine model trait from OpenClaw config
 *   4. Compute soulHash = SHA256(soulContent + skillsList)
 *   5. POST to daemon POST /dna/soul — daemon regenerates DNA with real soul hash
 *
 * Runs once at startup, then exits. The daemon handles re-broadcast.
 */

import crypto from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createTaskRunner } from './index.js';
import { llmProviderInfo } from './llm.js';

const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const DAEMON_ORIGIN = 'soul-worker';
const DAEMON_HEADERS = { 'x-clawverse-origin': DAEMON_ORIGIN } as const;

// Look for soul in OpenClaw workspace first, then Claude dir
const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE || join(homedir(), '.openclaw/workspace');
const CLAUDE_DIR = join(homedir(), '.claude');

const runner = createTaskRunner({ source: 'task-runtime' });

function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function readSoulMd(): string {
  // Try OpenClaw workspace first
  const openclawPath = join(OPENCLAW_WORKSPACE, 'SOUL.md');
  if (existsSync(openclawPath)) {
    try { return readFileSync(openclawPath, 'utf8'); } catch { /* fall through */ }
  }
  // Fallback to Claude dir
  const claudePath = join(CLAUDE_DIR, 'SOUL.md');
  if (existsSync(claudePath)) {
    try { return readFileSync(claudePath, 'utf8'); } catch { /* fall through */ }
  }
  return '';
}

function listSkills(): string[] {
  // Check OpenClaw workspace skills
  for (const dir of [join(OPENCLAW_WORKSPACE, 'skills'), join(CLAUDE_DIR, 'skills')]) {
    if (!existsSync(dir)) continue;
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.md') || f.endsWith('.yml') || f.endsWith('.yaml'))
        .sort();
    } catch { /* continue */ }
  }
  return [];
}

function getModelTrait(): string {
  try {
    const info = llmProviderInfo();
    const model = info.model.toLowerCase();
    if (/opus/i.test(model)) return 'Polymath';
    if (/sonnet/i.test(model)) return 'Engineer';
    if (/haiku/i.test(model)) return 'Poet';
    if (/gpt.*4/i.test(model)) return 'Engineer';
    if (/gpt.*3/i.test(model)) return 'Poet';
    if (/codex/i.test(model)) return 'Engineer';
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

async function run(): Promise<void> {
  console.log('[soul-worker] Starting soul enrichment...');

  const soulContent = readSoulMd();
  const skills = listSkills();
  const modelTrait = getModelTrait() as any;

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

  const info = llmProviderInfo();
  console.log(`[soul-worker] LLM: ${info.provider} / ${info.model} (${info.apiType})`);

  await runner.run('soul-enrichment', async () => {
    const res = await fetch(`${DAEMON_URL}/dna/soul`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...DAEMON_HEADERS },
      body: JSON.stringify({ soulHash, modelTrait, badges }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Daemon rejected soul update: ${err}`);
    }

    const result = await res.json() as any;
    console.log(`[soul-worker] DNA enriched: ${result.dna?.id ?? 'unknown'} (${result.dna?.archetype})`);
    console.log('[soul-worker] Done.');
    return result;
  });
}

run().catch((err) => {
  console.error(`[soul-worker] Fatal: ${(err as Error).message}`);
  process.exit(1);
});
