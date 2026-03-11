import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

export interface RingPeerRecord {
  topic: string;
  baseUrl: string;
  updatedAt: string;
  source: 'configured' | 'announced' | 'manual';
}

export type RingPeerHealth = 'live' | 'stale' | 'expired';

export class RingPeerRegistry {
  private readonly dbHandle: ClawverseDbHandle;
  private readonly peers = new Map<string, RingPeerRecord>();

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._load();
  }

  list(): RingPeerRecord[] {
    return Array.from(this.peers.values())
      .sort((left, right) => left.topic.localeCompare(right.topic))
      .map((entry) => ({ ...entry }));
  }

  listWithHealth(nowMs = Date.now(), ttlMs = 5 * 60_000): Array<RingPeerRecord & { health: RingPeerHealth }> {
    return this.list().map((entry) => ({
      ...entry,
      health: peerHealth(entry, nowMs, ttlMs),
    }));
  }

  get(topic: string): RingPeerRecord | null {
    const entry = this.peers.get(topic.trim());
    return entry ? { ...entry } : null;
  }

  upsert(input: {
    topic: string;
    baseUrl: string;
    updatedAt?: string;
    source?: RingPeerRecord['source'];
  }): RingPeerRecord {
    const topic = input.topic.trim();
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
    const normalized: RingPeerRecord = {
      topic,
      baseUrl,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
      source: input.source ?? 'manual',
    };
    this.peers.set(topic, normalized);
    this._save(normalized);
    return { ...normalized };
  }

  remove(topic: string): boolean {
    const trimmed = topic.trim();
    const existed = this.peers.delete(trimmed);
    if (!existed) return false;
    this.dbHandle.db.prepare(`
      DELETE FROM ring_peers
      WHERE topic = ?
    `).run(trimmed);
    return true;
  }

  pruneExpired(ttlMs: number, nowMs = Date.now()): string[] {
    const removed: string[] = [];
    for (const entry of this.peers.values()) {
      if (peerHealth(entry, nowMs, ttlMs) !== 'expired') continue;
      if (this.remove(entry.topic)) removed.push(entry.topic);
    }
    return removed;
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private _load(): void {
    const rows = this.dbHandle.db.prepare(`
      SELECT topic, updated_at, payload_json
      FROM ring_peers
    `).all() as Array<{ topic: string; updated_at: string; payload_json: string }>;

    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload_json) as Partial<RingPeerRecord>;
        const topic = typeof payload.topic === 'string' && payload.topic.trim().length > 0
          ? payload.topic.trim()
          : row.topic.trim();
        const baseUrl = typeof payload.baseUrl === 'string' && payload.baseUrl.trim().length > 0
          ? payload.baseUrl.trim().replace(/\/+$/, '')
          : '';
        if (!topic || !baseUrl) continue;
        this.peers.set(topic, {
          topic,
          baseUrl,
          updatedAt: typeof payload.updatedAt === 'string' && payload.updatedAt.trim().length > 0
            ? payload.updatedAt
            : row.updated_at,
          source: payload.source === 'configured' || payload.source === 'announced'
            ? payload.source
            : 'manual',
        });
      } catch {
        // ignore malformed peer payloads
      }
    }
  }

  private _save(record: RingPeerRecord): void {
    this.dbHandle.db.prepare(`
      INSERT INTO ring_peers (topic, base_url, updated_at, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(topic) DO UPDATE SET
        base_url = excluded.base_url,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(record.topic, record.baseUrl, record.updatedAt, JSON.stringify(record));
  }
}

function peerHealth(entry: RingPeerRecord, nowMs: number, ttlMs: number): RingPeerHealth {
  const parsed = Date.parse(entry.updatedAt);
  if (!Number.isFinite(parsed)) return 'expired';
  const ageMs = Math.max(0, nowMs - parsed);
  if (ageMs >= ttlMs) return 'expired';
  if (ageMs >= ttlMs * 0.5) return 'stale';
  return 'live';
}
