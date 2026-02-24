import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { EvolutionEpisodeLogger } from '../src/evolution.js';

test('destroy flushes queued episodes in ESM runtime', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-evolution-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const logger = new EvolutionEpisodeLogger({
      variant: 'review-smoke',
      flushEvery: 1,
      dbPath,
    });

    logger.record({
      idPrefix: 'manual',
      source: 'manual',
      success: true,
      latencyMs: 12,
      meta: {
        connectedPeers: 1,
        knownPeers: 1,
        cpuUsage: 5,
        ramUsage: 10,
        mood: 'idle',
      },
    });

    await assert.doesNotReject(async () => logger.destroy());

    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare(`
        SELECT source, variant, success
        FROM evolution_episodes
        LIMIT 1
      `).get() as { source: string; variant: string; success: number } | undefined;
      assert.equal(!!row, true);
      assert.equal(row?.source, 'manual');
      assert.equal(row?.variant, 'review-smoke');
      assert.equal(row?.success, 1);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
