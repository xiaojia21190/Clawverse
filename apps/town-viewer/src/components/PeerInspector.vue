<template>
  <div v-if="peer" class="inspector">
    <div class="header">
      <span class="peer-icon" :style="{ color: peer.dna?.appearance?.primaryColor ?? '#3abff8' }">
        {{ archetypeIcon(peer.dna?.archetype) }}
      </span>

      <div class="identity">
        <div class="name">{{ peer.name }}</div>
        <div class="traits">{{ peer.dna?.archetype }} - {{ peer.dna?.modelTrait }} - Lv.{{ explorerLevel }}</div>
      </div>

      <div class="mood-badge" :class="peer.mood">{{ peer.mood }}</div>
    </div>

    <div class="needs-row">
      <div class="need-item" v-for="n in needLabels" :key="n">
        <span class="need-label">{{ n }}</span>
        <div class="need-bar"><div class="need-fill"></div></div>
      </div>
    </div>

    <div class="badges" v-if="peer.dna?.badges?.length">
      <span v-for="b in peer.dna.badges" :key="b" class="badge">{{ b }}</span>
    </div>

    <div class="hw-row">
      <span>CPU {{ Math.round(peer.hardware?.cpuUsage ?? 0) }}%</span>
      <span>RAM {{ Math.round(peer.hardware?.ramUsage ?? 0) }}%</span>
    </div>

    <div class="pos-row">Position: ({{ peer.position.x }}, {{ peer.position.y }})</div>
  </div>

  <div v-else class="inspector empty">
    <span>Click a peer to inspect</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PeerState } from '../composables/usePeers';

defineProps<{ peer: PeerState | null }>();

const needLabels = ['social', 'tasked', 'wander', 'creative'];
const explorerLevel = computed(() => 1);

function archetypeIcon(a: string | undefined): string {
  return { Warrior: 'WR', Artisan: 'AR', Scholar: 'SC', Ranger: 'RG' }[a ?? ''] ?? 'PE';
}
</script>

<style scoped>
.inspector {
  height: 100%;
  padding: 10px 14px;
  color: var(--text-strong);
  background: linear-gradient(145deg, var(--surface), var(--surface-strong));
}

.inspector.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 0.84rem;
}

.header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.peer-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 38px;
  border-radius: 12px;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  background: linear-gradient(145deg, rgba(58, 191, 248, 0.15), rgba(255, 107, 107, 0.15));
  box-shadow: var(--shadow-pressed);
}

.identity {
  min-width: 0;
}

.name {
  font-size: 0.95rem;
  font-weight: 800;
}

.traits {
  margin-top: 2px;
  font-size: 0.71rem;
  color: var(--text-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  max-width: 560px;
}

.mood-badge {
  margin-left: auto;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: capitalize;
  border: 1px solid var(--line-soft);
  box-shadow: var(--shadow-pressed);
}

.mood-badge.idle {
  background: rgba(6, 214, 160, 0.2);
  color: #0f8f6f;
}

.mood-badge.working {
  background: rgba(58, 191, 248, 0.22);
  color: #16678d;
}

.mood-badge.busy {
  background: rgba(255, 183, 3, 0.24);
  color: #9e6900;
}

.mood-badge.stressed {
  background: rgba(255, 159, 28, 0.24);
  color: #a85c00;
}

.mood-badge.distressed {
  background: rgba(239, 71, 111, 0.24);
  color: #a22a4a;
}

.needs-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

.need-item {
  display: grid;
  gap: 4px;
}

.need-label {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.need-bar {
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(98, 122, 172, 0.16);
  box-shadow: var(--shadow-pressed);
}

.need-fill {
  height: 100%;
  border-radius: inherit;
}

.need-item:nth-child(1) .need-fill {
  width: 68%;
  background: linear-gradient(90deg, #ff6b6b, #ffb703);
}

.need-item:nth-child(2) .need-fill {
  width: 52%;
  background: linear-gradient(90deg, #3abff8, #10c9a8);
}

.need-item:nth-child(3) .need-fill {
  width: 74%;
  background: linear-gradient(90deg, #10c9a8, #49dcb1);
}

.need-item:nth-child(4) .need-fill {
  width: 61%;
  background: linear-gradient(90deg, #ff4da6, #ff6b6b);
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 7px;
}

.badge {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, rgba(255, 77, 166, 0.18), rgba(58, 191, 248, 0.18));
  color: var(--text-body);
  font-size: 0.63rem;
  font-weight: 700;
}

.hw-row {
  display: flex;
  gap: 16px;
  font-size: 0.71rem;
  color: var(--text-body);
}

.pos-row {
  margin-top: 3px;
  font-size: 0.64rem;
  color: var(--text-muted);
}

@media (max-width: 760px) {
  .needs-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .traits {
    max-width: 280px;
  }
}
</style>