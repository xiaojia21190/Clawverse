import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const proposalsDir = join(root, 'data/evolution/proposals');
const reportsDir = join(root, 'data/evolution/reports');
const decisionsDir = join(root, 'data/evolution/decisions');
const summaryDir = join(root, 'data/evolution/summaries');

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runWithRetry(cmd, stepName) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      execSync(cmd, { stdio: 'inherit' });
      return;
    } catch (err) {
      lastErr = err;
      const remaining = MAX_RETRIES + 1 - attempt;
      if (remaining > 0) {
        console.error(`[cycle] ${stepName} failed (attempt ${attempt}), retrying in ${RETRY_DELAY_MS}ms...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw new Error(`${stepName} failed after ${MAX_RETRIES + 1} attempts: ${lastErr?.message ?? lastErr}`);
}

async function sendFailureAlert(stepName, errorMsg) {
  const tgToken = process.env.CLAWVERSE_TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.CLAWVERSE_TELEGRAM_CHAT_ID;
  const webhook = process.env.CLAWVERSE_NOTIFY_WEBHOOK;

  const text = `🚨 Clawverse Evolution FAILED\nStep: ${stepName}\nError: ${errorMsg.slice(0, 500)}\nTime: ${new Date().toISOString()}`;

  const tasks = [];
  if (tgToken && tgChat) {
    tasks.push(
      fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChat, text: text.slice(0, 4000) }),
        signal: AbortSignal.timeout(10_000),
      }).catch((e) => console.error('[cycle] Telegram alert failed:', e.message))
    );
  }
  if (webhook) {
    tasks.push(
      fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, source: 'clawverse-cycle-failure' }),
        signal: AbortSignal.timeout(10_000),
      }).catch((e) => console.error('[cycle] Webhook alert failed:', e.message))
    );
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
    console.error('[cycle] Failure alerts sent.');
  }
}

async function main() {
  const steps = [
    { cmd: 'node tools/evolution/propose.mjs', name: 'propose' },
    { cmd: 'node tools/evolution/evaluate.mjs', name: 'evaluate' },
    { cmd: 'node tools/evolution/decide.mjs', name: 'decide' },
    { cmd: 'node tools/evolution/apply-rollout.mjs', name: 'apply-rollout' },
  ];

  for (const { cmd, name } of steps) {
    try {
      await runWithRetry(cmd, name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cycle] Fatal: ${msg}`);
      await sendFailureAlert(name, msg);
      process.exit(1);
    }
  }

  // Build summary
  const latest = readFileSync(join(proposalsDir, 'LATEST'), 'utf8').trim().replace(/\.json$/, '');
  const proposal = JSON.parse(readFileSync(join(proposalsDir, `${latest}.json`), 'utf8'));
  const report = JSON.parse(readFileSync(join(reportsDir, `${latest}.json`), 'utf8'));
  const decision = JSON.parse(readFileSync(join(decisionsDir, `${latest}.json`), 'utf8'));

  const md = [
    `# Evolution Cycle Summary`,
    ``,
    `- Proposal: ${proposal.id}`,
    `- Decision: **${decision.decision}**`,
    `- Passed: ${decision.passed}`,
    `- Evaluated At: ${report.evaluatedAt}`,
    `- Sources: ${(report.includeSources || []).join(', ')}`,
    `- Sample Size: ${report.sampleSize}`,
    ``,
    `## Deltas`,
    `- successRate: ${report.deltas.successRate}`,
    `- avgLatencyMs: ${report.deltas.avgLatencyMs}`,
    `- avgTokenTotal: ${report.deltas.avgTokenTotal}`,
    `- avgCostUsd: ${report.deltas.avgCostUsd}`,
    ``,
    `## Checks`,
    `- successRate: ${decision.checks.successRate}`,
    `- latency: ${decision.checks.latency}`,
    `- tokens: ${decision.checks.tokens}`,
    `- cost: ${decision.checks.cost}`,
  ].join('\n');

  mkdirSync(summaryDir, { recursive: true });
  const summaryPath = join(summaryDir, `${latest}.md`);
  writeFileSync(summaryPath, md);
  writeFileSync(join(summaryDir, 'LATEST.md'), md);
  console.log(`[cycle] Summary written: ${summaryPath}`);

  if (process.env.CLAWVERSE_NOTIFY_ON_CYCLE === 'true') {
    try {
      await runWithRetry('node tools/evolution/notify.mjs', 'notify');
    } catch (err) {
      console.warn('[cycle] Notification failed (non-fatal):', err.message);
    }
  }

  console.log('[cycle] Evolution cycle complete.');
}

main().catch(async (err) => {
  console.error('[cycle] Unexpected error:', err.message ?? err);
  await sendFailureAlert('main', err.message ?? String(err));
  process.exit(1);
});
