export type EvolutionAutoStep =
  | 'propose'
  | 'evaluate'
  | 'decide'
  | 'health-check'
  | 'apply-rollout';

export interface EvolutionPolicyStatus {
  config?: {
    autopilot?: {
      minEpisodeDelta?: number;
    } | null;
  } | null;
  stats?: {
    total?: number;
  } | null;
  latest?: {
    proposalId?: string | null;
    decision?: {
      decision?: string | null;
    } | null;
    report?: {
      sampleSize?: number;
    } | null;
  } | null;
  rollout?: {
    candidateRatio?: number;
    canary?: {
      active?: boolean;
    } | null;
    healthGate?: {
      status?: string | null;
    } | null;
  } | null;
  runner?: {
    active?: unknown;
  } | null;
  cooldowns?: {
    globalActive?: boolean;
    byStep?: Record<string, { active?: boolean } | undefined>;
  } | null;
}

export interface EvolutionPolicyAction {
  step: EvolutionAutoStep;
  note: string;
}

function isStepCoolingDown(status: EvolutionPolicyStatus, step: EvolutionAutoStep): boolean {
  return status.cooldowns?.byStep?.[step]?.active === true;
}

export function chooseEvolutionPolicyAction(status: EvolutionPolicyStatus | null | undefined): EvolutionPolicyAction | null {
  if (!status) return null;
  if (status.runner?.active) return null;
  if (status.cooldowns?.globalActive) return null;

  const latest = status.latest ?? null;
  const rollout = status.rollout ?? null;
  const totalEpisodes = Number(status.stats?.total ?? 0);
  const minEpisodeDelta = Math.max(0, Number(status.config?.autopilot?.minEpisodeDelta ?? 0));
  const proposalId = typeof latest?.proposalId === 'string' ? latest.proposalId : '';
  const hasReport = !!latest?.report;
  const reportSampleSize = Math.max(0, Number(latest?.report?.sampleSize ?? 0));
  const decisionType = typeof latest?.decision?.decision === 'string' ? latest.decision.decision : '';
  const ratio = Number(rollout?.candidateRatio ?? 0);
  const canaryActive = rollout?.canary?.active === true;
  const healthStatus = typeof rollout?.healthGate?.status === 'string'
    ? rollout.healthGate.status
    : 'pending';

  const accept = (step: EvolutionAutoStep, note: string): EvolutionPolicyAction | null => {
    if (isStepCoolingDown(status, step)) return null;
    return { step, note };
  };

  if (!proposalId) {
    return accept('propose', 'daemon policy bootstraps the first evolution proposal');
  }

  if (!hasReport) {
    if (totalEpisodes < minEpisodeDelta) return null;
    return accept('evaluate', 'daemon policy evaluates the latest proposal against accumulated episodes');
  }

  if (!decisionType) {
    return accept('decide', 'daemon policy decides on the latest evaluation report');
  }

  if (decisionType === 'hold') {
    if (Math.max(0, totalEpisodes - reportSampleSize) < minEpisodeDelta) return null;
    return accept('evaluate', 'daemon policy revisits a hold decision after waiting for more samples');
  }

  if (decisionType === 'keep_baseline') {
    if (ratio > 0) {
      return accept('apply-rollout', 'daemon policy winds candidate traffic down after a baseline decision');
    }
    return null;
  }

  if (decisionType === 'adopt_candidate') {
    if (canaryActive) return null;
    if (ratio <= 0) return null;
    if (healthStatus === 'pending') {
      return accept('health-check', 'daemon policy refreshes the health gate after the canary window');
    }
    if (healthStatus === 'healthy' && ratio < 1) {
      return accept('apply-rollout', 'daemon policy advances rollout after a healthy canary window');
    }
    if (healthStatus === 'critical' && ratio > 0) {
      return accept('apply-rollout', 'daemon policy rolls candidate traffic back after a critical health gate');
    }
  }

  return null;
}
