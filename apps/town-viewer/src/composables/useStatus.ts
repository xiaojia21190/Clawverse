import { ref, onMounted, onUnmounted } from 'vue';
import type { PeerState } from './usePeers';

export interface GovernorState {
  mode: string;
  focusLane: string;
  objective: string;
  summary: string;
  reasons: string[];
  laneScores: Record<string, number>;
  priorityBias: Record<string, number>;
  pressure: number;
  confidence: number;
  updatedAt: string;
}

export interface HardwareMetrics {
  cpuUsage: number;
  ramUsage: number;
  ramTotal: number;
  diskFree: number;
  uptime: number;
  platform: string;
  hostname: string;
  cpuModel: string;
  cpuCores: number;
}

export interface StatusResponse {
  id: string;
  actorId?: string | null;
  topic?: string;
  mood: string;
  metrics: HardwareMetrics;
  state: PeerState | null;
  combat: Record<string, unknown> | null;
  governor?: GovernorState | null;
  connectedPeers: number;
  knownPeers: number;
  knownActors?: number;
}

const POLL_MS = 5000;

export function useStatus() {
  const status = ref<StatusResponse | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const res = await fetch('/status');
      if (res.ok) {
        status.value = await res.json() as StatusResponse;
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

  return { status, refresh };
}
