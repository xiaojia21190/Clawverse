import { logger } from './logger.js';

export interface RingMirrorPushTarget {
  baseUrl: string;
}

export interface RingMirrorPushPayload {
  topic: string;
  baseUrl: string | null;
  actorCount: number;
  branchCount: number;
  brainStatus: 'authoritative' | 'pending' | 'inactive';
  updatedAt: string;
  source: 'imported';
}

interface RingMirrorPusherOptions {
  targets: RingMirrorPushTarget[] | (() => RingMirrorPushTarget[]);
  intervalMs: number;
  payload: () => RingMirrorPushPayload;
  fetchImpl?: typeof fetch;
}

export class RingMirrorPusher {
  private readonly targetsSnapshot: () => RingMirrorPushTarget[];
  private readonly intervalMs: number;
  private readonly payload: () => RingMirrorPushPayload;
  private readonly fetchImpl: typeof fetch;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(opts: RingMirrorPusherOptions) {
    const targetInput = opts.targets;
    this.targetsSnapshot = typeof targetInput === 'function'
      ? () => normalizeTargets(targetInput())
      : () => normalizeTargets(targetInput);
    this.intervalMs = Math.max(15_000, opts.intervalMs);
    this.payload = opts.payload;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  start(): void {
    if (this.targetsSnapshot().length === 0 || this.timer) return;
    this.timer = setInterval(() => {
      void this.syncNow();
    }, this.intervalMs);
    this.timer.unref();
    logger.info(`[ring-push] started interval=${this.intervalMs}ms targets=${this.targetsSnapshot().length}`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async syncNow(): Promise<void> {
    const targets = this.targetsSnapshot();
    if (this.running || targets.length === 0) return;
    this.running = true;
    try {
      const payload = this.payload();
      await Promise.allSettled(targets.map((target) => this.pushTarget(target, payload)));
    } finally {
      this.running = false;
    }
  }

  private async pushTarget(target: RingMirrorPushTarget, payload: RingMirrorPushPayload): Promise<void> {
    try {
      const res = await this.fetchImpl(`${target.baseUrl}/world/ring/mirror`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-clawverse-origin': 'daemon-policy',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        logger.warn(`[ring-push] push rejected (${res.status}) by ${target.baseUrl}`);
      }
    } catch (error) {
      logger.warn(`[ring-push] push failed to ${target.baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function normalizeTargets(targets: RingMirrorPushTarget[]): RingMirrorPushTarget[] {
  const byUrl = new Map<string, RingMirrorPushTarget>();
  for (const target of targets) {
    const baseUrl = target.baseUrl.trim().replace(/\/+$/, '');
    if (!baseUrl) continue;
    byUrl.set(baseUrl, { baseUrl });
  }
  return Array.from(byUrl.values());
}
