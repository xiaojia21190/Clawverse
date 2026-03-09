<template>
  <div class="inventory-panel">
    <div class="ip-header">
      <span>Inventory</span>
      <div class="ip-header-meta">
        <span class="ip-live" :class="{ syncing: isLoading }">
          {{ isLoading ? 'Syncing' : 'Live' }}
        </span>
        <span v-if="lastUpdatedLabel" class="ip-sync">{{ lastUpdatedLabel }}</span>
      </div>
    </div>

    <div class="ip-section">
      <div class="ip-subtitle">Stockpile</div>

      <div v-if="items.length === 0" class="ip-empty">
        No inventory snapshot yet.
      </div>

      <div v-else class="ip-items">
        <div v-for="item in items" :key="item.itemId" class="ip-item-card">
          <div class="ip-item-topline">
            <span class="ip-item-name">{{ labelName(item.itemId) }}</span>
            <span class="ip-item-amount">x{{ item.amount }}</span>
          </div>
          <div class="ip-item-meta">
            <span>{{ item.itemId }}</span>
            <span>{{ formatTime(item.updatedAt) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="ip-section">
      <div class="ip-subtitle">Production</div>

      <div v-if="recipes.length === 0" class="ip-empty">
        No visible recipes yet.
      </div>

      <div v-else class="ip-recipes">
        <div v-for="recipe in recipes" :key="recipe.id" class="ip-recipe-card">
          <div class="ip-recipe-topline">
            <div class="ip-recipe-copy">
              <div class="ip-recipe-title">{{ recipe.name }}</div>
              <div class="ip-recipe-desc">{{ recipe.description }}</div>
            </div>
            <div class="ip-recipe-badges">
              <span class="ip-building">{{ labelBuilding(recipe.requiredBuilding) }}</span>
              <span
                v-if="typeof recipe.craftable === 'boolean'"
                class="ip-state"
                :class="recipe.craftable ? 'ready' : 'blocked'"
              >
                {{ recipe.craftable ? 'Ready' : 'Blocked' }}
              </span>
            </div>
          </div>

          <div class="ip-io-grid">
            <div class="ip-io-block">
              <div class="ip-io-label">Input</div>
              <div v-if="inputEntries(recipe.inputs).length === 0" class="ip-chip muted">None</div>
              <div v-else class="ip-chip-row">
                <span
                  v-for="entry in inputEntries(recipe.inputs)"
                  :key="`${recipe.id}-${entry.key}`"
                  class="ip-chip"
                  :class="entry.tone"
                >
                  {{ entry.label }}
                </span>
              </div>
            </div>

            <div class="ip-io-block">
              <div class="ip-io-label">Output</div>
              <div class="ip-chip-row">
                <span class="ip-chip output">
                  {{ recipe.output.amount }} x {{ labelName(recipe.output.itemId) }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="recipe.missing?.length" class="ip-missing">
            Missing: {{ recipe.missing.join(' ? ') }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="error" class="ip-error">
      {{ error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { InventoryItemState, ProductionRecipeInfo, ProductionRecipeInput } from '../composables/useInventory';

const props = defineProps<{
  items: InventoryItemState[];
  recipes: ProductionRecipeInfo[];
  isLoading: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
}>();

const lastUpdatedLabel = computed(() => {
  if (!props.lastUpdatedAt) return '';
  const value = new Date(props.lastUpdatedAt);
  if (Number.isNaN(value.getTime())) return props.lastUpdatedAt;
  return `Updated ${value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
});

function labelName(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function labelBuilding(value: string | null): string {
  return value ? `Needs ${labelName(value)}` : 'Portable';
}

function inputEntries(input: ProductionRecipeInput): Array<{ key: string; label: string; tone: 'resource' | 'item' }> {
  const resources = Object.entries(input.resources ?? {}).map(([key, amount]) => ({
    key: `resource-${key}`,
    label: `${amount} ${labelName(key)}`,
    tone: 'resource' as const,
  }));

  const items = Object.entries(input.items ?? {}).map(([key, amount]) => ({
    key: `item-${key}`,
    label: `${amount} x ${labelName(key)}`,
    tone: 'item' as const,
  }));

  return [...resources, ...items];
}

function formatTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.inventory-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 180px;
  max-height: 380px;
  padding: 14px;
  overflow-y: auto;
}

.ip-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-family: var(--font-display);
  font-size: 0.95rem;
  color: var(--text-strong);
  background: linear-gradient(135deg, rgba(255, 182, 74, 0.22), rgba(58, 191, 248, 0.2));
  box-shadow: var(--shadow-pressed);
}

.ip-header-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-ui);
}

.ip-live,
.ip-sync,
.ip-building,
.ip-state {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.62rem;
  font-weight: 800;
  border: 1px solid var(--line-soft);
}

.ip-live {
  color: #0f8f6f;
  background: rgba(6, 214, 160, 0.16);
}

.ip-live.syncing {
  color: #8a5600;
  background: rgba(255, 183, 3, 0.18);
}

.ip-sync {
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.7);
}

.ip-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ip-subtitle {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ip-empty,
.ip-error {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  text-align: center;
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.ip-empty {
  color: var(--text-muted);
}

.ip-error {
  color: var(--accent-coral);
}

.ip-items,
.ip-recipes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ip-item-card,
.ip-recipe-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: linear-gradient(145deg, #ffffff, var(--surface-soft));
  box-shadow: var(--shadow-pressed);
}

.ip-item-topline,
.ip-recipe-topline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.ip-item-name,
.ip-recipe-title {
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--text-strong);
}

.ip-item-amount {
  color: var(--accent-coral);
  font-size: 0.82rem;
  font-weight: 900;
}

.ip-item-meta,
.ip-recipe-desc,
.ip-missing {
  font-size: 0.68rem;
  line-height: 1.4;
}

.ip-item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-muted);
}

.ip-recipe-copy {
  display: grid;
  gap: 4px;
}

.ip-recipe-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.ip-building {
  color: var(--text-body);
  background: rgba(104, 92, 255, 0.08);
}

.ip-state.ready {
  color: #0f8f6f;
  background: rgba(6, 214, 160, 0.18);
}

.ip-state.blocked {
  color: #a22a4a;
  background: rgba(239, 71, 111, 0.16);
}

.ip-recipe-desc {
  color: var(--text-body);
}

.ip-io-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.ip-io-block {
  display: grid;
  gap: 6px;
}

.ip-io-label {
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ip-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ip-chip {
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 0.64rem;
  font-weight: 800;
  border: 1px solid var(--line-soft);
}

.ip-chip.resource {
  color: #2563eb;
  background: rgba(59, 130, 246, 0.14);
}

.ip-chip.item {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.12);
}

.ip-chip.output {
  color: #0f8f6f;
  background: rgba(6, 214, 160, 0.16);
}

.ip-chip.muted {
  color: var(--text-muted);
  background: rgba(148, 163, 184, 0.1);
}

.ip-missing {
  color: var(--accent-coral);
}

@media (max-width: 760px) {
  .inventory-panel {
    max-height: none;
  }

  .ip-header,
  .ip-item-topline,
  .ip-recipe-topline {
    flex-direction: column;
    align-items: stretch;
  }

  .ip-header-meta,
  .ip-recipe-badges {
    justify-content: flex-start;
  }

  .ip-io-grid {
    grid-template-columns: 1fr;
  }
}
</style>
