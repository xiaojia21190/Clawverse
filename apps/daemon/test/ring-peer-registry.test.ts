import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RingPeerRegistry } from '../src/ring-peer-registry.js';

test('ring peer registry persists announced peers across instances', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-ring-peer-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const registry = new RingPeerRegistry({ dbPath });
    registry.upsert({
      topic: 'topic-alpha',
      baseUrl: 'http://alpha.local/',
      updatedAt: '2026-03-08T11:00:00.000Z',
      source: 'announced',
    });
    await registry.destroy();

    const reopened = new RingPeerRegistry({ dbPath });
    assert.deepEqual(reopened.list(), [
      {
        topic: 'topic-alpha',
        baseUrl: 'http://alpha.local',
        updatedAt: '2026-03-08T11:00:00.000Z',
        source: 'announced',
      },
    ]);
    assert.deepEqual(reopened.listWithHealth(Date.parse('2026-03-08T11:01:00.000Z'), 5 * 60_000), [
      {
        topic: 'topic-alpha',
        baseUrl: 'http://alpha.local',
        updatedAt: '2026-03-08T11:00:00.000Z',
        source: 'announced',
        health: 'live',
      },
    ]);
    assert.equal(reopened.remove('topic-alpha'), true);
    await reopened.destroy();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ring peer registry prunes expired peers after ttl', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-ring-peer-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const registry = new RingPeerRegistry({ dbPath });
    registry.upsert({
      topic: 'topic-stale',
      baseUrl: 'http://stale.local/',
      updatedAt: '2026-03-08T11:00:00.000Z',
      source: 'announced',
    });
    assert.deepEqual(registry.pruneExpired(60_000, Date.parse('2026-03-08T11:01:30.000Z')), ['topic-stale']);
    assert.equal(registry.get('topic-stale'), null);
    await registry.destroy();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
