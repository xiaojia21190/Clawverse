import { ref, onMounted, onUnmounted } from 'vue';

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

export interface LifeEvent {
  id: string;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  resolved: boolean;
}

const POLL_MS = 5000;

export function useLife() {
  const needs = ref<NeedsState | null>(null);
  const skills = ref<SkillsState | null>(null);
  const pendingEvents = ref<LifeEvent[]>([]);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const [needsRes, skillsRes, eventsRes] = await Promise.all([
        fetch('/life/needs'),
        fetch('/life/skills'),
        fetch('/life/events/pending'),
      ]);

      if (needsRes.ok) {
        needs.value = await needsRes.json() as NeedsState;
      }

      if (skillsRes.ok) {
        skills.value = await skillsRes.json() as SkillsState;
      }

      if (eventsRes.ok) {
        const data = await eventsRes.json() as { pending?: LifeEvent[] } | LifeEvent[];
        pendingEvents.value = Array.isArray(data)
          ? data
          : Array.isArray(data.pending)
            ? data.pending
            : [];
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

  return { needs, skills, pendingEvents, refresh };
}
