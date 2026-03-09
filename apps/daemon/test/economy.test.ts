import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EconomySystem } from '../src/economy.js';

function makeTmp(): { dbPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-economy-'));
  const dbPath = join(root, 'clawverse.db');
  return {
    dbPath,
    cleanup: () => { try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows EBUSY / EPERM */ } },
  };
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
    assert.equal(eco.getResources().compute, 90);
    assert.equal(eco.getResources().storage, 75);
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

test('recordTradeOutcome + getTradeHistory keeps structured trade result', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    eco.recordTradeOutcome('peer-A', false, 'peer_not_reachable', {
      tradeId: 'trade-1',
      direction: 'outbound',
      resource: 'compute',
      amount: 10,
      resourceWant: 'storage',
      amountWant: 5,
    });
    const history = eco.getTradeHistory();
    assert.equal(history.length, 1);
    assert.equal((history[0] as any).kind, 'trade_result');
    assert.equal((history[0] as any).peerId, 'peer-A');
    assert.equal((history[0] as any).accepted, false);
    assert.equal((history[0] as any).reason, 'peer_not_reachable');
    assert.equal((history[0] as any).direction, 'outbound');
    assert.equal((history[0] as any).resourceWant, 'storage');
    await eco.destroy();
  } finally { cleanup(); }
});

test('craft chain produces inventory items and consumes dependencies', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });

    const dataShard = eco.craft('data_shard', ['archive']);
    assert.equal(dataShard.ok, true);
    assert.equal(eco.getItemAmount('data_shard'), 1);

    const alloyFrame = eco.craft('alloy_frame', ['forge']);
    assert.equal(alloyFrame.ok, true);
    assert.equal(eco.getItemAmount('alloy_frame'), 1);

    const relayPatch = eco.craft('relay_patch', []);
    assert.equal(relayPatch.ok, true);
    assert.equal(eco.getItemAmount('relay_patch'), 1);
    assert.equal(eco.getItemAmount('data_shard'), 0);
    assert.equal(eco.getItemAmount('alloy_frame'), 0);

    await eco.destroy();
  } finally { cleanup(); }
});

test('relay patch recovery consumes inventory and restores resources', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });

    const shard = eco.craft('data_shard', ['archive']);
    const frame = eco.craft('alloy_frame', ['forge']);
    const patch = eco.craft('relay_patch', []);
    assert.equal(shard.ok, true);
    assert.equal(frame.ok, true);
    assert.equal(patch.ok, true);

    const beforeDrain = eco.getResources();
    assert.equal(eco.consume('compute', 48), true);
    assert.equal(eco.consume('bandwidth', 45), true);

    const beforeRecovery = eco.getResources();
    const recovery = eco.useRecoveryItem('relay_patch');
    const afterRecovery = eco.getResources();

    assert.equal(beforeDrain.compute, 54);
    assert.equal(beforeDrain.bandwidth, 50);
    assert.equal(beforeRecovery.compute, 6);
    assert.equal(beforeRecovery.bandwidth, 5);
    assert.equal(recovery, true);
    assert.equal(eco.getItemAmount('relay_patch'), 0);
    assert.equal(afterRecovery.compute, 12);
    assert.equal(afterRecovery.bandwidth, 23);

    await eco.destroy();
  } finally { cleanup(); }
});

test('craft production chain persists inventory state', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    const shard = eco.craft('data_shard', ['archive']);
    assert.equal(shard.ok, true);
    assert.equal(eco.getItemAmount('data_shard'), 1);

    const frame = eco.craft('alloy_frame', ['forge']);
    assert.equal(frame.ok, true);
    assert.equal(eco.getItemAmount('alloy_frame'), 1);

    const patch = eco.craft('relay_patch', []);
    assert.equal(patch.ok, true);
    assert.equal(eco.getItemAmount('data_shard'), 0);
    assert.equal(eco.getItemAmount('alloy_frame'), 0);
    assert.equal(eco.getItemAmount('relay_patch'), 1);

    await eco.destroy();

    const restored = new EconomySystem({ dbPath });
    assert.equal(restored.getItemAmount('relay_patch'), 1);
    await restored.destroy();
  } finally { cleanup(); }
});

test('useRecoveryItem consumes relay patch and restores resources', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const eco = new EconomySystem({ dbPath });
    eco.consume('compute', 70);
    eco.consume('bandwidth', 50);
    eco.awardInventoryItem('relay_patch', 1);

    const ok = eco.useRecoveryItem('relay_patch');
    assert.equal(ok, true);
    assert.equal(eco.getItemAmount('relay_patch'), 0);
    assert.equal(eco.getResources().compute, 16);
    assert.equal(eco.getResources().bandwidth, 28);

    await eco.destroy();
  } finally { cleanup(); }
});
