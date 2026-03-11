import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';
import { logger } from './logger.js';

export type JobStatus = 'queued' | 'active' | 'done' | 'cancelled';
export type JobKind =
  | 'build'
  | 'trade'
  | 'migrate'
  | 'found_faction'
  | 'join_faction'
  | 'form_alliance'
  | 'renew_alliance'
  | 'break_alliance'
  | 'vassalize_faction'
  | 'declare_peace'
  | 'move'
  | 'collab'
  | 'recover'
  | 'craft';

export type JobPayload = Record<string, unknown>;

type ResourceKey = 'compute' | 'storage' | 'bandwidth' | 'reputation';
type InventoryKey = 'data_shard' | 'alloy_frame' | 'relay_patch';

export interface JobBudgetSnapshot {
  resources?: Partial<Record<ResourceKey, number>>;
  items?: Partial<Record<InventoryKey, number>>;
}

export interface JobsSystemOptions {
  dbPath?: string;
  budgetSnapshot?: () => JobBudgetSnapshot;
  identitySnapshot?: () => { actorId?: string; sessionId?: string };
}

export interface JobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  kind: JobKind;
  title: string;
  reason: string;
  priority: number;
  payload: JobPayload;
  sourceEventType?: string;
  dedupeKey?: string;
  note?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface EnqueueJobInput {
  id?: string;
  kind: JobKind;
  title: string;
  reason: string;
  priority?: number;
  payload?: JobPayload;
  sourceEventType?: string;
  dedupeKey?: string;
}

export interface StartJobInput {
  note?: string;
  payload?: JobPayload;
}

export interface RequeueJobInput {
  note?: string;
  payload?: JobPayload;
}

export interface RetryJobInput {
  note?: string;
  payload?: JobPayload;
}

interface JobRow {
  id: string;
  created_at: string;
  updated_at: string;
  status: JobStatus;
  kind: JobKind;
  title: string;
  reason: string;
  priority: number;
  payload_json: string;
  source_event_type: string | null;
  dedupe_key: string | null;
  note: string | null;
  started_at: string | null;
  completed_at: string | null;
}

function makeJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function toOptional(value: string | null): string | undefined {
  return value ?? undefined;
}

function toPayload(raw: string): JobPayload {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JobPayload
      : {};
  } catch {
    return {};
  }
}

function payloadText(payload: JobPayload, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function payloadStringList(payload: JobPayload, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function laneForPayload(payload: JobPayload): string {
  return payloadText(payload, 'lane');
}

function strategicLaneForPayload(payload: JobPayload): string {
  return payloadText(payload, 'strategicLane');
}

function squadForPayload(payload: JobPayload): string {
  return payloadText(payload, 'responseSquad');
}

function assigneeForPayload(payload: JobPayload): string {
  return payloadText(payload, 'assignee');
}

function leaseOwnerForPayload(payload: JobPayload): string {
  return payloadText(payload, 'leaseOwner');
}

function leaseOwnerActorIdForPayload(payload: JobPayload): string {
  return payloadText(payload, 'leaseOwnerActorId');
}

function normalizeList(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean);
}

const DEFAULT_JOB_HANDOFF_COOLDOWN_MS = Number(process.env.CLAWVERSE_JOB_HANDOFF_COOLDOWN_MS || 45_000);
const DEFAULT_JOB_RETRY_COOLDOWN_MS = Number(process.env.CLAWVERSE_JOB_RETRY_COOLDOWN_MS || 20_000);
const DEFAULT_JOB_LEASE_MS = Number(process.env.CLAWVERSE_JOB_LEASE_MS || 15_000);

interface JobBudgetDemand {
  resources: Partial<Record<ResourceKey, number>>;
  items: Partial<Record<InventoryKey, number>>;
}

interface NormalizedJobBudgetSnapshot {
  resources: Partial<Record<ResourceKey, number>>;
  items: Partial<Record<InventoryKey, number>>;
}

const RESOURCE_KEYS: ResourceKey[] = ['compute', 'storage', 'bandwidth', 'reputation'];
const INVENTORY_KEYS: InventoryKey[] = ['data_shard', 'alloy_frame', 'relay_patch'];

// ?????????? jobs ?????? world/economy ??????
const BUILD_RESOURCE_COST: Record<string, Partial<Record<ResourceKey, number>>> = {
  forge: { compute: 30, storage: 20 },
  archive: { compute: 20, storage: 40 },
  beacon: { compute: 25, storage: 15 },
  market_stall: { compute: 15, storage: 25 },
  shelter: { compute: 20, storage: 30 },
  watchtower: { compute: 35, storage: 25 },
};

const CRAFT_RESOURCE_COST: Record<string, Partial<Record<ResourceKey, number>>> = {
  data_shard: { compute: 12, storage: 8 },
  alloy_frame: { compute: 14, storage: 10 },
  relay_patch: { bandwidth: 10 },
};

const CRAFT_ITEM_COST: Record<string, Partial<Record<InventoryKey, number>>> = {
  data_shard: {},
  alloy_frame: {},
  relay_patch: { data_shard: 1, alloy_frame: 1 },
};

function isResourceKey(value: string): value is ResourceKey {
  return RESOURCE_KEYS.includes(value as ResourceKey);
}

function createBudgetDemand(): JobBudgetDemand {
  return {
    resources: {},
    items: {},
  };
}

function addBudgetValue<T extends string>(
  bucket: Partial<Record<T, number>>,
  key: T,
  amount: number | null | undefined,
): void {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return;
  const safeAmount = Math.max(0, Math.round(amount));
  if (safeAmount <= 0) return;
  bucket[key] = (bucket[key] ?? 0) + safeAmount;
}

function mergeBudgetDemand(target: JobBudgetDemand, addition: JobBudgetDemand): void {
  for (const key of RESOURCE_KEYS) {
    addBudgetValue(target.resources, key, addition.resources[key]);
  }
  for (const key of INVENTORY_KEYS) {
    addBudgetValue(target.items, key, addition.items[key]);
  }
}

function hasBudgetDemand(demand: JobBudgetDemand): boolean {
  return RESOURCE_KEYS.some((key) => (demand.resources[key] ?? 0) > 0)
    || INVENTORY_KEYS.some((key) => (demand.items[key] ?? 0) > 0);
}

function defaultTradeOfferAmount(resource: ResourceKey): number {
  return resource === 'reputation' ? 8 : 10;
}

function budgetDemandFor(kind: JobKind, payload: JobPayload): JobBudgetDemand {
  const demand = createBudgetDemand();

  if (kind === 'build') {
    const buildType = payloadText(payload, 'preferredType') || payloadText(payload, 'type');
    const cost = BUILD_RESOURCE_COST[buildType];
    if (cost) {
      for (const key of RESOURCE_KEYS) {
        addBudgetValue(demand.resources, key, cost[key]);
      }
    }
    return demand;
  }

  if (kind === 'craft') {
    const recipeId = payloadText(payload, 'recipeId');
    const resourceCost = CRAFT_RESOURCE_COST[recipeId];
    const itemCost = CRAFT_ITEM_COST[recipeId];
    if (resourceCost) {
      for (const key of RESOURCE_KEYS) {
        addBudgetValue(demand.resources, key, resourceCost[key]);
      }
    }
    if (itemCost) {
      for (const key of INVENTORY_KEYS) {
        addBudgetValue(demand.items, key, itemCost[key]);
      }
    }
    return demand;
  }

  if (kind === 'trade') {
    const offerResource = payloadText(payload, 'offerResource') || payloadText(payload, 'resource');
    if (isResourceKey(offerResource)) {
      const offerAmount = payloadNumber(payload, 'offerAmount')
        ?? payloadNumber(payload, 'amount')
        ?? defaultTradeOfferAmount(offerResource);
      addBudgetValue(demand.resources, offerResource, offerAmount);
    }
  }

  return demand;
}

function normalizeBudgetSnapshot(snapshot?: JobBudgetSnapshot | null): NormalizedJobBudgetSnapshot {
  const normalized: NormalizedJobBudgetSnapshot = {
    resources: {},
    items: {},
  };

  for (const key of RESOURCE_KEYS) {
    const amount = snapshot?.resources?.[key];
    if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) {
      normalized.resources[key] = Math.round(amount);
    }
  }

  for (const key of INVENTORY_KEYS) {
    const amount = snapshot?.items?.[key];
    if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) {
      normalized.items[key] = Math.round(amount);
    }
  }

  return normalized;
}

function hasBudgetLimits(snapshot: NormalizedJobBudgetSnapshot): boolean {
  return RESOURCE_KEYS.some((key) => snapshot.resources[key] !== undefined)
    || INVENTORY_KEYS.some((key) => snapshot.items[key] !== undefined);
}

function exceedsBudget(snapshot: NormalizedJobBudgetSnapshot, demand: JobBudgetDemand): boolean {
  for (const key of RESOURCE_KEYS) {
    const limit = snapshot.resources[key];
    if (typeof limit === 'number' && (demand.resources[key] ?? 0) > limit) {
      return true;
    }
  }

  for (const key of INVENTORY_KEYS) {
    const limit = snapshot.items[key];
    if (typeof limit === 'number' && (demand.items[key] ?? 0) > limit) {
      return true;
    }
  }

  return false;
}

function payloadNumber(payload: JobPayload, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function payloadIsoTime(payload: JobPayload, key: string): number {
  const value = payload[key];
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function describeProgressHint(startedAt?: string): 'warmup' | 'engaged' | 'entrenched' {
  const startedMs = startedAt ? Date.parse(startedAt) : 0;
  const elapsed = startedMs > 0 ? Date.now() - startedMs : 0;
  if (elapsed >= 90_000) return 'entrenched';
  if (elapsed >= 30_000) return 'engaged';
  return 'warmup';
}

function isRetryCoolingDown(payload: JobPayload): boolean {
  const cooldownUntil = payloadIsoTime(payload, 'retryCooldownUntil');
  return cooldownUntil > Date.now();
}

function describeRetryCooldownMs(retryCount: number): number {
  const multiplier = Math.max(1, Math.min(3, retryCount));
  return DEFAULT_JOB_RETRY_COOLDOWN_MS * multiplier;
}

function isLeaseActive(payload: JobPayload, claimerId = '', claimerActorId = ''): boolean {
  const ownerSessionId = leaseOwnerForPayload(payload);
  const ownerActorId = leaseOwnerActorIdForPayload(payload);
  if (!ownerSessionId && !ownerActorId) return false;
  const claimedSessionId = claimerId.trim();
  const claimedActorId = claimerActorId.trim();
  const sameActor = !!claimedActorId && !!ownerActorId && ownerActorId === claimedActorId;
  const sameSession = !!claimedSessionId && !!ownerSessionId && ownerSessionId === claimedSessionId;
  if (sameActor || sameSession) return false;
  const leaseExpiresAt = payloadIsoTime(payload, 'leaseExpiresAt');
  if (leaseExpiresAt <= Date.now()) return false;
  return true;
}

function releaseLeasePayload(payload: JobPayload): JobPayload {
  return {
    ...payload,
    leaseOwner: null,
    leaseOwnerActorId: null,
    leaseClaimedAt: null,
    leaseExpiresAt: null,
    leaseState: 'released',
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function reservationZone(payload: JobPayload): string {
  return payloadText(payload, 'preferredZone')
    || payloadText(payload, 'targetZone')
    || payloadText(payload, 'zone')
    || laneForPayload(payload)
    || 'global';
}

function reservationKeysFor(kind: JobKind, payload: JobPayload): string[] {
  const keys = [...payloadStringList(payload, 'reservationKeys')];
  const x = payloadNumber(payload, 'x');
  const y = payloadNumber(payload, 'y');
  if (x !== null && y !== null) {
    keys.push(`tile:${Math.round(x)}:${Math.round(y)}`);
  }

  if (kind === 'build') {
    const buildType = payloadText(payload, 'preferredType') || payloadText(payload, 'type');
    if (buildType) {
      keys.push(`build:${buildType}:${reservationZone(payload)}`);
    }
  }

  if (kind === 'craft') {
    const recipeId = payloadText(payload, 'recipeId');
    if (recipeId) {
      keys.push(`craft:${recipeId}`);
    }
  }

  if (kind === 'trade') {
    const zone = reservationZone(payload);
    const wantResource = payloadText(payload, 'wantResource') || payloadText(payload, 'resourceWant');
    const offerResource = payloadText(payload, 'offerResource') || payloadText(payload, 'resource');
    const peerId = payloadText(payload, 'toId');
    if (wantResource) {
      keys.push(`trade:want:${zone}:${wantResource}`);
    }
    if (offerResource) {
      keys.push(`trade:offer:${zone}:${offerResource}`);
    }
    if (peerId) {
      keys.push(`trade:peer:${peerId}`);
    }
  }

  if (kind === 'join_faction') {
    const factionId = payloadText(payload, 'factionId');
    if (factionId) {
      keys.push(`faction:join:${factionId}`);
    }
  }

  if (kind === 'form_alliance') {
    const factionId = payloadText(payload, 'factionId');
    if (factionId) {
      keys.push(`faction:alliance:${factionId}`);
    }
  }

  if (kind === 'renew_alliance') {
    const allianceId = payloadText(payload, 'allianceId');
    if (allianceId) {
      keys.push(`alliance:renew:${allianceId}`);
    }
  }

  if (kind === 'break_alliance') {
    const allianceId = payloadText(payload, 'allianceId');
    if (allianceId) {
      keys.push(`alliance:break:${allianceId}`);
    }
  }

  if (kind === 'vassalize_faction') {
    const factionId = payloadText(payload, 'factionId');
    if (factionId) {
      keys.push(`faction:vassalize:${factionId}`);
    }
  }

  if (kind === 'declare_peace') {
    const warId = payloadText(payload, 'warId');
    if (warId) {
      keys.push(`war:peace:${warId}`);
    }
  }

  if (kind === 'migrate') {
    const toTopic = payloadText(payload, 'toTopic') || payloadText(payload, 'targetTopic');
    if (toTopic) {
      keys.push(`migration:topic:${toTopic}`);
    }
  }

  return uniqueStrings(keys);
}

function withDerivedReservationKeys(kind: JobKind, payload: JobPayload): JobPayload {
  const reservationKeys = reservationKeysFor(kind, payload);
  if (reservationKeys.length === 0) {
    return payload;
  }
  return {
    ...payload,
    reservationKeys,
  };
}

export class JobsQueue {
  private readonly dbHandle: ClawverseDbHandle;
  private readonly budgetSnapshot?: () => JobBudgetSnapshot;
  private readonly identitySnapshot?: () => { actorId?: string; sessionId?: string };

  constructor(opts?: JobsSystemOptions) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this.budgetSnapshot = opts?.budgetSnapshot;
    this.identitySnapshot = opts?.identitySnapshot;
  }

  listJobs(limit = 24): JobRecord[] {
    const safeLimit = Math.max(1, Math.min(100, Math.round(limit)));
    const rows = this.dbHandle.db.prepare(`
      SELECT id, created_at, updated_at, status, kind, title, reason, priority,
             payload_json, source_event_type, dedupe_key, note, started_at, completed_at
      FROM jobs_queue
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'queued' THEN 1
          WHEN 'done' THEN 2
          ELSE 3
        END,
        priority DESC,
        created_at DESC
      LIMIT ?
    `).all(safeLimit) as unknown as JobRow[];
    return rows.map((row) => this.mapRow(row));
  }

  getJob(id: string): JobRecord | null {
    const row = this.dbHandle.db.prepare(`
      SELECT id, created_at, updated_at, status, kind, title, reason, priority,
             payload_json, source_event_type, dedupe_key, note, started_at, completed_at
      FROM jobs_queue
      WHERE id = ?
    `).get(id) as JobRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getNextQueuedJob(
    preferredAssignees: string[] = [],
    excludedIds: string[] = [],
    claimerId = '',
    claimerActorId = '',
    preferredStrategicLanes: string[] = [],
  ): JobRecord | null {
    const normalizedAssignees = normalizeList(preferredAssignees);
    const skippedIds = new Set(normalizeList(excludedIds));
    const claimer = claimerId.trim();
    const claimerActor = claimerActorId.trim();
    const desiredStrategicLanes = uniqueStrings(normalizeList(preferredStrategicLanes));
    const rows = this.dbHandle.db.prepare(`
      SELECT id, created_at, updated_at, status, kind, title, reason, priority,
             payload_json, source_event_type, dedupe_key, note, started_at, completed_at
      FROM jobs_queue
      WHERE status = 'queued'
      ORDER BY priority DESC, created_at ASC
      LIMIT 32
    `).all() as unknown as JobRow[];

    const claimableJobs = rows
      .map((row) => this.mapRow(row))
      .filter((job) => !skippedIds.has(job.id))
      .filter((job) => !this.hasLaneConflict(job.payload, job.id))
      .filter((job) => !this.hasReservationConflict(job.kind, job.payload, job.id))
      .filter((job) => !this.hasBudgetConflict(job.kind, job.payload, job.id))
      .filter((job) => !isRetryCoolingDown(job.payload))
      .filter((job) => !isLeaseActive(job.payload, claimer, claimerActor));

    const assigneePrioritizedJobs = normalizedAssignees.length > 0
      ? [
          ...claimableJobs.filter((job) => normalizedAssignees.includes(assigneeForPayload(job.payload))),
          ...claimableJobs.filter((job) => !normalizedAssignees.includes(assigneeForPayload(job.payload))),
        ]
      : claimableJobs;

    const prioritizedJobs = desiredStrategicLanes.length > 0
      ? [
          ...desiredStrategicLanes.flatMap((lane) =>
            assigneePrioritizedJobs.filter((job) => strategicLaneForPayload(job.payload) === lane)
          ),
          ...assigneePrioritizedJobs.filter((job) => !desiredStrategicLanes.includes(strategicLaneForPayload(job.payload))),
        ]
      : assigneePrioritizedJobs;

    if (!claimer && !claimerActor) {
      return prioritizedJobs[0] ?? null;
    }

    for (const job of prioritizedJobs) {
      const leased = this.leaseQueuedJob(job.id, claimer, DEFAULT_JOB_LEASE_MS, claimerActor);
      if (leased) return leased;
    }

    return null;
  }

  leaseQueuedJob(id: string, claimerId: string, leaseMs = DEFAULT_JOB_LEASE_MS, claimerActorId = ''): JobRecord | null {
    const claimer = claimerId.trim();
    const claimerActor = claimerActorId.trim();
    if (!claimer && !claimerActor) return null;

    const row = this.dbHandle.db.prepare(`
      SELECT id, created_at, updated_at, status, kind, title, reason, priority,
             payload_json, source_event_type, dedupe_key, note, started_at, completed_at
      FROM jobs_queue
      WHERE id = ?
    `).get(id) as JobRow | undefined;
    if (!row || row.status !== 'queued') {
      return null;
    }

    const existing = this.mapRow(row);
    if (isRetryCoolingDown(existing.payload)) {
      return null;
    }
    if (this.hasLaneConflict(existing.payload, id)) {
      return null;
    }
    if (this.hasReservationConflict(existing.kind, existing.payload, id)) {
      return null;
    }
    if (this.hasBudgetConflict(existing.kind, existing.payload, id)) {
      return null;
    }
    if (isLeaseActive(existing.payload, claimer, claimerActor)) {
      return null;
    }

    const now = new Date().toISOString();
    const payload = withDerivedReservationKeys(existing.kind, {
      ...existing.payload,
      leaseOwner: claimer || leaseOwnerForPayload(existing.payload) || null,
      leaseOwnerActorId: claimerActor || leaseOwnerActorIdForPayload(existing.payload) || null,
      leaseClaimedAt: now,
      leaseExpiresAt: new Date(Date.now() + Math.max(1_000, leaseMs)).toISOString(),
      leaseState: 'queued',
    });
    const result = this.dbHandle.db.prepare(`
      UPDATE jobs_queue
      SET updated_at = ?,
          payload_json = ?
      WHERE id = ? AND status = 'queued' AND payload_json = ?
    `).run(now, JSON.stringify(payload), id, row.payload_json);
    if ((result.changes ?? 0) === 0) {
      return null;
    }
    logger.info(`[jobs] Leased ${id} -> ${claimerActor || claimer}`);
    return this.getJob(id);
  }

  enqueueJob(input: EnqueueJobInput): JobRecord {
    if (input.dedupeKey) {
      const existing = this.getOpenJobByDedupeKey(input.dedupeKey);
      if (existing) {
        if (existing.status === 'queued') {
          const nextPriority = typeof input.priority === 'number' && Number.isFinite(input.priority)
            ? Math.max(0, Math.min(100, Math.round(input.priority)))
            : existing.priority;
          const nextPayload = withDerivedReservationKeys(existing.kind, {
            ...existing.payload,
            ...(input.payload ?? {}),
          });
          const result = this.dbHandle.db.prepare(`
            UPDATE jobs_queue
            SET updated_at = ?,
                title = ?,
                reason = ?,
                priority = ?,
                payload_json = ?,
                source_event_type = ?
            WHERE id = ? AND status = 'queued'
          `).run(
            new Date().toISOString(),
            input.title,
            input.reason,
            nextPriority,
            JSON.stringify(nextPayload),
            input.sourceEventType ?? null,
            existing.id,
          );
          if ((result.changes ?? 0) > 0) {
            logger.info(`[jobs] Refreshed ${existing.id} (${nextPriority}) ${input.title}`);
            return this.getJob(existing.id) ?? existing;
          }
        }
        return existing;
      }
    }

    const now = new Date().toISOString();
    const identity = this.identitySnapshot?.() ?? {};
    const ownerActorId = payloadText(input.payload ?? {}, 'ownerActorId') || (typeof identity.actorId === 'string' ? identity.actorId.trim() : '');
    const ownerSessionId = payloadText(input.payload ?? {}, 'ownerSessionId') || (typeof identity.sessionId === 'string' ? identity.sessionId.trim() : '');
    const job: JobRecord = {
      id: input.id ?? makeJobId(),
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      kind: input.kind,
      title: input.title,
      reason: input.reason,
      priority: typeof input.priority === 'number' && Number.isFinite(input.priority)
        ? Math.max(0, Math.min(100, Math.round(input.priority)))
        : 50,
      payload: withDerivedReservationKeys(input.kind, {
        ...(input.payload ?? {}),
        ...(ownerActorId ? { ownerActorId } : {}),
        ...(ownerSessionId ? { ownerSessionId } : {}),
      }),
      sourceEventType: input.sourceEventType,
      dedupeKey: input.dedupeKey,
    };

    this.dbHandle.db.prepare(`
      INSERT INTO jobs_queue (
        id, created_at, updated_at, status, kind, title, reason, priority,
        payload_json, source_event_type, dedupe_key, note, started_at, completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
    `).run(
      job.id,
      job.createdAt,
      job.updatedAt,
      job.status,
      job.kind,
      job.title,
      job.reason,
      job.priority,
      JSON.stringify(job.payload),
      job.sourceEventType ?? null,
      job.dedupeKey ?? null,
    );

    logger.info(`[jobs] Enqueued ${job.kind} (${job.priority}) ${job.title}`);
    return job;
  }

  startJob(id: string, input?: StartJobInput): JobRecord | null {
    const existing = this.getJob(id);
    if (!existing || existing.status !== 'queued') {
      return null;
    }

    const claimerId = payloadText(input?.payload ?? {}, 'executorId');
    const claimerSessionId = payloadText(input?.payload ?? {}, 'executorSessionId') || claimerId;
    const claimerActorId = payloadText(input?.payload ?? {}, 'executorActorId');
    const now = new Date().toISOString();
    const payload = withDerivedReservationKeys(existing.kind, {
      ...existing.payload,
      ...(input?.payload ?? {}),
      ownerActorId: payloadText(input?.payload ?? {}, 'ownerActorId') || payloadText(existing.payload, 'ownerActorId') || null,
      ownerSessionId: payloadText(input?.payload ?? {}, 'ownerSessionId') || payloadText(existing.payload, 'ownerSessionId') || null,
      executorId: claimerId || payloadText(existing.payload, 'executorId') || payloadText(existing.payload, 'executorSessionId') || null,
      executorSessionId: claimerSessionId || payloadText(existing.payload, 'executorSessionId') || payloadText(existing.payload, 'executorId') || null,
      executorActorId: claimerActorId || payloadText(existing.payload, 'executorActorId') || null,
      leaseOwner: claimerSessionId || leaseOwnerForPayload(existing.payload) || null,
      leaseOwnerActorId: claimerActorId || leaseOwnerActorIdForPayload(existing.payload) || null,
      leaseClaimedAt: payloadText(existing.payload, 'leaseClaimedAt') || now,
      leaseExpiresAt: null,
      leaseState: (claimerSessionId || claimerActorId) ? 'claimed' : payloadText(existing.payload, 'leaseState') || 'claimed',
      handoffState: (payloadNumber(existing.payload, 'handoffCount') ?? 0) > 0 ? 'active' : payloadText(existing.payload, 'handoffState') || 'active',
      handoffClaimedAt: now,
      retryState: (payloadNumber(existing.payload, 'retryCount') ?? 0) > 0 ? 'active' : payloadText(existing.payload, 'retryState') || 'active',
      retryClaimedAt: (payloadNumber(existing.payload, 'retryCount') ?? 0) > 0 ? now : payloadText(existing.payload, 'retryClaimedAt') || now,
    });
    if (isRetryCoolingDown(existing.payload)) {
      logger.info(`[jobs] Deferred ${id} because retry cooldown is still active`);
      return null;
    }
    if (isLeaseActive(existing.payload, claimerSessionId, claimerActorId)) {
      logger.info(`[jobs] Deferred ${id} because queued lease is held by ${leaseOwnerActorIdForPayload(existing.payload) || leaseOwnerForPayload(existing.payload)}`);
      return null;
    }
    if (this.hasLaneConflict(payload, id)) {
      logger.info(`[jobs] Deferred ${id} because lane ${laneForPayload(payload)} is already reserved`);
      return null;
    }
    if (this.hasReservationConflict(existing.kind, payload, id)) {
      logger.info(`[jobs] Deferred ${id} because reservation keys are already reserved`);
      return null;
    }
    if (this.hasBudgetConflict(existing.kind, payload, id)) {
      logger.info(`[jobs] Deferred ${id} because resource budget is already reserved`);
      return null;
    }

    const result = this.dbHandle.db.prepare(`
      UPDATE jobs_queue
      SET status = 'active',
          updated_at = ?,
          started_at = COALESCE(started_at, ?),
          note = COALESCE(?, note),
          payload_json = ?
      WHERE id = ? AND status = 'queued'
    `).run(now, now, input?.note ?? null, JSON.stringify(payload), id);
    if ((result.changes ?? 0) === 0) {
      return null;
    }
    logger.info(`[jobs] Started ${id}`);
    return this.getJob(id);
  }

  requeueActiveJob(id: string, input?: RequeueJobInput): JobRecord | null {
    const existing = this.getJob(id);
    if (!existing || existing.status !== 'active') {
      return null;
    }

    const now = new Date().toISOString();
    const nextHandoffCount = (payloadNumber(existing.payload, 'handoffCount') ?? 0) + 1;
    const cooldownUntil = new Date(Date.now() + DEFAULT_JOB_HANDOFF_COOLDOWN_MS).toISOString();
    const payload = releaseLeasePayload(withDerivedReservationKeys(existing.kind, {
      ...existing.payload,
      ...(input?.payload ?? {}),
      handoffCount: nextHandoffCount,
      handoffState: 'queued',
      lastHandoffAt: now,
      handoffCooldownUntil: cooldownUntil,
      progressHint: describeProgressHint(existing.startedAt),
    }));
    const result = this.dbHandle.db.prepare(`
      UPDATE jobs_queue
      SET status = 'queued',
          updated_at = ?,
          started_at = NULL,
          note = COALESCE(?, note),
          payload_json = ?
      WHERE id = ? AND status = 'active'
    `).run(now, input?.note ?? null, JSON.stringify(payload), id);
    if ((result.changes ?? 0) === 0) {
      return null;
    }
    logger.info(`[jobs] Requeued ${id}`);
    return this.getJob(id);
  }

  retryActiveJob(id: string, input?: RetryJobInput): JobRecord | null {
    const existing = this.getJob(id);
    if (!existing || existing.status !== 'active') {
      return null;
    }

    const now = new Date().toISOString();
    const nextRetryCount = (payloadNumber(existing.payload, 'retryCount') ?? 0) + 1;
    const retryCooldownUntil = new Date(Date.now() + describeRetryCooldownMs(nextRetryCount)).toISOString();
    const payload = releaseLeasePayload(withDerivedReservationKeys(existing.kind, {
      ...existing.payload,
      ...(input?.payload ?? {}),
      retryCount: nextRetryCount,
      retryState: 'queued',
      lastRetryAt: now,
      retryCooldownUntil,
      progressHint: describeProgressHint(existing.startedAt),
    }));
    const result = this.dbHandle.db.prepare(`
      UPDATE jobs_queue
      SET status = 'queued',
          updated_at = ?,
          started_at = NULL,
          note = COALESCE(?, note),
          payload_json = ?
      WHERE id = ? AND status = 'active'
    `).run(now, input?.note ?? null, JSON.stringify(payload), id);
    if ((result.changes ?? 0) === 0) {
      return null;
    }
    logger.info(`[jobs] Retrying ${id}`);
    return this.getJob(id);
  }

  completeJob(id: string, note?: string): JobRecord | null {
    const now = new Date().toISOString();
    const result = this.dbHandle.db.prepare(`
      UPDATE jobs_queue
      SET status = 'done', updated_at = ?, completed_at = ?, note = COALESCE(?, note)
      WHERE id = ? AND status = 'active'
    `).run(now, now, note ?? null, id);
    if ((result.changes ?? 0) === 0) {
      return null;
    }
    logger.info(`[jobs] Completed ${id}`);
    return this.getJob(id);
  }

  cancelJob(id: string, note?: string): JobRecord | null {
    const now = new Date().toISOString();
    const result = this.dbHandle.db.prepare(`
      UPDATE jobs_queue
      SET status = 'cancelled', updated_at = ?, completed_at = COALESCE(completed_at, ?), note = COALESCE(?, note)
      WHERE id = ? AND status IN ('queued', 'active')
    `).run(now, now, note ?? null, id);
    if ((result.changes ?? 0) === 0) {
      return null;
    }
    logger.info(`[jobs] Cancelled ${id}`);
    return this.getJob(id);
  }

  cancelQueuedByDedupeKey(dedupeKey: string, note?: string): number {
    const now = new Date().toISOString();
    const result = this.dbHandle.db.prepare(`
      UPDATE jobs_queue
      SET status = 'cancelled', updated_at = ?, completed_at = ?, note = COALESCE(?, note)
      WHERE dedupe_key = ? AND status = 'queued'
    `).run(now, now, note ?? null, dedupeKey);
    return Number(result.changes ?? 0);
  }

  async destroy(): Promise<void> {
    this.dbHandle.close();
  }

  private hasLaneConflict(payload: JobPayload, excludeId?: string): boolean {
    const lane = laneForPayload(payload);
    if (!lane) return false;

    const squad = squadForPayload(payload);
    const activeJobs = this.listBlockingJobs();
    return activeJobs.some((job) => {
      if (excludeId && job.id === excludeId) return false;
      const activeLane = laneForPayload(job.payload);
      if (!activeLane || activeLane !== lane) return false;

      const activeSquad = squadForPayload(job.payload);
      if (!squad && !activeSquad) return true;
      return squad === activeSquad;
    });
  }

  private hasReservationConflict(kind: JobKind, payload: JobPayload, excludeId?: string): boolean {
    const targetKeys = reservationKeysFor(kind, payload);
    if (targetKeys.length === 0) return false;
    const targetSet = new Set(targetKeys);
    return this.listBlockingJobs().some((job) => {
      if (excludeId && job.id === excludeId) return false;
      const blockingKeys = reservationKeysFor(job.kind, job.payload);
      return blockingKeys.some((key) => targetSet.has(key));
    });
  }

  private hasBudgetConflict(kind: JobKind, payload: JobPayload, excludeId?: string): boolean {
    const snapshot = this.readBudgetSnapshot();
    if (!snapshot) return false;

    const reserved = createBudgetDemand();
    for (const job of this.listBlockingJobs()) {
      if (excludeId && job.id === excludeId) continue;
      mergeBudgetDemand(reserved, budgetDemandFor(job.kind, job.payload));
    }

    const candidateDemand = budgetDemandFor(kind, payload);
    if (!hasBudgetDemand(candidateDemand)) {
      return false;
    }
    mergeBudgetDemand(reserved, candidateDemand);
    return exceedsBudget(snapshot, reserved);
  }

  private readBudgetSnapshot(): NormalizedJobBudgetSnapshot | null {
    if (!this.budgetSnapshot) return null;
    try {
      const snapshot = normalizeBudgetSnapshot(this.budgetSnapshot());
      return hasBudgetLimits(snapshot) ? snapshot : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[jobs] Failed to read budget snapshot: ${message}`);
      return null;
    }
  }

  private listBlockingJobs(): JobRecord[] {
    const rows = this.dbHandle.db.prepare(`
      SELECT id, created_at, updated_at, status, kind, title, reason, priority,
             payload_json, source_event_type, dedupe_key, note, started_at, completed_at
      FROM jobs_queue
      WHERE status IN ('active', 'queued')
      ORDER BY priority DESC, created_at ASC
    `).all() as unknown as JobRow[];
    return rows
      .map((row) => this.mapRow(row))
      .filter((job) => job.status === 'active' || isLeaseActive(job.payload));
  }

  private listActiveJobs(): JobRecord[] {
    const rows = this.dbHandle.db.prepare(`
      SELECT id, created_at, updated_at, status, kind, title, reason, priority,
             payload_json, source_event_type, dedupe_key, note, started_at, completed_at
      FROM jobs_queue
      WHERE status = 'active'
      ORDER BY priority DESC, created_at ASC
    `).all() as unknown as JobRow[];
    return rows.map((row) => this.mapRow(row));
  }

  private getOpenJobByDedupeKey(dedupeKey: string): JobRecord | null {
    const row = this.dbHandle.db.prepare(`
      SELECT id, created_at, updated_at, status, kind, title, reason, priority,
             payload_json, source_event_type, dedupe_key, note, started_at, completed_at
      FROM jobs_queue
      WHERE dedupe_key = ? AND status IN ('queued', 'active')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(dedupeKey) as JobRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: JobRow): JobRecord {
    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
      kind: row.kind,
      title: row.title,
      reason: row.reason,
      priority: row.priority,
      payload: toPayload(row.payload_json),
      sourceEventType: toOptional(row.source_event_type),
      dedupeKey: toOptional(row.dedupe_key),
      note: toOptional(row.note),
      startedAt: toOptional(row.started_at),
      completedAt: toOptional(row.completed_at),
    };
  }
}

export { JobsQueue as JobsSystem };
