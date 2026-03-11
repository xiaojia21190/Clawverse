<template>
  <section class="ring-panel">
    <div class="ring-header">
      <div>
        <div class="ring-kicker">Ring Registry</div>
        <div class="ring-title">Topic Shells</div>
      </div>
      <div class="ring-mode" :class="modeTone">{{ ringModeLabel }}</div>
    </div>

    <div class="ring-summary">
      <article class="ring-stat-card">
        <span>Tracked Topics</span>
        <strong>{{ trackedTopicCount }}</strong>
      </article>
      <article class="ring-stat-card">
        <span>Active Topic</span>
        <strong>{{ activeTopicLabel }}</strong>
      </article>
      <article class="ring-stat-card">
        <span>Active Slot</span>
        <strong>{{ currentIndexLabel }}</strong>
      </article>
    </div>

    <div class="ring-copy">{{ ringCopy }}</div>

    <div v-if="workerRows.length" class="ring-worker-block">
      <div class="ring-worker-topline">
        <div class="ring-section-label">Worker Lanes</div>
        <button
          class="ring-filter-btn"
          type="button"
          :class="{ active: showOnlyAnomalies }"
          @click="toggleWorkerFilter"
        >
          {{ workerFilterLabel }}
        </button>
      </div>
      <div class="ring-worker-header">
        <span>TTL {{ workerTtlLabel }}</span>
        <span class="ring-peer-pill" :class="lifeWorkerToneClass">life-worker {{ lifeWorkerStatusLabel }}</span>
      </div>
      <div class="ring-worker-copy">
        Life worker age {{ lifeWorkerAgeLabel }} ·
        <span
          :title="lifeWorkerRecoveredTitle"
          :class="{ 'ring-recovered-fresh': lifeWorkerRecoveredFresh }"
        >
          recovered {{ lifeWorkerRecoveredLabel }}
        </span> ·
        anomalies {{ anomalyWorkerCount }} / {{ workerRows.length }}
      </div>
      <div v-if="visibleWorkerRows.length" class="ring-peer-list">
        <article
          v-for="worker in visibleWorkerRows"
          :key="worker.worker"
          class="ring-peer-card"
        >
          <div class="ring-peer-topline">
            <span class="ring-peer-name">{{ worker.worker }}</span>
            <span class="ring-peer-pill" :class="worker.statusClass">{{ worker.statusLabel }}</span>
          </div>
          <div class="ring-peer-meta">
            <span>age {{ worker.ageLabel }}</span>
            <span>seen {{ worker.lastSeenLabel }}</span>
            <span
              :title="worker.recoveredTitle"
              :class="{ 'ring-recovered-fresh': worker.recoveredFresh }"
            >
              recovered {{ worker.recoveredLabel }}
            </span>
          </div>
        </article>
      </div>
      <div v-else class="ring-worker-empty">No stale or missing worker lanes.</div>
    </div>

    <div v-if="discoveredPeers.length" class="ring-peer-list">
      <article
        v-for="peer in discoveredPeers"
        :key="peer.topic"
        class="ring-peer-card"
      >
        <div class="ring-peer-topline">
          <span class="ring-peer-name">{{ peer.topic }}</span>
          <span class="ring-peer-pill" :class="peer.health">{{ peer.health }}</span>
        </div>
        <div class="ring-peer-meta">
          <span>{{ peer.source }}</span>
          <span>{{ peer.baseUrl }}</span>
          <span>{{ formatTime(peer.updatedAt) }}</span>
        </div>
      </article>
    </div>

    <div v-if="refugeeSquads.length" class="ring-peer-list">
      <article
        v-for="squad in refugeeSquads"
        :key="squad.id"
        class="ring-peer-card"
      >
        <div class="ring-peer-topline">
          <span class="ring-peer-name">{{ squad.toTopic }}</span>
          <span class="ring-peer-pill" :class="squad.status === 'staged' ? 'live' : 'stale'">{{ squad.status }}</span>
        </div>
        <div class="ring-peer-meta">
          <span>{{ squad.fromTopic }} -> {{ squad.toTopic }}</span>
          <span>{{ squad.actorCount }} actors</span>
          <span>Urgency {{ squad.urgency }}</span>
          <span>{{ squad.triggerEventType }}</span>
          <span>{{ formatTime(squad.updatedAt) }}</span>
        </div>
        <div class="ring-copy">{{ squad.summary }}</div>
      </article>
    </div>

    <div class="ring-shell-list">
      <article
        v-for="shell in shells"
        :key="shell.topic"
        class="ring-shell-card"
        :class="{ active: shell.active }"
      >
        <div class="ring-shell-topline">
          <span class="ring-shell-name">{{ shell.topic }}</span>
          <span
            class="ring-shell-state"
            :class="shell.active ? 'active' : shell.status === 'mirrored' ? 'mirrored' : 'standby'"
          >{{ shell.status }}</span>
        </div>
        <div class="ring-shell-meta">
          <span>Big {{ shell.actorCount }}</span>
          <span>Small {{ shell.branchCount }}</span>
          <span>Governance {{ shellBrainLabel(shell.brainStatus) }}</span>
          <span>{{ shell.source ?? 'none' }}</span>
          <span>{{ formatTime(shell.updatedAt) }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { RingWorldSummary } from '../composables/useWorldNodes';
import type { RefugeeSquadRecord, RingPeerRecord } from '../composables/useRingWorld';
import type {
  WorkerHeartbeatSnapshot,
  WorkerHealthStatus,
  WorkerHealthSummary,
} from '../composables/useStatus';

interface WorkerRowBase {
  worker: string;
  statusClass: WorkerHealthStatus;
  ageMs: number | null;
  lastSeenAt: string | null;
}

interface WorkerRowView {
  worker: string;
  statusClass: WorkerHealthStatus;
  statusLabel: string;
  ageLabel: string;
  lastSeenLabel: string;
  recoveredLabel: string;
  recoveredTitle: string;
  recoveredFresh: boolean;
}

const props = defineProps<{
  ring?: RingWorldSummary | null;
  topic?: string | null;
  peers?: RingPeerRecord[];
  refugeeSquads?: RefugeeSquadRecord[];
  workerHealth?: WorkerHealthSummary | null;
}>();

const ring = computed(() => props.ring ?? null);
const shells = computed(() => ring.value?.shells ?? []);
const discoveredPeers = computed(() => Array.isArray(props.peers) ? props.peers : []);
const refugeeSquads = computed(() => Array.isArray(props.refugeeSquads) ? props.refugeeSquads : []);
const workerHealth = computed(() => props.workerHealth ?? null);
const RECOVERY_HIGHLIGHT_WINDOW_MS = 5 * 60_000;
const lifeWorkerSnapshot = computed(() => workerHealth.value?.lifeWorker ?? null);
const lifeWorkerToneClass = computed<WorkerHealthStatus>(() => normalizeWorkerStatus(lifeWorkerSnapshot.value?.status));
const lifeWorkerStatusLabel = computed(() => normalizeWorkerStatus(lifeWorkerSnapshot.value?.status));
const lifeWorkerAgeLabel = computed(() => formatAge(lifeWorkerSnapshot.value?.ageMs ?? null));
const workerTtlLabel = computed(() => formatAge(workerHealth.value?.ttlMs ?? null));
const baseWorkerRows = computed<WorkerRowBase[]>(() => {
  const source = Array.isArray(workerHealth.value?.workers) ? workerHealth.value.workers : [];
  const rowsByWorker = new Map<string, WorkerHeartbeatSnapshot>();
  for (const snapshot of source) {
    const key = String(snapshot.worker ?? '').trim().toLowerCase();
    if (!key) continue;
    rowsByWorker.set(key, snapshot);
  }
  const lifeWorker = lifeWorkerSnapshot.value;
  const lifeWorkerKey = lifeWorker?.worker ? lifeWorker.worker.toLowerCase() : '';
  if (lifeWorker && lifeWorkerKey && !rowsByWorker.has(lifeWorkerKey)) {
    rowsByWorker.set(lifeWorkerKey, lifeWorker);
  }
  return [...rowsByWorker.values()]
    .sort((left, right) => {
      const leftStatus = normalizeWorkerStatus(left.status);
      const rightStatus = normalizeWorkerStatus(right.status);
      const rankDelta = statusSortRank(leftStatus) - statusSortRank(rightStatus);
      if (rankDelta !== 0) return rankDelta;
      const leftKey = left.worker.toLowerCase();
      const rightKey = right.worker.toLowerCase();
      if (leftKey === 'life-worker') return -1;
      if (rightKey === 'life-worker') return 1;
      const leftAge = typeof left.ageMs === 'number' ? left.ageMs : -1;
      const rightAge = typeof right.ageMs === 'number' ? right.ageMs : -1;
      if (leftAge !== rightAge) return rightAge - leftAge;
      return leftKey.localeCompare(rightKey);
    })
    .map((snapshot) => ({
      worker: snapshot.worker,
      statusClass: normalizeWorkerStatus(snapshot.status),
      ageMs: typeof snapshot.ageMs === 'number' && Number.isFinite(snapshot.ageMs) ? snapshot.ageMs : null,
      lastSeenAt: typeof snapshot.lastSeenAt === 'string' ? snapshot.lastSeenAt : null,
    }));
});
const lastKnownStatusByWorker = ref<Record<string, WorkerHealthStatus>>({});
const recoveredAtByWorker = ref<Record<string, string | null>>({});

watch(baseWorkerRows, (rows) => {
  const nowIso = new Date().toISOString();
  const nextStatusByWorker: Record<string, WorkerHealthStatus> = {};
  const nextRecoveredByWorker: Record<string, string | null> = {};

  for (const row of rows) {
    const key = row.worker.toLowerCase();
    const previousStatus = lastKnownStatusByWorker.value[key];
    const previousRecoveredAt = recoveredAtByWorker.value[key] ?? null;
    if (previousStatus && previousStatus !== 'live' && row.statusClass === 'live') {
      nextRecoveredByWorker[key] = nowIso;
    } else {
      nextRecoveredByWorker[key] = previousRecoveredAt;
    }
    nextStatusByWorker[key] = row.statusClass;
  }

  lastKnownStatusByWorker.value = nextStatusByWorker;
  recoveredAtByWorker.value = nextRecoveredByWorker;
}, { immediate: true });

const workerRows = computed<WorkerRowView[]>(() => {
  return baseWorkerRows.value.map((row) => {
    const key = row.worker.toLowerCase();
    const recoveredAt = recoveredAtByWorker.value[key] ?? null;
    return {
      worker: row.worker,
      statusClass: row.statusClass,
      statusLabel: row.statusClass,
      ageLabel: formatAge(row.ageMs),
      lastSeenLabel: formatTime(row.lastSeenAt),
      recoveredLabel: formatRelativeTime(recoveredAt),
      recoveredTitle: formatTime(recoveredAt),
      recoveredFresh: isFreshRecovery(recoveredAt),
    };
  });
});
const lifeWorkerRecoveredLabel = computed(() => formatRelativeTime(recoveredAtByWorker.value['life-worker'] ?? null));
const lifeWorkerRecoveredTitle = computed(() => formatTime(recoveredAtByWorker.value['life-worker'] ?? null));
const lifeWorkerRecoveredFresh = computed(() => isFreshRecovery(recoveredAtByWorker.value['life-worker'] ?? null));
const showOnlyAnomalies = ref(false);
const anomalyWorkerCount = computed(() => workerRows.value.filter((worker) => worker.statusClass !== 'live').length);
const visibleWorkerRows = computed(() => (
  showOnlyAnomalies.value
    ? workerRows.value.filter((worker) => worker.statusClass !== 'live')
    : workerRows.value
));
const workerFilterLabel = computed(() => (showOnlyAnomalies.value ? 'Show all lanes' : 'Anomalies only'));
const trackedTopicCount = computed(() => ring.value?.topicCount ?? 1);
const activeTopicLabel = computed(() => ring.value?.currentTopic ?? props.topic ?? 'shared-topic');
const currentIndexLabel = computed(() => {
  const index = ring.value?.currentIndex ?? 0;
  return `#${index + 1}`;
});
const ringModeLabel = computed(() => ring.value?.mode ?? 'single-topic');
const modeTone = computed(() => ringModeLabel.value === 'configured-multi-topic' ? 'watch' : 'stable');
const ringCopy = computed(() => {
  if (!ring.value) {
    return 'Ring world currently exposes a single topic shell. Additional worlds can join as independent societies; migration squads are the primary cross-world flow.';
  }
  if (ring.value.mode === 'configured-multi-topic') {
    return `${ring.value.topicCount} topic shells are registered in the ring. ${ring.value.currentTopic} is active here; mirrored shells provide cached world summaries, and migration squads can move across shells as outsiders.`;
  }
  return 'The ring world is running as a single-topic shell. Once more topics are registered, they will appear as independent worlds rather than one centralized empire.';
});

function shellBrainLabel(status: RingWorldSummary['shells'][number]['brainStatus']): string {
  if (status === 'authoritative') return 'emergent';
  if (status === 'pending') return 'forming';
  return 'inactive';
}

function normalizeWorkerStatus(value: string | null | undefined): WorkerHealthStatus {
  if (value === 'live' || value === 'stale') return value;
  return 'missing';
}

function statusSortRank(value: WorkerHealthStatus): number {
  if (value === 'missing') return 0;
  if (value === 'stale') return 1;
  return 2;
}

function formatAge(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return 'never';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const elapsedMs = Math.max(0, Date.now() - parsed);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function isFreshRecovery(value: string | null | undefined): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const elapsedMs = Date.now() - parsed;
  return elapsedMs >= 0 && elapsedMs <= RECOVERY_HIGHLIGHT_WINDOW_MS;
}

function toggleWorkerFilter(): void {
  showOnlyAnomalies.value = !showOnlyAnomalies.value;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return 'never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<style scoped>
.ring-panel,
.ring-summary,
.ring-shell-list,
.ring-peer-list,
.ring-worker-block {
  display: grid;
  gap: 10px;
}

.ring-panel {
  padding: 14px;
}

.ring-header,
.ring-worker-topline,
.ring-worker-header,
.ring-shell-topline,
.ring-shell-meta,
.ring-peer-topline,
.ring-peer-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ring-kicker,
.ring-section-label,
.ring-copy,
.ring-stat-card span {
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ring-title {
  margin-top: 2px;
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--text-strong);
}

.ring-mode,
.ring-shell-state {
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  padding: 4px 10px;
  font-size: 0.66rem;
  font-weight: 800;
  color: var(--text-body);
  background: rgba(255, 255, 255, 0.76);
}

.ring-mode.watch,
.ring-shell-state.standby {
  border-color: rgba(217, 119, 6, 0.24);
  color: #a16207;
}

.ring-shell-state.mirrored {
  border-color: rgba(37, 99, 235, 0.24);
  color: #1d4ed8;
}

.ring-mode.stable,
.ring-shell-state.active {
  border-color: rgba(22, 163, 74, 0.24);
  color: #166534;
}

.ring-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.ring-stat-card,
.ring-shell-card,
.ring-peer-card {
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-md);
  padding: 12px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(237, 243, 247, 0.94));
  box-shadow: var(--shadow-pressed);
}

.ring-copy {
  line-height: 1.5;
  text-transform: none;
}

.ring-worker-copy {
  font-size: 0.7rem;
  color: var(--text-body);
}

.ring-recovered-fresh {
  color: #166534;
  font-weight: 700;
}

.ring-worker-empty {
  border: 1px dashed var(--line-soft);
  border-radius: var(--radius-sm);
  padding: 10px;
  font-size: 0.68rem;
  color: var(--text-muted);
}

.ring-shell-card.active {
  border-color: rgba(37, 99, 235, 0.24);
}

.ring-shell-name {
  font-weight: 700;
  color: var(--text-strong);
}

.ring-shell-meta,
.ring-peer-meta {
  font-size: 0.7rem;
  color: var(--text-body);
}

.ring-peer-name {
  font-weight: 700;
  color: var(--text-strong);
}

.ring-peer-source {
  font-size: 0.68rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.ring-peer-pill {
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  padding: 3px 8px;
  font-size: 0.62rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: rgba(255, 255, 255, 0.76);
}

.ring-peer-pill.live {
  border-color: rgba(22, 163, 74, 0.24);
  color: #166534;
}

.ring-peer-pill.stale {
  border-color: rgba(217, 119, 6, 0.24);
  color: #a16207;
}

.ring-peer-pill.expired,
.ring-peer-pill.missing {
  border-color: rgba(220, 38, 38, 0.24);
  color: #b91c1c;
}

.ring-filter-btn {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--text-body);
  background: rgba(255, 255, 255, 0.76);
  cursor: pointer;
  transition: border-color 180ms var(--ease-snap), box-shadow 180ms var(--ease-snap), transform 180ms var(--ease-snap);
}

.ring-filter-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(37, 99, 235, 0.24);
  box-shadow: 0 8px 16px rgba(37, 99, 235, 0.1);
}

.ring-filter-btn.active {
  border-color: rgba(217, 119, 6, 0.28);
  color: #a16207;
}

@media (max-width: 720px) {
  .ring-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
