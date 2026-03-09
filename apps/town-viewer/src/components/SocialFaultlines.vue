<template>
  <section class="fault-panel">
    <div class="fault-header">
      <div>
        <div class="fault-kicker">Social Graph</div>
        <div class="fault-title">Fault Lines</div>
      </div>
      <div class="fault-count">{{ faultCards.length }} hot links</div>
    </div>

    <div
      v-if="flashpoint"
      class="fault-flash interactive"
      :class="[flashpoint.tone, { selected: flashpoint.actorId === effectiveSelectedActorId }]"
      role="button"
      tabindex="0"
      @click="selectActor(flashpoint.actorId)"
      @keydown.enter.prevent="selectActor(flashpoint.actorId)"
      @keydown.space.prevent="selectActor(flashpoint.actorId)"
    >
      <div class="fault-flash-label">Current Flashpoint</div>
      <div class="fault-flash-title">{{ flashpoint.actorName }} | {{ flashpoint.tier }}</div>
      <div class="fault-flash-copy">{{ flashpoint.summary }}</div>
    </div>

    <div class="fault-section">
      <div class="fault-section-label">Critical Links</div>
      <div v-if="faultCards.length === 0" class="fault-empty">No unstable relationships are surfacing right now.</div>
      <div v-else class="fault-card-list">
        <article
          v-for="card in faultCards"
          :key="card.actorId"
          class="fault-card interactive"
          :class="[card.tone, { selected: card.actorId === effectiveSelectedActorId }]"
          role="button"
          tabindex="0"
          @click="selectActor(card.actorId)"
          @keydown.enter.prevent="selectActor(card.actorId)"
          @keydown.space.prevent="selectActor(card.actorId)"
        >
          <div class="fault-card-topline">
            <div>
              <div class="fault-peer">{{ card.actorName }}</div>
              <div class="fault-peer-meta">{{ card.archetype }} | {{ card.mood }} | {{ card.tier }}</div>
            </div>
            <div class="fault-score">{{ card.score }}</div>
          </div>
          <div class="fault-card-copy">{{ card.summary }}</div>
          <div class="fault-badges">
            <span class="fault-badge">Sentiment {{ card.sentiment }}</span>
            <span class="fault-badge">Interactions {{ card.interactionCount }}</span>
            <span v-if="card.location" class="fault-badge">{{ card.location }}</span>
            <span v-if="card.meetCount > 0" class="fault-badge">Meet {{ card.meetCount }}</span>
          </div>
          <div v-if="card.notableEvents.length > 0" class="fault-note">{{ card.notableEvents.slice(0, 2).join(' | ') }}</div>
        </article>
      </div>
    </div>

    <div class="fault-section">
      <div class="fault-section-label">Recent Swings</div>
      <div v-if="recentSwings.length === 0" class="fault-empty subtle">No recent social sentiment swings.</div>
      <div v-else class="swing-list">
        <div
          v-for="event in recentSwings"
          :key="event.id"
          class="swing-item"
          :class="{ interactive: !!event.actorId, selected: event.actorId === effectiveSelectedActorId }"
          role="button"
          :tabindex="event.actorId ? 0 : -1"
          @click="selectActor(event.actorId)"
          @keydown.enter.prevent="selectActor(event.actorId)"
          @keydown.space.prevent="selectActor(event.actorId)"
        >
          <div class="swing-topline">
            <span>{{ event.fromName }} -> {{ event.toName }}</span>
            <strong :class="event.delta < 0 ? 'down' : 'up'">{{ formatDelta(event.delta) }}</strong>
          </div>
          <div class="swing-copy">{{ event.location }} | {{ event.dialogue }}</div>
        </div>
      </div>
    </div>

    <div class="fault-section">
      <div class="fault-section-label">Queued Friction</div>
      <div v-if="queuedTension.length === 0" class="fault-empty subtle">No unresolved social friction in queue.</div>
      <div v-else class="queue-list">
        <div
          v-for="item in queuedTension"
          :key="item.id"
          class="queue-item"
          :class="{ interactive: !!item.actorId, selected: item.actorId === effectiveSelectedActorId }"
          role="button"
          :tabindex="item.actorId ? 0 : -1"
          @click="selectActor(item.actorId)"
          @keydown.enter.prevent="selectActor(item.actorId)"
          @keydown.space.prevent="selectActor(item.actorId)"
        >
          <div class="swing-topline">
            <span>{{ item.fromName }} -> {{ item.toName }}</span>
            <strong>{{ pendingHeat(item) }}</strong>
          </div>
          <div class="swing-copy">{{ item.location }} | {{ item.trigger }} | meet {{ item.meetCount }} | base {{ item.sentimentBefore.toFixed(2) }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PeerState } from '../composables/usePeers';
import type { RelationshipInfo } from '../composables/useRelationships';
import type { SocialEvent } from '../composables/useSocialFeed';
import type { PendingSocialEvent } from '../composables/useSocialQueue';
import {
  findWorldNodeByIdentity,
  findWorldNodeForRelationship,
  mergeWorldNodes,
  worldNodeSessionSet,
  type WorldNode,
} from '../composables/useWorldNodes';

interface FaultCard {
  actorId: string;
  actorName: string;
  archetype: string;
  mood: string;
  tier: string;
  sentiment: string;
  interactionCount: number;
  score: number;
  tone: 'watch' | 'alert' | 'critical';
  summary: string;
  location: string;
  meetCount: number;
  notableEvents: string[];
}

interface SwingView extends SocialEvent {
  delta: number;
  actorId: string | null;
}

interface QueueView extends PendingSocialEvent {
  actorId: string | null;
}

const props = withDefaults(defineProps<{
  peers: Map<string, PeerState>;
  nodes?: WorldNode[];
  relationships: RelationshipInfo[];
  events: SocialEvent[];
  pending: PendingSocialEvent[];
  selectedActorId?: string | null;
}>(), {
  selectedActorId: null,
});

const emit = defineEmits<{
  selectPeer: [string | null];
}>();

const allNodes = computed(() => mergeWorldNodes(props.nodes ?? [], props.peers, null));
const effectiveSelectedActorId = computed(() => {
  if (!props.selectedActorId) return null;
  return findWorldNodeByIdentity(allNodes.value, props.selectedActorId)?.actorId ?? props.selectedActorId;
});

const relationshipNodeEntries = computed(() => {
  return props.relationships
    .map((relationship) => ({
      relationship,
      node: findWorldNodeForRelationship(allNodes.value, relationship),
    }))
    .filter((entry): entry is { relationship: RelationshipInfo; node: WorldNode } => !!entry.node);
});

const relatedActorIds = computed(() => new Set(relationshipNodeEntries.value.map((entry) => entry.node.actorId)));

const faultCards = computed<FaultCard[]>(() => {
  return relationshipNodeEntries.value
    .map(({ relationship, node }) => buildFaultCard(relationship, node))
    .filter((card): card is FaultCard => card !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
});

const flashpoint = computed(() => faultCards.value[0] ?? null);

const recentSwings = computed<SwingView[]>(() => {
  return props.events
    .map((event) => ({
      ...event,
      delta: event.sentimentAfter - event.sentimentBefore,
      actorId: resolveActorIdFromEvent(event),
    }))
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 3);
});

const queuedTension = computed<QueueView[]>(() => {
  return [...props.pending]
    .map((item) => ({ ...item, actorId: resolveActorIdFromPending(item) }))
    .sort((left, right) => pendingHeatValue(right) - pendingHeatValue(left))
    .slice(0, 3);
});

function buildFaultCard(relationship: RelationshipInfo, node: WorldNode): FaultCard | null {
  const peer = node.state;
  const latestEvent = props.events.find((event) => eventMatchesNode(event, node));
  const pendingEvent = props.pending.find((event) => pendingMatchesNode(event, node));
  const eventDelta = latestEvent ? latestEvent.sentimentAfter - latestEvent.sentimentBefore : 0;

  const score = Math.round(
    tierPressure(relationship.tier)
    + Math.max(0, -relationship.sentiment) * 45
    + Math.max(0, -eventDelta) * 70
    + (pendingEvent ? pendingHeatValue(pendingEvent) : 0)
    + Math.min(14, relationship.interactionCount * 1.6)
  );

  if (score <= 8 && relationship.tier !== 'nemesis' && relationship.tier !== 'rival') return null;

  const summaryParts = [
    latestEvent
      ? `${latestEvent.location} exchange moved sentiment ${formatDelta(eventDelta)}.`
      : 'No fresh exchange logged.',
    pendingEvent
      ? `Pending tension is warming at ${pendingEvent.location}.`
      : relationship.notableEvents[0] || 'No pending escalation in queue.',
  ];

  return {
    actorId: node.actorId,
    actorName: peer.name,
    archetype: peer.dna?.archetype ?? 'Unknown',
    mood: peer.mood ?? 'unknown',
    tier: relationship.tier,
    sentiment: relationship.sentiment.toFixed(2),
    interactionCount: relationship.interactionCount,
    score,
    tone: toneForScore(score),
    summary: summaryParts.join(' '),
    location: latestEvent?.location ?? pendingEvent?.location ?? '',
    meetCount: pendingEvent?.meetCount ?? 0,
    notableEvents: relationship.notableEvents,
  };
}

function tierPressure(tier: RelationshipInfo['tier']): number {
  if (tier === 'nemesis') return 62;
  if (tier === 'rival') return 44;
  if (tier === 'stranger') return 18;
  if (tier === 'acquaintance') return 12;
  if (tier === 'friend') return 6;
  return 2;
}

function toneForScore(score: number): 'watch' | 'alert' | 'critical' {
  if (score >= 80) return 'critical';
  if (score >= 50) return 'alert';
  return 'watch';
}

function resolveActorBySession(sessionId: string): string | null {
  return findWorldNodeByIdentity(allNodes.value, sessionId)?.actorId ?? null;
}

function eventMatchesNode(event: SocialEvent, node: WorldNode): boolean {
  const fromActorId = resolveActorBySession(event.from);
  if (fromActorId && fromActorId === node.actorId) return true;
  const toActorId = resolveActorBySession(event.to);
  if (toActorId && toActorId === node.actorId) return true;

  const sessions = worldNodeSessionSet(node);
  return sessions.has(event.from) || sessions.has(event.to);
}

function pendingMatchesNode(event: PendingSocialEvent, node: WorldNode): boolean {
  const fromActorId = resolveActorBySession(event.from);
  if (fromActorId && fromActorId === node.actorId) return true;
  const toActorId = resolveActorBySession(event.to);
  if (toActorId && toActorId === node.actorId) return true;

  const sessions = worldNodeSessionSet(node);
  return sessions.has(event.from) || sessions.has(event.to);
}

function resolveActorIdFromEvent(event: SocialEvent): string | null {
  const fromActorId = resolveActorBySession(event.from);
  if (fromActorId && relatedActorIds.value.has(fromActorId)) return fromActorId;
  const toActorId = resolveActorBySession(event.to);
  if (toActorId && relatedActorIds.value.has(toActorId)) return toActorId;
  return null;
}

function resolveActorIdFromPending(event: PendingSocialEvent): string | null {
  const fromActorId = resolveActorBySession(event.from);
  if (fromActorId && relatedActorIds.value.has(fromActorId)) return fromActorId;
  const toActorId = resolveActorBySession(event.to);
  if (toActorId && relatedActorIds.value.has(toActorId)) return toActorId;
  return null;
}

function selectActor(actorId: string | null): void {
  if (!actorId) return;
  emit('selectPeer', actorId);
}

function pendingHeat(item: PendingSocialEvent): string {
  return `Heat ${pendingHeatValue(item)}`;
}

function pendingHeatValue(item: PendingSocialEvent): number {
  return Math.round(Math.max(0, 0.25 - item.sentimentBefore) * 70 + Math.min(16, item.meetCount * 2));
}

function formatDelta(delta: number): string {
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;
}
</script>

<style scoped>
.fault-panel,
.fault-card-list,
.fault-section,
.swing-list,
.queue-list,
.fault-flash {
  display: grid;
  gap: 10px;
}

.fault-panel {
  min-height: 220px;
  max-height: 360px;
  padding: 14px;
  overflow-y: auto;
}

.fault-header,
.fault-card-topline,
.swing-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.fault-kicker,
.fault-section-label,
.fault-flash-label,
.fault-peer-meta {
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.fault-title {
  margin-top: 2px;
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--text-strong);
}

.fault-count,
.fault-score,
.fault-badge {
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  padding: 4px 10px;
  font-size: 0.66rem;
  font-weight: 800;
  color: var(--text-body);
  background: rgba(255, 255, 255, 0.72);
}

.fault-flash,
.fault-card,
.swing-item,
.queue-item,
.fault-empty {
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.72);
}

.interactive {
  cursor: pointer;
  transition: transform 180ms var(--ease-snap), border-color 180ms var(--ease-snap), box-shadow 180ms var(--ease-snap);
}

.interactive:hover,
.interactive:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(37, 99, 235, 0.28);
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.1);
  outline: none;
}

.selected {
  border-color: rgba(37, 99, 235, 0.34);
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.22);
}

.fault-flash.watch,
.fault-card.watch {
  border-color: rgba(202, 138, 4, 0.2);
}

.fault-flash.alert,
.fault-card.alert,
.fault-flash.critical,
.fault-card.critical {
  border-color: rgba(220, 38, 38, 0.2);
}

.fault-peer,
.fault-flash-title,
.swing-topline span {
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text-strong);
}

.fault-card-copy,
.fault-flash-copy,
.fault-note,
.swing-copy,
.fault-empty {
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--text-body);
}

.fault-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fault-empty.subtle {
  color: var(--text-muted);
}

.up {
  color: #0f766e;
}

.down {
  color: #b42343;
}
</style>
