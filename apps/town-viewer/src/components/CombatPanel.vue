<template>
  <div class="combat-panel">
    <div class="cp-header">
      <span>Combat & Health</span>
      <span class="cp-live" :class="{ syncing: isLoading }">{{ isLoading ? 'Syncing' : 'Live' }}</span>
    </div>

    <div v-if="status" class="cp-body">
      <div class="cp-topline">
        <div class="cp-hp-block">
          <div class="cp-label">HP</div>
          <div class="cp-hp-row">
            <strong>{{ status.hp }}</strong>
            <span>/ {{ status.maxHp }}</span>
          </div>
          <div class="cp-bar"><div class="cp-fill hp" :style="barStyle(status.hp, status.maxHp)"></div></div>
        </div>

        <div class="cp-hp-block">
          <div class="cp-label">Pain</div>
          <div class="cp-hp-row">
            <strong>{{ status.pain }}</strong>
            <span>/ 100</span>
          </div>
          <div class="cp-bar"><div class="cp-fill pain" :style="barStyle(status.pain, 100)"></div></div>
        </div>
      </div>

      <div class="cp-badges">
        <span class="cp-badge" :class="`status-${status.status}`">{{ status.status }}</span>
        <span class="cp-badge posture">Posture {{ status.posture }}</span>
        <span class="cp-badge risk">Raid Risk {{ status.raidRisk }}</span>
        <span v-if="status.chronicPain > 0" class="cp-badge warning">Chronic {{ status.chronicPain }}</span>
        <span v-if="status.careDebt > 0" class="cp-badge warning">Care Debt {{ status.careDebt }}</span>
        <span class="cp-badge muted">Deaths {{ status.deaths }}</span>
      </div>

      <div class="cp-posture-row">
        <button class="cp-action-btn" :disabled="status.posture === 'steady'" @click="onSetPosture('steady')">Steady</button>
        <button class="cp-action-btn" :disabled="status.posture === 'guarded'" @click="onSetPosture('guarded')">Guarded</button>
        <button class="cp-action-btn" :disabled="status.posture === 'fortified'" @click="onSetPosture('fortified')">Fortified</button>
        <button class="cp-action-btn treat" :disabled="status.status === 'dead' || treating" @click="onTreat">{{ treating ? 'Treating...' : 'Treat' }}</button>
      </div>

      <div v-if="props.actionMessage || props.actionError" class="cp-action-feedback" :class="{ error: !!props.actionError }">
        {{ props.actionError || props.actionMessage }}
      </div>

      <div v-if="status.activeRaid" class="cp-raid-card">
        <div class="cp-raid-topline">
          <span class="cp-raid-title">Active Raid</span>
          <span class="cp-badge raid">{{ status.activeRaid.severity }}</span>
        </div>
        <div class="cp-raid-summary">{{ status.activeRaid.summary }}</div>
        <div class="cp-raid-meta">{{ status.activeRaid.source }} · {{ status.activeRaid.objective }} · {{ formatTime(status.activeRaid.startedAt) }}</div>
        <div class="cp-raid-doctrine">
          <span class="cp-badge posture">Doctrine {{ status.activeRaid.recommendedPosture }}</span>
          <span class="cp-raid-countermeasure">{{ status.activeRaid.countermeasure }}</span>
        </div>
      </div>

      <div v-if="responseSquad.length > 0" class="cp-section">
        <div class="cp-label">Response Squad</div>
        <div class="cp-board">
          <div v-for="lane in responseBoard" :key="lane.lane" class="cp-board-card">
            <div class="cp-log-topline">
              <span class="cp-log-kind">{{ lane.lane }}</span>
              <span class="cp-log-time">{{ lane.active }} active / {{ lane.queued }} queued</span>
            </div>
            <div class="cp-log-summary">{{ lane.roles.join(' / ') }}</div>
            <div class="cp-squad-meta">
              <span class="cp-badge" :class="lane.active > 0 ? 'status-active' : 'status-queued'">{{ lane.active > 0 ? 'reserved' : 'staged' }}</span>
              <span class="cp-badge muted">{{ lane.total }} duties</span>
              <span v-if="lane.stages.length > 0" class="cp-badge muted">Stage {{ lane.stages.join(' / ') }}</span>
            </div>
          </div>
        </div>
        <div class="cp-logs">
          <div v-for="job in responseSquad" :key="job.id" class="cp-log-item">
            <div class="cp-log-topline">
              <span class="cp-log-kind">{{ formatJobRole(job) }}</span>
              <span class="cp-log-time">{{ formatJobDuty(job) }}</span>
            </div>
            <div class="cp-log-summary">{{ job.title }}</div>
            <div class="cp-squad-meta">
              <span class="cp-badge" :class="`status-${job.status}`">{{ job.status }}</span>
              <span v-if="formatJobAffinity(job)" class="cp-badge muted">{{ formatJobAffinity(job) }}</span>
              <span v-if="formatJobStage(job)" class="cp-badge muted">{{ formatJobStage(job) }}</span>
              <span v-if="formatJobProgress(job)" class="cp-badge muted">{{ formatJobProgress(job) }}</span>
              <span v-if="formatJobRetry(job)" class="cp-badge muted">{{ formatJobRetry(job) }}</span>
              <span v-if="formatJobCooldown(job)" class="cp-badge muted">{{ formatJobCooldown(job) }}</span>
              <span v-if="formatJobHandoff(job)" class="cp-badge muted">{{ formatJobHandoff(job) }}</span>
              <span v-if="formatJobLane(job)" class="cp-badge muted">Lane {{ formatJobLane(job) }}</span>
              <span v-if="formatJobAssignee(job)" class="cp-badge muted">{{ formatJobAssignee(job) }}</span>
              <span v-if="formatJobExecutor(job)" class="cp-badge muted">{{ formatJobExecutor(job) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="cp-section">
        <div class="cp-label">Injuries</div>
        <div v-if="activeInjuries.length === 0" class="cp-empty">No active injuries.</div>
        <div v-else class="cp-chip-row">
          <span v-for="injury in activeInjuries" :key="injury.id" class="cp-chip" :class="injury.severity">
            {{ injury.label }} / {{ injury.severity }}{{ injury.complication ? ' / ' + formatComplication(injury.complication) : '' }}
          </span>
        </div>
      </div>

      <div class="cp-section">
        <div class="cp-label">Recent Logs</div>
        <div v-if="logs.length === 0" class="cp-empty">No combat logs yet.</div>
        <div v-else class="cp-logs">
          <div v-for="log in logs.slice(0, 4)" :key="log.id" class="cp-log-item">
            <div class="cp-log-topline">
              <span class="cp-log-kind">{{ log.kind }}</span>
              <span class="cp-log-time">{{ formatTime(log.ts) }}</span>
            </div>
            <div class="cp-log-summary">{{ log.summary }}</div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="cp-empty">
      Waiting for combat telemetry.
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CombatLogEntry, CombatStatus, InjuryInfo } from '../composables/useCombat';
import type { JobInfo } from '../composables/useJobs';

const props = defineProps<{
  status: CombatStatus | null;
  logs: CombatLogEntry[];
  jobs: JobInfo[];
  isLoading: boolean;
  actionMessage: string;
  actionError: string;
  setPosture: (posture: 'steady' | 'guarded' | 'fortified') => Promise<boolean>;
  treat: () => Promise<boolean>;
}>();

const activeInjuries = computed(() => (props.status?.injuries ?? []).filter((injury) => injury.active));
const responseSquad = computed(() => props.jobs.filter((job) =>
  ['queued', 'active'].includes(job.status) &&
  typeof job.payload?.responseSquad === 'string' &&
  job.payload.responseSquad === 'wartime'
).slice(0, 6));
const responseBoard = computed(() => {
  const lanes = new Map<string, { lane: string; active: number; queued: number; total: number; roles: string[]; stages: string[] }>();
  for (const job of responseSquad.value) {
    const lane = formatJobLane(job) || 'Unassigned';
    const current = lanes.get(lane) ?? { lane, active: 0, queued: 0, total: 0, roles: [], stages: [] };
    current.total += 1;
    if (job.status === 'active') current.active += 1;
    if (job.status === 'queued') current.queued += 1;
    const role = formatJobRole(job);
    if (!current.roles.includes(role)) current.roles.push(role);
    const stage = rawJobStage(job);
    if (stage && !current.stages.includes(stage)) current.stages.push(stage);
    lanes.set(lane, current);
  }
  return Array.from(lanes.values()).sort((left, right) => {
    if (right.active !== left.active) return right.active - left.active;
    if (right.total !== left.total) return right.total - left.total;
    return left.lane.localeCompare(right.lane);
  });
});
const treating = ref(false);

function barStyle(value: number, max: number): { width: string } {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return { width: `${pct}%` };
}

async function onSetPosture(posture: 'steady' | 'guarded' | 'fortified'): Promise<void> {
  await props.setPosture(posture);
}

async function onTreat(): Promise<void> {
  treating.value = true;
  try {
    await props.treat();
  } finally {
    treating.value = false;
  }
}

function formatTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function payloadText(job: JobInfo, key: string): string {
  const value = job.payload?.[key];
  return typeof value === 'string' ? value : '';
}

function formatJobRole(job: JobInfo): string {
  return payloadText(job, 'role').replace(/_/g, ' ') || job.kind;
}

function formatJobDuty(job: JobInfo): string {
  return payloadText(job, 'duty').replace(/_/g, ' ') || formatTime(job.updatedAt);
}

function formatJobLane(job: JobInfo): string {
  return payloadText(job, 'lane');
}

function formatJobAssignee(job: JobInfo): string {
  const assignee = payloadText(job, 'assignee');
  return assignee ? `Assignee ${assignee.replace(/_/g, ' ')}` : '';
}

function formatJobExecutor(job: JobInfo): string {
  const executor = payloadText(job, 'executor');
  return executor ? `Executor ${executor}` : '';
}

function formatJobAffinity(job: JobInfo): string {
  const affinity = payloadText(job, 'affinity');
  return affinity ? `Affinity ${affinity}` : '';
}

function rawJobStage(job: JobInfo): string {
  return payloadText(job, 'stage').replace(/_/g, ' ');
}

function formatJobStage(job: JobInfo): string {
  const stage = rawJobStage(job);
  return stage ? `Stage ${stage}` : '';
}

function formatJobHandoff(job: JobInfo): string {
  const handoff = payloadText(job, 'handoffRequestedBy');
  return handoff ? `Handoff ${handoff}` : '';
}

function formatJobProgress(job: JobInfo): string {
  const progress = payloadText(job, 'progressHint');
  return progress ? `Progress ${progress}` : '';
}

function formatJobRetry(job: JobInfo): string {
  const retryCount = job.payload?.retryCount;
  const failure = payloadText(job, 'lastExecutionFailure');
  const failedPeers = payloadText(job, 'failedPeerIds');
  if (typeof retryCount === 'number' && retryCount > 0) {
    const peerSuffix = failedPeers ? ` / peers ${failedPeers.split(',').filter(Boolean).length}` : '';
    return failure ? `Retry ${retryCount} / ${failure.replace(/_/g, ' ')}${peerSuffix}` : `Retry ${retryCount}${peerSuffix}`;
  }
  return '';
}

function formatJobCooldown(job: JobInfo): string {
  const retryCooldownUntil = payloadText(job, 'retryCooldownUntil');
  if (retryCooldownUntil) {
    const retryUntil = Date.parse(retryCooldownUntil);
    if (!Number.isNaN(retryUntil) && retryUntil > Date.now()) return 'Retry cooldown';
  }

  const cooldownUntil = payloadText(job, 'handoffCooldownUntil');
  if (!cooldownUntil) return '';
  const until = Date.parse(cooldownUntil);
  if (Number.isNaN(until) || until <= Date.now()) return '';
  return 'Cooldown active';
}

function formatComplication(complication: InjuryInfo['complication']): string {
  if (complication === 'untreated') return 'untreated';
  if (complication === 'chronic_pain') return 'chronic pain';
  return '';
}
</script>

<style scoped>
.combat-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 180px;
  max-height: 340px;
  padding: 14px;
  overflow-y: auto;
}

.cp-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-family: var(--font-display);
  font-size: 0.95rem;
  color: var(--text-strong);
  background: linear-gradient(135deg, rgba(239, 71, 111, 0.18), rgba(255, 122, 89, 0.22));
  box-shadow: var(--shadow-pressed);
}

.cp-live,
.cp-badge {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.62rem;
  font-weight: 800;
  border: 1px solid var(--line-soft);
}

.cp-live {
  color: #0f8f6f;
  background: rgba(6, 214, 160, 0.16);
}

.cp-live.syncing {
  color: #8a5600;
  background: rgba(255, 183, 3, 0.18);
}

.cp-body,
.cp-section,
.cp-logs,
.cp-board {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cp-topline {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.cp-hp-block,
.cp-raid-card,
.cp-log-item,
.cp-empty,
.cp-board-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.cp-label {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.cp-hp-row,
.cp-raid-topline,
.cp-log-topline,
.cp-raid-doctrine {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cp-hp-row strong,
.cp-raid-title,
.cp-log-kind {
  font-size: 0.8rem;
  color: var(--text-strong);
}

.cp-hp-row span,
.cp-log-time,
.cp-raid-meta,
.cp-log-summary,
.cp-raid-summary,
.cp-empty,
.cp-raid-countermeasure {
  font-size: 0.68rem;
  line-height: 1.4;
}

.cp-bar {
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(98, 122, 172, 0.16);
  box-shadow: var(--shadow-pressed);
}

.cp-fill {
  height: 100%;
  border-radius: inherit;
}

.cp-fill.hp {
  background: linear-gradient(90deg, #10c9a8, #49dcb1);
}

.cp-fill.pain {
  background: linear-gradient(90deg, #ffb703, #ef476f);
}

.cp-badges,
.cp-chip-row,
.cp-posture-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cp-badge.status-stable {
  color: #0f8f6f;
  background: rgba(6, 214, 160, 0.18);
}

.cp-badge.status-injured {
  color: #9e6900;
  background: rgba(255, 183, 3, 0.22);
}

.cp-badge.status-critical,
.cp-badge.status-downed,
.cp-badge.status-dead,
.cp-badge.raid {
  color: #a22a4a;
  background: rgba(239, 71, 111, 0.16);
}

.cp-badge.posture,
.cp-badge.risk,
.cp-badge.muted,
.cp-chip {
  color: var(--text-body);
  background: rgba(104, 92, 255, 0.08);
}

.cp-chip.low {
  background: rgba(255, 183, 3, 0.18);
}

.cp-chip.medium {
  background: rgba(255, 159, 28, 0.18);
}

.cp-chip.high,
.cp-chip.fatal {
  background: rgba(239, 71, 111, 0.16);
}

.cp-action-btn {
  border: none;
  border-radius: var(--radius-md);
  padding: 7px 10px;
  color: var(--text-strong);
  font-size: 0.7rem;
  font-weight: 800;
  background: linear-gradient(140deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-clay-soft);
  cursor: pointer;
}

.cp-action-btn:disabled {
  cursor: not-allowed;
  color: var(--text-muted);
  opacity: 0.72;
}

.cp-action-btn.treat {
  color: #a22a4a;
}

.cp-action-feedback {
  padding: 8px 10px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(6, 214, 160, 0.24);
  color: #0f8f6f;
  font-size: 0.68rem;
  line-height: 1.4;
  background: rgba(6, 214, 160, 0.12);
  box-shadow: var(--shadow-pressed);
}

.cp-action-feedback.error {
  border-color: rgba(239, 71, 111, 0.28);
  color: #a22a4a;
  background: rgba(239, 71, 111, 0.1);
}

.cp-raid-countermeasure {
  color: var(--text-body);
  text-align: right;
}

@media (max-width: 760px) {
  .cp-topline {
    grid-template-columns: 1fr;
  }

  .cp-raid-doctrine {
    align-items: start;
    flex-direction: column;
  }
}

.cp-squad-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
</style>