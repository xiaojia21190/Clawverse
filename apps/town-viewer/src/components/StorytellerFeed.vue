<template>
  <div class="feed">
    <div class="feed-header">
      <span class="title">Story Stream</span>
      <span class="tension" :class="tensionClass">Tension {{ tension }}</span>
    </div>

    <div class="events-list">
      <div v-for="e in events" :key="e.id" class="event-item" :class="e.type">
        <span class="time">{{ formatTime(e.ts) }}</span>
        <span class="type-badge">{{ e.type.replace(/_/g, ' ') }}</span>
        <span class="desc">{{ describe(e) }}</span>
      </div>

      <div v-if="events.length === 0" class="empty">Waiting for events...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export interface FeedEvent {
  id: string;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  resolved: boolean;
}

const props = defineProps<{ events: FeedEvent[]; tension: number }>();

const tensionClass = computed(() => {
  if (props.tension > 60) return 'high';
  if (props.tension > 30) return 'mid';
  return 'low';
});

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function describe(e: FeedEvent): string {
  const p = e.payload;
  if (e.type === 'resource_drought') return 'Compute resources are depleting across town';
  if (e.type === 'resource_windfall') return 'A knowledge cache surfaced, resources replenished';
  if (e.type === 'need_critical') return `${p.need} need is now critical`;
  if (e.type === 'faction_founding') return `A faction forms with ${p.allyCount} allies`;
  if (e.type === 'skill_levelup') return `${p.skill} leveled up to ${p.level}`;
  if (e.type === 'mood_crisis') return `Distress spreading through ${p.count ?? 1} nodes`;
  if (e.type === 'building_completed') return `A ${p.buildingType} was constructed`;
  if (e.type === 'betrayal') return 'An ally has become a nemesis';
  if (e.type === 'peace_treaty') return 'Old rivals reached a peace treaty';
  if (e.type === 'stranger_arrival') return 'A new peer enters the town';
  if (e.type === 'faction_war') return 'Factions are clashing in open conflict';
  if (e.type === 'great_migration') return 'A mass migration is underway';
  if (e.type === 'cpu_storm') return 'CPU storm, processing is under heavy load';
  if (e.type === 'storage_overflow') return 'Storage overflow, cleanup required';
  if (e.type === 'rumor_spreading') return 'A rumor is spreading through the network';
  return (p.description as string) ?? (p.reason as string) ?? e.type;
}
</script>

<style scoped>
.feed {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
  background: linear-gradient(145deg, var(--surface), var(--surface-strong));
}

.feed-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--line-soft);
}

.title {
  font-family: var(--font-display);
  font-size: 1.01rem;
  color: var(--text-strong);
}

.tension {
  margin-left: auto;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 0.67rem;
  font-weight: 700;
  border: 1px solid var(--line-soft);
  box-shadow: var(--shadow-pressed);
}

.tension.low {
  background: rgba(6, 214, 160, 0.2);
  color: #0f8f6f;
}

.tension.mid {
  background: rgba(255, 183, 3, 0.24);
  color: #9e6900;
}

.tension.high {
  background: rgba(239, 71, 111, 0.24);
  color: #a22a4a;
}

.events-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: grid;
  gap: 7px;
}

.event-item {
  display: grid;
  grid-template-columns: 48px minmax(78px, auto) 1fr;
  align-items: start;
  gap: 7px;
  padding: 9px 10px;
  font-size: 0.72rem;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-md);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-clay-soft);
  transition: transform 160ms var(--ease-snap), box-shadow 160ms var(--ease-snap);
}

.event-item:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-float);
}

.time {
  color: var(--text-muted);
  font-weight: 700;
  white-space: nowrap;
}

.type-badge {
  white-space: nowrap;
  color: var(--accent-berry);
  font-weight: 800;
  text-transform: capitalize;
}

.desc {
  color: var(--text-body);
  line-height: 1.38;
}

.empty {
  margin: auto;
  color: var(--text-muted);
  text-align: center;
  font-size: 0.8rem;
}

@media (max-width: 760px) {
  .event-item {
    grid-template-columns: 1fr;
    gap: 5px;
  }
}
</style>