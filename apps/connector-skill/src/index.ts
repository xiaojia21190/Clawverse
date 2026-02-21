export interface EvolutionEpisodeInput {
  success: boolean;
  latencyMs: number;
  tokenTotal?: number;
  costUsd?: number;
  source?: 'task-runtime' | 'manual';
  meta?: Record<string, unknown>;
}

export async function reportEpisode(
  input: EvolutionEpisodeInput,
  baseUrl = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820'
): Promise<{ ok: boolean; variant?: string; error?: string }> {
  const res = await fetch(`${baseUrl}/evolution/episode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'task-runtime', ...input }),
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    return { ok: false, error: data?.error || `http_${res.status}` };
  }

  return { ok: true, variant: data?.variant };
}

async function main() {
  const [, , successRaw, latencyRaw, tokenRaw, costRaw] = process.argv;

  if (typeof successRaw === 'undefined' || typeof latencyRaw === 'undefined') {
    console.log('Usage: node dist/index.js <success:true|false> <latencyMs> [tokenTotal] [costUsd]');
    process.exit(1);
  }

  const success = successRaw === 'true';
  const latencyMs = Number(latencyRaw);
  const tokenTotal = typeof tokenRaw !== 'undefined' ? Number(tokenRaw) : undefined;
  const costUsd = typeof costRaw !== 'undefined' ? Number(costRaw) : undefined;

  const out = await reportEpisode({
    success,
    latencyMs,
    tokenTotal: Number.isFinite(tokenTotal as number) ? tokenTotal : undefined,
    costUsd: Number.isFinite(costUsd as number) ? costUsd : undefined,
    source: 'manual',
    meta: { via: 'connector-skill-cli' },
  });

  if (!out.ok) {
    console.error(`report failed: ${out.error}`);
    process.exit(2);
  }

  console.log(`report ok (variant=${out.variant || 'unknown'})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
