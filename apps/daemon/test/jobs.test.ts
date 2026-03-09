import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JobsSystem } from '../src/jobs.js';

function makeTmp(): { dbPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-jobs-'));
  const dbPath = join(root, 'clawverse.db');
  return {
    dbPath,
    cleanup: () => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

test('enqueue and list jobs by priority', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    jobs.enqueueJob({ kind: 'move', title: 'Move', reason: 'Need reposition', priority: 20 });
    jobs.enqueueJob({ kind: 'trade', title: 'Trade', reason: 'Need resources', priority: 90 });

    const list = jobs.listJobs();
    assert.equal(list.length, 2);
    assert.equal(list[0].kind, 'trade');
    assert.equal(list[1].kind, 'move');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('getNextQueuedJob start and complete flow', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const queued = jobs.enqueueJob({
      kind: 'build',
      title: 'Build forge',
      reason: 'Tasked is low',
      priority: 75,
      payload: { type: 'forge' },
    });

    const next = jobs.getNextQueuedJob();
    assert.equal(next?.id, queued.id);
    assert.equal(next?.status, 'queued');

    const active = jobs.startJob(queued.id);
    assert.equal(active?.status, 'active');
    assert.ok(active?.startedAt);

    const done = jobs.completeJob(queued.id, 'built:forge');
    assert.equal(done?.status, 'done');
    assert.equal(done?.note, 'built:forge');
    assert.ok(done?.completedAt);
    assert.equal(jobs.getNextQueuedJob(), null);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('dedupe key reuses queued job, refreshes priority, and can cancel queued jobs', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const first = jobs.enqueueJob({
      kind: 'declare_peace',
      title: 'Push peace',
      reason: 'War is active',
      priority: 80,
      dedupeKey: 'peace-war-1',
      payload: { warId: 'war-1', strategicLane: 'faction' },
    });
    const second = jobs.enqueueJob({
      kind: 'declare_peace',
      title: 'Push peace again',
      reason: 'Should dedupe',
      priority: 99,
      dedupeKey: 'peace-war-1',
      payload: { warId: 'war-1', strategicLane: 'diplomacy' },
    });

    assert.equal(first.id, second.id);
    assert.equal(jobs.listJobs().length, 1);
    assert.equal(jobs.getJob(first.id)?.priority, 99);
    assert.equal(jobs.getJob(first.id)?.reason, 'Should dedupe');
    assert.equal(jobs.getJob(first.id)?.payload.strategicLane, 'diplomacy');

    const cancelled = jobs.cancelQueuedByDedupeKey('peace-war-1', 'resolved');
    assert.equal(cancelled, 1);
    const record = jobs.getJob(first.id);
    assert.equal(record?.status, 'cancelled');
    assert.equal(record?.note, 'resolved');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('dedupe key does not rewrite an active job while it is already claimed', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const first = jobs.enqueueJob({
      kind: 'declare_peace',
      title: 'Push peace',
      reason: 'War is active',
      priority: 80,
      dedupeKey: 'peace-war-2',
      payload: { warId: 'war-2' },
    });

    jobs.startJob(first.id, { note: 'claimed:envoy' });

    const second = jobs.enqueueJob({
      kind: 'declare_peace',
      title: 'Push peace again',
      reason: 'Should not rewrite active duty',
      priority: 99,
      dedupeKey: 'peace-war-2',
      payload: { warId: 'war-2' },
    });

    assert.equal(first.id, second.id);
    assert.equal(jobs.getJob(first.id)?.status, 'active');
    assert.equal(jobs.getJob(first.id)?.priority, 80);
    assert.equal(jobs.getJob(first.id)?.reason, 'War is active');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('craft jobs can be queued and started', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const crafted = jobs.enqueueJob({
      kind: 'craft',
      title: 'Assemble relay patch',
      reason: 'Need emergency recovery inventory',
      priority: 85,
      payload: { recipeId: 'relay_patch' },
      dedupeKey: 'craft-relay-patch',
    });

    const next = jobs.getNextQueuedJob();
    assert.equal(next?.id, crafted.id);
    assert.equal(next?.kind, 'craft');

    const active = jobs.startJob(crafted.id);
    assert.equal(active?.status, 'active');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('start job merges claim payload and note', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const queued = jobs.enqueueJob({
      kind: 'build',
      title: 'Raise watchtower perimeter',
      reason: 'Raid pressure is climbing',
      priority: 88,
      payload: { preferredType: 'watchtower', preferredZone: 'Workshop', role: 'bulwark_engineer' },
      dedupeKey: 'autonomy-build-watchtower',
    });

    const active = jobs.startJob(queued.id, {
      note: 'claimed:Signal Warden | assignee:bulwark_engineer | lane:Workshop',
      payload: { executor: 'Signal Warden', assignee: 'bulwark_engineer', lane: 'Workshop' },
    });

    assert.equal(active?.status, 'active');
    assert.equal(active?.note, 'claimed:Signal Warden | assignee:bulwark_engineer | lane:Workshop');
    assert.equal(active?.payload.preferredType, 'watchtower');
    assert.equal(active?.payload.preferredZone, 'Workshop');
    assert.equal(active?.payload.role, 'bulwark_engineer');
    assert.equal(active?.payload.executor, 'Signal Warden');
    assert.equal(active?.payload.assignee, 'bulwark_engineer');
    assert.equal(active?.payload.lane, 'Workshop');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});
test('start job defers when wartime lane is already active', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const first = jobs.enqueueJob({
      kind: 'move',
      title: 'Marshal the defensive line',
      reason: 'Hold the market front',
      priority: 90,
      payload: { lane: 'Market', responseSquad: 'wartime', assignee: 'marshal' },
      dedupeKey: 'autonomy-war-marshal-line',
    });
    const second = jobs.enqueueJob({
      kind: 'trade',
      title: 'Harden bandwidth lanes',
      reason: 'Restore the same frontline lane',
      priority: 89,
      payload: { lane: 'Market', responseSquad: 'wartime', assignee: 'quartermaster' },
      dedupeKey: 'autonomy-raid-bandwidth-trade',
    });

    const active = jobs.startJob(first.id, { payload: { executor: 'Signal Warden' } });
    assert.equal(active?.status, 'active');

    const blocked = jobs.startJob(second.id, { payload: { executor: 'Quartermaster' } });
    assert.equal(blocked, null);
    assert.equal(jobs.getJob(second.id)?.status, 'queued');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('getNextQueuedJob skips queued jobs blocked by an active wartime lane', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const first = jobs.enqueueJob({
      kind: 'move',
      title: 'Marshal the defensive line',
      reason: 'Hold the market front',
      priority: 90,
      payload: { lane: 'Market', responseSquad: 'wartime', assignee: 'marshal' },
      dedupeKey: 'autonomy-war-marshal-line',
    });
    const blocked = jobs.enqueueJob({
      kind: 'trade',
      title: 'Harden bandwidth lanes',
      reason: 'Restore the same frontline lane',
      priority: 89,
      payload: { lane: 'Market', responseSquad: 'wartime', assignee: 'quartermaster' },
      dedupeKey: 'autonomy-raid-bandwidth-trade',
    });
    const fallback = jobs.enqueueJob({
      kind: 'build',
      title: 'Raise doctrine beacon',
      reason: 'Secure library warning coverage',
      priority: 80,
      payload: { lane: 'Library', responseSquad: 'wartime', assignee: 'signal_warden' },
      dedupeKey: 'autonomy-build-beacon-doctrine',
    });

    jobs.startJob(first.id, { payload: { executor: 'Marshal Prime' } });
    const next = jobs.getNextQueuedJob();

    assert.equal(next?.id, fallback.id);
    assert.notEqual(next?.id, blocked.id);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});
test('getNextQueuedJob prefers matching assignee when available', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const generic = jobs.enqueueJob({
      kind: 'trade',
      title: 'Restore bandwidth lanes',
      reason: 'Fallback duty',
      priority: 92,
      payload: { lane: 'Market', responseSquad: 'wartime', assignee: 'quartermaster' },
      dedupeKey: 'autonomy-raid-bandwidth-trade',
    });
    const preferred = jobs.enqueueJob({
      kind: 'build',
      title: 'Raise doctrine beacon',
      reason: 'Preferred scholar duty',
      priority: 88,
      payload: { lane: 'Library', responseSquad: 'wartime', assignee: 'signal_warden' },
      dedupeKey: 'autonomy-build-beacon-doctrine',
    });

    const next = jobs.getNextQueuedJob(['signal_warden', 'field_medic']);
    assert.equal(next?.id, preferred.id);
    assert.notEqual(next?.id, generic.id);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('getNextQueuedJob prefers matching strategic lane when available', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const higherPriority = jobs.enqueueJob({
      kind: 'trade',
      title: 'Restore bandwidth lanes',
      reason: 'Economy fallback duty',
      priority: 92,
      payload: { lane: 'Market', strategicLane: 'economy' },
      dedupeKey: 'strategic-economy-fallback',
    });
    const focused = jobs.enqueueJob({
      kind: 'declare_peace',
      title: 'Negotiate peace treaty',
      reason: 'Governor wants diplomacy first',
      priority: 84,
      payload: { strategicLane: 'diplomacy' },
      dedupeKey: 'strategic-diplomacy-focus',
    });

    const next = jobs.getNextQueuedJob([], [], '', '', ['diplomacy']);
    assert.equal(next?.id, focused.id);
    assert.notEqual(next?.id, higherPriority.id);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('getNextQueuedJob falls back when preferred assignee is unavailable', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const queued = jobs.enqueueJob({
      kind: 'trade',
      title: 'Protect compute reserves',
      reason: 'No preferred assignee is present',
      priority: 86,
      payload: { lane: 'Market', responseSquad: 'wartime', assignee: 'quartermaster' },
      dedupeKey: 'autonomy-raid-compute-trade',
    });

    const next = jobs.getNextQueuedJob(['signal_warden']);
    assert.equal(next?.id, queued.id);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});
test('getNextQueuedJob skips explicitly excluded ids during reselection', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const first = jobs.enqueueJob({
      kind: 'move',
      title: 'Marshal the defensive line',
      reason: 'First pick was already raced away',
      priority: 90,
      payload: { lane: 'Market', responseSquad: 'wartime', assignee: 'marshal' },
      dedupeKey: 'autonomy-war-marshal-line',
    });
    const second = jobs.enqueueJob({
      kind: 'build',
      title: 'Raise doctrine beacon',
      reason: 'Second pick should be returned',
      priority: 84,
      payload: { lane: 'Library', responseSquad: 'wartime', assignee: 'signal_warden' },
      dedupeKey: 'autonomy-build-beacon-doctrine',
    });

    const next = jobs.getNextQueuedJob([], [first.id]);
    assert.equal(next?.id, second.id);
    assert.notEqual(next?.id, first.id);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('getNextQueuedJob leases queued duty to the requesting claimer', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const queued = jobs.enqueueJob({
      kind: 'trade',
      title: 'Protect compute reserves',
      reason: 'Only one worker should reserve the queued duty',
      priority: 86,
      payload: { lane: 'Market', responseSquad: 'wartime', assignee: 'quartermaster' },
      dedupeKey: 'lease-protect-compute',
    });

    const leased = jobs.getNextQueuedJob(['quartermaster'], [], 'peer-a');
    assert.equal(leased?.id, queued.id);
    assert.equal(leased?.payload.leaseOwner, 'peer-a');
    assert.equal(leased?.payload.leaseState, 'queued');
    assert.equal(typeof leased?.payload.leaseExpiresAt, 'string');

    const blocked = jobs.getNextQueuedJob(['quartermaster'], [], 'peer-b');
    assert.equal(blocked, null);

    const refreshed = jobs.getNextQueuedJob(['quartermaster'], [], 'peer-a');
    assert.equal(refreshed?.id, queued.id);
    assert.equal(refreshed?.payload.leaseOwner, 'peer-a');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('startJob respects queued lease owner', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const queued = jobs.enqueueJob({
      kind: 'build',
      title: 'Raise doctrine beacon',
      reason: 'Lease owner should be the only claimer who can start it',
      priority: 84,
      payload: { lane: 'Library', responseSquad: 'wartime', assignee: 'signal_warden' },
      dedupeKey: 'lease-build-beacon',
    });

    const leased = jobs.getNextQueuedJob(['signal_warden'], [], 'peer-a');
    assert.equal(leased?.id, queued.id);

    const blocked = jobs.startJob(queued.id, {
      note: 'claimed:Forge Guard | assignee:signal_warden | lane:Library',
      payload: { executor: 'Forge Guard', executorId: 'peer-b', assignee: 'signal_warden', lane: 'Library' },
    });
    assert.equal(blocked, null);

    const active = jobs.startJob(queued.id, {
      note: 'claimed:Quiet Current | assignee:signal_warden | lane:Library',
      payload: { executor: 'Quiet Current', executorId: 'peer-a', assignee: 'signal_warden', lane: 'Library' },
    });
    assert.equal(active?.status, 'active');
    assert.equal(active?.payload.leaseOwner, 'peer-a');
    assert.equal(active?.payload.leaseState, 'claimed');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});


test('getNextQueuedJob skips queued build duties that conflict with an active reservation target', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const active = jobs.enqueueJob({
      kind: 'build',
      title: 'Raise doctrine beacon',
      reason: 'Primary builder already owns this beacon site',
      priority: 86,
      payload: { preferredType: 'beacon', preferredZone: 'Library' },
      dedupeKey: 'reservation-active-beacon',
    });
    const blocked = jobs.enqueueJob({
      kind: 'build',
      title: 'Raise backup doctrine beacon',
      reason: 'Same type and zone should conflict while active build is running',
      priority: 84,
      payload: { preferredType: 'beacon', preferredZone: 'Library' },
      dedupeKey: 'reservation-blocked-beacon',
    });
    const fallback = jobs.enqueueJob({
      kind: 'craft',
      title: 'Forge alloy frame',
      reason: 'Non-conflicting fallback should remain claimable',
      priority: 80,
      payload: { recipeId: 'alloy_frame' },
      dedupeKey: 'reservation-fallback-craft',
    });

    const started = jobs.startJob(active.id, {
      note: 'claimed:Signal Warden',
      payload: { executor: 'Signal Warden', executorId: 'peer-a' },
    });
    assert.equal(started?.status, 'active');
    assert.ok(Array.isArray(started?.payload.reservationKeys));

    const next = jobs.getNextQueuedJob([], [], 'peer-b');
    assert.equal(next?.id, fallback.id);
    assert.notEqual(next?.id, blocked.id);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('leased queued reservation blocks conflicting queued duties for other claimers', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const first = jobs.enqueueJob({
      kind: 'trade',
      title: 'Protect compute reserves',
      reason: 'First quartermaster leases the compute recovery lane',
      priority: 90,
      payload: { wantResource: 'compute', offerResource: 'bandwidth', targetZone: 'Market' },
      dedupeKey: 'reservation-first-trade',
    });
    const blocked = jobs.enqueueJob({
      kind: 'trade',
      title: 'Duplicate compute reserve run',
      reason: 'Same target resource and zone should conflict while leased',
      priority: 88,
      payload: { wantResource: 'compute', offerResource: 'reputation', targetZone: 'Market' },
      dedupeKey: 'reservation-blocked-trade',
    });
    const fallback = jobs.enqueueJob({
      kind: 'trade',
      title: 'Restore bandwidth lanes',
      reason: 'Different trade target should still be claimable',
      priority: 82,
      payload: { wantResource: 'bandwidth', offerResource: 'reputation', targetZone: 'Market' },
      dedupeKey: 'reservation-fallback-trade',
    });

    const leased = jobs.getNextQueuedJob([], [], 'peer-a');
    assert.equal(leased?.id, first.id);
    assert.equal(leased?.payload.leaseOwner, 'peer-a');
    assert.ok(Array.isArray(leased?.payload.reservationKeys));

    const next = jobs.getNextQueuedJob([], [], 'peer-b');
    assert.equal(next?.id, fallback.id);
    assert.notEqual(next?.id, blocked.id);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('budget snapshot blocks queued build duties that would overspend reserved resources', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({
      dbPath,
      budgetSnapshot: () => ({
        resources: { compute: 40, storage: 60 },
      }),
    });
    const active = jobs.enqueueJob({
      kind: 'build',
      title: 'Raise frontline watchtower',
      reason: 'Primary builder already committed the defensive budget',
      priority: 90,
      payload: { preferredType: 'watchtower', preferredZone: 'Workshop' },
      dedupeKey: 'budget-active-watchtower',
    });
    const blocked = jobs.enqueueJob({
      kind: 'build',
      title: 'Raise fallback shelter',
      reason: 'Compute budget should block a second structure claim',
      priority: 88,
      payload: { preferredType: 'shelter', preferredZone: 'Residential' },
      dedupeKey: 'budget-blocked-shelter',
    });
    const fallback = jobs.enqueueJob({
      kind: 'move',
      title: 'Rotate to plaza',
      reason: 'Non-budgeted work should remain claimable',
      priority: 80,
      payload: { targetZone: 'Plaza' },
      dedupeKey: 'budget-fallback-move',
    });

    const started = jobs.startJob(active.id, {
      note: 'claimed:Signal Warden',
      payload: { executor: 'Signal Warden', executorId: 'peer-a' },
    });
    assert.equal(started?.status, 'active');

    const next = jobs.getNextQueuedJob([], [], 'peer-b');
    assert.equal(next?.id, fallback.id);
    assert.notEqual(next?.id, blocked.id);
    assert.equal(jobs.leaseQueuedJob(blocked.id, 'peer-b'), null);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('budget snapshot blocks leased trade duties that would oversell offer resources', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({
      dbPath,
      budgetSnapshot: () => ({
        resources: { reputation: 10, compute: 20 },
      }),
    });
    const first = jobs.enqueueJob({
      kind: 'trade',
      title: 'Sell doctrine standing for compute',
      reason: 'First quartermaster leases most of the reputation budget',
      priority: 90,
      payload: { wantResource: 'compute', offerResource: 'reputation', offerAmount: 8, targetZone: 'Market' },
      dedupeKey: 'budget-first-trade',
    });
    const blocked = jobs.enqueueJob({
      kind: 'trade',
      title: 'Sell doctrine standing for bandwidth',
      reason: 'Second lease would oversell reputation across another zone',
      priority: 88,
      payload: { wantResource: 'bandwidth', offerResource: 'reputation', offerAmount: 8, targetZone: 'Workshop' },
      dedupeKey: 'budget-blocked-trade',
    });
    const fallback = jobs.enqueueJob({
      kind: 'trade',
      title: 'Offer compute for storage',
      reason: 'Different offer resource should remain leaseable',
      priority: 82,
      payload: { wantResource: 'storage', offerResource: 'compute', offerAmount: 10, targetZone: 'Residential' },
      dedupeKey: 'budget-fallback-trade',
    });

    const leased = jobs.getNextQueuedJob([], [], 'peer-a');
    assert.equal(leased?.id, first.id);
    assert.equal(leased?.payload.leaseOwner, 'peer-a');

    assert.equal(jobs.leaseQueuedJob(blocked.id, 'peer-b'), null);

    const next = jobs.getNextQueuedJob([], [], 'peer-b');
    assert.equal(next?.id, fallback.id);
    assert.notEqual(next?.id, blocked.id);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('requeueActiveJob moves active wartime duty back to queue with handoff metadata', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const queued = jobs.enqueueJob({
      kind: 'build',
      title: 'Raise doctrine beacon',
      reason: 'Fallback worker claimed a scholar duty',
      priority: 84,
      payload: { lane: 'Library', responseSquad: 'wartime', assignee: 'signal_warden', executor: 'Forge Guard', affinity: 'fallback' },
      dedupeKey: 'autonomy-build-beacon-doctrine',
    });

    const active = jobs.startJob(queued.id, {
      note: 'claimed:Forge Guard | assignee:signal_warden | lane:Library | affinity:fallback',
      payload: { executor: 'Forge Guard', affinity: 'fallback' },
    });
    assert.equal(active?.status, 'active');

    const requeued = jobs.requeueActiveJob(queued.id, {
      note: 'handoff:Quiet Current | assignee:signal_warden | lane:Library',
      payload: {
        previousExecutor: 'Forge Guard',
        previousAffinity: 'fallback',
        handoffRequestedBy: 'Quiet Current',
        handoffRequestedAt: new Date().toISOString(),
      },
    });

    assert.equal(requeued?.status, 'queued');
    assert.equal(requeued?.payload.handoffRequestedBy, 'Quiet Current');
    assert.equal(requeued?.payload.previousExecutor, 'Forge Guard');
    assert.equal(requeued?.payload.handoffCount, 1);
    assert.equal(requeued?.payload.handoffState, 'queued');
    assert.equal(requeued?.payload.progressHint, 'warmup');
    assert.equal(typeof requeued?.payload.handoffCooldownUntil, 'string');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});
test('startJob reactivates handed-off wartime duty with claimed state', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const queued = jobs.enqueueJob({
      kind: 'recover',
      title: 'Run field triage',
      reason: 'Fallback medic needs reassignment',
      priority: 82,
      payload: { lane: 'Residential', responseSquad: 'wartime', assignee: 'field_medic', executor: 'Forge Guard', affinity: 'fallback' },
      dedupeKey: 'autonomy-recover-triage',
    });

    jobs.startJob(queued.id, {
      note: 'claimed:Forge Guard | assignee:field_medic | lane:Residential | affinity:fallback',
      payload: { executor: 'Forge Guard', affinity: 'fallback' },
    });
    jobs.requeueActiveJob(queued.id, {
      note: 'handoff:Quiet Current | assignee:field_medic | lane:Residential',
      payload: { handoffRequestedBy: 'Quiet Current', previousExecutor: 'Forge Guard' },
    });

    const reclaimed = jobs.startJob(queued.id, {
      note: 'claimed:Quiet Current | assignee:field_medic | lane:Residential | affinity:preferred | progress:warmup',
      payload: { executor: 'Quiet Current', affinity: 'preferred' },
    });

    assert.equal(reclaimed?.status, 'active');
    assert.equal(reclaimed?.payload.handoffState, 'active');
    assert.equal(typeof reclaimed?.payload.handoffClaimedAt, 'string');
    assert.equal(reclaimed?.payload.handoffCount, 1);
    assert.equal(reclaimed?.payload.executor, 'Quiet Current');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('retryActiveJob moves active duty back to queue with retry metadata', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const queued = jobs.enqueueJob({
      kind: 'trade',
      title: 'Harden bandwidth lanes',
      reason: 'Trade route should retry on transient failure',
      priority: 89,
      payload: { lane: 'Market', responseSquad: 'wartime', assignee: 'quartermaster', stage: 'sustain' },
      dedupeKey: 'autonomy-raid-bandwidth-trade',
    });

    jobs.startJob(queued.id, {
      note: 'claimed:Quiet Current | assignee:quartermaster | lane:Market | affinity:preferred',
      payload: { executor: 'Quiet Current', affinity: 'preferred' },
    });

    const retried = jobs.retryActiveJob(queued.id, {
      note: 'retry:trade_route_exhausted | attempts:3',
      payload: { lastExecutionFailure: 'trade_route_exhausted', retryRequestedBy: 'Quiet Current' },
    });

    assert.equal(retried?.status, 'queued');
    assert.equal(retried?.payload.retryCount, 1);
    assert.equal(retried?.payload.retryState, 'queued');
    assert.equal(typeof retried?.payload.retryCooldownUntil, 'string');
    assert.equal(retried?.payload.lastExecutionFailure, 'trade_route_exhausted');
    assert.equal(retried?.payload.retryRequestedBy, 'Quiet Current');
    assert.equal(retried?.payload.progressHint, 'warmup');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('startJob reactivates retried duty with active retry state after cooldown', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const queued = jobs.enqueueJob({
      kind: 'trade',
      title: 'Protect compute reserves',
      reason: 'Retried duty should reactivate cleanly after cooldown',
      priority: 88,
      payload: {
        lane: 'Market',
        responseSquad: 'wartime',
        assignee: 'quartermaster',
        stage: 'sustain',
        retryCount: 1,
        retryState: 'queued',
        lastExecutionFailure: 'trade_route_exhausted',
        retryCooldownUntil: new Date(Date.now() - 1_000).toISOString(),
      },
      dedupeKey: 'autonomy-raid-compute-trade',
    });

    const restarted = jobs.startJob(queued.id, {
      note: 'claimed:Quiet Current | assignee:quartermaster | lane:Market | affinity:preferred | progress:warmup',
      payload: { executor: 'Quiet Current', affinity: 'preferred' },
    });

    assert.equal(restarted?.status, 'active');
    assert.equal(restarted?.payload.retryCount, 1);
    assert.equal(restarted?.payload.retryState, 'active');
    assert.equal(typeof restarted?.payload.retryClaimedAt, 'string');
    assert.equal(restarted?.payload.lastExecutionFailure, 'trade_route_exhausted');

    await jobs.destroy();
  } finally {
    cleanup();
  }
});


test('getNextQueuedJob skips jobs inside retry cooldown', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const cooling = jobs.enqueueJob({
      kind: 'trade',
      title: 'Cooling trade retry',
      reason: 'Retry cooldown should defer claim',
      priority: 99,
      payload: { retryCount: 1, retryCooldownUntil: new Date(Date.now() + 60_000).toISOString(), responseSquad: 'wartime', assignee: 'quartermaster' },
      dedupeKey: 'retry-cooling-trade',
    });
    const ready = jobs.enqueueJob({
      kind: 'build',
      title: 'Ready fallback duty',
      reason: 'Should be claimable while retry cools',
      priority: 80,
      payload: { responseSquad: 'wartime', assignee: 'bulwark_engineer', lane: 'Workshop' },
      dedupeKey: 'ready-duty',
    });

    const next = jobs.getNextQueuedJob();
    assert.equal(next?.id, ready.id);
    assert.notEqual(next?.id, cooling.id);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});

test('startJob defers queued retry while cooldown is active', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const jobs = new JobsSystem({ dbPath });
    const queued = jobs.enqueueJob({
      kind: 'trade',
      title: 'Retry cooling trade',
      reason: 'Cooldown should block claim',
      priority: 88,
      payload: { retryCount: 1, retryCooldownUntil: new Date(Date.now() + 60_000).toISOString(), responseSquad: 'wartime', assignee: 'quartermaster' },
      dedupeKey: 'retry-cooling-claim',
    });

    const active = jobs.startJob(queued.id, { payload: { executor: 'Quiet Current' } });
    assert.equal(active, null);

    await jobs.destroy();
  } finally {
    cleanup();
  }
});
