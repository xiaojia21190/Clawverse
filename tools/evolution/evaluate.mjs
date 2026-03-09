import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMetricDeltas, filterEpisodes, getEvolutionSqlitePath, readEpisodesFromSqlite, toMetrics } from './_episodes.mjs';
import { getProjectRoot } from './_paths.mjs';

const root = getProjectRoot();
const proposalsDir = join(root, 'data/evolution/proposals');
const reportsDir = join(root, 'data/evolution/reports');
const sqlitePath = getEvolutionSqlitePath();

const latest = readFileSync(join(proposalsDir, 'LATEST'), 'utf8').trim();
const proposal = JSON.parse(readFileSync(join(proposalsDir, latest), 'utf8'));
const episodes = readEpisodesFromSqlite(sqlitePath);
const includeSources = proposal?.evaluation?.includeSources || ['task-runtime', 'manual'];
const filtered = filterEpisodes(episodes, { includeSources });

const baseline = filtered.filter((episode) => episode.variant === proposal.baseline);
const candidate = filtered.filter((episode) => episode.variant === proposal.candidate);
const baselineMetrics = toMetrics(baseline);
const candidateMetrics = toMetrics(candidate);
const deltas = buildMetricDeltas(baselineMetrics, candidateMetrics);

const report = {
  proposalId: proposal.id,
  evaluatedAt: new Date().toISOString(),
  includeSources,
  sampleSize: filtered.length,
  baseline: { name: proposal.baseline, ...baselineMetrics },
  candidate: { name: proposal.candidate, ...candidateMetrics },
  deltas,
  thresholds: proposal.metrics,
};

mkdirSync(reportsDir, { recursive: true });
const reportPath = join(reportsDir, `${proposal.id}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`Evaluation report: ${reportPath}`);