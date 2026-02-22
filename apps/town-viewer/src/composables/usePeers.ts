import { ref, onUnmounted } from 'vue';
import { createSseConnection } from '../api/sse';

export interface Appearance {
  form: string;
  primaryColor: string;
  secondaryColor: string;
  accessories: string[];
}

export interface DNA {
  id: string;
  archetype: 'Warrior' | 'Artisan' | 'Scholar' | 'Ranger';
  modelTrait: string;
  badges: string[];
  persona: string;
  appearance: Appearance;
}

export interface PeerState {
  id: string;
  name: string;
  position: { x: number; y: number };
  mood: string;
  hardware: { cpuUsage: number; ramUsage: number };
  dna: DNA;
  lastUpdate: string;
}

export function usePeers() {
  const peers = ref<Map<string, PeerState>>(new Map());
  const connected = ref(false);

  const stop = createSseConnection('/sse/state', 'peers', (data: unknown) => {
    const payload = data as { peers: PeerState[] };
    const map = new Map<string, PeerState>();
    for (const p of payload.peers ?? []) map.set(p.id, p);
    peers.value = map;
    connected.value = true;
  });

  onUnmounted(stop);

  return { peers, connected };
}
