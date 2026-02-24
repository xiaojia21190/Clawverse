<template>
  <div class="app">
    <!-- Top bar -->
    <header class="topbar">
      <div class="brand">🦀 Clawverse</div>
      <div class="conn">
        <span :class="['dot', connected ? 'online' : 'offline']"></span>
        <span>{{ connected ? 'Online' : 'Connecting...' }}</span>
        <span class="sep">|</span>
        <span>{{ peers.size }} peer{{ peers.size !== 1 ? 's' : '' }}</span>
      </div>
      <ResourceBar v-if="resources" :r="resources" class="res-bar" />
      <StorytellerMode
        :current-mode="storytellerMode"
        :tension="tension"
        @set-mode="onSetMode"
        class="st-mode"
      />
    </header>

    <!-- Main area -->
    <div class="main">
      <!-- Left: map -->
      <div class="map-col">
        <TownMapCanvas
          :peers="peers"
          :my-id="myId ?? null"
          :world-map="worldMap"
          :show-relations="showRelations"
          @move="onMove"
          class="map-area"
        />
        <div class="map-controls">
          <button class="ctrl-btn" @click="showRelations = !showRelations">
            {{ showRelations ? '🔗 Relations ON' : '🔗 Relations OFF' }}
          </button>
          <button class="ctrl-btn" @click="showBuildMenu = !showBuildMenu">🏗 Build</button>
          <BuildMenu v-if="showBuildMenu" @build="onBuild" class="build-float" />
        </div>
      </div>

      <!-- Right: feed + social -->
      <div class="side-col">
        <StorytellerFeed :events="lifeEvents" :tension="tension" class="story-feed" />
        <div class="social-feed-mini">
          <div class="sfeed-header">💬 Social</div>
          <div v-for="se in socialEvents.slice(0, 8)" :key="se.id" class="sfeed-item">
            <span class="sfeed-names">{{ se.fromName }} → {{ se.toName }}</span>
            <span class="sfeed-dial">{{ se.dialogue?.slice(0, 60) }}{{ (se.dialogue?.length ?? 0) > 60 ? '…' : '' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom: peer inspector -->
    <PeerInspector :peer="selectedPeer" class="inspector-bar" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { PeerState } from './composables/usePeers';
import type { FeedEvent } from './components/StorytellerFeed.vue';

import TownMapCanvas from './components/TownMapCanvas.vue';
import StorytellerFeed from './components/StorytellerFeed.vue';
import StorytellerMode from './components/StorytellerMode.vue';
import ResourceBar from './components/ResourceBar.vue';
import PeerInspector from './components/PeerInspector.vue';
import BuildMenu from './components/BuildMenu.vue';

import { usePeers } from './composables/usePeers';
import { useSocialFeed } from './composables/useSocialFeed';
import { useEconomy } from './composables/useEconomy';
import { useWorldMap } from './composables/useWorldMap';
import { useStoryteller } from './composables/useStoryteller';

const { peers, connected } = usePeers();
const { events: socialEvents } = useSocialFeed();
const { resources } = useEconomy();
const { worldMap, build } = useWorldMap();
const { mode: storytellerMode, tension, setMode } = useStoryteller();

const myId = ref<string | undefined>(undefined);
const selectedPeer = ref<PeerState | null>(null);
const showRelations = ref(false);
const showBuildMenu = ref(false);
const lifeEvents = ref<FeedEvent[]>([]);

// Fetch own ID
onMounted(async () => {
  try {
    const res = await fetch('/status');
    if (res.ok) {
      const data = (await res.json()) as { id: string };
      myId.value = data.id;
    }
  } catch { /* daemon not running */ }
});

// Poll life events
async function refreshLifeEvents() {
  try {
    const res = await fetch('/life/events/pending');
    if (res.ok) {
      const data = await res.json();
      lifeEvents.value = data.pending ?? data ?? [];
    }
  } catch { /* ignore */ }
}
setInterval(refreshLifeEvents, 5000);
refreshLifeEvents();

function onMove(_pos: { x: number; y: number }) {
  // Position update arrives via SSE
}

async function onBuild(type: string) {
  const me = myId.value ? Array.from(peers.value.values()).find(p => p.id === myId.value) : null;
  if (!me) return;
  const x = Math.max(0, Math.min(39, me.position.x + 1));
  const y = me.position.y;
  await build(type, x, y);
  showBuildMenu.value = false;
}

async function onSetMode(mode: string) {
  await setMode(mode);
}
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d1117; color: #e6edf3; font-family: 'Segoe UI', system-ui, sans-serif; overflow: hidden; }
</style>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* Top bar */
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  flex-shrink: 0;
}
.brand { font-weight: 700; font-size: 15px; color: #58a6ff; }
.conn { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #8b949e; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot.online { background: #3fb950; }
.dot.offline { background: #f85149; }
.sep { color: #30363d; }
.res-bar { margin-left: 12px; }
.st-mode { margin-left: auto; }

/* Main layout */
.main { flex: 1; display: flex; overflow: hidden; }

/* Map column */
.map-col { flex: 0 0 60%; display: flex; flex-direction: column; position: relative; }
.map-area { flex: 1; }
.map-controls {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  background: #0d1117;
  border-top: 1px solid #21262d;
  position: relative;
}
.ctrl-btn {
  background: #21262d;
  border: 1px solid #30363d;
  color: #8b949e;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}
.ctrl-btn:hover { border-color: #58a6ff; color: #e6edf3; }
.build-float {
  position: absolute;
  bottom: 40px;
  left: 50px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  z-index: 20;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}

/* Side column */
.side-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #21262d;
  overflow: hidden;
}
.story-feed { flex: 1; overflow: hidden; }
.social-feed-mini {
  flex: 0 0 160px;
  border-top: 1px solid #21262d;
  overflow-y: auto;
}
.sfeed-header {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #8b949e;
  border-bottom: 1px solid #161b22;
}
.sfeed-item {
  padding: 4px 12px;
  border-bottom: 1px solid #161b22;
  font-size: 10px;
}
.sfeed-names { color: #58a6ff; display: block; }
.sfeed-dial { color: #6e7681; }

/* Bottom inspector */
.inspector-bar {
  flex-shrink: 0;
  border-top: 1px solid #21262d;
}
</style>
