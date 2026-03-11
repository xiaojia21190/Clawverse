import type { StrategicLane } from './governor-planner.js';
import type { MigrationPlanSnapshot } from './migration-planner.js';

export interface MigrationAutonomyDuty {
  dedupeKey: string;
  lane: StrategicLane;
  kind: 'migrate';
  title: string;
  reason: string;
  priority: number;
  payload: Record<string, unknown>;
  sourceEventType: string;
}

export interface MigrationAutonomyPlannerInput {
  plan: MigrationPlanSnapshot;
  activeRaid?: boolean;
  clusterStatus?: 'forming' | 'stable' | 'strained' | 'fracturing' | 'collapsing';
  clusterActorCount?: number;
}

export const MIGRATION_AUTONOMY_KEYS = [
  'autonomy-migrate-prepare',
  'autonomy-migrate-evacuate',
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function prepareReason(input: MigrationAutonomyPlannerInput): string {
  if (input.clusterStatus === 'fracturing' || input.clusterStatus === 'collapsing') {
    return 'Cluster stability is degrading, so autonomy prepares a refugee corridor before the route collapses.';
  }
  return 'World pressure is rising, so autonomy prepares a migration corridor while local defenses still hold.';
}

function prepareLane(input: MigrationAutonomyPlannerInput): StrategicLane {
  if (input.activeRaid) return 'wartime';
  if (input.clusterStatus === 'fracturing' || input.clusterStatus === 'collapsing') return 'faction';
  return 'economy';
}

function preparePriority(plan: MigrationPlanSnapshot): number {
  return clamp(58 + Math.round(plan.urgency * 0.32), 62, 86);
}

function evacuatePriority(plan: MigrationPlanSnapshot): number {
  return clamp(76 + Math.round(plan.urgency * 0.24), 84, 98);
}

export function planMigrationAutonomy(input: MigrationAutonomyPlannerInput): MigrationAutonomyDuty[] {
  const target = input.plan.targets.find((item) => item.topic === input.plan.recommendedTopic)
    ?? input.plan.targets.find((item) => item.tier !== 'avoid')
    ?? null;
  if (!target) return [];

  if (input.plan.strategy === 'evacuate') {
    return [{
      dedupeKey: 'autonomy-migrate-evacuate',
      lane: 'wartime',
      kind: 'migrate',
      title: 'Launch refugee squad evacuation',
      reason: 'Survival pressure is critical, so autonomy prioritizes immediate small-squad evacuation.',
      priority: evacuatePriority(input.plan),
      payload: {
        toTopic: target.topic,
        migrationStrategy: input.plan.strategy,
        migrationUrgency: input.plan.urgency,
        lane: 'Residential',
        responseSquad: 'migration',
        assignee: 'refugee_coordinator',
        stage: 'evacuate',
        progressHint: 'evacuate',
        actorCountHint: Math.max(1, Math.min(3, Math.round(input.clusterActorCount ?? 1))),
      },
      sourceEventType: 'great_migration',
    }];
  }

  if (input.plan.strategy === 'prepare_migration') {
    return [{
      dedupeKey: 'autonomy-migrate-prepare',
      lane: prepareLane(input),
      kind: 'migrate',
      title: 'Prepare refugee squad corridor',
      reason: prepareReason(input),
      priority: preparePriority(input.plan),
      payload: {
        toTopic: target.topic,
        migrationStrategy: input.plan.strategy,
        migrationUrgency: input.plan.urgency,
        lane: 'Residential',
        responseSquad: 'migration',
        assignee: 'route_scout',
        stage: 'prepare',
        progressHint: 'regroup',
        actorCountHint: Math.max(1, Math.min(3, Math.round(input.clusterActorCount ?? 1))),
      },
      sourceEventType: input.clusterStatus === 'fracturing' || input.clusterStatus === 'collapsing'
        ? 'faction_splintering'
        : 'resource_drought',
    }];
  }

  return [];
}
