import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainGuidanceRegistry } from '../src/brain-guidance-registry.js';

test('brain guidance registry persists operator guidance across instances', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-guidance-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const registry = new BrainGuidanceRegistry({ dbPath });
    const record = registry.create({
      kind: 'note',
      message: 'Prefer trading before building.',
      payload: { lane: 'economy' },
      ttlMs: 60_000,
      nowMs: Date.parse('2026-03-08T11:00:00.000Z'),
    });
    await registry.destroy();

    const reopened = new BrainGuidanceRegistry({ dbPath });
    const active = reopened.listActive(10, Date.parse('2026-03-08T11:00:30.000Z'));
    assert.equal(active.length, 1);
    assert.equal(active[0]?.id, record.id);
    assert.equal(active[0]?.kind, 'note');
    assert.equal(active[0]?.message, 'Prefer trading before building.');
    assert.deepEqual(active[0]?.payload, { lane: 'economy' });
    await reopened.destroy();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('brain guidance registry excludes expired entries from active list', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-guidance-expiry-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const registry = new BrainGuidanceRegistry({ dbPath });
    registry.create({
      kind: 'move',
      message: 'Prefer moving to Market.',
      payload: { x: 12, y: 4 },
      ttlMs: 30_000,
      nowMs: Date.parse('2026-03-08T11:00:00.000Z'),
    });

    assert.equal(registry.listActive(10, Date.parse('2026-03-08T11:00:20.000Z')).length, 1);
    assert.equal(registry.listActive(10, Date.parse('2026-03-08T11:00:40.000Z')).length, 0);
    await registry.destroy();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('brain guidance registry consume and dismiss update status', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-guidance-status-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const registry = new BrainGuidanceRegistry({ dbPath });
    const record = registry.create({
      kind: 'note',
      message: 'Avoid hostile diplomacy unless survival is at risk.',
      ttlMs: 0,
      nowMs: Date.parse('2026-03-08T11:00:00.000Z'),
    });

    const consumed = registry.consume(record.id, Date.parse('2026-03-08T11:02:00.000Z'));
    assert.equal(consumed?.status, 'consumed');
    assert.equal(registry.listActive(10, Date.parse('2026-03-08T11:02:01.000Z')).length, 0);

    const dismissed = registry.dismiss(record.id, Date.parse('2026-03-08T11:03:00.000Z'));
    assert.equal(dismissed?.status, 'dismissed');
    await registry.destroy();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

