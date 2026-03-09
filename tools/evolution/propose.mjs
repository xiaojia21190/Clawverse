import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectRoot } from './_paths.mjs';
import { initializeRolloutState, readEvolutionConfig } from './_rollout.mjs';

const root = getProjectRoot();
const proposalsDir = join(root, 'data/evolution/proposals');

const now = new Date();
const proposalId = `proposal-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const config = readEvolutionConfig(root);

const proposal = {
  id: proposalId,
  createdAt: now.toISOString(),
  status: 'proposed',
  goal: config.goal,
  candidate: config.candidate,
  baseline: config.baseline,
  metrics: config.metrics,
  evaluation: config.evaluation,
  rollout: config.rollout,
  rolloutPolicy: config.rolloutPolicy,
  notes: config.notes ?? '',
};

mkdirSync(proposalsDir, { recursive: true });
const out = join(proposalsDir, `${proposalId}.json`);
writeFileSync(out, JSON.stringify(proposal, null, 2));
console.log(`Created proposal: ${out}`);

const latestPath = join(proposalsDir, 'LATEST');
writeFileSync(latestPath, `${proposalId}.json\n`);
console.log(`Updated ${latestPath}`);

const init = initializeRolloutState(root, config);
if (init.changed) {
  console.log(`[propose] initialized rollout at ratio=${init.state.candidateRatio}`);
  console.log(init.envLine);
} else {
  console.log(`[propose] rollout already active at ratio=${init.state.candidateRatio}`);
}