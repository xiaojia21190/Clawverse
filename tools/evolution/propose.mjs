import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const configPath = join(root, 'tools/evolution/config.json');
const proposalsDir = join(root, 'data/evolution/proposals');

const now = new Date();
const proposalId = `proposal-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

const config = JSON.parse(readFileSync(configPath, 'utf8'));

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
  notes: config.notes ?? ''
};

mkdirSync(proposalsDir, { recursive: true });
const out = join(proposalsDir, `${proposalId}.json`);
writeFileSync(out, JSON.stringify(proposal, null, 2));

console.log(`Created proposal: ${out}`);

const latestPath = join(proposalsDir, 'LATEST');
writeFileSync(latestPath, `${proposalId}.json\n`);
console.log(`Updated ${latestPath}`);
