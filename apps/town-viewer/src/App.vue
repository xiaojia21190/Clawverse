<template>
  <div class="app">
    <header class="app-header">
      <div class="brand">🦀 Clawverse Town Viewer</div>
      <div class="stats">
        <span :class="['status-dot', connected ? 'online' : 'offline']"></span>
        <span>{{ connected ? 'Connected' : 'Connecting...' }}</span>
        <span class="sep">|</span>
        <span>{{ peers.size }} peer{{ peers.size !== 1 ? 's' : '' }}</span>
      </div>
    </header>
    <div class="main">
      <TownMap :peers="peers" :myId="myId" class="map-area" @move="onMove" />
      <EventFeed :events="events" />
    </div>
    <MetricsPanel />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import TownMap from './components/TownMap.vue';
import EventFeed from './components/EventFeed.vue';
import MetricsPanel from './components/MetricsPanel.vue';
import { usePeers } from './composables/usePeers';
import { useSocialFeed } from './composables/useSocialFeed';

const { peers, connected } = usePeers();
const { events } = useSocialFeed();
const myId = ref<string | undefined>(undefined);

onMounted(async () => {
  try {
    const res = await fetch('/status');
    if (res.ok) {
      const data = await res.json() as { id: string };
      myId.value = data.id;
    }
  } catch { /* daemon not running */ }
});

function onMove(_pos: { x: number; y: number }): void {
  // Position update will arrive via SSE, nothing extra needed
}
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  flex-shrink: 0;
}

.brand { font-weight: 700; font-size: 15px; }

.stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #8b949e;
}

.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
}
.status-dot.online { background: #3fb950; }
.status-dot.offline { background: #f85149; }

.sep { color: #30363d; }

.main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.map-area { flex: 1; }
</style>
