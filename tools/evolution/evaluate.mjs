import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const proposalsDir = join(root, 'data/evolution/proposals');
const reportsDir = join(root, 'data/evolution/reports');
const sqlitePath = join(root, process.env.CLAWVERSE_SQLITE_PATH || 'data/state/clawverse.db');

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function readEpisodesFromSqlite(path) {
  const db = new DatabaseSync(path);
  try {
    const rows = db.prepare(`
      SELECT payload_json
      FROM evolution_episodes
      ORDER BY ts ASC
    `).all();
    return rows
      .map((r) => {
        try {
          return JSON.parse(r.payload_json);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } finally {
    db.close();
  }
}

const latest = readFileSync(join(proposalsDir, 'LATEST'), 'utf8').trim();
const proposal = JSON.parse(readFileSync(join(proposalsDir, latest), 'utf8'));
const episodes = readEpisodesFromSqlite(sqlitePath);
const includeSources = proposal?.evaluation?.includeSources || ['task-runtime', 'manual'];
const filtered = episodes.filter((e) => includeSources.includes(e.source));

const baseline = filtered.filter((e) => e.variant === proposal.baseline);
const candidate = filtered.filter((e) => e.variant === proposal.candidate);

const toMetrics = (rows) => ({
  samples: rows.length,
  successRate: rows.length ? rows.filter((r) => !!r.success).length / rows.length : null,
  avgLatencyMs: mean(rows.map((r) => r.latencyMs).filter((v) => typeof v === 'number')),
  avgTokenTotal: mean(rows.map((r) => r.tokenTotal).filter((v) => typeof v === 'number')),
  avgCostUsd: mean(rows.map((r) => r.costUsd).filter((v) => typeof v === 'number'))
});

const baselineMetrics = toMetrics(baseline);
const candidateMetrics = toMetrics(candidate);

const deltas = {
  successRate: (candidateMetrics.successRate ?? 0) - (baselineMetrics.successRate ?? 0),
  avgLatencyMs: (candidateMetrics.avgLatencyMs ?? 0) - (baselineMetrics.avgLatencyMs ?? 0),
  avgTokenTotal: (candidateMetrics.avgTokenTotal ?? 0) - (baselineMetrics.avgTokenTotal ?? 0),
  avgCostUsd: (candidateMetrics.avgCostUsd ?? 0) - (baselineMetrics.avgCostUsd ?? 0)
};

const report = {
  proposalId: proposal.id,
  evaluatedAt: new Date().toISOString(),
  includeSources,
  sampleSize: filtered.length,
  baseline: { name: proposal.baseline, ...baselineMetrics },
  candidate: { name: proposal.candidate, ...candidateMetrics },
  deltas,
  thresholds: proposal.metrics
};

mkdirSync(reportsDir, { recursive: true });
const reportPath = join(reportsDir, `${proposal.id}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`Evaluation report: ${reportPath}`);
