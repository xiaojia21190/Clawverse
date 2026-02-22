import { ref, onUnmounted } from 'vue';
import { createSseConnection } from '../api/sse';

export interface SocialEvent {
  id: string;
  ts: string;
  trigger: 'new-peer' | 'proximity' | 'random';
  from: string;
  to: string;
  fromName: string;
  toName: string;
  location: string;
  dialogue: string;
  sentimentBefore: number;
  sentimentAfter: number;
}

const MAX_EVENTS = 50;

export function useSocialFeed() {
  const events = ref<SocialEvent[]>([]);

  const stop = createSseConnection('/sse/social', 'social', (data: unknown) => {
    const event = data as SocialEvent;
    events.value = [event, ...events.value].slice(0, MAX_EVENTS);
  });

  onUnmounted(stop);

  return { events };
}
