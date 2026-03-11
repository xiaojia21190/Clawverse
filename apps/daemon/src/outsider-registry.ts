import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

export type OutsiderStatus = 'observed' | 'tolerated' | 'traded' | 'accepted' | 'expelled';

export interface OutsiderRecord {
  id: string;
  hostTopic: string;
  fromTopic: string | null;
  label: string;
  actorIds: string[];
  actorCount: number;
  triggerEventType: string;
  status: OutsiderStatus;
  source: 'storyteller' | 'migration' | 'manual' | 'system';
  trust: number;
  pressure: number;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutsiderTransition {
  before: OutsiderRecord;
  after: OutsiderRecord;
}

export class OutsiderRegistry {
  private readonly dbHandle: ClawverseDbHandle;
  private readonly outsiders = new Map<string, OutsiderRecord>();

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._load();
  }

  list(hostTopic?: string, limit = 16): OutsiderRecord[] {
    return Array.from(this.outsiders.values())
      .filter((record) => !hostTopic || record.hostTopic === hostTopic)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, Math.max(1, limit))
      .map((record) => ({
        ...record,
        actorIds: [...record.actorIds],
      }));
  }

  create(input: {
    hostTopic: string;
    fromTopic?: string | null;
    label: string;
    actorIds?: string[];
    actorCount?: number;
    triggerEventType?: string;
    source?: OutsiderRecord['source'];
    summary: string;
    trust?: number;
    pressure?: number;
    status?: OutsiderStatus;
  }): OutsiderRecord {
    const now = new Date().toISOString();
    const actorIds = Array.from(new Set((input.actorIds ?? []).filter((value) => typeof value === 'string' && value.trim().length > 0)));
    const requestedActorCount = input.actorCount ?? actorIds.length ?? 1;
    const actorCount = Math.max(actorIds.length, Math.max(1, Math.round(requestedActorCount)));
    const record: OutsiderRecord = {
      id: `out-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      hostTopic: input.hostTopic.trim(),
      fromTopic: typeof input.fromTopic === 'string' && input.fromTopic.trim().length > 0 ? input.fromTopic.trim() : null,
      label: input.label.trim().slice(0, 80),
      actorIds,
      actorCount,
      triggerEventType: input.triggerEventType?.trim() || 'stranger_arrival',
      status: input.status ?? 'observed',
      source: input.source ?? 'manual',
      trust: clamp(Math.round(input.trust ?? 30)),
      pressure: clamp(Math.round(input.pressure ?? 45)),
      summary: input.summary.trim().slice(0, 240),
      createdAt: now,
      updatedAt: now,
    };
    this.outsiders.set(record.id, record);
    this._save(record);
    return { ...record, actorIds: [...record.actorIds] };
  }

  review(hostTopic: string, input: {
    clusterCount: number;
    raidRisk: number;
    activeWarCount: number;
    resources: { compute: number; storage: number; bandwidth: number; reputation?: number };
  }): OutsiderTransition[] {
    const updated: OutsiderTransition[] = [];
    for (const record of this.outsiders.values()) {
      if (record.hostTopic !== hostTopic) continue;
      const next = evolveOutsider(record, input);
      if (!next) continue;
      this.outsiders.set(next.id, next);
      this._save(next);
      updated.push({
        before: { ...record, actorIds: [...record.actorIds] },
        after: { ...next, actorIds: [...next.actorIds] },
      });
    }
    return updated;
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private _load(): void {
    const rows = this.dbHandle.db.prepare(`
      SELECT payload_json
      FROM world_outsiders
    `).all() as Array<{ payload_json: string }>;
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload_json) as OutsiderRecord;
        if (!payload?.id || !payload?.hostTopic) continue;
        this.outsiders.set(payload.id, {
          ...payload,
          actorIds: Array.isArray(payload.actorIds) ? payload.actorIds : [],
        });
      } catch {
        // ignore malformed rows
      }
    }
  }

  private _save(record: OutsiderRecord): void {
    this.dbHandle.db.prepare(`
      INSERT INTO world_outsiders (id, host_topic, status, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        host_topic = excluded.host_topic,
        status = excluded.status,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      record.id,
      record.hostTopic,
      record.status,
      record.updatedAt,
      JSON.stringify(record),
    );
  }
}

function evolveOutsider(
  record: OutsiderRecord,
  input: {
    clusterCount: number;
    raidRisk: number;
    activeWarCount: number;
    resources: { compute: number; storage: number; bandwidth: number; reputation?: number };
  },
): OutsiderRecord | null {
  const totalResources = input.resources.compute + input.resources.storage + input.resources.bandwidth;
  let status = record.status;
  let trust = record.trust;
  let pressure = record.pressure;

  pressure = clamp(Math.round(
    pressure
      + input.raidRisk * 0.18
      + input.activeWarCount * 8
      - Math.min(14, input.clusterCount * 4)
      - Math.max(0, totalResources - 120) * 0.08,
  ));

  trust = clamp(Math.round(
    trust
      + Math.min(10, input.clusterCount * 3)
      + Math.max(0, (input.resources.reputation ?? 0) - 12) * 0.25
      - input.activeWarCount * 4
      - Math.max(0, input.raidRisk - 55) * 0.18,
  ));

  if (status !== 'accepted' && (input.raidRisk >= 82 || pressure >= 88)) {
    status = 'expelled';
  } else if (status === 'observed' && trust >= 36 && pressure <= 64) {
    status = 'tolerated';
  } else if (status === 'tolerated' && trust >= 52 && pressure <= 52) {
    status = 'traded';
  } else if (status === 'traded' && trust >= 68 && pressure <= 42 && input.clusterCount >= 2) {
    status = 'accepted';
  }

  if (status === record.status && trust === record.trust && pressure === record.pressure) return null;
  return {
    ...record,
    status,
    trust,
    pressure,
    updatedAt: new Date().toISOString(),
  };
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}
