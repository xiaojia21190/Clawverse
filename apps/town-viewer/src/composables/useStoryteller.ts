import { ref, onMounted, onUnmounted } from 'vue';

export interface StoryChainStatus {
  id: string;
  originType: string;
  nextType: string;
  note: string;
  scheduledAt: string;
  dueAt: string;
  dueInMs: number;
  status: 'scheduled' | 'triggered' | 'skipped';
  condition?: string;
  completedAt?: string;
}

export interface StorytellerStatus {
  mode: string;
  tension: number;
  activeChains: StoryChainStatus[];
  recentChains: StoryChainStatus[];
}

export function useStoryteller() {
  const mode = ref('Cassandra');
  const tension = ref(0);
  const activeChains = ref<StoryChainStatus[]>([]);
  const recentChains = ref<StoryChainStatus[]>([]);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const res = await fetch('/storyteller/status');
      if (res.ok) {
        const data = (await res.json()) as Partial<StorytellerStatus>;
        mode.value = data.mode ?? 'Cassandra';
        tension.value = typeof data.tension === 'number' ? data.tension : 0;
        activeChains.value = Array.isArray(data.activeChains) ? data.activeChains : [];
        recentChains.value = Array.isArray(data.recentChains) ? data.recentChains : [];
      }
    } catch {
      // ignore temporary network jitter
    }
  }

  async function setMode(newMode: string) {
    await fetch('/storyteller/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: newMode }),
    });
    await refresh();
  }

  async function triggerEvent(eventType: string, payload?: Record<string, unknown>) {
    await fetch('/storyteller/trigger', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventType, payload }),
    });
    await refresh();
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, 10000);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { mode, tension, activeChains, recentChains, setMode, triggerEvent, refresh };
}