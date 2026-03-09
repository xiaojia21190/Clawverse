import { ref, onMounted, onUnmounted } from 'vue';

export interface InventoryItemState {
  itemId: string;
  amount: number;
  updatedAt: string;
}

export interface ProductionRecipeInput {
  resources?: Record<string, number>;
  items?: Record<string, number>;
}

export interface ProductionRecipeInfo {
  id: string;
  name: string;
  description: string;
  requiredBuilding: string | null;
  inputs: ProductionRecipeInput;
  output: {
    itemId: string;
    amount: number;
  };
  craftable?: boolean;
  missing?: string[];
}

type InventoryResponse = { items?: InventoryItemState[] } | InventoryItemState[];
type RecipesResponse = { recipes?: ProductionRecipeInfo[] } | ProductionRecipeInfo[];

const POLL_MS = 5000;

function normalizeItems(payload: InventoryResponse): InventoryItemState[] {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.items) ? payload.items : [];
}

function normalizeRecipes(payload: RecipesResponse): ProductionRecipeInfo[] {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.recipes) ? payload.recipes : [];
}

export function useInventory() {
  const items = ref<InventoryItemState[]>([]);
  const recipes = ref<ProductionRecipeInfo[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdatedAt = ref<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refreshInventory(): Promise<string | null> {
    try {
      const res = await fetch('/economy/inventory');
      if (!res.ok) return `Inventory ${res.status}`;
      const data = await res.json() as InventoryResponse;
      items.value = normalizeItems(data);
      return null;
    } catch {
      return 'Inventory unavailable';
    }
  }

  async function refreshRecipes(): Promise<string | null> {
    try {
      const res = await fetch('/economy/recipes');
      if (!res.ok) return `Recipes ${res.status}`;
      const data = await res.json() as RecipesResponse;
      recipes.value = normalizeRecipes(data);
      return null;
    } catch {
      return 'Recipes unavailable';
    }
  }

  async function refresh(): Promise<void> {
    isLoading.value = true;
    const [inventoryError, recipesError] = await Promise.all([
      refreshInventory(),
      refreshRecipes(),
    ]);

    const errors = [inventoryError, recipesError].filter((value): value is string => Boolean(value));
    error.value = errors.length > 0 ? errors.join(' ? ') : null;

    if (errors.length < 2) {
      lastUpdatedAt.value = new Date().toISOString();
    }

    isLoading.value = false;
  }

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, POLL_MS);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return {
    items,
    recipes,
    isLoading,
    error,
    lastUpdatedAt,
    refresh,
  };
}
