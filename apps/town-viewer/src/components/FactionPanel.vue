<template>
  <div class="faction-panel">
    <div class="fp-header">Factions</div>

    <div class="fp-create">
      <input v-model.trim="draftName" class="fp-input" type="text" maxlength="32" placeholder="Faction name" />
      <input v-model.trim="draftMotto" class="fp-input" type="text" maxlength="64" placeholder="Faction motto" />
      <button class="fp-btn fp-btn-create" @click="submitCreate">Suggest Founding</button>
    </div>

    <div v-if="factions.length === 0" class="fp-empty">
      No factions yet.
    </div>

    <div v-for="f in factions" :key="f.id" class="fp-card">
      <div class="fp-topline">
        <div class="fp-name">{{ f.name }}</div>
        <div class="fp-stage" :class="stageClass(f.strategic.stage)">{{ labelStage(f.strategic.stage) }}</div>
      </div>
      <div class="fp-motto">"{{ f.motto }}"</div>
      <div class="fp-meta">Agenda: {{ labelAgenda(f.strategic.agenda) }} | {{ f.members.length }} member{{ f.members.length !== 1 ? 's' : '' }}</div>

      <div class="fp-meters">
        <div class="fp-meter">
          <span>Prosperity</span>
          <div class="fp-bar"><div class="fp-fill prosperity" :style="barStyle(f.strategic.prosperity)"></div></div>
          <strong>{{ f.strategic.prosperity }}</strong>
        </div>
        <div class="fp-meter">
          <span>Cohesion</span>
          <div class="fp-bar"><div class="fp-fill cohesion" :style="barStyle(f.strategic.cohesion)"></div></div>
          <strong>{{ f.strategic.cohesion }}</strong>
        </div>
        <div class="fp-meter">
          <span>Influence</span>
          <div class="fp-bar"><div class="fp-fill influence" :style="barStyle(f.strategic.influence)"></div></div>
          <strong>{{ f.strategic.influence }}</strong>
        </div>
        <div class="fp-meter">
          <span>Pressure</span>
          <div class="fp-bar"><div class="fp-fill pressure" :style="barStyle(f.strategic.pressure)"></div></div>
          <strong>{{ f.strategic.pressure }}</strong>
        </div>
      </div>

      <div class="fp-actions">
        <button class="fp-btn fp-btn-ally" @click="$emit('alliance', f.id)">Suggest Alliance</button>
        <button class="fp-btn fp-btn-vassal" @click="$emit('vassalize', f.id)">Suggest Vassalize</button>
        <button class="fp-btn" @click="$emit('join', f.id)">Suggest Join</button>
        <button class="fp-btn fp-btn-leave" @click="$emit('leave', f.id)">Suggest Leave</button>
      </div>
    </div>

    <div v-if="alliances.length > 0" class="fp-alliances-header">Active Alliances</div>
    <div v-for="alliance in alliances" :key="alliance.id" class="fp-alliance">
      <div class="fp-alliance-copy">
        <span class="fp-alliance-label">{{ factionName(alliance.factionA) }} &lt;-&gt; {{ factionName(alliance.factionB) }}</span>
        <span class="fp-alliance-meta">Expires {{ formatAllianceRemaining(alliance.expiresAt) }} | Last renewed {{ formatAllianceStamp(alliance.lastRenewedAt ?? alliance.formedAt) }}</span>
      </div>
      <div class="fp-alliance-actions">
        <button class="fp-btn fp-btn-renew" :disabled="!canRenewAlliance(alliance)" @click="$emit('renew', alliance.id)">Suggest Renew</button>
        <button class="fp-btn fp-btn-break" @click="$emit('break', alliance.id)">Suggest Break</button>
      </div>
    </div>

    <div v-if="vassalages.length > 0" class="fp-vassalages-header">Active Vassalages</div>
    <div v-for="vassalage in vassalages" :key="vassalage.id" class="fp-vassalage">
      <div class="fp-vassalage-copy">
        <span class="fp-vassalage-label">{{ factionName(vassalage.overlordId) }} -&gt; {{ factionName(vassalage.vassalId) }}</span>
        <span class="fp-vassalage-meta">Formed {{ formatAllianceStamp(vassalage.formedAt) }}</span>
      </div>
    </div>

    <div v-if="recentTributes.length > 0" class="fp-tributes-header">Recent Tributes</div>
    <div v-for="tribute in recentTributes" :key="tribute.id" class="fp-tribute">
      <div class="fp-tribute-copy">
        <span class="fp-tribute-label">{{ factionName(tribute.vassalId) }} -&gt; {{ factionName(tribute.overlordId) }}</span>
        <span class="fp-tribute-meta">{{ tribute.amount }} {{ labelTributeResource(tribute.resource) }} | Collected {{ formatTributeStamp(tribute.collectedAt) }}</span>
      </div>
    </div>

    <div v-if="wars.length > 0" class="fp-wars-header">Active Wars</div>
    <div v-for="w in wars" :key="w.id" class="fp-war">
      <span class="fp-war-label">{{ factionName(w.factionA) }} vs {{ factionName(w.factionB) }}</span>
      <button class="fp-btn fp-btn-peace" @click="$emit('peace', w.id)">Suggest Peace</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FactionAllianceInfo, FactionInfo, FactionTributeInfo, FactionVassalageInfo, FactionWarInfo } from '../composables/useFactions';

const props = withDefaults(defineProps<{
  factions: FactionInfo[];
  wars: FactionWarInfo[];
  alliances: FactionAllianceInfo[];
  vassalages: FactionVassalageInfo[];
  tributes?: FactionTributeInfo[];
}>(), {
  tributes: () => [],
});

const emit = defineEmits<{
  create: [{ name: string; motto: string }];
  join: [string];
  alliance: [string];
  vassalize: [string];
  renew: [string];
  break: [string];
  leave: [string];
  peace: [string];
}>();

const draftName = ref('');
const draftMotto = ref('');

const recentTributes = computed(() =>
  [...props.tributes]
    .sort((left, right) => safeStamp(right.collectedAt) - safeStamp(left.collectedAt))
    .slice(0, 6),
);

function factionName(id: string): string {
  return props.factions.find((faction) => faction.id === id)?.name ?? id.slice(0, 8);
}

function labelAgenda(agenda: string): string {
  if (agenda === 'expansion') return 'Expansion';
  if (agenda === 'trade') return 'Trade';
  if (agenda === 'knowledge') return 'Knowledge';
  if (agenda === 'survival') return 'Survival';
  return 'Stability';
}

function labelStage(stage: string): string {
  if (stage === 'dominant') return 'Dominant';
  if (stage === 'rising') return 'Rising';
  if (stage === 'splintering') return 'Splintering';
  return 'Fragile';
}

function stageClass(stage: string): string {
  return `stage-${stage}`;
}

function barStyle(value: number) {
  return { width: `${Math.max(0, Math.min(100, value))}%` };
}

function safeStamp(value: string): number {
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? stamp : 0;
}

function canRenewAlliance(alliance: FactionAllianceInfo): boolean {
  const expiresAt = Date.parse(alliance.expiresAt);
  if (!Number.isFinite(expiresAt)) return false;
  const remainingMs = expiresAt - Date.now();
  return remainingMs > 0 && remainingMs <= 2 * 60 * 60 * 1000;
}

function formatAllianceRemaining(expiresAt: string): string {
  const target = Date.parse(expiresAt);
  if (!Number.isFinite(target)) return 'unknown';
  const remainingMs = target - Date.now();
  if (remainingMs <= 0) return 'expired';
  const totalMinutes = Math.max(1, Math.round(remainingMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `in ${minutes}m`;
  if (minutes === 0) return `in ${hours}h`;
  return `in ${hours}h ${minutes}m`;
}

function formatAllianceStamp(value: string): string {
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return 'unknown';
  return stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function labelTributeResource(resource: FactionTributeInfo['resource']): string {
  if (resource === 'compute') return 'Compute';
  if (resource === 'storage') return 'Storage';
  if (resource === 'bandwidth') return 'Bandwidth';
  return 'Reputation';
}

function formatTributeStamp(value: string): string {
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return 'unknown';
  return stamp.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function submitCreate(): void {
  if (!draftName.value || !draftMotto.value) return;
  emit('create', { name: draftName.value, motto: draftMotto.value });
  draftName.value = '';
  draftMotto.value = '';
}
</script>

<style scoped>
.faction-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  overflow-y: auto;
}

.fp-header, .fp-wars-header {
  position: sticky;
  top: 0;
  z-index: 1;
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-family: var(--font-display);
  font-size: 0.95rem;
  color: var(--text-strong);
  background: linear-gradient(135deg, rgba(239, 71, 111, 0.18), rgba(255, 183, 3, 0.22));
  box-shadow: var(--shadow-pressed);
}

.fp-wars-header {
  margin-top: 8px;
  background: linear-gradient(135deg, rgba(239, 71, 111, 0.28), rgba(255, 122, 89, 0.24));
}

.fp-create {
  display: grid;
  gap: 8px;
  padding: 10px;
  border-radius: var(--radius-md);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.fp-input {
  width: 100%;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm, 6px);
  padding: 8px 10px;
  font-size: 0.72rem;
  color: var(--text-strong);
  background: rgba(255, 255, 255, 0.9);
}

.fp-empty {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  text-align: center;
  font-size: 0.75rem;
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.fp-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.fp-topline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.fp-name {
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text-strong);
}

.fp-stage {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 0.63rem;
  font-weight: 800;
  border: 1px solid var(--line-soft);
}

.stage-fragile {
  color: var(--text-muted);
  background: rgba(130, 130, 130, 0.12);
}

.stage-rising {
  color: #0f8f6f;
  background: rgba(6, 214, 160, 0.18);
}

.stage-dominant {
  color: #8a5600;
  background: rgba(255, 183, 3, 0.22);
}

.stage-splintering {
  color: #a22a4a;
  background: rgba(239, 71, 111, 0.2);
}

.fp-motto {
  font-size: 0.7rem;
  font-style: italic;
  color: var(--text-body);
}

.fp-meta {
  font-size: 0.68rem;
  color: var(--text-muted);
}

.fp-meters {
  display: grid;
  gap: 6px;
  margin-top: 2px;
}

.fp-meter {
  display: grid;
  grid-template-columns: 68px 1fr 28px;
  gap: 8px;
  align-items: center;
  font-size: 0.66rem;
  color: var(--text-body);
}

.fp-bar {
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.06);
}

.fp-fill {
  height: 100%;
  border-radius: 999px;
}

.fp-fill.prosperity {
  background: linear-gradient(90deg, #ffd166, #ff9f1c);
}

.fp-fill.cohesion {
  background: linear-gradient(90deg, #06d6a0, #38bdf8);
}

.fp-fill.influence {
  background: linear-gradient(90deg, #8b5cf6, #ec4899);
}

.fp-fill.pressure {
  background: linear-gradient(90deg, #fb7185, #ef4444);
}

.fp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.fp-btn {
  border: none;
  border-radius: var(--radius-sm, 6px);
  padding: 4px 10px;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-strong);
  background: linear-gradient(140deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-clay-soft, 0 1px 3px rgba(0,0,0,0.1));
  cursor: pointer;
  transition: transform 150ms, box-shadow 150ms;
}

.fp-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-float, 0 2px 6px rgba(0,0,0,0.15));
}

.fp-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
  box-shadow: var(--shadow-pressed);
}

.fp-btn-create {
  color: #0f8f6f;
}

.fp-btn-ally,
.fp-btn-renew,
.fp-btn-vassal {
  color: #2d7ff9;
}

.fp-btn-vassal {
  color: #8b5cf6;
}

.fp-btn-leave {
  color: var(--state-bad, #ef476f);
}

.fp-btn-break {
  color: var(--state-bad, #ef476f);
}

.fp-btn-peace {
  color: var(--state-good, #10c9a8);
}

.fp-alliances-header,
.fp-vassalages-header,
.fp-tributes-header,
.fp-wars-header {
  margin-top: 10px;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.fp-alliance {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(45, 127, 249, 0.18);
  background: linear-gradient(145deg, rgba(45, 127, 249, 0.06), rgba(16, 201, 168, 0.08));
  box-shadow: var(--shadow-pressed);
}

.fp-alliance-copy,
.fp-vassalage-copy,
.fp-tribute-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.fp-alliance-actions {
  display: flex;
  gap: 6px;
}

.fp-alliance-label,
.fp-vassalage-label,
.fp-tribute-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-strong);
}

.fp-alliance-meta,
.fp-vassalage-meta,
.fp-tribute-meta {
  font-size: 0.66rem;
  color: var(--text-muted);
}

.fp-vassalage {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(139, 92, 246, 0.18);
  background: linear-gradient(145deg, rgba(139, 92, 246, 0.07), rgba(255, 183, 3, 0.08));
  box-shadow: var(--shadow-pressed);
}

.fp-tribute {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(6, 214, 160, 0.18);
  background: linear-gradient(145deg, rgba(6, 214, 160, 0.07), rgba(255, 209, 102, 0.09));
  box-shadow: var(--shadow-pressed);
}

.fp-war {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(239, 71, 111, 0.2);
  background: linear-gradient(145deg, rgba(239, 71, 111, 0.05), rgba(255, 122, 89, 0.08));
  box-shadow: var(--shadow-pressed);
}

.fp-war-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-strong);
}

@media (max-width: 760px) {
  .fp-meter {
    grid-template-columns: 60px 1fr 28px;
  }
}
</style>
