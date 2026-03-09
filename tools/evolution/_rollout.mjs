import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_POLICY = {
  startRatio: 0.1,
  stepUp: 0.2,
  maxRatio: 1,
  stepDownOnFail: 0.1,
  rollbackOnSevereFail: true,
  severeFailMinSuccessDrop: 0.03,
  severeFailLatencyMultiplier: 2,
  severeFailTokenMultiplier: 2,
  severeFailCostMultiplier: 2,
  minCanaryWindowMinutes: 120,
  healthGateMinSamplesBaseline: 3,
  healthGateMinSamplesCandidate: 3,
  healthGateMaxSuccessRateDrop: 0,
  healthGateRollbackOnCritical: true,
};

function toIso(timestampMs) {
  return new Date(timestampMs).toISOString();
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRatio(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

export function buildEmptyHealthGateState(windowStartAt = null) {
  return {
    healthGateStatus: 'pending',
    lastHealthCheckAt: null,
    healthWindowStartAt: windowStartAt,
    healthSamples: null,
    healthChecks: null,
    healthRollbackApplied: false,
  };
}

function hydrateHealthGateState(state = {}) {
  return {
    healthGateStatus: typeof state.healthGateStatus === 'string' ? state.healthGateStatus : 'pending',
    lastHealthCheckAt: state.lastHealthCheckAt ?? null,
    healthWindowStartAt: state.healthWindowStartAt ?? null,
    healthSamples: state.healthSamples ?? null,
    healthChecks: state.healthChecks ?? null,
    healthRollbackApplied: Boolean(state.healthRollbackApplied),
  };
}

function resetHealthGate(state, windowStartAt = null) {
  Object.assign(state, buildEmptyHealthGateState(windowStartAt));
}

export function readEvolutionConfig(root) {
  return JSON.parse(readFileSync(join(root, 'tools/evolution/config.json'), 'utf8'));
}

export function rolloutStatePath(root) {
  return join(root, 'data/evolution/rollout/state.json');
}

export function rolloutEnvPath(root) {
  return join(root, 'data/evolution/rollout/latest.env');
}

export function readRolloutState(root) {
  const path = rolloutStatePath(root);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function resolveRolloutPolicy(config = {}) {
  return {
    ...DEFAULT_POLICY,
    ...(config.rolloutPolicy || {}),
  };
}

export function canaryWindowMs(config = {}) {
  const policy = resolveRolloutPolicy(config);
  return Math.max(0, Number(policy.minCanaryWindowMinutes || 0)) * 60_000;
}

export function getCanaryWindowStatus(state, config = {}, nowMs = Date.now()) {
  const lockUntilMs = parseTimestamp(state?.canaryLockedUntil);
  const lastRatioChangeAtMs = parseTimestamp(state?.lastRatioChangeAt);
  const active = Number(state?.candidateRatio || 0) > 0 && !!lockUntilMs && lockUntilMs > nowMs;
  const remainingMs = active && lockUntilMs ? Math.max(0, lockUntilMs - nowMs) : 0;
  return {
    active,
    remainingMs,
    remainingMinutes: Math.ceil(remainingMs / 60_000),
    lastRatioChangeAt: lastRatioChangeAtMs ? toIso(lastRatioChangeAtMs) : null,
    lockUntil: lockUntilMs ? toIso(lockUntilMs) : null,
  };
}

export function getHealthGateState(state) {
  const rawStatus = typeof state?.healthGateStatus === 'string' ? state.healthGateStatus : 'pending';
  const lastRatioChangeAtMs = parseTimestamp(state?.lastRatioChangeAt);
  const healthWindowStartAtMs = parseTimestamp(state?.healthWindowStartAt);
  const lastHealthCheckAtMs = parseTimestamp(state?.lastHealthCheckAt);
  const fresh = Boolean(
    lastRatioChangeAtMs
      && healthWindowStartAtMs
      && lastHealthCheckAtMs
      && healthWindowStartAtMs === lastRatioChangeAtMs
      && lastHealthCheckAtMs >= healthWindowStartAtMs,
  );

  return {
    status: fresh ? rawStatus : 'pending',
    rawStatus,
    fresh,
    lastHealthCheckAt: lastHealthCheckAtMs ? toIso(lastHealthCheckAtMs) : null,
    windowStartAt: healthWindowStartAtMs ? toIso(healthWindowStartAtMs) : null,
    rollbackApplied: Boolean(state?.healthRollbackApplied),
    samples: state?.healthSamples ?? null,
    checks: state?.healthChecks ?? null,
  };
}

export function evaluateSevereFailure(decision, config = {}) {
  const policy = resolveRolloutPolicy(config);
  const metrics = config.metrics || {};
  const deltas = decision?.deltas || {};

  const thresholds = {
    successRate: -Math.max(Math.abs(Number(policy.severeFailMinSuccessDrop || 0)), Math.abs(Number(metrics.minSuccessLift || 0)), 0.03),
    latency: Math.max(Number(metrics.maxLatencyDeltaMs || 0) * Number(policy.severeFailLatencyMultiplier || 2), 300),
    tokens: Math.max(Number(metrics.maxTokenDelta || 0) * Number(policy.severeFailTokenMultiplier || 2), 600),
    cost: Math.max(Number(metrics.maxCostDeltaUsd || 0) * Number(policy.severeFailCostMultiplier || 2), 0.04),
  };

  const checks = {
    successRate: Number(deltas.successRate || 0) <= thresholds.successRate,
    latency: Number(deltas.avgLatencyMs || 0) >= thresholds.latency,
    tokens: Number(deltas.avgTokenTotal || 0) >= thresholds.tokens,
    cost: Number(deltas.avgCostUsd || 0) >= thresholds.cost,
  };

  const severeFailure = Boolean(policy.rollbackOnSevereFail)
    && decision?.decision === 'keep_baseline'
    && Object.values(checks).some(Boolean);

  return { severeFailure, checks, thresholds };
}

function startCanaryWindow(state, config, nowMs) {
  const windowMs = canaryWindowMs(config);
  state.lastRatioChangeAt = toIso(nowMs);
  state.canaryLockedUntil = windowMs > 0 && Number(state.candidateRatio || 0) > 0
    ? toIso(nowMs + windowMs)
    : null;
  resetHealthGate(state, state.lastRatioChangeAt);
}

function clearCanaryWindow(state) {
  state.lastRatioChangeAt = null;
  state.canaryLockedUntil = null;
}

export function applyRolloutDecision(state, config, decision, options = {}) {
  const policy = resolveRolloutPolicy(config);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const prevRatio = Number(state?.candidateRatio || 0);
  const next = {
    baseline: state?.baseline ?? config.baseline,
    candidate: state?.candidate ?? config.candidate,
    candidateRatio: prevRatio,
    initializedAt: state?.initializedAt ?? toIso(nowMs),
    updatedAt: toIso(nowMs),
    lastRatioChangeAt: state?.lastRatioChangeAt ?? null,
    canaryLockedUntil: state?.canaryLockedUntil ?? null,
    ...hydrateHealthGateState(state),
  };

  const severe = evaluateSevereFailure(decision, config);
  const canary = getCanaryWindowStatus(next, config, nowMs);
  const healthGate = getHealthGateState(next);
  let rollbackApplied = false;
  let canaryHoldApplied = false;
  let healthGateHoldApplied = false;
  let healthRollbackApplied = false;

  if (decision.decision === 'adopt_candidate') {
    if (next.candidate !== config.candidate || next.baseline !== config.baseline) {
      next.baseline = config.baseline;
      next.candidate = config.candidate;
      next.candidateRatio = normalizeRatio(policy.startRatio);
      startCanaryWindow(next, config, nowMs);
    } else if (canary.active) {
      canaryHoldApplied = true;
    } else if (healthGate.status === 'critical') {
      next.candidateRatio = 0;
      healthRollbackApplied = prevRatio > 0;
      next.healthRollbackApplied = healthRollbackApplied;
      clearCanaryWindow(next);
    } else if (healthGate.status !== 'healthy') {
      healthGateHoldApplied = true;
    } else {
      const steppedRatio = normalizeRatio(Math.min(policy.maxRatio, next.candidateRatio + policy.stepUp));
      if (steppedRatio !== next.candidateRatio) {
        next.candidateRatio = steppedRatio;
        startCanaryWindow(next, config, nowMs);
      }
    }
  } else if (decision.decision === 'keep_baseline') {
    if (severe.severeFailure) {
      next.candidateRatio = 0;
      rollbackApplied = prevRatio > 0;
      clearCanaryWindow(next);
      resetHealthGate(next, null);
    } else {
      const steppedRatio = normalizeRatio(Math.max(0, next.candidateRatio - policy.stepDownOnFail));
      if (steppedRatio !== next.candidateRatio) {
        next.candidateRatio = steppedRatio;
        if (steppedRatio > 0) {
          startCanaryWindow(next, config, nowMs);
        } else {
          clearCanaryWindow(next);
          resetHealthGate(next, null);
        }
      }
    }
  }

  next.updatedAt = toIso(nowMs);
  return {
    state: next,
    prevRatio,
    rollbackApplied,
    canaryHoldApplied,
    healthGateHoldApplied,
    healthRollbackApplied,
    severeFailure: severe.severeFailure,
    severeChecks: severe.checks,
    severeThresholds: severe.thresholds,
    canary: getCanaryWindowStatus(next, config, nowMs),
    healthGate: getHealthGateState(next),
  };
}

export function buildRolloutEnvPayload(state) {
  return {
    baseline: state.baseline,
    candidate: state.candidate,
    candidateRatio: state.candidateRatio,
  };
}

export function buildRolloutEnvLine(state) {
  return `export CLAWVERSE_ROLLOUT_JSON='${JSON.stringify(buildRolloutEnvPayload(state))}'`;
}

export function writeRolloutArtifacts(root, state) {
  mkdirSync(join(root, 'data/evolution/rollout'), { recursive: true });
  writeFileSync(rolloutStatePath(root), JSON.stringify(state, null, 2));
  const envLine = buildRolloutEnvLine(state);
  writeFileSync(rolloutEnvPath(root), `${envLine}\n`);
  return envLine;
}

export function initializeRolloutState(root, config, options = {}) {
  const current = readRolloutState(root);
  const policy = resolveRolloutPolicy(config);
  const shouldReset = options.force || !current || current.baseline !== config.baseline || current.candidate !== config.candidate;

  if (!shouldReset) {
    return {
      changed: false,
      state: current,
      envLine: buildRolloutEnvLine(current),
    };
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const state = {
    baseline: config.baseline,
    candidate: config.candidate,
    candidateRatio: normalizeRatio(Number(options.candidateRatio ?? policy.startRatio ?? DEFAULT_POLICY.startRatio)),
    initializedAt: current?.initializedAt || toIso(nowMs),
    updatedAt: toIso(nowMs),
    lastRatioChangeAt: null,
    canaryLockedUntil: null,
    ...buildEmptyHealthGateState(),
  };

  if (state.candidateRatio > 0) {
    startCanaryWindow(state, config, nowMs);
  }

  return {
    changed: true,
    state,
    envLine: writeRolloutArtifacts(root, state),
  };
}