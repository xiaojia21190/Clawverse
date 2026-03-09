import { Mood } from '@clawverse/types';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

export type NeedKey = 'social' | 'tasked' | 'wanderlust' | 'creative';

export interface NeedsState {
  social: number;
  tasked: number;
  wanderlust: number;
  creative: number;
  updatedAt: string;
}

const CRITICAL_THRESHOLD = 15;
const WARNING_THRESHOLD = 30;
const INITIAL_NEED_VALUE = 80;
const MOOD_SCALE: Mood[] = ['idle', 'working', 'busy', 'stressed', 'distressed'];
const NEED_KEYS: NeedKey[] = ['social', 'tasked', 'wanderlust', 'creative'];

export type NeedDecayModifiers = Partial<Record<NeedKey, number>>;

export class NeedsSystem {
  private readonly dbHandle: ClawverseDbHandle;
  private state: NeedsState = {
    social: INITIAL_NEED_VALUE, tasked: INITIAL_NEED_VALUE,
    wanderlust: INITIAL_NEED_VALUE, creative: INITIAL_NEED_VALUE,
    updatedAt: new Date().toISOString(),
  };
  private readonly decayPerTick: number;

  constructor(heartbeatMs = 5000, opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    const hours = Number(process.env.CLAWVERSE_NEEDS_DECAY_HOURS || 2);
    this.decayPerTick = 100 / ((hours * 3_600_000) / heartbeatMs);
    this._load();
  }

  tick(modifiers: NeedDecayModifiers = {}): void {
    for (const key of NEED_KEYS) {
      const multiplier = Math.max(0, modifiers[key] ?? 1);
      this.state[key] = Math.max(0, this.state[key] - this.decayPerTick * multiplier);
    }
    this.state.updatedAt = new Date().toISOString();
    this._save();
  }

  satisfy(need: NeedKey, amount: number): void {
    this.state[need] = Math.min(100, this.state[need] + amount);
    this._save();
  }

  isCritical(need: NeedKey): boolean {
    return this.state[need] < CRITICAL_THRESHOLD;
  }

  getNeeds(): NeedsState {
    return { ...this.state };
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  applyNeedsMood(bioMood: Mood): Mood {
    if (bioMood === 'sleeping') return 'sleeping';
    const criticalCount = NEED_KEYS.filter(k => this.state[k] < CRITICAL_THRESHOLD).length;
    const warningCount  = NEED_KEYS.filter(k => this.state[k] < WARNING_THRESHOLD).length;
    const allHigh       = NEED_KEYS.every(k => this.state[k] > 60);

    if (criticalCount >= 2) return 'distressed';
    const idx = MOOD_SCALE.indexOf(bioMood);
    const safeIdx = idx === -1 ? 1 : idx;
    if (warningCount >= 1) return MOOD_SCALE[Math.min(MOOD_SCALE.length - 1, safeIdx + 1)];
    if (allHigh)           return MOOD_SCALE[Math.max(0, safeIdx - 1)];
    return bioMood;
  }

  private _load(): void {
    const row = this.dbHandle.db.prepare(`
      SELECT social, tasked, wanderlust, creative, updated_at
      FROM needs_state
      WHERE id = 1
    `).get() as {
      social: number;
      tasked: number;
      wanderlust: number;
      creative: number;
      updated_at: string;
    } | undefined;

    if (row) {
      this.state = {
        social: row.social,
        tasked: row.tasked,
        wanderlust: row.wanderlust,
        creative: row.creative,
        updatedAt: row.updated_at,
      };
      return;
    }

    this._save();
  }

  private _save(): void {
    this.dbHandle.db.prepare(`
      INSERT INTO needs_state (id, social, tasked, wanderlust, creative, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        social = excluded.social,
        tasked = excluded.tasked,
        wanderlust = excluded.wanderlust,
        creative = excluded.creative,
        updated_at = excluded.updated_at
    `).run(
      this.state.social,
      this.state.tasked,
      this.state.wanderlust,
      this.state.creative,
      this.state.updatedAt
    );
  }
}
