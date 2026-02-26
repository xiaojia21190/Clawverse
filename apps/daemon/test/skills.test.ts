import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillsTracker } from '../src/skills.js';
import type { SkillKey } from '../src/skills.js';

function makeTmp(): { dbPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-skills-'));
  const dbPath = join(root, 'clawverse.db');
  return { dbPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('initial skills are all level 0', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const tracker = new SkillsTracker({ dbPath });
    const skills = tracker.getSkills();
    assert.equal(skills.social.level, 0);
    assert.equal(skills.collab.level, 0);
    assert.equal(skills.explorer.level, 0);
    assert.equal(skills.analyst.level, 0);
    await tracker.destroy();
  } finally { cleanup(); }
});

test('gainXP accumulates and returns null when no level-up', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const tracker = new SkillsTracker({ dbPath });
    const result = tracker.gainXP('social', 10);
    assert.equal(result, null);
    assert.equal(tracker.getSkills().social.xp, 10);
    await tracker.destroy();
  } finally { cleanup(); }
});

test('gainXP returns LevelUpEvent when crossing threshold', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const tracker = new SkillsTracker({ dbPath });
    // Threshold for level 1 is 50
    const result = tracker.gainXP('explorer', 50);
    assert.ok(result);
    assert.equal(result!.skill, 'explorer');
    assert.equal(result!.level, 1);
    assert.equal(tracker.getLevel('explorer'), 1);
    await tracker.destroy();
  } finally { cleanup(); }
});

test('multiple gainXP calls accumulate correctly', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const tracker = new SkillsTracker({ dbPath });
    tracker.gainXP('analyst', 30);
    tracker.gainXP('analyst', 30);
    assert.equal(tracker.getSkills().analyst.xp, 60);
    assert.equal(tracker.getLevel('analyst'), 1); // 60 >= 50
    await tracker.destroy();
  } finally { cleanup(); }
});

test('level thresholds: 0→50→150→350→700→1200', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const tracker = new SkillsTracker({ dbPath });
    tracker.gainXP('collab', 49);
    assert.equal(tracker.getLevel('collab'), 0);
    tracker.gainXP('collab', 1); // 50
    assert.equal(tracker.getLevel('collab'), 1);
    tracker.gainXP('collab', 100); // 150
    assert.equal(tracker.getLevel('collab'), 2);
    tracker.gainXP('collab', 200); // 350
    assert.equal(tracker.getLevel('collab'), 3);
    tracker.gainXP('collab', 350); // 700
    assert.equal(tracker.getLevel('collab'), 4);
    tracker.gainXP('collab', 500); // 1200
    assert.equal(tracker.getLevel('collab'), 5);
    await tracker.destroy();
  } finally { cleanup(); }
});

test('state persists across instances', async () => {
  const { dbPath, cleanup } = makeTmp();
  try {
    const t1 = new SkillsTracker({ dbPath });
    t1.gainXP('social', 100);
    await t1.destroy();

    const t2 = new SkillsTracker({ dbPath });
    assert.equal(t2.getSkills().social.xp, 100);
    assert.equal(t2.getLevel('social'), 1);
    await t2.destroy();
  } finally { cleanup(); }
});
