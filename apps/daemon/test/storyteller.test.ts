import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEngine } from '../src/events.js';
import { Storyteller } from '../src/storyteller.js';

function makeTmp(): { dbPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-storyteller-'));
  const dbPath = join(root, 'clawverse.db');
  return {
    dbPath,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // SQLite file can stay briefly locked on Windows.
      }
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function createStoryteller(dbPath: string, opts?: { distressedCount?: number; compute?: number }) {
  const events = new EventEngine({ dbPath });
  const distressedCount = opts?.distressedCount ?? 0;
  const compute = opts?.compute ?? 40;
  const peers = Array.from({ length: distressedCount }, (_, index) => ({ id: `peer-${index}`, mood: 'distressed' }));

  const storyteller = new Storyteller(
    events,
    { getAllPeers: () => peers } as any,
    { getAllRelationships: () => [] } as any,
    { getNeeds: () => ({ social: 80, tasked: 80, wanderlust: 80, creative: 80 }) } as any,
    { getResources: () => ({ compute, storage: 0, bandwidth: 0, reputation: 0 }) } as any,
    undefined,
    { chainDelayMultiplier: 0.0001 },
  );

  return { events, storyteller };
}

test('resource drought schedules and triggers a need cascade follow-up', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const { events, storyteller } = createStoryteller(dbPath, { compute: 40 });
    storyteller.triggerEvent('resource_drought', { severity: 'mild' });

    const initialStatus = storyteller.getStatus();
    assert.equal(initialStatus.activeChains.length, 1);
    assert.equal(initialStatus.activeChains[0]?.nextType, 'need_cascade');

    await wait(40);

    const pendingTypes = events.getPending().map((event) => event.type);
    assert.ok(pendingTypes.includes('resource_drought'));
    assert.ok(pendingTypes.includes('need_cascade'));

    const finalStatus = storyteller.getStatus();
    assert.equal(finalStatus.activeChains.length, 0);
    assert.equal(finalStatus.recentChains[0]?.status, 'triggered');

    storyteller.stop();
    await events.destroy();
  } finally {
    cleanup();
  }
});

test('mood crisis follow-up is skipped when tension condition is not met', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const { events, storyteller } = createStoryteller(dbPath, { distressedCount: 0, compute: 95 });
    storyteller.triggerEvent('mood_crisis', { count: 2 });

    await wait(30);

    const pendingTypes = events.getPending().map((event) => event.type);
    assert.ok(pendingTypes.includes('mood_crisis'));
    assert.ok(!pendingTypes.includes('resource_windfall'));

    const status = storyteller.getStatus();
    assert.equal(status.activeChains.length, 0);
    assert.equal(status.recentChains[0]?.status, 'skipped');

    storyteller.stop();
    await events.destroy();
  } finally {
    cleanup();
  }
});

test('relationship milestone emitted by event engine schedules faction founding follow-up', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const { events, storyteller } = createStoryteller(dbPath, { compute: 40 });
    events.emit('relationship_milestone', { prev: 'friend', next: 'ally', peerId: 'peer-42' });

    const initialStatus = storyteller.getStatus();
    assert.equal(initialStatus.activeChains.length, 1);
    assert.equal(initialStatus.activeChains[0]?.nextType, 'faction_founding');

    await wait(40);

    const pendingTypes = events.getPending().map((event) => event.type);
    assert.ok(pendingTypes.includes('relationship_milestone'));
    assert.ok(pendingTypes.includes('faction_founding'));

    storyteller.stop();
    await events.destroy();
  } finally {
    cleanup();
  }
});

test('building completed with archive can schedule a resource windfall', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const { events, storyteller } = createStoryteller(dbPath, { compute: 40 });
    storyteller.triggerEvent('building_completed', { buildingType: 'archive' });

    const initialStatus = storyteller.getStatus();
    assert.equal(initialStatus.activeChains[0]?.nextType, 'resource_windfall');

    await wait(40);

    const pendingTypes = events.getPending().map((event) => event.type);
    assert.ok(pendingTypes.includes('building_completed'));
    assert.ok(pendingTypes.includes('resource_windfall'));

    storyteller.stop();
    await events.destroy();
  } finally {
    cleanup();
  }
});

test('building completed with beacon schedules and triggers stranger arrival', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const { events, storyteller } = createStoryteller(dbPath, { compute: 40 });
    storyteller.triggerEvent('building_completed', { buildingType: 'beacon' });

    const initialStatus = storyteller.getStatus();
    assert.equal(initialStatus.activeChains[0]?.nextType, 'stranger_arrival');

    await wait(40);

    const pendingTypes = events.getPending().map((event) => event.type);
    assert.ok(pendingTypes.includes('building_completed'));
    assert.ok(pendingTypes.includes('stranger_arrival'));

    storyteller.stop();
    await events.destroy();
  } finally {
    cleanup();
  }
});

test('storage overflow can degrade into a resource drought', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const { events, storyteller } = createStoryteller(dbPath, { distressedCount: 1, compute: 30 });
    storyteller.triggerEvent('storage_overflow', { storage: 185 });

    const initialStatus = storyteller.getStatus();
    assert.equal(initialStatus.activeChains[0]?.nextType, 'resource_drought');

    await wait(40);

    const pendingTypes = events.getPending().map((event) => event.type);
    assert.ok(pendingTypes.includes('storage_overflow'));
    assert.ok(pendingTypes.includes('resource_drought'));

    storyteller.stop();
    await events.destroy();
  } finally {
    cleanup();
  }
});

test('betrayal can escalate into faction war under high tension', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const { events, storyteller } = createStoryteller(dbPath, { distressedCount: 2, compute: 40 });
    storyteller.triggerEvent('betrayal', { peerId: 'peer-7' });

    const initialStatus = storyteller.getStatus();
    assert.equal(initialStatus.activeChains[0]?.nextType, 'faction_war');

    await wait(40);

    const pendingTypes = events.getPending().map((event) => event.type);
    assert.ok(pendingTypes.includes('betrayal'));
    assert.ok(pendingTypes.includes('faction_war'));

    storyteller.stop();
    await events.destroy();
  } finally {
    cleanup();
  }
});

test('skill tournament can become a legacy event', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const { events, storyteller } = createStoryteller(dbPath, { compute: 40 });
    storyteller.triggerEvent('skill_tournament', { skill: 'strategy' });

    const initialStatus = storyteller.getStatus();
    assert.equal(initialStatus.activeChains[0]?.nextType, 'legacy_event');

    await wait(40);

    const legacy = events.getPending().find((event) => event.type === 'legacy_event');
    assert.ok(legacy);
    assert.equal(legacy?.payload.description, 'A champion performance becomes part of town lore.');

    storyteller.stop();
    await events.destroy();
  } finally {
    cleanup();
  }
});
test('faction ascendant can become a legacy event', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const { events, storyteller } = createStoryteller(dbPath, { compute: 40 });
    storyteller.triggerEvent('faction_ascendant', { factionId: 'fac-1', factionName: 'Market League' });

    const initialStatus = storyteller.getStatus();
    assert.equal(initialStatus.activeChains[0]?.nextType, 'legacy_event');

    await wait(40);

    const legacy = events.getPending().find((event) => event.type === 'legacy_event');
    assert.ok(legacy);
    assert.equal(legacy?.payload.triggered_by, 'faction_ascendant');
    assert.equal(legacy?.payload.description, 'Market League claims lasting prestige across the town.');

    storyteller.stop();
    await events.destroy();
  } finally {
    cleanup();
  }
});

test('faction splintering can escalate into betrayal under pressure', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const { events, storyteller } = createStoryteller(dbPath, { distressedCount: 2, compute: 40 });
    storyteller.triggerEvent('faction_splintering', { factionId: 'fac-2', factionName: 'Alpha Frontier' });

    const initialStatus = storyteller.getStatus();
    assert.equal(initialStatus.activeChains[0]?.nextType, 'betrayal');

    await wait(40);

    const betrayal = events.getPending().find((event) => event.type === 'betrayal');
    assert.ok(betrayal);
    assert.equal(betrayal?.payload.triggered_by, 'faction_splintering');
    assert.equal(betrayal?.payload.factionName, 'Alpha Frontier');

    storyteller.stop();
    await events.destroy();
  } finally {
    cleanup();
  }
});


test('death can cascade into succession splintering migration and memorial legacy', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const { events, storyteller } = createStoryteller(dbPath, { distressedCount: 2, compute: 35 });
    storyteller.triggerEvent('death', { cause: 'raid', factionId: 'fac-9', factionName: 'Local coalition' });

    const initialStatus = storyteller.getStatus();
    assert.equal(initialStatus.activeChains.length, 4);

    await wait(60);

    const pending = events.getPending();
    const pendingTypes = pending.map((event) => event.type);
    assert.ok(pendingTypes.includes('death'));
    assert.ok(pendingTypes.includes('faction_splintering'));
    assert.ok(pendingTypes.includes('faction_ascendant'));
    assert.ok(pendingTypes.includes('great_migration'));
    const ascendant = pending.find((event) => event.type === 'faction_ascendant');
    assert.ok(ascendant);
    assert.equal(ascendant?.payload.triggered_by, 'death');
    assert.equal(ascendant?.payload.factionId, 'fac-9');
    assert.equal(ascendant?.payload.description, 'Local coalition consolidates power after the collapse.');
    const legacy = pending.find((event) => event.type === 'legacy_event');
    assert.ok(legacy);
    assert.equal(legacy?.payload.triggered_by, 'death');
    assert.equal(legacy?.payload.description, 'Local coalition is remembered in a memorial wake after the collapse.');

    storyteller.stop();
    await events.destroy();
  } finally {
    cleanup();
  }
});
