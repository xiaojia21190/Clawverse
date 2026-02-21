import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const proposalsDir = join(root, 'data/evolution/proposals');
const reportsDir = join(root, 'data/evolution/reports');
const decisionsDir = join(root, 'data/evolution/decisions');

const latest = readFileSync(join(proposalsDir, 'LATEST'), 'utf8').trim();
const proposal = JSON.parse(readFileSync(join(proposalsDir, latest), 'utf8'));
const report = JSON.parse(readFileSync(join(reportsDir, `${proposal.id}.json`), 'utf8'));

const t = proposal.metrics;
const d = report.deltas;

const checks = {
  successRate: d.successRate >= t.minSuccessLift,
  latency: d.avgLatencyMs <= t.maxLatencyDeltaMs,
  tokens: d.avgTokenTotal <= t.maxTokenDelta,
  cost: d.avgCostUsd <= t.maxCostDeltaUsd
};

const passed = Object.values(checks).every(Boolean);

const decision = {
  proposalId: proposal.id,
  decidedAt: new Date().toISOString(),
  passed,
  decision: passed ? 'adopt_candidate' : 'keep_baseline',
  checks,
  deltas: report.deltas,
  notes: passed
    ? 'Candidate passed thresholds. Roll out with configured ramp.'
    : 'Candidate failed one or more thresholds. Keep baseline and iterate.'
};

mkdirSync(decisionsDir, { recursive: true });
const out = join(decisionsDir, `${proposal.id}.json`);
writeFileSync(out, JSON.stringify(decision, null, 2));

console.log(`Decision: ${out}`);
console.log(`${decision.decision}`);
