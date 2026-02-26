import { ref, onMounted, onUnmounted } from 'vue';

export interface FactionInfo {
  id: string;
  name: string;
  founderId: string;
  members: string[];
  createdAt: string;
  motto: string;
}

export interface FactionWarInfo {
  id: string;
  factionA: string;
  factionB: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
}

export function useFactions() {
  const factions = ref<FactionInfo[]>([]);
  const wars = ref<FactionWarInfo[]>([]);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const [fRes, wRes] = await Promise.all([
        fetch('/factions'),
        fetch('/factions/wars'),
      ]);
      if (fRes.ok) {
        const data = await fRes.json();
        factions.value = data.factions ?? [];
      }
      if (wRes.ok) {
        const data = await wRes.json();
        wars.value = data.wars ?? [];
      }
    } catch { /* ignore */ }
  }

  async function createFaction(name: string, motto: string) {
    const res = await fetch('/factions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, motto }),
    });
    await refresh();
    return res.ok;
  }

  async function joinFaction(id: string) {
    await fetch(`/factions/${id}/join`, { method: 'POST' });
    await refresh();
  }

  async function leaveFaction(id: string) {
    await fetch(`/factions/${id}/leave`, { method: 'POST' });
    await refresh();
  }

  async function declarePeace(warId: string) {
    await fetch(`/factions/wars/${warId}/peace`, { method: 'POST' });
    await refresh();
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, 15000);
  });
  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { factions, wars, refresh, createFaction, joinFaction, leaveFaction, declarePeace };
}
