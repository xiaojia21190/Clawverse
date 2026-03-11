import { RingMirrorRegistry } from './ring-registry.js';
import { logger } from './logger.js';

export interface RingMirrorSyncSource {
  topic: string;
  baseUrl: string;
}

interface RemoteStatusResponse {
  topic?: string;
  world?: {
    topic?: string;
    population?: {
      actorCount?: number;
      branchCount?: number;
    };
    brain?: {
      status?: 'authoritative' | 'pending';
    };
  } | null;
}

interface RingMirrorSyncerOptions {
  currentTopic: string;
  sources: RingMirrorSyncSource[] | (() => RingMirrorSyncSource[]);
  registry: RingMirrorRegistry;
  intervalMs: number;
  fetchImpl?: typeof fetch;
}

export class RingMirrorSyncer {
  private readonly currentTopic: string;
  private readonly sourcesSnapshot: () => RingMirrorSyncSource[];
  private readonly registry: RingMirrorRegistry;
  private readonly intervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(opts: RingMirrorSyncerOptions) {
    this.currentTopic = opts.currentTopic;
    const sourceInput = opts.sources;
    this.sourcesSnapshot = typeof sourceInput === 'function'
      ? () => normalizeSources(sourceInput(), this.currentTopic)
      : () => normalizeSources(sourceInput, this.currentTopic);
    this.registry = opts.registry;
    this.intervalMs = Math.max(15_000, opts.intervalMs);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  start(): void {
    if (this.sourcesSnapshot().length === 0 || this.timer) return;
    this.timer = setInterval(() => {
      void this.syncNow();
    }, this.intervalMs);
    this.timer.unref();
    logger.info(`[ring-sync] started interval=${this.intervalMs}ms sources=${this.sourcesSnapshot().length}`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async syncNow(): Promise<void> {
    const sources = this.sourcesSnapshot();
    if (this.running || sources.length === 0) return;
    this.running = true;
    try {
      await Promise.allSettled(sources.map((source) => this.syncSource(source)));
    } finally {
      this.running = false;
    }
  }

  private async syncSource(source: RingMirrorSyncSource): Promise<void> {
    try {
      const res = await this.fetchImpl(`${source.baseUrl}/status`, {
        headers: { 'x-clawverse-origin': 'ring-sync' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        logger.warn(`[ring-sync] ${source.topic} status fetch failed (${res.status}) from ${source.baseUrl}`);
        return;
      }
      const payload = await res.json() as RemoteStatusResponse;
      const remoteTopic = payload.world?.topic ?? payload.topic ?? '';
      if (remoteTopic !== source.topic) {
        logger.warn(`[ring-sync] topic mismatch for ${source.baseUrl}: expected=${source.topic} actual=${remoteTopic || 'unknown'}`);
        return;
      }
      const actorCount = Number(payload.world?.population?.actorCount ?? 0);
      const branchCount = Number(payload.world?.population?.branchCount ?? 0);
      const brainStatus = payload.world?.brain?.status === 'authoritative' || payload.world?.brain?.status === 'pending'
        ? payload.world.brain.status
        : 'inactive';

      this.registry.upsert({
        topic: source.topic,
        actorCount,
        branchCount,
        brainStatus,
        updatedAt: new Date().toISOString(),
        source: 'mirror',
      });
    } catch (error) {
      logger.warn(`[ring-sync] ${source.topic} sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function normalizeSources(
  sources: RingMirrorSyncSource[],
  currentTopic: string,
): RingMirrorSyncSource[] {
  const byTopic = new Map<string, RingMirrorSyncSource>();
  for (const source of sources) {
    const topic = source.topic.trim();
    const baseUrl = source.baseUrl.trim().replace(/\/+$/, '');
    if (!topic || !baseUrl || topic === currentTopic) continue;
    byTopic.set(topic, { topic, baseUrl });
  }
  return Array.from(byTopic.values());
}
