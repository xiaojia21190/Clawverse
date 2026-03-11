<template>
  <div class="mode-selector">
    <span class="label">Storyteller</span>

    <button
      v-for="m in modes"
      :key="m"
      :class="['mode-btn', { active: currentMode === m }]"
      :disabled="!interactive"
      @click="interactive && $emit('setMode', m)"
    >
      {{ m }}
    </button>

    <span class="tension-label">Tension <strong>{{ tension }}</strong></span>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ currentMode: string; tension: number; interactive?: boolean }>(), {
  interactive: false,
});
defineEmits<{ setMode: [string] }>();

const modes = ['Randy', 'Cassandra', 'Phoebe'];
</script>

<style scoped>
.mode-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 0.77rem;
}

.label {
  font-family: var(--font-display);
  color: var(--text-body);
  letter-spacing: 0.04em;
}

.mode-btn {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  padding: 5px 10px;
  color: var(--text-body);
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  transition: transform 160ms var(--ease-snap), color 160ms var(--ease-snap), box-shadow 160ms var(--ease-snap);
}

.mode-btn:hover {
  transform: translateY(-1px);
  color: var(--accent-sky);
  box-shadow: var(--shadow-float);
}

.mode-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
  box-shadow: var(--shadow-pressed);
}

.mode-btn:disabled:hover {
  transform: none;
  color: var(--text-body);
  box-shadow: var(--shadow-pressed);
}

.mode-btn.active {
  color: var(--text-strong);
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.14);
  box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.14);
}

.tension-label {
  margin-left: 8px;
  padding: 5px 10px;
  border-radius: 999px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}

.tension-label strong {
  color: var(--accent-sun);
}

@media (max-width: 760px) {
  .mode-selector {
    width: 100%;
  }

  .tension-label {
    margin-left: 0;
  }
}
</style>
