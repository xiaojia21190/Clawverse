import { ref, onMounted } from 'vue';

export interface Building {
  id: string;
  type: string;
  position: { x: number; y: number };
  ownerId: string;
  ownerActorId?: string;
  ownerName: string;
  effect: string;
  createdAt: string;
}

export interface WorldMapData {
  terrain: string[];
  buildings: Building[];
  gridSize: number;
}

export function useWorldMap() {
  const worldMap = ref<WorldMapData | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/world/map');
      if (res.ok) worldMap.value = await res.json();
    } catch { /* ignore */ }
  }

  async function build(type: string, x: number, y: number): Promise<boolean> {
    const res = await fetch('/world/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, x, y }),
    });
    if (res.ok) await refresh();
    return res.ok;
  }

  async function demolish(buildingId: string): Promise<boolean> {
    const res = await fetch(`/world/build/${buildingId}`, { method: 'DELETE' });
    if (res.ok) await refresh();
    return res.ok;
  }

  onMounted(refresh);

  return { worldMap, refresh, build, demolish };
}
