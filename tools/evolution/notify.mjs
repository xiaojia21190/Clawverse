import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectRoot } from './_paths.mjs';

const root = getProjectRoot();
const summariesDir = join(root, 'data/evolution/summaries');
const latestSummaryPath = join(summariesDir, 'LATEST.md');

const text = readFileSync(latestSummaryPath, 'utf8');
const msg = `Clawverse Evolution Update\n\n${text.slice(0, 3500)}`;

async function sendWebhook(url) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: msg, source: 'clawverse-evolution' }),
  });
  if (!res.ok) throw new Error(`webhook_http_${res.status}`);
}

async function sendTelegram(token, chatId) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: msg.slice(0, 4000) }),
  });
  if (!res.ok) throw new Error(`telegram_http_${res.status}`);
}

const webhook = process.env.CLAWVERSE_NOTIFY_WEBHOOK;
const tgToken = process.env.CLAWVERSE_TELEGRAM_BOT_TOKEN;
const tgChat = process.env.CLAWVERSE_TELEGRAM_CHAT_ID;

let sent = false;
try {
  if (webhook) {
    await sendWebhook(webhook);
    console.log('notify: webhook sent');
    sent = true;
  }
  if (tgToken && tgChat) {
    await sendTelegram(tgToken, tgChat);
    console.log('notify: telegram sent');
    sent = true;
  }
  if (!sent) {
    console.log('notify: skipped (no webhook/telegram env configured)');
  }
} catch (e) {
  console.error('notify failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
}
