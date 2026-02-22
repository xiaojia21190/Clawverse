<template>
  <div class="town-map" @mouseleave="hoveredPeer = null">
    <div class="map-header">
      <span class="location" v-for="loc in LOCATIONS" :key="loc.name">
        {{ loc.emoji }} {{ loc.name }}
      </span>
      <span v-if="myId" class="my-id">You: {{ myId.slice(0, 8) }}</span>
    </div>
    <div class="grid">
      <div
        v-for="(cell, idx) in grid"
        :key="idx"
        class="cell"
        :class="{
          occupied: cell !== null,
          mine: cell?.id === myId,
          clickable: cell === null && myId,
        }"
        @mouseenter="cell && (hoveredPeer = cell)"
        @click="handleCellClick(idx)"
      >
        <span v-if="cell" class="peer-icon" :style="{ color: cell.dna.appearance.primaryColor }">
          {{ archetypeIcon(cell.dna.archetype) }}
        </span>
        <span v-else-if="isMoveTarget(idx)" class="target-dot">·</span>
      </div>
    </div>
    <PeerCard v-if="hoveredPeer" :peer="hoveredPeer" class="tooltip" />
    <div v-if="moveError" class="move-error">{{ moveError }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PeerState } from '../composables/usePeers';
import PeerCard from './PeerCard.vue';

const props = defineProps<{
  peers: Map<string, PeerState>;
  myId?: string;
}>();

const emit = defineEmits<{ move: [{ x: number; y: number }] }>();

const GRID_SIZE = 40;
const hoveredPeer = ref<PeerState | null>(null);
const pendingMoveIdx = ref<number | null>(null);
const moveError = ref('');

const LOCATIONS = [
  { name: 'Plaza', emoji: '🏛️' },
  { name: 'Market', emoji: '🏪' },
  { name: 'Library', emoji: '📚' },
  { name: 'Workshop', emoji: '🏭' },
  { name: 'Park', emoji: '🌳' },
  { name: 'Tavern', emoji: '🍺' },
];

const grid = computed(() => {
  const cells: Array<PeerState | null> = new Array(GRID_SIZE * GRID_SIZE).fill(null);
  for (const peer of props.peers.values()) {
    const x = Math.max(0, Math.min(GRID_SIZE - 1, peer.position.x));
    const y = Math.max(0, Math.min(GRID_SIZE - 1, peer.position.y));
    cells[y * GRID_SIZE + x] = peer;
  }
  return cells;
});

function archetypeIcon(archetype: string): string {
  const map: Record<string, string> = {
    Warrior: '🦀',
    Artisan: '🦐',
    Scholar: '🐙',
    Ranger: '🦑',
  };
  return map[archetype] ?? '🐚';
}

function isMoveTarget(idx: number): boolean {
  return pendingMoveIdx.value === idx;
}

async function handleCellClick(idx: number): Promise<void> {
  if (!props.myId) return;
  if (grid.value[idx] !== null) return; // occupied

  const x = idx % GRID_SIZE;
  const y = Math.floor(idx / GRID_SIZE);

  pendingMoveIdx.value = idx;
  moveError.value = '';

  try {
    const res = await fetch('/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x, y }),
    });
    if (!res.ok) {
      moveError.value = `Move failed: ${res.status}`;
    } else {
      emit('move', { x, y });
    }
  } catch (err) {
    moveError.value = `Move error: ${(err as Error).message}`;
  } finally {
    setTimeout(() => { pendingMoveIdx.value = null; }, 1000);
  }
}
</script>

<style scoped>
.town-map {
  flex: 1;
  position: relative;
  overflow: hidden;
  padding: 8px;
}

.map-header {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 11px;
  color: #8b949e;
  flex-wrap: wrap;
  align-items: center;
}

.my-id {
  margin-left: auto;
  color: #58a6ff;
  font-family: monospace;
}

.grid {
  display: grid;
  grid-template-columns: repeat(40, 1fr);
  gap: 1px;
  width: 100%;
  aspect-ratio: 1;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 4px;
  overflow: hidden;
}

.cell {
  background: #0d1117;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  cursor: default;
  transition: background 0.1s;
}

.cell.occupied { background: #1c2128; cursor: pointer; }
.cell.occupied:hover { background: #21262d; }
.cell.mine { background: #1a2a1a; outline: 1px solid #3fb950; }
.cell.clickable { cursor: crosshair; }
.cell.clickable:hover { background: #161f2e; }

.peer-icon { line-height: 1; }

.target-dot { color: #58a6ff; font-size: 14px; opacity: 0.6; }

.tooltip {
  position: absolute;
  top: 50px;
  right: 16px;
  z-index: 10;
}

.move-error {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: #3d1a1a;
  color: #f85149;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
}
</style>
