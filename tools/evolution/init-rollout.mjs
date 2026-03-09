import { getProjectRoot } from './_paths.mjs';
import { initializeRolloutState, readEvolutionConfig } from './_rollout.mjs';

const root = getProjectRoot();
const config = readEvolutionConfig(root);
const force = process.argv.includes('--force');

const init = initializeRolloutState(root, config, { force });

if (init.changed) {
  console.log(`[init-rollout] initialized rollout: ${init.state.baseline} -> ${init.state.candidate} @ ratio=${init.state.candidateRatio}`);
} else {
  console.log(`[init-rollout] rollout already initialized: ${init.state.baseline} -> ${init.state.candidate} @ ratio=${init.state.candidateRatio}`);
}

console.log(init.envLine);