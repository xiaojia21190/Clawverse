<template>
  <div class="pill">
    <span class="icon">{{ icon }}</span>
    <div class="bar-wrap">
      <div class="bar-fill" :style="{ width: pct + '%', background: color }"></div>
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
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}
.icon { font-size: 13px; }
.bar-wrap {
  width: 40px;
  height: 6px;
  background: #21262d;
  border-radius: 3px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s;
}
.val {
  color: #8b949e;
  min-width: 24px;
  text-align: right;
}
</style>
