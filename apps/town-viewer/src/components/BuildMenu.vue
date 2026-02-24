<template>
  <div class="build-menu">
    <div class="title">🏗 Build</div>
    <button
      v-for="b in BUILDINGS"
      :key="b.type"
      class="build-btn"
      :title="b.effect"
      @click="$emit('build', b.type)"
    >
      {{ b.emoji }} {{ b.label }}
      <span class="cost">⚡{{ b.cost.compute }} 💾{{ b.cost.storage }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
defineEmits<{ build: [string] }>();

const BUILDINGS = [
  { type: 'forge', emoji: '⚒', label: 'Forge', cost: { compute: 30, storage: 20 }, effect: '+2 compute/tick nearby' },
  { type: 'archive', emoji: '📚', label: 'Archive', cost: { compute: 20, storage: 40 }, effect: '+1 XP nearby' },
  { type: 'beacon', emoji: '🔦', label: 'Beacon', cost: { compute: 25, storage: 15 }, effect: 'Broadcast position' },
  { type: 'market_stall', emoji: '🏪', label: 'Market Stall', cost: { compute: 15, storage: 25 }, effect: 'Enable trade anywhere' },
  { type: 'shelter', emoji: '⛺', label: 'Shelter', cost: { compute: 20, storage: 30 }, effect: 'Reduce mood decay nearby' },
];
</script>

<style scoped>
.build-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
}
.title {
  font-size: 12px;
  font-weight: 600;
  color: #8b949e;
  margin-bottom: 4px;
}
.build-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #161b22;
  border: 1px solid #30363d;
  color: #e6edf3;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  text-align: left;
}
.build-btn:hover {
  border-color: #58a6ff;
  background: #1f2a3a;
}
.cost {
  margin-left: auto;
  color: #6e7681;
  font-size: 10px;
}
</style>
