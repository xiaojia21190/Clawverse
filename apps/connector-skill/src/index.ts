export interface EvolutionEpisodeInput {
  success: boolean;
  latencyMs: number;
  tokenTotal?: number;
  costUsd?: number;
  source?: 'task-runtime' | 'manual';
  variant?: string;
  meta?: Record<string, unknown>;
}

export interface RolloutConfig {
  baseline: string;
  candidate: string;
  candidateRatio: number; // 0..1
  stickyKey?: string; // stable bucketing key
}

export interface TaskRunMetrics {
  success: boolean;
  latencyMs: number;
  tokenTotal?: number;
  costUsd?: number;
  meta?: Record<string, unknown>;
}

export interface TaskRunResult<T = unknown> {
  result?: T;
  metrics: TaskRunMetrics;
}

function hashToUnitInterval(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // uint32 -> [0, 1)
  return (h >>> 0) / 4294967296;
}

export function pickVariant(cfg?: RolloutConfig): string {
  if (!cfg) return process.env.CLAWVERSE_EVOLUTION_VARIANT || 'baseline-v1';

  const ratio = Math.min(1, Math.max(0, cfg.candidateRatio));
  const bucket = cfg.stickyKey ? hashToUnitInterval(cfg.stickyKey) : Math.random();
  return bucket < ratio ? cfg.candidate : cfg.baseline;
}

export function loadRolloutFromEnv(): RolloutConfig | null {
  const raw = process.env.CLAWVERSE_ROLLOUT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RolloutConfig;
    if (!parsed.baseline || !parsed.candidate) return null;
    const ratio = Number(parsed.candidateRatio);
    return {
      baseline: parsed.baseline,
      candidate: parsed.candidate,
      candidateRatio: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0,
    };
  } catch {
    return null;
  }
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

/**
 * Wrap a task function and auto-report an evolution episode on finish.
 */
export async function runWithEpisode<T>(
  taskName: string,
  fn: () => Promise<TaskRunResult<T>>,
  opts?: {
    baseUrl?: string;
    source?: 'task-runtime' | 'manual';
    rollout?: RolloutConfig;
    variant?: string;
    stickyKey?: string;
  }
): Promise<TaskRunResult<T>> {
  const startedAt = performance.now();
  const rollout = opts?.rollout || loadRolloutFromEnv() || undefined;
  const variant =
    opts?.variant ||
    pickVariant(rollout ? { ...rollout, stickyKey: opts?.stickyKey || rollout.stickyKey || taskName } : undefined);

  try {
    const run = await fn();

    const latencyMs = Number.isFinite(run.metrics.latencyMs)
      ? run.metrics.latencyMs
      : Math.round(performance.now() - startedAt);

    await reportEpisode(
      {
        success: run.metrics.success,
        latencyMs,
        tokenTotal: run.metrics.tokenTotal,
        costUsd: run.metrics.costUsd,
        source: opts?.source || 'task-runtime',
        variant,
        meta: {
          task: taskName,
          variantAssigned: variant,
          stickyKey: opts?.stickyKey || rollout?.stickyKey || taskName,
          ...run.metrics.meta,
        },
      },
      opts?.baseUrl
    );

    return { ...run, metrics: { ...run.metrics, latencyMs } };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);

    await reportEpisode(
      {
        success: false,
        latencyMs,
        source: opts?.source || 'task-runtime',
        variant,
        meta: {
          task: taskName,
          variantAssigned: variant,
          stickyKey: opts?.stickyKey || rollout?.stickyKey || taskName,
          error: error instanceof Error ? error.message : String(error),
        },
      },
      opts?.baseUrl
    );

    throw error;
  }
}

async function main() {
  const [, , modeOrSuccess, latencyRaw, tokenRaw, costRaw] = process.argv;

  // demo mode: node dist/index.js demo
  if (modeOrSuccess === 'demo') {
    const out = await runWithEpisode('connector-demo-task', async () => {
      await new Promise((r) => setTimeout(r, 120));
      return {
        result: { ok: true },
        metrics: {
          success: true,
          latencyMs: 120,
          tokenTotal: 1500,
          costUsd: 0.05,
          meta: { via: 'connector-demo' },
        },
      };
    });

    console.log(`demo done: ${JSON.stringify(out.metrics)}`);
    return;
  }

  if (typeof modeOrSuccess === 'undefined' || typeof latencyRaw === 'undefined') {
    console.log('Usage:');
    console.log('  node dist/index.js <success:true|false> <latencyMs> [tokenTotal] [costUsd]');
    console.log('  node dist/index.js demo');
    process.exit(1);
  }

  const success = modeOrSuccess === 'true';
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
