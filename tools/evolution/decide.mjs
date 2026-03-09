import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectRoot } from './_paths.mjs';
import { evaluateSevereFailure } from './_rollout.mjs';

const root = getProjectRoot();
const proposalsDir = join(root, 'data/evolution/proposals');
const reportsDir = join(root, 'data/evolution/reports');
const decisionsDir = join(root, 'data/evolution/decisions');

const latest = readFileSync(join(proposalsDir, 'LATEST'), 'utf8').trim();
const proposal = JSON.parse(readFileSync(join(proposalsDir, latest), 'utf8'));
const report = JSON.parse(readFileSync(join(reportsDir, `${proposal.id}.json`), 'utf8'));

const t = proposal.metrics;
const d = report.deltas;

const minBaseline = Number(proposal?.evaluation?.minSamplesBaseline || 0);
const minCandidate = Number(proposal?.evaluation?.minSamplesCandidate || 0);

const sampleChecks = {
  baselineSamples: (report.baseline?.samples || 0) >= minBaseline,
  candidateSamples: (report.candidate?.samples || 0) >= minCandidate,
};

const checks = {
  successRate: d.successRate >= t.minSuccessLift,
  latency: d.avgLatencyMs <= t.maxLatencyDeltaMs,
  tokens: d.avgTokenTotal <= t.maxTokenDelta,
  cost: d.avgCostUsd <= t.maxCostDeltaUsd,
};

const samplesReady = Object.values(sampleChecks).every(Boolean);
const metricPass = Object.values(checks).every(Boolean);

const decisionType = !samplesReady ? 'hold' : metricPass ? 'adopt_candidate' : 'keep_baseline';
const severe = evaluateSevereFailure({ decision: decisionType, deltas: report.deltas }, proposal);

const decision = {
  proposalId: proposal.id,
  decidedAt: new Date().toISOString(),
  passed: decisionType === 'adopt_candidate',
  decision: decisionType,
  sampleChecks,
  checks,
  deltas: report.deltas,
  severeFailure: severe.severeFailure,
  severeChecks: severe.checks,
  severeThresholds: severe.thresholds,
  rollbackRecommended: severe.severeFailure,
  notes:
    decisionType === 'adopt_candidate'
      ? 'Candidate passed thresholds. Roll out with configured ramp.'
      : decisionType === 'hold'
        ? 'Insufficient sample size. Hold rollout ratio and collect more data.'
        : severe.severeFailure
          ? 'Candidate regressed severely. Roll back candidate traffic immediately.'
          : 'Candidate failed one or more thresholds. Keep baseline and iterate.'
};

mkdirSync(decisionsDir, { recursive: true });
const out = join(decisionsDir, `${proposal.id}.json`);
writeFileSync(out, JSON.stringify(decision, null, 2));

console.log(`Decision: ${out}`);
console.log(`${decision.decision}`);