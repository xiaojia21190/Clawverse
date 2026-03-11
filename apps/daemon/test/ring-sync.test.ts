import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RingMirrorRegistry } from '../src/ring-registry.js';
import { RingMirrorSyncer } from '../src/ring-sync.js';

test('ring mirror syncer pulls remote status and updates mirror registry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-ring-sync-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const registry = new RingMirrorRegistry({ dbPath });
    const syncer = new RingMirrorSyncer({
      currentTopic: 'topic-home',
      sources: [{ topic: 'topic-alpha', baseUrl: 'http://mirror-alpha.local' }],
      registry,
      intervalMs: 60_000,
      fetchImpl: async () => new Response(JSON.stringify({
        topic: 'topic-alpha',
        world: {
          topic: 'topic-alpha',
          population: {
            actorCount: 4,
            branchCount: 7,
          },
          brain: {
            status: 'authoritative',
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });

    await syncer.syncNow();

    const mirror = registry.get('topic-alpha');
    assert.equal(mirror?.topic, 'topic-alpha');
    assert.equal(mirror?.actorCount, 4);
    assert.equal(mirror?.branchCount, 7);
    assert.equal(mirror?.brainStatus, 'authoritative');
    assert.equal(mirror?.source, 'mirror');
    assert.equal(typeof mirror?.updatedAt, 'string');

    syncer.stop();
    await registry.destroy();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
