import { ref, onMounted, onUnmounted } from 'vue';

export type JobStatus = 'queued' | 'active' | 'done' | 'cancelled';
export type JobKind = 'build' | 'trade' | 'found_faction' | 'join_faction' | 'form_alliance' | 'renew_alliance' | 'break_alliance' | 'vassalize_faction' | 'declare_peace' | 'move' | 'collab' | 'recover' | 'craft';

export interface JobInfo {
  id: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  status: JobStatus;
  kind: JobKind;
  title: string;
  reason: string;
  priority: number;
  payload: Record<string, unknown>;
  sourceEventType: string | null;
  dedupeKey: string | null;
  note: string | null;
}

export function useJobs() {
  const jobs = ref<JobInfo[]>([]);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const res = await fetch('/jobs');
      if (res.ok) {
        const data = await res.json() as { jobs?: JobInfo[] };
        jobs.value = Array.isArray(data.jobs) ? data.jobs : [];
      }
    } catch {
      // ignore temporary network jitter
    }
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, 10000);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { jobs, refresh };
}
