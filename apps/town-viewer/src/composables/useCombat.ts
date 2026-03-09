import { ref, onMounted, onUnmounted } from 'vue';

export interface InjuryInfo {
  id: string;
  label: string;
  severity: 'low' | 'medium' | 'high' | 'fatal';
  source: string;
  createdAt: string;
  healedAt: string | null;
  active: boolean;
  complication: 'untreated' | 'chronic_pain' | null;
}

export interface RaidInfo {
  id: string;
  source: string;
  severity: 'low' | 'medium' | 'high' | 'fatal';
  objective: string;
  recommendedPosture: 'steady' | 'guarded' | 'fortified';
  countermeasure: string;
  startedAt: string;
  resolvedAt: string | null;
  active: boolean;
  summary: string;
}

export interface CombatStatus {
  hp: number;
  maxHp: number;
  pain: number;
  chronicPain: number;
  careDebt: number;
  posture: 'steady' | 'guarded' | 'fortified';
  status: 'stable' | 'injured' | 'critical' | 'downed' | 'dead';
  raidRisk: number;
  activeRaid: RaidInfo | null;
  injuries: InjuryInfo[];
  deaths: number;
  updatedAt: string;
  lastRaidAt: string | null;
  lastDamageAt: string | null;
}

export interface CombatLogEntry {
  id: string;
  ts: string;
  kind: 'raid' | 'combat' | 'injury' | 'recovery' | 'death';
  summary: string;
  payload: Record<string, unknown>;
}

const POLL_MS = 5000;

export function useCombat() {
  const status = ref<CombatStatus | null>(null);
  const logs = ref<CombatLogEntry[]>([]);
  const isLoading = ref(false);
  const actionMessage = ref('');
  const actionError = ref('');
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    isLoading.value = true;
    try {
      const [statusRes, logsRes] = await Promise.all([
        fetch('/combat/status'),
        fetch('/combat/logs'),
      ]);
      if (statusRes.ok) {
        status.value = await statusRes.json() as CombatStatus;
      }
      if (logsRes.ok) {
        const data = await logsRes.json() as { logs?: CombatLogEntry[] };
        logs.value = Array.isArray(data.logs) ? data.logs : [];
      }
    } catch {
      // ignore temporary network jitter
    } finally {
      isLoading.value = false;
    }
  }

  async function setPosture(posture: 'steady' | 'guarded' | 'fortified'): Promise<boolean> {
    try {
      const res = await fetch('/combat/posture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ posture }),
      });
      const data = await res.json().catch(() => null) as { error?: string; status?: CombatStatus } | null;
      if (res.ok) {
        actionError.value = '';
        actionMessage.value = 'Defense posture updated.';
      } else {
        actionError.value = data?.error ? `Failed to update posture: ${data.error}.` : 'Failed to update posture.';
        actionMessage.value = '';
      }
      await refresh();
      return res.ok;
    } catch {
      actionError.value = 'Failed to update posture.';
      actionMessage.value = '';
      return false;
    }
  }

  async function treat(): Promise<boolean> {
    try {
      const res = await fetch('/combat/treat', { method: 'POST' });
      const data = await res.json().catch(() => null) as { error?: string; healed?: number; status?: CombatStatus } | null;
      if (res.ok) {
        const healed = Math.max(0, Math.round(Number(data?.healed ?? 0)));
        actionError.value = '';
        actionMessage.value = healed > 0 ? `Treatment completed (+${healed} HP).` : 'Treatment completed.';
      } else {
        actionError.value = data?.error === 'insufficient_medical_support'
          ? 'Treatment failed: shelter or relay support is required.'
          : 'Treatment failed.';
        actionMessage.value = '';
      }
      await refresh();
      return res.ok;
    } catch {
      actionError.value = 'Treatment request failed.';
      actionMessage.value = '';
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

  return { status, logs, isLoading, actionMessage, actionError, refresh, setPosture, treat };
}
