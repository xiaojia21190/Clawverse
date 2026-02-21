import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface EpisodeRecord {
  id: string;
  ts: string;
  variant: string;
  success: boolean;
  latencyMs: number;
  tokenTotal?: number;
  costUsd?: number;
  source: 'daemon-heartbeat' | 'task-runtime' | 'manual';
  meta?: {
    connectedPeers: number;
    knownPeers: number;
    cpuUsage: number;
    ramUsage: number;
    mood: string;
  };
}

export class EvolutionEpisodeLogger {
  private readonly episodesPath: string;
  private readonly variant: string;
  private readonly flushEvery: number;
  private counter = 0;

  constructor(opts: { episodesPath: string; variant: string; flushEvery: number }) {
    this.episodesPath = resolve(process.cwd(), opts.episodesPath);
    this.variant = opts.variant;
    this.flushEvery = Math.max(1, opts.flushEvery);

    mkdirSync(dirname(this.episodesPath), { recursive: true });
  }

  record(
    input: Omit<EpisodeRecord, 'id' | 'ts' | 'variant'> & { idPrefix?: string }
  ): void {
    this.counter += 1;
    if (this.counter % this.flushEvery !== 0) return;

    const { idPrefix, ...payload } = input;

    const row: EpisodeRecord = {
      id: `${idPrefix || 'ep'}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      ts: new Date().toISOString(),
      variant: this.variant,
      ...payload,
    };

    appendFileSync(this.episodesPath, `${JSON.stringify(row)}\n`);
  }

  getVariant(): string {
    return this.variant;
  }

  getPath(): string {
    return this.episodesPath;
  }
}
