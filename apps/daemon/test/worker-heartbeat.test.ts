import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerHeartbeatRegistry } from '../src/worker-heartbeat.js';

test('worker heartbeat registry reports missing before first heartbeat', () => {
  const registry = new WorkerHeartbeatRegistry();
  const snapshot = registry.snapshot('life-worker', Date.parse('2026-03-11T12:00:00.000Z'), 90_000);
  assert.equal(snapshot.worker, 'life-worker');
  assert.equal(snapshot.lastSeenAt, null);
  assert.equal(snapshot.ageMs, null);
  assert.equal(snapshot.status, 'missing');
});

test('worker heartbeat registry tracks live then stale health', () => {
  const registry = new WorkerHeartbeatRegistry();
  registry.heartbeat('life-worker', Date.parse('2026-03-11T12:00:00.000Z'));

  const live = registry.snapshot('life-worker', Date.parse('2026-03-11T12:00:40.000Z'), 90_000);
  assert.equal(live.status, 'live');
  assert.equal(live.ageMs, 40_000);

  const stale = registry.snapshot('life-worker', Date.parse('2026-03-11T12:02:00.000Z'), 90_000);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.ageMs, 120_000);
});

test('worker heartbeat registry normalizes worker id and lists snapshots', () => {
  const registry = new WorkerHeartbeatRegistry();
  registry.heartbeat('  LIFE-WORKER ', Date.parse('2026-03-11T12:00:00.000Z'));
  registry.heartbeat('social-worker', Date.parse('2026-03-11T12:00:30.000Z'));

  const rows = registry.list(Date.parse('2026-03-11T12:01:00.000Z'), 120_000);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.worker, 'life-worker');
  assert.equal(rows[0]?.status, 'live');
  assert.equal(rows[1]?.worker, 'social-worker');
  assert.equal(rows[1]?.status, 'live');
});
