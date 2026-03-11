import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OutsiderRegistry } from '../src/outsider-registry.js';

test('outsider registry persists arrivals and advances lifecycle under stable conditions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-outsider-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const registry = new OutsiderRegistry({ dbPath });
    const outsider = registry.create({
      hostTopic: 'topic-alpha',
      fromTopic: 'topic-beta',
      label: 'Refugee squad',
      actorCount: 3,
      triggerEventType: 'great_migration',
      source: 'migration',
      summary: 'A refugee squad is requesting entry.',
      trust: 40,
      pressure: 28,
    });
    assert.equal(outsider.status, 'observed');

    registry.review('topic-alpha', {
      clusterCount: 2,
      raidRisk: 18,
      activeWarCount: 0,
      resources: { compute: 90, storage: 90, bandwidth: 72, reputation: 24 },
    });

    const reviewed = registry.list('topic-alpha')[0];
    assert.ok(reviewed);
    assert.ok(['tolerated', 'traded', 'accepted'].includes(reviewed.status));

    await registry.destroy();

    const reopened = new OutsiderRegistry({ dbPath });
    assert.equal(reopened.list('topic-alpha').length, 1);
    await reopened.destroy();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('outsider registry expels arrivals when war pressure collapses local safety', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-outsider-expel-'));
  const dbPath = join(root, 'clawverse.db');
  let registry: OutsiderRegistry | null = null;

  try {
    registry = new OutsiderRegistry({ dbPath });
    const outsider = registry.create({
      hostTopic: 'topic-alpha',
      label: 'Unknown outsiders',
      actorCount: 2,
      triggerEventType: 'stranger_arrival',
      source: 'storyteller',
      summary: 'Unknown outsiders are being observed.',
      trust: 24,
      pressure: 64,
    });

    registry.review('topic-alpha', {
      clusterCount: 0,
      raidRisk: 92,
      activeWarCount: 2,
      resources: { compute: 14, storage: 20, bandwidth: 12, reputation: 4 },
    });

    const updated = registry.list('topic-alpha').find((item) => item.id === outsider.id);
    assert.equal(updated?.status, 'expelled');
  } finally {
    await registry?.destroy();
    rmSync(root, { recursive: true, force: true });
  }
});
