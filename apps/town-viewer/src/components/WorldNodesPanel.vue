<template>
  <section class="world-panel">
    <div class="world-header">
      <div>
        <div class="world-kicker">Shared Topic World</div>
        <div class="world-title">World Entrants</div>
      </div>
      <div class="world-topic">{{ worldTopic }}</div>
    </div>

    <div class="world-summary">
      <article class="world-stat-card">
        <span>Big Nodes</span>
        <strong>{{ bigNodeCount }}</strong>
      </article>
      <article class="world-stat-card">
        <span>Small Nodes</span>
        <strong>{{ smallNodeCount }}</strong>
      </article>
      <article class="world-stat-card">
        <span>Districts</span>
        <strong>{{ occupiedDistrictCount }}</strong>
      </article>
      <article class="world-stat-card">
        <span>Clusters</span>
        <strong>{{ clusterCount }}</strong>
      </article>
      <article class="world-stat-card">
        <span>Outsiders</span>
        <strong>{{ outsiderCount }}</strong>
      </article>
      <article class="world-stat-card">
        <span>Factions</span>
        <strong>{{ props.factions.length }}</strong>
      </article>
      <article class="world-stat-card">
        <span>Wars</span>
        <strong>{{ activeWarCount }}</strong>
      </article>
      <article class="world-stat-card">
        <span>Fault Lines</span>
        <strong>{{ faultLineCount }}</strong>
      </article>
    </div>

    <div class="world-copy">{{ worldCopy }}</div>

    <div class="world-grid">
      <div class="world-section">
        <div class="world-section-label">Local Actor Brain</div>
        <article v-if="localEntry" class="resident-card local selected steady">
          <div class="resident-topline">
            <div>
              <div class="resident-name-row">
                <span class="resident-name">{{ localEntry.name }}</span>
                <span class="resident-badge local">local</span>
              </div>
              <div class="resident-meta">
                {{ resolveDistrict(localEntry) }} · {{ localEntry.dna.archetype }} · {{ localEntry.dna.modelTrait }}
              </div>
            </div>
            <div class="resident-mood steady">{{ localEntry.mood }}</div>
          </div>

          <div class="resident-id-grid">
            <div class="resident-id-card">
              <span>Actor</span>
              <strong>{{ shortId(actorIdOf(localEntry)) }}</strong>
            </div>
            <div class="resident-id-card">
              <span>Session</span>
              <strong>{{ shortId(sessionIdOf(localEntry)) }}</strong>
            </div>
            <div class="resident-id-card">
              <span>Small Nodes</span>
              <strong>{{ localBranchCount }}</strong>
            </div>
          </div>
        </article>
        <div v-else class="world-empty">Waiting for local actor brain state.</div>
      </div>

      <div class="world-section">
        <div class="world-section-label">District Spread</div>
        <div class="district-grid">
          <article
            v-for="district in districtSummary"
            :key="district.name"
            class="district-card"
            :class="{ active: district.count > 0, local: district.name === localDistrict }"
          >
            <div class="district-topline">
              <span>{{ district.name }}</span>
              <strong>{{ district.count }}</strong>
            </div>
            <div class="district-meta">
              {{ district.name === localDistrict ? 'local anchor' : district.count > 0 ? 'occupied' : 'quiet' }}
            </div>
          </article>
        </div>
      </div>
    </div>

    <div class="world-section">
      <div class="world-section-label">Settlement Clusters</div>
      <div v-if="clusterCards.length" class="district-grid">
        <article
          v-for="cluster in clusterCards.slice(0, 6)"
          :key="cluster.id"
          class="district-card"
          :class="[cluster.tone, { local: cluster.local }]"
        >
          <div class="district-topline">
            <span>{{ cluster.label }}</span>
            <strong>{{ cluster.actorCount }}</strong>
          </div>
          <div class="district-meta">{{ cluster.district }} · {{ cluster.status }}</div>
          <div class="resident-copy">{{ cluster.copy }}</div>
          <div v-if="cluster.leader" class="district-meta">Leader {{ cluster.leader }}</div>
        </article>
      </div>
      <div v-else class="world-empty">No stable settlement cluster has emerged yet.</div>
    </div>

    <div class="world-section">
      <div class="world-section-label">Outsider Arrivals</div>
      <div v-if="outsiderCards.length" class="district-grid">
        <article
          v-for="outsider in outsiderCards.slice(0, 6)"
          :key="outsider.id"
          class="district-card"
          :class="outsider.tone"
        >
          <div class="district-topline">
            <span>{{ outsider.label }}</span>
            <strong>{{ outsider.actorCount }}</strong>
          </div>
          <div class="district-meta">{{ outsider.status }} · {{ outsider.fromTopic }}</div>
          <div class="resident-copy">{{ outsider.summary }}</div>
          <div class="district-meta">Trust {{ outsider.trust }} · Pressure {{ outsider.pressure }}</div>
        </article>
      </div>
      <div v-else class="world-empty">No outsider arrivals are being tracked yet.</div>
    </div>

    <div class="world-section">
      <div class="world-section-label">Big Nodes In This World</div>
      <div v-if="residentCards.length" class="resident-list">
        <article
          v-for="resident in residentCards.slice(0, 8)"
          :key="resident.id"
          class="resident-card interactive"
          :class="[resident.tone, { selected: resident.id === effectiveSelectedPeerId }]"
          role="button"
          tabindex="0"
          @click="selectPeer(resident.id)"
          @keydown.enter.prevent="selectPeer(resident.id)"
          @keydown.space.prevent="selectPeer(resident.id)"
        >
          <div class="resident-topline">
            <div>
              <div class="resident-name-row">
                <span class="resident-name">{{ resident.name }}</span>
                <span v-if="resident.isLocal" class="resident-badge local">local</span>
                <span v-if="resident.faction !== 'Unaffiliated'" class="resident-badge">{{ resident.faction }}</span>
              </div>
              <div class="resident-meta">{{ resident.district }} · {{ resident.archetype }} · {{ resident.trait }}</div>
            </div>
            <div class="resident-mood" :class="resident.tone">{{ resident.mood }}</div>
          </div>

          <div class="resident-copy">{{ resident.relationshipLabel }}</div>

          <div class="resident-id-grid compact">
            <div class="resident-id-card">
              <span>Actor</span>
              <strong>{{ resident.actorId }}</strong>
            </div>
            <div class="resident-id-card">
              <span>Session</span>
              <strong>{{ resident.sessionId }}</strong>
            </div>
            <div class="resident-id-card">
              <span>Small</span>
              <strong>{{ resident.branchCount }}</strong>
            </div>
          </div>
        </article>
      </div>
      <div v-else class="world-empty">No big nodes visible in this topic world yet.</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ColonyStatus } from '../composables/useColonyState';
import type { ResourceState } from '../composables/useEconomy';
import type { FactionInfo, FactionWarInfo } from '../composables/useFactions';
import type { PeerState } from '../composables/usePeers';
import type { RelationshipInfo } from '../composables/useRelationships';
import {
  actorIdOfPeer,
  findWorldNodeByIdentity,
  mergeWorldNodes,
  relationshipMatchesWorldNode,
  sessionIdOfPeer,
  type TopicWorldSummary,
  type WorldNode,
} from '../composables/useWorldNodes';

const DISTRICTS = ['Plaza', 'Market', 'Library', 'Workshop', 'Park', 'Tavern', 'Residential'] as const;

type ResidentTone = 'steady' | 'watch' | 'alert' | 'critical';

const props = defineProps<{
  status: ColonyStatus | null;
  world?: TopicWorldSummary | null;
  peers: Map<string, PeerState>;
  nodes?: WorldNode[];
  relationships: RelationshipInfo[];
  resources: ResourceState | null;
  factions: FactionInfo[];
  wars: FactionWarInfo[];
  selectedPeerId?: string | null;
}>();

const emit = defineEmits<{
  selectPeer: [string | null];
}>();

const worldSummary = computed(() => props.world ?? props.status?.world ?? null);
const worldTopic = computed(() => worldSummary.value?.topic ?? props.status?.topic ?? 'shared-topic');

const localActorId = computed(() => {
  return props.status?.actorId ?? props.status?.state?.actorId ?? props.status?.state?.dna.id ?? null;
});

const allNodes = computed<WorldNode[]>(() => {
  return mergeWorldNodes(props.nodes ?? [], props.peers, props.status?.state ?? null);
});

const localEntry = computed(() => {
  if (!localActorId.value) return props.status?.state ?? null;
  return allNodes.value.find((node) => node.actorId === localActorId.value)?.state ?? props.status?.state ?? null;
});

const effectiveSelectedPeerId = computed(() => {
  if (props.selectedPeerId) {
    return findWorldNodeByIdentity(allNodes.value, props.selectedPeerId)?.actorId ?? props.selectedPeerId;
  }
  return localActorId.value ?? null;
});
const localDistrict = computed(() => (localEntry.value ? resolveDistrict(localEntry.value) : null));
const activeWarCount = computed(() => props.wars.filter((war) => war.status === 'active' || !war.endedAt).length);
const faultLineCount = computed(() => {
  return props.relationships.filter((relation) => relation.sentiment < -0.2 || relation.tier === 'rival' || relation.tier === 'nemesis').length;
});
const bigNodeCount = computed(() => worldSummary.value?.population.actorCount ?? residentCards.value.length);
const clusterCount = computed(() => worldSummary.value?.population.clusterCount ?? clusterCards.value.length);
const outsiderCount = computed(() => worldSummary.value?.population.outsiderCount ?? outsiderCards.value.length);
const smallNodeCount = computed(() => {
  if (worldSummary.value) return worldSummary.value.population.branchCount;
  return allNodes.value.reduce((sum, node) => sum + node.sessionCount, 0);
});
const localBranchCount = computed(() => {
  if (worldSummary.value) return worldSummary.value.brain.branchCount;
  const localNode = localActorId.value
    ? allNodes.value.find((node) => node.actorId === localActorId.value)
    : null;
  return localNode?.sessionCount ?? 0;
});
const worldCopy = computed(() => {
  const summary = worldSummary.value;
  if (!summary) {
    return 'Each OpenClaw owns its own actor brain. World order emerges from survival pressure, clusters, and relationships; operator inputs are suggestions only and never hard commands.';
  }
  return `Actor autonomy is active: ${summary.brain.branchCount} small node${summary.brain.branchCount === 1 ? '' : 's'} under the local actor brain. Governance is ${summary.governance.model} with ${summary.governance.leadership}; operators only have ${summary.governance.operatorScope}. Ring mode ${summary.hierarchy.ringMode} across ${summary.ring.topicCount} topic${summary.ring.topicCount === 1 ? '' : 's'}, ${summary.population.actorCount} big nodes, ${summary.population.clusterCount ?? 0} cluster${(summary.population.clusterCount ?? 0) === 1 ? '' : 's'}, and ${summary.population.outsiderCount ?? 0} outsider arrival${(summary.population.outsiderCount ?? 0) === 1 ? '' : 's'} are currently tracked.`;
});

const clusterCards = computed(() => {
  const clusters = worldSummary.value?.clusters ?? [];
  return clusters.map((cluster) => ({
    id: cluster.id,
    label: cluster.label,
    district: cluster.district,
    actorCount: cluster.actorCount,
    local: cluster.local,
    status: cluster.status.replace(/_/g, ' '),
    tone: cluster.status === 'stable'
      ? 'steady'
      : cluster.status === 'strained' || cluster.status === 'forming'
        ? 'watch'
        : cluster.status === 'fracturing'
          ? 'alert'
          : 'critical',
    copy: `${cluster.branchCount} small nodes · cohesion ${cluster.cohesion} · safety ${cluster.safety}${cluster.dominantFactionName ? ` · ${cluster.dominantFactionName}` : ''}`,
    leader: cluster.leaderName ? `${cluster.leaderName} ${cluster.leaderScore}` : '',
  }));
});

const outsiderCards = computed(() => {
  const outsiders = worldSummary.value?.outsiders ?? [];
  return outsiders.map((outsider) => ({
    id: outsider.id,
    label: outsider.label,
    actorCount: outsider.actorCount,
    fromTopic: outsider.fromTopic ?? 'unknown',
    status: outsider.status.replace(/_/g, ' '),
    summary: outsider.summary,
    trust: outsider.trust,
    pressure: outsider.pressure,
    tone: outsider.status === 'accepted'
      ? 'steady'
      : outsider.status === 'traded' || outsider.status === 'tolerated'
        ? 'watch'
        : outsider.status === 'observed'
          ? 'alert'
          : 'critical',
  }));
});

const residentCards = computed(() => {
  return allNodes.value
    .map((node) => {
      const peer = node.state;
      const relation = relationshipForNode(node);
      const isLocal = actorIdOf(peer) === localActorId.value;
      const tone = resolveTone(peer, relation);
      const faction = factionName(peer.id, actorIdOf(peer));
      const rank = (node.actorId === effectiveSelectedPeerId.value ? 20 : 0) + (isLocal ? 10 : 0);

      return {
        id: node.actorId,
        name: peer.name,
        isLocal,
        district: resolveDistrict(peer),
        archetype: peer.dna.archetype,
        trait: peer.dna.modelTrait,
        mood: peer.mood,
        tone,
        faction,
        branchCount: node.sessionCount,
        actorId: shortId(node.actorId),
        sessionId: shortId(node.primarySessionId || sessionIdOf(peer)),
        relationshipLabel: relation
          ? `${relation.tier} / sentiment ${relation.sentiment >= 0 ? '+' : ''}${relation.sentiment.toFixed(2)} / ${relation.interactionCount} interactions`
          : node.sessionCount > 1
            ? `One actor brain currently holds ${node.sessionCount} small nodes.`
            : 'No direct relationship memory yet.',
        rank,
      };
    })
    .sort((left, right) => right.rank - left.rank || left.name.localeCompare(right.name));
});

const districtSummary = computed(() => {
  if (worldSummary.value?.districts?.length) {
    return DISTRICTS.map((districtName) => {
      const district = worldSummary.value?.districts.find((item) => item.name === districtName);
      return {
        name: districtName,
        count: district?.actorCount ?? 0,
      };
    });
  }
  return DISTRICTS.map((districtName) => ({
    name: districtName,
    count: residentCards.value.filter((resident) => resident.district === districtName).length,
  }));
});

const occupiedDistrictCount = computed(() => worldSummary.value?.population.districtCount ?? districtSummary.value.filter((district) => district.count > 0).length);

function actorIdOf(peer: PeerState): string {
  return actorIdOfPeer(peer);
}

function sessionIdOf(peer: PeerState): string {
  return sessionIdOfPeer(peer);
}

function relationshipForNode(node: WorldNode): RelationshipInfo | null {
  return props.relationships.find((relation) => relationshipMatchesWorldNode(relation, node)) ?? null;
}

function factionName(peerId: string, actorId?: string): string {
  return props.factions.find((faction) => faction.members.includes(peerId) || (!!actorId && faction.memberActorIds?.includes(actorId)))?.name ?? 'Unaffiliated';
}

function resolveDistrict(peer: PeerState): string {
  return peer.spawnDistrict ?? districtName(peer.position);
}

function districtName(position: { x: number; y: number }): string {
  if (position.x < 10 && position.y < 10) return 'Plaza';
  if (position.x >= 10 && position.x < 20 && position.y < 10) return 'Market';
  if (position.x < 10 && position.y >= 10 && position.y < 20) return 'Library';
  if (position.x >= 10 && position.x < 20 && position.y >= 10 && position.y < 20) return 'Workshop';
  if (position.x < 10 && position.y >= 20) return 'Park';
  if (position.x >= 10 && position.x < 20 && position.y >= 20 && position.y < 30) return 'Tavern';
  return 'Residential';
}

function resolveTone(peer: PeerState, relation: RelationshipInfo | null): ResidentTone {
  const relationSentiment = relation?.sentiment ?? 0;
  if (peer.mood === 'distressed') return 'critical';
  if (peer.mood === 'stressed') return 'alert';
  if (relation?.tier === 'nemesis' || relationSentiment < -0.5) return 'critical';
  if (relation?.tier === 'rival' || relationSentiment < -0.2) return 'alert';
  if (peer.mood === 'busy' || peer.mood === 'working') return 'watch';
  return 'steady';
}

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : 'unknown';
}

function selectPeer(peerId: string | null): void {
  emit('selectPeer', peerId);
}
</script>

<style scoped>
.world-panel,
.world-summary,
.world-grid,
.world-section,
.resident-list,
.district-grid,
.resident-id-grid {
  display: grid;
  gap: 10px;
}

.world-panel {
  padding: 14px;
}

.world-header,
.resident-topline,
.resident-name-row,
.district-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.world-kicker,
.world-section-label,
.world-copy,
.world-stat-card span,
.resident-meta,
.resident-id-card span,
.district-meta {
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.world-title {
  margin-top: 2px;
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--text-strong);
}

.world-topic,
.resident-badge,
.resident-mood {
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  padding: 4px 10px;
  font-size: 0.66rem;
  font-weight: 800;
  color: var(--text-body);
  background: rgba(255, 255, 255, 0.76);
}

.world-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.world-stat-card,
.resident-card,
.district-card,
.world-empty {
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(237, 243, 247, 0.94));
  box-shadow: var(--shadow-pressed);
}

.world-stat-card,
.resident-card,
.district-card,
.world-empty {
  padding: 12px;
}

.world-copy {
  line-height: 1.5;
  text-transform: none;
}

.world-grid {
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
}

.resident-list {
  max-height: 420px;
  overflow-y: auto;
}

.resident-card.interactive {
  cursor: pointer;
  transition: transform 180ms var(--ease-snap), border-color 180ms var(--ease-snap), box-shadow 180ms var(--ease-snap);
}

.resident-card.interactive:hover,
.resident-card.interactive:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(37, 99, 235, 0.28);
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.1);
  outline: none;
}

.resident-card.selected,
.district-card.local {
  border-color: rgba(37, 99, 235, 0.34);
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.18), var(--shadow-pressed);
}

.resident-card.watch,
.resident-mood.watch {
  border-color: rgba(202, 138, 4, 0.22);
}

.resident-card.alert,
.resident-mood.alert {
  border-color: rgba(249, 115, 22, 0.22);
}

.resident-card.critical,
.resident-mood.critical {
  border-color: rgba(220, 38, 38, 0.24);
}

.resident-card.steady,
.resident-mood.steady,
.district-card.active {
  border-color: rgba(34, 197, 94, 0.2);
}

.resident-badge.local {
  color: #2563eb;
}

.resident-name,
.world-stat-card strong,
.resident-id-card strong,
.district-topline strong {
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--text-strong);
}

.resident-copy,
.world-empty {
  margin-top: 6px;
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--text-body);
}

.resident-id-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 8px;
}

.resident-id-grid.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.resident-id-card,
.district-card {
  display: grid;
  gap: 6px;
}

.district-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 760px) {
  .world-summary,
  .world-grid,
  .district-grid,
  .resident-id-grid,
  .resident-id-grid.compact {
    grid-template-columns: 1fr;
  }

  .world-header,
  .resident-topline,
  .resident-name-row,
  .district-topline {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
