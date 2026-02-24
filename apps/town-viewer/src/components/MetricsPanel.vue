<template>
  <div class="metrics-panel">
    <div class="panel-header">
      <span>Evolution Metrics</span>
      <button class="refresh-btn" @click="refresh" :disabled="loading">Refresh</button>
    </div>

    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else-if="stats" class="stats-body">
      <div class="summary-row">
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
        <div class="variants-title">By Variant</div>
        <div v-for="[vname, vdata] in variants" :key="vname" class="variant-row">
          <span class="variant-name">{{ vname }}</span>
          <span class="variant-stat" :class="rateClass(vdata.successRate)">{{ vdata.successRate }}%</span>
          <span class="variant-stat muted">{{ vdata.avgLatencyMs }}ms</span>
          <span class="variant-total muted">n={{ vdata.total }}</span>
        </div>
      </div>
    </div>

    <div v-else class="empty">No evolution data yet.</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

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

const stats = ref<EvoStats | null>(null);
const loading = ref(false);
const error = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const variants = computed(() => (stats.value ? Object.entries(stats.value.byVariant) : []));

function rateClass(rate: number): string {
  if (rate >= 90) return 'rate-good';
  if (rate >= 70) return 'rate-warn';
  return 'rate-bad';
}

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const res = await fetch('/evolution/stats');
    if (!res.ok) {
      error.value = `HTTP ${res.status}`;
      return;
    }
    stats.value = (await res.json()) as EvoStats;
  } catch (err) {
    error.value = (err as Error).message;
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

.panel-header {
  display: flex;
  align-items: center;
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

.loading,
.empty {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.error {
  font-size: 0.72rem;
  color: var(--state-bad);
}

.summary-row {
  display: flex;
  gap: 20px;
  margin-bottom: 8px;
}

.metric .value {
  font-size: 1.06rem;
  line-height: 1;
  font-weight: 800;
  color: var(--text-strong);
}

.metric .label {
  margin-top: 2px;
  font-size: 0.64rem;
  color: var(--text-muted);
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

.variants {
  border-top: 1px solid var(--line-soft);
  padding-top: 7px;
}

.variants-title {
  margin-bottom: 4px;
  font-size: 0.62rem;
  text-transform: uppercase;
  color: var(--text-muted);
}

.variant-row {
  display: flex;
  align-items: center;
  gap: 8px;
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

.variant-total {
  font-size: 0.63rem;
}

.muted {
  color: var(--text-muted);
}
</style>