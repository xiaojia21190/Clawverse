import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const proposalsDir = join(root, 'data/evolution/proposals');
const reportsDir = join(root, 'data/evolution/reports');
const decisionsDir = join(root, 'data/evolution/decisions');
const summaryDir = join(root, 'data/evolution/summaries');

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

run('node tools/evolution/propose.mjs');
run('node tools/evolution/evaluate.mjs');
run('node tools/evolution/decide.mjs');
run('node tools/evolution/apply-rollout.mjs');

const latest = readFileSync(join(proposalsDir, 'LATEST'), 'utf8').trim().replace(/\.json$/, '');
const proposal = JSON.parse(readFileSync(join(proposalsDir, `${latest}.json`), 'utf8'));
const report = JSON.parse(readFileSync(join(reportsDir, `${latest}.json`), 'utf8'));
const decision = JSON.parse(readFileSync(join(decisionsDir, `${latest}.json`), 'utf8'));

const md = `# Evolution Cycle Summary\n\n- Proposal: ${proposal.id}\n- Decision: **${decision.decision}**\n- Passed: ${decision.passed}\n- Evaluated At: ${report.evaluatedAt}\n- Sources: ${(report.includeSources || []).join(', ')}\n- Sample Size: ${report.sampleSize}\n\n## Deltas\n- successRate: ${report.deltas.successRate}\n- avgLatencyMs: ${report.deltas.avgLatencyMs}\n- avgTokenTotal: ${report.deltas.avgTokenTotal}\n- avgCostUsd: ${report.deltas.avgCostUsd}\n\n## Checks\n- successRate: ${decision.checks.successRate}\n- latency: ${decision.checks.latency}\n- tokens: ${decision.checks.tokens}\n- cost: ${decision.checks.cost}\n`;

mkdirSync(summaryDir, { recursive: true });
const summaryPath = join(summaryDir, `${latest}.md`);
writeFileSync(summaryPath, md);
writeFileSync(join(summaryDir, 'LATEST.md'), md);

console.log(`Summary written: ${summaryPath}`);

if (process.env.CLAWVERSE_NOTIFY_ON_CYCLE === 'true') {
  run('node tools/evolution/notify.mjs');
}
