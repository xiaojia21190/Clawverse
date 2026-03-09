<template>
  <div class="app">
    <header class="topbar clay-card">
      <div class="brand-block">
        <div class="brand-row">
          <div class="brand">Clawverse Town</div>
          <div class="conn clay-pill">
            <span :class="['dot', connected ? 'online' : 'offline']"></span>
            <span>{{ connected ? 'Online' : 'Connecting' }}</span>
          </div>
        </div>
        <div class="brand-sub">Same topic, same world — OpenClaw agents enter as distinct lives and branch on their own</div>
      </div>

      <div class="status-strip">
        <div class="status-card emphasis">
          <span class="status-label">Tension</span>
          <strong>{{ tension }}</strong>
        </div>
        <div class="status-card">
          <span class="status-label">Peers</span>
          <strong>{{ status?.knownActors ?? status?.knownPeers ?? peers.size }}</strong>
        </div>
        <div class="status-card">
          <span class="status-label">Critical Needs</span>
          <strong>{{ criticalNeedsCount }}</strong>
        </div>
        <div class="status-card">
          <span class="status-label">Wars</span>
          <strong>{{ activeWarCount }}</strong>
        </div>
        <div class="status-card warning">
          <span class="status-label">Raid Risk</span>
          <strong>{{ combatStatus?.raidRisk ?? 0 }}</strong>
        </div>
        <div class="status-card">
          <span class="status-label">Distressed</span>
          <strong>{{ distressedPeersCount }}</strong>
        </div>
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
        <div class="section-head">
          <div>
            <div class="section-kicker">Shared World</div>
            <div class="section-title">Semantic Grid</div>
          </div>

          <div class="section-meta">
            <span class="meta-pill">Buildings {{ worldMap?.buildings.length ?? 0 }}</span>
            <span class="meta-pill">Relations {{ showRelations ? 'on' : 'off' }}</span>
            <span class="meta-pill">Focus {{ selectedPeer?.name ?? 'local entrant' }}</span>
          </div>
        </div>

        <div class="map-shell">
          <TownMapCanvas
            :peers="peers"
            :nodes="allWorldNodes"
            :my-id="myId"
            :my-position="myPeer?.position ?? null"
            :world-map="worldMap"
            :show-relations="showRelations"
            :relationships="relationships"
            :selected-peer-id="selectedActorId"
            :tension="tension"
            :raid-risk="combatStatus?.raidRisk ?? 0"
            :active-war-count="activeWarCount"
            :critical-need-count="criticalNeedsCount"
            :focus-label="mapFocusLabel"
            @move="onMove"
            @select-peer="onSelectPeer"
            class="map-area"
          />

          <MapLegend
            :relation-mode="showRelations"
            :selected-peer-name="selectedPeer?.name ?? null"
            :building-count="worldMap?.buildings.length ?? 0"
            class="map-legend"
          />
        </div>

        <div class="map-controls">
          <button class="ctrl-btn" @click="showRelations = !showRelations">
            {{ showRelations ? 'Hide Relations' : 'Show Relations' }}
          </button>
          <button class="ctrl-btn" @click="showBuildMenu = !showBuildMenu">Build</button>
          <BuildMenu v-if="showBuildMenu" @build="onBuild" class="build-float clay-card" />
        </div>
      </section>

      <aside class="side-col">
        <TensionOverview
          :tension="tension"
          :needs="needs"
          :resources="resources"
          :peers="peers"
          :relationships="relationships"
          :wars="factionWars"
          :combat-status="combatStatus"
          :active-chains="activeChains"
          :events="lifeEvents"
          :jobs="jobs"
          class="tension-shell clay-card"
        />
        <AutonomyDirector
          :storyteller-mode="storytellerMode"
          :tension="tension"
          :status="status"
          :needs="needs"
          :skills="skills"
          :peers="peers"
          :nodes="allWorldNodes"
          :relationships="relationships"
          :jobs="jobs"
          :active-chains="activeChains"
          :recent-chains="recentChains"
          :social-events="socialEvents"
          :pending-social-events="pendingSocialEvents"
          :selected-peer-id="selectedActorId"
          @select-peer="onSelectPeer"
          class="autonomy-shell clay-card"
        />

        <WorldNodesPanel
          :status="status"
          :peers="peers"
          :nodes="allWorldNodes"
          :relationships="relationships"
          :resources="resources"
          :factions="factions"
          :wars="factionWars"
          :selected-peer-id="selectedActorId"
          @select-peer="onSelectPeer"
          class="world-nodes-shell clay-card"
        />

        <OpenClawPanel
          :status="status"
          :needs="needs"
          :skills="skills"
          :jobs="jobs"
          class="openclaw-shell clay-card"
        />

        <MetricsPanel class="metrics-shell clay-card" />

        <StorytellerFeed
          :events="lifeEvents"
          :tension="tension"
          :active-chains="activeChains"
          :recent-chains="recentChains"
          :drivers="storyDrivers"
          :focus-reason="focusReason"
          :pending-life-count="lifeEvents.length"
          :pending-social-count="pendingSocialEvents.length"
          class="story-feed clay-card"
        />

        <FactionPanel
          :factions="factions"
          :wars="factionWars"
          :alliances="factionAlliances"
          :vassalages="factionVassalages"
          :tributes="factionTributes"
          @create="onCreateFaction"
          @join="joinFaction"
          @alliance="formAlliance"
          @vassalize="vassalizeFaction"
          @renew="renewAlliance"
          @break="breakAlliance"
          @leave="leaveFaction"
          @peace="declarePeace"
        />

        <JobsPanel :jobs="jobs" class="jobs-panel clay-card" />

        <InventoryPanel
          :items="inventoryItems"
          :recipes="inventoryRecipes"
          :is-loading="inventoryLoading"
          :error="inventoryError"
          :last-updated-at="inventoryUpdatedAt"
          class="inventory-shell clay-card"
        />

        <RaidRiskBreakdown
          :status="combatStatus"
          :tension="tension"
          :active-war-count="activeWarCount"
          :critical-need-count="criticalNeedsCount"
          :resources="resources"
          :buildings="worldMap?.buildings ?? []"
          :focus-label="mapFocusLabel"
          class="risk-shell clay-card"
        />

        <CombatPanel
          :status="combatStatus"
          :logs="combatLogs"
          :jobs="jobs"
          :is-loading="combatLoading"
          :action-message="combatActionMessage"
          :action-error="combatActionError"
          :set-posture="setCombatPosture"
          :treat="treatCombat"
          class="combat-shell clay-card"
        />

        <SocialFaultlines
          :peers="peers"
          :nodes="allWorldNodes"
          :relationships="relationships"
          :events="socialEvents"
          :pending="pendingSocialEvents"
          :selected-actor-id="selectedActorId"
          @select-peer="onSelectPeer"
          class="faultlines-shell clay-card"
        />
      </aside>
    </div>

    <PeerInspector
      :peer="selectedPeer"
      :my-peer-id="myId"
      :relationship="selectedRelationship"
      :needs="needs"
      :skills="skills"
      :focus="inspectorFocus"
      :metrics="status?.metrics ?? null"
      class="inspector-bar clay-card"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { FeedDriver, FeedEvent } from './components/StorytellerFeed.vue';

import BuildMenu from './components/BuildMenu.vue';
import AutonomyDirector from './components/AutonomyDirector.vue';
import CombatPanel from './components/CombatPanel.vue';
import FactionPanel from './components/FactionPanel.vue';
import InventoryPanel from './components/InventoryPanel.vue';
import JobsPanel from './components/JobsPanel.vue';
import MapLegend from './components/MapLegend.vue';
import MetricsPanel from './components/MetricsPanel.vue';
import OpenClawPanel from './components/OpenClawPanel.vue';
import PeerInspector from './components/PeerInspector.vue';
import RaidRiskBreakdown from './components/RaidRiskBreakdown.vue';
import ResourceBar from './components/ResourceBar.vue';
import SocialFaultlines from './components/SocialFaultlines.vue';
import StorytellerFeed from './components/StorytellerFeed.vue';
import StorytellerMode from './components/StorytellerMode.vue';
import TensionOverview from './components/TensionOverview.vue';
import TownMapCanvas from './components/TownMapCanvas.vue';
import WorldNodesPanel from './components/WorldNodesPanel.vue';

import { useColonyState } from './composables/useColonyState';
import { useCombat } from './composables/useCombat';
import { useEconomy } from './composables/useEconomy';
import { useFactions } from './composables/useFactions';
import { useInventory } from './composables/useInventory';
import { useJobs } from './composables/useJobs';
import { usePeers } from './composables/usePeers';
import { useRelationships } from './composables/useRelationships';
import { useSocialFeed } from './composables/useSocialFeed';
import { useSocialQueue } from './composables/useSocialQueue';
import { useStoryteller } from './composables/useStoryteller';
import { useWorldMap } from './composables/useWorldMap';
import {
  findWorldNodeByIdentity,
  mergeWorldNodes,
  relationshipMatchesWorldNode,
  useWorldNodes,
} from './composables/useWorldNodes';

const { peers, connected } = usePeers();
const { events: socialEvents } = useSocialFeed();
const { pending: pendingSocialEvents } = useSocialQueue();
const { resources } = useEconomy();
const { worldMap, build } = useWorldMap();
const { worldNodes } = useWorldNodes();
const { mode: storytellerMode, tension, activeChains, recentChains, setMode } = useStoryteller();
const { relationships } = useRelationships();
const { status, needs, skills } = useColonyState();
const { factions, wars: factionWars, alliances: factionAlliances, vassalages: factionVassalages, tributes: factionTributes, createFaction, joinFaction, formAlliance, renewAlliance, breakAlliance, vassalizeFaction, leaveFaction, declarePeace } = useFactions();
const { jobs } = useJobs();
const {
  items: inventoryItems,
  recipes: inventoryRecipes,
  isLoading: inventoryLoading,
  error: inventoryError,
  lastUpdatedAt: inventoryUpdatedAt,
} = useInventory();
const {
  status: combatStatus,
  logs: combatLogs,
  isLoading: combatLoading,
  actionMessage: combatActionMessage,
  actionError: combatActionError,
  setPosture: setCombatPosture,
  treat: treatCombat,
} = useCombat();

const selectedIdentity = ref<string | null>(null);
const showRelations = ref(false);
const showBuildMenu = ref(false);
const lifeEvents = ref<FeedEvent[]>([]);
let lifeTimer: ReturnType<typeof setInterval> | null = null;

const myId = computed(() => status.value?.id ?? null);
const localActorId = computed(() => status.value?.actorId ?? status.value?.state?.actorId ?? status.value?.state?.dna.id ?? null);

const myPeer = computed(() => {
  if (myId.value && peers.value.has(myId.value)) return peers.value.get(myId.value) ?? null;
  return status.value?.state ?? null;
});

const allWorldNodes = computed(() => mergeWorldNodes(worldNodes.value, peers.value, status.value?.state ?? null));

const selectedNode = computed(() => {
  const identity = selectedIdentity.value ?? localActorId.value ?? myId.value;
  return findWorldNodeByIdentity(allWorldNodes.value, identity) ?? null;
});

const selectedActorId = computed(() => selectedNode.value?.actorId ?? selectedIdentity.value ?? null);

const selectedPeer = computed(() => {
  if (selectedNode.value?.state) return selectedNode.value.state;
  return myPeer.value;
});

const selectedRelationship = computed(() => {
  const node = selectedNode.value;
  if (!node) return null;
  if (localActorId.value && node.actorId === localActorId.value) return null;
  return relationships.value.find((relation) => relationshipMatchesWorldNode(relation, node)) ?? null;
});

const distressedPeersCount = computed(() => Array.from(peers.value.values()).filter((peer) => ['stressed', 'distressed'].includes(peer.mood)).length);
const criticalNeedsCount = computed(() => {
  if (!needs.value) return 0;
  return [needs.value.social, needs.value.tasked, needs.value.wanderlust, needs.value.creative].filter((value) => value < 30).length;
});
const activeWarCount = computed(() => factionWars.value.filter((war) => war.status === 'active' || !war.endedAt).length);

const focusReason = computed(() => {
  const activeJob = jobs.value.find((job) => job.status === 'active') ?? jobs.value.find((job) => job.status === 'queued');
  if (activeJob) return activeJob.title;
  if (activeChains.value[0]) return `${activeChains.value[0].originType} → ${activeChains.value[0].nextType}`;
  if (lifeEvents.value[0]) return lifeEvents.value[0].type.replace(/_/g, ' ');
  return '';
});

const mapFocusLabel = computed(() => storyDrivers.value[0]?.label ?? focusReason.value);

const inspectorFocus = computed(() => {
  const primaryDriver = storyDrivers.value[0];
  if (!primaryDriver && !focusReason.value) return null;

  return {
    label: primaryDriver?.label ?? 'Current Intent',
    title: focusReason.value || primaryDriver?.label || 'Observe',
    reason: primaryDriver?.detail || focusReason.value || 'No dominant pressure driver yet.',
    tone: primaryDriver?.tone === 'critical'
      ? 'critical' as const
      : primaryDriver?.tone === 'alert'
        ? 'alert' as const
        : 'watch' as const,
  };
});

const storyDrivers = computed<FeedDriver[]>(() => {
  const drivers: FeedDriver[] = [];

  if (combatStatus.value?.activeRaid) {
    drivers.push({
      id: 'raid',
      label: 'Raid',
      detail: `${combatStatus.value.activeRaid.severity} raid targeting ${combatStatus.value.activeRaid.objective}`,
      score: 95,
      tone: 'critical',
    });
  }

  if ((combatStatus.value?.raidRisk ?? 0) >= 65) {
    drivers.push({
      id: 'raid-risk',
      label: 'Raid Risk',
      detail: `Posture ${combatStatus.value?.posture ?? 'steady'} with risk ${combatStatus.value?.raidRisk ?? 0}`,
      score: combatStatus.value?.raidRisk ?? 0,
      tone: (combatStatus.value?.raidRisk ?? 0) >= 80 ? 'critical' : 'alert',
    });
  }

  if (criticalNeedsCount.value > 0 && needs.value) {
    const criticalEntries: Array<[string, number]> = [
      ['social', needs.value.social],
      ['tasked', needs.value.tasked],
      ['wanderlust', needs.value.wanderlust],
      ['creative', needs.value.creative],
    ];

    const criticalList = criticalEntries
      .filter(([, value]) => value < 30)
      .map(([key, value]) => `${key} ${Math.round(value)}`);

    drivers.push({
      id: 'needs',
      label: 'Need Collapse',
      detail: criticalList.join(' · '),
      score: 80,
      tone: criticalList.some((entry) => /\s([0-9]|1[0-4])$/.test(entry)) ? 'critical' : 'alert',
    });
  }

  if (activeWarCount.value > 0) {
    drivers.push({
      id: 'war',
      label: 'Faction War',
      detail: `${activeWarCount.value} open conflict${activeWarCount.value > 1 ? 's' : ''} driving pressure`,
      score: 74,
      tone: activeWarCount.value > 1 ? 'critical' : 'alert',
    });
  }

  if (distressedPeersCount.value > 0) {
    drivers.push({
      id: 'distress',
      label: 'Distress',
      detail: `${distressedPeersCount.value} peer${distressedPeersCount.value > 1 ? 's are' : ' is'} already stressed`,
      score: 64,
      tone: distressedPeersCount.value > 1 ? 'alert' : 'watch',
    });
  }

  if (resources.value && resources.value.compute <= 45) {
    drivers.push({
      id: 'compute',
      label: 'Low Compute',
      detail: `Reserve down to ${Math.round(resources.value.compute)}`,
      score: resources.value.compute <= 20 ? 76 : 52,
      tone: resources.value.compute <= 20 ? 'critical' : 'watch',
    });
  }

  if (activeChains.value[0]) {
    drivers.push({
      id: 'chain',
      label: 'Escalation Route',
      detail: `${activeChains.value[0].originType} → ${activeChains.value[0].nextType}`,
      score: 58,
      tone: 'watch',
    });
  }

  return drivers.sort((left, right) => right.score - left.score).slice(0, 4);
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

onMounted(() => {
  refreshLifeEvents();
  lifeTimer = setInterval(refreshLifeEvents, 5000);
});

onUnmounted(() => {
  if (lifeTimer) clearInterval(lifeTimer);
});

function onMove(_pos: { x: number; y: number }): void {
  // Position updates arrive via SSE.
}

function onSelectPeer(peerId: string | null): void {
  if (!peerId) {
    selectedIdentity.value = null;
    return;
  }
  const node = findWorldNodeByIdentity(allWorldNodes.value, peerId);
  selectedIdentity.value = node?.actorId ?? peerId;
}

async function onBuild(type: string): Promise<void> {
  const me = myPeer.value;
  if (!me) return;

  const x = Math.max(0, Math.min(39, me.position.x + 1));
  const y = me.position.y;
  await build(type, x, y);
  showBuildMenu.value = false;
}

async function onSetMode(mode: string): Promise<void> {
  await setMode(mode);
}

async function onCreateFaction(payload: { name: string; motto: string }): Promise<void> {
  await createFaction(payload.name, payload.motto);
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
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(238, 244, 248, 0.94));
  box-shadow: 0 16px 34px rgba(76, 97, 122, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.75);
  animation: clay-rise 320ms var(--ease-snap) both;
}

.clay-pill {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: var(--shadow-pressed);
}

.topbar,
.brand-row,
.status-strip,
.section-head,
.section-meta,
.map-controls,
.sfeed-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.topbar {
  flex-wrap: wrap;
  padding: 14px 16px;
}

.brand-block {
  display: grid;
  gap: 6px;
  min-width: 260px;
}

.brand-row {
  align-items: center;
}

.brand {
  font-family: var(--font-display);
  font-size: clamp(1.4rem, 2.1vw, 2rem);
  line-height: 1;
  letter-spacing: 0.02em;
  color: var(--text-strong);
}

.brand-sub,
.status-label,
.section-kicker {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.conn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-body);
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.dot.online {
  background: var(--state-good);
}

.dot.offline {
  background: var(--state-bad);
}

.status-strip {
  flex: 1;
  flex-wrap: wrap;
  align-items: stretch;
}

.status-card,
.meta-pill {
  display: grid;
  gap: 3px;
  min-width: 92px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.72);
}

.status-card strong,
.section-title {
  font-size: 0.88rem;
  font-weight: 800;
  color: var(--text-strong);
}

.status-card.emphasis {
  border-color: rgba(37, 99, 235, 0.24);
}

.status-card.warning {
  border-color: rgba(202, 138, 4, 0.22);
}

.res-bar {
  margin-left: auto;
}

.main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(360px, 1fr);
  gap: 14px;
}

.map-col,
.side-col {
  min-height: 0;
}

.map-col {
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
}

.section-head {
  justify-content: space-between;
  margin-bottom: 10px;
}

.section-title {
  margin-top: 3px;
}

.section-meta {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.meta-pill {
  min-width: 0;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--text-body);
}

.map-shell {
  position: relative;
  flex: 1;
  min-height: 0;
}

.map-area {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.map-legend {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 3;
}

.map-controls {
  flex-wrap: wrap;
  margin-top: 10px;
  position: relative;
}

.ctrl-btn {
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-md);
  padding: 8px 14px;
  color: var(--text-strong);
  font-size: 0.76rem;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.82);
  cursor: pointer;
  transition: transform 180ms var(--ease-snap), border-color 180ms var(--ease-snap), box-shadow 180ms var(--ease-snap);
}

.ctrl-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(37, 99, 235, 0.24);
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.1);
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
  display: grid;
  grid-template-rows: auto auto auto minmax(240px, 1fr) auto auto auto auto;
  grid-auto-rows: auto;
  gap: 14px;
}

.story-feed,
.director-shell,
.inventory-shell,
.risk-shell,
.combat-shell,
.faultlines-shell,
.metrics-shell,
.tension-shell,
.autonomy-shell,
.openclaw-shell,
.world-nodes-shell {
  overflow: hidden;
}

.social-feed-mini {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 140px;
  max-height: 200px;
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
  background: rgba(255, 255, 255, 0.84);
  box-shadow: var(--shadow-pressed);
}

.sfeed-item {
  align-items: flex-start;
  flex-direction: column;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: var(--shadow-pressed);
}

.sfeed-names {
  font-size: 0.74rem;
  font-weight: 800;
  color: var(--text-strong);
}

.sfeed-dial,
.sfeed-empty {
  font-size: 0.7rem;
  color: var(--text-body);
  line-height: 1.4;
}

.sfeed-empty {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  text-align: center;
  background: rgba(255, 255, 255, 0.72);
}

.inspector-bar {
  min-height: 140px;
  overflow: hidden;
}

@media (max-width: 1280px) {
  .main {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) auto;
  }

  .side-col {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: none;
  }
}

@media (max-width: 960px) {
  .map-legend {
    position: static;
    margin-top: 12px;
  }

  .status-strip {
    width: 100%;
  }

  .res-bar,
  .st-mode {
    width: 100%;
    margin-left: 0;
  }

  .side-col {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .app {
    gap: 10px;
    padding: 10px;
  }

  .topbar,
  .map-col {
    padding: 10px;
  }

  .brand-row,
  .section-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .status-card {
    min-width: calc(50% - 8px);
  }

  .build-float {
    left: 50%;
    transform: translateX(-50%);
    width: min(300px, 94vw);
  }
}
</style>
