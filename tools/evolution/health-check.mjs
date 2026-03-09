import { getProjectRoot } from './_paths.mjs';
import { applyHealthGateToState, evaluateHealthGateFromSqlite } from './_health-gate.mjs';
import { readEvolutionConfig, readRolloutState, writeRolloutArtifacts } from './_rollout.mjs';

const root = getProjectRoot();
const config = readEvolutionConfig(root);
const current = readRolloutState(root);

if (!current) {
  console.log('[health-check] rollout state not initialized');
  process.exit(0);
}

const result = evaluateHealthGateFromSqlite(current, config);
const next = applyHealthGateToState(current, result);
writeRolloutArtifacts(root, next);

console.log(
  `[health-check] ${result.status} @ ${result.windowStartAt ?? 'n/a'} | baseline=${result.samples.baseline.samples} candidate=${result.samples.candidate.samples}`,
);
if (result.rollbackRecommended) {
  console.log('[health-check] critical candidate degradation detected; rollout should not step up.');
}
console.log(JSON.stringify({
  status: result.status,
  windowStartAt: result.windowStartAt,
  sampleSize: result.sampleSize,
  sampleChecks: result.checks.sampleChecks,
  rolloutChecks: result.checks.rolloutChecks,
  rollbackRecommended: result.rollbackRecommended,
}, null, 2));