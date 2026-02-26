import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EconomySystem } from '../src/economy.js';

function makeTmp(): { dbPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-economy-'));
  const dbPath = join(root, 'clawverse.db');
  return { dbPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('initial resources match defaults', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    const r = eco.getResources();
    assert.equal(r.compute, 80);
    assert.equal(r.storage, 80);
    assert.equal(r.bandwidth, 60);
    assert.equal(r.reputation, 10);
    await eco.destroy();
  } finally { cleanup(); }
});

test('consume returns false when insufficient', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    assert.equal(eco.consume('compute', 999), false);
    assert.equal(eco.getResources().compute, 80);
    await eco.destroy();
  } finally { cleanup(); }
});

test('consume + award round-trip', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    assert.equal(eco.consume('compute', 30), true);
    assert.equal(eco.getResources().compute, 50);
    eco.award('compute', 10);
    assert.equal(eco.getResources().compute, 60);
    await eco.destroy();
  } finally { cleanup(); }
});

test('canAfford checks correctly', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    assert.equal(eco.canAfford('reputation', 10), true);
    assert.equal(eco.canAfford('reputation', 11), false);
    await eco.destroy();
  } finally { cleanup(); }
});

test('tick adjusts resources based on mood', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    const before = eco.getResources().compute;
    eco.tick('idle', 2);
    assert.ok(eco.getResources().compute > before);
    await eco.destroy();
  } finally { cleanup(); }
});

test('tick with stressed mood decreases compute', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    const before = eco.getResources().compute;
    eco.tick('stressed', 0);
    assert.ok(eco.getResources().compute < before);
    await eco.destroy();
  } finally { cleanup(); }
});

test('createPendingTrade + acceptTrade flow', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    const trade = eco.createPendingTrade('t1', 'peer-A', 'compute', 10, 'storage', 5);
    assert.equal(trade.status, 'pending');
    assert.equal(eco.getPendingTrades().length, 1);

    const accepted = eco.acceptTrade('t1');
    assert.ok(accepted);
    assert.equal(accepted!.status, 'accepted');
    // We received 10 compute, paid 5 storage
    assert.equal(eco.getResources().compute, 90); // 80 + 10
    assert.equal(eco.getResources().storage, 75); // 80 - 5
    await eco.destroy();
  } finally { cleanup(); }
});

test('rejectTrade changes status', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    eco.createPendingTrade('t2', 'peer-B', 'compute', 5, 'storage', 3);
    const rejected = eco.rejectTrade('t2');
    assert.ok(rejected);
    assert.equal(rejected!.status, 'rejected');
    assert.equal(eco.getPendingTrades().length, 0);
    await eco.destroy();
  } finally { cleanup(); }
});

test('recordTrade + getTradeHistory', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    eco.recordTrade('me', 'them', 'compute', 10);
    const history = eco.getTradeHistory();
    assert.equal(history.length, 1);
    assert.equal((history[0] as any).resource, 'compute');
    await eco.destroy();
  } finally { cleanup(); }
});
