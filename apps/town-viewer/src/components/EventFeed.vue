<template>
  <div class="event-feed">
    <div class="feed-title">Social Events</div>
    <div class="events">
      <div v-for="event in events" :key="event.id" class="event-item">
        <div class="event-header">
          <span class="trigger-badge" :class="event.trigger">{{ triggerLabel(event.trigger) }}</span>
          <span class="event-time">{{ formatTime(event.ts) }}</span>
        </div>
        <div class="event-names">
          <span class="from-name">{{ event.fromName }}</span>
          <span class="arrow">→</span>
          <span class="to-name">{{ event.toName }}</span>
          <span class="location">@ {{ event.location }}</span>
        </div>
        <div v-if="event.dialogue" class="dialogue">"{{ event.dialogue }}"</div>
        <div class="sentiment">
          sentiment: {{ event.sentimentBefore.toFixed(2) }} → {{ event.sentimentAfter.toFixed(2) }}
        </div>
      </div>
      <div v-if="events.length === 0" class="no-events">Waiting for social events...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SocialEvent } from '../composables/useSocialFeed';

defineProps<{ events: SocialEvent[] }>();

function triggerLabel(trigger: string): string {
  return { 'new-peer': '👋 new', proximity: '📍 near', random: '🎲 idle' }[trigger] ?? trigger;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<style scoped>
.event-feed {
  width: 280px;
  display: flex;
  flex-direction: column;
  background: #161b22;
  border-left: 1px solid #30363d;
}

.feed-title {
  padding: 10px 12px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid #21262d;
  color: #e6edf3;
}

.events {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.event-item {
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
}

.event-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.trigger-badge {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  background: #21262d;
  color: #8b949e;
}
.trigger-badge.new-peer { background: #1f3a2d; color: #3fb950; }
.trigger-badge.proximity { background: #1a2f4a; color: #58a6ff; }
.trigger-badge.random { background: #2d1f3a; color: #d2a8ff; }

.event-time { color: #6e7681; font-size: 10px; }

.event-names {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.from-name, .to-name { font-weight: 600; color: #e6edf3; }
.arrow { color: #6e7681; }
.location { color: #8b949e; font-size: 10px; }

.dialogue {
  color: #cdd9e5;
  font-style: italic;
  margin-bottom: 4px;
  line-height: 1.4;
}

.sentiment { color: #6e7681; }

.no-events { color: #6e7681; text-align: center; padding: 20px 0; }
</style>
