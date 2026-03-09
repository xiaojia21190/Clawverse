import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NeedsSystem } from '../src/needs.js';

function makeTmp(): { dbPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-needs-'));
  const dbPath = join(root, 'clawverse.db');
  return {
    dbPath,
    cleanup: () => { try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows EBUSY */ } },
  };
}

test('initial needs are all 80', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const needs = new NeedsSystem(5000, { dbPath });
    const state = needs.getNeeds();
    assert.equal(state.social, 80);
    assert.equal(state.tasked, 80);
    assert.equal(state.wanderlust, 80);
    assert.equal(state.creative, 80);
    await needs.destroy();
  } finally { cleanup(); }
});

test('tick decays all needs', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const needs = new NeedsSystem(5000, { dbPath });
    needs.tick();
    const state = needs.getNeeds();
    assert.ok(state.social < 80);
    assert.ok(state.tasked < 80);
    assert.ok(state.wanderlust < 80);
    assert.ok(state.creative < 80);
    await needs.destroy();
  } finally { cleanup(); }
});

test('satisfy increases need, capped at 100', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const needs = new NeedsSystem(5000, { dbPath });
    needs.satisfy('social', 50);
    assert.equal(needs.getNeeds().social, 100); // 80 + 50 capped at 100
    await needs.destroy();
  } finally { cleanup(); }
});

test('isCritical returns true when need < 15', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    // heartbeatMs=3_600_000 → decayPerTick = 100/2 = 50 per tick
    const needs = new NeedsSystem(3_600_000, { dbPath });
    needs.tick(); // 80 → 30
    needs.tick(); // 30 → 0
    assert.ok(needs.isCritical('social'));
    await needs.destroy();
  } finally { cleanup(); }
});

test('applyNeedsMood returns sleeping unchanged', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const needs = new NeedsSystem(5000, { dbPath });
    assert.equal(needs.applyNeedsMood('sleeping'), 'sleeping');
    await needs.destroy();
  } finally { cleanup(); }
});

test('applyNeedsMood upgrades mood when needs are high', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const needs = new NeedsSystem(5000, { dbPath });
    // All needs are 80 (> 60), so mood should improve
    const result = needs.applyNeedsMood('working');
    assert.equal(result, 'idle'); // working → idle (improved)
    await needs.destroy();
  } finally { cleanup(); }
});

test('applyNeedsMood returns distressed when 2+ needs are critical', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    // heartbeatMs=3_600_000 → decayPerTick = 50, so 2 ticks → all needs at 0
    const needs = new NeedsSystem(3_600_000, { dbPath });
    needs.tick();
    needs.tick();
    const result = needs.applyNeedsMood('idle');
    assert.equal(result, 'distressed');
    await needs.destroy();
  } finally { cleanup(); }
});

test('state persists across instances', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const n1 = new NeedsSystem(5000, { dbPath });
    n1.satisfy('creative', 20); // 80 → 100
    n1.tick(); // slight decay
    const snap = n1.getNeeds().creative;
    await n1.destroy();

    const n2 = new NeedsSystem(5000, { dbPath });
    assert.equal(n2.getNeeds().creative, snap);
    await n2.destroy();
  } finally { cleanup(); }
});


test('tick supports per-need decay multipliers', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const needs = new NeedsSystem(3_600_000, { dbPath });
    needs.tick({ social: 0.5, creative: 0 });
    const state = needs.getNeeds();
    assert.equal(state.social, 55);
    assert.equal(state.creative, 80);
    assert.equal(state.tasked, 30);
    assert.equal(state.wanderlust, 30);
    await needs.destroy();
  } finally { cleanup(); }
});
