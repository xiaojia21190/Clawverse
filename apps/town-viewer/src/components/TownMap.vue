<template>
  <div class="town-map" @mouseleave="hoveredPeer = null">
    <div class="map-header">
      <span class="location" v-for="loc in LOCATIONS" :key="loc.name">
        {{ loc.badge }} {{ loc.name }}
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
        <span v-else-if="isMoveTarget(idx)" class="target-dot">.</span>
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
  { name: 'Plaza', badge: 'PZ' },
  { name: 'Market', badge: 'MK' },
  { name: 'Library', badge: 'LB' },
  { name: 'Workshop', badge: 'WK' },
  { name: 'Park', badge: 'PK' },
  { name: 'Tavern', badge: 'TV' },
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
    Warrior: 'W',
    Artisan: 'A',
    Scholar: 'S',
    Ranger: 'R',
  };
  return map[archetype] ?? 'P';
}

function isMoveTarget(idx: number): boolean {
  return pendingMoveIdx.value === idx;
}

async function handleCellClick(idx: number): Promise<void> {
  if (!props.myId) return;
  if (grid.value[idx] !== null) return;

  const x = idx % GRID_SIZE;
  const y = Math.floor(idx / GRID_SIZE);

  pendingMoveIdx.value = idx;
  moveError.value = '';

  try {
    const res = await fetch('/brain/guidance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'move',
        payload: { x, y },
        ttlMs: 10 * 60_000,
      }),
    });
    if (!res.ok) {
      moveError.value = `Suggest failed: ${res.status}`;
    } else {
      emit('move', { x, y });
    }
  } catch (err) {
    moveError.value = `Suggest error: ${(err as Error).message}`;
  } finally {
    setTimeout(() => {
      pendingMoveIdx.value = null;
    }, 1000);
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
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--text-body);
}

.location {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(91, 114, 164, 0.12);
  box-shadow: var(--shadow-pressed);
}

.my-id {
  margin-left: auto;
  color: var(--accent-sky);
  font-family: 'JetBrains Mono', 'Cascadia Mono', monospace;
}

.grid {
  display: grid;
  grid-template-columns: repeat(40, 1fr);
  gap: 1px;
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: rgba(145, 166, 209, 0.2);
}

.cell {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(246, 250, 255, 0.8);
  cursor: default;
  transition: background 0.14s ease;
  font-size: 10px;
}

.cell.occupied {
  cursor: pointer;
  background: rgba(231, 239, 255, 0.95);
}

.cell.occupied:hover {
  background: rgba(216, 230, 255, 0.95);
}

.cell.mine {
  background: rgba(16, 201, 168, 0.2);
  outline: 1px solid rgba(16, 201, 168, 0.58);
}

.cell.clickable {
  cursor: crosshair;
}

.cell.clickable:hover {
  background: rgba(58, 191, 248, 0.17);
}

.peer-icon {
  line-height: 1;
  font-weight: 800;
}

.target-dot {
  color: var(--accent-sky);
  font-size: 14px;
  opacity: 0.65;
}

.tooltip {
  position: absolute;
  top: 50px;
  right: 16px;
  z-index: 10;
}

.move-error {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  border-radius: 999px;
  border: 1px solid rgba(239, 71, 111, 0.24);
  background: rgba(239, 71, 111, 0.13);
  color: #a22a4a;
  padding: 4px 10px;
  font-size: 11px;
}
</style>
