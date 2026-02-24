import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

export interface EpisodeRecord {
  id: string;
  ts: string;
  variant: string;
  success: boolean;
  latencyMs: number;
  tokenTotal?: number;
  costUsd?: number;
  source: 'daemon-heartbeat' | 'task-runtime' | 'manual';
  meta?: {
    connectedPeers: number;
    knownPeers: number;
    cpuUsage: number;
    ramUsage: number;
    mood: string;
  };
}

export interface EvolutionStats {
  total: number;
  successRate: number;
  avgLatencyMs: number;
  avgTokenTotal: number;
  avgCostUsd: number;
  byVariant: Record<string, {
    total: number;
    successRate: number;
    avgLatencyMs: number;
    avgTokenTotal: number;
    avgCostUsd: number;
  }>;
}

export class EvolutionEpisodeLogger {
  private readonly dbHandle: ClawverseDbHandle;
  private readonly variant: string;
  private readonly flushEvery: number;
  private counter = 0;

  constructor(opts: { variant: string; flushEvery: number; dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts.dbPath);
    this.variant = opts.variant;
    this.flushEvery = Math.max(1, opts.flushEvery);
  }

  record(
    input: Omit<EpisodeRecord, 'id' | 'ts' | 'variant'> & { idPrefix?: string; variant?: string }
  ): void {
    this.counter += 1;
    if (this.counter % this.flushEvery !== 0) return;

    const { idPrefix, variant, ...payload } = input;

    const row: EpisodeRecord = {
      id: `${idPrefix || 'ep'}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      ts: new Date().toISOString(),
      variant: variant || this.variant,
      ...payload,
    };

    this.dbHandle.db.prepare(`
      INSERT INTO evolution_episodes (
        id, ts, variant, success, latency_ms, token_total, cost_usd, source, payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ts = excluded.ts,
        variant = excluded.variant,
        success = excluded.success,
        latency_ms = excluded.latency_ms,
        token_total = excluded.token_total,
        cost_usd = excluded.cost_usd,
        source = excluded.source,
        payload_json = excluded.payload_json
    `).run(
      row.id,
      row.ts,
      row.variant,
      row.success ? 1 : 0,
      row.latencyMs,
      row.tokenTotal ?? null,
      row.costUsd ?? null,
      row.source,
      JSON.stringify(row),
    );
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  getVariant(): string {
    return this.variant;
  }

  getPath(): string {
    return `${this.dbHandle.path}#evolution_episodes`;
  }

  getStats(): EvolutionStats {
    const rows = this.dbHandle.db.prepare(`
      SELECT variant, success, latency_ms, token_total, cost_usd
      FROM evolution_episodes
    `).all() as Array<{
      variant: string;
      success: number;
      latency_ms: number;
      token_total: number | null;
      cost_usd: number | null;
    }>;

    if (rows.length === 0) {
      return { total: 0, successRate: 0, avgLatencyMs: 0, avgTokenTotal: 0, avgCostUsd: 0, byVariant: {} };
    }

    const byVariantAgg: Record<string, { total: number; successes: number; latencySum: number; tokenSum: number; costSum: number }> = {};
    let successes = 0;
    let latencySum = 0;
    let tokenSum = 0;
    let costSum = 0;

    for (const row of rows) {
      const key = row.variant || 'unknown';
      const bucket = byVariantAgg[key] || { total: 0, successes: 0, latencySum: 0, tokenSum: 0, costSum: 0 };
      bucket.total += 1;
      bucket.successes += row.success ? 1 : 0;
      bucket.latencySum += row.latency_ms || 0;
      bucket.tokenSum += row.token_total || 0;
      bucket.costSum += row.cost_usd || 0;
      byVariantAgg[key] = bucket;

      successes += row.success ? 1 : 0;
      latencySum += row.latency_ms || 0;
      tokenSum += row.token_total || 0;
      costSum += row.cost_usd || 0;
    }

    const total = rows.length;
    return {
      total,
      successRate: Math.round((successes / total) * 10000) / 100,
      avgLatencyMs: Math.round(latencySum / total),
      avgTokenTotal: Math.round(tokenSum / total),
      avgCostUsd: Math.round((costSum / total) * 1e6) / 1e6,
      byVariant: Object.fromEntries(
        Object.entries(byVariantAgg).map(([variant, v]) => [
          variant,
          {
            total: v.total,
            successRate: Math.round((v.successes / v.total) * 10000) / 100,
            avgLatencyMs: Math.round(v.latencySum / v.total),
            avgTokenTotal: Math.round(v.tokenSum / v.total),
            avgCostUsd: Math.round((v.costSum / v.total) * 1e6) / 1e6,
          },
        ]),
      ),
    };
  }
}
