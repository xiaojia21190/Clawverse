import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Mood, ResourceState } from '@clawverse/types';
import { logger } from './logger.js';

export type { ResourceState };

const RESOURCES_PATH = resolve(process.cwd(), 'data/economy/resources.json');
const TRADES_PATH    = resolve(process.cwd(), 'data/economy/trades.jsonl');
const CAP = 200;

const INITIAL: ResourceState = {
  compute: 80, storage: 80, bandwidth: 60, reputation: 10,
  updatedAt: new Date().toISOString(),
};

export class EconomySystem {
  private state: ResourceState = { ...INITIAL };

  constructor() {
    mkdirSync(dirname(RESOURCES_PATH), { recursive: true });
    this._load();
  }

  tick(mood: Mood, peerCount: number): void {
    const s = this.state;
    if (mood === 'idle')          s.compute = Math.min(CAP, s.compute + 1.5);
    else if (mood === 'working')  s.compute = Math.min(CAP, s.compute + 0.5);
    else if (mood === 'busy')     s.compute = Math.max(0, s.compute - 1);
    else if (mood === 'stressed' || mood === 'distressed') s.compute = Math.max(0, s.compute - 2);

    s.storage   = Math.min(CAP, s.storage + 0.3);
    s.bandwidth = peerCount > 0
      ? Math.min(CAP, s.bandwidth + 0.5 * Math.min(peerCount, 4))
      : Math.max(0, s.bandwidth - 0.2);

    s.updatedAt = new Date().toISOString();
    this._save();
  }

  consume(resource: keyof Omit<ResourceState, 'updatedAt'>, amount: number): boolean {
    if ((this.state[resource] as number) < amount) return false;
    (this.state[resource] as number) -= amount;
    this._save();
    return true;
  }

  award(resource: keyof Omit<ResourceState, 'updatedAt'>, amount: number): void {
    (this.state[resource] as number) = Math.min(
      resource === 'reputation' ? Number.MAX_SAFE_INTEGER : CAP,
      (this.state[resource] as number) + amount
    );
    this._save();
  }

  canAfford(resource: keyof Omit<ResourceState, 'updatedAt'>, amount: number): boolean {
    return (this.state[resource] as number) >= amount;
  }

  getResources(): ResourceState { return { ...this.state }; }

  recordTrade(fromId: string, toId: string, resource: string, amount: number): void {
    const entry = JSON.stringify({ ts: new Date().toISOString(), fromId, toId, resource, amount });
    try { appendFileSync(TRADES_PATH, entry + '\n'); } catch { /* ignore */ }
  }

  private _load(): void {
    if (!existsSync(RESOURCES_PATH)) return;
    try { this.state = JSON.parse(readFileSync(RESOURCES_PATH, 'utf8')); } catch { /* use defaults */ }
  }

  private _save(): void {
    try { writeFileSync(RESOURCES_PATH, JSON.stringify(this.state, null, 2)); } catch { /* ignore */ }
  }
}
