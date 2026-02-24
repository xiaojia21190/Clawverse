<template>
  <div class="mode-selector">
    <span class="label">Storyteller</span>

    <button
      v-for="m in modes"
      :key="m"
      :class="['mode-btn', { active: currentMode === m }]"
      @click="$emit('setMode', m)"
    >
      {{ m }}
    </button>

    <span class="tension-label">Tension <strong>{{ tension }}</strong></span>
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
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-clay-soft);
  transition: transform 160ms var(--ease-snap), color 160ms var(--ease-snap), box-shadow 160ms var(--ease-snap);
}

.mode-btn:hover {
  transform: translateY(-1px);
  color: var(--accent-coral);
  box-shadow: var(--shadow-float);
}

.mode-btn.active {
  color: var(--text-strong);
  border-color: rgba(58, 191, 248, 0.45);
  background: linear-gradient(145deg, rgba(58, 191, 248, 0.24), rgba(16, 201, 168, 0.2));
  box-shadow: var(--shadow-pressed);
}

.tension-label {
  margin-left: 8px;
  padding: 5px 10px;
  border-radius: 999px;
  color: var(--text-muted);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.tension-label strong {
  color: var(--state-warn);
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