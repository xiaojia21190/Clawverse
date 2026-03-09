<template>
  <section class="overview-panel">
    <div class="overview-header">
      <div>
        <div class="overview-title">Signal Matrix</div>
        <div class="overview-sub">把系统张力、冲突源和自主意图压成一眼可读的指挥层。</div>
      </div>

      <div v-if="focus" class="focus-chip" :class="focus.tone">
        <span class="focus-label">{{ focus.label }}</span>
        <span class="focus-title">{{ focus.title }}</span>
        <span class="focus-reason">{{ focus.reason }}</span>
      </div>
    </div>

    <div class="signal-grid">
      <article v-for="metric in metrics" :key="metric.id" class="signal-card" :class="metric.tone">
        <div class="signal-topline">
          <span class="signal-label">{{ metric.label }}</span>
          <span class="signal-value">{{ metric.value }}</span>
        </div>
        <div class="signal-detail">{{ metric.detail }}</div>
        <div class="signal-bar"><div class="signal-fill" :style="{ width: `${metric.fill}%` }"></div></div>
      </article>
    </div>

    <div class="driver-board">
      <div class="driver-header">
        <span>Pressure Drivers</span>
        <span class="driver-count">{{ drivers.length }}</span>
      </div>

      <div v-if="drivers.length" class="driver-list">
        <article v-for="driver in drivers" :key="driver.id" class="driver-item" :class="driver.tone">
          <div class="driver-topline">
            <span class="driver-label">{{ driver.label }}</span>
            <span class="driver-score">+{{ driver.score }}</span>
          </div>
          <div class="driver-detail">{{ driver.detail }}</div>
        </article>
      </div>

      <div v-else class="driver-empty">当前系统平稳，没有明显升温因素。</div>
    </div>
  </section>
</template>

<script setup lang="ts">
export interface SignalMetric {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: 'calm' | 'watch' | 'alert' | 'critical';
  fill: number;
}

export interface PressureDriver {
  id: string;
  label: string;
  detail: string;
  score: number;
  tone: 'watch' | 'alert' | 'critical';
}

export interface FocusSignal {
  label: string;
  title: string;
  reason: string;
  tone: 'watch' | 'alert' | 'critical';
}

defineProps<{
  metrics: SignalMetric[];
  drivers: PressureDriver[];
  focus: FocusSignal | null;
}>();
</script>

<style scoped>
.overview-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-xl);
  background: linear-gradient(180deg, rgba(18, 26, 41, 0.92), rgba(12, 18, 31, 0.86));
  box-shadow: var(--shadow-float);
}

.overview-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.overview-title {
  font-family: var(--font-display);
  font-size: 1.02rem;
  color: var(--text-strong);
}

.overview-sub {
  margin-top: 4px;
  max-width: 680px;
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.focus-chip {
  display: grid;
  gap: 4px;
  min-width: 220px;
  padding: 10px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.04);
}

.focus-chip.watch {
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.18);
}

.focus-chip.alert,
.focus-chip.critical {
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.18);
}

.focus-label {
  font-size: 0.63rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.focus-title {
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text-strong);
}

.focus-reason {
  font-size: 0.7rem;
  line-height: 1.4;
  color: var(--text-body);
}

.signal-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.signal-card {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
}

.signal-card.watch {
  border-color: rgba(245, 158, 11, 0.35);
}

.signal-card.alert,
.signal-card.critical {
  border-color: rgba(239, 68, 68, 0.35);
}

.signal-topline,
.driver-topline,
.driver-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.signal-label,
.driver-label,
.driver-header {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.signal-value {
  font-family: var(--font-mono);
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-strong);
}

.signal-detail,
.driver-detail,
.driver-empty {
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--text-body);
}

.signal-bar {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
}

.signal-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(56, 189, 248, 0.9), rgba(250, 204, 21, 0.9), rgba(248, 113, 113, 0.9));
}

.driver-board {
  display: grid;
  gap: 10px;
}

.driver-count,
.driver-score {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-strong);
}

.driver-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.driver-item {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.03);
}

.driver-item.watch {
  border-color: rgba(245, 158, 11, 0.28);
}

.driver-item.alert,
.driver-item.critical {
  border-color: rgba(239, 68, 68, 0.28);
}

@media (max-width: 1180px) {
  .signal-grid,
  .driver-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .overview-header,
  .signal-grid,
  .driver-list {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .focus-chip {
    width: 100%;
    min-width: 0;
  }
}
</style>
