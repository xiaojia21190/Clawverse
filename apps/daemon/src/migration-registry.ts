import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

export interface MigrationIntentRecord {
  id: string;
  actorId: string;
  sessionId: string;
  fromTopic: string;
  toTopic: string;
  triggerEventType: string;
  summary: string;
  score: number;
  status: 'planned' | 'cancelled';
  source: 'life-worker' | 'manual' | 'system';
  createdAt: string;
  updatedAt: string;
}

export class MigrationRegistry {
  private readonly dbHandle: ClawverseDbHandle;
  private readonly intents = new Map<string, MigrationIntentRecord>();

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._load();
  }

  listActive(limit = 12): MigrationIntentRecord[] {
    return Array.from(this.intents.values())
      .filter((item) => item.status === 'planned')
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, limit)
      .map((entry) => ({ ...entry }));
  }

  create(input: {
    actorId: string;
    sessionId: string;
    fromTopic: string;
    toTopic: string;
    triggerEventType?: string;
    summary: string;
    score?: number;
    source?: MigrationIntentRecord['source'];
  }): MigrationIntentRecord {
    const now = new Date().toISOString();
    const record: MigrationIntentRecord = {
      id: `mig-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      actorId: input.actorId.trim(),
      sessionId: input.sessionId.trim(),
      fromTopic: input.fromTopic.trim(),
      toTopic: input.toTopic.trim(),
      triggerEventType: input.triggerEventType?.trim() || 'migration',
      summary: input.summary.trim().slice(0, 240),
      score: Math.max(0, Math.min(100, Math.round(input.score ?? 0))),
      status: 'planned',
      source: input.source ?? 'manual',
      createdAt: now,
      updatedAt: now,
    };
    this.intents.set(record.id, record);
    this._save(record);
    return { ...record };
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private _load(): void {
    const rows = this.dbHandle.db.prepare(`
      SELECT payload_json
      FROM migration_intents
    `).all() as Array<{ payload_json: string }>;
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload_json) as MigrationIntentRecord;
        if (!payload?.id) continue;
        this.intents.set(payload.id, payload);
      } catch {
        // ignore malformed rows
      }
    }
  }

  private _save(record: MigrationIntentRecord): void {
    this.dbHandle.db.prepare(`
      INSERT INTO migration_intents (id, actor_id, session_id, from_topic, to_topic, status, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        actor_id = excluded.actor_id,
        session_id = excluded.session_id,
        from_topic = excluded.from_topic,
        to_topic = excluded.to_topic,
        status = excluded.status,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      record.id,
      record.actorId,
      record.sessionId,
      record.fromTopic,
      record.toTopic,
      record.status,
      record.updatedAt,
      JSON.stringify(record),
    );
  }
}
