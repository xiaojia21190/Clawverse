import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectRoot } from './_paths.mjs';

const root = getProjectRoot();
const historyPath = join(root, 'data/evolution/rollout/history.jsonl');

const sinceIdx = process.argv.indexOf('--since');
const since = sinceIdx !== -1 ? new Date(process.argv[sinceIdx + 1]) : null;
const lastN = (() => {
  const index = process.argv.indexOf('--last');
  return index !== -1 ? parseInt(process.argv[index + 1], 10) : null;
})();

if (!existsSync(historyPath)) {
  console.log('No rollout history found. Run at least one evolution cycle first.');
  process.exit(0);
}

const raw = readFileSync(historyPath, 'utf8').trim();
const lines = raw ? raw.split('\n').filter(Boolean) : [];
let entries = lines.map((line) => JSON.parse(line));

if (since) entries = entries.filter((entry) => new Date(entry.ts) >= since);
if (lastN) entries = entries.slice(-lastN);

if (entries.length === 0) {
  console.log('No entries match the filter.');
  process.exit(0);
}

const icon = {
  adopt_candidate: '-> adopt   ',
  keep_baseline: '-> revert  ',
  hold: '-> hold    ',
};
const pct = (n) => `${(n * 100).toFixed(0)}%`.padStart(4);
const pad = (value, width) => String(value).padEnd(width);

console.log('');
console.log('Rollout History');
console.log('='.repeat(112));
console.log(`${pad('Timestamp (UTC)', 21)} ${pad('Decision', 12)} ${pad('Ratio', 12)} ${pad('Gate', 16)} ${pad('Health', 10)} Variant Pair`);
console.log('-'.repeat(112));

for (const entry of entries) {
  const ts = new Date(entry.ts).toISOString().replace('T', ' ').slice(0, 19);
  const label = entry.healthRollbackApplied
    ? '!! health   '
    : entry.rollbackApplied
      ? '!! rollback '
      : entry.healthGateHoldApplied
        ? '.. health   '
        : entry.canaryHoldApplied
          ? '.. canary   '
          : (icon[entry.decision] ?? '?          ');
  const ratio = `${pct(entry.prevRatio)} -> ${pct(entry.ratio)}`;
  const gate = entry.healthRollbackApplied
    ? 'health rollback'
    : entry.rollbackApplied
      ? 'hard rollback'
      : entry.healthGateHoldApplied
        ? 'health hold'
        : entry.canaryHoldApplied
          ? 'observe'
          : '-';
  const health = entry.healthGateStatus ?? '-';
  const pair = `${entry.baseline} / ${entry.candidate}`;
  console.log(`${ts}  ${label} ${pad(ratio, 12)} ${pad(gate, 16)} ${pad(health, 10)} ${pair}`);
}

console.log('-'.repeat(112));
console.log(`${entries.length} change(s) shown`);
if (since) console.log(`since: ${since.toISOString().slice(0, 10)}`);
console.log('');