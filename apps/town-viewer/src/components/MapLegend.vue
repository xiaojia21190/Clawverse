<template>
  <aside class="legend">
    <div class="legend-header">
      <div>
        <div class="legend-kicker">Map Semantics</div>
        <div class="legend-title">Sector Intel</div>
      </div>
      <span class="legend-badge">{{ buildingCount }} structures</span>
    </div>

    <div class="legend-section">
      <div class="legend-section-label">Zones</div>
      <div class="legend-zone-list">
        <div v-for="zone in zones" :key="zone.name" class="legend-zone-item">
          <span class="legend-swatch" :style="{ background: zone.color }"></span>
          <div class="legend-copy">
            <div class="legend-name">{{ zone.name }}</div>
            <div class="legend-text">{{ zone.effect }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="legend-section">
      <div class="legend-section-label">Signals</div>
      <div class="legend-chip-row">
        <span class="legend-chip">Relations {{ relationMode ? 'On' : 'Off' }}</span>
        <span class="legend-chip">{{ selectedPeerName ? `Tracked ${selectedPeerName}` : 'No target' }}</span>
      </div>
      <div class="legend-chip-row building-row">
        <span v-for="building in buildings" :key="building.key" class="legend-chip subtle">
          {{ building.icon }} {{ building.label }}
        </span>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
defineProps<{
  relationMode: boolean;
  selectedPeerName: string | null;
  buildingCount: number;
}>();

const zones = [
  { name: 'Plaza', color: '#6b7280', effect: 'spawn and public visibility' },
  { name: 'Market', color: '#d97706', effect: 'trade and bandwidth efficiency' },
  { name: 'Library', color: '#0f766e', effect: 'social and analyst growth' },
  { name: 'Workshop', color: '#2563eb', effect: 'build and collab momentum' },
  { name: 'Park', color: '#16a34a', effect: 'wander relief and mood recovery' },
  { name: 'Tavern', color: '#9333ea', effect: 'social recovery and relation gain' },
  { name: 'Residential', color: '#475569', effect: 'rest and slower decay' },
];

const buildings = [
  { key: 'forge', icon: 'F', label: 'Forge' },
  { key: 'archive', icon: 'A', label: 'Archive' },
  { key: 'beacon', icon: 'B', label: 'Beacon' },
  { key: 'market', icon: 'M', label: 'Market Stall' },
  { key: 'shelter', icon: 'H', label: 'Shelter' },
  { key: 'watchtower', icon: 'W', label: 'Watchtower' },
];
</script>

<style scoped>
.legend,
.legend-section,
.legend-zone-list,
.legend-zone-item,
.legend-copy,
.legend-chip-row {
  display: grid;
  gap: 8px;
}

.legend {
  min-width: 290px;
  max-width: 320px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, rgba(10, 16, 28, 0.9), rgba(17, 24, 39, 0.88));
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.32);
  backdrop-filter: blur(14px);
}

.legend-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.legend-kicker,
.legend-section-label {
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(191, 219, 254, 0.72);
}

.legend-title,
.legend-name {
  font-size: 0.78rem;
  font-weight: 800;
  color: #f8fafc;
}

.legend-text {
  font-size: 0.66rem;
  line-height: 1.4;
  color: rgba(226, 232, 240, 0.72);
}

.legend-badge,
.legend-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  font-size: 0.65rem;
  font-weight: 700;
  color: #dbeafe;
  background: rgba(59, 130, 246, 0.12);
}

.legend-chip.subtle {
  background: rgba(148, 163, 184, 0.12);
  color: rgba(226, 232, 240, 0.82);
}

.legend-zone-item {
  grid-template-columns: auto 1fr;
  align-items: start;
}

.legend-swatch {
  width: 10px;
  height: 10px;
  margin-top: 5px;
  border-radius: 999px;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.04);
}

.building-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 960px) {
  .legend {
    min-width: 0;
    max-width: none;
  }
}
</style>
