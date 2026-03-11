import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

export type BrainGuidanceKind = 'note' | 'move';
export type BrainGuidanceStatus = 'active' | 'consumed' | 'dismissed' | 'expired';

export interface BrainGuidanceRecord {
  id: string;
  kind: BrainGuidanceKind;
  message: string;
  payload: Record<string, unknown> | null;
  status: BrainGuidanceStatus;
  source: 'operator' | 'system';
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export class BrainGuidanceRegistry {
  private readonly dbHandle: ClawverseDbHandle;
  private readonly entries = new Map<string, BrainGuidanceRecord>();

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._load();
  }

  listActive(limit = 12, nowMs = Date.now()): BrainGuidanceRecord[] {
    const active: BrainGuidanceRecord[] = [];
    for (const entry of this.entries.values()) {
      const normalized = normalizeEntry(entry);
      if (normalized.status !== 'active') continue;
      if (isExpired(normalized, nowMs)) continue;
      active.push(normalized);
    }

    return active
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, Math.max(1, limit))
      .map((entry) => ({ ...entry, payload: entry.payload ? { ...entry.payload } : null }));
  }

  get(id: string): BrainGuidanceRecord | null {
    const entry = this.entries.get(id.trim());
    return entry ? { ...entry, payload: entry.payload ? { ...entry.payload } : null } : null;
  }

  create(input: {
    kind: BrainGuidanceKind;
    message: string;
    payload?: Record<string, unknown> | null;
    ttlMs?: number | null;
    source?: BrainGuidanceRecord['source'];
    nowMs?: number;
  }): BrainGuidanceRecord {
    const kind: BrainGuidanceKind = input.kind;
    const message = input.message.trim().slice(0, 400);
    const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const ttlMs = normalizeTtlMs(kind, input.ttlMs);
    const expiresAt = ttlMs > 0 ? new Date(nowMs + ttlMs).toISOString() : null;

    const record: BrainGuidanceRecord = {
      id: `guide-${nowMs}-${Math.random().toString(16).slice(2, 8)}`,
      kind,
      message,
      payload: input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
        ? { ...input.payload }
        : null,
      status: 'active',
      source: input.source ?? 'operator',
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt,
    };

    this.entries.set(record.id, record);
    this._save(record);
    return { ...record, payload: record.payload ? { ...record.payload } : null };
  }

  consume(id: string, nowMs = Date.now()): BrainGuidanceRecord | null {
    return this._setStatus(id, 'consumed', nowMs);
  }

  dismiss(id: string, nowMs = Date.now()): BrainGuidanceRecord | null {
    return this._setStatus(id, 'dismissed', nowMs);
  }

  pruneExpired(nowMs = Date.now()): string[] {
    const expired: string[] = [];
    for (const entry of this.entries.values()) {
      const normalized = normalizeEntry(entry);
      if (normalized.status !== 'active') continue;
      if (!isExpired(normalized, nowMs)) continue;
      const updated = { ...normalized, status: 'expired' as const, updatedAt: new Date(nowMs).toISOString() };
      this.entries.set(updated.id, updated);
      this._save(updated);
      expired.push(updated.id);
    }
    return expired;
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private _load(): void {
    const rows = this.dbHandle.db.prepare(`
      SELECT id, status, updated_at, payload_json
      FROM brain_guidance
    `).all() as Array<{ id: string; status: string; updated_at: string; payload_json: string }>;

    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload_json) as Partial<BrainGuidanceRecord>;
        const id = typeof payload.id === 'string' && payload.id.trim().length > 0
          ? payload.id.trim()
          : row.id.trim();
        if (!id) continue;
        const kind = payload.kind === 'move' ? 'move' : 'note';
        const status = payload.status === 'active'
          || payload.status === 'consumed'
          || payload.status === 'dismissed'
          || payload.status === 'expired'
          ? payload.status
          : (row.status === 'active' || row.status === 'consumed' || row.status === 'dismissed' || row.status === 'expired'
              ? row.status
              : 'active');
        const createdAt = typeof payload.createdAt === 'string' && payload.createdAt.trim().length > 0
          ? payload.createdAt
          : row.updated_at;
        const updatedAt = typeof payload.updatedAt === 'string' && payload.updatedAt.trim().length > 0
          ? payload.updatedAt
          : row.updated_at;
        const expiresAt = typeof payload.expiresAt === 'string' && payload.expiresAt.trim().length > 0
          ? payload.expiresAt
          : null;
        const message = typeof payload.message === 'string' ? payload.message.trim().slice(0, 400) : '';
        if (!message) continue;
        const source = payload.source === 'system' ? 'system' : 'operator';
        const rawPayload = payload.payload && typeof payload.payload === 'object' && !Array.isArray(payload.payload)
          ? payload.payload as Record<string, unknown>
          : null;

        this.entries.set(id, {
          id,
          kind,
          message,
          payload: rawPayload ? { ...rawPayload } : null,
          status,
          source,
          createdAt,
          updatedAt,
          expiresAt,
        });
      } catch {
        // ignore malformed guidance payloads
      }
    }
  }

  private _setStatus(id: string, status: Exclude<BrainGuidanceStatus, 'expired'>, nowMs: number): BrainGuidanceRecord | null {
    const trimmed = id.trim();
    if (!trimmed) return null;
    const existing = this.entries.get(trimmed);
    if (!existing) return null;
    const normalized = normalizeEntry(existing);
    const updated: BrainGuidanceRecord = {
      ...normalized,
      status,
      updatedAt: new Date(nowMs).toISOString(),
    };
    this.entries.set(trimmed, updated);
    this._save(updated);
    return { ...updated, payload: updated.payload ? { ...updated.payload } : null };
  }

  private _save(record: BrainGuidanceRecord): void {
    this.dbHandle.db.prepare(`
      INSERT INTO brain_guidance (id, status, updated_at, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      record.id,
      record.status,
      record.updatedAt,
      JSON.stringify(record),
    );
  }
}

function normalizeEntry(entry: BrainGuidanceRecord): BrainGuidanceRecord {
  return {
    ...entry,
    id: entry.id.trim(),
    message: entry.message.trim().slice(0, 400),
    payload: entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
      ? entry.payload
      : null,
  };
}

function normalizeTtlMs(kind: BrainGuidanceKind, ttlMs: number | null | undefined): number {
  if (typeof ttlMs === 'number' && Number.isFinite(ttlMs)) {
    if (ttlMs <= 0) return 0;
    return clamp(Math.round(ttlMs), 30_000, 24 * 60 * 60_000);
  }
  const defaultTtl = kind === 'move' ? 10 * 60_000 : 30 * 60_000;
  return defaultTtl;
}

function isExpired(entry: BrainGuidanceRecord, nowMs: number): boolean {
  if (!entry.expiresAt) return false;
  const parsed = Date.parse(entry.expiresAt);
  if (!Number.isFinite(parsed)) return false;
  return nowMs >= parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

