import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RingMirrorRegistry } from '../src/ring-registry.js';

test('ring mirror registry persists mirrored topic shells across instances', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-ring-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const registry = new RingMirrorRegistry({ dbPath });
    registry.upsert({
      topic: 'topic-alpha',
      actorCount: 3,
      branchCount: 5,
      brainStatus: 'authoritative',
      updatedAt: '2026-03-08T11:00:00.000Z',
      source: 'mirror',
    });
    await registry.destroy();

    const reopened = new RingMirrorRegistry({ dbPath });
    assert.deepEqual(reopened.list(), [
      {
        topic: 'topic-alpha',
        actorCount: 3,
        branchCount: 5,
        brainStatus: 'authoritative',
        updatedAt: '2026-03-08T11:00:00.000Z',
        source: 'mirror',
      },
    ]);
    assert.equal(reopened.remove('topic-alpha'), true);
    assert.equal(reopened.get('topic-alpha'), null);
    await reopened.destroy();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
