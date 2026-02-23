import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { logger } from './logger.js';

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

const SKILLS_PATH = resolve(process.cwd(), 'data/life/skills.json');
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
  private state: SkillsState = EMPTY_STATE();

  constructor() {
    mkdirSync(dirname(SKILLS_PATH), { recursive: true });
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

  private _load(): void {
    if (!existsSync(SKILLS_PATH)) return;
    try {
      this.state = JSON.parse(readFileSync(SKILLS_PATH, 'utf8'));
    } catch (err) {
      if (err instanceof SyntaxError) return;
      logger.error(`[skills] failed to load state: ${(err as Error).message}`);
    }
  }

  private _save(): void {
    writeFileSync(SKILLS_PATH, JSON.stringify(this.state, null, 2));
  }
}
