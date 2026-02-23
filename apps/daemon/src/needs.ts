import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mood } from '@clawverse/types';

export type NeedKey = 'social' | 'tasked' | 'wanderlust' | 'creative';

export interface NeedsState {
  social: number;
  tasked: number;
  wanderlust: number;
  creative: number;
  updatedAt: string;
}

const NEEDS_PATH = resolve(process.cwd(), 'data/life/needs.json');
const CRITICAL_THRESHOLD = 15;
const WARNING_THRESHOLD = 30;
const INITIAL_VALUE = 80;
const MOOD_SCALE: Mood[] = ['idle', 'working', 'busy', 'stressed', 'distressed'];

export class NeedsSystem {
  private state: NeedsState = {
    social: INITIAL_VALUE, tasked: INITIAL_VALUE,
    wanderlust: INITIAL_VALUE, creative: INITIAL_VALUE,
    updatedAt: new Date().toISOString(),
  };
  private readonly decayPerTick: number;

  constructor(heartbeatMs = 5000) {
    const hours = Number(process.env.CLAWVERSE_NEEDS_DECAY_HOURS || 2);
    this.decayPerTick = 100 / ((hours * 3_600_000) / heartbeatMs);
    mkdirSync(dirname(NEEDS_PATH), { recursive: true });
    this._load();
  }

  tick(): void {
    for (const key of ['social', 'tasked', 'wanderlust', 'creative'] as NeedKey[]) {
      this.state[key] = Math.max(0, this.state[key] - this.decayPerTick);
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

  applyNeedsMood(bioMood: Mood): Mood {
    if (bioMood === 'sleeping') return 'sleeping';
    const keys: NeedKey[] = ['social', 'tasked', 'wanderlust', 'creative'];
    const criticalCount = keys.filter(k => this.state[k] < CRITICAL_THRESHOLD).length;
    const warningCount  = keys.filter(k => this.state[k] < WARNING_THRESHOLD).length;
    const allHigh       = keys.every(k => this.state[k] > 60);

    if (criticalCount >= 2) return 'distressed';
    const idx = MOOD_SCALE.indexOf(bioMood as typeof MOOD_SCALE[number]);
    const safeIdx = idx === -1 ? 1 : idx;
    if (warningCount >= 1) return MOOD_SCALE[Math.min(MOOD_SCALE.length - 1, safeIdx + 1)];
    if (allHigh)           return MOOD_SCALE[Math.max(0, safeIdx - 1)];
    return bioMood;
  }

  private _load(): void {
    if (!existsSync(NEEDS_PATH)) return;
    try { this.state = JSON.parse(readFileSync(NEEDS_PATH, 'utf8')); } catch { /* ignore */ }
  }

  private _save(): void {
    writeFileSync(NEEDS_PATH, JSON.stringify(this.state, null, 2));
  }
}
