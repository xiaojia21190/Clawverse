import { ref, onMounted, onUnmounted } from 'vue';

export interface StorytellerStatus {
  mode: string;
  tension: number;
}

export function useStoryteller() {
  const mode = ref('Cassandra');
  const tension = ref(0);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const res = await fetch('/storyteller/status');
      if (res.ok) {
        const d = await res.json();
        mode.value = d.mode;
        tension.value = d.tension;
      }
    } catch { /* ignore */ }
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
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, 10000);
  });
  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { mode, tension, setMode, triggerEvent, refresh };
}
