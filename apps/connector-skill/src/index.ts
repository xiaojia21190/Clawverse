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

export interface RolloutAssignment {
  ts: string;
  task: string;
  stickyKey: string;
  variant: string;
  candidateRatio: number;
  baseline: string;
  candidate: string;
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

export interface UsageLike {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cost_usd?: number;
  costUsd?: number;
}

import { readFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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

function normalizeRollout(parsed: RolloutConfig | null | undefined): RolloutConfig | null {
  if (!parsed || !parsed.baseline || !parsed.candidate) return null;
  const ratio = Number(parsed.candidateRatio);
  return {
    baseline: parsed.baseline,
    candidate: parsed.candidate,
    candidateRatio: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0,
    stickyKey: parsed.stickyKey,
  };
}

export function loadRolloutFromEnv(): RolloutConfig | null {
  const raw = process.env.CLAWVERSE_ROLLOUT_JSON;
  if (raw) {
    try {
      return normalizeRollout(JSON.parse(raw) as RolloutConfig);
    } catch {
      // ignore and fallback to rollout state file
    }
  }

  const statePath = process.env.CLAWVERSE_ROLLOUT_STATE_PATH || 'data/evolution/rollout/state.json';
  try {
    const full = resolve(process.cwd(), statePath);
    const parsed = JSON.parse(readFileSync(full, 'utf8')) as RolloutConfig;
    return normalizeRollout(parsed);
  } catch {
    return null;
  }
}

export function extractUsageMetrics(payload: unknown): { tokenTotal?: number; costUsd?: number } {
  if (!payload || typeof payload !== 'object') return {};

  const obj = payload as Record<string, any>;
  const usage = (obj.usage || obj.metrics?.usage || obj.result?.usage || obj.response?.usage || {}) as UsageLike;

  const tokenTotal =
    usage.total_tokens ?? usage.totalTokens ??
    (Number(usage.input_tokens ?? usage.inputTokens ?? 0) + Number(usage.output_tokens ?? usage.outputTokens ?? 0));

  const costUsd = usage.cost_usd ?? usage.costUsd ?? obj.costUsd ?? obj.cost_usd;

  return {
    tokenTotal: Number.isFinite(Number(tokenTotal)) ? Number(tokenTotal) : undefined,
    costUsd: Number.isFinite(Number(costUsd)) ? Number(costUsd) : undefined,
  };
}

function logRolloutAssignment(input: RolloutAssignment): void {
  const path =
    process.env.CLAWVERSE_ROLLOUT_AUDIT_PATH || 'data/evolution/rollout/assignments.jsonl';
  const fullPath = resolve(process.cwd(), path);
  const line = `${JSON.stringify(input)}\n`;
  void mkdir(dirname(fullPath), { recursive: true })
    .then(() => appendFile(fullPath, line, 'utf8'))
    .catch(() => {});
}

async function safeReportEpisode(
  input: EvolutionEpisodeInput,
  baseUrl?: string
): Promise<{ ok: boolean; variant?: string; error?: string }> {
  try {
    return await reportEpisode(input, baseUrl);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export async function reportEpisode(
  input: EvolutionEpisodeInput,
  baseUrl = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820'
): Promise<{ ok: boolean; variant?: string; error?: string }> {
  const retries = Number(process.env.CLAWVERSE_REPORT_RETRIES || 2);
  const backoffMs = Number(process.env.CLAWVERSE_REPORT_BACKOFF_MS || 300);

  let lastError = 'unknown';

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
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
        lastError = data?.error || `http_${res.status}`;
      } else {
        return { ok: true, variant: data?.variant };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < retries) {
      await sleep(backoffMs * (attempt + 1));
    }
  }

  return { ok: false, error: lastError };
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
  const stickyKey = opts?.stickyKey || rollout?.stickyKey || taskName;
  const variant = opts?.variant || pickVariant(rollout ? { ...rollout, stickyKey } : undefined);

  if (rollout) {
    logRolloutAssignment({
      ts: new Date().toISOString(),
      task: taskName,
      stickyKey,
      variant,
      baseline: rollout.baseline,
      candidate: rollout.candidate,
      candidateRatio: rollout.candidateRatio,
    });
  }

  try {
    const run = await fn();

    const latencyMs = Number.isFinite(run.metrics.latencyMs)
      ? run.metrics.latencyMs
      : Math.round(performance.now() - startedAt);

    const report = await safeReportEpisode(
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
          stickyKey,
          ...run.metrics.meta,
        },
      },
      opts?.baseUrl
    );

    if (!report.ok) {
      console.warn(`[connector] episode report failed: ${report.error}`);
    }

    return { ...run, metrics: { ...run.metrics, latencyMs } };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);

    const report = await safeReportEpisode(
      {
        success: false,
        latencyMs,
        source: opts?.source || 'task-runtime',
        variant,
        meta: {
          task: taskName,
          variantAssigned: variant,
          stickyKey,
          error: error instanceof Error ? error.message : String(error),
        },
      },
      opts?.baseUrl
    );

    if (!report.ok) {
      console.warn(`[connector] episode report failed: ${report.error}`);
    }

    throw error;
  }
}

export async function runTaskAutoMetrics<T>(
  taskName: string,
  fn: () => Promise<T>,
  opts?: {
    successWhen?: (result: T) => boolean;
    baseUrl?: string;
    source?: 'task-runtime' | 'manual';
    rollout?: RolloutConfig;
    variant?: string;
    stickyKey?: string;
    meta?: Record<string, unknown>;
  }
): Promise<T> {
  return runWithEpisode(
    taskName,
    async () => {
      const started = performance.now();
      const result = await fn();
      const usage = extractUsageMetrics(result);
      const success = opts?.successWhen ? opts.successWhen(result) : true;
      return {
        result,
        metrics: {
          success,
          latencyMs: Math.round(performance.now() - started),
          tokenTotal: usage.tokenTotal,
          costUsd: usage.costUsd,
          meta: opts?.meta,
        },
      };
    },
    opts
  ).then((r) => r.result as T);
}

export function createTaskRunner(defaults?: {
  baseUrl?: string;
  source?: 'task-runtime' | 'manual';
  rollout?: RolloutConfig;
  stickyKey?: string;
  meta?: Record<string, unknown>;
}) {
  return {
    run: <T>(
      taskName: string,
      fn: () => Promise<T>,
      opts?: {
        successWhen?: (result: T) => boolean;
        variant?: string;
        stickyKey?: string;
        meta?: Record<string, unknown>;
      }
    ) =>
      runTaskAutoMetrics(taskName, fn, {
        baseUrl: defaults?.baseUrl,
        source: defaults?.source,
        rollout: defaults?.rollout,
        stickyKey: opts?.stickyKey || defaults?.stickyKey,
        successWhen: opts?.successWhen,
        variant: opts?.variant,
        meta: {
          ...(defaults?.meta || {}),
          ...(opts?.meta || {}),
        },
      }),
  };
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
