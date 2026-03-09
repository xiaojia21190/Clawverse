<template>
  <div class="metrics-panel">
    <div class="panel-header">
      <span>Evolution Metrics</span>
      <button class="refresh-btn" @click="refresh" :disabled="loading">Refresh</button>
    </div>

    <div v-if="loading && !hasData" class="loading">Loading...</div>
    <div v-else-if="!hasData && error" class="error">{{ error }}</div>

    <div v-else-if="hasData" class="stats-body">
      <div v-if="evolution?.rollout" class="rollout-card">
        <div class="rollout-topline">
          <div>
            <div class="section-title">Rollout</div>
            <div class="rollout-copy">
              {{ rolloutBaseline }} -> {{ rolloutCandidate }}
            </div>
          </div>
          <span class="rollout-pill" :class="gateTone">
            Gate {{ gateLabel }}
          </span>
        </div>

        <div class="rollout-grid">
          <div class="metric mini">
            <div class="value">{{ rolloutRatio }}</div>
            <div class="label">Candidate Ratio</div>
          </div>
          <div class="metric mini">
            <div class="value">{{ canaryLabel }}</div>
            <div class="label">Canary</div>
          </div>
          <div class="metric mini">
            <div class="value">{{ latestDecisionLabel }}</div>
            <div class="label">Latest Decision</div>
          </div>
        </div>

        <div class="rollout-meta">
          <span v-if="evolution.latest?.proposalId">Proposal {{ shortId(evolution.latest.proposalId) }}</span>
          <span v-if="evolution.rollout.updatedAt">Updated {{ formatTime(evolution.rollout.updatedAt) }}</span>
          <span v-if="evolution.rollout.healthGate?.lastHealthCheckAt">Checked {{ formatTime(evolution.rollout.healthGate.lastHealthCheckAt) }}</span>
        </div>
      </div>

      <div v-if="latestDecision || latestReport" class="decision-card">
        <div class="decision-topline">
          <div>
            <div class="section-title">Latest Decision</div>
            <div class="decision-copy">{{ decisionNote }}</div>
          </div>
          <span class="rollout-pill" :class="decisionTone">
            {{ latestDecisionLabel }}
          </span>
        </div>

        <div v-if="decisionChecks.length > 0" class="chip-wrap">
          <span
            v-for="entry in decisionChecks"
            :key="entry.key"
            class="status-chip"
            :class="entry.ok ? 'rate-good' : 'rate-bad'"
          >
            {{ entry.label }} {{ entry.ok ? 'pass' : 'fail' }}
          </span>
        </div>

        <div v-if="deltaEntries.length > 0" class="detail-grid">
          <div v-for="entry in deltaEntries" :key="entry.key" class="detail-row">
            <span class="detail-label">{{ entry.label }}</span>
            <strong :class="entry.tone">{{ entry.value }}</strong>
          </div>
        </div>

        <div v-if="healthEntries.length > 0" class="health-section">
          <div class="section-subtitle">Health Gate Checks</div>
          <div class="chip-wrap">
            <span
              v-for="entry in healthEntries"
              :key="entry.key"
              class="status-chip"
              :class="entry.ok ? 'rate-good' : 'rate-bad'"
            >
              {{ entry.label }} {{ entry.ok ? 'ok' : 'trip' }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="stats" class="summary-row">
        <div class="metric">
          <div class="value">{{ stats.total }}</div>
          <div class="label">Episodes</div>
        </div>
        <div class="metric">
          <div class="value" :class="rateClass(stats.successRate)">{{ stats.successRate }}%</div>
          <div class="label">Success</div>
        </div>
        <div class="metric">
          <div class="value">{{ stats.avgLatencyMs }}ms</div>
          <div class="label">Avg Latency</div>
        </div>
      </div>

      <div v-if="variants.length > 0" class="variants">
        <div class="section-title">By Variant</div>
        <div v-for="[variantName, variantData] in variants" :key="variantName" class="variant-row">
          <span class="variant-name">{{ variantName }}</span>
          <span class="variant-stat" :class="rateClass(variantData.successRate)">{{ variantData.successRate }}%</span>
          <span class="variant-stat muted">{{ variantData.avgLatencyMs }}ms</span>
          <span class="variant-total muted">n={{ variantData.total }}</span>
        </div>
      </div>

      <div v-if="historyEntries.length > 0" class="history-card">
        <div class="section-title">Recent Rollout History</div>
        <div v-for="entry in historyEntries" :key="historyKey(entry)" class="history-row">
          <div class="history-main">
            <span class="history-label" :class="historyTone(entry)">{{ historyLabel(entry) }}</span>
            <span class="history-ratio">{{ historyRatio(entry) }}</span>
          </div>
          <div class="history-meta">
            <span>{{ historyHealth(entry) }}</span>
            <span>{{ formatTime(asText(entry.ts)) }}</span>
          </div>
        </div>
      </div>

      <div v-if="error" class="inline-error">{{ error }}</div>
    </div>

    <div v-else class="empty">No evolution data yet.</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

interface VariantStats {
  total: number;
  successRate: number;
  avgLatencyMs: number;
  avgTokenTotal: number;
  avgCostUsd: number;
}

interface EvoStats {
  total: number;
  successRate: number;
  avgLatencyMs: number;
  byVariant: Record<string, VariantStats>;
}

interface EvolutionRolloutStatus {
  baseline?: string;
  candidate?: string;
  candidateRatio?: number;
  updatedAt?: string | null;
  canary?: {
    active?: boolean;
    remainingMs?: number;
    remainingMinutes?: number;
    lockedUntil?: string | null;
  } | null;
  healthGate?: {
    status?: string;
    rawStatus?: string;
    fresh?: boolean;
    lastHealthCheckAt?: string | null;
    windowStartAt?: string | null;
    rollbackApplied?: boolean;
    samples?: Record<string, unknown> | null;
    checks?: Record<string, boolean> | null;
  } | null;
}

interface EvolutionDecisionStatus {
  decision?: string;
  notes?: string;
  sampleChecks?: Record<string, boolean> | null;
  checks?: Record<string, boolean> | null;
}

interface EvolutionReportStatus {
  deltas?: Record<string, number> | null;
}

interface EvolutionLatestStatus {
  proposalId?: string;
  decision?: EvolutionDecisionStatus | null;
  report?: EvolutionReportStatus | null;
}

interface EvolutionHistoryEntry {
  ts?: string;
  decision?: string;
  prevRatio?: number;
  ratio?: number;
  healthGateStatus?: string;
  rollbackApplied?: boolean;
  healthRollbackApplied?: boolean;
  healthGateHoldApplied?: boolean;
  canaryHoldApplied?: boolean;
}

interface EvolutionStatus {
  enabled: boolean;
  variant: string | null;
  episodesPath: string | null;
  rollout: EvolutionRolloutStatus | null;
  latest: EvolutionLatestStatus | null;
  history: EvolutionHistoryEntry[];
}

const stats = ref<EvoStats | null>(null);
const evolution = ref<EvolutionStatus | null>(null);
const loading = ref(false);
const error = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const hasData = computed(() => !!stats.value || !!evolution.value?.rollout || !!evolution.value?.latest || (evolution.value?.history?.length ?? 0) > 0);
const variants = computed(() => (stats.value ? Object.entries(stats.value.byVariant) : []));
const rolloutBaseline = computed(() => evolution.value?.rollout?.baseline ?? 'baseline');
const rolloutCandidate = computed(() => evolution.value?.rollout?.candidate ?? 'candidate');
const rolloutRatio = computed(() => `${Math.round(Number(evolution.value?.rollout?.candidateRatio ?? 0) * 100)}%`);
const gateLabel = computed(() => evolution.value?.rollout?.healthGate?.status ?? 'pending');
const latestDecision = computed(() => evolution.value?.latest?.decision ?? null);
const latestReport = computed(() => evolution.value?.latest?.report ?? null);
const historyEntries = computed(() => evolution.value?.history ?? []);

const gateTone = computed(() => {
  if (gateLabel.value === 'healthy') return 'rate-good';
  if (gateLabel.value === 'critical') return 'rate-bad';
  return 'rate-warn';
});

const canaryLabel = computed(() => {
  const canary = evolution.value?.rollout?.canary;
  if (!canary) return 'off';
  if (canary.active) return `${Math.max(0, Math.round(canary.remainingMinutes ?? 0))}m`;
  return Number(evolution.value?.rollout?.candidateRatio ?? 0) > 0 ? 'idle' : 'off';
});

const latestDecisionLabel = computed(() => {
  const decision = latestDecision.value?.decision;
  if (!decision) return 'n/a';
  if (decision === 'adopt_candidate') return 'adopt';
  if (decision === 'keep_baseline') return 'baseline';
  return decision.replace(/_/g, ' ');
});

const decisionNote = computed(() => latestDecision.value?.notes ?? 'No decision notes available.');

const decisionTone = computed(() => {
  const decision = latestDecision.value?.decision;
  if (decision === 'adopt_candidate') return 'rate-good';
  if (decision === 'keep_baseline') return 'rate-bad';
  return 'rate-warn';
});

const decisionChecks = computed(() => {
  const sampleChecks = latestDecision.value?.sampleChecks ?? {};
  const checks = latestDecision.value?.checks ?? {};
  return [
    ...Object.entries(sampleChecks).map(([key, ok]) => ({ key: `sample-${key}`, label: humanizeKey(key), ok: Boolean(ok) })),
    ...Object.entries(checks).map(([key, ok]) => ({ key: `metric-${key}`, label: humanizeKey(key), ok: Boolean(ok) })),
  ];
});

const deltaEntries = computed(() => {
  const deltas = latestReport.value?.deltas ?? {};
  const rows: Array<{ key: string; label: string; value: string; tone: string }> = [];

  for (const key of ['successRate', 'avgLatencyMs', 'avgTokenTotal', 'avgCostUsd']) {
    if (typeof deltas[key] !== 'number' || Number.isNaN(deltas[key])) continue;
    rows.push({
      key,
      label: humanizeKey(key),
      value: formatDelta(key, deltas[key]),
      tone: deltaTone(key, deltas[key]),
    });
  }

  return rows;
});

const healthEntries = computed(() => {
  const checks = evolution.value?.rollout?.healthGate?.checks ?? {};
  return Object.entries(checks).map(([key, ok]) => ({
    key,
    label: humanizeKey(key),
    ok: Boolean(ok),
  }));
});

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function rateClass(rate: number): string {
  if (rate >= 90) return 'rate-good';
  if (rate >= 70) return 'rate-warn';
  return 'rate-bad';
}

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 20) : 'n/a';
}

function humanizeKey(value: string): string {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function formatTime(value: string | null | undefined): string {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDelta(key: string, value: number): string {
  if (key === 'successRate') return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  if (key === 'avgCostUsd') return `${value >= 0 ? '+' : ''}$${value.toFixed(4)}`;
  return `${value >= 0 ? '+' : ''}${Math.round(value)}`;
}

function deltaTone(key: string, value: number): string {
  if (key === 'successRate') return value >= 0 ? 'rate-good' : 'rate-bad';
  return value <= 0 ? 'rate-good' : 'rate-bad';
}

function historyKey(entry: EvolutionHistoryEntry): string {
  return `${asText(entry.ts)}:${asText(entry.decision)}:${asNumber(entry.ratio)}`;
}

function historyLabel(entry: EvolutionHistoryEntry): string {
  if (entry.healthRollbackApplied) return 'health rollback';
  if (entry.rollbackApplied) return 'rollback';
  if (entry.healthGateHoldApplied) return 'health hold';
  if (entry.canaryHoldApplied) return 'canary hold';
  if (entry.decision === 'adopt_candidate') return 'adopt';
  if (entry.decision === 'keep_baseline') return 'baseline';
  return asText(entry.decision) || 'hold';
}

function historyTone(entry: EvolutionHistoryEntry): string {
  if (entry.healthRollbackApplied || entry.rollbackApplied || entry.decision === 'keep_baseline') return 'rate-bad';
  if (entry.healthGateHoldApplied || entry.canaryHoldApplied) return 'rate-warn';
  return 'rate-good';
}

function historyRatio(entry: EvolutionHistoryEntry): string {
  return `${Math.round(asNumber(entry.prevRatio) * 100)}% -> ${Math.round(asNumber(entry.ratio) * 100)}%`;
}

function historyHealth(entry: EvolutionHistoryEntry): string {
  return asText(entry.healthGateStatus) || 'pending';
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json() as T;
}

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  const errors: string[] = [];

  try {
    const [statsResult, statusResult] = await Promise.allSettled([
      fetchJson<EvoStats>('/evolution/stats'),
      fetchJson<EvolutionStatus>('/evolution/status'),
    ]);

    if (statsResult.status === 'fulfilled') {
      stats.value = statsResult.value;
      if (!statsResult.value) errors.push('stats unavailable');
    } else {
      errors.push(statsResult.reason instanceof Error ? statsResult.reason.message : 'stats unavailable');
    }

    if (statusResult.status === 'fulfilled') {
      evolution.value = statusResult.value;
      if (!statusResult.value) errors.push('rollout unavailable');
    } else {
      errors.push(statusResult.reason instanceof Error ? statusResult.reason.message : 'rollout unavailable');
    }

    error.value = errors.length > 0 ? errors.join(' | ') : '';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 60_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.metrics-panel {
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, var(--surface), var(--surface-strong));
  box-shadow: var(--shadow-clay-soft);
}

.panel-header,
.summary-row,
.rollout-topline,
.decision-topline,
.variant-row,
.rollout-meta,
.history-main,
.history-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-header {
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-body);
}

.refresh-btn {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  padding: 4px 10px;
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-clay-soft);
  color: var(--text-body);
  cursor: pointer;
  font-size: 0.66rem;
  font-weight: 700;
  transition: transform 160ms var(--ease-snap), box-shadow 160ms var(--ease-snap), color 160ms var(--ease-snap);
}

.refresh-btn:hover {
  transform: translateY(-1px);
  color: var(--accent-coral);
  box-shadow: var(--shadow-float);
}

.refresh-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.stats-body,
.rollout-card,
.decision-card,
.history-card {
  display: grid;
  gap: 10px;
}

.stats-body {
  gap: 12px;
}

.rollout-card,
.decision-card,
.history-card {
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.72);
}

.rollout-topline,
.decision-topline {
  justify-content: space-between;
}

.section-title,
.section-subtitle {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
}

.rollout-copy,
.decision-copy,
.metric .value {
  font-size: 1.02rem;
  line-height: 1.15;
  font-weight: 800;
  color: var(--text-strong);
}

.decision-copy {
  margin-top: 4px;
  font-size: 0.74rem;
  font-weight: 600;
  line-height: 1.4;
}

.rollout-grid,
.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.detail-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.metric,
.detail-row {
  display: grid;
  gap: 2px;
}

.metric.mini .value {
  font-size: 0.86rem;
}

.metric .label,
.rollout-meta,
.loading,
.empty,
.inline-error,
.history-meta,
.detail-label {
  font-size: 0.68rem;
  color: var(--text-muted);
}

.rollout-pill,
.status-chip,
.history-label {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.66rem;
  font-weight: 700;
}

.summary-row {
  gap: 20px;
}

.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.health-section {
  display: grid;
  gap: 6px;
}

.history-row {
  display: grid;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--line-soft);
}

.history-main {
  justify-content: space-between;
}

.history-ratio {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-strong);
}

.history-meta {
  justify-content: space-between;
}

.rate-good {
  color: var(--state-good) !important;
}

.rate-warn {
  color: var(--state-warn) !important;
}

.rate-bad {
  color: var(--state-bad) !important;
}

.error,
.inline-error {
  color: var(--state-bad);
}

.variants {
  border-top: 1px solid var(--line-soft);
  padding-top: 7px;
}

.variant-row {
  margin-bottom: 2px;
  font-size: 0.7rem;
}

.variant-name {
  flex: 1;
  color: var(--accent-sky);
  font-family: 'JetBrains Mono', 'Cascadia Mono', monospace;
}

.variant-stat {
  min-width: 42px;
  text-align: right;
}

.variant-total,
.muted {
  color: var(--text-muted);
}

@media (max-width: 760px) {
  .summary-row,
  .rollout-topline,
  .decision-topline,
  .rollout-meta,
  .variant-row,
  .history-main,
  .history-meta {
    align-items: flex-start;
    flex-direction: column;
  }

  .rollout-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
