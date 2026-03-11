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

  async function submitCombatGuidance(message: string, payload: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch('/brain/guidance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'note',
          message,
          payload,
          ttlMs: 20 * 60_000,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

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
    const ok = await submitCombatGuidance(
      `Prefer shifting combat posture to ${posture} if current threat pressure supports it.`,
      { action: 'combat_posture', posture },
    );
    if (ok) {
      actionError.value = '';
      actionMessage.value = 'Posture suggestion recorded.';
    } else {
      actionError.value = 'Failed to submit posture suggestion.';
      actionMessage.value = '';
    }
    await refresh();
    return ok;
  }

  async function treat(): Promise<boolean> {
    const ok = await submitCombatGuidance(
      'Prefer immediate treatment if shelter support and survival outlook permit.',
      { action: 'combat_treat' },
    );
    if (ok) {
      actionError.value = '';
      actionMessage.value = 'Treatment suggestion recorded.';
    } else {
      actionError.value = 'Failed to submit treatment suggestion.';
      actionMessage.value = '';
    }
    await refresh();
    return ok;
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
