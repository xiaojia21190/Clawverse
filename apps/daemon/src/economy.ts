import type { Mood, ResourceState, PendingTrade, TradeStatus } from '@clawverse/types';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';
import { logger } from './logger.js';

export type { ResourceState, PendingTrade };

const CAP = 200;
const TRADE_EXPIRE_MS = 5 * 60 * 1000;

const INITIAL: ResourceState = {
  compute: 80, storage: 80, bandwidth: 60, reputation: 10,
  updatedAt: new Date().toISOString(),
};

export class EconomySystem {
  private readonly dbHandle: ClawverseDbHandle;
  private state: ResourceState = { ...INITIAL };
  private pendingTrades: Map<string, PendingTrade> = new Map();

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._load();
    this._loadPendingTrades();
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

  // P2P Trade management
  createPendingTrade(tradeId: string, fromPeerId: string, resource: string, amount: number, resourceWant: string, amountWant: number): PendingTrade {
    const trade: PendingTrade = {
      tradeId, fromPeerId, resource, amount, resourceWant, amountWant,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.pendingTrades.set(tradeId, trade);
    this._savePendingTrade(trade);
    logger.info(`[economy] Created pending trade ${tradeId}: ${amount} ${resource} for ${amountWant} ${resourceWant}`);
    return trade;
  }

  acceptTrade(tradeId: string): PendingTrade | null {
    const trade = this.pendingTrades.get(tradeId);
    if (!trade || trade.status !== 'pending') return null;

    // Check we can afford what they want
    const resKey = trade.resourceWant as keyof Omit<ResourceState, 'updatedAt'>;
    if (!this.canAfford(resKey, trade.amountWant)) {
      logger.warn(`[economy] Cannot afford trade ${tradeId}: need ${trade.amountWant} ${trade.resourceWant}`);
      return null;
    }

    // Execute: give what they want, receive what they offer
    this.consume(resKey, trade.amountWant);
    this.award(trade.resource as keyof Omit<ResourceState, 'updatedAt'>, trade.amount);

    trade.status = 'accepted';
    this._savePendingTrade(trade);
    this.recordTrade(trade.fromPeerId, 'self', trade.resource, trade.amount);
    logger.info(`[economy] Accepted trade ${tradeId}`);
    return trade;
  }

  rejectTrade(tradeId: string): PendingTrade | null {
    const trade = this.pendingTrades.get(tradeId);
    if (!trade || trade.status !== 'pending') return null;
    trade.status = 'rejected';
    this._savePendingTrade(trade);
    logger.info(`[economy] Rejected trade ${tradeId}`);
    return trade;
  }

  getPendingTrades(): PendingTrade[] {
    this._expireTrades();
    return Array.from(this.pendingTrades.values()).filter(t => t.status === 'pending');
  }

  getTradeHistory(): Array<Record<string, unknown>> {
    return this.dbHandle.db.prepare(`
      SELECT payload_json FROM economy_trades ORDER BY ts DESC LIMIT 50
    `).all().map((r: any) => JSON.parse(r.payload_json));
  }

  private _expireTrades(): void {
    const now = Date.now();
    for (const [id, trade] of this.pendingTrades) {
      if (trade.status === 'pending' && now - new Date(trade.createdAt).getTime() > TRADE_EXPIRE_MS) {
        trade.status = 'expired';
        this._savePendingTrade(trade);
      }
    }
  }

  private _savePendingTrade(trade: PendingTrade): void {
    this.dbHandle.db.prepare(`
      INSERT INTO pending_trades (trade_id, from_peer_id, resource, amount, resource_want, amount_want, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trade_id) DO UPDATE SET status = excluded.status
    `).run(trade.tradeId, trade.fromPeerId, trade.resource, trade.amount, trade.resourceWant, trade.amountWant, trade.status, trade.createdAt);
  }

  private _loadPendingTrades(): void {
    const rows = this.dbHandle.db.prepare(
      `SELECT trade_id, from_peer_id, resource, amount, resource_want, amount_want, status, created_at FROM pending_trades WHERE status = 'pending'`
    ).all() as Array<{ trade_id: string; from_peer_id: string; resource: string; amount: number; resource_want: string; amount_want: number; status: string; created_at: string }>;
    for (const r of rows) {
      this.pendingTrades.set(r.trade_id, {
        tradeId: r.trade_id, fromPeerId: r.from_peer_id,
        resource: r.resource, amount: r.amount,
        resourceWant: r.resource_want, amountWant: r.amount_want,
        status: r.status as TradeStatus, createdAt: r.created_at,
      });
    }
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
