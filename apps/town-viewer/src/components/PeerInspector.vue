<template>
  <div v-if="peer" class="inspector">
    <div class="header">
      <span class="peer-icon" :style="{ color: peer.dna?.appearance?.primaryColor ?? '#58a6ff' }">
        {{ archetypeIcon(peer.dna?.archetype) }}
      </span>
      <div class="identity">
        <div class="name">{{ peer.name }}</div>
        <div class="traits">{{ peer.dna?.archetype }} · {{ peer.dna?.modelTrait }} · Lv.{{ explorerLevel }}</div>
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
    <div class="pos-row">
      Position: ({{ peer.position.x }}, {{ peer.position.y }})
    </div>
  </div>
  <div v-else class="inspector empty">
    <span>Click a peer to inspect</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PeerState } from '../composables/usePeers';

const props = defineProps<{ peer: PeerState | null }>();

const needLabels = ['social', 'tasked', 'wander', 'creative'];
const explorerLevel = computed(() => 1);

function archetypeIcon(a: string | undefined): string {
  return { Warrior: '🦀', Artisan: '🦐', Scholar: '🐙', Ranger: '🦑' }[a ?? ''] ?? '🐚';
}
</script>

<style scoped>
.inspector {
  background: #0d1117;
  border-top: 1px solid #30363d;
  padding: 8px 12px;
  font-size: 12px;
  color: #e6edf3;
}
.inspector.empty {
  color: #6e7681;
  text-align: center;
  padding: 12px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.peer-icon { font-size: 24px; }
.name { font-weight: 600; font-size: 14px; }
.traits { color: #8b949e; font-size: 11px; }
.mood-badge {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  text-transform: capitalize;
}
.mood-badge.idle { background: #1a3a1a; color: #3fb950; }
.mood-badge.working { background: #1a2a3a; color: #58a6ff; }
.mood-badge.busy { background: #3a3a1a; color: #d29922; }
.mood-badge.stressed { background: #3a2a1a; color: #f0883e; }
.mood-badge.distressed { background: #3a1a1a; color: #f85149; }
.needs-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.need-item { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.need-label { color: #6e7681; font-size: 10px; }
.need-bar { width: 40px; height: 5px; background: #21262d; border-radius: 3px; overflow: hidden; }
.need-fill { width: 50%; height: 100%; background: #3fb950; border-radius: 3px; }
.badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.badge {
  background: #2a1f3a;
  color: #a371f7;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
}
.hw-row {
  color: #6e7681;
  font-size: 11px;
  display: flex;
  gap: 16px;
}
.pos-row {
  color: #6e7681;
  font-size: 10px;
  margin-top: 4px;
}
</style>
