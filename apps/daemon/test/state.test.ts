import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StateStore } from '../src/state.js';

function makeTmp(): { dbPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-state-'));
  const dbPath = join(root, 'clawverse.db');
  return {
    dbPath,
    cleanup: () => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

test('peer market profile survives volatile state round-trip', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const state = new StateStore({ dbPath });
    state.updatePeerStructure('peer-market', {
      name: 'Market Peer',
      position: { x: 12, y: 4 },
    });
    state.updatePeerVolatile('peer-market', {
      mood: 'working',
      cpuUsage: 22,
      ramUsage: 31,
      market: {
        resources: { compute: 48, storage: 72, bandwidth: 15, reputation: 9 },
        inventory: { dataShard: 2, alloyFrame: 1, relayPatch: 0 },
        updatedAt: '2026-03-07T13:00:00.000Z',
      },
    });

    const peer = state.getPeerState('peer-market');
    assert.equal(peer?.market?.resources?.storage, 72);
    assert.equal(peer?.market?.resources?.compute, 48);
    assert.equal(peer?.market?.inventory?.dataShard, 2);
    assert.equal(peer?.market?.inventory?.alloyFrame, 1);
    assert.equal(peer?.market?.updatedAt, '2026-03-07T13:00:00.000Z');

    await state.destroy();
  } finally {
    cleanup();
  }
});
