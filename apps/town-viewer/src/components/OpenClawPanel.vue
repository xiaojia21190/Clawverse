<template>
  <section class="oc-panel">
    <div class="oc-header">
      <div>
        <div class="oc-kicker">World Brain</div>
        <div class="oc-title">OpenClaw Director</div>
      </div>
      <div class="oc-mood" :class="moodTone">{{ status?.mood ?? 'offline' }}</div>
    </div>

    <div v-if="selfState" class="oc-body">
      <div class="oc-identity-card">
        <div class="oc-name-row">
          <div>
            <div class="oc-name">{{ selfState.name }}</div>
            <div class="oc-traits">{{ selfState.dna.archetype }} / {{ selfState.dna.modelTrait }}</div>
          </div>
          <div class="oc-signal-grid">
            <span class="oc-signal">CPU {{ Math.round(selfState.hardware?.cpuUsage ?? 0) }}%</span>
            <span class="oc-signal">RAM {{ Math.round(selfState.hardware?.ramUsage ?? 0) }}%</span>
          </div>
        </div>

        <div v-if="selfState.dna.persona" class="oc-persona">
          {{ selfState.dna.persona }}
        </div>

        <div v-if="selfState.dna.badges?.length" class="oc-badges">
          <span v-for="badge in selfState.dna.badges" :key="badge" class="oc-badge">{{ badge }}</span>
        </div>
      </div>

      <div class="oc-section">
        <div class="oc-section-label">World Identity</div>
        <div class="oc-world-grid">
          <div class="oc-world-card">
            <span class="oc-world-label">Topic</span>
            <strong>{{ props.status?.topic ?? 'shared-topic' }}</strong>
          </div>
          <div class="oc-world-card">
            <span class="oc-world-label">District</span>
            <strong>{{ currentDistrict }}</strong>
          </div>
          <div class="oc-world-card">
            <span class="oc-world-label">Actor</span>
            <strong>{{ actorSignature }}</strong>
          </div>
          <div class="oc-world-card">
            <span class="oc-world-label">Session</span>
            <strong>{{ sessionSignature }}</strong>
          </div>
        </div>
      </div>

      <div class="oc-section">
        <div class="oc-section-label">Autonomy Loop</div>

        <div v-if="governor" class="oc-intent-card">
          <div class="oc-intent-topline">
            <span class="oc-intent-title">{{ governorModeLabel }}</span>
            <span class="oc-intent-state" :class="governorTone">{{ governor.focusLane }}</span>
          </div>
          <div class="oc-intent-copy">{{ governor.summary }}</div>
          <div class="oc-intent-meta">
            <span>Pressure {{ governor.pressure }}</span>
            <span>Confidence {{ governor.confidence }}</span>
          </div>
          <div class="oc-badges">
            <span v-for="lane in governorLanes" :key="lane.key" class="oc-badge">
              {{ lane.label }} {{ lane.score }}
            </span>
          </div>
        </div>

        <div v-if="currentJob" class="oc-intent-card">
          <div class="oc-intent-topline">
            <span class="oc-intent-title">{{ currentJob.title }}</span>
            <span class="oc-intent-state" :class="currentJob.status">{{ currentJob.status }}</span>
          </div>
          <div class="oc-intent-copy">{{ currentJob.reason }}</div>
          <div class="oc-intent-meta">
            <span v-if="currentJob.sourceEventType">Source {{ currentJob.sourceEventType.replace(/_/g, ' ') }}</span>
            <span>Priority {{ currentJob.priority }}</span>
          </div>
        </div>

        <div v-else class="oc-empty">
          No active job. OpenClaw is watching the shared topic world.
        </div>
      </div>

      <div class="oc-section">
        <div class="oc-section-label">Evolution Control</div>

        <div class="oc-intent-card">
          <div class="oc-intent-topline">
            <span class="oc-intent-title">{{ rolloutPair }}</span>
            <span class="oc-intent-state" :class="evolutionTone">
              {{ activeRun ? `running ${activeRun.step}` : `gate ${gateStatus}` }}
            </span>
          </div>
          <div class="oc-intent-copy">
            {{ activeRun ? 'A local evolution step is currently running.' : `Candidate ratio ${rolloutRatio}. Trigger a controlled step when you want to advance or inspect the loop.` }}
          </div>
          <div class="oc-intent-meta">
            <span>Ratio {{ rolloutRatio }}</span>
            <span v-if="lastRun">Last {{ lastRun.step }} {{ lastRun.ok ? 'ok' : 'failed' }}</span>
            <span v-if="cooldowns?.globalActive">Cooldown {{ globalCooldownLabel }}</span>
          </div>
          <div class="oc-intent-meta">
            <span>Autopilot {{ autopilotConfig?.enabled ? 'on' : 'off' }}</span>
            <span>Interval {{ autopilotIntervalLabel }}</span>
            <span>Min Delta {{ autopilotConfig?.minEpisodeDelta ?? 0 }}</span>
            <span>Total Episodes {{ totalEpisodes }}</span>
          </div>
          <label class="oc-note-field">
            <span class="oc-note-label">Run Note</span>
            <input
              v-model="runNote"
              class="oc-note-input"
              type="text"
              maxlength="200"
              placeholder="Optional reason for this evolution step"
            />
          </label>
          <div class="oc-run-grid">
            <button
              v-for="step in controlSteps"
              :key="step.key"
              class="oc-run-btn"
              :disabled="isStepBlocked(step.key)"
              @click="runEvolution(step.key)"
            >
              {{ step.label }}<template v-if="stepCooldownLabel(step.key)"> {{ stepCooldownLabel(step.key) }}</template>
            </button>
          </div>
          <div v-if="actionMessage" class="oc-run-note stable">{{ actionMessage }}</div>
          <div v-if="actionError" class="oc-run-note critical">{{ actionError }}</div>
          <details v-if="lastRun && (lastRun.stdout || lastRun.stderr)" class="oc-run-log">
            <summary>Last Run Output</summary>
            <pre>{{ lastRun.stderr || lastRun.stdout }}</pre>
          </details>
          <div v-else-if="lastRun" class="oc-run-note watch">
            Finished {{ formatTime(lastRun.finishedAt) }} | {{ Math.round(lastRun.durationMs) }}ms
          </div>
        </div>

        <div v-if="recentAudit.length > 0" class="oc-intent-card">
          <div class="oc-intent-topline">
            <span class="oc-intent-title">Recent Audit</span>
            <span class="oc-intent-state" :class="evolutionTone">{{ recentAudit.length }} entries</span>
          </div>
          <div class="oc-audit-filters">
            <button
              v-for="filter in auditFilters"
              :key="filter.key"
              class="oc-audit-filter"
              :class="{ active: auditFilter === filter.key }"
              @click="setAuditFilter(filter.key)"
            >
              {{ filter.label }}
            </button>
          </div>
          <div class="oc-audit-list">
            <div v-for="entry in recentAudit" :key="`${entry.ts}:${entry.step}:${entry.outcome}`" class="oc-audit-row">
              <span class="oc-audit-label">{{ entry.step }} {{ entry.outcome }}</span>
              <span class="oc-audit-meta">
                {{ formatTime(entry.ts) }} | {{ entry.operatorKind || entry.source || entry.remoteAddress }}
                <template v-if="entry.reason"> | {{ entry.reason }}</template>
              </span>
              <span v-if="entry.note" class="oc-audit-note">{{ entry.note }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="oc-section">
        <div class="oc-section-label">World Pressure</div>
        <div v-if="needs" class="oc-needs-grid">
          <div v-for="entry in needEntries" :key="entry.key" class="oc-need-card">
            <div class="oc-need-topline">
              <span>{{ entry.label }}</span>
              <strong>{{ entry.value }}</strong>
            </div>
            <div class="oc-need-track">
              <div class="oc-need-fill" :class="entry.tone" :style="{ width: `${entry.value}%` }"></div>
            </div>
          </div>
        </div>
        <div v-else class="oc-empty">Pressure telemetry unavailable.</div>
      </div>

      <div class="oc-section">
        <div class="oc-section-label">Skill Stack</div>
        <div v-if="skills" class="oc-skills-grid">
          <div v-for="entry in skillEntries" :key="entry.key" class="oc-skill-card">
            <div class="oc-skill-topline">
              <span>{{ entry.label }}</span>
              <strong>Lv {{ entry.level }}</strong>
            </div>
            <div class="oc-skill-track">
              <div class="oc-skill-fill" :style="{ width: `${entry.progress}%` }"></div>
            </div>
            <div class="oc-skill-meta">{{ entry.xp }} xp</div>
          </div>
        </div>
        <div v-else class="oc-empty">Skill telemetry unavailable.</div>
      </div>
    </div>

    <div v-else class="oc-empty">
      Waiting for local agent state.
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { ColonyStatus, NeedsState, SkillsState } from '../composables/useColonyState';
import type { JobInfo } from '../composables/useJobs';

interface EvolutionRunInfo {
  step: string;
  startedAt: string;
  pid: number | null;
}

interface EvolutionRunResult extends EvolutionRunInfo {
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface EvolutionRolloutStatus {
  baseline?: string;
  candidate?: string;
  candidateRatio?: number;
  healthGate?: {
    status?: string;
  } | null;
}

interface EvolutionAuditEntry {
  ts: string;
  step: string;
  outcome: string;
  operatorKind?: 'town-viewer' | 'openclaw-worker' | 'manual-cli' | 'daemon-policy' | 'unknown';
  note?: string | null;
  ok?: boolean;
  reason?: string | null;
  remoteAddress: string;
  source?: string | null;
}

interface EvolutionStatus {
  config?: {
    autopilot?: {
      enabled: boolean;
      intervalMs: number;
      minEpisodeDelta: number;
    } | null;
    cooldowns?: {
      globalMs: number;
    } | null;
  } | null;
  stats?: {
    total: number;
  } | null;
  rollout: EvolutionRolloutStatus | null;
  audit?: EvolutionAuditEntry[];
  cooldowns?: {
    globalActive: boolean;
    globalUntil: string | null;
    globalRemainingMs: number;
    byStep?: Record<string, {
      active: boolean;
      until: string | null;
      remainingMs: number;
    }>;
  } | null;
  runner?: {
    active: EvolutionRunInfo | null;
    last: EvolutionRunResult | null;
  } | null;
}

const props = defineProps<{
  status: ColonyStatus | null;
  needs: NeedsState | null;
  skills: SkillsState | null;
  jobs: JobInfo[];
}>();

const evolution = ref<EvolutionStatus | null>(null);
const auditEntries = ref<EvolutionAuditEntry[]>([]);
const auditFilter = ref<'all' | 'failed' | 'town-viewer' | 'manual-cli' | 'openclaw-worker' | 'daemon-policy'>('all');
const runNote = ref('');
const runPending = ref(false);
const actionMessage = ref('');
const actionError = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const selfState = computed(() => props.status?.state ?? null);
const governor = computed(() => props.status?.governor ?? null);
const activeRun = computed(() => evolution.value?.runner?.active ?? null);
const lastRun = computed(() => evolution.value?.runner?.last ?? null);
const recentAudit = computed(() => auditEntries.value.slice(0, 6));
const rollout = computed(() => evolution.value?.rollout ?? null);
const cooldowns = computed(() => evolution.value?.cooldowns ?? null);
const autopilotConfig = computed(() => evolution.value?.config?.autopilot ?? null);
const totalEpisodes = computed(() => Number(evolution.value?.stats?.total ?? 0));
const gateStatus = computed(() => rollout.value?.healthGate?.status ?? 'pending');
const rolloutRatio = computed(() => `${Math.round(Number(rollout.value?.candidateRatio ?? 0) * 100)}%`);
const globalCooldownLabel = computed(() => {
  const remainingMs = cooldowns.value?.globalRemainingMs ?? 0;
  if (remainingMs <= 0) return 'ready';
  return `${Math.ceil(remainingMs / 1000)}s`;
});
const autopilotIntervalLabel = computed(() => {
  const intervalMs = Number(autopilotConfig.value?.intervalMs ?? 0);
  return intervalMs > 0 ? `${Math.round(intervalMs / 1000)}s` : 'off';
});
const rolloutPair = computed(() => {
  const baseline = rollout.value?.baseline ?? 'baseline';
  const candidate = rollout.value?.candidate ?? 'candidate';
  return `${baseline} -> ${candidate}`;
});
const controlSteps = [
  { key: 'propose', label: 'Propose' },
  { key: 'evaluate', label: 'Evaluate' },
  { key: 'decide', label: 'Decide' },
  { key: 'health-check', label: 'Health' },
  { key: 'apply-rollout', label: 'Rollout' },
  { key: 'cycle', label: 'Cycle' },
] as const;
const auditFilters = [
  { key: 'all', label: 'All' },
  { key: 'failed', label: 'Failed' },
  { key: 'town-viewer', label: 'Viewer' },
  { key: 'manual-cli', label: 'CLI' },
  { key: 'openclaw-worker', label: 'Worker' },
  { key: 'daemon-policy', label: 'Policy' },
] as const;

const currentJob = computed(() => {
  return props.jobs.find((job) => job.status === 'active')
    ?? props.jobs.find((job) => job.status === 'queued')
    ?? null;
});

const moodTone = computed(() => {
  const mood = props.status?.mood ?? 'offline';
  if (['distressed', 'stressed'].includes(mood)) return 'critical';
  if (['busy', 'working'].includes(mood)) return 'watch';
  return 'stable';
});

const governorTone = computed(() => {
  const pressure = governor.value?.pressure ?? 0;
  if (pressure >= 80) return 'critical';
  if (pressure >= 55) return 'watch';
  return 'stable';
});

const evolutionTone = computed(() => {
  if (activeRun.value) return 'watch';
  if (gateStatus.value === 'healthy') return 'stable';
  if (gateStatus.value === 'critical') return 'critical';
  return 'watch';
});

const governorModeLabel = computed(() => {
  const mode = governor.value?.mode ?? 'consolidate';
  if (mode === 'survive') return 'Governor: Survival';
  if (mode === 'fortify') return 'Governor: Fortify';
  if (mode === 'recover') return 'Governor: Recovery';
  if (mode === 'expand') return 'Governor: Expansion';
  if (mode === 'dominate') return 'Governor: Dominance';
  return 'Governor: Consolidation';
});

const governorLanes = computed(() => {
  const laneScores = governor.value?.laneScores ?? {};
  return [
    { key: 'wartime', label: 'War', score: Math.round(laneScores.wartime ?? 0) },
    { key: 'economy', label: 'Economy', score: Math.round(laneScores.economy ?? 0) },
    { key: 'diplomacy', label: 'Diplomacy', score: Math.round(laneScores.diplomacy ?? 0) },
    { key: 'alliance', label: 'Alliance', score: Math.round(laneScores.alliance ?? 0) },
    { key: 'vassal', label: 'Vassal', score: Math.round(laneScores.vassal ?? 0) },
    { key: 'faction', label: 'Faction', score: Math.round(laneScores.faction ?? 0) },
  ].sort((left, right) => right.score - left.score).slice(0, 4);
});

const needEntries = computed(() => {
  if (!props.needs) return [];

  return [
    { key: 'social', label: 'Social', value: Math.round(props.needs.social), tone: needTone(props.needs.social) },
    { key: 'tasked', label: 'Tasked', value: Math.round(props.needs.tasked), tone: needTone(props.needs.tasked) },
    { key: 'wanderlust', label: 'Wander', value: Math.round(props.needs.wanderlust), tone: needTone(props.needs.wanderlust) },
    { key: 'creative', label: 'Creative', value: Math.round(props.needs.creative), tone: needTone(props.needs.creative) },
  ];
});

const skillEntries = computed(() => {
  if (!props.skills) return [];

  return [
    { key: 'social', label: 'Social', level: props.skills.social.level, xp: props.skills.social.xp, progress: skillProgress(props.skills.social.xp) },
    { key: 'collab', label: 'Collab', level: props.skills.collab.level, xp: props.skills.collab.xp, progress: skillProgress(props.skills.collab.xp) },
    { key: 'explorer', label: 'Explorer', level: props.skills.explorer.level, xp: props.skills.explorer.xp, progress: skillProgress(props.skills.explorer.xp) },
    { key: 'analyst', label: 'Analyst', level: props.skills.analyst.level, xp: props.skills.analyst.xp, progress: skillProgress(props.skills.analyst.xp) },
  ];
});

const currentDistrict = computed(() => {
  const state = selfState.value;
  if (!state) return 'unknown';
  return state.spawnDistrict ?? districtName(state.position);
});

const actorSignature = computed(() => {
  const actorId = selfState.value?.actorId ?? props.status?.actorId ?? selfState.value?.dna.id ?? null;
  return shortId(actorId);
});

const sessionSignature = computed(() => {
  const sessionId = selfState.value?.sessionId ?? props.status?.id ?? selfState.value?.id ?? null;
  return shortId(sessionId);
});

function needTone(value: number): 'stable' | 'watch' | 'critical' {
  if (value < 15) return 'critical';
  if (value < 35) return 'watch';
  return 'stable';
}

function skillProgress(xp: number): number {
  const checkpoints = [0, 50, 150, 350, 700, 1200];
  for (let index = checkpoints.length - 1; index >= 0; index -= 1) {
    if (xp >= checkpoints[index]) {
      const floor = checkpoints[index];
      const ceiling = checkpoints[index + 1] ?? (floor + 200);
      return Math.max(6, Math.min(100, ((xp - floor) / Math.max(1, ceiling - floor)) * 100));
    }
  }
  return 0;
}

function districtName(position: { x: number; y: number }): string {
  if (position.x < 10 && position.y < 10) return 'Plaza';
  if (position.x >= 10 && position.x < 20 && position.y < 10) return 'Market';
  if (position.x < 10 && position.y >= 10 && position.y < 20) return 'Library';
  if (position.x >= 10 && position.x < 20 && position.y >= 10 && position.y < 20) return 'Workshop';
  if (position.x < 10 && position.y >= 20) return 'Park';
  if (position.x >= 10 && position.x < 20 && position.y >= 20 && position.y < 30) return 'Tavern';
  return 'Residential';
}

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : 'unknown';
}

function formatTime(value: string | null | undefined): string {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stepCooldownLabel(step: typeof controlSteps[number]['key']): string {
  const snapshot = cooldowns.value?.byStep?.[step];
  if (!snapshot?.active) return '';
  return `${Math.ceil(snapshot.remainingMs / 1000)}s`;
}

function isStepBlocked(step: typeof controlSteps[number]['key']): boolean {
  return Boolean(
    activeRun.value
    || runPending.value
    || cooldowns.value?.globalActive
    || cooldowns.value?.byStep?.[step]?.active
  );
}

async function fetchEvolutionStatus(): Promise<void> {
  try {
    const res = await fetch('/evolution/status');
    if (!res.ok) return;
    evolution.value = await res.json() as EvolutionStatus;
  } catch {
    // ignore temporary network jitter
  }
}

async function fetchEvolutionAudit(): Promise<void> {
  try {
    const query = new URLSearchParams({ limit: '6' });
    if (auditFilter.value === 'failed') {
      query.set('ok', 'false');
    } else if (auditFilter.value !== 'all') {
      query.set('operatorKind', auditFilter.value);
    }
    const res = await fetch(`/evolution/audit?${query.toString()}`);
    if (!res.ok) return;
    const payload = await res.json() as { entries?: EvolutionAuditEntry[] };
    auditEntries.value = Array.isArray(payload.entries) ? payload.entries : [];
  } catch {
    // ignore temporary network jitter
  }
}

async function runEvolution(step: typeof controlSteps[number]['key']): Promise<void> {
  runPending.value = true;
  actionMessage.value = '';
  actionError.value = '';
  try {
    const res = await fetch('/evolution/run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-clawverse-origin': 'town-viewer',
      },
      body: JSON.stringify({ step, note: runNote.value.trim() || undefined }),
    });
    const payload = await res.json().catch(() => null) as { ok?: boolean; error?: string; result?: EvolutionRunResult; active?: EvolutionRunInfo } | null;
    if (!res.ok || !payload?.ok) {
      actionError.value = payload?.error
        ?? payload?.result?.stderr
        ?? (payload?.active ? `already running: ${payload.active.step}` : `run failed: ${step}`);
    } else {
      actionMessage.value = `${payload.result?.step ?? step} finished in ${Math.round(payload.result?.durationMs ?? 0)}ms`;
      runNote.value = '';
    }
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    runPending.value = false;
    await fetchEvolutionStatus();
    await fetchEvolutionAudit();
  }
}

function setAuditFilter(value: typeof auditFilters[number]['key']): void {
  if (auditFilter.value === value) return;
  auditFilter.value = value;
  void fetchEvolutionAudit();
}

onMounted(() => {
  fetchEvolutionStatus();
  fetchEvolutionAudit();
  timer = setInterval(() => {
    fetchEvolutionStatus();
    fetchEvolutionAudit();
  }, 30_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.oc-panel,
.oc-body,
.oc-section,
.oc-needs-grid,
.oc-skills-grid,
.oc-world-grid,
.oc-signal-grid,
.oc-run-grid,
.oc-audit-filters,
.oc-audit-list,
.oc-badges {
  display: grid;
  gap: 10px;
}

.oc-panel {
  padding: 14px;
}

.oc-header,
.oc-name-row,
.oc-intent-topline,
.oc-need-topline,
.oc-skill-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.oc-kicker,
.oc-section-label,
.oc-skill-meta,
.oc-intent-meta,
.oc-traits {
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.oc-title {
  margin-top: 2px;
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--text-strong);
}

.oc-mood,
.oc-badge,
.oc-signal,
.oc-intent-state {
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  padding: 4px 10px;
  font-size: 0.66rem;
  font-weight: 800;
}

.oc-mood.stable,
.oc-need-fill.stable {
  color: #0f766e;
  background: rgba(15, 118, 110, 0.12);
}

.oc-mood.watch,
.oc-need-fill.watch {
  color: #9a6700;
  background: rgba(202, 138, 4, 0.14);
}

.oc-mood.critical,
.oc-need-fill.critical {
  color: #b42343;
  background: rgba(220, 38, 38, 0.14);
}

.oc-identity-card,
.oc-world-card,
.oc-intent-card,
.oc-need-card,
.oc-skill-card,
.oc-empty {
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(236, 242, 247, 0.92));
  box-shadow: var(--shadow-pressed);
}

.oc-identity-card,
.oc-world-card,
.oc-intent-card,
.oc-need-card,
.oc-skill-card,
.oc-empty {
  padding: 12px;
}

.oc-name {
  font-size: 0.9rem;
  font-weight: 800;
  color: var(--text-strong);
}

.oc-persona,
.oc-intent-copy,
.oc-empty {
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--text-body);
}

.oc-intent-title,
.oc-need-topline strong,
.oc-skill-topline strong {
  font-size: 0.76rem;
  font-weight: 800;
  color: var(--text-strong);
}

.oc-intent-state.active {
  color: #0f766e;
  background: rgba(15, 118, 110, 0.12);
}

.oc-intent-state.queued {
  color: #9a6700;
  background: rgba(202, 138, 4, 0.14);
}

.oc-intent-state.done {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.12);
}

.oc-intent-state.cancelled {
  color: #b42343;
  background: rgba(220, 38, 38, 0.14);
}

.oc-needs-grid,
.oc-skills-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.oc-world-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.oc-run-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.oc-audit-filters {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.oc-note-field {
  display: grid;
  gap: 6px;
}

.oc-note-label {
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.oc-note-input {
  width: 100%;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.88);
  color: var(--text-strong);
  font-size: 0.7rem;
}

.oc-note-input::placeholder {
  color: var(--text-muted);
}

.oc-world-card {
  display: grid;
  gap: 6px;
}

.oc-world-label {
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.oc-world-card strong {
  font-size: 0.76rem;
  font-weight: 800;
  color: var(--text-strong);
}

.oc-need-track,
.oc-skill-track {
  margin-top: 8px;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
}

.oc-need-fill,
.oc-skill-fill {
  height: 100%;
  border-radius: inherit;
  transition: width 220ms var(--ease-snap);
}

.oc-skill-fill {
  background: linear-gradient(90deg, var(--accent-sky), #8b5cf6);
}

.oc-badges,
.oc-signal-grid {
  grid-template-columns: repeat(auto-fit, minmax(0, max-content));
}

.oc-badge,
.oc-signal {
  color: var(--text-body);
  background: rgba(255, 255, 255, 0.72);
}

.oc-run-btn {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--text-strong);
  cursor: pointer;
  font-size: 0.68rem;
  font-weight: 700;
  transition: transform 160ms var(--ease-snap), box-shadow 160ms var(--ease-snap);
}

.oc-run-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-float);
}

.oc-run-btn:disabled {
  opacity: 0.45;
  cursor: default;
  transform: none;
}

.oc-run-note {
  font-size: 0.68rem;
}

.oc-run-note.stable {
  color: var(--state-good);
}

.oc-run-note.watch {
  color: var(--state-warn);
}

.oc-run-note.critical {
  color: var(--state-bad);
}

.oc-run-log {
  display: grid;
  gap: 6px;
}

.oc-run-log summary {
  cursor: pointer;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--text-body);
}

.oc-run-log pre {
  max-height: 180px;
  overflow: auto;
  margin: 0;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: rgba(15, 23, 42, 0.07);
  font-size: 0.66rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.oc-audit-row {
  display: grid;
  gap: 2px;
}

.oc-audit-filter {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  padding: 5px 8px;
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-body);
  cursor: pointer;
  font-size: 0.64rem;
  font-weight: 700;
}

.oc-audit-filter.active {
  color: var(--text-strong);
  border-color: rgba(37, 99, 235, 0.28);
  background: rgba(219, 234, 254, 0.8);
}

.oc-audit-label {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-strong);
}

.oc-audit-meta {
  font-size: 0.66rem;
  color: var(--text-muted);
}

.oc-audit-note {
  font-size: 0.68rem;
  color: var(--text-body);
  line-height: 1.4;
}

@media (max-width: 760px) {
  .oc-needs-grid,
  .oc-skills-grid,
  .oc-world-grid,
  .oc-run-grid,
  .oc-audit-filters {
    grid-template-columns: 1fr;
  }

  .oc-header,
  .oc-name-row,
  .oc-intent-topline,
  .oc-need-topline,
  .oc-skill-topline {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
