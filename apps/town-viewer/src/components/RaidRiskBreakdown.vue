<template>
  <section class="risk-panel">
    <div class="risk-header">
      <div>
        <div class="risk-kicker">Combat Doctrine</div>
        <div class="risk-title">Raid Risk Breakdown</div>
      </div>
      <div class="risk-score" :class="riskTone">Risk {{ status?.raidRisk ?? 0 }}</div>
    </div>

    <div v-if="status?.activeRaid" class="risk-flash">
      <div class="risk-flash-title">{{ status.activeRaid.severity }} raid pressure is live</div>
      <div class="risk-flash-copy">{{ status.activeRaid.summary }}</div>
      <div class="risk-flash-meta">
        <span>{{ status.activeRaid.source }}</span>
        <span>{{ status.activeRaid.objective }}</span>
        <span>Doctrine {{ status.activeRaid.recommendedPosture }}</span>
      </div>
    </div>

    <div class="risk-summary-grid">
      <div class="risk-summary-card">
        <span>Wars</span>
        <strong>{{ activeWarCount }}</strong>
        <small>{{ activeWarCount > 0 ? 'Open fronts keep raids plausible.' : 'No active war fronts.' }}</small>
      </div>
      <div class="risk-summary-card">
        <span>Defense Net</span>
        <strong>{{ defenseCoverage }}</strong>
        <small>{{ watchtowerCount }} watch / {{ beaconCount }} beacon / {{ shelterCount }} shelter</small>
      </div>
      <div class="risk-summary-card">
        <span>Civil Strain</span>
        <strong>{{ criticalNeedCount }}</strong>
        <small>{{ criticalNeedCount > 0 ? 'Needs are competing with defense focus.' : 'No immediate need collapse.' }}</small>
      </div>
    </div>

    <div class="risk-factor-list">
      <article v-for="factor in factorRows" :key="factor.id" class="risk-factor-card" :class="[factor.kind, factor.tone]">
        <div class="risk-factor-topline">
          <span>{{ factor.label }}</span>
          <strong>{{ factor.kind === 'risk' ? '+' : '-' }}{{ factor.value }}</strong>
        </div>
        <div class="risk-factor-copy">{{ factor.detail }}</div>
        <div class="risk-factor-track">
          <div class="risk-factor-fill" :class="[factor.kind, factor.tone]" :style="{ width: `${factor.fill}%` }"></div>
        </div>
      </article>
    </div>

    <div class="risk-footer">
      <span>Net pressure {{ netPressure >= 0 ? '+' : '' }}{{ netPressure }}</span>
      <span v-if="focusLabel">Focus {{ focusLabel }}</span>
      <span>{{ postureGuidance }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CombatStatus } from '../composables/useCombat';
import type { ResourceState } from '../composables/useEconomy';
import type { Building } from '../composables/useWorldMap';

interface FactorRow {
  id: string;
  label: string;
  detail: string;
  value: number;
  fill: number;
  kind: 'risk' | 'mitigation';
  tone: 'steady' | 'watch' | 'critical';
}

const props = withDefaults(defineProps<{
  status: CombatStatus | null;
  tension: number;
  activeWarCount: number;
  criticalNeedCount: number;
  resources: ResourceState | null;
  buildings: Building[];
  focusLabel?: string;
}>(), {
  focusLabel: '',
});

const buildingCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const building of props.buildings) {
    counts.set(building.type, (counts.get(building.type) ?? 0) + 1);
  }
  return counts;
});

const shelterCount = computed(() => buildingCounts.value.get('shelter') ?? 0);
const beaconCount = computed(() => buildingCounts.value.get('beacon') ?? 0);
const watchtowerCount = computed(() => buildingCounts.value.get('watchtower') ?? 0);
const defenseCoverage = computed(() => shelterCount.value + beaconCount.value + watchtowerCount.value);

const postureMitigation = computed(() => {
  const posture = props.status?.posture ?? 'steady';
  if (posture === 'fortified') return 18;
  if (posture === 'guarded') return 10;
  return 2;
});

const tensionPressure = computed(() => Math.round(Math.max(0, props.tension) * 0.34));
const warPressure = computed(() => Math.min(30, props.activeWarCount * 12));
const computePressure = computed(() => {
  const compute = props.resources?.compute ?? 100;
  return compute >= 45 ? 0 : Math.round((45 - compute) * 1.2);
});
const bandwidthPressure = computed(() => {
  const bandwidth = props.resources?.bandwidth ?? 100;
  return bandwidth >= 40 ? 0 : Math.round((40 - bandwidth) * 0.9);
});
const civilPressure = computed(() => Math.min(24, props.criticalNeedCount * 6));
const shelterMitigation = computed(() => Math.min(12, shelterCount.value * 4));
const beaconMitigation = computed(() => Math.min(10, beaconCount.value * 5));
const watchMitigation = computed(() => Math.min(16, watchtowerCount.value * 6));

const factorRows = computed<FactorRow[]>(() => {
  const rows: FactorRow[] = [
    makeRisk('tension', 'Tension Curve', tensionPressure.value, `${props.tension} storyteller pressure is driving raid probability.`),
    makeRisk('wars', 'War Pressure', warPressure.value, props.activeWarCount > 0 ? `${props.activeWarCount} active conflicts expand hostile intent.` : 'No active faction wars are feeding raids.'),
    makeRisk('compute', 'Compute Reserve', computePressure.value, props.resources ? `Compute is at ${Math.round(props.resources.compute)}.` : 'Resource telemetry unavailable.'),
    makeRisk('bandwidth', 'Bandwidth Lanes', bandwidthPressure.value, props.resources ? `Bandwidth is at ${Math.round(props.resources.bandwidth)}.` : 'Resource telemetry unavailable.'),
    makeRisk('civil', 'Civil Strain', civilPressure.value, props.criticalNeedCount > 0 ? `${props.criticalNeedCount} critical needs are pulling attention away from defense.` : 'Needs are not adding extra raid exposure.'),
    makeMitigation('posture', 'Posture Doctrine', postureMitigation.value, `Current posture ${props.status?.posture ?? 'steady'} offsets part of the risk.`),
    makeMitigation('shelter', 'Shelter Net', shelterMitigation.value, `${shelterCount.value} shelters absorb raid fallout and recovery load.`),
    makeMitigation('beacon', 'Beacon Relay', beaconMitigation.value, `${beaconCount.value} beacons improve warning and coordination.`),
    makeMitigation('watch', 'Watch Coverage', watchMitigation.value, `${watchtowerCount.value} watchtowers project deterrence and visibility.`),
  ];

  return rows.filter((row) => row.value > 0).sort((left, right) => right.value - left.value);
});

const netPressure = computed(() => {
  const risks = factorRows.value.filter((row) => row.kind === 'risk').reduce((sum, row) => sum + row.value, 0);
  const mitigations = factorRows.value.filter((row) => row.kind === 'mitigation').reduce((sum, row) => sum + row.value, 0);
  return risks - mitigations;
});

const riskTone = computed(() => {
  const risk = props.status?.raidRisk ?? 0;
  if (risk >= 75) return 'critical';
  if (risk >= 40) return 'watch';
  return 'steady';
});

const postureGuidance = computed(() => {
  if (props.status?.activeRaid) return props.status.activeRaid.countermeasure;
  if ((props.status?.raidRisk ?? 0) >= 70) return 'Escalate posture and keep the response squad warm.';
  if ((props.status?.raidRisk ?? 0) >= 40) return 'Guard lanes and keep shelter coverage ready.';
  return 'Defense posture is holding for now.';
});

function makeRisk(id: string, label: string, value: number, detail: string): FactorRow {
  return {
    id,
    label,
    detail,
    value,
    fill: clamp(value * 4, 8, 100),
    kind: 'risk',
    tone: toneFor(value),
  };
}

function makeMitigation(id: string, label: string, value: number, detail: string): FactorRow {
  return {
    id,
    label,
    detail,
    value,
    fill: clamp(value * 5, 8, 100),
    kind: 'mitigation',
    tone: toneFor(value),
  };
}

function toneFor(value: number): 'steady' | 'watch' | 'critical' {
  if (value >= 20) return 'critical';
  if (value >= 10) return 'watch';
  return 'steady';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
</script>

<style scoped>
.risk-panel,
.risk-summary-grid,
.risk-factor-list {
  display: grid;
  gap: 10px;
}

.risk-panel {
  min-height: 180px;
  max-height: 320px;
  padding: 14px;
  overflow-y: auto;
}

.risk-header,
.risk-factor-topline,
.risk-footer,
.risk-flash-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.risk-kicker,
.risk-summary-card span,
.risk-factor-topline span,
.risk-footer {
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.risk-title {
  margin-top: 2px;
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--text-strong);
}

.risk-score {
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  padding: 4px 10px;
  font-size: 0.68rem;
  font-weight: 800;
}

.risk-score.steady {
  color: #0f766e;
  background: rgba(15, 118, 110, 0.12);
}

.risk-score.watch {
  color: #9a6700;
  background: rgba(202, 138, 4, 0.14);
}

.risk-score.critical {
  color: #b42343;
  background: rgba(220, 38, 38, 0.14);
}

.risk-flash,
.risk-summary-card,
.risk-factor-card {
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, 0.72);
}

.risk-flash {
  display: grid;
  gap: 6px;
  border-color: rgba(220, 38, 38, 0.18);
  background: linear-gradient(180deg, rgba(254, 242, 242, 0.96), rgba(255, 247, 237, 0.94));
}

.risk-flash-title,
.risk-summary-card strong,
.risk-factor-topline strong {
  font-size: 0.84rem;
  font-weight: 800;
  color: var(--text-strong);
}

.risk-flash-copy,
.risk-factor-copy,
.risk-summary-card small {
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--text-body);
}

.risk-flash-meta {
  flex-wrap: wrap;
  justify-content: flex-start;
  font-size: 0.66rem;
  color: var(--text-muted);
}

.risk-summary-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.risk-factor-card {
  display: grid;
  gap: 8px;
}

.risk-factor-card.risk.critical,
.risk-factor-card.risk.watch {
  border-color: rgba(220, 38, 38, 0.16);
}

.risk-factor-card.mitigation {
  border-color: rgba(15, 118, 110, 0.16);
}

.risk-factor-track {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.16);
}

.risk-factor-fill {
  height: 100%;
  border-radius: inherit;
}

.risk-factor-fill.risk.steady {
  background: linear-gradient(90deg, rgba(251, 191, 36, 0.9), rgba(245, 158, 11, 0.9));
}

.risk-factor-fill.risk.watch,
.risk-factor-fill.risk.critical {
  background: linear-gradient(90deg, rgba(251, 146, 60, 0.9), rgba(239, 68, 68, 0.9));
}

.risk-factor-fill.mitigation {
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.9), rgba(56, 189, 248, 0.9));
}

.risk-footer {
  flex-wrap: wrap;
  justify-content: space-between;
}

@media (max-width: 960px) {
  .risk-summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
