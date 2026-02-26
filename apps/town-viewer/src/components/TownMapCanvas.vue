<template>
  <div class="map-wrapper" ref="wrapperRef">
    <canvas
      ref="canvasRef"
      class="map-canvas"
      @click="onCanvasClick"
      @mousemove="onMouseMove"
      @mouseleave="hoveredPeer = null"
    />

    <div v-if="hoveredPeer" class="tooltip" :style="tooltipStyle">
      <div class="tip-name">{{ hoveredPeer.name }}</div>
      <div class="tip-info">{{ hoveredPeer.dna?.archetype }} - {{ hoveredPeer.mood }}</div>
      <div class="tip-pos">({{ hoveredPeer.position.x }}, {{ hoveredPeer.position.y }})</div>
    </div>

    <div v-if="moveError" class="move-error">{{ moveError }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import type { PeerState } from '../composables/usePeers';
import type { WorldMapData } from '../composables/useWorldMap';
import type { RelationshipInfo } from '../composables/useRelationships';

const props = defineProps<{
  peers: Map<string, PeerState>;
  myId: string | null;
  worldMap: WorldMapData | null;
  showRelations?: boolean;
  relationships?: RelationshipInfo[];
  selectedPeerId?: string | null;
}>();

const emit = defineEmits<{
  move: [{ x: number; y: number }];
  selectPeer: [string | null];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const wrapperRef = ref<HTMLDivElement | null>(null);
const hoveredPeer = ref<PeerState | null>(null);
const tooltipStyle = ref('');
const moveError = ref('');

const GRID = 40;
const MOVE_DURATION = 200; // ms

// Animation state
const prevPositions = new Map<string, { x: number; y: number; startTime: number; fromX: number; fromY: number }>();
let animFrameId: number | null = null;
let animStartTime = 0;

const ZONE_COLORS: Record<string, string> = {
  Plaza: '#fce8ef',
  Market: '#fff3d2',
  Library: '#dff6ff',
  Workshop: '#ffe8dc',
  Park: '#ddf8e9',
  Tavern: '#f7e8ff',
  Residential: '#e8ecff',
};

const TERRAIN_COLORS: Record<string, string> = {
  grass: '#e6f8ee',
  road: '#f6e3d2',
  water: '#d6eeff',
};

const ARCHETYPE_MARKERS: Record<string, string> = {
  Warrior: 'W',
  Artisan: 'A',
  Scholar: 'S',
  Ranger: 'R',
};

const BUILDING_MARKERS: Record<string, string> = {
  forge: 'F',
  archive: 'A',
  beacon: 'B',
  market_stall: 'M',
  shelter: 'H',
};

const MOOD_COLORS: Record<string, string> = {
  idle: '#10c9a8',
  working: '#3abff8',
  busy: '#ffb703',
  stressed: '#ff8c42',
  distressed: '#ef476f',
  sleeping: '#8ea4d8',
};

const MOOD_ICONS: Record<string, string> = {
  idle: '\u{1F634}',
  working: '\u2699',
  busy: '\u{1F525}',
  stressed: '\u26A0',
  distressed: '\u{1F480}',
  sleeping: '\u{1F4A4}',
};

const RELATION_COLORS: Record<string, string> = {
  ally: '#10c9a8',
  friend: '#3abff8',
  acquaintance: '#94a2c6',
  nemesis: '#ef476f',
  rival: '#ff9f1c',
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function getAnimatedPos(peerId: string, targetX: number, targetY: number, now: number): { x: number; y: number } {
  const prev = prevPositions.get(peerId);
  if (!prev) {
    prevPositions.set(peerId, { x: targetX, y: targetY, startTime: now, fromX: targetX, fromY: targetY });
    return { x: targetX, y: targetY };
  }

  if (prev.x !== targetX || prev.y !== targetY) {
    prev.fromX = prev.x;
    prev.fromY = prev.y;
    prev.startTime = now;
    prev.x = targetX;
    prev.y = targetY;
  }

  const elapsed = now - prev.startTime;
  const t = Math.min(1, elapsed / MOVE_DURATION);
  const eased = t * (2 - t); // easeOutQuad
  return {
    x: lerp(prev.fromX, targetX, eased),
    y: lerp(prev.fromY, targetY, eased),
  };
}

function draw(now: number): void {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cs = getCellSize();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Terrain + zones
  const terrain = props.worldMap?.terrain ?? [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const t = terrain[y * GRID + x] ?? 'grass';
      const zone = zoneName(x, y);
      if (t === 'road') ctx.fillStyle = TERRAIN_COLORS.road;
      else if (t === 'water') ctx.fillStyle = TERRAIN_COLORS.water;
      else ctx.fillStyle = ZONE_COLORS[zone] ?? TERRAIN_COLORS.grass;
      ctx.fillRect(x * cs, y * cs, cs, cs);
    }
  }

  // Grid lines
  ctx.strokeStyle = 'rgba(107, 130, 174, 0.2)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cs, 0);
    ctx.lineTo(i * cs, GRID * cs);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cs);
    ctx.lineTo(GRID * cs, i * cs);
    ctx.stroke();
  }

  // Zone borders
  ctx.strokeStyle = '#9bb0d8';
  ctx.lineWidth = 1.5;
  for (const bx of [10, 20]) {
    ctx.beginPath();
    ctx.moveTo(bx * cs, 0);
    ctx.lineTo(bx * cs, GRID * cs);
    ctx.stroke();
  }
  for (const by of [10, 20]) {
    ctx.beginPath();
    ctx.moveTo(0, by * cs);
    ctx.lineTo(GRID * cs, by * cs);
    ctx.stroke();
  }

  // Zone labels
  ctx.font = '10px "Manrope", sans-serif';
  ctx.fillStyle = '#6a7ea9';
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
  for (const label of labels) {
    ctx.fillText(label.name, label.x * cs + 2, label.y * cs + 2);
  }

  // Buildings
  const buildings = props.worldMap?.buildings ?? [];
  for (const b of buildings) {
    const bx = b.position.x * cs;
    const by = b.position.y * cs;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.fillRect(bx + 1, by + 1, cs - 2, cs - 2);
    ctx.strokeStyle = '#7f97cb';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 1, by + 1, cs - 2, cs - 2);
    if (cs >= 12) {
      ctx.font = `${Math.max(8, cs - 6)}px "Manrope", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2a406f';
      ctx.fillText(BUILDING_MARKERS[b.type] ?? 'B', bx + cs / 2, by + cs / 2);
    }
  }

  // Relationship lines (real tier colors)
  if (props.showRelations) {
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.35;
    const peerList = Array.from(props.peers.values());
    const relMap = new Map<string, string>();
    if (props.relationships) {
      for (const r of props.relationships) {
        relMap.set(r.peerId, r.tier);
      }
    }

    for (let i = 0; i < peerList.length; i++) {
      for (let j = i + 1; j < peerList.length; j++) {
        const a = peerList[i];
        const b = peerList[j];
        const tier = relMap.get(b.id) ?? relMap.get(a.id) ?? 'stranger';
        if (tier === 'stranger') continue;

        const color = RELATION_COLORS[tier] ?? '#94a2c6';
        ctx.strokeStyle = color;
        ctx.lineWidth = tier === 'ally' ? 2 : tier === 'nemesis' ? 2 : 1;

        const aPos = getAnimatedPos(a.id, a.position.x, a.position.y, now);
        const bPos = getAnimatedPos(b.id, b.position.x, b.position.y, now);
        ctx.beginPath();
        ctx.moveTo(aPos.x * cs + cs / 2, aPos.y * cs + cs / 2);
        ctx.lineTo(bPos.x * cs + cs / 2, bPos.y * cs + cs / 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Peers with animation
  for (const peer of props.peers.values()) {
    const animPos = getAnimatedPos(peer.id, peer.position.x, peer.position.y, now);
    const px = animPos.x * cs + cs / 2;
    const py = animPos.y * cs + cs / 2;
    const r = Math.max(4, cs / 2 - 2);
    const isMe = peer.id === props.myId;
    const isSelected = peer.id === props.selectedPeerId;

    // Peer circle
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = peer.dna?.appearance?.primaryColor ?? MOOD_COLORS[peer.mood] ?? '#8ea4d8';
    ctx.fill();

    // Mood ring
    ctx.strokeStyle = MOOD_COLORS[peer.mood] ?? '#8ea4d8';
    ctx.lineWidth = 2;
    ctx.stroke();

    // My indicator
    if (isMe) {
      ctx.beginPath();
      ctx.arc(px, py, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#10c9a8';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Selected: breathing halo
    if (isSelected) {
      const pulse = Math.sin(now * 0.003) * 2;
      const haloR = r + 5 + pulse;
      const alpha = 0.3 + Math.sin(now * 0.004) * 0.15;
      ctx.beginPath();
      ctx.arc(px, py, haloR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(16, 201, 168, ${alpha})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Inner glow
      ctx.beginPath();
      ctx.arc(px, py, haloR + 2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(16, 201, 168, ${alpha * 0.4})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Archetype letter
    if (cs >= 16) {
      ctx.font = `${Math.max(7, cs - 10)}px "Manrope", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#243150';
      ctx.fillText(ARCHETYPE_MARKERS[peer.dna?.archetype ?? ''] ?? 'P', px, py);
    }

    // Name label
    if (cs >= 20) {
      ctx.font = '9px "Manrope", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#25314d';
      ctx.fillText(peer.name.slice(0, 10), px, py + r + 3);
    }

    // Mood icon overlay
    if (cs >= 16) {
      const icon = MOOD_ICONS[peer.mood];
      if (icon) {
        ctx.font = `${Math.max(8, cs * 0.35)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(icon, px, py - r - 1);
      }
    }
  }
}

function animLoop(timestamp: number): void {
  if (!animStartTime) animStartTime = timestamp;
  draw(timestamp);
  animFrameId = requestAnimationFrame(animLoop);
}

function resize(): void {
  const canvas = canvasRef.value;
  const wrapper = wrapperRef.value;
  if (!canvas || !wrapper) return;

  const size = Math.min(wrapper.clientWidth, wrapper.clientHeight, 800);
  canvas.width = size;
  canvas.height = size;
}

function onMouseMove(e: MouseEvent): void {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const cs = getCellSize();
  const gx = Math.floor((e.clientX - rect.left) / cs);
  const gy = Math.floor((e.clientY - rect.top) / cs);

  hoveredPeer.value =
    Array.from(props.peers.values()).find(p => p.position.x === gx && p.position.y === gy) ?? null;

  if (hoveredPeer.value) {
    tooltipStyle.value = `left:${e.clientX - rect.left + 12}px;top:${e.clientY - rect.top}px`;
  }
}

async function onCanvasClick(e: MouseEvent): Promise<void> {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const cs = getCellSize();
  const x = Math.floor((e.clientX - rect.left) / cs);
  const y = Math.floor((e.clientY - rect.top) / cs);
  if (x < 0 || x >= GRID || y < 0 || y >= GRID) return;

  // Check if clicking on a peer
  const clickedPeer = Array.from(props.peers.values()).find(
    p => p.position.x === x && p.position.y === y
  );
  if (clickedPeer) {
    emit('selectPeer', clickedPeer.id);
    return;
  }

  // Otherwise, move
  if (!props.myId) return;
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
    setTimeout(() => { moveError.value = ''; }, 2200);
  }
}

const ro = new ResizeObserver(resize);
onMounted(() => {
  if (wrapperRef.value) ro.observe(wrapperRef.value);
  resize();
  animFrameId = requestAnimationFrame(animLoop);
});
onUnmounted(() => {
  ro.disconnect();
  if (animFrameId !== null) cancelAnimationFrame(animFrameId);
});
</script>

<style scoped>
.map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line-soft);
  background:
    radial-gradient(circle at 12% 14%, rgba(255, 183, 3, 0.2), transparent 45%),
    radial-gradient(circle at 88% 86%, rgba(58, 191, 248, 0.26), transparent 44%),
    linear-gradient(145deg, #f4f8ff, #ffffff);
  box-shadow: var(--shadow-pressed);
}

.map-canvas {
  display: block;
  cursor: crosshair;
  image-rendering: pixelated;
}

.tooltip {
  position: absolute;
  z-index: 10;
  pointer-events: none;
  white-space: nowrap;
  padding: 7px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-float);
  font-size: 12px;
  color: var(--text-strong);
}

.tip-name {
  font-size: 0.8rem;
  font-weight: 800;
  color: var(--accent-sky);
}

.tip-info {
  margin-top: 2px;
  font-size: 0.7rem;
  color: var(--text-body);
}

.tip-pos {
  margin-top: 2px;
  font-size: 0.62rem;
  color: var(--text-muted);
}

.move-error {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(239, 71, 111, 0.24);
  background: rgba(239, 71, 111, 0.12);
  color: #a22a4a;
  font-size: 0.69rem;
  font-weight: 700;
}
</style>
