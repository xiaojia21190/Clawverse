<template>
  <div class="map-wrapper" ref="wrapperRef">
    <canvas
      ref="canvasRef"
      class="map-canvas"
      @click="onCanvasClick"
      @mousemove="onMouseMove"
      @mouseleave="hoveredPeer = null"
    />

    <div class="map-hud map-hud-status" :class="hudTone">
      <div class="hud-kicker">Zone</div>
      <div class="hud-value">{{ currentZone }}</div>
      <div class="hud-meta">Tension {{ tension }} · Raid {{ raidRisk }} · Wars {{ activeWarCount }}</div>
      <div class="hud-meta">Critical needs {{ criticalNeedCount }}<span v-if="focusLabel"> · {{ focusLabel }}</span></div>
      <div v-if="focusDetail" class="hud-meta hud-detail">{{ focusDetail }}</div>
    </div>

    <div class="map-hud map-hud-legend">
      <div class="hud-kicker">Legend</div>
      <div class="legend-row">
        <span class="legend-dot ally"></span>
        <span>Alliance</span>
        <span class="legend-dot rival"></span>
        <span>Rivalry</span>
        <span class="legend-dot raid"></span>
        <span>Raid pressure</span>
      </div>
      <div class="legend-row">
        <span class="legend-dot cluster"></span>
        <span>Cluster</span>
      </div>
      <div class="legend-copy">Cells show terrain, zone, building radius and live peer pressure.</div>
    </div>

    <div v-if="hoveredPeer" class="tooltip" :style="tooltipStyle">
      <div class="tip-name">{{ hoveredPeer.name }}</div>
      <div class="tip-info">{{ hoveredPeer.dna?.archetype }} · {{ hoveredPeer.mood }} · {{ hoveredRelationship }}</div>
      <div class="tip-pos">{{ zoneName(hoveredPeer.position.x, hoveredPeer.position.y) }} · ({{ hoveredPeer.position.x }}, {{ hoveredPeer.position.y }})</div>
    </div>

    <div v-if="selectedPeerInfo" class="focus-marker" :style="focusMarkerStyle">
      <div class="focus-marker-chip" :class="{ active: isFocusPulseActive }">
        <span class="target-dot">◎</span>
        <div class="focus-copy">
          <div class="focus-name">{{ selectedPeerInfo.name }}</div>
          <div class="focus-meta">{{ zoneName(selectedPeerInfo.position.x, selectedPeerInfo.position.y) }} · {{ selectedPeerInfo.mood }}</div>
          <div v-if="showFocusIntent" class="focus-meta focus-intent">{{ focusDetail }}</div>
        </div>
      </div>
    </div>

    <div v-if="moveNotice" class="move-error" :class="moveNotice.tone">{{ moveNotice.message }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import type { PeerState } from '../composables/usePeers';
import type { RelationshipInfo } from '../composables/useRelationships';
import type { WorldMapData } from '../composables/useWorldMap';
import {
  findWorldNodeByIdentity,
  findWorldNodeForRelationship,
  mergeWorldNodes,
  relationshipMatchesWorldNode,
  type TopicWorldClusterSummary,
  type WorldNode,
} from '../composables/useWorldNodes';

const props = defineProps<{
  peers: Map<string, PeerState>;
  nodes?: WorldNode[];
  clusters?: TopicWorldClusterSummary[];
  myId: string | null;
  myPosition?: { x: number; y: number } | null;
  worldMap: WorldMapData | null;
  showRelations?: boolean;
  relationships?: RelationshipInfo[];
  selectedPeerId?: string | null;
  tension?: number;
  raidRisk?: number;
  activeWarCount?: number;
  criticalNeedCount?: number;
  focusLabel?: string;
  focusDetail?: string;
}>();

const emit = defineEmits<{
  move: [{ x: number; y: number }];
  selectPeer: [string | null];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const wrapperRef = ref<HTMLDivElement | null>(null);
const hoveredPeer = ref<PeerState | null>(null);
const tooltipStyle = ref('');
const moveNotice = ref<{ tone: 'stable' | 'critical'; message: string } | null>(null);

const GRID = 40;
const MOVE_DURATION = 200;
const FOCUS_PULSE_MS = 1600;

const prevPositions = new Map<string, { x: number; y: number; startTime: number; fromX: number; fromY: number }>();
let animFrameId: number | null = null;
let animStartTime = 0;
const focusPulseIdentity = ref<string | null>(null);
const focusPulseStart = ref(0);
const focusMarkerStyle = ref('');

const ZONE_COLORS: Record<string, string> = {
  Plaza: '#374151',
  Market: '#4b5563',
  Library: '#2f465e',
  Workshop: '#4c3d2a',
  Park: '#2d5a27',
  Tavern: '#5b3b58',
  Residential: '#334155',
};

const ZONE_BORDERS: Record<string, string> = {
  Plaza: '#94a3b8',
  Market: '#f59e0b',
  Library: '#38bdf8',
  Workshop: '#fb923c',
  Park: '#4ade80',
  Tavern: '#c084fc',
  Residential: '#64748b',
};

const TERRAIN_COLORS: Record<string, string> = {
  grass: '#2d5a27',
  road: '#5c4a32',
  water: '#1a3a5c',
};

const BUILDING_MARKERS: Record<string, string> = {
  forge: 'F',
  archive: 'A',
  beacon: 'B',
  market_stall: 'M',
  shelter: 'S',
  watchtower: 'W',
};

const BUILDING_RADII: Record<string, number> = {
  forge: 3,
  archive: 3,
  beacon: 4,
  market_stall: 1,
  shelter: 2,
  watchtower: 4,
};

const BUILDING_COLORS: Record<string, string> = {
  forge: 'rgba(251, 146, 60, 0.18)',
  archive: 'rgba(56, 189, 248, 0.18)',
  beacon: 'rgba(250, 204, 21, 0.14)',
  market_stall: 'rgba(236, 72, 153, 0.14)',
  shelter: 'rgba(74, 222, 128, 0.14)',
  watchtower: 'rgba(248, 113, 113, 0.14)',
};

const CLUSTER_COLORS: Record<string, string> = {
  forming: 'rgba(148, 163, 184, 0.2)',
  stable: 'rgba(74, 222, 128, 0.18)',
  strained: 'rgba(250, 204, 21, 0.18)',
  fracturing: 'rgba(249, 115, 22, 0.18)',
  collapsing: 'rgba(239, 68, 68, 0.18)',
};

const MOOD_COLORS: Record<string, string> = {
  idle: '#4ade80',
  working: '#38bdf8',
  busy: '#f59e0b',
  stressed: '#fb7185',
  distressed: '#ef4444',
  sleeping: '#94a3b8',
};

const RELATION_COLORS: Record<string, string> = {
  ally: '#4ade80',
  friend: '#38bdf8',
  acquaintance: '#94a3b8',
  nemesis: '#ef4444',
  rival: '#fb923c',
};

interface ResolvedRelationEntry {
  relation: RelationshipInfo;
  node: WorldNode;
}

const localPeer = computed(() => (props.myId ? props.peers.get(props.myId) ?? null : null));
const activeNodes = computed(() => mergeWorldNodes(props.nodes ?? [], props.peers, localPeer.value));
const localNode = computed(() => findWorldNodeByIdentity(activeNodes.value, props.myId));
const selectedNode = computed(() => findWorldNodeByIdentity(activeNodes.value, props.selectedPeerId ?? null));
const selectedActorId = computed(() => selectedNode.value?.actorId ?? null);
const localActorId = computed(() => localNode.value?.actorId ?? null);

const currentZone = computed(() => {
  const pos = props.myPosition;
  return pos ? zoneName(pos.x, pos.y) : 'Unknown';
});

const hoveredRelationship = computed(() => {
  const peer = hoveredPeer.value;
  if (!peer) return 'stranger';
  const node = findWorldNodeByIdentity(activeNodes.value, peer.id)
    ?? findWorldNodeByIdentity(activeNodes.value, peer.actorId ?? null);
  if (!node) return 'stranger';
  return props.relationships?.find((item) => relationshipMatchesWorldNode(item, node))?.tier ?? 'stranger';
});

const hudTone = computed(() => {
  if ((props.raidRisk ?? 0) >= 70 || (props.tension ?? 0) >= 75) return 'critical';
  if ((props.raidRisk ?? 0) >= 35 || (props.tension ?? 0) >= 40) return 'watch';
  return 'steady';
});

const tension = computed(() => props.tension ?? 0);
const raidRisk = computed(() => props.raidRisk ?? 0);
const activeWarCount = computed(() => props.activeWarCount ?? 0);
const criticalNeedCount = computed(() => props.criticalNeedCount ?? 0);
const focusLabel = computed(() => props.focusLabel ?? '');
const focusDetail = computed(() => props.focusDetail ?? '');
const selectedPeerInfo = computed(() => selectedNode.value?.state ?? null);
const showFocusIntent = computed(() => !!focusDetail.value && !!selectedActorId.value && selectedActorId.value === localActorId.value);
const resolvedRelationships = computed<ResolvedRelationEntry[]>(() => {
  if (!props.relationships?.length) return [];

  const byActor = new Map<string, { relation: RelationshipInfo; node: WorldNode; score: number }>();
  for (const relation of props.relationships) {
    if (relation.tier === 'stranger') continue;
    const node = findWorldNodeForRelationship(activeNodes.value, relation);
    if (!node) continue;
    const score = Math.abs(relation.sentiment) + relation.interactionCount * 0.1;
    const existing = byActor.get(node.actorId);
    if (!existing || score > existing.score) {
      byActor.set(node.actorId, { relation, node, score });
    }
  }

  return Array.from(byActor.values()).map(({ relation, node }) => ({ relation, node }));
});
const isFocusPulseActive = computed(() => {
  if (!selectedActorId.value || focusPulseIdentity.value !== selectedActorId.value) return false;
  return performance.now() - focusPulseStart.value <= FOCUS_PULSE_MS;
});

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

function getAnimatedPos(identity: string, targetX: number, targetY: number, now: number): { x: number; y: number } {
  const prev = prevPositions.get(identity);
  if (!prev) {
    prevPositions.set(identity, { x: targetX, y: targetY, startTime: now, fromX: targetX, fromY: targetY });
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
  const eased = t * (2 - t);
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

  const terrain = props.worldMap?.terrain ?? [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const cell = terrain[y * GRID + x] ?? 'grass';
      const zone = zoneName(x, y);
      if (cell === 'road') ctx.fillStyle = TERRAIN_COLORS.road;
      else if (cell === 'water') ctx.fillStyle = TERRAIN_COLORS.water;
      else ctx.fillStyle = ZONE_COLORS[zone] ?? TERRAIN_COLORS.grass;
      ctx.fillRect(x * cs, y * cs, cs, cs);
    }
  }

  const globalThreat = Math.min(0.28, (raidRisk.value / 100) * 0.22 + (tension.value / 100) * 0.14);
  if (globalThreat > 0) {
    ctx.fillStyle = `rgba(239, 68, 68, ${globalThreat})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
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

  for (const bx of [10, 20]) {
    ctx.beginPath();
    ctx.moveTo(bx * cs, 0);
    ctx.lineTo(bx * cs, GRID * cs);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  for (const by of [10, 20]) {
    ctx.beginPath();
    ctx.moveTo(0, by * cs);
    ctx.lineTo(GRID * cs, by * cs);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  const clusters = Array.isArray(props.clusters) ? props.clusters : [];
  for (const cluster of clusters) {
    const radius = Math.max(cs * 2, Math.min(cs * 5.2, (cluster.actorCount + cluster.branchCount * 0.35) * cs * 0.55));
    const cx = cluster.center.x * cs + cs / 2;
    const cy = cluster.center.y * cs + cs / 2;
    const fill = CLUSTER_COLORS[cluster.status] ?? 'rgba(148, 163, 184, 0.18)';

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = cluster.local ? 'rgba(56, 189, 248, 0.34)' : 'rgba(226, 232, 240, 0.18)';
    ctx.lineWidth = cluster.local ? 2.2 : 1.2;
    ctx.stroke();

    if (cs >= 12) {
      ctx.font = '10px "IBM Plex Mono", "Fira Code", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = cluster.local ? '#e0f2fe' : '#e2e8f0';
      ctx.fillText(String(cluster.actorCount), cx, cy);
    }
  }

  const labels = [
    { name: 'Plaza', x: 1, y: 1 },
    { name: 'Market', x: 11, y: 1 },
    { name: 'Library', x: 1, y: 11 },
    { name: 'Workshop', x: 11, y: 11 },
    { name: 'Park', x: 1, y: 21 },
    { name: 'Tavern', x: 11, y: 21 },
  ];
  ctx.font = '10px "IBM Plex Mono", "Fira Code", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const label of labels) {
    ctx.fillStyle = ZONE_BORDERS[label.name] ?? '#cbd5e1';
    ctx.fillText(label.name, label.x * cs + 2, label.y * cs + 2);
  }

  const buildings = props.worldMap?.buildings ?? [];
  for (const building of buildings) {
    const radius = BUILDING_RADII[building.type] ?? 1;
    const bx = building.position.x * cs;
    const by = building.position.y * cs;
    ctx.fillStyle = BUILDING_COLORS[building.type] ?? 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(
      Math.max(0, (building.position.x - radius) * cs),
      Math.max(0, (building.position.y - radius) * cs),
      Math.min(canvas.width - Math.max(0, (building.position.x - radius) * cs), (radius * 2 + 1) * cs),
      Math.min(canvas.height - Math.max(0, (building.position.y - radius) * cs), (radius * 2 + 1) * cs),
    );
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(bx + 1, by + 1, cs - 2, cs - 2);
    ctx.strokeStyle = ZONE_BORDERS[zoneName(building.position.x, building.position.y)] ?? '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 1, by + 1, cs - 2, cs - 2);
    if (cs >= 12) {
      ctx.font = `${Math.max(8, cs - 6)}px "IBM Plex Mono", "Fira Code", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(BUILDING_MARKERS[building.type] ?? 'B', bx + cs / 2, by + cs / 2);
    }
  }

  if (props.showRelations) {
    const localAnchor = resolveLocalAnchor(now);
    const focusMode = !!selectedActorId.value && selectedActorId.value !== localActorId.value;

    if (localAnchor && resolvedRelationships.value.length) {
      if (!localAnchor.isPeer) {
        ctx.beginPath();
        ctx.arc(localAnchor.x, localAnchor.y, Math.max(4, cs / 2 - 2), 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(localAnchor.x, localAnchor.y, Math.max(7, cs / 2 + 2), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      for (const { relation, node } of resolvedRelationships.value) {
        if (localActorId.value && node.actorId === localActorId.value) continue;

        const targetPos = getAnimatedPos(node.actorId, node.state.position.x, node.state.position.y, now);
        const tx = targetPos.x * cs + cs / 2;
        const ty = targetPos.y * cs + cs / 2;
        const isFocused = !!selectedActorId.value && node.actorId === selectedActorId.value;
        const baseAlpha = focusMode ? (isFocused ? 0.92 : 0.12) : 0.42;
        const lineWidth = isFocused ? 3 : (relation.tier === 'ally' || relation.tier === 'nemesis' ? 2 : 1.2);
        const color = RELATION_COLORS[relation.tier] ?? '#94a3b8';

        if (isFocused) {
          ctx.beginPath();
          ctx.moveTo(localAnchor.x, localAnchor.y);
          ctx.lineTo(tx, ty);
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.22;
          ctx.lineWidth = lineWidth + 5;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.moveTo(localAnchor.x, localAnchor.y);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = color;
        ctx.globalAlpha = baseAlpha;
        ctx.lineWidth = lineWidth;
        ctx.stroke();

        if (isFocused) {
          drawFocusedRelationshipLabel(ctx, localAnchor.x, localAnchor.y, tx, ty, relation, color);
        }
      }
    }

    ctx.globalAlpha = 1;
  }

  for (const node of activeNodes.value) {
    const peer = node.state;
    const animPos = getAnimatedPos(node.actorId, peer.position.x, peer.position.y, now);
    const px = animPos.x * cs + cs / 2;
    const py = animPos.y * cs + cs / 2;
    const radius = Math.max(4, cs / 2 - 2);
    const isMe = !!localActorId.value && node.actorId === localActorId.value;
    const isSelected = !!selectedActorId.value && node.actorId === selectedActorId.value;

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = peer.dna?.appearance?.primaryColor ?? MOOD_COLORS[peer.mood] ?? '#94a3b8';
    ctx.fill();

    ctx.strokeStyle = MOOD_COLORS[peer.mood] ?? '#94a3b8';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (isMe) {
      ctx.beginPath();
      ctx.arc(px, py, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (isSelected) {
      const pulse = Math.sin(now * 0.003) * 2;
      const haloRadius = radius + 5 + pulse;
      const alpha = 0.3 + Math.sin(now * 0.004) * 0.15;
      ctx.beginPath();
      ctx.arc(px, py, haloRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    if (focusPulseIdentity.value === node.actorId) {
      const elapsed = now - focusPulseStart.value;
      if (elapsed <= FOCUS_PULSE_MS) {
        const progress = elapsed / FOCUS_PULSE_MS;
        const outerRadius = radius + 8 + progress * Math.max(14, cs * 1.6);
        const innerRadius = radius + 4 + progress * Math.max(8, cs * 0.9);
        const alpha = 0.48 * (1 - progress);

        ctx.beginPath();
        ctx.arc(px, py, outerRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(250, 204, 21, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(px, py, innerRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(125, 211, 252, ${alpha * 0.9})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(px, Math.max(0, py - outerRadius - 10));
        ctx.lineTo(px, Math.min(canvas.height, py + outerRadius + 10));
        ctx.moveTo(Math.max(0, px - outerRadius - 10), py);
        ctx.lineTo(Math.min(canvas.width, px + outerRadius + 10), py);
        ctx.strokeStyle = `rgba(125, 211, 252, ${alpha * 0.45})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    if (cs >= 16) {
      ctx.font = `${Math.max(7, cs - 10)}px "IBM Plex Mono", "Fira Code", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(BUILDING_MARKERS[peer.dna?.archetype?.toLowerCase?.() ?? ''] ?? peer.dna?.archetype?.slice(0, 1) ?? 'P', px, py);
    }

    if (cs >= 20) {
      ctx.font = '9px "IBM Plex Mono", "Fira Code", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(peer.name.slice(0, 10), px, py + radius + 3);
    }
  }
}

function animLoop(timestamp: number): void {
  if (!animStartTime) animStartTime = timestamp;
  updateFocusMarker(timestamp);
  draw(timestamp);
  animFrameId = requestAnimationFrame(animLoop);
}

function resize(): void {
  const canvas = canvasRef.value;
  const wrapper = wrapperRef.value;
  if (!canvas || !wrapper) return;

  const size = Math.min(wrapper.clientWidth, wrapper.clientHeight, 820);
  canvas.width = size;
  canvas.height = size;
  updateFocusMarker(performance.now());
}

function resolveLocalAnchor(now: number): { x: number; y: number; isPeer: boolean } | null {
  const cs = getCellSize();

  const me = localNode.value;
  if (me) {
    const pos = getAnimatedPos(me.actorId, me.state.position.x, me.state.position.y, now);
    return { x: pos.x * cs + cs / 2, y: pos.y * cs + cs / 2, isPeer: true };
  }

  if (props.myPosition) {
    return { x: props.myPosition.x * cs + cs / 2, y: props.myPosition.y * cs + cs / 2, isPeer: false };
  }

  return null;
}

function drawFocusedRelationshipLabel(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  relation: RelationshipInfo,
  color: string,
): void {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const label = `${relation.tier} ${relation.sentiment.toFixed(2)}`;
  ctx.save();
  ctx.font = '10px "IBM Plex Mono", "Fira Code", monospace';
  const width = ctx.measureText(label).width + 16;
  const height = 20;
  const x = Math.max(10, Math.min(canvas.width - width - 10, midX - width / 2));
  const y = Math.max(10, Math.min(canvas.height - height - 10, midY - height / 2));

  drawRoundedRect(ctx, x, y, width, height, 10);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + width / 2, y + height / 2 + 0.5);
  ctx.restore();
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function updateFocusMarker(now: number): void {
  const canvas = canvasRef.value;
  const node = selectedNode.value;
  if (!canvas || !node) {
    focusMarkerStyle.value = '';
    return;
  }

  const peer = node.state;
  const cs = getCellSize();
  const animPos = getAnimatedPos(node.actorId, peer.position.x, peer.position.y, now);
  const px = animPos.x * cs + cs / 2;
  const py = animPos.y * cs + cs / 2;
  const markerWidth = 164;
  const markerHeight = 48;
  const left = Math.min(canvas.width - markerWidth - 12, Math.max(12, px + 16));
  const top = Math.min(canvas.height - markerHeight - 12, Math.max(12, py - 26));
  focusMarkerStyle.value = `left:${left}px;top:${top}px`;
}

function triggerFocusPulse(identity: string | null): void {
  focusPulseIdentity.value = identity;
  focusPulseStart.value = identity ? performance.now() : 0;
  updateFocusMarker(focusPulseStart.value || performance.now());
}

function nodeAtGrid(x: number, y: number): WorldNode | null {
  const candidates = activeNodes.value.filter((node) => node.state.position.x === x && node.state.position.y === y);
  if (candidates.length === 0) return null;
  if (selectedActorId.value) {
    const focused = candidates.find((node) => node.actorId === selectedActorId.value);
    if (focused) return focused;
  }
  if (localActorId.value) {
    const local = candidates.find((node) => node.actorId === localActorId.value);
    if (local) return local;
  }
  return candidates[0] ?? null;
}

function onMouseMove(event: MouseEvent): void {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const cs = getCellSize();
  const gridX = Math.floor((event.clientX - rect.left) / cs);
  const gridY = Math.floor((event.clientY - rect.top) / cs);

  hoveredPeer.value = nodeAtGrid(gridX, gridY)?.state ?? null;
  if (hoveredPeer.value) {
    tooltipStyle.value = `left:${event.clientX - rect.left + 12}px;top:${event.clientY - rect.top}px`;
  }
}

watch(() => props.selectedPeerId, (identity, previousIdentity) => {
  const node = findWorldNodeByIdentity(activeNodes.value, identity ?? null);
  const previousNode = findWorldNodeByIdentity(activeNodes.value, previousIdentity ?? null);
  const nextPulseId = node?.actorId ?? identity ?? null;
  const previousPulseId = previousNode?.actorId ?? previousIdentity ?? null;

  if (!nextPulseId) {
    triggerFocusPulse(null);
    return;
  }

  if (nextPulseId !== previousPulseId) {
    triggerFocusPulse(nextPulseId);
    return;
  }

  updateFocusMarker(performance.now());
}, { immediate: true });

watch(() => activeNodes.value.map((node) => `${node.actorId}:${node.state.position.x}:${node.state.position.y}`).join('|'), () => {
  updateFocusMarker(performance.now());
});

watch(() => activeNodes.value.map((node) => node.actorId).join('|'), () => {
  const ids = new Set(activeNodes.value.map((node) => node.actorId));
  for (const key of prevPositions.keys()) {
    if (!ids.has(key)) prevPositions.delete(key);
  }
});

async function onCanvasClick(event: MouseEvent): Promise<void> {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const cs = getCellSize();
  const x = Math.floor((event.clientX - rect.left) / cs);
  const y = Math.floor((event.clientY - rect.top) / cs);
  if (x < 0 || x >= GRID || y < 0 || y >= GRID) return;

  const clickedNode = nodeAtGrid(x, y);
  if (clickedNode) {
    emit('selectPeer', clickedNode.actorId);
    return;
  }

  if (!props.myId) return;
  moveNotice.value = null;
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
      const payload = await res.json().catch(() => ({} as any)) as { error?: string };
      moveNotice.value = { tone: 'critical', message: payload.error ? `Suggest failed: ${payload.error}` : `Suggest failed (${res.status})` };
      return;
    }
    moveNotice.value = { tone: 'stable', message: `Suggested move toward (${x},${y})` };
    emit('move', { x, y });
  } catch (err) {
    moveNotice.value = { tone: 'critical', message: `Suggest error: ${(err as Error).message}` };
  } finally {
    setTimeout(() => {
      moveNotice.value = null;
    }, 2200);
  }
}

const observer = new ResizeObserver(resize);

onMounted(() => {
  if (wrapperRef.value) observer.observe(wrapperRef.value);
  resize();
  animFrameId = requestAnimationFrame(animLoop);
});

onUnmounted(() => {
  observer.disconnect();
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
  border: 1px solid var(--line-strong);
  background: radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.08), transparent 45%), linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(8, 15, 28, 0.96));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03), var(--shadow-float);
}

.map-canvas {
  display: block;
  cursor: crosshair;
  image-rendering: pixelated;
}

.map-hud {
  position: absolute;
  z-index: 5;
  display: grid;
  gap: 4px;
  max-width: min(290px, 40vw);
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: rgba(15, 23, 42, 0.86);
  backdrop-filter: blur(8px);
}

.map-hud-status {
  top: 12px;
  left: 12px;
}

.map-hud-legend {
  right: 12px;
  bottom: 12px;
}

.map-hud.steady {
  box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.12);
}

.map-hud.watch {
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.18);
}

.map-hud.critical {
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.18);
}

.hud-kicker {
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hud-value {
  font-family: var(--font-display);
  font-size: 0.98rem;
  color: var(--text-strong);
}

.hud-meta,
.legend-copy,
.tip-pos,
.tip-info {
  font-size: 0.7rem;
  line-height: 1.4;
  color: var(--text-body);
}

.hud-detail {
  color: var(--text-strong);
}

.legend-row {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr auto 1fr;
  gap: 6px;
  align-items: center;
  font-size: 0.68rem;
  color: var(--text-body);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.legend-dot.ally {
  background: #4ade80;
}

.legend-dot.rival {
  background: #fb923c;
}

.legend-dot.raid {
  background: #ef4444;
}

.legend-dot.cluster {
  background: #4ade80;
}

.tooltip {
  position: absolute;
  z-index: 10;
  pointer-events: none;
  white-space: nowrap;
  padding: 7px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: rgba(15, 23, 42, 0.92);
  box-shadow: var(--shadow-float);
}

.focus-marker {
  position: absolute;
  z-index: 9;
  pointer-events: none;
}

.focus-marker-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 132px;
  padding: 7px 10px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(125, 211, 252, 0.28);
  background: rgba(15, 23, 42, 0.9);
  box-shadow: 0 10px 26px rgba(8, 15, 28, 0.42);
}

.focus-marker-chip.active {
  box-shadow: 0 0 0 1px rgba(125, 211, 252, 0.18), 0 10px 26px rgba(8, 15, 28, 0.42);
}

.focus-copy {
  display: grid;
  gap: 2px;
}

.focus-name {
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--text-strong);
}

.focus-meta {
  font-size: 0.66rem;
  line-height: 1.3;
  color: var(--text-body);
}

.focus-intent {
  color: var(--text-strong);
}

.target-dot {
  color: var(--accent-sky);
  font-size: 14px;
  opacity: 0.72;
}

.tip-name {
  font-size: 0.8rem;
  font-weight: 800;
  color: var(--text-strong);
}

.move-error {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(239, 68, 68, 0.24);
  background: rgba(127, 29, 29, 0.65);
  color: #fecaca;
  font-size: 0.69rem;
  font-weight: 700;
}

.move-error.stable {
  border-color: rgba(16, 201, 168, 0.24);
  background: rgba(16, 201, 168, 0.12);
  color: #a7f3d0;
}

.move-error.critical {
  border-color: rgba(239, 68, 68, 0.24);
  background: rgba(127, 29, 29, 0.65);
  color: #fecaca;
}

@media (max-width: 760px) {
  .map-hud {
    max-width: 70vw;
  }

  .map-hud-legend {
    display: none;
  }
}
</style>
