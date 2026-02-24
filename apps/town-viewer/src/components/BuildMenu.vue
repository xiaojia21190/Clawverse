<template>
  <div class="build-menu">
    <div class="title">Build Node</div>

    <button
      v-for="b in BUILDINGS"
      :key="b.type"
      class="build-btn"
      :title="b.effect"
      @click="$emit('build', b.type)"
    >
      <span class="glyph">{{ b.glyph }}</span>
      <span class="name">{{ b.label }}</span>
      <span class="cost">C{{ b.cost.compute }} / S{{ b.cost.storage }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
defineEmits<{ build: [string] }>();

const BUILDINGS = [
  { type: 'forge', glyph: 'FG', label: 'Forge', cost: { compute: 30, storage: 20 }, effect: '+2 compute per tick nearby' },
  { type: 'archive', glyph: 'AR', label: 'Archive', cost: { compute: 20, storage: 40 }, effect: '+1 XP nearby' },
  { type: 'beacon', glyph: 'BC', label: 'Beacon', cost: { compute: 25, storage: 15 }, effect: 'Broadcast local position' },
  { type: 'market_stall', glyph: 'MK', label: 'Market Stall', cost: { compute: 15, storage: 25 }, effect: 'Enable distributed trade' },
  { type: 'shelter', glyph: 'SH', label: 'Shelter', cost: { compute: 20, storage: 30 }, effect: 'Reduce mood decay nearby' },
];
</script>

<style scoped>
.build-menu {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px;
}

.title {
  padding: 4px 8px;
  border-radius: var(--radius-md);
  font-family: var(--font-display);
  font-size: 0.86rem;
  color: var(--text-body);
  background: linear-gradient(130deg, rgba(58, 191, 248, 0.2), rgba(255, 183, 3, 0.18));
  box-shadow: var(--shadow-pressed);
}

.build-btn {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 9px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-md);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-clay-soft);
  color: var(--text-strong);
  cursor: pointer;
  text-align: left;
  transition: transform 170ms var(--ease-snap), box-shadow 170ms var(--ease-snap), color 170ms var(--ease-snap);
}

.build-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-float);
  color: var(--accent-coral);
}

.build-btn:active {
  transform: translateY(1px);
  box-shadow: var(--shadow-pressed);
}

.glyph {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-width: 34px;
  padding: 4px 0;
  border-radius: 10px;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--text-strong);
  background: linear-gradient(130deg, rgba(255, 107, 107, 0.24), rgba(58, 191, 248, 0.26));
  box-shadow: var(--shadow-pressed);
}

.name {
  font-size: 0.8rem;
  font-weight: 700;
}

.cost {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--text-muted);
}
</style>