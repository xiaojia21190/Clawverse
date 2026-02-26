<template>
  <div class="faction-panel">
    <div class="fp-header">Factions</div>

    <div v-if="factions.length === 0" class="fp-empty">
      No factions yet.
    </div>

    <div v-for="f in factions" :key="f.id" class="fp-card">
      <div class="fp-name">{{ f.name }}</div>
      <div class="fp-motto">"{{ f.motto }}"</div>
      <div class="fp-members">{{ f.members.length }} member{{ f.members.length !== 1 ? 's' : '' }}</div>
      <div class="fp-actions">
        <button class="fp-btn" @click="$emit('join', f.id)">Join</button>
        <button class="fp-btn fp-btn-leave" @click="$emit('leave', f.id)">Leave</button>
      </div>
    </div>

    <div v-if="wars.length > 0" class="fp-wars-header">Active Wars</div>
    <div v-for="w in wars" :key="w.id" class="fp-war">
      <span class="fp-war-label">{{ factionName(w.factionA) }} vs {{ factionName(w.factionB) }}</span>
      <button class="fp-btn fp-btn-peace" @click="$emit('peace', w.id)">Peace</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FactionInfo, FactionWarInfo } from '../composables/useFactions';

const props = defineProps<{
  factions: FactionInfo[];
  wars: FactionWarInfo[];
}>();

defineEmits<{
  join: [string];
  leave: [string];
  peace: [string];
}>();

function factionName(id: string): string {
  return props.factions.find(f => f.id === id)?.name ?? id.slice(0, 8);
}
</script>

<style scoped>
.faction-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  overflow-y: auto;
}

.fp-header, .fp-wars-header {
  position: sticky;
  top: 0;
  z-index: 1;
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-family: var(--font-display);
  font-size: 0.95rem;
  color: var(--text-strong);
  background: linear-gradient(135deg, rgba(239, 71, 111, 0.18), rgba(255, 183, 3, 0.22));
  box-shadow: var(--shadow-pressed);
}

.fp-wars-header {
  margin-top: 8px;
  background: linear-gradient(135deg, rgba(239, 71, 111, 0.28), rgba(255, 122, 89, 0.24));
}

.fp-empty {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  text-align: center;
  font-size: 0.75rem;
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.fp-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.fp-name {
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text-strong);
}

.fp-motto {
  font-size: 0.7rem;
  font-style: italic;
  color: var(--text-body);
}

.fp-members {
  font-size: 0.68rem;
  color: var(--text-muted);
}

.fp-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.fp-btn {
  border: none;
  border-radius: var(--radius-sm, 6px);
  padding: 4px 10px;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-strong);
  background: linear-gradient(140deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-clay-soft, 0 1px 3px rgba(0,0,0,0.1));
  cursor: pointer;
  transition: transform 150ms, box-shadow 150ms;
}

.fp-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-float, 0 2px 6px rgba(0,0,0,0.15));
}

.fp-btn-leave {
  color: var(--state-bad, #ef476f);
}

.fp-btn-peace {
  color: var(--state-good, #10c9a8);
}

.fp-war {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(239, 71, 111, 0.2);
  background: linear-gradient(145deg, rgba(239, 71, 111, 0.05), rgba(255, 122, 89, 0.08));
  box-shadow: var(--shadow-pressed);
}

.fp-war-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-strong);
}
</style>
