import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolveProjectPath } from './_paths.mjs';

export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeOptionalNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function getEvolutionSqlitePath() {
  return resolveProjectPath(process.env.CLAWVERSE_SQLITE_PATH || 'data/state/clawverse.db');
}

export function readEpisodesFromSqlite(path = getEvolutionSqlitePath()) {
  if (!existsSync(path)) return [];

  const db = new DatabaseSync(path);
  try {
    const rows = db.prepare(`
      SELECT
        id,
        ts,
        variant,
        success,
        latency_ms AS latencyMs,
        token_total AS tokenTotal,
        cost_usd AS costUsd,
        source
      FROM evolution_episodes
      ORDER BY ts ASC
    `).all();

    return rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      variant: row.variant,
      success: Boolean(row.success),
      latencyMs: Number(row.latencyMs),
      tokenTotal: normalizeOptionalNumber(row.tokenTotal),
      costUsd: normalizeOptionalNumber(row.costUsd),
      source: row.source,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table: evolution_episodes/i.test(message)) {
      return [];
    }
    throw error;
  } finally {
    db.close();
  }
}

export function filterEpisodes(episodes, options = {}) {
  const includeSources = Array.isArray(options.includeSources) && options.includeSources.length > 0
    ? new Set(options.includeSources)
    : null;
  const sinceMs = Number.isFinite(options.sinceMs) ? options.sinceMs : null;

  return episodes.filter((episode) => {
    const sourceOk = !includeSources || includeSources.has(episode.source);
    const tsMs = typeof episode.ts === 'string' ? Date.parse(episode.ts) : NaN;
    const timeOk = sinceMs == null || (Number.isFinite(tsMs) && tsMs >= sinceMs);
    return sourceOk && timeOk;
  });
}

export function toMetrics(rows) {
  return {
    samples: rows.length,
    successRate: rows.length ? rows.filter((row) => !!row.success).length / rows.length : null,
    avgLatencyMs: mean(rows.map((row) => row.latencyMs).filter((value) => typeof value === 'number' && Number.isFinite(value))),
    avgTokenTotal: mean(rows.map((row) => row.tokenTotal).filter((value) => typeof value === 'number' && Number.isFinite(value))),
    avgCostUsd: mean(rows.map((row) => row.costUsd).filter((value) => typeof value === 'number' && Number.isFinite(value))),
  };
}

export function buildMetricDeltas(baselineMetrics, candidateMetrics) {
  return {
    successRate: (candidateMetrics.successRate ?? 0) - (baselineMetrics.successRate ?? 0),
    avgLatencyMs: (candidateMetrics.avgLatencyMs ?? 0) - (baselineMetrics.avgLatencyMs ?? 0),
    avgTokenTotal: (candidateMetrics.avgTokenTotal ?? 0) - (baselineMetrics.avgTokenTotal ?? 0),
    avgCostUsd: (candidateMetrics.avgCostUsd ?? 0) - (baselineMetrics.avgCostUsd ?? 0),
  };
}