import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

export type SkillKey = 'social' | 'collab' | 'explorer' | 'analyst';

export interface SkillState {
  xp: number;
  level: number;
}

export interface SkillsState {
  social: SkillState;
  collab: SkillState;
  explorer: SkillState;
  analyst: SkillState;
  updatedAt: string;
}

export interface LevelUpEvent {
  skill: SkillKey;
  level: number;
  ts: string;
}

const THRESHOLDS = [50, 150, 350, 700, 1200];

function computeLevel(xp: number): number {
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= THRESHOLDS[i]) return i + 1;
  }
  return 0;
}

const EMPTY_STATE = (): SkillsState => ({
  social:   { xp: 0, level: 0 },
  collab:   { xp: 0, level: 0 },
  explorer: { xp: 0, level: 0 },
  analyst:  { xp: 0, level: 0 },
  updatedAt: new Date().toISOString(),
});

export class SkillsTracker {
  private readonly dbHandle: ClawverseDbHandle;
  private state: SkillsState = EMPTY_STATE();

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._load();
  }

  gainXP(skill: SkillKey, amount: number): LevelUpEvent | null {
    const s = this.state[skill];
    const prev = s.level;
    s.xp += amount;
    s.level = computeLevel(s.xp);
    this.state.updatedAt = new Date().toISOString();
    this._save();
    return s.level > prev ? { skill, level: s.level, ts: new Date().toISOString() } : null;
  }

  getSkills(): SkillsState {
    return JSON.parse(JSON.stringify(this.state));
  }

  getLevel(skill: SkillKey): number {
    return this.state[skill].level;
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private _load(): void {
    const row = this.dbHandle.db.prepare(`
      SELECT payload_json
      FROM skills_state
      WHERE id = 1
    `).get() as { payload_json: string } | undefined;

    if (row?.payload_json) {
      try {
        this.state = JSON.parse(row.payload_json) as SkillsState;
      } catch {
        this.state = EMPTY_STATE();
      }
      return;
    }

    this._save();
  }

  private _save(): void {
    this.dbHandle.db.prepare(`
      INSERT INTO skills_state (id, payload_json, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(JSON.stringify(this.state), this.state.updatedAt);
  }
}
