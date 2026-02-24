<template>
  <div class="map-wrapper" ref="wrapperRef">
    <canvas ref="canvasRef" class="map-canvas" @click="onCanvasClick" @mousemove="onMouseMove" @mouseleave="hoveredPeer = null" />
    <div v-if="hoveredPeer" class="tooltip" :style="tooltipStyle">
      <div class="tip-name">{{ hoveredPeer.name }}</div>
      <div class="tip-info">{{ hoveredPeer.dna?.archetype }} · {{ hoveredPeer.mood }}</div>
      <div class="tip-pos">({{ hoveredPeer.position.x }}, {{ hoveredPeer.position.y }})</div>
    </div>
    <div v-if="moveError" class="move-error">{{ moveError }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import type { PeerState } from '../composables/usePeers';
import type { WorldMapData } from '../composables/useWorldMap';

const props = defineProps<{
  peers: Map<string, PeerState>;
  myId: string | null;
  worldMap: WorldMapData | null;
  showRelations?: boolean;
}>();

const emit = defineEmits<{ move: [{ x: number; y: number }] }>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const wrapperRef = ref<HTMLDivElement | null>(null);
const hoveredPeer = ref<PeerState | null>(null);
const tooltipStyle = ref('');
const moveError = ref('');

const GRID = 40;

const ZONE_COLORS: Record<string, string> = {
  Plaza: '#2a3a2a',
  Market: '#2a2a3a',
  Library: '#1a2a3a',
  Workshop: '#2a1a1a',
  Park: '#1a3a1a',
  Tavern: '#3a2a1a',
  Residential: '#1a1a2a',
};

const TERRAIN_COLORS: Record<string, string> = {
  grass: '#1a2e1a',
  road: '#3a2e1a',
  water: '#0d1a2e',
};

const ARCHETYPE_EMOJIS: Record<string, string> = {
  Warrior: '🦀',
  Artisan: '🦐',
  Scholar: '🐙',
  Ranger: '🦑',
};

const BUILDING_EMOJIS: Record<string, string> = {
  forge: '⚒',
  archive: '📚',
  beacon: '🔦',
  market_stall: '🏪',
  shelter: '⛺',
};

const MOOD_COLORS: Record<string, string> = {
  idle: '#4a8c4a',
  working: '#4a7a8c',
  busy: '#8c8c4a',
  stressed: '#8c5a4a',
  distressed: '#8c2a2a',
  sleeping: '#4a4a6a',
};

const RELATION_COLORS: Record<string, string> = {
  ally: '#3fb950',
  friend: '#58a6ff',
  stranger: '#484f58',
  nemesis: '#f85149',
  rival: '#d29922',
};

function getCellSize(): number {
  const canvas = canvasRef.value;
  if (!canvas) return 12;
  return Math.floor(Math.min(canvas.width, canvas.height) / GRID);
}

function zoneName(x: number, y: number): string {
  if (x < 10 && y < 10) return 'Plaza';
  if (x >= 10 && x < 20 && y < 10) return 'Market';
  if (x < 10 && y >= 10 && y < 20) return 'Library';
  if (x >= 10 && x < 20 && y >= 10 && y < 20) return 'Workshop';
  if (x < 10 && y >= 20) return 'Park';
  if (x >= 10 && x < 20 && y >= 20) return 'Tavern';
  return 'Residential';
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cs = getCellSize();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Layer 0: terrain + zone colors
  const terrain = props.worldMap?.terrain ?? [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const t = terrain[y * GRID + x] ?? 'grass';
      const zone = zoneName(x, y);
      if (t === 'road') {
        ctx.fillStyle = TERRAIN_COLORS.road;
      } else if (t === 'water') {
        ctx.fillStyle = TERRAIN_COLORS.water;
      } else {
        ctx.fillStyle = ZONE_COLORS[zone] ?? TERRAIN_COLORS.grass;
      }
      ctx.fillRect(x * cs, y * cs, cs, cs);
    }
  }

  // Grid lines (very subtle)
  ctx.strokeStyle = 'rgba(48,54,61,0.3)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * cs, 0); ctx.lineTo(i * cs, GRID * cs); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cs); ctx.lineTo(GRID * cs, i * cs); ctx.stroke();
  }

  // Zone borders (thicker)
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1.5;
  for (const bx of [10, 20]) {
    ctx.beginPath(); ctx.moveTo(bx * cs, 0); ctx.lineTo(bx * cs, GRID * cs); ctx.stroke();
  }
  for (const by of [10, 20]) {
    ctx.beginPath(); ctx.moveTo(0, by * cs); ctx.lineTo(GRID * cs, by * cs); ctx.stroke();
  }

  // Zone labels
  ctx.font = '10px monospace';
  ctx.fillStyle = '#484f58';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const labels = [
    { name: 'Plaza', x: 1, y: 1 },
    { name: 'Market', x: 11, y: 1 },
    { name: 'Library', x: 1, y: 11 },
    { name: 'Workshop', x: 11, y: 11 },
    { name: 'Park', x: 1, y: 21 },
    { name: 'Tavern', x: 11, y: 21 },
  ];
  for (const l of labels) {
    ctx.fillText(l.name, l.x * cs + 2, l.y * cs + 2);
  }

  // Layer 1: buildings
  const buildings = props.worldMap?.buildings ?? [];
  for (const b of buildings) {
    const bx = b.position.x * cs;
    const by = b.position.y * cs;

    // Building background
    ctx.fillStyle = 'rgba(42,32,64,0.7)';
    ctx.fillRect(bx + 1, by + 1, cs - 2, cs - 2);

    // Building border
    ctx.strokeStyle = '#6e40c9';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 1, by + 1, cs - 2, cs - 2);

    // Building emoji
    if (cs >= 12) {
      ctx.font = `${Math.max(8, cs - 6)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(BUILDING_EMOJIS[b.type] ?? '🏠', bx + cs / 2, by + cs / 2);
    }
  }

  // Layer 2: relation lines (optional)
  if (props.showRelations) {
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.25;
    const peerList = Array.from(props.peers.values());
    for (let i = 0; i < peerList.length; i++) {
      for (let j = i + 1; j < peerList.length; j++) {
        const a = peerList[i];
        const b = peerList[j];
        ctx.strokeStyle = RELATION_COLORS.friend;
        ctx.beginPath();
        ctx.moveTo(a.position.x * cs + cs / 2, a.position.y * cs + cs / 2);
        ctx.lineTo(b.position.x * cs + cs / 2, b.position.y * cs + cs / 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Layer 3: peers
  for (const peer of props.peers.values()) {
    const px = peer.position.x * cs + cs / 2;
    const py = peer.position.y * cs + cs / 2;
    const r = Math.max(4, cs / 2 - 2);
    const isMe = peer.id === props.myId;

    // Mood-colored circle
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = peer.dna?.appearance?.primaryColor ?? MOOD_COLORS[peer.mood] ?? '#4a4a4a';
    ctx.fill();

    // Mood ring
    ctx.strokeStyle = MOOD_COLORS[peer.mood] ?? '#4a4a4a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // "Me" highlight (green glow)
    if (isMe) {
      ctx.beginPath();
      ctx.arc(px, py, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#3fb950';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Archetype emoji overlay
    if (cs >= 16) {
      ctx.font = `${Math.max(8, cs - 8)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ARCHETYPE_EMOJIS[peer.dna?.archetype ?? ''] ?? '🐚', px, py);
    }

    // Name label (if cell size big enough)
    if (cs >= 20) {
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(peer.name.slice(0, 10), px, py + r + 3);
    }
  }
}

function resize() {
  const canvas = canvasRef.value;
  const wrapper = wrapperRef.value;
  if (!canvas || !wrapper) return;
  const size = Math.min(wrapper.clientWidth, wrapper.clientHeight, 800);
  canvas.width = size;
  canvas.height = size;
  draw();
}

function onMouseMove(e: MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const cs = getCellSize();
  const gx = Math.floor((e.clientX - rect.left) / cs);
  const gy = Math.floor((e.clientY - rect.top) / cs);
  hoveredPeer.value = Array.from(props.peers.values()).find(
    p => p.position.x === gx && p.position.y === gy
  ) ?? null;
  if (hoveredPeer.value) {
    tooltipStyle.value = `left:${e.clientX - rect.left + 12}px;top:${e.clientY - rect.top}px`;
  }
}

async function onCanvasClick(e: MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas || !props.myId) return;
  const rect = canvas.getBoundingClientRect();
  const cs = getCellSize();
  const x = Math.floor((e.clientX - rect.left) / cs);
  const y = Math.floor((e.clientY - rect.top) / cs);
  if (x < 0 || x >= GRID || y < 0 || y >= GRID) return;

  moveError.value = '';
  try {
    const res = await fetch('/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x, y }),
    });
    if (!res.ok) moveError.value = `Move failed (${res.status})`;
    else emit('move', { x, y });
  } catch (err) {
    moveError.value = `Move error: ${(err as Error).message}`;
  } finally {
    setTimeout(() => { moveError.value = ''; }, 2000);
  }
}

watch([() => props.peers, () => props.worldMap, () => props.showRelations], draw, { deep: true });

const ro = new ResizeObserver(resize);
onMounted(() => {
  if (wrapperRef.value) ro.observe(wrapperRef.value);
  resize();
});
onUnmounted(() => ro.disconnect());
</script>

<style scoped>
.map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0d1117;
  overflow: hidden;
}
.map-canvas {
  cursor: crosshair;
  display: block;
  image-rendering: pixelated;
}
.tooltip {
  position: absolute;
  background: #1c2128;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 6px 10px;
  pointer-events: none;
  font-size: 12px;
  color: #e6edf3;
  z-index: 10;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.tip-name { font-weight: 600; color: #58a6ff; }
.tip-info { color: #8b949e; font-size: 11px; margin-top: 2px; }
.tip-pos { color: #6e7681; font-size: 10px; }
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
