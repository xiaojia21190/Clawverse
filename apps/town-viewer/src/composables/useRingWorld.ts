import { onMounted, onUnmounted, ref } from 'vue';
import type { RingWorldSummary } from './useWorldNodes';

interface RingWorldResponse {
  topic?: string;
  ring?: RingWorldSummary;
}

export interface RingPeerRecord {
  topic: string;
  baseUrl: string;
  updatedAt: string;
  source: 'configured' | 'announced' | 'manual';
  health: 'live' | 'stale' | 'expired';
}

interface RingPeersResponse {
  peers?: RingPeerRecord[];
}

export interface RefugeeSquadRecord {
  id: string;
  fromTopic: string;
  toTopic: string;
  actorIds: string[];
  actorCount: number;
  urgency: number;
  averageScore: number;
  triggerEventType: string;
  status: 'forming' | 'staged';
  summary: string;
  updatedAt: string;
}

interface RefugeeSquadsResponse {
  squads?: RefugeeSquadRecord[];
}

const POLL_MS = 5000;

export function useRingWorld() {
  const ringSummary = ref<RingWorldSummary | null>(null);
  const ringTopic = ref<string | null>(null);
  const ringPeers = ref<RingPeerRecord[]>([]);
  const refugeeSquads = ref<RefugeeSquadRecord[]>([]);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    try {
      const [ringRes, peersRes, squadsRes] = await Promise.all([
        fetch('/world/ring'),
        fetch('/world/ring/peers'),
        fetch('/world/refugee-squads'),
      ]);

      if (ringRes.ok) {
        const payload = await ringRes.json() as RingWorldResponse;
        ringSummary.value = payload.ring ?? null;
        ringTopic.value = typeof payload.topic === 'string'
          ? payload.topic
          : payload.ring?.currentTopic ?? null;
      }

      if (peersRes.ok) {
        const peersPayload = await peersRes.json() as RingPeersResponse;
        ringPeers.value = Array.isArray(peersPayload.peers) ? peersPayload.peers : [];
      }

      if (squadsRes.ok) {
        const squadsPayload = await squadsRes.json() as RefugeeSquadsResponse;
        refugeeSquads.value = Array.isArray(squadsPayload.squads) ? squadsPayload.squads : [];
      }
    } catch {
      // ignore transient fetch errors
    }
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, POLL_MS);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return {
    ringSummary,
    ringTopic,
    ringPeers,
    refugeeSquads,
    refresh,
  };
}
