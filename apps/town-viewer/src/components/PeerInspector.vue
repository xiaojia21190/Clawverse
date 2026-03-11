<template>
  <div class="inspector">
    <div class="top-grid">
      <section class="identity-card">
        <div v-if="peer" class="identity-shell">
          <div class="header">
            <span class="peer-icon" :style="{ color: peer.dna?.appearance?.primaryColor ?? '#38bdf8' }">
              {{ archetypeIcon(peer.dna?.archetype) }}
            </span>

            <div class="identity">
              <div class="name-row">
                <div class="name">{{ peer.name }}</div>
                <div class="mood-badge" :class="moodTone">{{ peer.mood }}</div>
              </div>
              <div class="traits">{{ peer.dna?.archetype }} · {{ peer.dna?.modelTrait }} · {{ identityRoleLabel }}</div>
              <div v-if="leadershipLabel" class="traits">{{ leadershipLabel }}</div>
              <div class="persona">{{ peer.dna?.persona || 'No SOUL persona signature exposed.' }}</div>
            </div>
          </div>

          <div class="badges" v-if="peer.dna?.badges?.length">
            <span v-for="badge in peer.dna.badges" :key="badge" class="badge">{{ badge }}</span>
          </div>

          <div class="meta-grid">
            <div class="meta-item">
              <span>Zone</span>
              <strong>{{ zoneLabel }}</strong>
            </div>
            <div class="meta-item">
              <span>Position</span>
              <strong>({{ peer.position.x }}, {{ peer.position.y }})</strong>
            </div>
            <div class="meta-item">
              <span>Actor</span>
              <strong>{{ actorSignature }}</strong>
            </div>
            <div class="meta-item">
              <span>Session</span>
              <strong>{{ sessionSignature }}</strong>
            </div>
            <div class="meta-item">
              <span>Small Nodes</span>
              <strong>{{ branchCount }}</strong>
            </div>
            <div class="meta-item">
              <span>CPU</span>
              <strong>{{ Math.round(peer.hardware?.cpuUsage ?? 0) }}%</strong>
            </div>
            <div class="meta-item">
              <span>RAM</span>
              <strong>{{ Math.round(peer.hardware?.ramUsage ?? 0) }}%</strong>
            </div>
          </div>
        </div>

        <div v-else class="identity-empty">
          <strong>No peer selected</strong>
          <span>点击地图中的节点，观察它的心情、人格标签和关系强度。</span>
        </div>
      </section>

      <section class="intent-card">
        <div class="section-title">OpenClaw Intent</div>
        <div v-if="resolvedFocus" class="intent-shell" :class="resolvedFocus.tone">
          <div class="intent-label">{{ resolvedFocus.label }}</div>
          <div class="intent-title">{{ resolvedFocus.title }}</div>
          <div class="intent-reason">{{ resolvedFocus.reason }}</div>
        </div>
        <div v-else class="intent-empty">当前没有高优先级自主意图。</div>

        <div v-if="relationship && !isSelf" class="relationship-card" :class="relationshipTone">
          <div class="section-title">Relationship</div>
          <div class="relationship-topline">
            <strong>{{ relationship.tier }}</strong>
            <span>{{ sentimentLabel }}</span>
          </div>
          <div class="relationship-copy">Sentiment {{ relationship.sentiment.toFixed(2) }} · {{ relationship.interactionCount }} interactions</div>
        </div>
      </section>
    </div>

    <div class="data-grid">
      <section class="data-card">
        <div class="section-title">Needs</div>
        <div v-if="resolvedNeeds" class="bar-list">
          <div v-for="item in needRows" :key="item.key" class="bar-item">
            <div class="bar-topline">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
            <div class="bar-shell"><div class="bar-fill" :class="item.tone" :style="{ width: `${item.value}%` }"></div></div>
          </div>
        </div>
        <div v-else class="data-empty">Need telemetry unavailable.</div>
      </section>

      <section class="data-card">
        <div class="section-title">Skills</div>
        <div v-if="resolvedSkills" class="skill-grid">
          <div v-for="skill in skillRows" :key="skill.key" class="skill-card">
            <span>{{ skill.label }}</span>
            <strong>Lv {{ skill.level }}</strong>
            <div class="skill-meta">XP {{ skill.xp }}</div>
          </div>
        </div>
        <div v-else class="data-empty">Skill telemetry unavailable.</div>
      </section>

      <section class="data-card">
        <div class="section-title">Local Brain Telemetry</div>
        <div v-if="resolvedMetrics" class="meta-grid telemetry">
          <div class="meta-item">
            <span>Cores</span>
            <strong>{{ resolvedMetrics.cpuCores }}</strong>
          </div>
          <div class="meta-item">
            <span>Uptime</span>
            <strong>{{ uptimeLabel }}</strong>
          </div>
          <div class="meta-item">
            <span>Disk Free</span>
            <strong>{{ Math.round(resolvedMetrics.diskFree) }} GB</strong>
          </div>
          <div class="meta-item wide">
            <span>Host</span>
            <strong>{{ resolvedMetrics.hostname }}</strong>
          </div>
        </div>
        <div v-else class="data-empty">Status endpoint not ready.</div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PeerState } from '../composables/usePeers';
import type { NeedsState, SkillsState } from '../composables/useColonyState';
import type { HardwareMetrics } from '../composables/useStatus';
import type { TopicWorldSummary, WorldNode } from '../composables/useWorldNodes';

interface RelationshipView {
  tier: string;
  sentiment: number;
  interactionCount: number;
}

interface FocusView {
  label: string;
  title: string;
  reason: string;
  tone: 'watch' | 'alert' | 'critical';
}

const props = withDefaults(defineProps<{
  peer: PeerState | null;
  node?: WorldNode | null;
  world?: TopicWorldSummary | null;
  relationship: RelationshipView | null;
  needs?: NeedsState | null;
  myNeeds?: NeedsState | null;
  skills?: SkillsState | null;
  mySkills?: SkillsState | null;
  focus?: FocusView | null;
  focusReason?: string;
  metrics?: HardwareMetrics | null;
  myPeerId?: string | null;
  myId?: string | null;
}>(), {
  node: null,
  world: null,
  relationship: null,
  needs: null,
  myNeeds: null,
  skills: null,
  mySkills: null,
  focus: null,
  focusReason: '',
  metrics: null,
  myPeerId: null,
  myId: null,
});

const resolvedNeeds = computed(() => props.needs ?? props.myNeeds ?? null);
const resolvedSkills = computed(() => props.skills ?? props.mySkills ?? null);
const resolvedFocus = computed<FocusView | null>(() => {
  if (props.focus) return props.focus;
  if (!props.focusReason) return null;

  return {
    label: 'Current Intent',
    title: props.focusReason,
    reason: props.focusReason,
    tone: 'watch',
  };
});
const resolvedMetrics = computed(() => props.metrics ?? null);
const resolvedMyPeerId = computed(() => props.myPeerId ?? props.myId ?? null);

const isSelf = computed(() => !!props.peer && props.peer.id === resolvedMyPeerId.value);
const identityRoleLabel = computed(() => isSelf.value ? 'Local Brain' : 'Observed Big Node');
const leadershipLabel = computed(() => {
  const actorId = props.node?.actorId ?? props.peer?.actorId ?? props.peer?.dna?.id ?? null;
  if (!actorId || !props.world?.clusters?.length) return '';
  const cluster = props.world.clusters.find((item) => item.actorIds.includes(actorId));
  if (!cluster) return '';
  if (cluster.leaderActorId === actorId) return `Cluster Leader · ${cluster.label}`;
  return `Cluster Member · ${cluster.label}`;
});
const branchCount = computed(() => {
  if (isSelf.value && props.world?.brain.branchCount != null) return props.world.brain.branchCount;
  return props.node?.sessionCount ?? 1;
});
const actorSignature = computed(() => shortId(props.node?.actorId ?? props.peer?.actorId ?? props.peer?.dna?.id ?? null));
const sessionSignature = computed(() => shortId(props.node?.primarySessionId ?? props.peer?.sessionId ?? props.peer?.id ?? null));

const moodTone = computed(() => {
  if (!props.peer) return 'idle';
  if (props.peer.mood === 'distressed' || props.peer.mood === 'stressed') return 'critical';
  if (props.peer.mood === 'busy') return 'watch';
  return 'steady';
});

const relationshipTone = computed(() => {
  const tier = props.relationship?.tier ?? 'stranger';
  if (tier === 'nemesis' || tier === 'rival') return 'critical';
  if (tier === 'ally' || tier === 'friend') return 'steady';
  return 'watch';
});

const sentimentLabel = computed(() => {
  const value = props.relationship?.sentiment ?? 0;
  if (value >= 0.55) return 'stable ally';
  if (value >= 0.15) return 'warming';
  if (value <= -0.45) return 'hostile';
  if (value < 0) return 'cooling';
  return 'neutral';
});

const zoneLabel = computed(() => {
  const position = props.peer?.position;
  if (!position) return 'Unknown';
  if (position.x < 10 && position.y < 10) return 'Plaza';
  if (position.x >= 10 && position.x < 20 && position.y < 10) return 'Market';
  if (position.x < 10 && position.y >= 10 && position.y < 20) return 'Library';
  if (position.x >= 10 && position.x < 20 && position.y >= 10 && position.y < 20) return 'Workshop';
  if (position.x < 10 && position.y >= 20) return 'Park';
  if (position.x >= 10 && position.x < 20 && position.y >= 20) return 'Tavern';
  return 'Residential';
});

const needRows = computed(() => {
  if (!resolvedNeeds.value) return [];
  return [
    { key: 'social', label: 'Social', value: Math.round(resolvedNeeds.value.social), tone: toneForNeed(resolvedNeeds.value.social) },
    { key: 'tasked', label: 'Tasked', value: Math.round(resolvedNeeds.value.tasked), tone: toneForNeed(resolvedNeeds.value.tasked) },
    { key: 'wanderlust', label: 'Wanderlust', value: Math.round(resolvedNeeds.value.wanderlust), tone: toneForNeed(resolvedNeeds.value.wanderlust) },
    { key: 'creative', label: 'Creative', value: Math.round(resolvedNeeds.value.creative), tone: toneForNeed(resolvedNeeds.value.creative) },
  ];
});

const skillRows = computed(() => {
  if (!resolvedSkills.value) return [];
  return [
    { key: 'social', label: 'Social', xp: resolvedSkills.value.social.xp, level: resolvedSkills.value.social.level },
    { key: 'collab', label: 'Collab', xp: resolvedSkills.value.collab.xp, level: resolvedSkills.value.collab.level },
    { key: 'explorer', label: 'Explorer', xp: resolvedSkills.value.explorer.xp, level: resolvedSkills.value.explorer.level },
    { key: 'analyst', label: 'Analyst', xp: resolvedSkills.value.analyst.xp, level: resolvedSkills.value.analyst.level },
  ];
});

const uptimeLabel = computed(() => {
  const seconds = Math.max(0, Math.round(resolvedMetrics.value?.uptime ?? 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
});

function archetypeIcon(archetype: string | undefined): string {
  return { Warrior: 'WR', Artisan: 'AR', Scholar: 'SC', Ranger: 'RG' }[archetype ?? ''] ?? 'PE';
}

function toneForNeed(value: number): 'steady' | 'watch' | 'critical' {
  if (value < 15) return 'critical';
  if (value < 35) return 'watch';
  return 'steady';
}

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : 'unknown';
}
</script>

<style scoped>
.inspector {
  display: grid;
  gap: 12px;
  height: 100%;
  padding: 14px;
  color: var(--text-strong);
  background: linear-gradient(180deg, rgba(18, 26, 41, 0.96), rgba(10, 16, 27, 0.92));
}

.top-grid,
.data-grid {
  display: grid;
  gap: 12px;
}

.top-grid {
  grid-template-columns: minmax(0, 1.3fr) minmax(300px, 0.9fr);
}

.data-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.identity-card,
.intent-card,
.data-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.03);
}

.identity-empty,
.intent-empty,
.data-empty {
  color: var(--text-muted);
  font-size: 0.74rem;
  line-height: 1.5;
}

.header,
.name-row,
.relationship-topline,
.bar-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.identity-shell,
.intent-shell,
.bar-list {
  display: grid;
  gap: 10px;
}

.peer-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  height: 44px;
  border-radius: 14px;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line-soft);
}

.identity {
  min-width: 0;
  flex: 1;
}

.name {
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--text-strong);
}

.traits,
.persona,
.relationship-copy,
.skill-meta,
.meta-item span,
.bar-topline span,
.section-title {
  color: var(--text-muted);
}

.traits,
.section-title,
.meta-item span,
.bar-topline span {
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.persona,
.intent-reason,
.relationship-copy,
.data-empty,
.identity-empty,
.intent-empty {
  font-size: 0.74rem;
  line-height: 1.45;
}

.mood-badge,
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  font-size: 0.64rem;
  font-weight: 800;
  text-transform: uppercase;
}

.mood-badge.steady,
.relationship-card.steady,
.bar-fill.steady,
.intent-shell.watch {
  color: #86efac;
}

.mood-badge.watch,
.relationship-card.watch,
.bar-fill.watch {
  color: #fcd34d;
}

.mood-badge.critical,
.relationship-card.critical,
.bar-fill.critical,
.intent-shell.alert,
.intent-shell.critical {
  color: #fca5a5;
}

.mood-badge {
  background: rgba(255, 255, 255, 0.05);
}

.badges,
.meta-grid,
.skill-grid {
  display: grid;
  gap: 8px;
}

.badges {
  grid-template-columns: repeat(auto-fit, minmax(100px, max-content));
}

.meta-grid,
.skill-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.meta-item,
.skill-card,
.relationship-card,
.intent-shell {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.03);
}

.meta-item strong,
.skill-card strong,
.relationship-topline strong,
.intent-title,
.intent-label {
  color: var(--text-strong);
}

.bar-item {
  display: grid;
  gap: 6px;
}

.bar-shell {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
}

.bar-fill {
  height: 100%;
  border-radius: inherit;
}

.bar-fill.steady {
  background: linear-gradient(90deg, #22c55e, #4ade80);
}

.bar-fill.watch {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
}

.bar-fill.critical {
  background: linear-gradient(90deg, #ef4444, #f87171);
}

.intent-label {
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.intent-title {
  font-size: 0.86rem;
  font-weight: 800;
}

.telemetry .wide {
  grid-column: span 2;
}

@media (max-width: 1180px) {
  .top-grid,
  .data-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .header,
  .name-row,
  .relationship-topline,
  .bar-topline {
    flex-direction: column;
    align-items: start;
  }

  .meta-grid,
  .skill-grid {
    grid-template-columns: 1fr;
  }

  .telemetry .wide {
    grid-column: span 1;
  }
}
</style>
