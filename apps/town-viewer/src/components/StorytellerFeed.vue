<template>
  <div class="feed">
    <div class="feed-header">
      <div>
        <div class="kicker">Storyteller</div>
        <div class="title">Causality Timeline</div>
      </div>

      <div class="header-meta">
        <span class="pending">{{ pendingLifeCount }} life · {{ pendingSocialCount }} social</span>
        <span class="tension" :class="tensionClass">Tension {{ tension }}</span>
      </div>
    </div>

    <div class="tension-meter">
      <div class="tension-fill" :class="tensionClass" :style="{ width: `${Math.min(100, tension)}%` }"></div>
    </div>

    <div class="feed-stats">
      <div class="stat-chip">
        <span>Active Chains</span>
        <strong>{{ activeChains.length }}</strong>
      </div>
      <div class="stat-chip">
        <span>Pending Events</span>
        <strong>{{ events.length }}</strong>
      </div>
      <div v-if="focusReason" class="stat-chip focus">
        <span>Current Intent</span>
        <strong>{{ focusReason }}</strong>
      </div>
    </div>

    <div v-if="drivers.length" class="driver-board">
      <div class="section-title">Pressure Drivers</div>
      <div class="driver-list">
        <div v-for="driver in drivers.slice(0, 4)" :key="driver.id" class="driver-item" :class="driver.tone">
          <div class="driver-topline">
            <span class="driver-name">{{ driver.label }}</span>
            <span class="driver-score">+{{ driver.score }}</span>
          </div>
          <div class="driver-copy">{{ driver.detail }}</div>
        </div>
      </div>
    </div>

    <div v-if="activeChains.length || recentChains.length" class="chain-board">
      <div v-if="activeChains.length" class="chain-group">
        <div class="section-title">Heating Chains</div>
        <div v-for="chain in activeChains.slice(0, 4)" :key="chain.id" class="chain-item active">
          <div class="chain-topline">
            <span class="chain-route">{{ formatType(chain.originType) }} → {{ formatType(chain.nextType) }}</span>
            <span class="chain-meta">{{ formatDue(chain.dueInMs) }}</span>
          </div>
          <div class="chain-note">{{ chain.note }}</div>
          <div v-if="chain.condition" class="chain-meta subtle">Trigger {{ chain.condition }}</div>
        </div>
      </div>

      <div v-if="recentChains.length" class="chain-group">
        <div class="section-title">Resolved Chains</div>
        <div v-for="chain in recentChains.slice(0, 4)" :key="chain.id" class="chain-item" :class="chain.status">
          <div class="chain-topline">
            <span class="chain-route">{{ formatType(chain.originType) }} → {{ formatType(chain.nextType) }}</span>
            <span class="chain-status" :class="chain.status">{{ formatStatus(chain.status) }}</span>
          </div>
          <div class="chain-note">{{ chain.note }}</div>
        </div>
      </div>
    </div>

    <div class="events-list">
      <div v-for="event in events" :key="event.id" class="event-item" :class="severityClass(event.type)">
        <span class="time">{{ formatTime(event.ts) }}</span>
        <span class="type-badge">{{ event.type.replace(/_/g, ' ') }}</span>
        <span class="desc">{{ describe(event) }}</span>
      </div>

      <div v-if="events.length === 0" class="empty">No unresolved life events.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { StoryChainStatus } from '../composables/useStoryteller';

export interface FeedEvent {
  id: string;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  resolved: boolean;
}

export interface FeedDriver {
  id: string;
  label: string;
  detail: string;
  score: number;
  tone: 'watch' | 'alert' | 'critical';
}

const props = defineProps<{
  events: FeedEvent[];
  tension: number;
  activeChains: StoryChainStatus[];
  recentChains: StoryChainStatus[];
  drivers: FeedDriver[];
  focusReason: string;
  pendingLifeCount: number;
  pendingSocialCount: number;
}>();

const tensionClass = computed(() => {
  if (props.tension >= 75) return 'high';
  if (props.tension >= 40) return 'mid';
  return 'low';
});

function severityClass(type: string): string {
  if (['faction_war', 'raid_alert', 'mood_crisis', 'need_critical', 'resource_drought'].includes(type)) return 'high';
  if (['combat_report', 'betrayal', 'injury', 'storage_overflow', 'cpu_storm'].includes(type)) return 'mid';
  return 'low';
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ');
}

function formatStatus(status: StoryChainStatus['status']): string {
  if (status === 'triggered') return 'Triggered';
  if (status === 'skipped') return 'Skipped';
  return 'Scheduled';
}

function formatDue(dueInMs: number): string {
  if (dueInMs < 60_000) return `${Math.max(1, Math.ceil(dueInMs / 1000))}s`;
  if (dueInMs < 3_600_000) return `${Math.max(1, Math.ceil(dueInMs / 60_000))}m`;
  return `${Math.max(1, Math.ceil(dueInMs / 3_600_000))}h`;
}

function describe(event: FeedEvent): string {
  const payload = event.payload;
  if (event.type === 'resource_drought' && payload.subtype === 'trade_route_failed') return 'Trade route failed before settlement.';
  if (event.type === 'resource_drought' && payload.subtype === 'trade_blocked') return `Trade with ${String(payload.peerId ?? 'peer')} was blocked.`;
  if (event.type === 'resource_drought') return 'Compute resources are thinning across the town.';
  if (event.type === 'resource_windfall' && payload.subtype === 'trade_settled') return `Trade completed, received ${String(payload.amount ?? '?')} ${String(payload.resource ?? 'resources')}.`;
  if (event.type === 'resource_windfall') return 'A knowledge cache surfaced and pressure eased.';
  if (event.type === 'need_critical') return `${payload.need} need has entered a critical band.`;
  if (event.type === 'faction_founding') return `A faction forms with ${payload.allyCount} allies.`;
  if (event.type === 'skill_levelup') return `${payload.skill} reached level ${payload.level}.`;
  if (event.type === 'mood_crisis') return `Distress is spreading through ${payload.count ?? 1} nodes.`;
  if (event.type === 'building_completed') return `A ${payload.buildingType} was constructed.`;
  if (event.type === 'betrayal' && payload.allianceId) return 'A faction alliance collapsed under pressure.';
  if (event.type === 'betrayal') return 'An ally has become a nemesis.';
  if (event.type === 'peace_treaty') return 'Old rivals reached a peace treaty.';
  if (event.type === 'stranger_arrival') return 'A new peer enters the town.';
  if (event.type === 'faction_war') return 'Factions are clashing in open conflict.';
  if (event.type === 'faction_alliance') return 'Two factions have forged a formal alliance.';
  if (event.type === 'raid_alert') return `Raid alert: ${String(payload.severity ?? 'unknown')} ${String(payload.source ?? 'threat')} targeting ${String(payload.objective ?? 'pressure')}. Countermeasure: ${String(payload.countermeasure ?? payload.recommendedPosture ?? 'guarded response')}.`;
  if (event.type === 'combat_report' && payload.subtype === 'raid_resolved' && payload.doctrineActivated) return `Combat doctrine held: ${String(payload.countermeasure ?? 'response doctrine active')}.`;
  if (event.type === 'combat_report' && payload.subtype === 'recovery') return `Recovery progress: ${String(payload.summary ?? 'stabilization underway')}.`;
  if (event.type === 'combat_report' && payload.subtype === 'deterioration') return `Untreated injuries worsen: ${String(payload.summary ?? 'medical support is slipping')}.`;
  if (event.type === 'combat_report' && payload.subtype === 'treatment_failed') return `Treatment failed: ${String(payload.summary ?? 'medical support is insufficient')}.`;
  if (event.type === 'combat_report' && payload.subtype === 'autonomy_posture') return `Autonomy posture shift: ${String(payload.summary ?? 'defense posture updated')}.`;
  if (event.type === 'combat_report' && payload.subtype === 'autonomy_response_squad') return `Response squad deployed: ${String(payload.summary ?? 'wartime duties are online')}.`;
  if (event.type === 'combat_report') return `Combat report: ${String(payload.summary ?? 'raid impact recorded')}.`;
  if (event.type === 'injury') return `Injury sustained: ${String(payload.label ?? 'unknown wound')}.`;
  if (event.type === 'death') return `${String(payload.factionName ?? 'The settlement')} has lost its core.`;
  if (event.type === 'faction_ascendant') return `${String(payload.factionName ?? 'A faction')} has risen to dominate the town.`;
  if (event.type === 'faction_splintering') return `${String(payload.factionName ?? 'A faction')} is fracturing under pressure.`;
  if (event.type === 'great_migration') return 'A mass migration is underway.';
  if (event.type === 'cpu_storm') return 'CPU storm: processing is under heavy load.';
  if (event.type === 'storage_overflow') return 'Storage overflow: cleanup is required.';
  if (event.type === 'rumor_spreading') return 'A rumor is propagating through the network.';
  if (event.type === 'legacy_event') return String(payload.description ?? 'A legendary moment reshapes the town memory.');
  return (payload.description as string) ?? (payload.reason as string) ?? event.type;
}
</script>

<style scoped>
.feed,
.feed-stats,
.driver-board,
.driver-list,
.chain-board,
.chain-group,
.events-list {
  display: grid;
  gap: 10px;
}

.feed {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(241, 245, 249, 0.96));
}

.feed-header,
.header-meta,
.driver-topline,
.chain-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.feed-header {
  padding: 12px;
  border-bottom: 1px solid var(--line-soft);
}

.kicker,
.section-title,
.tension-label {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.title {
  margin-top: 2px;
  font-family: var(--font-display);
  font-size: 1.01rem;
  color: var(--text-strong);
}

.pending,
.tension,
.stat-chip,
.chain-status,
.chain-meta {
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  padding: 5px 10px;
  font-size: 0.66rem;
  font-weight: 800;
}

.pending,
.stat-chip,
.chain-meta,
.chain-status {
  background: rgba(255, 255, 255, 0.72);
  color: var(--text-body);
}

.tension.low,
.event-item.low {
  background: rgba(15, 118, 110, 0.1);
}

.tension.mid,
.event-item.mid {
  background: rgba(202, 138, 4, 0.1);
}

.tension.high,
.event-item.high {
  background: rgba(220, 38, 38, 0.08);
}

.tension.low {
  color: #0f766e;
}

.tension.mid {
  color: #9a6700;
}

.tension.high {
  color: #b42343;
}

.tension-meter {
  height: 10px;
  margin: 0 12px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
}

.tension-fill {
  height: 100%;
  border-radius: inherit;
}

.tension-fill.low {
  background: linear-gradient(90deg, #14b8a6, #22c55e);
}

.tension-fill.mid {
  background: linear-gradient(90deg, #f59e0b, #f97316);
}

.tension-fill.high {
  background: linear-gradient(90deg, #fb7185, #dc2626);
}

.feed-stats,
.driver-board,
.chain-board,
.events-list {
  padding: 0 12px 12px;
}

.feed-stats {
  grid-template-columns: repeat(3, minmax(0, max-content));
}

.stat-chip.focus {
  color: var(--accent-sky);
}

.driver-item,
.chain-item,
.event-item,
.empty {
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(236, 242, 247, 0.96));
  box-shadow: var(--shadow-pressed);
}

.driver-item,
.chain-item,
.event-item {
  padding: 10px 12px;
}

.driver-list,
.chain-board {
  gap: 8px;
}

.driver-item.watch {
  border-color: rgba(202, 138, 4, 0.22);
}

.driver-item.alert {
  border-color: rgba(249, 115, 22, 0.22);
}

.driver-item.critical,
.chain-item.skipped {
  border-color: rgba(220, 38, 38, 0.2);
}

.driver-item.watch .driver-score,
.chain-meta,
.type-badge {
  color: #9a6700;
}

.driver-item.alert .driver-score,
.chain-item.active .chain-meta {
  color: var(--accent-sky);
}

.driver-item.critical .driver-score,
.chain-status.skipped,
.event-item.high .type-badge {
  color: #b42343;
}

.chain-status.triggered,
.event-item.low .type-badge {
  color: #0f766e;
}

.driver-name,
.chain-route {
  font-size: 0.74rem;
  font-weight: 800;
  color: var(--text-strong);
}

.driver-copy,
.chain-note,
.desc,
.empty {
  font-size: 0.7rem;
  line-height: 1.45;
  color: var(--text-body);
}

.event-item {
  display: grid;
  grid-template-columns: 48px minmax(88px, auto) 1fr;
  align-items: start;
  gap: 8px;
}

.time {
  color: var(--text-muted);
  font-weight: 700;
}

.type-badge {
  white-space: nowrap;
  font-weight: 800;
  text-transform: capitalize;
}

@media (max-width: 760px) {
  .feed-header,
  .header-meta,
  .driver-topline,
  .chain-topline {
    align-items: flex-start;
    flex-direction: column;
  }

  .feed-stats {
    grid-template-columns: 1fr;
  }

  .event-item {
    grid-template-columns: 1fr;
  }
}
</style>
