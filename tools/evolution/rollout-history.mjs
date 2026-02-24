import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const historyPath = join(root, 'data/evolution/rollout/history.jsonl');

const sinceIdx = process.argv.indexOf('--since');
const since = sinceIdx !== -1 ? new Date(process.argv[sinceIdx + 1]) : null;
const lastN = (() => {
  const i = process.argv.indexOf('--last');
  return i !== -1 ? parseInt(process.argv[i + 1], 10) : null;
})();

if (!existsSync(historyPath)) {
  console.log('No rollout history found. Run at least one evolution cycle first.');
  process.exit(0);
}

const lines = readFileSync(historyPath, 'utf8').trim().split('\n').filter(Boolean);
let entries = lines.map((l) => JSON.parse(l));

if (since) entries = entries.filter((e) => new Date(e.ts) >= since);
if (lastN) entries = entries.slice(-lastN);

if (entries.length === 0) {
  console.log('No entries match the filter.');
  process.exit(0);
}

const icon = { adopt_candidate: '↑ adopt ', keep_baseline: '↓ revert', hold: '→ hold  ' };
const pct = (n) => `${(n * 100).toFixed(0)}%`.padStart(4);
const pad = (s, n) => String(s).padEnd(n);

console.log('');
console.log('Rollout History');
console.log('═'.repeat(82));
console.log(`${pad('Timestamp (UTC)', 21)} ${pad('Decision', 10)} ${pad('Ratio', 10)} Variant Pair`);
console.log('─'.repeat(82));

for (const e of entries) {
  const ts = new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19);
  const label = icon[e.decision] ?? '?      ';
  const ratio = `${pct(e.prevRatio)} → ${pct(e.ratio)}`;
  const pair = `${e.baseline} / ${e.candidate}`;
  console.log(`${ts}  ${label}  ${pad(ratio, 12)}  ${pair}`);
}

console.log('─'.repeat(82));
console.log(`${entries.length} change(s) shown`);
if (since) console.log(`since: ${since.toISOString().slice(0, 10)}`);
console.log('');
