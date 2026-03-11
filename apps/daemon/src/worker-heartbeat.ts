export type WorkerHealthStatus = 'live' | 'stale' | 'missing';

export interface WorkerHeartbeatSnapshot {
  worker: string;
  lastSeenAt: string | null;
  ageMs: number | null;
  status: WorkerHealthStatus;
}

function normalizeWorkerId(worker: string): string {
  return worker.trim().toLowerCase();
}

function healthStatus(lastSeenMs: number | null, nowMs: number, staleAfterMs: number): WorkerHealthStatus {
  if (lastSeenMs === null) return 'missing';
  const ageMs = Math.max(0, nowMs - lastSeenMs);
  return ageMs <= staleAfterMs ? 'live' : 'stale';
}

export class WorkerHeartbeatRegistry {
  private readonly heartbeats = new Map<string, number>();

  heartbeat(worker: string, nowMs = Date.now()): WorkerHeartbeatSnapshot | null {
    const normalized = normalizeWorkerId(worker);
    if (!normalized) return null;
    const safeNowMs = Number.isFinite(nowMs) ? Math.max(0, Math.round(nowMs)) : Date.now();
    this.heartbeats.set(normalized, safeNowMs);
    return this.snapshot(normalized, safeNowMs);
  }

  snapshot(worker: string, nowMs = Date.now(), staleAfterMs = 3 * 60_000): WorkerHeartbeatSnapshot {
    const normalized = normalizeWorkerId(worker);
    if (!normalized) {
      return {
        worker: '',
        lastSeenAt: null,
        ageMs: null,
        status: 'missing',
      };
    }
    const safeNowMs = Number.isFinite(nowMs) ? Math.max(0, Math.round(nowMs)) : Date.now();
    const lastSeenMs = this.heartbeats.get(normalized) ?? null;
    return {
      worker: normalized,
      lastSeenAt: lastSeenMs === null ? null : new Date(lastSeenMs).toISOString(),
      ageMs: lastSeenMs === null ? null : Math.max(0, safeNowMs - lastSeenMs),
      status: healthStatus(lastSeenMs, safeNowMs, Math.max(1, Math.round(staleAfterMs))),
    };
  }

  list(nowMs = Date.now(), staleAfterMs = 3 * 60_000): WorkerHeartbeatSnapshot[] {
    const safeNowMs = Number.isFinite(nowMs) ? Math.max(0, Math.round(nowMs)) : Date.now();
    const safeStaleAfterMs = Math.max(1, Math.round(staleAfterMs));
    return Array.from(this.heartbeats.keys())
      .sort((left, right) => left.localeCompare(right))
      .map((worker) => this.snapshot(worker, safeNowMs, safeStaleAfterMs));
  }
}
