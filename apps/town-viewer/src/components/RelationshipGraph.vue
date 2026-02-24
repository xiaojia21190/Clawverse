<template>
  <div class="graph-wrapper" ref="wrapperRef">
    <canvas ref="canvasRef" class="graph-canvas" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import type { PeerState } from '../composables/usePeers';

export interface RelationData {
  peerId: string;
  sentiment: number;
  tier: string;
  interactionCount: number;
}

const props = defineProps<{
  peers: Map<string, PeerState>;
  relationships: Record<string, RelationData>;
}>();

const wrapperRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const TIER_COLORS: Record<string, string> = {
  ally: '#3fb950',
  friend: '#58a6ff',
  acquaintance: '#8b949e',
  stranger: '#484f58',
  rival: '#d29922',
  nemesis: '#f85149',
};

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const peerList = Array.from(props.peers.values());
  if (peerList.length === 0) return;

  // Simple circular layout
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 30;
  const positions = new Map<string, { x: number; y: number }>();

  peerList.forEach((p, i) => {
    const angle = (2 * Math.PI * i) / peerList.length - Math.PI / 2;
    positions.set(p.id, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });

  // Draw relationship lines
  for (const [key, rel] of Object.entries(props.relationships)) {
    const [fromId, toId] = key.includes('::') ? key.split('::') : [key, rel.peerId];
    const from = positions.get(fromId);
    const to = positions.get(toId ?? '');
    if (!from || !to) continue;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = TIER_COLORS[rel.tier] ?? '#484f58';
    ctx.lineWidth = Math.max(1, Math.min(3, rel.interactionCount / 5));
    ctx.globalAlpha = 0.4 + Math.abs(rel.sentiment) * 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Draw peer nodes
  for (const peer of peerList) {
    const pos = positions.get(peer.id);
    if (!pos) continue;

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = peer.dna?.appearance?.primaryColor ?? '#58a6ff';
    ctx.fill();
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Name label
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#8b949e';
    ctx.fillText(peer.name.slice(0, 12), pos.x, pos.y + 12);
  }
}

function resize() {
  const canvas = canvasRef.value;
  const wrapper = wrapperRef.value;
  if (!canvas || !wrapper) return;
  canvas.width = wrapper.clientWidth;
  canvas.height = wrapper.clientHeight;
  draw();
}

watch([() => props.peers, () => props.relationships], draw, { deep: true });

const ro = new ResizeObserver(resize);
onMounted(() => {
  if (wrapperRef.value) ro.observe(wrapperRef.value);
  resize();
});
onUnmounted(() => ro.disconnect());
</script>

<style scoped>
.graph-wrapper {
  width: 100%;
  height: 100%;
  min-height: 200px;
  background: #0d1117;
}
.graph-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
