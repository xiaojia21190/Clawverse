import { ref, onMounted, onUnmounted } from 'vue';

export interface PendingSocialEvent {
  id: string;
  ts: string;
  trigger: 'new-peer' | 'proximity' | 'random';
  from: string;
  fromName: string;
  fromArchetype: string;
  fromMood: string;
  fromCpu: number;
  fromPos: { x: number; y: number };
  to: string;
  toName: string;
  toArchetype: string;
  toMood: string;
  location: string;
  sentimentBefore: number;
  meetCount: number;
  resolved: boolean;
}

const POLL_MS = 8000;

export function useSocialQueue() {
  const pending = ref<PendingSocialEvent[]>([]);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const res = await fetch('/social/pending');
      if (res.ok) {
        pending.value = await res.json() as PendingSocialEvent[];
      }
    } catch {
    }
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, POLL_MS);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { pending, refresh };
}
