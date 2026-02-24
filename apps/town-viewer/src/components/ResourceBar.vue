<template>
  <div class="resource-bar">
    <ResourcePill icon="⚡" label="compute" :value="r.compute" :max="200" color="#f0883e" />
    <ResourcePill icon="💾" label="storage" :value="r.storage" :max="200" color="#58a6ff" />
    <ResourcePill icon="🌐" label="bandwidth" :value="r.bandwidth" :max="200" color="#3fb950" />
    <ResourcePill icon="🪙" label="reputation" :value="r.reputation" :max="200" color="#d29922" />
  </div>
</template>

<script setup lang="ts">
import ResourcePill from './ResourcePill.vue';
import type { ResourceState } from '../composables/useEconomy';

defineProps<{ r: ResourceState }>();
</script>

<style scoped>
.resource-bar {
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
