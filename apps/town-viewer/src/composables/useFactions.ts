import { ref, onMounted, onUnmounted } from 'vue';

export interface FactionStrategicInfo {
  agenda: string;
  prosperity: number;
  cohesion: number;
  influence: number;
  pressure: number;
  stage: string;
  lastUpdatedAt: string;
}

export interface FactionInfo {
  id: string;
  name: string;
  founderId: string;
  founderActorId?: string;
  members: string[];
  memberActorIds?: string[];
  createdAt: string;
  motto: string;
  strategic: FactionStrategicInfo;
}

export interface FactionWarInfo {
  id: string;
  factionA: string;
  factionB: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
}

export interface FactionAllianceInfo {
  id: string;
  factionA: string;
  factionB: string;
  formedAt: string;
  expiresAt: string;
  lastRenewedAt: string | null;
  endedAt: string | null;
  status: string;
}

export interface FactionVassalageInfo {
  id: string;
  overlordId: string;
  vassalId: string;
  formedAt: string;
  endedAt: string | null;
  status: string;
}

export type FactionTributeResource = 'compute' | 'storage' | 'bandwidth' | 'reputation';

export interface FactionTributeInfo {
  id: string;
  vassalageId: string;
  overlordId: string;
  vassalId: string;
  resource: FactionTributeResource;
  amount: number;
  collectedAt: string;
}

export function useFactions() {
  const factions = ref<FactionInfo[]>([]);
  const wars = ref<FactionWarInfo[]>([]);
  const alliances = ref<FactionAllianceInfo[]>([]);
  const vassalages = ref<FactionVassalageInfo[]>([]);
  const tributes = ref<FactionTributeInfo[]>([]);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const [fRes, wRes, aRes, vRes, tRes] = await Promise.all([
        fetch('/factions'),
        fetch('/factions/wars'),
        fetch('/factions/alliances'),
        fetch('/factions/vassalages'),
        fetch('/factions/tributes'),
      ]);
      if (fRes.ok) {
        const data = await fRes.json();
        factions.value = data.factions ?? [];
      }
      if (wRes.ok) {
        const data = await wRes.json();
        wars.value = data.wars ?? [];
      }
      if (aRes.ok) {
        const data = await aRes.json();
        alliances.value = data.alliances ?? [];
      }
      if (vRes.ok) {
        const data = await vRes.json();
        vassalages.value = data.vassalages ?? [];
      }
      if (tRes.ok) {
        const data = await tRes.json();
        tributes.value = data.tributes ?? [];
      }
    } catch {
      // ignore temporary network jitter
    }
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
    await fetch('/factions/' + id + '/join', { method: 'POST' });
    await refresh();
  }

  async function formAlliance(id: string) {
    await fetch('/factions/' + id + '/alliance', { method: 'POST' });
    await refresh();
  }

  async function vassalizeFaction(id: string) {
    await fetch('/factions/' + id + '/vassalize', { method: 'POST' });
    await refresh();
  }

  async function renewAlliance(id: string) {
    await fetch('/factions/alliances/' + id + '/renew', { method: 'POST' });
    await refresh();
  }

  async function breakAlliance(id: string) {
    await fetch('/factions/alliances/' + id + '/break', { method: 'POST' });
    await refresh();
  }

  async function leaveFaction(id: string) {
    await fetch('/factions/' + id + '/leave', { method: 'POST' });
    await refresh();
  }

  async function declarePeace(warId: string) {
    await fetch('/factions/wars/' + warId + '/peace', { method: 'POST' });
    await refresh();
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, 15000);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { factions, wars, alliances, vassalages, tributes, refresh, createFaction, joinFaction, formAlliance, vassalizeFaction, renewAlliance, breakAlliance, leaveFaction, declarePeace };
}
