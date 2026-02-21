import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const proposalsDir = join(root, 'data/evolution/proposals');
const reportsDir = join(root, 'data/evolution/reports');
const episodesPath = join(root, 'data/evolution/episodes/episodes.jsonl');

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function parseJsonl(path) {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

const latest = readFileSync(join(proposalsDir, 'LATEST'), 'utf8').trim();
const proposal = JSON.parse(readFileSync(join(proposalsDir, latest), 'utf8'));
const episodes = parseJsonl(episodesPath);

const baseline = episodes.filter((e) => e.variant === proposal.baseline);
const candidate = episodes.filter((e) => e.variant === proposal.candidate);

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
  baseline: { name: proposal.baseline, ...baselineMetrics },
  candidate: { name: proposal.candidate, ...candidateMetrics },
  deltas,
  thresholds: proposal.metrics
};

mkdirSync(reportsDir, { recursive: true });
const reportPath = join(reportsDir, `${proposal.id}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`Evaluation report: ${reportPath}`);
