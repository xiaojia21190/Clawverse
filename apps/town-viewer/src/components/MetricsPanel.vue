<template>
  <div class="metrics-panel">
    <div class="panel-header">
      <span>Evolution Metrics</span>
      <button class="refresh-btn" @click="refresh" :disabled="loading">↻</button>
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

const variants = computed(() =>
  stats.value ? Object.entries(stats.value.byVariant) : []
);

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
    if (!res.ok) { error.value = `HTTP ${res.status}`; return; }
    stats.value = await res.json() as EvoStats;
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

onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<style scoped>
.metrics-panel {
  background: #161b22;
  border-top: 1px solid #30363d;
  padding: 8px 12px;
  flex-shrink: 0;
  min-height: 80px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: #8b949e;
  margin-bottom: 8px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.refresh-btn {
  background: none;
  border: 1px solid #30363d;
  color: #8b949e;
  border-radius: 4px;
  padding: 1px 6px;
  cursor: pointer;
  font-size: 12px;
}
.refresh-btn:hover { color: #c9d1d9; }
.refresh-btn:disabled { opacity: 0.4; cursor: default; }

.loading, .empty { font-size: 11px; color: #6e7681; }
.error { font-size: 11px; color: #f85149; }

.summary-row {
  display: flex;
  gap: 20px;
  margin-bottom: 8px;
}

.metric .value {
  font-size: 16px;
  font-weight: 700;
  color: #c9d1d9;
  line-height: 1;
}
.metric .label {
  font-size: 10px;
  color: #6e7681;
  margin-top: 2px;
}

.rate-good { color: #3fb950 !important; }
.rate-warn { color: #d29922 !important; }
.rate-bad  { color: #f85149 !important; }

.variants { border-top: 1px solid #21262d; padding-top: 6px; }
.variants-title { font-size: 10px; color: #6e7681; margin-bottom: 4px; text-transform: uppercase; }

.variant-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  margin-bottom: 2px;
}

.variant-name { color: #58a6ff; flex: 1; font-family: monospace; }
.variant-stat { min-width: 40px; text-align: right; }
.variant-total { color: #6e7681; font-size: 10px; }
.muted { color: #8b949e; }
</style>
