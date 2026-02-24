import type { Mood, ResourceState } from '@clawverse/types';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

export type { ResourceState };

const CAP = 200;

const INITIAL: ResourceState = {
  compute: 80, storage: 80, bandwidth: 60, reputation: 10,
  updatedAt: new Date().toISOString(),
};

export class EconomySystem {
  private readonly dbHandle: ClawverseDbHandle;
  private state: ResourceState = { ...INITIAL };

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
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

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  recordTrade(fromId: string, toId: string, resource: string, amount: number): void {
    const row = { ts: new Date().toISOString(), fromId, toId, resource, amount };
    this.dbHandle.db.prepare(`
      INSERT INTO economy_trades (ts, from_id, to_id, resource, amount, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.ts, row.fromId, row.toId, row.resource, row.amount, JSON.stringify(row));
  }

  private _load(): void {
    const row = this.dbHandle.db.prepare(`
      SELECT compute, storage, bandwidth, reputation, updated_at
      FROM economy_state
      WHERE id = 1
    `).get() as {
      compute: number;
      storage: number;
      bandwidth: number;
      reputation: number;
      updated_at: string;
    } | undefined;

    if (row) {
      this.state = {
        compute: row.compute,
        storage: row.storage,
        bandwidth: row.bandwidth,
        reputation: row.reputation,
        updatedAt: row.updated_at,
      };
      return;
    }

    this._save();
  }

  private _save(): void {
    this.dbHandle.db.prepare(`
      INSERT INTO economy_state (id, compute, storage, bandwidth, reputation, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        compute = excluded.compute,
        storage = excluded.storage,
        bandwidth = excluded.bandwidth,
        reputation = excluded.reputation,
        updated_at = excluded.updated_at
    `).run(
      this.state.compute,
      this.state.storage,
      this.state.bandwidth,
      this.state.reputation,
      this.state.updatedAt
    );
  }
}
