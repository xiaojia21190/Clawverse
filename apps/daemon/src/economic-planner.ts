import type { BuildingType, ResourceState } from '@clawverse/types';

export interface EconomicNeedState {
  social: number;
  tasked: number;
  creative: number;
}

export interface EconomicAutonomyDuty {
  dedupeKey: string;
  kind: 'move' | 'build' | 'trade' | 'craft';
  title: string;
  reason: string;
  priority: number;
  payload: Record<string, unknown>;
  sourceEventType: string;
}

export interface EconomicPlannerInput {
  needs: EconomicNeedState;
  resources: ResourceState;
  zone: string;
  hasTradeAccess: boolean;
  ownedBuildings: BuildingType[];
  relayPatches: number;
  dataShards: number;
  alloyFrames: number;
  activeWar: boolean;
  activeRaid: boolean;
  raidRisk: number;
  knownPeerCount: number;
  canAffordBuilding: (type: BuildingType) => boolean;
  canCraftRecipe: (recipeId: 'data_shard' | 'alloy_frame' | 'relay_patch') => boolean;
}

type TradeResource = 'compute' | 'storage' | 'bandwidth' | 'reputation';

export const ECONOMIC_AUTONOMY_KEYS = [
  'autonomy-survival-trade',
  'autonomy-surplus-trade',
  'autonomy-build-market-stall',
  'autonomy-build-archive',
  'autonomy-build-forge',
  'autonomy-move-tavern',
  'autonomy-craft-data-shard',
  'autonomy-craft-alloy-frame',
  'autonomy-craft-relay-patch',
] as const;

const SURPLUS_TRADE_TARGETS: Record<'compute' | 'bandwidth' | 'reputation', number> = {
  compute: 68,
  bandwidth: 54,
  reputation: 18,
};

function lowCoreResources(resources: ResourceState): boolean {
  return resources.compute <= 20 || resources.bandwidth <= 15;
}

function strainedCoreResources(resources: ResourceState): boolean {
  return resources.compute <= 32 || resources.bandwidth <= 24;
}

function storageOverflow(resources: ResourceState): boolean {
  return resources.storage >= 150;
}

function desiredRelayPatchStock(input: EconomicPlannerInput): number {
  let target = 0;

  if (strainedCoreResources(input.resources)) {
    target = Math.max(target, 1);
  }
  if (input.activeWar || input.raidRisk >= 58) {
    target = Math.max(target, 2);
  }
  if (input.activeRaid || input.raidRisk >= 82) {
    target = Math.max(target, 3);
  }
  if (input.knownPeerCount >= 6 && (input.activeWar || input.raidRisk >= 68)) {
    target = Math.max(target, 3);
  }

  return Math.min(3, target);
}

function tradeDuty(input: EconomicPlannerInput): EconomicAutonomyDuty {
  const wantResource = input.resources.compute <= input.resources.bandwidth ? 'compute' : 'bandwidth';
  const offerResource = wantResource === 'compute'
    ? (input.resources.bandwidth >= input.resources.reputation ? 'bandwidth' : 'reputation')
    : (input.resources.compute >= input.resources.reputation ? 'compute' : 'reputation');
  const offerAmount = offerResource === 'reputation' ? 8 : wantResource === 'compute' ? 10 : 8;
  const wantAmount = wantResource === 'compute' ? 12 : 10;
  return {
    dedupeKey: 'autonomy-survival-trade',
    kind: 'trade',
    title: 'Rebuild critical resources',
    reason: 'Core resources are strained, queue a stabilizing trade that targets the most depleted lane.',
    priority: 92,
    payload: {
      offerResource,
      wantResource,
      offerAmount,
      wantAmount,
      targetZone: 'Market',
    },
    sourceEventType: 'resource_drought',
  };
}

function marketInfrastructureNeeded(input: EconomicPlannerInput): boolean {
  if (input.hasTradeAccess) return false;
  if (input.ownedBuildings.includes('market_stall')) return false;
  return lowCoreResources(input.resources) || storageOverflow(input.resources) || hasSurplusTradeOpportunity(input);
}

function hasSurplusTradeOpportunity(input: EconomicPlannerInput): boolean {
  return selectSurplusTradeTemplate(input) !== null;
}

function selectSurplusTradeTemplate(input: EconomicPlannerInput): {
  offerResource: TradeResource;
  wantResource: TradeResource;
  offerAmount: number;
  wantAmount: number;
} | null {
  const deficits = (Object.entries(SURPLUS_TRADE_TARGETS) as Array<[keyof typeof SURPLUS_TRADE_TARGETS, number]>)
    .map(([resource, target]) => ({ resource, deficit: target - input.resources[resource] }))
    .filter((entry) => entry.deficit > 0)
    .sort((left, right) => right.deficit - left.deficit);

  if (deficits.length === 0) return null;

  const wantResource = deficits[0].resource;

  const surplusCandidates: Array<{
    resource: TradeResource;
    surplus: number;
    offerAmount: number;
    wantAmount: number;
  }> = [];

  const storageSurplus = input.resources.storage - 140;
  if (storageSurplus >= 12) {
    surplusCandidates.push({
      resource: 'storage',
      surplus: storageSurplus,
      offerAmount: 12,
      wantAmount: wantResource === 'reputation' ? 8 : 12,
    });
  }

  if (wantResource !== 'compute') {
    const computeSurplus = input.resources.compute - 92;
    if (computeSurplus >= 10) {
      surplusCandidates.push({
        resource: 'compute',
        surplus: computeSurplus,
        offerAmount: 10,
        wantAmount: wantResource === 'reputation' ? 8 : 10,
      });
    }
  }

  if (wantResource !== 'bandwidth') {
    const bandwidthSurplus = input.resources.bandwidth - 82;
    if (bandwidthSurplus >= 10) {
      surplusCandidates.push({
        resource: 'bandwidth',
        surplus: bandwidthSurplus,
        offerAmount: 10,
        wantAmount: wantResource === 'reputation' ? 8 : 10,
      });
    }
  }

  if (surplusCandidates.length === 0) return null;

  surplusCandidates.sort((left, right) => {
    if (left.resource === 'storage' && right.resource !== 'storage') return -1;
    if (right.resource === 'storage' && left.resource !== 'storage') return 1;
    return right.surplus - left.surplus;
  });

  const best = surplusCandidates[0];
  return {
    offerResource: best.resource,
    wantResource,
    offerAmount: best.offerAmount,
    wantAmount: best.wantAmount,
  };
}

function surplusTradeDuty(input: EconomicPlannerInput): EconomicAutonomyDuty | null {
  const template = selectSurplusTradeTemplate(input);
  if (!template || !input.hasTradeAccess || lowCoreResources(input.resources)) return null;

  return {
    dedupeKey: 'autonomy-surplus-trade',
    kind: 'trade',
    title: 'Rebalance surplus stock',
    reason: 'Overflowing or imbalanced reserves should be converted into the weakest strategic stock before capacity is wasted.',
    priority: storageOverflow(input.resources) ? 71 : 64,
    payload: {
      offerResource: template.offerResource,
      wantResource: template.wantResource,
      offerAmount: template.offerAmount,
      wantAmount: template.wantAmount,
      targetZone: 'Market',
    },
    sourceEventType: storageOverflow(input.resources) ? 'storage_overflow' : 'resource_windfall',
  };
}

export function planEconomicAutonomy(input: EconomicPlannerInput): EconomicAutonomyDuty[] {
  const duties: EconomicAutonomyDuty[] = [];
  const ownedBuildings = new Set(input.ownedBuildings);
  const desiredRelayPatches = desiredRelayPatchStock(input);
  const missingRelayPatches = Math.max(0, desiredRelayPatches - input.relayPatches);
  const desiredDataShards = missingRelayPatches;
  const desiredAlloyFrames = missingRelayPatches;

  if (marketInfrastructureNeeded(input) && input.canAffordBuilding('market_stall')) {
    duties.push({
      dedupeKey: 'autonomy-build-market-stall',
      kind: 'build',
      title: 'Raise market stall',
      reason: lowCoreResources(input.resources)
        ? 'Trade access is missing during a resource crunch, so build permanent remote market access.'
        : 'Strategic stock is overflowing or imbalanced without remote trade access, so build market infrastructure first.',
      priority: lowCoreResources(input.resources) ? 83 : 69,
      payload: { preferredType: 'market_stall', preferredZone: 'Market' },
      sourceEventType: lowCoreResources(input.resources) ? 'resource_drought' : 'storage_overflow',
    });
  }

  if (lowCoreResources(input.resources) && input.hasTradeAccess) {
    duties.push(tradeDuty(input));
  }

  const surplusTrade = surplusTradeDuty(input);
  if (surplusTrade) {
    duties.push(surplusTrade);
  }

  if (input.needs.creative < 35 && !ownedBuildings.has('archive') && input.canAffordBuilding('archive')) {
    duties.push({
      dedupeKey: 'autonomy-build-archive',
      kind: 'build',
      title: 'Build growth archive',
      reason: 'Creative need is low, queue an archive for long-term growth.',
      priority: 74,
      payload: { preferredType: 'archive', preferredZone: 'Library' },
      sourceEventType: 'need_cascade',
    });
  }

  if (input.needs.tasked < 35 && !ownedBuildings.has('forge') && input.canAffordBuilding('forge')) {
    duties.push({
      dedupeKey: 'autonomy-build-forge',
      kind: 'build',
      title: 'Restore task momentum',
      reason: 'Tasked need is low, queue a forge for sustained output.',
      priority: 72,
      payload: { preferredType: 'forge', preferredZone: 'Workshop' },
      sourceEventType: 'need_cascade',
    });
  }

  if (input.needs.social < 35 && input.zone !== 'Tavern') {
    duties.push({
      dedupeKey: 'autonomy-move-tavern',
      kind: 'move',
      title: 'Move to social hub',
      reason: 'Social need is low, move toward the Tavern social hub.',
      priority: 61,
      payload: { targetZone: 'Tavern' },
      sourceEventType: 'need_cascade',
    });
  }

  if (desiredDataShards > input.dataShards) {
    if (ownedBuildings.has('archive') && input.canCraftRecipe('data_shard')) {
      duties.push({
        dedupeKey: 'autonomy-craft-data-shard',
        kind: 'craft',
        title: 'Refine data shard',
        reason: 'Relay reserve target needs more data shards, refine one to unblock downstream emergency stock.',
        priority: input.activeRaid || input.activeWar ? 79 : 66,
        payload: { recipeId: 'data_shard' },
        sourceEventType: 'resource_drought',
      });
    } else if (!ownedBuildings.has('archive') && input.canAffordBuilding('archive')) {
      duties.push({
        dedupeKey: 'autonomy-build-archive',
        kind: 'build',
        title: 'Build growth archive',
        reason: 'Relay reserve target lacks shard production, so archive infrastructure must come online first.',
        priority: 77,
        payload: { preferredType: 'archive', preferredZone: 'Library' },
        sourceEventType: 'resource_drought',
      });
    }
  }

  if (desiredAlloyFrames > input.alloyFrames) {
    if (ownedBuildings.has('forge') && input.canCraftRecipe('alloy_frame')) {
      duties.push({
        dedupeKey: 'autonomy-craft-alloy-frame',
        kind: 'craft',
        title: 'Forge alloy frame',
        reason: 'Relay reserve target needs more alloy frames, forge one to keep the recovery chain supplied.',
        priority: input.activeRaid || input.activeWar ? 78 : 65,
        payload: { recipeId: 'alloy_frame' },
        sourceEventType: 'resource_drought',
      });
    } else if (!ownedBuildings.has('forge') && input.canAffordBuilding('forge')) {
      duties.push({
        dedupeKey: 'autonomy-build-forge',
        kind: 'build',
        title: 'Restore task momentum',
        reason: 'Relay reserve target lacks frame production, so forge infrastructure must come online first.',
        priority: 76,
        payload: { preferredType: 'forge', preferredZone: 'Workshop' },
        sourceEventType: 'resource_drought',
      });
    }
  }

  if (missingRelayPatches > 0 && input.dataShards >= 1 && input.alloyFrames >= 1 && input.canCraftRecipe('relay_patch')) {
    duties.push({
      dedupeKey: 'autonomy-craft-relay-patch',
      kind: 'craft',
      title: 'Assemble relay patch',
      reason: 'Emergency reserve is below target, assemble another relay patch before the next shock arrives.',
      priority: input.activeRaid || input.raidRisk >= 82 ? 86 : input.activeWar || input.raidRisk >= 58 ? 82 : 78,
      payload: { recipeId: 'relay_patch' },
      sourceEventType: 'resource_drought',
    });
  }

  return duties;
}