import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectRoot } from './_paths.mjs';
import { applyHealthGateToState, evaluateHealthGateFromSqlite } from './_health-gate.mjs';
import {
  applyRolloutDecision,
  buildEmptyHealthGateState,
  buildRolloutEnvLine,
  getCanaryWindowStatus,
  getHealthGateState,
  readEvolutionConfig,
  readRolloutState,
  writeRolloutArtifacts,
} from './_rollout.mjs';

const root = getProjectRoot();
const config = readEvolutionConfig(root);
const latest = readFileSync(join(root, 'data/evolution/proposals/LATEST'), 'utf8').trim().replace(/\.json$/, '');
const decision = JSON.parse(readFileSync(join(root, `data/evolution/decisions/${latest}.json`), 'utf8'));

mkdirSync(join(root, 'data/evolution/rollout'), { recursive: true });

let current = readRolloutState(root) || {
  baseline: config.baseline,
  candidate: config.candidate,
  candidateRatio: 0,
  updatedAt: new Date().toISOString(),
  lastRatioChangeAt: null,
  canaryLockedUntil: null,
  ...buildEmptyHealthGateState(),
};

const canary = getCanaryWindowStatus(current, config);
const healthGate = getHealthGateState(current);
const needsHealthRefresh = decision.decision === 'adopt_candidate'
  && Number(current.candidateRatio || 0) > 0
  && !canary.active
  && !healthGate.fresh;

if (needsHealthRefresh) {
  const healthResult = evaluateHealthGateFromSqlite(current, config);
  current = applyHealthGateToState(current, healthResult);
  writeRolloutArtifacts(root, current);
  console.log(`[apply-rollout] refreshed health gate: ${healthResult.status}`);
}

const rollout = applyRolloutDecision(current, config, decision);
const state = rollout.state;
writeRolloutArtifacts(root, state);

appendFileSync(
  join(root, 'data/evolution/rollout/history.jsonl'),
  JSON.stringify({
    ts: state.updatedAt,
    decision: decision.decision,
    proposalId: decision.proposalId,
    baseline: state.baseline,
    candidate: state.candidate,
    prevRatio: rollout.prevRatio,
    ratio: state.candidateRatio,
    severeFailure: rollout.severeFailure,
    rollbackApplied: rollout.rollbackApplied,
    canaryHoldApplied: rollout.canaryHoldApplied,
    canaryLockedUntil: state.canaryLockedUntil,
    healthGateStatus: rollout.healthGate.status,
    healthGateFresh: rollout.healthGate.fresh,
    healthGateHoldApplied: rollout.healthGateHoldApplied,
    healthRollbackApplied: rollout.healthRollbackApplied,
    lastHealthCheckAt: state.lastHealthCheckAt,
  }) + '\n',
);

const envLine = buildRolloutEnvLine(state);
console.log(`rollout updated: ratio=${state.candidateRatio}`);
if (rollout.rollbackApplied) {
  console.log('rollout rollback applied: severe candidate regression detected');
}
if (rollout.healthRollbackApplied) {
  console.log('rollout health rollback applied: post-rollout health gate marked candidate as critical');
}
if (rollout.canaryHoldApplied) {
  console.log(`rollout canary hold: observe current ratio until ${state.canaryLockedUntil}`);
}
if (rollout.healthGateHoldApplied) {
  console.log(`rollout health hold: gate=${rollout.healthGate.status}`);
}
console.log(envLine);