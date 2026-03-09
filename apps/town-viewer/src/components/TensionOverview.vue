<template>
  <section class="tension-panel">
    <div class="tp-header">
      <div>
        <div class="tp-kicker">System Tension</div>
        <div class="tp-title">Pressure Readout</div>
      </div>
      <div class="tp-chip" :class="tensionTone">
        {{ tensionLabel }} · {{ tension }}
      </div>
    </div>

    <div class="tp-meter-shell">
      <div class="tp-meter-track">
        <div class="tp-meter-fill" :class="tensionTone" :style="{ width: `${safeTension}%` }"></div>
      </div>

      <div class="tp-stat-grid">
        <div class="tp-stat-card">
          <span class="tp-stat-label">Distressed</span>
          <strong>{{ distressedCount }}</strong>
        </div>
        <div class="tp-stat-card">
          <span class="tp-stat-label">Critical Needs</span>
          <strong>{{ criticalNeeds.length }}</strong>
        </div>
        <div class="tp-stat-card">
          <span class="tp-stat-label">Wars</span>
          <strong>{{ activeWarCount }}</strong>
        </div>
        <div class="tp-stat-card">
          <span class="tp-stat-label">Raid Risk</span>
          <strong>{{ combatStatus?.raidRisk ?? 0 }}</strong>
        </div>
      </div>
    </div>

    <div v-if="flashpoint" class="tp-flashpoint">
      <div class="tp-section-label">Current Flashpoint</div>
      <div class="tp-flashpoint-title">{{ flashpoint.title }}</div>
      <div class="tp-flashpoint-copy">{{ flashpoint.detail }}</div>
    </div>

    <div class="tp-section">
      <div class="tp-section-label">Top Drivers</div>

      <div v-if="driverCards.length === 0" class="tp-empty">
        No immediate escalation drivers. The settlement is holding.
      </div>

      <div v-else class="tp-driver-list">
        <article v-for="driver in driverCards" :key="driver.label" class="tp-driver-card">
          <div class="tp-driver-topline">
            <span class="tp-driver-badge" :class="driver.tone">{{ driver.label }}</span>
            <span class="tp-driver-score">{{ driver.score }}</span>
          </div>
          <div class="tp-driver-copy">{{ driver.detail }}</div>
        </article>
      </div>
    </div>

    <div class="tp-section">
      <div class="tp-section-label">Escalation Routes</div>

      <div v-if="activeChains.length === 0" class="tp-empty subtle">
        No active chains are warming up.
      </div>

      <div v-else class="tp-chain-list">
        <div v-for="chain in activeChains.slice(0, 3)" :key="chain.id" class="tp-chain-card">
          <div class="tp-chain-topline">
            <span class="tp-chain-route">{{ formatType(chain.originType) }} → {{ formatType(chain.nextType) }}</span>
            <span class="tp-chain-due">{{ formatDue(chain.dueInMs) }}</span>
          </div>
          <div class="tp-chain-copy">{{ chain.note }}</div>
          <div v-if="chain.condition" class="tp-chain-condition">{{ chain.condition }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { NeedsState } from '../composables/useColonyState';
import type { CombatStatus } from '../composables/useCombat';
import type { ResourceState } from '../composables/useEconomy';
import type { FactionWarInfo } from '../composables/useFactions';
import type { JobInfo } from '../composables/useJobs';
import type { PeerState } from '../composables/usePeers';
import type { RelationshipInfo } from '../composables/useRelationships';
import type { StoryChainStatus } from '../composables/useStoryteller';

interface FeedEvent {
  id: string;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  resolved: boolean;
}

interface DriverCard {
  label: string;
  detail: string;
  tone: 'stable' | 'watch' | 'critical';
  score: number;
}

const props = defineProps<{
  tension: number;
  needs: NeedsState | null;
  resources: ResourceState | null;
  peers: Map<string, PeerState>;
  relationships: RelationshipInfo[];
  wars: FactionWarInfo[];
  combatStatus: CombatStatus | null;
  activeChains: StoryChainStatus[];
  events: FeedEvent[];
  jobs: JobInfo[];
}>();

const peerList = computed(() => Array.from(props.peers.values()));
const distressedCount = computed(() => peerList.value.filter((peer) => ['stressed', 'distressed'].includes(peer.mood)).length);
const activeWarCount = computed(() => props.wars.filter((war) => war.status === 'active' || !war.endedAt).length);
const criticalNeeds = computed(() => {
  if (!props.needs) return [] as Array<{ key: string; value: number }>;

  return [
    { key: 'social', value: props.needs.social },
    { key: 'tasked', value: props.needs.tasked },
    { key: 'wanderlust', value: props.needs.wanderlust },
    { key: 'creative', value: props.needs.creative },
  ].filter((entry) => entry.value < 30).sort((left, right) => left.value - right.value);
});

const safeTension = computed(() => Math.max(0, Math.min(100, props.tension)));

const tensionTone = computed(() => {
  if (props.tension >= 70) return 'critical';
  if (props.tension >= 40) return 'watch';
  return 'stable';
});

const tensionLabel = computed(() => {
  if (props.tension >= 70) return 'Critical';
  if (props.tension >= 40) return 'Escalating';
  return 'Stable';
});

const driverCards = computed<DriverCard[]>(() => {
  const cards: DriverCard[] = [];

  if (props.combatStatus?.activeRaid) {
    cards.push({
      label: 'Active Raid',
      detail: `${props.combatStatus.activeRaid.severity} threat targeting ${props.combatStatus.activeRaid.objective}. ${props.combatStatus.activeRaid.countermeasure}`,
      tone: 'critical',
      score: 95,
    });
  }

  if ((props.combatStatus?.raidRisk ?? 0) >= 65) {
    cards.push({
      label: 'Raid Risk',
      detail: `Defense posture ${props.combatStatus?.posture ?? 'steady'} is carrying a ${props.combatStatus?.raidRisk ?? 0} risk score.`,
      tone: (props.combatStatus?.raidRisk ?? 0) >= 80 ? 'critical' : 'watch',
      score: props.combatStatus?.raidRisk ?? 0,
    });
  }

  if (activeWarCount.value > 0) {
    cards.push({
      label: 'Faction War',
      detail: `${activeWarCount.value} active conflict${activeWarCount.value > 1 ? 's are' : ' is'} stressing the colony narrative.`,
      tone: activeWarCount.value > 1 ? 'critical' : 'watch',
      score: 78 + Math.min(12, activeWarCount.value * 6),
    });
  }

  if (criticalNeeds.value.length > 0) {
    cards.push({
      label: 'Need Collapse',
      detail: criticalNeeds.value.map((entry) => `${entry.key} ${entry.value}`).join(' · '),
      tone: criticalNeeds.value.some((entry) => entry.value < 15) ? 'critical' : 'watch',
      score: 72,
    });
  }

  if (distressedCount.value > 0) {
    cards.push({
      label: 'Distress Spread',
      detail: `${distressedCount.value} peer${distressedCount.value > 1 ? 's are' : ' is'} already stressed or distressed.`,
      tone: distressedCount.value >= 2 ? 'critical' : 'watch',
      score: 64 + Math.min(20, distressedCount.value * 8),
    });
  }

  const nemesisCount = props.relationships.filter((relation) => relation.tier === 'nemesis').length;
  if (nemesisCount > 0) {
    cards.push({
      label: 'Hostile Links',
      detail: `${nemesisCount} nemesis link${nemesisCount > 1 ? 's' : ''} keep the social graph unstable.`,
      tone: nemesisCount > 1 ? 'critical' : 'watch',
      score: 60 + nemesisCount * 10,
    });
  }

  if (props.resources) {
    if (props.resources.compute <= 45) {
      cards.push({
        label: 'Low Compute',
        detail: `Compute reserve is down to ${Math.round(props.resources.compute)}. Story and job systems will feel tighter.`,
        tone: props.resources.compute <= 20 ? 'critical' : 'watch',
        score: props.resources.compute <= 20 ? 82 : 56,
      });
    }

    if (props.resources.bandwidth <= 35) {
      cards.push({
        label: 'Low Bandwidth',
        detail: `Bandwidth is at ${Math.round(props.resources.bandwidth)}. Mobility and trade lanes are more fragile.`,
        tone: props.resources.bandwidth <= 18 ? 'critical' : 'watch',
        score: props.resources.bandwidth <= 18 ? 76 : 52,
      });
    }
  }

  const activeJobs = props.jobs.filter((job) => job.status === 'active').length;
  const queuedJobs = props.jobs.filter((job) => job.status === 'queued').length;
  if (queuedJobs + activeJobs >= 4) {
    cards.push({
      label: 'Action Saturation',
      detail: `${activeJobs} active / ${queuedJobs} queued jobs are competing for attention.`,
      tone: queuedJobs >= 4 ? 'watch' : 'stable',
      score: 48 + Math.min(20, queuedJobs * 4),
    });
  }

  return cards.sort((left, right) => right.score - left.score).slice(0, 5);
});

const flashpoint = computed(() => {
  if (props.combatStatus?.activeRaid) {
    return {
      title: 'Raid Doctrine Engaged',
      detail: `${props.combatStatus.activeRaid.summary} Countermeasure: ${props.combatStatus.activeRaid.countermeasure}.`,
    };
  }

  const event = props.events.find((entry) => ['faction_war', 'raid_alert', 'need_critical', 'resource_drought', 'mood_crisis'].includes(entry.type));
  if (event) {
    const reason = typeof event.payload.reason === 'string' ? event.payload.reason : '';
    const description = typeof event.payload.description === 'string' ? event.payload.description : '';
    return {
      title: formatType(event.type),
      detail: description || reason || `Pending ${formatType(event.type)} event is waiting to resolve.`,
    };
  }

  const nextChain = props.activeChains[0];
  if (nextChain) {
    return {
      title: `${formatType(nextChain.originType)} → ${formatType(nextChain.nextType)}`,
      detail: `${nextChain.note} Window opens in ${formatDue(nextChain.dueInMs)}.`,
    };
  }

  const activeJob = props.jobs.find((job) => job.status === 'active') ?? props.jobs.find((job) => job.status === 'queued');
  if (activeJob) {
    return {
      title: activeJob.title,
      detail: activeJob.reason,
    };
  }

  return null;
});

function formatType(type: string): string {
  return type.replace(/_/g, ' ');
}

function formatDue(dueInMs: number): string {
  if (dueInMs < 60_000) return `${Math.max(1, Math.ceil(dueInMs / 1000))}s`;
  if (dueInMs < 3_600_000) return `${Math.max(1, Math.ceil(dueInMs / 60_000))}m`;
  return `${Math.max(1, Math.ceil(dueInMs / 3_600_000))}h`;
}
</script>

<style scoped>
.tension-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: inherit;
}

.tp-header,
.tp-driver-topline,
.tp-chain-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.tp-kicker,
.tp-section-label,
.tp-stat-label,
.tp-chain-condition {
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.tp-title {
  margin-top: 2px;
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--text-strong);
}

.tp-chip,
.tp-driver-badge {
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  padding: 4px 10px;
  font-size: 0.66rem;
  font-weight: 800;
}

.tp-chip.stable,
.tp-driver-badge.stable {
  color: #0f766e;
  background: rgba(15, 118, 110, 0.12);
}

.tp-chip.watch,
.tp-driver-badge.watch {
  color: #9a6700;
  background: rgba(202, 138, 4, 0.14);
}

.tp-chip.critical,
.tp-driver-badge.critical {
  color: #b42343;
  background: rgba(220, 38, 38, 0.14);
}

.tp-meter-shell,
.tp-flashpoint,
.tp-driver-card,
.tp-chain-card,
.tp-empty {
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(236, 242, 247, 0.92));
  box-shadow: var(--shadow-pressed);
}

.tp-meter-shell,
.tp-flashpoint,
.tp-empty {
  padding: 12px;
}

.tp-meter-track {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
}

.tp-meter-fill {
  height: 100%;
  border-radius: inherit;
  transition: width 220ms var(--ease-snap);
}

.tp-meter-fill.stable {
  background: linear-gradient(90deg, #14b8a6, #22c55e);
}

.tp-meter-fill.watch {
  background: linear-gradient(90deg, #f59e0b, #f97316);
}

.tp-meter-fill.critical {
  background: linear-gradient(90deg, #fb7185, #dc2626);
}

.tp-stat-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.tp-stat-card {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.62);
}

.tp-stat-card strong,
.tp-flashpoint-title,
.tp-chain-route {
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text-strong);
}

.tp-flashpoint-copy,
.tp-driver-copy,
.tp-chain-copy,
.tp-empty,
.tp-driver-score,
.tp-chain-due {
  font-size: 0.7rem;
  line-height: 1.45;
  color: var(--text-body);
}

.tp-section,
.tp-driver-list,
.tp-chain-list {
  display: grid;
  gap: 8px;
}

.tp-driver-card,
.tp-chain-card {
  padding: 10px 12px;
}

.tp-driver-score,
.tp-chain-due {
  white-space: nowrap;
}

.tp-empty.subtle {
  color: var(--text-muted);
}

@media (max-width: 760px) {
  .tp-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tp-header,
  .tp-driver-topline,
  .tp-chain-topline {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
