import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { CollabSystem } from '../src/collab.js';

test('submitTask returns accurate submitted/error semantics', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-collab-'));
  const dbPath = join(root, 'clawverse.db');

  try {
    const collab = new CollabSystem({ dbPath });

    const noHandler = await collab.submitTask('peer-A', 'ctx', 'question-no-handler');
    assert.equal(noHandler.submitted, false);
    assert.equal(noHandler.error, 'submit_handler_not_initialized');

    collab.init({
      onSubmit: async (task) => task.question !== 'question-fail',
      sendResult: async () => undefined,
    });

    const failed = await collab.submitTask('peer-A', 'ctx', 'question-fail');
    assert.equal(failed.submitted, false);
    assert.equal(failed.error, 'send_to_peer_failed');

    const success = await collab.submitTask('peer-A', 'ctx', 'question-ok');
    assert.equal(success.submitted, true);
    assert.equal(success.error, undefined);

    await collab.destroy();

    const db = new DatabaseSync(dbPath);
    try {
      const failedCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM collab_logs
        WHERE dir = 'out-failed'
      `).get() as { count: number };
      const okCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM collab_logs
        WHERE dir = 'out'
      `).get() as { count: number };
      assert.equal(failedCount.count, 2);
      assert.equal(okCount.count, 1);

      const stat = db.prepare(`
        SELECT tasks_sent
        FROM collab_stats
        WHERE peer_id = ?
      `).get('peer-A') as { tasks_sent: number } | undefined;
      assert.equal(stat?.tasks_sent, 1);
    } finally {
      db.close();
    }
  } finally {
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(root, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
  }
});
