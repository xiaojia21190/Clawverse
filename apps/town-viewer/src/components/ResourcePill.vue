<template>
  <div class="pill" :class="toneClass">
    <span class="icon">{{ icon }}</span>

    <div class="content">
      <div class="topline">
        <span class="label">{{ label }}</span>
        <span class="state">{{ stateLabel }}</span>
      </div>
      <div class="bar-wrap">
        <div class="bar-fill" :style="{ width: pct + '%', background: color }"></div>
      </div>
    </div>

    <span class="val">{{ Math.round(value) }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  icon: string;
  label: string;
  value: number;
  max: number;
  color: string;
}>();

const pct = computed(() => Math.min(100, (props.value / props.max) * 100));
const toneClass = computed(() => {
  if (pct.value <= 15) return 'critical';
  if (pct.value <= 35) return 'watch';
  return 'stable';
});

const stateLabel = computed(() => {
  if (pct.value <= 15) return 'critical';
  if (pct.value <= 35) return 'low';
  return 'stable';
});
</script>

<style scoped>
.pill {
  display: grid;
  grid-template-columns: auto minmax(64px, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-width: 132px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}

.pill.watch {
  border-color: rgba(202, 138, 4, 0.24);
}

.pill.critical {
  border-color: rgba(220, 38, 38, 0.24);
}

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  border-radius: 8px;
  font-size: 0.56rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--text-strong);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}

.content {
  display: grid;
  gap: 3px;
}

.topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.label {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.state {
  font-size: 0.54rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.bar-wrap {
  width: 100%;
  height: 7px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(148, 163, 184, 0.14);
}

.bar-fill {
  height: 100%;
  border-radius: inherit;
  transition: width 320ms var(--ease-snap);
}

.val {
  min-width: 28px;
  text-align: right;
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--text-body);
}
</style>
