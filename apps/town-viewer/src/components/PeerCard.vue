<template>
  <div class="peer-card">
    <div class="header">
      <span class="icon" :style="{ color: peer.dna.appearance.primaryColor }">
        {{ archetypeIcon(peer.dna.archetype) }}
      </span>
      <div>
        <div class="name">{{ peer.name }}</div>
        <div class="archetype">{{ peer.dna.archetype }} · {{ peer.mood }}</div>
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
        <div class="bar-fill" :style="{ width: peer.hardware.ramUsage + '%', background: '#58a6ff' }"></div>
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

function archetypeIcon(a: string): string {
  return { Warrior: '🦀', Artisan: '🦐', Scholar: '🐙', Ranger: '🦑' }[a] ?? '🐚';
}

const cpuColor = computed(() => {
  const c = props.peer.hardware.cpuUsage;
  if (c > 80) return '#f85149';
  if (c > 60) return '#e3b341';
  return '#3fb950';
});
</script>

<style scoped>
.peer-card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px;
  width: 200px;
  font-size: 12px;
}

.header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}

.icon { font-size: 24px; }

.name { font-weight: 600; font-size: 13px; }
.archetype { color: #8b949e; margin-top: 2px; }

.metrics {
  display: grid;
  grid-template-columns: 32px 1fr 36px;
  align-items: center;
  gap: 4px 6px;
  margin-bottom: 8px;
}

.bar-label { color: #8b949e; }
.bar-track { background: #21262d; border-radius: 2px; height: 6px; }
.bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
.bar-value { text-align: right; color: #e6edf3; }

.dna-id { color: #6e7681; font-size: 10px; font-family: monospace; margin-bottom: 2px; }
.pos { color: #6e7681; font-size: 10px; }
</style>
