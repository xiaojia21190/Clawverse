<template>
  <div class="feed">
    <div class="feed-header">
      <span class="title">📖 Story</span>
      <span class="tension" :class="tensionClass">T:{{ tension }}</span>
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
  if (e.type === 'resource_drought') return 'Compute resources depleting across town';
  if (e.type === 'resource_windfall') return 'A knowledge cache surfaces — resources replenished';
  if (e.type === 'need_critical') return `${p.need} need is critical`;
  if (e.type === 'faction_founding') return `A faction forms — ${p.allyCount} allies united`;
  if (e.type === 'skill_levelup') return `${p.skill} leveled up to ${p.level}`;
  if (e.type === 'mood_crisis') return `Distress spreading through ${p.count ?? 1} nodes`;
  if (e.type === 'building_completed') return `A ${p.buildingType} was constructed`;
  if (e.type === 'betrayal') return 'An ally has become a nemesis';
  if (e.type === 'peace_treaty') return 'Old rivals have made peace';
  if (e.type === 'stranger_arrival') return 'A new peer enters the town';
  if (e.type === 'faction_war') return 'Factions clash in conflict';
  if (e.type === 'great_migration') return 'A mass migration is underway';
  if (e.type === 'cpu_storm') return 'CPU storm — processing under heavy load';
  if (e.type === 'storage_overflow') return 'Storage overflow — cleanup needed';
  if (e.type === 'rumor_spreading') return 'A rumor spreads through the network';
  return (p.description as string) ?? (p.reason as string) ?? e.type;
}
</script>

<style scoped>
.feed {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d1117;
}
.feed-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #21262d;
}
.title { font-weight: 600; font-size: 13px; color: #e6edf3; }
.tension {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
}
.tension.low { background: #1a3a1a; color: #3fb950; }
.tension.mid { background: #3a3a1a; color: #d29922; }
.tension.high { background: #3a1a1a; color: #f85149; }
.events-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.event-item {
  display: grid;
  grid-template-columns: 44px auto 1fr;
  gap: 6px;
  padding: 4px 12px;
  font-size: 11px;
  border-bottom: 1px solid #161b22;
  align-items: start;
}
.event-item:hover { background: #161b22; }
.time { color: #6e7681; white-space: nowrap; }
.type-badge { color: #a371f7; white-space: nowrap; font-size: 10px; }
.desc { color: #8b949e; }
.empty { color: #6e7681; text-align: center; padding: 20px; font-size: 12px; }
</style>
