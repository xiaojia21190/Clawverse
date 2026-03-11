import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

export interface RingMirrorRecord {
  topic: string;
  actorCount: number;
  branchCount: number;
  brainStatus: 'authoritative' | 'pending' | 'inactive';
  updatedAt: string;
  source: 'mirror' | 'manual' | 'imported';
}

export class RingMirrorRegistry {
  private readonly dbHandle: ClawverseDbHandle;
  private readonly mirrors = new Map<string, RingMirrorRecord>();

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._load();
  }

  list(): RingMirrorRecord[] {
    return Array.from(this.mirrors.values())
      .sort((left, right) => left.topic.localeCompare(right.topic))
      .map((entry) => ({ ...entry }));
  }

  get(topic: string): RingMirrorRecord | null {
    const entry = this.mirrors.get(topic);
    return entry ? { ...entry } : null;
  }

  upsert(input: {
    topic: string;
    actorCount: number;
    branchCount: number;
    brainStatus?: RingMirrorRecord['brainStatus'];
    updatedAt?: string;
    source?: RingMirrorRecord['source'];
  }): RingMirrorRecord {
    const normalized: RingMirrorRecord = {
      topic: input.topic.trim(),
      actorCount: Math.max(0, Math.round(input.actorCount)),
      branchCount: Math.max(0, Math.round(input.branchCount)),
      brainStatus: input.brainStatus ?? 'inactive',
      updatedAt: input.updatedAt ?? new Date().toISOString(),
      source: input.source ?? 'manual',
    };
    this.mirrors.set(normalized.topic, normalized);
    this._save(normalized);
    return { ...normalized };
  }

  remove(topic: string): boolean {
    const trimmed = topic.trim();
    const existed = this.mirrors.delete(trimmed);
    if (!existed) return false;
    this.dbHandle.db.prepare(`
      DELETE FROM ring_topic_mirrors
      WHERE topic = ?
    `).run(trimmed);
    return true;
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private _load(): void {
    const rows = this.dbHandle.db.prepare(`
      SELECT topic, updated_at, payload_json
      FROM ring_topic_mirrors
    `).all() as Array<{ topic: string; updated_at: string; payload_json: string }>;

    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload_json) as Partial<RingMirrorRecord>;
        const topic = typeof payload.topic === 'string' && payload.topic.trim().length > 0
          ? payload.topic.trim()
          : row.topic.trim();
        if (!topic) continue;
        this.mirrors.set(topic, {
          topic,
          actorCount: Math.max(0, Number(payload.actorCount ?? 0)),
          branchCount: Math.max(0, Number(payload.branchCount ?? 0)),
          brainStatus: payload.brainStatus === 'authoritative' || payload.brainStatus === 'pending'
            ? payload.brainStatus
            : 'inactive',
          updatedAt: typeof payload.updatedAt === 'string' && payload.updatedAt.trim().length > 0
            ? payload.updatedAt
            : row.updated_at,
          source: payload.source === 'mirror' || payload.source === 'imported'
            ? payload.source
            : 'manual',
        });
      } catch {
        // ignore malformed mirror payloads
      }
    }
  }

  private _save(record: RingMirrorRecord): void {
    this.dbHandle.db.prepare(`
      INSERT INTO ring_topic_mirrors (topic, updated_at, payload_json)
      VALUES (?, ?, ?)
      ON CONFLICT(topic) DO UPDATE SET
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(record.topic, record.updatedAt, JSON.stringify(record));
  }
}
