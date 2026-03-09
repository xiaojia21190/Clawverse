import type {
  Mood,
  ResourceState,
  PendingTrade,
  TradeStatus,
  InventoryItemId,
  InventoryItemState,
  ProductionRecipe,
  BuildingType,
} from '@clawverse/types';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';
import { logger } from './logger.js';

export type { ResourceState, PendingTrade, InventoryItemState, ProductionRecipe, InventoryItemId };

const CAP = 200;
const TRADE_EXPIRE_MS = 5 * 60 * 1000;
const INVENTORY_ORDER: InventoryItemId[] = ['data_shard', 'alloy_frame', 'relay_patch'];

const INITIAL: ResourceState = {
  compute: 80,
  storage: 80,
  bandwidth: 60,
  reputation: 10,
  updatedAt: new Date().toISOString(),
};

const RECIPES: ProductionRecipe[] = [
  {
    id: 'data_shard',
    name: 'Data Shard',
    description: 'Archive refinement turns raw compute and storage into reusable knowledge fragments.',
    requiredBuilding: 'archive',
    inputs: {
      resources: { compute: 12, storage: 8 },
    },
    output: { itemId: 'data_shard', amount: 1 },
  },
  {
    id: 'alloy_frame',
    name: 'Alloy Frame',
    description: 'Forge output converts raw resources into structural components for later assembly.',
    requiredBuilding: 'forge',
    inputs: {
      resources: { compute: 14, storage: 10 },
    },
    output: { itemId: 'alloy_frame', amount: 1 },
  },
  {
    id: 'relay_patch',
    name: 'Relay Patch',
    description: 'A recovery patch assembled from crafted components that restores compute and bandwidth.',
    requiredBuilding: null,
    inputs: {
      resources: { bandwidth: 10 },
      items: { data_shard: 1, alloy_frame: 1 },
    },
    output: { itemId: 'relay_patch', amount: 1 },
  },
];

function itemLabel(itemId: InventoryItemId): string {
  if (itemId === 'data_shard') return 'Data Shard';
  if (itemId === 'alloy_frame') return 'Alloy Frame';
  return 'Relay Patch';
}

function toItemState(itemId: InventoryItemId, amount = 0, updatedAt = new Date().toISOString()): InventoryItemState {
  return { itemId, amount, updatedAt };
}

export class EconomySystem {
  private readonly dbHandle: ClawverseDbHandle;
  private state: ResourceState = { ...INITIAL };
  private pendingTrades: Map<string, PendingTrade> = new Map();
  private inventory: Map<InventoryItemId, InventoryItemState> = new Map();

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._load();
    this._loadPendingTrades();
    this._loadInventory();
  }

  tick(mood: Mood, peerCount: number): void {
    const s = this.state;
    if (mood === 'idle') s.compute = Math.min(CAP, s.compute + 1.5);
    else if (mood === 'working') s.compute = Math.min(CAP, s.compute + 0.5);
    else if (mood === 'busy') s.compute = Math.max(0, s.compute - 1);
    else if (mood === 'stressed' || mood === 'distressed') s.compute = Math.max(0, s.compute - 2);

    s.storage = Math.min(CAP, s.storage + 0.3);
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
      (this.state[resource] as number) + amount,
    );
    this._save();
  }

  canAfford(resource: keyof Omit<ResourceState, 'updatedAt'>, amount: number): boolean {
    return (this.state[resource] as number) >= amount;
  }

  getResources(): ResourceState {
    return { ...this.state };
  }

  getInventory(): InventoryItemState[] {
    return INVENTORY_ORDER.map((itemId) => {
      const entry = this.inventory.get(itemId);
      return entry ? { ...entry } : toItemState(itemId);
    });
  }

  getItemAmount(itemId: InventoryItemId): number {
    return this.inventory.get(itemId)?.amount ?? 0;
  }

  getRecipes(ownedBuildings: BuildingType[] = []): Array<ProductionRecipe & { craftable: boolean; missing: string[] }> {
    const buildingSet = new Set(ownedBuildings);
    return RECIPES.map((recipe) => {
      const missing = this.getRecipeMissing(recipe, buildingSet);
      return { ...recipe, craftable: missing.length === 0, missing };
    });
  }

  craft(recipeId: InventoryItemId, ownedBuildings: BuildingType[] = []): { ok: boolean; reason?: string; recipe?: ProductionRecipe; output?: InventoryItemState } {
    const recipe = RECIPES.find((entry) => entry.id === recipeId);
    if (!recipe) return { ok: false, reason: 'unknown_recipe' };

    const buildingSet = new Set(ownedBuildings);
    const missing = this.getRecipeMissing(recipe, buildingSet);
    if (missing.length > 0) {
      return { ok: false, reason: missing.join('; '), recipe };
    }

    for (const [resource, amount] of Object.entries(recipe.inputs.resources ?? {})) {
      this.consume(resource as keyof Omit<ResourceState, 'updatedAt'>, Number(amount));
    }
    for (const [itemId, amount] of Object.entries(recipe.inputs.items ?? {})) {
      this.consumeInventoryItem(itemId as InventoryItemId, Number(amount));
    }

    const output = this.awardInventoryItem(recipe.output.itemId, recipe.output.amount);
    this.recordProduction(recipe);
    logger.info(`[economy] Crafted ${recipe.id} -> ${recipe.output.amount} ${recipe.output.itemId}`);
    return { ok: true, recipe, output };
  }

  useRecoveryItem(itemId: InventoryItemId): boolean {
    if (itemId !== 'relay_patch') return false;
    if (!this.consumeInventoryItem('relay_patch', 1)) return false;
    this.award('bandwidth', 18);
    this.award('compute', 6);
    logger.info('[economy] Consumed relay_patch for emergency recovery');
    return true;
  }

  awardInventoryItem(itemId: InventoryItemId, amount: number): InventoryItemState {
    const current = this.inventory.get(itemId) ?? toItemState(itemId);
    const next: InventoryItemState = {
      itemId,
      amount: Math.max(0, current.amount + Math.max(0, Math.round(amount))),
      updatedAt: new Date().toISOString(),
    };
    this.inventory.set(itemId, next);
    this._saveInventoryItem(next);
    return { ...next };
  }

  consumeInventoryItem(itemId: InventoryItemId, amount: number): boolean {
    const current = this.inventory.get(itemId) ?? toItemState(itemId);
    const safeAmount = Math.max(0, Math.round(amount));
    if (current.amount < safeAmount) return false;
    const next: InventoryItemState = {
      itemId,
      amount: current.amount - safeAmount,
      updatedAt: new Date().toISOString(),
    };
    this.inventory.set(itemId, next);
    this._saveInventoryItem(next);
    return true;
  }

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

  recordTradeOutcome(peerId: string, accepted: boolean, reason: string, payload: Record<string, unknown> = {}): void {
    const row = {
      ts: new Date().toISOString(),
      kind: 'trade_result',
      peerId,
      accepted,
      reason,
      ...payload,
    };
    this.dbHandle.db.prepare(`
      INSERT INTO economy_trades (ts, from_id, to_id, resource, amount, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.ts, 'self', peerId, 'trade_result', 0, JSON.stringify(row));
  }

  createPendingTrade(tradeId: string, fromPeerId: string, resource: string, amount: number, resourceWant: string, amountWant: number): PendingTrade {
    const trade: PendingTrade = {
      tradeId,
      fromPeerId,
      resource,
      amount,
      resourceWant,
      amountWant,
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

    const resKey = trade.resourceWant as keyof Omit<ResourceState, 'updatedAt'>;
    if (!this.canAfford(resKey, trade.amountWant)) {
      logger.warn(`[economy] Cannot afford trade ${tradeId}: need ${trade.amountWant} ${trade.resourceWant}`);
      return null;
    }

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
    return Array.from(this.pendingTrades.values()).filter((trade) => trade.status === 'pending');
  }

  getTradeHistory(): Array<Record<string, unknown>> {
    return this.dbHandle.db.prepare(`
      SELECT payload_json FROM economy_trades ORDER BY ts DESC LIMIT 50
    `).all().map((row: any) => JSON.parse(row.payload_json));
  }

  private getRecipeMissing(recipe: ProductionRecipe, ownedBuildings: Set<BuildingType>): string[] {
    const missing: string[] = [];
    if (recipe.requiredBuilding && !ownedBuildings.has(recipe.requiredBuilding)) {
      missing.push(`need building:${recipe.requiredBuilding}`);
    }
    for (const [resource, amount] of Object.entries(recipe.inputs.resources ?? {})) {
      const need = Number(amount);
      if (!this.canAfford(resource as keyof Omit<ResourceState, 'updatedAt'>, need)) {
        missing.push(`need ${need} ${resource}`);
      }
    }
    for (const [itemId, amount] of Object.entries(recipe.inputs.items ?? {})) {
      const need = Number(amount);
      if (this.getItemAmount(itemId as InventoryItemId) < need) {
        missing.push(`need ${need} ${itemLabel(itemId as InventoryItemId)}`);
      }
    }
    return missing;
  }

  private recordProduction(recipe: ProductionRecipe): void {
    const ts = new Date().toISOString();
    const payload = {
      ts,
      recipeId: recipe.id,
      output: recipe.output,
      inputs: recipe.inputs,
    };
    this.dbHandle.db.prepare(`
      INSERT INTO economy_production_logs (ts, recipe_id, payload_json)
      VALUES (?, ?, ?)
    `).run(ts, recipe.id, JSON.stringify(payload));
  }

  private _expireTrades(): void {
    const now = Date.now();
    for (const trade of this.pendingTrades.values()) {
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

  private _saveInventoryItem(item: InventoryItemState): void {
    this.dbHandle.db.prepare(`
      INSERT INTO economy_inventory (item_id, amount, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        amount = excluded.amount,
        updated_at = excluded.updated_at
    `).run(item.itemId, item.amount, item.updatedAt);
  }

  private _loadPendingTrades(): void {
    const rows = this.dbHandle.db.prepare(
      `SELECT trade_id, from_peer_id, resource, amount, resource_want, amount_want, status, created_at FROM pending_trades WHERE status = 'pending'`,
    ).all() as Array<{ trade_id: string; from_peer_id: string; resource: string; amount: number; resource_want: string; amount_want: number; status: string; created_at: string }>;
    for (const row of rows) {
      this.pendingTrades.set(row.trade_id, {
        tradeId: row.trade_id,
        fromPeerId: row.from_peer_id,
        resource: row.resource,
        amount: row.amount,
        resourceWant: row.resource_want,
        amountWant: row.amount_want,
        status: row.status as TradeStatus,
        createdAt: row.created_at,
      });
    }
  }

  private _loadInventory(): void {
    const rows = this.dbHandle.db.prepare(`
      SELECT item_id, amount, updated_at
      FROM economy_inventory
    `).all() as Array<{ item_id: InventoryItemId; amount: number; updated_at: string }>;
    for (const row of rows) {
      this.inventory.set(row.item_id, {
        itemId: row.item_id,
        amount: row.amount,
        updatedAt: row.updated_at,
      });
    }
    for (const itemId of INVENTORY_ORDER) {
      if (!this.inventory.has(itemId)) {
        const blank = toItemState(itemId);
        this.inventory.set(itemId, blank);
        this._saveInventoryItem(blank);
      }
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
      this.state.updatedAt,
    );
  }
}
