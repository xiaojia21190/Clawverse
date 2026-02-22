import { appendFile, mkdirSync } from 'node:fs';
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
  private queue: string[] = [];
  private flushTimer: NodeJS.Timeout;

  constructor(opts: { episodesPath: string; variant: string; flushEvery: number }) {
    this.episodesPath = resolve(process.cwd(), opts.episodesPath);
    this.variant = opts.variant;
    this.flushEvery = Math.max(1, opts.flushEvery);

    mkdirSync(dirname(this.episodesPath), { recursive: true });

    // Flush queue every 3 seconds asynchronously
    this.flushTimer = setInterval(() => this._flush(), 3000);
    this.flushTimer.unref();
  }

  record(
    input: Omit<EpisodeRecord, 'id' | 'ts' | 'variant'> & { idPrefix?: string; variant?: string }
  ): void {
    this.counter += 1;
    if (this.counter % this.flushEvery !== 0) return;

    const { idPrefix, variant, ...payload } = input;

    const row: EpisodeRecord = {
      id: `${idPrefix || 'ep'}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      ts: new Date().toISOString(),
      variant: variant || this.variant,
      ...payload,
    };

    this.queue.push(JSON.stringify(row));
  }

  private _flush(): void {
    if (this.queue.length === 0) return;
    const lines = this.queue.splice(0);
    appendFile(this.episodesPath, lines.join('\n') + '\n', (err) => {
      if (err) {
        // re-queue on failure
        this.queue.unshift(...lines);
      }
    });
  }

  destroy(): void {
    clearInterval(this.flushTimer);
    // Best-effort sync flush on exit
    if (this.queue.length > 0) {
      const { appendFileSync } = require('node:fs');
      try {
        appendFileSync(this.episodesPath, this.queue.join('\n') + '\n');
      } catch { /* ignore */ }
    }
  }

  getVariant(): string {
    return this.variant;
  }

  getPath(): string {
    return this.episodesPath;
  }
}
