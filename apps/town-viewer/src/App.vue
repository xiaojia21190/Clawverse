<template>
  <div class="app">
    <header class="topbar clay-card">
      <div class="brand-block">
        <div class="brand">Clawverse Town</div>
        <div class="brand-sub">Realtime peer colony dashboard</div>
      </div>

      <div class="conn clay-pill">
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

    <div class="main">
      <section class="map-col clay-card">
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
            {{ showRelations ? 'Relations ON' : 'Relations OFF' }}
          </button>
          <button class="ctrl-btn" @click="showBuildMenu = !showBuildMenu">Build</button>
          <BuildMenu v-if="showBuildMenu" @build="onBuild" class="build-float clay-card" />
        </div>
      </section>

      <aside class="side-col">
        <StorytellerFeed :events="lifeEvents" :tension="tension" class="story-feed clay-card" />

        <div class="social-feed-mini clay-card">
          <div class="sfeed-header">Social Pulse</div>
          <div v-for="se in socialEvents.slice(0, 8)" :key="se.id" class="sfeed-item">
            <span class="sfeed-names">{{ se.fromName }} -> {{ se.toName }}</span>
            <span class="sfeed-dial">{{ se.dialogue?.slice(0, 60) }}{{ (se.dialogue?.length ?? 0) > 60 ? '...' : '' }}</span>
          </div>
          <div v-if="socialEvents.length === 0" class="sfeed-empty">No social events yet.</div>
        </div>
      </aside>
    </div>

    <PeerInspector :peer="selectedPeer" class="inspector-bar clay-card" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
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

onMounted(async () => {
  try {
    const res = await fetch('/status');
    if (res.ok) {
      const data = (await res.json()) as { id: string };
      myId.value = data.id;
    }
  } catch {
    // daemon not running
  }
});

async function refreshLifeEvents(): Promise<void> {
  try {
    const res = await fetch('/life/events/pending');
    if (res.ok) {
      const data = await res.json();
      lifeEvents.value = data.pending ?? data ?? [];
    }
  } catch {
    // ignore temporary network jitter
  }
}

const lifeTimer = window.setInterval(refreshLifeEvents, 5000);
onUnmounted(() => {
  window.clearInterval(lifeTimer);
});
refreshLifeEvents();

function onMove(_pos: { x: number; y: number }): void {
  // Position updates arrive via SSE.
}

async function onBuild(type: string): Promise<void> {
  const me = myId.value ? Array.from(peers.value.values()).find(p => p.id === myId.value) : null;
  if (!me) return;

  const x = Math.max(0, Math.min(39, me.position.x + 1));
  const y = me.position.y;
  await build(type, x, y);
  showBuildMenu.value = false;
}

async function onSetMode(mode: string): Promise<void> {
  await setMode(mode);
}
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100vh;
  padding: 14px;
  overflow: hidden;
}

.clay-card {
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-xl);
  background: linear-gradient(145deg, var(--surface), var(--surface-strong));
  box-shadow: var(--shadow-clay-soft);
  animation: clay-rise 420ms var(--ease-snap) both;
}

.clay-pill {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  min-height: 84px;
  flex-wrap: wrap;
  animation-delay: 40ms;
}

.brand-block {
  min-width: 220px;
}

.brand {
  font-family: var(--font-display);
  font-size: clamp(1.4rem, 2.2vw, 2rem);
  line-height: 1;
  letter-spacing: 0.02em;
  background: linear-gradient(100deg, var(--accent-coral), var(--accent-sky));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.brand-sub {
  margin-top: 2px;
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.conn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-body);
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.65);
}

.dot.online {
  background: var(--state-good);
}

.dot.offline {
  background: var(--state-bad);
}

.sep {
  color: var(--text-muted);
}

.res-bar {
  margin-left: auto;
}

.main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.85fr) minmax(320px, 1fr);
  gap: 14px;
}

.map-col {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
  animation-delay: 80ms;
}

.map-area {
  flex: 1;
  min-height: 0;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.map-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
  position: relative;
}

.ctrl-btn {
  border: none;
  border-radius: var(--radius-md);
  padding: 8px 14px;
  color: var(--text-strong);
  font-size: 0.78rem;
  font-weight: 700;
  background: linear-gradient(140deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-clay-soft);
  cursor: pointer;
  transition: transform 180ms var(--ease-snap), box-shadow 180ms var(--ease-snap), color 180ms var(--ease-snap);
}

.ctrl-btn:hover {
  transform: translateY(-2px);
  color: var(--accent-coral);
  box-shadow: var(--shadow-float);
}

.ctrl-btn:active {
  transform: translateY(1px);
  box-shadow: var(--shadow-pressed);
}

.build-float {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 0;
  z-index: 30;
  padding: 8px;
  width: min(280px, 88vw);
}

.side-col {
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 14px;
  animation-delay: 120ms;
}

.story-feed {
  min-height: 0;
  overflow: hidden;
}

.social-feed-mini {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 170px;
  max-height: 238px;
  overflow-y: auto;
  padding: 14px;
}

.sfeed-header {
  position: sticky;
  top: 0;
  z-index: 1;
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-family: var(--font-display);
  font-size: 0.95rem;
  color: var(--text-strong);
  background: linear-gradient(135deg, rgba(58, 191, 248, 0.2), rgba(255, 182, 74, 0.24));
  box-shadow: var(--shadow-pressed);
}

.sfeed-item {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.sfeed-names {
  font-size: 0.74rem;
  font-weight: 800;
  color: var(--text-strong);
}

.sfeed-dial {
  font-size: 0.7rem;
  color: var(--text-body);
  line-height: 1.35;
}

.sfeed-empty {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  text-align: center;
  font-size: 0.75rem;
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.inspector-bar {
  min-height: 114px;
  overflow: hidden;
  animation-delay: 160ms;
}

.st-mode {
  margin-left: auto;
}

@media (max-width: 1180px) {
  .main {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) auto;
  }

  .map-col {
    min-height: 48vh;
  }

  .side-col {
    grid-template-columns: minmax(0, 1fr);
  }

  .res-bar {
    order: 4;
    margin-left: 0;
    width: 100%;
  }

  .st-mode {
    margin-left: 0;
  }
}

@media (max-width: 760px) {
  .app {
    gap: 10px;
    padding: 10px;
  }

  .topbar {
    border-radius: var(--radius-lg);
    padding: 10px;
  }

  .brand {
    font-size: 1.42rem;
  }

  .brand-block {
    min-width: 0;
  }

  .conn {
    width: 100%;
    justify-content: center;
  }

  .map-col {
    padding: 10px;
    border-radius: var(--radius-lg);
  }

  .map-controls {
    gap: 8px;
  }

  .ctrl-btn {
    flex: 1;
    min-width: 0;
    text-align: center;
  }

  .build-float {
    left: 50%;
    transform: translateX(-50%);
    width: min(300px, 94vw);
  }

  .social-feed-mini {
    max-height: 220px;
  }

  .inspector-bar {
    border-radius: var(--radius-lg);
  }
}
</style>