import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorldMap } from '../src/world.js';

function makeTmp(): { dbPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-world-'));
  const dbPath = join(root, 'clawverse.db');
  return { dbPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('getMap returns terrain + empty buildings', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const world = new WorldMap({ dbPath });
    const map = world.getMap();
    assert.equal(map.gridSize, 40);
    assert.equal(map.terrain.length, 40 * 40);
    assert.equal(map.buildings.length, 0);
    await world.destroy();
  } finally { cleanup(); }
});

test('terrain has road and water zones', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const world = new WorldMap({ dbPath });
    const map = world.getMap();
    assert.ok(map.terrain.includes('road'));
    assert.ok(map.terrain.includes('water'));
    assert.ok(map.terrain.includes('grass'));
    await world.destroy();
  } finally { cleanup(); }
});

test('build creates a building on valid land', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const world = new WorldMap({ dbPath });
    const b = world.build('forge', { x: 5, y: 5 }, 'peer-1', 'TestPeer');
    assert.ok(b);
    assert.equal(b!.type, 'forge');
    assert.equal(b!.ownerId, 'peer-1');
    assert.equal(world.getBuildings().length, 1);
    await world.destroy();
  } finally { cleanup(); }
});

test('build fails on water tile', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const world = new WorldMap({ dbPath });
    // Water zone is (30-39, 30-39)
    const b = world.build('forge', { x: 35, y: 35 }, 'peer-1', 'TestPeer');
    assert.equal(b, null);
    await world.destroy();
  } finally { cleanup(); }
});

test('build fails on occupied position', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const world = new WorldMap({ dbPath });
    world.build('forge', { x: 5, y: 5 }, 'peer-1', 'TestPeer');
    const b2 = world.build('archive', { x: 5, y: 5 }, 'peer-2', 'TestPeer2');
    assert.equal(b2, null);
    await world.destroy();
  } finally { cleanup(); }
});

test('demolish removes own building', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const world = new WorldMap({ dbPath });
    const b = world.build('forge', { x: 5, y: 5 }, 'peer-1', 'TestPeer');
    assert.ok(b);
    assert.equal(world.demolish(b!.id, 'peer-1'), true);
    assert.equal(world.getBuildings().length, 0);
    await world.destroy();
  } finally { cleanup(); }
});

test('demolish rejects if not owner', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const world = new WorldMap({ dbPath });
    const b = world.build('forge', { x: 5, y: 5 }, 'peer-1', 'TestPeer');
    assert.ok(b);
    assert.equal(world.demolish(b!.id, 'peer-2'), false);
    assert.equal(world.getBuildings().length, 1);
    await world.destroy();
  } finally { cleanup(); }
});

test('getBuildingCost returns known costs', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const world = new WorldMap({ dbPath });
    const cost = world.getBuildingCost('forge');
    assert.equal(cost.compute, 30);
    assert.equal(cost.storage, 20);
    await world.destroy();
  } finally { cleanup(); }
});

test('getZoneEffect for Market enables trading', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const world = new WorldMap({ dbPath });
    const effect = world.getZoneEffect({ x: 15, y: 5 }); // Market zone
    assert.equal(effect.tradingEnabled, true);
    await world.destroy();
  } finally { cleanup(); }
});

test('buildings persist across instances', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const w1 = new WorldMap({ dbPath });
    w1.build('beacon', { x: 8, y: 8 }, 'peer-1', 'TestPeer');
    await w1.destroy();

    const w2 = new WorldMap({ dbPath });
    assert.equal(w2.getBuildings().length, 1);
    assert.equal(w2.getBuildings()[0].type, 'beacon');
    await w2.destroy();
  } finally { cleanup(); }
});
