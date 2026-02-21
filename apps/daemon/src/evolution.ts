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
  source: 'daemon-heartbeat';
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

  record(input: Omit<EpisodeRecord, 'id' | 'ts' | 'variant' | 'source'>): void {
    this.counter += 1;
    if (this.counter % this.flushEvery !== 0) return;

    const row: EpisodeRecord = {
      id: `hb-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      ts: new Date().toISOString(),
      variant: this.variant,
      source: 'daemon-heartbeat',
      ...input,
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
