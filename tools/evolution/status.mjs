import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectRoot } from './_paths.mjs';
import { getCanaryWindowStatus, getHealthGateState, readEvolutionConfig } from './_rollout.mjs';

const root = getProjectRoot();

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const rolloutStatePath = join(root, 'data/evolution/rollout/state.json');
const proposalsLatestPath = join(root, 'data/evolution/proposals/LATEST');

const out = {
  now: new Date().toISOString(),
  rollout: null,
  latest: null,
};

if (existsSync(rolloutStatePath)) {
  const config = readEvolutionConfig(root);
  const rollout = readJson(rolloutStatePath);
  out.rollout = {
    ...rollout,
    canary: getCanaryWindowStatus(rollout, config),
    healthGate: getHealthGateState(rollout),
  };
}

if (existsSync(proposalsLatestPath)) {
  const latest = readFileSync(proposalsLatestPath, 'utf8').trim().replace(/\.json$/, '');
  const decisionPath = join(root, `data/evolution/decisions/${latest}.json`);
  const reportPath = join(root, `data/evolution/reports/${latest}.json`);
  out.latest = {
    proposalId: latest,
    decision: existsSync(decisionPath) ? readJson(decisionPath) : null,
    report: existsSync(reportPath) ? readJson(reportPath) : null,
  };
}

console.log(JSON.stringify(out, null, 2));