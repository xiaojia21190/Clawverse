<template>
  <div class="peer-card">
    <div class="header">
      <span class="icon" :style="{ color: peer.dna.appearance.primaryColor }">
        {{ archetypeIcon(peer.dna.archetype) }}
      </span>
      <div>
        <div class="name">{{ peer.name }}</div>
        <div class="archetype">{{ peer.dna.archetype }} - {{ peer.mood }}</div>
      </div>
    </div>

    <div class="metrics">
      <div class="bar-label">CPU</div>
      <div class="bar-track">
        <div class="bar-fill" :style="{ width: peer.hardware.cpuUsage + '%', background: cpuColor }"></div>
      </div>
      <div class="bar-value">{{ peer.hardware.cpuUsage }}%</div>

      <div class="bar-label">RAM</div>
      <div class="bar-track">
        <div class="bar-fill" :style="{ width: peer.hardware.ramUsage + '%', background: ramColor }"></div>
      </div>
      <div class="bar-value">{{ peer.hardware.ramUsage }}%</div>
    </div>

    <div class="dna-id">DNA: {{ peer.dna.id }}</div>
    <div class="pos">Pos: ({{ peer.position.x }}, {{ peer.position.y }})</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PeerState } from '../composables/usePeers';

const props = defineProps<{ peer: PeerState }>();

const ramColor = '#3abff8';

function archetypeIcon(a: string): string {
  return { Warrior: 'WR', Artisan: 'AR', Scholar: 'SC', Ranger: 'RG' }[a] ?? 'PE';
}

const cpuColor = computed(() => {
  const c = props.peer.hardware.cpuUsage;
  if (c > 80) return '#ef476f';
  if (c > 60) return '#ff9f1c';
  return '#06d6a0';
});
</script>

<style scoped>
.peer-card {
  width: 220px;
  padding: 13px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, var(--surface), var(--surface-strong));
  box-shadow: var(--shadow-clay-soft);
  color: var(--text-strong);
  font-size: 12px;
}

.header {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 11px;
}

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 34px;
  border-radius: 10px;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  background: linear-gradient(145deg, rgba(58, 191, 248, 0.14), rgba(255, 107, 107, 0.14));
  box-shadow: var(--shadow-pressed);
}

.name {
  font-weight: 800;
  font-size: 0.84rem;
}

.archetype {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 0.68rem;
}

.metrics {
  display: grid;
  grid-template-columns: 32px 1fr 40px;
  align-items: center;
  gap: 5px 8px;
  margin-bottom: 9px;
}

.bar-label {
  color: var(--text-body);
  font-size: 0.68rem;
  font-weight: 700;
}

.bar-track {
  height: 7px;
  border-radius: 999px;
  background: rgba(88, 112, 159, 0.15);
  box-shadow: var(--shadow-pressed);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: inherit;
  transition: width 300ms var(--ease-snap);
}

.bar-value {
  text-align: right;
  color: var(--text-body);
  font-size: 0.68rem;
  font-weight: 700;
}

.dna-id,
.pos {
  color: var(--text-muted);
  font-size: 0.64rem;
  font-family: 'JetBrains Mono', 'Cascadia Mono', monospace;
}

.pos {
  margin-top: 2px;
}
</style>