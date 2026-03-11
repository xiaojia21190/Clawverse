import type { RingWorldSnapshot } from './world-topology.js';

export interface MigrationTargetSnapshot {
  topic: string;
  score: number;
  tier: 'safe_haven' | 'watch' | 'avoid';
  actorCount: number;
  branchCount: number;
  shellStatus: RingWorldSnapshot['shells'][number]['status'];
  peerHealth: 'live' | 'stale' | 'expired' | 'unknown';
  reason: string;
}

export interface MigrationPlanSnapshot {
  strategy: 'hold' | 'prepare_migration' | 'evacuate';
  urgency: number;
  summary: string;
  recommendedTopic: string | null;
  targets: MigrationTargetSnapshot[];
}

interface MigrationPlannerInput {
  ring: RingWorldSnapshot;
  compute: number;
  storage: number;
  raidRisk: number;
  activeRaid: boolean;
  activeWarCount: number;
  peerHealths?: Record<string, 'live' | 'stale' | 'expired'>;
}

export function planMigration(input: MigrationPlannerInput): MigrationPlanSnapshot {
  const urgency = clamp(
    Math.round(
      Math.max(0, 40 - input.compute) * 1.4
      + Math.max(0, 35 - input.storage) * 1.2
      + input.raidRisk * 0.55
      + input.activeWarCount * 8
      + (input.activeRaid ? 20 : 0),
    ),
    0,
    100,
  );

  const targets = input.ring.shells
    .filter((shell) => !shell.active)
    .map((shell) => {
      const peerHealth = input.peerHealths?.[shell.topic] ?? 'unknown';
      let score = 0;

      if (shell.status === 'mirrored') score += 42;
      else if (shell.status === 'configured') score += 16;

      if (shell.brainStatus === 'authoritative') score += 18;
      else if (shell.brainStatus === 'pending') score += 8;

      score += Math.min(20, shell.actorCount * 3);
      score += Math.min(12, shell.branchCount * 2);

      if (shell.source === 'mirror' || shell.source === 'imported') score += 10;
      else if (shell.source === 'live') score += 6;

      if (peerHealth === 'live') score += 15;
      else if (peerHealth === 'stale') score -= 6;
      else if (peerHealth === 'expired') score -= 40;

      score = clamp(score, 0, 100);

      const tier = score >= 65
        ? 'safe_haven'
        : score >= 35
          ? 'watch'
          : 'avoid';

      const reason = tier === 'safe_haven'
        ? 'stable mirrored world with enough active actors to absorb refugees'
        : tier === 'watch'
          ? 'reachable ring shell, but conditions are only partially trusted'
          : 'insufficient world stability or stale federation signal';

      return {
        topic: shell.topic,
        score,
        tier,
        actorCount: shell.actorCount,
        branchCount: shell.branchCount,
        shellStatus: shell.status,
        peerHealth,
        reason,
      } satisfies MigrationTargetSnapshot;
    })
    .sort((left, right) => right.score - left.score || left.topic.localeCompare(right.topic));

  const recommendedTopic = targets.find((target) => target.tier !== 'avoid')?.topic ?? null;
  const strategy = urgency >= 75
    ? 'evacuate'
    : urgency >= 45
      ? 'prepare_migration'
      : 'hold';

  const summary = strategy === 'evacuate'
    ? `World pressure is critical. Evacuation routes should bias toward ${recommendedTopic ?? 'any surviving safe haven'}.`
    : strategy === 'prepare_migration'
      ? `World pressure is rising. Prepare a refugee squad and watch ${recommendedTopic ?? 'nearby ring shells'} for a stable corridor.`
      : `World pressure is manageable. Hold position unless a stronger migration signal appears.`;

  return {
    strategy,
    urgency,
    summary,
    recommendedTopic,
    targets: targets.slice(0, 5),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
