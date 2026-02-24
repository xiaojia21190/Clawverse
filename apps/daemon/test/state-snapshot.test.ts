import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { StateStore } from '../src/state.js';

test('saveSnapshot persists after destroy and can be loaded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-state-'));
  const dbPath = join(root, 'clawverse.db');
  const snapshotKey = 'latest';

  try {
    const store = new StateStore({ dbPath });
    store.setMyId('peer-1');
    store.updateMyStructure({ name: 'Peer One', position: { x: 2, y: 3 } });
    store.saveSnapshot(snapshotKey);
    await store.destroy();

    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare(`
        SELECT snapshot_key
        FROM state_snapshots
        WHERE snapshot_key = ?
      `).get(snapshotKey) as { snapshot_key: string } | undefined;
      assert.equal(row?.snapshot_key, snapshotKey);
    } finally {
      db.close();
    }

    const loaded = new StateStore({ dbPath });
    const ok = loaded.loadSnapshot(snapshotKey);
    assert.equal(ok, true);
    const peer = loaded.getPeerState('peer-1');
    assert.equal(peer?.name, 'Peer One');
    await loaded.destroy();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
