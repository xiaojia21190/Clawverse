<template>
  <div class="mode-selector">
    <span class="label">Storyteller:</span>
    <button
      v-for="m in modes"
      :key="m"
      :class="['mode-btn', { active: currentMode === m }]"
      @click="$emit('setMode', m)"
    >
      {{ m }}
    </button>
    <span class="tension-label">Tension: <strong>{{ tension }}</strong></span>
  </div>
</template>

<script setup lang="ts">
defineProps<{ currentMode: string; tension: number }>();
defineEmits<{ setMode: [string] }>();
const modes = ['Randy', 'Cassandra', 'Phoebe'];
</script>

<style scoped>
.mode-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.label { color: #8b949e; }
.mode-btn {
  background: #21262d;
  border: 1px solid #30363d;
  color: #8b949e;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}
.mode-btn.active {
  background: #1f2a3a;
  border-color: #58a6ff;
  color: #58a6ff;
}
.mode-btn:hover { border-color: #58a6ff; }
.tension-label { margin-left: 8px; color: #6e7681; }
.tension-label strong { color: #d29922; }
</style>
