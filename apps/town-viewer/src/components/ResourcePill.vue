<template>
  <div class="pill">
    <span class="icon">{{ icon }}</span>

    <div class="content">
      <span class="label">{{ label }}</span>
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
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-clay-soft);
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
  background: linear-gradient(145deg, rgba(255, 107, 107, 0.2), rgba(58, 191, 248, 0.24));
  box-shadow: var(--shadow-pressed);
}

.content {
  display: grid;
  gap: 3px;
}

.label {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.bar-wrap {
  width: 100%;
  height: 7px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(90, 115, 164, 0.15);
  box-shadow: var(--shadow-pressed);
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