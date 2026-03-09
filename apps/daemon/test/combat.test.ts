import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CombatSystem } from '../src/combat.js';

function makeTmp(): { dbPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-combat-'));
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

const healthyResources = {
  compute: 80,
  storage: 80,
  bandwidth: 60,
  reputation: 10,
  updatedAt: new Date().toISOString(),
};

test('combat tick raises a raid alert and resolves damage on the next tick', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const combat = new CombatSystem({ dbPath, raidCooldownMs: 0 });

    const first = combat.tick({
      tension: 88,
      activeWar: true,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });

    assert.equal(first.emitted[0]?.type, 'raid_alert');
    assert.ok(combat.getStatus().activeRaid);

    const second = combat.tick({
      tension: 88,
      activeWar: true,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });

    const status = combat.getStatus();
    assert.equal(status.activeRaid, null);
    assert.ok(status.hp < 100);
    assert.ok(second.emitted.some((entry) => entry.type === 'combat_report'));
    assert.ok(second.resourceLosses.compute && second.resourceLosses.compute > 0);
    assert.ok(second.resourceLosses.storage && second.resourceLosses.storage > 0);

    await combat.destroy();
  } finally {
    cleanup();
  }
});

test('combat recovery heals hp and can clear low-severity injuries', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const combat = new CombatSystem({ dbPath, raidCooldownMs: 0 });

    combat.tick({
      tension: 94,
      activeWar: true,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });
    assert.ok(combat.getStatus().activeRaid);

    combat.tick({
      tension: 94,
      activeWar: true,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });

    const before = combat.getStatus();
    assert.ok(before.hp < 100);

    for (let index = 0; index < 8; index += 1) {
      combat.tick({
        tension: 10,
        activeWar: false,
        hasShelter: true,
        hasRelayPatch: false,
        resources: healthyResources,
      });
    }

    const after = combat.getStatus();
    assert.ok(after.hp >= before.hp);
    assert.ok(after.pain <= before.pain);
    assert.ok(['stable', 'injured'].includes(after.status));

    await combat.destroy();
  } finally {
    cleanup();
  }
});


test('fortified posture reduces raid risk and treatment restores health', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const combat = new CombatSystem({ dbPath, raidCooldownMs: 0 });

    const steady = combat.tick({
      tension: 76,
      activeWar: false,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });
    const riskSteady = combat.getStatus().raidRisk;

    combat.setPosture('fortified');
    combat.tick({
      tension: 76,
      activeWar: false,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });
    const riskFortified = combat.getStatus().raidRisk;
    assert.ok(riskFortified < riskSteady);

    combat.tick({
      tension: 94,
      activeWar: true,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });
    assert.ok(combat.getStatus().activeRaid);

    combat.tick({
      tension: 94,
      activeWar: true,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });
    const beforeTreat = combat.getStatus();
    const treated = combat.treat({ hasShelter: true, canUseRelayPatch: true });
    const afterTreat = combat.getStatus();

    assert.equal(treated.ok, true);
    assert.ok(afterTreat.hp > beforeTreat.hp);
    assert.ok(afterTreat.pain < beforeTreat.pain);

    await combat.destroy();
  } finally {
    cleanup();
  }
});


test('beacon early warning changes raid profile and reduces raid impact', async () => {
  const left = makeTmp();
  const right = makeTmp();
  const strainedResources = {
    ...healthyResources,
    compute: 15,
    bandwidth: 10,
  };

  try {
    const baseline = new CombatSystem({ dbPath: left.dbPath, raidCooldownMs: 0 });
    baseline.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasRelayPatch: false,
      resources: strainedResources,
    });
    const baselineRaid = baseline.getStatus();
    assert.equal(baselineRaid.activeRaid?.source, 'blackout_raiders');
    assert.equal(baselineRaid.activeRaid?.severity, 'high');
    const baselineEffect = baseline.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasRelayPatch: false,
      resources: strainedResources,
    });
    const baselineAfter = baseline.getStatus();

    const defended = new CombatSystem({ dbPath: right.dbPath, raidCooldownMs: 0 });
    defended.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: true,
      hasRelayPatch: false,
      resources: strainedResources,
    });
    const defendedRaid = defended.getStatus();
    assert.equal(defendedRaid.activeRaid?.source, 'blackout_raiders');
    assert.equal(defendedRaid.activeRaid?.severity, 'low');
    assert.ok(defendedRaid.raidRisk < baselineRaid.raidRisk);

    defended.setPosture('guarded');
    const defendedEffect = defended.tick({
      tension: 110,
      activeWar: false,
      hasShelter: true,
      hasBeacon: true,
      hasRelayPatch: false,
      resources: strainedResources,
    });
    const defendedAfter = defended.getStatus();

    assert.ok(defendedAfter.hp > baselineAfter.hp);
    assert.ok((defendedEffect.resourceLosses.compute ?? 0) < (baselineEffect.resourceLosses.compute ?? 0));
    assert.ok((defendedEffect.resourceLosses.storage ?? 0) < (baselineEffect.resourceLosses.storage ?? 0));

    await baseline.destroy();
    await defended.destroy();
  } finally {
    left.cleanup();
    right.cleanup();
  }
});


test('watchtower lowers raid risk and absorbs a heavier first impact', async () => {
  const left = makeTmp();
  const right = makeTmp();
  const strainedResources = {
    ...healthyResources,
    compute: 15,
    bandwidth: 10,
  };

  try {
    const baseline = new CombatSystem({ dbPath: left.dbPath, raidCooldownMs: 0 });
    baseline.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: strainedResources,
    });
    const baselineRaid = baseline.getStatus();
    const baselineEffect = baseline.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: strainedResources,
    });
    const baselineAfter = baseline.getStatus();

    const defended = new CombatSystem({ dbPath: right.dbPath, raidCooldownMs: 0 });
    defended.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: true,
      hasRelayPatch: false,
      resources: strainedResources,
    });
    const defendedRaid = defended.getStatus();
    const defendedEffect = defended.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: true,
      hasRelayPatch: false,
      resources: strainedResources,
    });
    const defendedAfter = defended.getStatus();

    assert.ok(defendedRaid.raidRisk < baselineRaid.raidRisk);
    assert.ok(defendedAfter.hp > baselineAfter.hp);
    assert.ok((defendedEffect.resourceLosses.compute ?? 0) < (baselineEffect.resourceLosses.compute ?? 0));
    assert.ok((defendedEffect.resourceLosses.storage ?? 0) < (baselineEffect.resourceLosses.storage ?? 0));

    await baseline.destroy();
    await defended.destroy();
  } finally {
    left.cleanup();
    right.cleanup();
  }
});


test('raid sources focus different resource targets', async () => {
  const left = makeTmp();
  const right = makeTmp();

  try {
    const pirates = new CombatSystem({ dbPath: left.dbPath, raidCooldownMs: 0 });
    pirates.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: { ...healthyResources, bandwidth: 10 },
    });
    const pirateEffect = pirates.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: { ...healthyResources, bandwidth: 10 },
    });

    const scavengers = new CombatSystem({ dbPath: right.dbPath, raidCooldownMs: 0 });
    scavengers.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: { ...healthyResources, compute: 15 },
    });
    const scavengerEffect = scavengers.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: { ...healthyResources, compute: 15 },
    });

    assert.ok((pirateEffect.resourceLosses.bandwidth ?? 0) > (pirateEffect.resourceLosses.compute ?? 0));
    assert.ok((scavengerEffect.resourceLosses.compute ?? 0) > (scavengerEffect.resourceLosses.bandwidth ?? 0));

    await pirates.destroy();
    await scavengers.destroy();
  } finally {
    left.cleanup();
    right.cleanup();
  }
});


test('surviving raid sources yields different salvage rewards', async () => {
  const left = makeTmp();
  const right = makeTmp();

  try {
    const pirates = new CombatSystem({ dbPath: left.dbPath, raidCooldownMs: 0 });
    pirates.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: { ...healthyResources, bandwidth: 10 },
    });
    const pirateEffect = pirates.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: { ...healthyResources, bandwidth: 10 },
    });

    const scavengers = new CombatSystem({ dbPath: right.dbPath, raidCooldownMs: 0 });
    scavengers.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: { ...healthyResources, compute: 15 },
    });
    const scavengerEffect = scavengers.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: { ...healthyResources, compute: 15 },
    });

    assert.ok((pirateEffect.resourceAwards.bandwidth ?? 0) > 0);
    assert.ok((scavengerEffect.resourceAwards.compute ?? 0) > 0);

    await pirates.destroy();
    await scavengers.destroy();
  } finally {
    left.cleanup();
    right.cleanup();
  }
});


test('untreated injuries worsen into chronic pain without medical support', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const combat = new CombatSystem({ dbPath, raidCooldownMs: 0 });

    combat.tick({
      tension: 94,
      activeWar: true,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });
    combat.tick({
      tension: 94,
      activeWar: true,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });

    const before = combat.getStatus();
    let lastEffect = combat.tick({
      tension: 10,
      activeWar: false,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });
    for (let index = 0; index < 4; index += 1) {
      lastEffect = combat.tick({
        tension: 10,
        activeWar: false,
        hasShelter: false,
        hasRelayPatch: false,
        resources: healthyResources,
      });
    }

    const after = combat.getStatus();
    assert.ok(after.hp < before.hp);
    assert.ok(after.chronicPain > 0);
    assert.ok(after.careDebt > 0);
    assert.ok(after.injuries.some((injury) => injury.complication === 'untreated'));
    assert.ok(lastEffect.emitted.some((entry) => entry.type === 'combat_report'));

    await combat.destroy();
  } finally {
    cleanup();
  }
});

test('treatment fails without medical support on severe injuries', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const combat = new CombatSystem({ dbPath, raidCooldownMs: 0 });

    combat.tick({
      tension: 94,
      activeWar: true,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });
    combat.tick({
      tension: 94,
      activeWar: true,
      hasShelter: false,
      hasRelayPatch: false,
      resources: healthyResources,
    });

    const before = combat.getStatus();
    const treated = combat.treat({ hasShelter: false, canUseRelayPatch: false });
    const after = combat.getStatus();

    assert.equal(treated.ok, false);
    assert.equal(treated.reason, 'insufficient_medical_support');
    assert.ok(after.pain > before.pain);
    assert.ok(after.careDebt >= before.careDebt);

    await combat.destroy();
  } finally {
    cleanup();
  }
});


test('raid alerts expose doctrine metadata and recommended posture', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const combat = new CombatSystem({ dbPath, raidCooldownMs: 0 });
    combat.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: { ...healthyResources, bandwidth: 10 },
    });

    const activeRaid = combat.getStatus().activeRaid;
    assert.equal(activeRaid?.source, 'bandwidth_pirates');
    assert.equal(activeRaid?.recommendedPosture, 'guarded');
    assert.match(String(activeRaid?.countermeasure ?? ''), /beacon/i);

    await combat.destroy();
  } finally {
    cleanup();
  }
});

test('different raid sources expose different doctrine recommendations', async () => {
  const left = makeTmp();
  const right = makeTmp();

  try {
    const pirates = new CombatSystem({ dbPath: left.dbPath, raidCooldownMs: 0 });
    pirates.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: { ...healthyResources, bandwidth: 10 },
    });
    const pirateRaid = pirates.getStatus().activeRaid;

    const blackout = new CombatSystem({ dbPath: right.dbPath, raidCooldownMs: 0 });
    blackout.tick({
      tension: 110,
      activeWar: false,
      hasShelter: false,
      hasBeacon: false,
      hasWatchtower: false,
      hasRelayPatch: false,
      resources: { ...healthyResources, bandwidth: 10, compute: 15 },
    });
    const blackoutRaid = blackout.getStatus().activeRaid;

    assert.equal(pirateRaid?.recommendedPosture, 'guarded');
    assert.equal(blackoutRaid?.recommendedPosture, 'fortified');
    assert.match(String(pirateRaid?.countermeasure ?? ''), /beacon/i);
    assert.match(String(blackoutRaid?.countermeasure ?? ''), /relay/i);

    await pirates.destroy();
    await blackout.destroy();
  } finally {
    left.cleanup();
    right.cleanup();
  }
});

