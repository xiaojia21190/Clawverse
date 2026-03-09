import { ref, onMounted, onUnmounted } from 'vue';
import type { CombatStatus } from './useCombat';
import type { PeerState } from './usePeers';
import type { GovernorState, HardwareMetrics } from './useStatus';

export interface NeedsState {
  social: number;
  tasked: number;
  wanderlust: number;
  creative: number;
  updatedAt: string;
}

export interface SkillState {
  xp: number;
  level: number;
}

export interface SkillsState {
  social: SkillState;
  collab: SkillState;
  explorer: SkillState;
  analyst: SkillState;
  updatedAt: string;
}

export interface ColonyStatus {
  id: string;
  actorId?: string | null;
  topic?: string;
  mood: string;
  metrics: HardwareMetrics | null;
  state: PeerState | null;
  combat: CombatStatus | null;
  governor?: GovernorState | null;
  connectedPeers: number;
  knownPeers: number;
  knownActors?: number;
}

const POLL_MS = 5000;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

export function useColonyState() {
  const status = ref<ColonyStatus | null>(null);
  const needs = ref<NeedsState | null>(null);
  const skills = ref<SkillsState | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    const [statusPayload, needsPayload, skillsPayload] = await Promise.all([
      fetchJson<ColonyStatus>('/status'),
      fetchJson<NeedsState>('/life/needs'),
      fetchJson<SkillsState>('/life/skills'),
    ]);

    if (statusPayload) status.value = statusPayload;
    if (needsPayload) needs.value = needsPayload;
    if (skillsPayload) skills.value = skillsPayload;
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, POLL_MS);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return {
    status,
    needs,
    skills,
    refresh,
  };
}
