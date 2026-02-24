import { ref, onMounted, onUnmounted } from 'vue';

export interface ResourceState {
  compute: number;
  storage: number;
  bandwidth: number;
  reputation: number;
  updatedAt: string;
}

export function useEconomy() {
  const resources = ref<ResourceState | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const res = await fetch('/economy/resources');
      if (res.ok) resources.value = await res.json();
    } catch { /* ignore */ }
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, 5000);
  });
  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { resources, refresh };
}
