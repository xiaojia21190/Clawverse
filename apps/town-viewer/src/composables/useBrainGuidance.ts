import { onMounted, onUnmounted, ref } from 'vue';

export type BrainGuidanceKind = 'note' | 'move';

export interface BrainGuidanceRecord {
  id: string;
  kind: BrainGuidanceKind;
  message: string;
  payload: Record<string, unknown> | null;
  status: 'active' | 'consumed' | 'dismissed' | 'expired';
  source: 'operator' | 'system';
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

interface BrainGuidanceListResponse {
  guidance?: BrainGuidanceRecord[];
}

interface CreateBrainGuidanceResponse {
  success?: boolean;
  guidance?: BrainGuidanceRecord;
  error?: string;
}

const POLL_MS = 5000;

export function useBrainGuidance() {
  const guidance = ref<BrainGuidanceRecord[]>([]);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    try {
      const res = await fetch('/brain/guidance');
      if (!res.ok) return;
      const payload = await res.json() as BrainGuidanceListResponse;
      guidance.value = Array.isArray(payload.guidance) ? payload.guidance : [];
    } catch {
      // ignore transient fetch errors
    }
  }

  async function create(input: {
    kind: BrainGuidanceKind;
    message?: string;
    payload?: Record<string, unknown> | null;
    ttlMs?: number | null;
  }): Promise<{ ok: boolean; guidance: BrainGuidanceRecord | null; error: string }> {
    try {
      const res = await fetch('/brain/guidance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const payload = await res.json().catch(() => ({})) as CreateBrainGuidanceResponse;
      if (!res.ok || !payload.success) {
        return {
          ok: false,
          guidance: null,
          error: payload.error || `request_failed_${res.status}`,
        };
      }
      await refresh();
      return { ok: true, guidance: payload.guidance ?? null, error: '' };
    } catch (err) {
      return { ok: false, guidance: null, error: (err as Error).message };
    }
  }

  async function consume(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/brain/guidance/${encodeURIComponent(id)}/consume`, { method: 'POST' });
      if (res.ok) await refresh();
      return res.ok;
    } catch {
      return false;
    }
  }

  async function dismiss(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/brain/guidance/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) await refresh();
      return res.ok;
    } catch {
      return false;
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
    guidance,
    refresh,
    create,
    consume,
    dismiss,
  };
}

