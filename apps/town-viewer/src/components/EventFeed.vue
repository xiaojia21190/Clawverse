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
          <span class="arrow">-></span>
          <span class="to-name">{{ event.toName }}</span>
          <span class="location">@ {{ event.location }}</span>
        </div>

        <div v-if="event.dialogue" class="dialogue">"{{ event.dialogue }}"</div>
        <div class="sentiment">
          sentiment: {{ event.sentimentBefore.toFixed(2) }} -> {{ event.sentimentAfter.toFixed(2) }}
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
  return { 'new-peer': 'new', proximity: 'near', random: 'idle' }[trigger] ?? trigger;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
</script>

<style scoped>
.event-feed {
  width: 280px;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, var(--surface), var(--surface-strong));
  box-shadow: var(--shadow-clay-soft);
}

.feed-title {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line-soft);
  font-family: var(--font-display);
  font-size: 0.95rem;
  color: var(--text-strong);
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
  padding: 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-clay-soft);
  font-size: 11px;
}

.event-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.trigger-badge {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(130, 150, 190, 0.2);
  color: var(--text-body);
}

.trigger-badge.new-peer {
  background: rgba(16, 201, 168, 0.22);
  color: #0f8f6f;
}

.trigger-badge.proximity {
  background: rgba(58, 191, 248, 0.22);
  color: #16678d;
}

.trigger-badge.random {
  background: rgba(255, 77, 166, 0.2);
  color: #a3316d;
}

.event-time {
  color: var(--text-muted);
  font-size: 10px;
}

.event-names {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.from-name,
.to-name {
  font-weight: 700;
  color: var(--text-strong);
}

.arrow,
.sentiment {
  color: var(--text-muted);
}

.location {
  color: var(--text-body);
  font-size: 10px;
}

.dialogue {
  margin-bottom: 4px;
  color: var(--text-body);
  font-style: italic;
  line-height: 1.4;
}

.no-events {
  text-align: center;
  color: var(--text-muted);
  padding: 20px 0;
}
</style>