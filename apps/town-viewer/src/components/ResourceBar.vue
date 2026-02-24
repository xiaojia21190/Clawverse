<template>
  <div class="resource-bar">
    <ResourcePill icon="CP" label="compute" :value="r.compute" :max="200" color="#ff7a59" />
    <ResourcePill icon="ST" label="storage" :value="r.storage" :max="200" color="#3abff8" />
    <ResourcePill icon="BW" label="bandwidth" :value="r.bandwidth" :max="200" color="#10c9a8" />
    <ResourcePill icon="RP" label="reputation" :value="r.reputation" :max="200" color="#ffb703" />
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
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
</style>