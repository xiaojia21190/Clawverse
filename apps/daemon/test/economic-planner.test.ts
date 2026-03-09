import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResourceState } from '@clawverse/types';
import { ECONOMIC_AUTONOMY_KEYS, planEconomicAutonomy } from '../src/economic-planner.js';

const healthyResources: ResourceState = {
  compute: 80,
  storage: 80,
  bandwidth: 60,
  reputation: 10,
  updatedAt: new Date().toISOString(),
};

test('planner adds market stall infrastructure when low resources lack trade access', () => {
  const duties = planEconomicAutonomy({
    needs: { social: 80, tasked: 80, creative: 80 },
    resources: { ...healthyResources, compute: 16, bandwidth: 12 },
    zone: 'Residential',
    hasTradeAccess: false,
    ownedBuildings: [],
    relayPatches: 0,
    dataShards: 0,
    alloyFrames: 0,
    activeWar: false,
    activeRaid: false,
    raidRisk: 22,
    knownPeerCount: 1,
    canAffordBuilding: (type) => type === 'market_stall',
    canCraftRecipe: () => false,
  });

  assert.ok(ECONOMIC_AUTONOMY_KEYS.includes('autonomy-build-market-stall'));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-build-market-stall' && duty.kind === 'build'));
  assert.ok(!duties.some((duty) => duty.dedupeKey === 'autonomy-survival-trade'));
});

test('planner builds production infrastructure for wartime relay reserves', () => {
  const duties = planEconomicAutonomy({
    needs: { social: 80, tasked: 80, creative: 80 },
    resources: healthyResources,
    zone: 'Residential',
    hasTradeAccess: true,
    ownedBuildings: [],
    relayPatches: 0,
    dataShards: 0,
    alloyFrames: 0,
    activeWar: true,
    activeRaid: false,
    raidRisk: 64,
    knownPeerCount: 2,
    canAffordBuilding: (type) => type === 'archive' || type === 'forge',
    canCraftRecipe: () => false,
  });

  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-build-archive'));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-build-forge'));
});

test('planner crafts relay patch once reserve components are ready', () => {
  const duties = planEconomicAutonomy({
    needs: { social: 80, tasked: 80, creative: 80 },
    resources: healthyResources,
    zone: 'Residential',
    hasTradeAccess: true,
    ownedBuildings: ['archive', 'forge'],
    relayPatches: 0,
    dataShards: 1,
    alloyFrames: 1,
    activeWar: true,
    activeRaid: false,
    raidRisk: 67,
    knownPeerCount: 2,
    canAffordBuilding: () => false,
    canCraftRecipe: (recipeId) => recipeId === 'relay_patch',
  });

  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-craft-relay-patch' && duty.kind === 'craft'));
});

test('planner trades storage overflow into reputation when strategic stock is imbalanced', () => {
  const duties = planEconomicAutonomy({
    needs: { social: 80, tasked: 80, creative: 80 },
    resources: { ...healthyResources, storage: 170, reputation: 6 },
    zone: 'Market',
    hasTradeAccess: true,
    ownedBuildings: ['market_stall'],
    relayPatches: 0,
    dataShards: 0,
    alloyFrames: 0,
    activeWar: false,
    activeRaid: false,
    raidRisk: 18,
    knownPeerCount: 3,
    canAffordBuilding: () => false,
    canCraftRecipe: () => false,
  });

  assert.ok(ECONOMIC_AUTONOMY_KEYS.includes('autonomy-surplus-trade'));
  assert.ok(duties.some((duty) =>
    duty.dedupeKey === 'autonomy-surplus-trade'
    && duty.kind === 'trade'
    && duty.payload.offerResource === 'storage'
    && duty.payload.wantResource === 'reputation'));
});

test('planner builds market stall for overflow routing when no trade access exists', () => {
  const duties = planEconomicAutonomy({
    needs: { social: 80, tasked: 80, creative: 80 },
    resources: { ...healthyResources, storage: 168, reputation: 5 },
    zone: 'Residential',
    hasTradeAccess: false,
    ownedBuildings: [],
    relayPatches: 0,
    dataShards: 0,
    alloyFrames: 0,
    activeWar: false,
    activeRaid: false,
    raidRisk: 16,
    knownPeerCount: 1,
    canAffordBuilding: (type) => type === 'market_stall',
    canCraftRecipe: () => false,
  });

  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-build-market-stall' && duty.kind === 'build'));
  assert.ok(!duties.some((duty) => duty.dedupeKey === 'autonomy-surplus-trade'));
});

test('planner trades compute surplus into bandwidth deficit without emergency scarcity', () => {
  const duties = planEconomicAutonomy({
    needs: { social: 80, tasked: 80, creative: 80 },
    resources: { ...healthyResources, compute: 110, bandwidth: 38, reputation: 20 },
    zone: 'Market',
    hasTradeAccess: true,
    ownedBuildings: ['market_stall'],
    relayPatches: 0,
    dataShards: 0,
    alloyFrames: 0,
    activeWar: false,
    activeRaid: false,
    raidRisk: 26,
    knownPeerCount: 4,
    canAffordBuilding: () => false,
    canCraftRecipe: () => false,
  });

  assert.ok(duties.some((duty) =>
    duty.dedupeKey === 'autonomy-surplus-trade'
    && duty.payload.offerResource === 'compute'
    && duty.payload.wantResource === 'bandwidth'));
  assert.ok(!duties.some((duty) => duty.dedupeKey === 'autonomy-survival-trade'));
});

test('planner raises relay reserve target under severe raid pressure', () => {
  const duties = planEconomicAutonomy({
    needs: { social: 80, tasked: 80, creative: 80 },
    resources: healthyResources,
    zone: 'Residential',
    hasTradeAccess: true,
    ownedBuildings: ['archive', 'forge'],
    relayPatches: 2,
    dataShards: 1,
    alloyFrames: 1,
    activeWar: false,
    activeRaid: false,
    raidRisk: 86,
    knownPeerCount: 7,
    canAffordBuilding: () => false,
    canCraftRecipe: (recipeId) => recipeId === 'relay_patch',
  });

  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-craft-relay-patch' && duty.kind === 'craft'));
});

test('planner expands reserve infrastructure for crowded high-risk frontier', () => {
  const duties = planEconomicAutonomy({
    needs: { social: 80, tasked: 80, creative: 80 },
    resources: healthyResources,
    zone: 'Residential',
    hasTradeAccess: true,
    ownedBuildings: [],
    relayPatches: 1,
    dataShards: 0,
    alloyFrames: 0,
    activeWar: false,
    activeRaid: false,
    raidRisk: 71,
    knownPeerCount: 6,
    canAffordBuilding: (type) => type === 'archive' || type === 'forge',
    canCraftRecipe: () => false,
  });

  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-build-archive'));
  assert.ok(duties.some((duty) => duty.dedupeKey === 'autonomy-build-forge'));
});