import { ref, onMounted, onUnmounted } from 'vue';
import type { PeerState } from './usePeers';
import type { TopicWorldSummary } from './useWorldNodes';

export interface CoordinationSignalState {
  mode: string;
  focusLane: string;
  objective: string;
  summary: string;
  reasons: string[];
  laneScores: Record<string, number>;
  priorityBias: Record<string, number>;
  pressure: number;
  confidence: number;
  updatedAt: string;
}

// 兼容旧命名，逐步迁移到 CoordinationSignalState。
export type GovernorState = CoordinationSignalState;

export interface HardwareMetrics {
  cpuUsage: number;
  ramUsage: number;
  ramTotal: number;
  diskFree: number;
  uptime: number;
  platform: string;
  hostname: string;
  cpuModel: string;
  cpuCores: number;
}

export type WorkerHealthStatus = 'live' | 'stale' | 'missing';

export interface WorkerHeartbeatSnapshot {
  worker: string;
  lastSeenAt: string | null;
  ageMs: number | null;
  status: WorkerHealthStatus;
}

export interface WorkerHealthSummary {
  ttlMs: number;
  lifeWorker: WorkerHeartbeatSnapshot;
  workers: WorkerHeartbeatSnapshot[];
}

export interface StatusResponse {
  id: string;
  actorId?: string | null;
  topic?: string;
  mood: string;
  metrics: HardwareMetrics;
  state: PeerState | null;
  world?: TopicWorldSummary | null;
  combat: Record<string, unknown> | null;
  autonomy?: {
    orchestrationMode?: 'advisory';
    contract?: {
      actorAutonomy: 'openclaw-per-actor';
      worldGovernance: 'emergent-social';
      leaderAuthority: 'soft-influence';
      operatorScope: 'local-suggestion-only';
      worldMutationAccess: 'worker-system-only';
      migrationUnit: 'squad';
      primaryMigrationTrigger: 'survival';
    };
    intents?: Array<{
      rank: number;
      lane: string;
      kind: string;
      title: string;
      sourceEventType: string;
      dedupeKey: string;
      basePriority: number;
      finalPriority: number;
      score: number;
      reasons: string[];
    }>;
    workerHealth?: WorkerHealthSummary | null;
  } | null;
  coordination?: CoordinationSignalState | null;
  governor?: GovernorState | null;
  connectedPeers: number;
  knownPeers: number;
  knownActors?: number;
}

const POLL_MS = 5000;

export function useStatus() {
  const status = ref<StatusResponse | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const res = await fetch('/status');
      if (res.ok) {
        status.value = await res.json() as StatusResponse;
      }
    } catch {
    }
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, POLL_MS);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { status, refresh };
}
