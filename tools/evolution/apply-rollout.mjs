import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const config = JSON.parse(readFileSync(join(root, 'tools/evolution/config.json'), 'utf8'));
const latest = readFileSync(join(root, 'data/evolution/proposals/LATEST'), 'utf8').trim().replace(/\.json$/, '');
const decision = JSON.parse(readFileSync(join(root, `data/evolution/decisions/${latest}.json`), 'utf8'));

const statePath = join(root, 'data/evolution/rollout/state.json');
mkdirSync(join(root, 'data/evolution/rollout'), { recursive: true });

let state = {
  baseline: config.baseline,
  candidate: config.candidate,
  candidateRatio: 0,
  updatedAt: new Date().toISOString(),
};

try {
  state = JSON.parse(readFileSync(statePath, 'utf8'));
} catch {}

const policy = config.rolloutPolicy || {
  startRatio: 0.1,
  stepUp: 0.2,
  maxRatio: 1,
  stepDownOnFail: 0.1,
};

const prevRatio = state.candidateRatio;

if (decision.decision === 'adopt_candidate') {
  if (state.candidate !== config.candidate || state.baseline !== config.baseline) {
    state.baseline = config.baseline;
    state.candidate = config.candidate;
    state.candidateRatio = policy.startRatio;
  } else {
    state.candidateRatio = Math.min(policy.maxRatio, state.candidateRatio + policy.stepUp);
  }
} else if (decision.decision === 'keep_baseline') {
  state.candidateRatio = Math.max(0, state.candidateRatio - policy.stepDownOnFail);
} else if (decision.decision === 'hold') {
  // keep ratio unchanged when sample size is insufficient
  state.candidateRatio = state.candidateRatio;
}

state.updatedAt = new Date().toISOString();
writeFileSync(statePath, JSON.stringify(state, null, 2));

// Append to rollout history
appendFileSync(
  join(root, 'data/evolution/rollout/history.jsonl'),
  JSON.stringify({
    ts: state.updatedAt,
    decision: decision.decision,
    proposalId: decision.proposalId,
    baseline: state.baseline,
    candidate: state.candidate,
    prevRatio,
    ratio: state.candidateRatio,
  }) + '\n',
);

const envPayload = {
  baseline: state.baseline,
  candidate: state.candidate,
  candidateRatio: state.candidateRatio,
};

const envLine = `export CLAWVERSE_ROLLOUT_JSON='${JSON.stringify(envPayload)}'`;
writeFileSync(join(root, 'data/evolution/rollout/latest.env'), `${envLine}\n`);
console.log(`rollout updated: ratio=${state.candidateRatio}`);
console.log(envLine);
