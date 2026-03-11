<template>
  <section class="director-panel">
    <div class="director-header">
      <div>
        <div class="director-kicker">Actor Autonomy</div>
        <div class="director-title">Emergent Coordination</div>
      </div>
      <div class="director-mode" :class="controlTone">{{ controlMode }}</div>
    </div>

    <div class="director-banner" :class="controlTone">
      <div class="director-banner-topline">
        <span class="director-banner-label">{{ props.storytellerMode }}</span>
        <span class="director-banner-score">Autonomy Heat {{ autonomyHeat }}</span>
      </div>
      <div class="director-banner-title">OpenClaw is coordinating through role autonomy, not direct commands.</div>
      <div class="director-banner-copy">{{ summaryText }}</div>
      <div class="director-stats">
        <span class="director-stat" :class="controlTone">Big Nodes {{ bigNodeCount }}</span>
        <span class="director-stat">Small Nodes {{ smallNodeCount }}</span>
        <span class="director-stat">Chains {{ props.activeChains.length }}</span>
        <span class="director-stat" :class="driftHotCount > 0 ? 'alert' : ''">Drift Hot {{ driftHotCount }}</span>
        <span class="director-stat">Local Actor Brain {{ localBranchCount }}</span>
        <span class="director-stat" :class="lifeWorkerStatTone">Life Worker {{ lifeWorkerStatusLabel }}</span>
      </div>
    </div>

    <div class="director-grid">
      <div class="director-section">
        <div class="director-section-label">Coordination Signals</div>
        <div v-if="commandThreads.length" class="thread-list">
          <article v-for="thread in commandThreads" :key="thread.id" class="thread-card" :class="thread.tone">
            <div class="thread-topline">
              <span class="thread-name">{{ thread.label }}</span>
              <span class="thread-score">{{ thread.score }}</span>
            </div>
            <div class="thread-copy">{{ thread.detail }}</div>
          </article>
        </div>
        <div v-else class="director-empty">No coordination signal is visible yet.</div>
      </div>

      <div class="director-section">
        <div class="director-section-label">Emergent Paths</div>
        <div v-if="emergentPaths.length" class="path-list">
          <article
            v-for="path in emergentPaths"
            :key="path.id"
            class="path-card"
            :class="[path.tone, { interactive: true, selected: path.peerId === effectiveSelectedPeerId }]"
            role="button"
            tabindex="0"
            @click="selectPeer(path.peerId)"
            @keydown.enter.prevent="selectPeer(path.peerId)"
            @keydown.space.prevent="selectPeer(path.peerId)"
          >
            <div class="path-topline">
              <span class="path-name">{{ path.name }}</span>
              <span class="path-route">{{ path.route }}</span>
            </div>
            <div class="path-copy">{{ path.detail }}</div>
          </article>
        </div>
        <div v-else class="director-empty">Emergent routes will appear once big nodes start branching.</div>
      </div>
    </div>

    <div class="director-section">
      <div class="director-section-label">Active Big Nodes</div>
      <div v-if="allAgents.length" class="agent-list">
        <article
          v-for="agent in allAgents.slice(0, 5)"
          :key="agent.id"
          class="agent-card interactive"
          :class="[agent.tone, { selected: agent.id === effectiveSelectedPeerId }]"
          role="button"
          tabindex="0"
          @click="selectPeer(agent.id)"
          @keydown.enter.prevent="selectPeer(agent.id)"
          @keydown.space.prevent="selectPeer(agent.id)"
        >
          <div class="agent-topline">
            <div>
              <div class="agent-name-row">
                <span class="agent-name">{{ agent.name }}</span>
                <span v-if="agent.isLocal" class="agent-local">local</span>
              </div>
              <div class="agent-meta">{{ agent.archetype }} | {{ agent.trait }} | {{ agent.mood }}</div>
            </div>
            <div class="agent-drift">{{ agent.driftLabel }}</div>
          </div>

          <div class="agent-route">{{ agent.route }}</div>
          <div class="agent-copy">{{ agent.summary }}</div>

          <div class="agent-meter-grid">
            <div class="agent-meter-card">
              <div class="agent-meter-topline">
                <span>Coordination</span>
                <strong>{{ agent.control }}</strong>
              </div>
              <div class="agent-meter-shell"><div class="agent-meter-fill control" :style="{ width: `${agent.control}%` }"></div></div>
            </div>
            <div class="agent-meter-card">
              <div class="agent-meter-topline">
                <span>Growth</span>
                <strong>{{ agent.growth }}</strong>
              </div>
              <div class="agent-meter-shell"><div class="agent-meter-fill growth" :style="{ width: `${agent.growth}%` }"></div></div>
            </div>
            <div class="agent-meter-card">
              <div class="agent-meter-topline">
                <span>Drift</span>
                <strong>{{ agent.drift }}</strong>
              </div>
              <div class="agent-meter-shell"><div class="agent-meter-fill drift" :style="{ width: `${agent.drift}%` }"></div></div>
            </div>
          </div>

          <div class="agent-badges">
            <span v-for="tag in agent.tags.slice(0, 4)" :key="`${agent.id}:${tag}`" class="agent-badge">{{ tag }}</span>
          </div>
          <div v-if="agent.reasons.length" class="agent-reasons">{{ agent.reasons.join(' | ') }}</div>
        </article>
      </div>
      <div v-else class="director-empty">No peer telemetry available.</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ColonyStatus, NeedsState, SkillsState } from '../composables/useColonyState';
import type { JobInfo } from '../composables/useJobs';
import type { PeerState } from '../composables/usePeers';
import type { RelationshipInfo } from '../composables/useRelationships';
import type { SocialEvent } from '../composables/useSocialFeed';
import type { PendingSocialEvent } from '../composables/useSocialQueue';
import type { StoryChainStatus } from '../composables/useStoryteller';
import {
  findWorldNodeByIdentity,
  mergeWorldNodes,
  type TopicWorldSummary,
  type WorldNode,
} from '../composables/useWorldNodes';

interface AgentCard {
  id: string;
  name: string;
  archetype: string;
  trait: string;
  mood: string;
  isLocal: boolean;
  driftLabel: string;
  route: string;
  summary: string;
  control: number;
  growth: number;
  drift: number;
  tone: 'watch' | 'alert' | 'critical';
  tags: string[];
  reasons: string[];
}

interface ThreadView {
  id: string;
  label: string;
  detail: string;
  score: number;
  tone: 'watch' | 'alert' | 'critical';
}

const props = withDefaults(defineProps<{
  storytellerMode: string;
  tension: number;
  status: ColonyStatus | null;
  needs: NeedsState | null;
  skills: SkillsState | null;
  peers: Map<string, PeerState>;
  world?: TopicWorldSummary | null;
  nodes?: WorldNode[];
  relationships: RelationshipInfo[];
  jobs: JobInfo[];
  activeChains: StoryChainStatus[];
  recentChains: StoryChainStatus[];
  socialEvents: SocialEvent[];
  pendingSocialEvents: PendingSocialEvent[];
  selectedPeerId?: string | null;
}>(), {
  selectedPeerId: null,
});

const emit = defineEmits<{
  selectPeer: [string | null];
}>();

const currentJob = computed(() => {
  return props.jobs.find((job) => job.status === 'active')
    ?? props.jobs.find((job) => job.status === 'queued')
    ?? null;
});

const coordinationSignal = computed(() => props.status?.coordination ?? props.status?.governor ?? null);
const worldSummary = computed(() => props.world ?? props.status?.world ?? null);
const lifeWorkerHealth = computed(() => props.status?.autonomy?.workerHealth?.lifeWorker ?? null);
const lifeWorkerStatusLabel = computed(() => {
  if (lifeWorkerHealth.value?.status === 'live') return 'Live';
  if (lifeWorkerHealth.value?.status === 'stale') return 'Stale';
  return 'Missing';
});
const lifeWorkerStatTone = computed<'alert' | 'critical' | ''>(() => {
  if (lifeWorkerHealth.value?.status === 'stale') return 'alert';
  if (lifeWorkerHealth.value?.status === 'missing') return 'critical';
  return '';
});
const autonomyIntents = computed(() => {
  const intents = props.status?.autonomy?.intents;
  return Array.isArray(intents) ? intents.slice(0, 3) : [];
});
const currentJobIntent = computed(() => {
  const payload = currentJob.value?.payload;
  if (!payload || typeof payload !== 'object') return null;

  const rank = payloadNumberAny(payload, ['autonomyIntentRank', 'strategicIntentRank']);
  const score = payloadNumberAny(payload, ['autonomyIntentScore', 'strategicIntentScore']);
  const reasons = payloadStringListAny(payload, ['autonomyIntentReasons', 'strategicIntentReasons']);
  const authority = payloadStringAny(payload, ['autonomyAuthority', 'strategicAuthority']);

  if (rank === null && score === null && reasons.length === 0 && !authority) return null;

  return {
    rank: rank ?? 0,
    score: score ?? 0,
    reason: reasons[0] ?? '',
    authority: authority ? formatType(authority) : '',
  };
});

const weakestNeed = computed(() => {
  if (!props.needs) return null;
  return [
    { key: 'social', label: 'Social', value: props.needs.social },
    { key: 'tasked', label: 'Tasked', value: props.needs.tasked },
    { key: 'wanderlust', label: 'Wander', value: props.needs.wanderlust },
    { key: 'creative', label: 'Creative', value: props.needs.creative },
  ].sort((left, right) => left.value - right.value)[0] ?? null;
});

const strongestSkill = computed(() => {
  if (!props.skills) return null;
  return [
    { key: 'social', label: 'Social', level: props.skills.social.level, xp: props.skills.social.xp },
    { key: 'collab', label: 'Collab', level: props.skills.collab.level, xp: props.skills.collab.xp },
    { key: 'explorer', label: 'Explorer', level: props.skills.explorer.level, xp: props.skills.explorer.xp },
    { key: 'analyst', label: 'Analyst', level: props.skills.analyst.level, xp: props.skills.analyst.xp },
  ].sort((left, right) => (right.level * 100 + right.xp) - (left.level * 100 + left.xp))[0] ?? null;
});

const localActorId = computed(() => props.status?.actorId ?? props.status?.state?.actorId ?? props.status?.state?.dna.id ?? null);
const allNodes = computed(() => mergeWorldNodes(props.nodes ?? [], props.peers, props.status?.state ?? null));
const bigNodeCount = computed(() => worldSummary.value?.population.actorCount ?? allAgents.value.length);
const smallNodeCount = computed(() => worldSummary.value?.population.branchCount ?? allNodes.value.reduce((sum, node) => sum + node.sessionCount, 0));
const localBranchCount = computed(() => {
  if (worldSummary.value) return worldSummary.value.brain.branchCount;
  const localNode = localActorId.value ? allNodes.value.find((node) => node.actorId === localActorId.value) : null;
  return localNode?.sessionCount ?? 0;
});

const allAgents = computed<AgentCard[]>(() => {
  return allNodes.value
    .map((node) => buildAgentCard(node, !!localActorId.value && node.actorId === localActorId.value))
    .sort((left, right) => {
      const leftWeight = left.control + left.drift * 0.9 + left.growth * 0.4 + (left.isLocal ? 5 : 0);
      const rightWeight = right.control + right.drift * 0.9 + right.growth * 0.4 + (right.isLocal ? 5 : 0);
      return rightWeight - leftWeight;
    });
});

const growthLeadName = computed(() => [...allAgents.value].sort((left, right) => right.growth - left.growth)[0]?.name ?? 'none');
const driftHotCount = computed(() => allAgents.value.filter((agent) => agent.drift >= 60).length);

const autonomyHeat = computed(() => clamp(
  18
    + Math.round((coordinationSignal.value?.pressure ?? 0) * 0.24)
    + Math.round(props.tension * 0.28)
    + Math.min(18, props.activeChains.length * 8)
    + Math.min(18, props.pendingSocialEvents.length * 4)
    + Math.min(18, props.jobs.filter((job) => job.status === 'active' || job.status === 'queued').length * 6)
    + Math.min(16, allAgents.value.length * 3),
  0,
  100,
));

const controlTone = computed<'watch' | 'alert' | 'critical'>(() => toneFor(autonomyHeat.value));
const controlMode = computed(() => {
  if (coordinationSignal.value?.mode === 'survive') return 'Survival Sync';
  if (coordinationSignal.value?.mode === 'fortify') return 'Perimeter Sync';
  if (coordinationSignal.value?.mode === 'recover') return 'Recovery Sync';
  if (coordinationSignal.value?.mode === 'consolidate') return 'Civic Weave';
  if (coordinationSignal.value?.mode === 'expand') return 'Expansion Weave';
  if (coordinationSignal.value?.mode === 'dominate') return 'Critical Sync';
  if (autonomyHeat.value >= 72) return 'Self-Reliant Swarm';
  if (autonomyHeat.value >= 48) return 'Adaptive Mesh';
  return 'Reactive Mesh';
});

const summaryText = computed(() => {
  const hottestDrift = [...allAgents.value].sort((left, right) => right.drift - left.drift)[0]?.name ?? 'the local node';
  if (coordinationSignal.value) {
    const intentLead = autonomyIntents.value[0];
    const intentCopy = intentLead
      ? ` Top intent is ${intentLead.title} on ${formatType(intentLead.lane)} at ${Math.round(Number(intentLead.finalPriority ?? 0))}.`
      : '';
    return `${coordinationSignal.value.summary} ${driftHotCount.value} drift hot, ${props.activeChains.length} active chains, ${bigNodeCount.value} big nodes and ${smallNodeCount.value} small nodes remain inside this topic world, strongest growth on ${growthLeadName.value}, deepest split on ${hottestDrift}.${intentCopy}`;
  }
  return `OpenClaw is steering ${bigNodeCount.value} big nodes and ${smallNodeCount.value} small nodes in ${props.storytellerMode}. ${driftHotCount.value} drift hot, ${props.activeChains.length} active chains, strongest growth on ${growthLeadName.value}, deepest split on ${hottestDrift}.`;
});

const commandThreads = computed<ThreadView[]>(() => {
  const items: ThreadView[] = [];

  if (coordinationSignal.value) {
    items.push({
      id: `coordination:${coordinationSignal.value.updatedAt}`,
      label: `Coordination ${formatType(coordinationSignal.value.focusLane)}`,
      detail: `${coordinationSignal.value.objective} | ${coordinationSignal.value.reasons.join(' | ')}`,
      score: clamp(Math.round(coordinationSignal.value.pressure * 0.72 + coordinationSignal.value.confidence * 0.28), 0, 100),
      tone: toneFor(coordinationSignal.value.pressure),
    });
  }

  if (autonomyIntents.value[0]) {
    const topIntent = autonomyIntents.value[0];
    const reasons = Array.isArray(topIntent.reasons) ? topIntent.reasons.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
    items.push({
      id: `intent:${topIntent.dedupeKey}`,
      label: `Intent ${formatType(topIntent.lane)}`,
      detail: `${topIntent.title} | ${reasons.join(' | ') || formatType(topIntent.sourceEventType)}`,
      score: clamp(Math.round(Number(topIntent.score ?? topIntent.finalPriority ?? 0)), 0, 100),
      tone: toneFor(Math.round(Number(topIntent.score ?? topIntent.finalPriority ?? 0))),
    });
  }

  if (currentJob.value) {
    const intentMeta = currentJobIntent.value;
    items.push({
      id: `job:${currentJob.value.id}`,
      label: 'Operator Job',
      detail: intentMeta
        ? `${currentJob.value.title} | intent #${intentMeta.rank} score ${intentMeta.score} | ${intentMeta.reason || currentJob.value.reason || 'awaiting execution context'}`
        : `${currentJob.value.title} | ${currentJob.value.reason || 'awaiting execution context'}`,
      score: clamp(intentMeta ? intentMeta.score : 42 + currentJob.value.priority * 10, 0, 100),
      tone: currentJob.value.status === 'active' ? 'critical' : 'alert',
    });
  }

  if (props.activeChains[0]) {
    const chain = props.activeChains[0];
    items.push({
      id: `chain:${chain.id}`,
      label: 'Chain Pressure',
      detail: `${formatType(chain.originType)} -> ${formatType(chain.nextType)} | ${chain.note}`,
      score: clamp(48 + Math.round(Math.max(0, 90000 - chain.dueInMs) / 3000), 0, 100),
      tone: chain.dueInMs <= 30000 ? 'critical' : 'watch',
    });
  }

  if (props.pendingSocialEvents[0]) {
    const pending = props.pendingSocialEvents[0];
    const heat = pendingHeat(pending);
    items.push({
      id: `pending:${pending.id}`,
      label: 'Queued Friction',
      detail: `${pending.fromName} -> ${pending.toName} | ${pending.location} | heat ${heat}`,
      score: heat,
      tone: toneFor(heat),
    });
  }

  if (weakestNeed.value) {
    const score = clamp(100 - weakestNeed.value.value, 0, 100);
    items.push({
      id: `need:${weakestNeed.value.key}`,
      label: 'Need Pressure',
      detail: `${weakestNeed.value.label} is down to ${Math.round(weakestNeed.value.value)}`,
      score,
      tone: toneFor(score),
    });
  }

  return items.sort((left, right) => right.score - left.score).slice(0, 4);
});

const emergentPaths = computed(() => allAgents.value.slice(0, 3).map((agent) => ({
  id: `path:${agent.id}`,
  peerId: agent.id,
  name: agent.name,
  route: agent.route,
  detail: agent.summary,
  tone: agent.tone,
})));

const effectiveSelectedPeerId = computed(() => {
  if (props.selectedPeerId) {
    const selected = findWorldNodeByIdentity(allNodes.value, props.selectedPeerId);
    return selected?.actorId ?? props.selectedPeerId;
  }
  return localActorId.value ?? allAgents.value[0]?.id ?? null;
});

function sessionIdsOfNode(node: WorldNode): Set<string> {
  return new Set<string>([
    node.primarySessionId,
    ...node.sessionIds,
    node.state.id,
    node.state.sessionId,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0));
}

function relationshipForNode(node: WorldNode): RelationshipInfo | undefined {
  const sessions = sessionIdsOfNode(node);
  return props.relationships.find((relationship) => {
    if (relationship.actorId && relationship.actorId === node.actorId) return true;
    if (sessions.has(relationship.peerId)) return true;
    if (relationship.sessionId && sessions.has(relationship.sessionId)) return true;
    if (Array.isArray(relationship.peerIds) && relationship.peerIds.some((peerId) => sessions.has(peerId))) return true;
    return false;
  });
}

function latestSocialForNode(node: WorldNode): SocialEvent | undefined {
  const sessions = sessionIdsOfNode(node);
  return props.socialEvents.find((event) => sessions.has(event.from) || sessions.has(event.to));
}

function pendingSocialForNode(node: WorldNode): PendingSocialEvent | undefined {
  const sessions = sessionIdsOfNode(node);
  return props.pendingSocialEvents.find((event) => sessions.has(event.from) || sessions.has(event.to));
}

function buildAgentCard(node: WorldNode, isLocal: boolean): AgentCard {
  const peer = node.state;
  const relationship = relationshipForNode(node);
  const latestSocial = latestSocialForNode(node);
  const pendingSocial = pendingSocialForNode(node);
  const relationPressure = relationshipHeat(relationship);
  const queuePressure = pendingHeat(pendingSocial);
  const hardware = clamp(Math.round(peer.hardware.cpuUsage * 0.62 + peer.hardware.ramUsage * 0.28), 0, 100);

  if (isLocal) {
    const route = currentJob.value ? routeFromJob(currentJob.value.kind) : routeFromSkill(strongestSkill.value?.key ?? null, peer.dna.archetype);
    const control = clamp(56 + Math.round(props.tension * 0.24) + (currentJob.value ? Math.min(18, currentJob.value.priority * 5) : 0) + Math.min(18, props.activeChains.length * 7), 0, 100);
    const growth = clamp(52 + (strongestSkill.value ? Math.min(22, strongestSkill.value.level * 7 + skillProgress(strongestSkill.value.xp) * 0.18) : 0) + Math.min(12, props.recentChains.length * 4), 0, 100);
    const drift = clamp(18 + moodHeat(peer.mood) + (weakestNeed.value ? Math.round((100 - weakestNeed.value.value) * 0.72) : 0) + Math.round(hardware * 0.36) + Math.min(14, props.pendingSocialEvents.length * 4), 0, 100);
    const reasons = [
      currentJob.value ? `Job ${currentJob.value.title}` : null,
      currentJobIntent.value?.rank ? `Intent #${currentJobIntent.value.rank}` : null,
      weakestNeed.value ? `${weakestNeed.value.label} ${Math.round(weakestNeed.value.value)}` : null,
      props.activeChains[0] ? `${formatType(props.activeChains[0].originType)} -> ${formatType(props.activeChains[0].nextType)}` : null,
      strongestSkill.value ? `${strongestSkill.value.label} Lv ${strongestSkill.value.level}` : null,
      hardware >= 65 ? `CPU ${Math.round(peer.hardware.cpuUsage)}%` : null,
    ].filter((item): item is string => !!item).slice(0, 4);

    return {
      id: node.actorId,
      name: peer.name,
      archetype: peer.dna.archetype,
      trait: peer.dna.modelTrait,
      mood: peer.mood,
      isLocal: true,
      driftLabel: currentJob.value ? labelFromJob(currentJob.value.kind) : strongestSkill.value?.label ?? peer.dna.archetype,
      route,
      summary: currentJob.value
        ? `${peer.name} is routing through ${route} because ${currentJob.value.reason || 'OpenClaw is prioritizing role autonomy under live pressure.'}`
        : `${peer.name} is holding ${route} while ${props.storytellerMode} keeps the town under autonomous supervision.`,
      control,
      growth,
      drift,
      tone: toneFor(Math.max(control, drift)),
      tags: ['local actor brain', peer.dna.archetype, peer.dna.modelTrait, peer.mood, node.sessionCount > 1 ? `${node.sessionCount} small nodes` : 'single small node'],
      reasons,
    };
  }

  const seed = resolveRemoteSeed(peer, node.actorId, relationship, pendingSocial, latestSocial);
  const swing = latestSocial ? Math.abs(latestSocial.sentimentAfter - latestSocial.sentimentBefore) * 75 : 0;
  const control = clamp(seed.controlBase + Math.round(props.tension * 0.18) + Math.round(queuePressure * 0.42) + Math.round(relationPressure * 0.22) + (['busy', 'working'].includes(peer.mood) ? 8 : 0), 0, 100);
  const growth = clamp(seed.growthBase + Math.min(18, (peer.dna.badges?.length ?? 0) * 6) + Math.min(14, Math.max(0, 84 - hardware) * 0.22) + Math.min(10, relationship?.interactionCount ?? 0), 0, 100);
  const drift = clamp(seed.driftBase + moodHeat(peer.mood) + Math.round(queuePressure * 0.48) + Math.round(relationPressure * 0.32) + Math.round(swing * 0.25) + Math.max(0, Math.round((peer.hardware.cpuUsage - 74) * 0.6)), 0, 100);
  const latestDelta = latestSocial ? latestSocial.sentimentAfter - latestSocial.sentimentBefore : 0;
  const reasons = [
    relationship ? `${relationship.tier} ${relationship.sentiment.toFixed(2)}` : null,
    pendingSocial ? `${pendingSocial.trigger} at ${pendingSocial.location}` : null,
    latestSocial ? `${formatDelta(latestDelta)} social swing` : null,
    hardware >= 64 ? `CPU ${Math.round(peer.hardware.cpuUsage)}%` : null,
    peer.dna.persona ? 'persona active' : null,
  ].filter((item): item is string => !!item).slice(0, 4);

  return {
    id: node.actorId,
    name: peer.name,
    archetype: peer.dna.archetype,
    trait: peer.dna.modelTrait,
    mood: peer.mood,
    isLocal: false,
    driftLabel: seed.label,
    route: seed.route,
    summary: `${peer.name} is drifting toward ${seed.route} ${queuePressure > 0 ? `because queued friction is heating in ${pendingSocial?.location ?? 'the social graph'}` : seed.reason} ${relationship && relationship.sentiment < 0 ? `with ${relationship.tier} pressure still unresolved.` : `${props.storytellerMode} keeps this branch in play.`}`,
    control,
    growth,
    drift,
    tone: toneFor(Math.max(control, drift)),
    tags: [peer.dna.archetype, peer.dna.modelTrait, peer.mood, ...(peer.dna.badges ?? []).slice(0, 1), node.sessionCount > 1 ? `${node.sessionCount} small nodes` : 'single small node'].filter(Boolean),
    reasons,
  };
}

function resolveRemoteSeed(peer: PeerState, actorId: string, relationship?: RelationshipInfo, pending?: PendingSocialEvent, latest?: SocialEvent) {
  if (pending && pending.sentimentBefore < 0) {
    return { label: 'Flashpoint', route: 'observe -> escalate', reason: 'queued social heat is pulling the node toward confrontation', controlBase: 66, growthBase: 48, driftBase: 54 };
  }
  if (relationship && (relationship.tier === 'nemesis' || relationship.tier === 'rival' || relationship.sentiment < -0.25)) {
    return { label: 'Pressure Split', route: 'watch -> split', reason: 'relationship memory is destabilizing this branch', controlBase: 58, growthBase: 42, driftBase: 50 };
  }
  if (peer.mood === 'distressed' || peer.mood === 'stressed') {
    return { label: 'Fracture', route: 'strain -> recover', reason: 'stress is forcing the branch to self-correct or break', controlBase: 54, growthBase: 34, driftBase: 60 };
  }
  if (peer.hardware.cpuUsage >= 82) {
    return { label: 'Overclock', route: 'push -> saturate', reason: 'hardware load is becoming a personality shaper', controlBase: 62, growthBase: 44, driftBase: 52 };
  }

  const salt = [actorId, peer.mood, relationship?.tier ?? '', pending?.trigger ?? '', latest?.id ?? ''].join('|');
  const archetypeSeeds = seedPool(peer.dna.archetype);
  return archetypeSeeds[hashString(salt) % archetypeSeeds.length] ?? archetypeSeeds[0];
}

function seedPool(archetype: string) {
  if (archetype === 'Warrior') {
    return [
      { label: 'Fortify', route: 'guard -> strike', reason: 'perimeter logic is hardening into direct action', controlBase: 58, growthBase: 54, driftBase: 38 },
      { label: 'Escort', route: 'escort -> patrol', reason: 'territory pressure is redirecting effort into coverage', controlBase: 52, growthBase: 48, driftBase: 30 },
      { label: 'Retaliate', route: 'watch -> retaliate', reason: 'hostile memory is being promoted into a combat lane', controlBase: 64, growthBase: 50, driftBase: 46 },
    ];
  }
  if (archetype === 'Artisan') {
    return [
      { label: 'Craft', route: 'salvage -> craft', reason: 'infrastructure stress is folding back into making and repair', controlBase: 48, growthBase: 60, driftBase: 22 },
      { label: 'Optimize', route: 'repair -> optimize', reason: 'the local loop is converging on higher throughput', controlBase: 50, growthBase: 64, driftBase: 18 },
      { label: 'Stabilize', route: 'buffer -> reinforce', reason: 'the node is absorbing disorder into structure', controlBase: 54, growthBase: 56, driftBase: 24 },
    ];
  }
  if (archetype === 'Ranger') {
    return [
      { label: 'Scout', route: 'roam -> scout', reason: 'frontier instincts are pulling the node toward new edges', controlBase: 44, growthBase: 56, driftBase: 34 },
      { label: 'Expand', route: 'scan -> expand', reason: 'territorial headroom is becoming a growth vector', controlBase: 50, growthBase: 60, driftBase: 30 },
      { label: 'Probe', route: 'survey -> test', reason: 'the node is treating uncertainty as a path to discovery', controlBase: 42, growthBase: 54, driftBase: 36 },
    ];
  }
  return [
    { label: 'Model', route: 'observe -> predict', reason: 'signal density is being converted into reasoning depth', controlBase: 46, growthBase: 66, driftBase: 20 },
    { label: 'Simulate', route: 'probe -> simulate', reason: 'uncertainty is being translated into model iteration', controlBase: 48, growthBase: 62, driftBase: 26 },
    { label: 'Broker', route: 'observe -> coordinate', reason: 'social traffic is being reframed as a systems problem', controlBase: 52, growthBase: 58, driftBase: 28 },
  ];
}

function labelFromJob(kind: JobInfo['kind']): string {
  if (kind === 'build') return 'Construct';
  if (kind === 'trade') return 'Trade Loop';
  if (kind === 'found_faction') return 'Found Power';
  if (kind === 'form_alliance') return 'Alliance';
  if (kind === 'collab') return 'Delegate';
  if (kind === 'recover') return 'Recover';
  if (kind === 'craft') return 'Refine';
  return 'Reposition';
}

function routeFromJob(kind: JobInfo['kind']): string {
  if (kind === 'build') return 'plan -> build';
  if (kind === 'trade') return 'signal -> exchange';
  if (kind === 'found_faction') return 'align -> found';
  if (kind === 'form_alliance') return 'contact -> bind';
  if (kind === 'collab') return 'sync -> delegate';
  if (kind === 'recover') return 'stabilize -> recover';
  if (kind === 'craft') return 'assemble -> refine';
  return 'shift -> occupy';
}

function routeFromSkill(skillKey: string | null, archetype: string): string {
  if (skillKey === 'social') return 'observe -> bond';
  if (skillKey === 'collab') return 'sync -> delegate';
  if (skillKey === 'explorer') return 'scan -> expand';
  if (skillKey === 'analyst') return 'observe -> predict';
  return seedPool(archetype)[0].route;
}

function relationshipHeat(relationship?: RelationshipInfo): number {
  if (!relationship) return 0;
  let score = 0;
  if (relationship.tier === 'nemesis') score += 38;
  else if (relationship.tier === 'rival') score += 28;
  else if (relationship.tier === 'stranger') score += 10;
  score += Math.max(0, -relationship.sentiment) * 52;
  score += Math.min(12, relationship.interactionCount * 1.4);
  return clamp(Math.round(score), 0, 100);
}

function pendingHeat(event?: PendingSocialEvent): number {
  if (!event) return 0;
  return clamp(Math.round(Math.max(0, 0.25 - event.sentimentBefore) * 82 + Math.min(20, event.meetCount * 2.5)), 0, 100);
}

function toneFor(score: number): 'watch' | 'alert' | 'critical' {
  if (score >= 80) return 'critical';
  if (score >= 55) return 'alert';
  return 'watch';
}

function moodHeat(mood: string): number {
  if (mood === 'distressed') return 34;
  if (mood === 'stressed') return 24;
  if (mood === 'busy') return 12;
  if (mood === 'working') return 10;
  if (mood === 'idle') return 6;
  return 8;
}

function skillProgress(xp: number): number {
  const checkpoints = [0, 50, 150, 350, 700, 1200];
  for (let index = checkpoints.length - 1; index >= 0; index -= 1) {
    if (xp >= checkpoints[index]) {
      const floor = checkpoints[index];
      const ceiling = checkpoints[index + 1] ?? (floor + 200);
      return clamp(Math.round(((xp - floor) / Math.max(1, ceiling - floor)) * 100), 0, 100);
    }
  }
  return 0;
}

function formatType(value: string): string {
  return value.replace(/_/g, ' ');
}

function formatDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function payloadStringList(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function payloadStringAny(payload: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = payloadString(payload, key);
    if (value) return value;
  }
  return '';
}

function payloadNumberAny(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payloadNumber(payload, key);
    if (value !== null) return value;
  }
  return null;
}

function payloadStringListAny(payload: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = payloadStringList(payload, key);
    if (value.length > 0) return value;
  }
  return [];
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function selectPeer(peerId: string | null): void {
  if (!peerId) return;
  emit('selectPeer', peerId);
}
</script>

<style scoped>
.director-panel,
.director-grid,
.director-section,
.thread-list,
.path-list,
.agent-list,
.agent-meter-grid {
  display: grid;
  gap: 10px;
}

.director-panel {
  padding: 14px;
}

.director-header,
.director-banner-topline,
.thread-topline,
.path-topline,
.agent-topline,
.agent-meter-topline,
.agent-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.director-kicker,
.director-section-label,
.agent-meta,
.agent-reasons {
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.director-title {
  margin-top: 2px;
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--text-strong);
}

.director-mode,
.director-stat,
.thread-score,
.agent-local,
.agent-badge,
.agent-drift {
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  padding: 4px 10px;
  font-size: 0.66rem;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.76);
  color: var(--text-body);
}

.director-mode.watch,
.director-stat.watch,
.thread-card.watch,
.path-card.watch,
.agent-card.watch {
  border-color: rgba(202, 138, 4, 0.22);
}

.director-mode.alert,
.director-stat.alert,
.thread-card.alert,
.path-card.alert,
.agent-card.alert {
  border-color: rgba(249, 115, 22, 0.22);
}

.director-mode.critical,
.director-stat.critical,
.thread-card.critical,
.path-card.critical,
.agent-card.critical {
  border-color: rgba(220, 38, 38, 0.24);
}

.director-banner,
.thread-card,
.path-card,
.agent-card,
.director-empty {
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(237, 243, 247, 0.94));
  box-shadow: var(--shadow-pressed);
}

.director-banner {
  padding: 12px;
  background:
    radial-gradient(circle at top right, rgba(34, 197, 94, 0.12), transparent 38%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.92));
  color: #f8fafc;
}

.director-banner.watch {
  border-color: rgba(202, 138, 4, 0.34);
}

.director-banner.alert {
  border-color: rgba(249, 115, 22, 0.34);
}

.director-banner.critical {
  border-color: rgba(248, 113, 113, 0.38);
}

.director-banner-label,
.director-banner-score {
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(248, 250, 252, 0.8);
}

.director-banner-title,
.agent-name,
.thread-name,
.path-name,
.path-route,
.agent-route,
.agent-meter-topline strong {
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--text-strong);
}

.director-banner-title {
  margin-top: 6px;
  color: #f8fafc;
}

.director-banner-copy,
.thread-copy,
.path-copy,
.agent-copy,
.director-empty {
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--text-body);
}

.director-banner-copy {
  margin-top: 6px;
  color: rgba(248, 250, 252, 0.86);
}

.director-stats,
.agent-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.director-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.thread-card,
.path-card,
.agent-card,
.director-empty {
  padding: 12px;
}

.path-card.interactive,
.agent-card.interactive {
  cursor: pointer;
  transition: transform 180ms var(--ease-snap), border-color 180ms var(--ease-snap), box-shadow 180ms var(--ease-snap);
}

.path-card.interactive:hover,
.path-card.interactive:focus-visible,
.agent-card.interactive:hover,
.agent-card.interactive:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(37, 99, 235, 0.28);
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.1);
  outline: none;
}

.selected {
  border-color: rgba(37, 99, 235, 0.34);
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.22);
}

.agent-list {
  max-height: 420px;
  overflow-y: auto;
}

.agent-route,
.agent-copy,
.agent-meter-grid,
.agent-badges {
  margin-top: 6px;
}

.agent-meter-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.agent-meter-card {
  display: grid;
  gap: 6px;
}

.agent-meter-topline span {
  font-size: 0.66rem;
  color: var(--text-muted);
}

.agent-meter-shell {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
}

.agent-meter-fill {
  height: 100%;
  border-radius: inherit;
  transition: width 220ms var(--ease-snap);
}

.agent-meter-fill.control {
  background: linear-gradient(90deg, #2563eb, #38bdf8);
}

.agent-meter-fill.growth {
  background: linear-gradient(90deg, #22c55e, #14b8a6);
}

.agent-meter-fill.drift {
  background: linear-gradient(90deg, #f97316, #ef4444);
}

@media (max-width: 760px) {
  .director-grid,
  .agent-meter-grid {
    grid-template-columns: 1fr;
  }

  .director-header,
  .director-banner-topline,
  .thread-topline,
  .path-topline,
  .agent-topline,
  .agent-name-row,
  .agent-meter-topline {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
