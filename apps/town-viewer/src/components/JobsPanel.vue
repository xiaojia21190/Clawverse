<template>
  <div class="jobs-panel">
    <div class="jp-header">Jobs Queue</div>

    <div v-if="jobs.length === 0" class="jp-empty">
      No queued work yet.
    </div>

    <div v-for="job in jobs.slice(0, 10)" :key="job.id" class="jp-card">
      <div class="jp-topline">
        <div class="jp-title">{{ job.title }}</div>
        <div class="jp-badges">
          <span class="jp-kind">{{ labelKind(job.kind) }}</span>
          <span class="jp-status" :class="statusClass(job.status)">{{ labelStatus(job.status) }}</span>
        </div>
      </div>

      <div class="jp-meta">
        Priority {{ job.priority }} | Updated {{ formatTime(job.updatedAt) }}
      </div>
      <div v-if="roleLabel(job) || dutyLabel(job) || raidSourceLabel(job)" class="jp-duty-row">
        <span v-if="roleLabel(job)" class="jp-duty role">{{ roleLabel(job) }}</span>
        <span v-if="dutyLabel(job)" class="jp-duty">{{ dutyLabel(job) }}</span>
        <span v-if="raidSourceLabel(job)" class="jp-duty source">{{ raidSourceLabel(job) }}</span>
      </div>
      <div v-if="strategicLaneLabel(job) || strategicModeLabel(job) || laneLabel(job) || assigneeLabel(job) || executorLabel(job) || stageLabel(job)" class="jp-duty-row">
        <span v-if="strategicLaneLabel(job)" class="jp-duty strategic">Focus {{ strategicLaneLabel(job) }}</span>
        <span v-if="strategicModeLabel(job)" class="jp-duty strategic-mode">{{ strategicModeLabel(job) }}</span>
        <span v-if="laneLabel(job)" class="jp-duty lane">Lane {{ laneLabel(job) }}</span>
        <span v-if="assigneeLabel(job)" class="jp-duty assignee">Assignee {{ assigneeLabel(job) }}</span>
        <span v-if="executorLabel(job)" class="jp-duty executor">Executor {{ executorLabel(job) }}</span>
        <span v-if="stageLabel(job)" class="jp-duty stage">Stage {{ stageLabel(job) }}</span>
      </div>
      <div v-if="strategicObjectiveLabel(job)" class="jp-strategy">{{ strategicObjectiveLabel(job) }}</div>
      <div v-if="retryLabel(job) || cooldownLabel(job) || peerLabel(job)" class="jp-duty-row">
        <span v-if="retryLabel(job)" class="jp-duty retry">{{ retryLabel(job) }}</span>
        <span v-if="cooldownLabel(job)" class="jp-duty cooldown">{{ cooldownLabel(job) }}</span>
        <span v-if="peerLabel(job)" class="jp-duty peer">{{ peerLabel(job) }}</span>
      </div>
      <div class="jp-reason">{{ job.reason }}</div>
      <div v-if="job.note" class="jp-note">{{ job.note }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { JobInfo, JobKind, JobStatus } from '../composables/useJobs';

defineProps<{
  jobs: JobInfo[];
}>();

function labelKind(kind: JobKind): string {
  if (kind === 'declare_peace') return 'Peace';
  if (kind === 'found_faction') return 'Found';
  if (kind === 'join_faction') return 'Join';
  return kind.charAt(0).toUpperCase() + kind.slice(1).replace('_', ' ');
}

function labelStatus(status: JobStatus): string {
  if (status === 'queued') return 'Queued';
  if (status === 'active') return 'Active';
  if (status === 'done') return 'Done';
  return 'Cancelled';
}

function statusClass(status: JobStatus): string {
  return `status-${status}`;
}

function payloadText(job: JobInfo, key: string): string {
  const value = job.payload?.[key];
  return typeof value === 'string' ? value : '';
}

function roleLabel(job: JobInfo): string {
  const role = payloadText(job, 'role');
  return role ? role.replace(/_/g, ' ') : '';
}

function dutyLabel(job: JobInfo): string {
  const duty = payloadText(job, 'duty');
  return duty ? duty.replace(/_/g, ' ') : '';
}

function raidSourceLabel(job: JobInfo): string {
  const source = payloadText(job, 'raidSource');
  return source ? source.replace(/_/g, ' ') : '';
}

function strategicLaneLabel(job: JobInfo): string {
  const lane = payloadText(job, 'strategicLane');
  return lane ? lane.replace(/_/g, ' ') : '';
}

function strategicModeLabel(job: JobInfo): string {
  const mode = payloadText(job, 'strategicMode');
  return mode ? mode.replace(/_/g, ' ') : '';
}

function strategicObjectiveLabel(job: JobInfo): string {
  return payloadText(job, 'strategicObjective');
}

function laneLabel(job: JobInfo): string {
  return payloadText(job, 'lane');
}

function assigneeLabel(job: JobInfo): string {
  const assignee = payloadText(job, 'assignee');
  return assignee ? assignee.replace(/_/g, ' ') : '';
}

function executorLabel(job: JobInfo): string {
  return payloadText(job, 'executor');
}

function stageLabel(job: JobInfo): string {
  const stage = payloadText(job, 'stage');
  return stage ? stage.replace(/_/g, ' ') : '';
}

function retryLabel(job: JobInfo): string {
  const retryCount = job.payload?.retryCount;
  if (typeof retryCount !== 'number' || retryCount <= 0) return '';
  const failure = payloadText(job, 'lastExecutionFailure');
  return failure ? `Retry ${retryCount} / ${failure.replace(/_/g, ' ')}` : `Retry ${retryCount}`;
}

function cooldownLabel(job: JobInfo): string {
  const retryCooldownUntil = payloadText(job, 'retryCooldownUntil');
  if (retryCooldownUntil) {
    const retryUntil = Date.parse(retryCooldownUntil);
    if (!Number.isNaN(retryUntil) && retryUntil > Date.now()) return 'Retry cooldown';
  }

  const handoffCooldownUntil = payloadText(job, 'handoffCooldownUntil');
  if (handoffCooldownUntil) {
    const handoffUntil = Date.parse(handoffCooldownUntil);
    if (!Number.isNaN(handoffUntil) && handoffUntil > Date.now()) return 'Handoff cooldown';
  }

  return '';
}

function peerLabel(job: JobInfo): string {
  const failedPeers = payloadText(job, 'failedPeerIds');
  if (!failedPeers) return '';
  return `Failed peers ${failedPeers.split(',').filter(Boolean).length}`;
}

function formatTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.jobs-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  overflow-y: auto;
  min-height: 140px;
  max-height: 260px;
}

.jp-header {
  position: sticky;
  top: 0;
  z-index: 1;
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-family: var(--font-display);
  font-size: 0.95rem;
  color: var(--text-strong);
  background: linear-gradient(135deg, rgba(104, 92, 255, 0.18), rgba(56, 189, 248, 0.2));
  box-shadow: var(--shadow-pressed);
}

.jp-empty {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  text-align: center;
  font-size: 0.75rem;
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.jp-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.jp-topline {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.jp-title {
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--text-strong);
}

.jp-badges {
  display: flex;
  gap: 6px;
  align-items: center;
}

.jp-kind,
.jp-status {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.62rem;
  font-weight: 800;
  border: 1px solid var(--line-soft);
}

.jp-kind {
  color: var(--text-body);
  background: rgba(104, 92, 255, 0.08);
}

.jp-status.status-queued {
  color: #8a5600;
  background: rgba(255, 183, 3, 0.18);
}

.jp-status.status-active {
  color: #0f8f6f;
  background: rgba(6, 214, 160, 0.18);
}

.jp-status.status-done {
  color: #2563eb;
  background: rgba(59, 130, 246, 0.14);
}

.jp-status.status-cancelled {
  color: #a22a4a;
  background: rgba(239, 71, 111, 0.16);
}

.jp-meta,
.jp-strategy,
.jp-reason,
.jp-note,
.jp-duty {
  font-size: 0.68rem;
  line-height: 1.4;
}

.jp-meta {
  color: var(--text-muted);
}

.jp-strategy {
  color: var(--text-strong);
}

.jp-duty-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.jp-duty {
  border-radius: 999px;
  padding: 2px 8px;
  color: var(--text-body);
  background: rgba(104, 92, 255, 0.08);
}

.jp-duty.role {
  color: #0f8f6f;
  background: rgba(6, 214, 160, 0.16);
}

.jp-duty.source {
  color: #9e6900;
  background: rgba(255, 183, 3, 0.18);
}

.jp-duty.lane {
  color: #2563eb;
  background: rgba(59, 130, 246, 0.14);
}

.jp-duty.strategic {
  color: #b45309;
  background: rgba(245, 158, 11, 0.16);
}

.jp-duty.strategic-mode {
  color: #0f766e;
  background: rgba(20, 184, 166, 0.14);
}

.jp-duty.assignee {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.14);
}

.jp-duty.executor {
  color: #b45309;
  background: rgba(245, 158, 11, 0.16);
}

.jp-duty.stage {
  color: #0f766e;
  background: rgba(20, 184, 166, 0.14);
}

.jp-duty.retry {
  color: #7c2d12;
  background: rgba(249, 115, 22, 0.14);
}

.jp-duty.cooldown {
  color: #475569;
  background: rgba(100, 116, 139, 0.14);
}

.jp-duty.peer {
  color: #1d4ed8;
  background: rgba(59, 130, 246, 0.14);
}

.jp-reason {
  color: var(--text-body);
}

.jp-note {
  color: var(--accent-coral);
}
</style>

