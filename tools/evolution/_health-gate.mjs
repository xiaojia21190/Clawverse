import { buildMetricDeltas, filterEpisodes, getEvolutionSqlitePath, readEpisodesFromSqlite, toMetrics } from './_episodes.mjs';
import { evaluateSevereFailure, resolveRolloutPolicy } from './_rollout.mjs';

function toIso(timestampMs) {
  return new Date(timestampMs).toISOString();
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : fallback;
}

function buildVariantMetrics(name, rows) {
  return {
    name,
    ...toMetrics(rows),
  };
}

function buildRolloutChecks(deltas, metrics, policy) {
  return {
    successRate: Number(deltas.successRate || 0) >= -policy.maxSuccessRateDrop,
    latency: Number(deltas.avgLatencyMs || 0) <= Number(metrics.maxLatencyDeltaMs || 0),
    tokens: Number(deltas.avgTokenTotal || 0) <= Number(metrics.maxTokenDelta || 0),
    cost: Number(deltas.avgCostUsd || 0) <= Number(metrics.maxCostDeltaUsd || 0),
  };
}

export function resolveHealthGatePolicy(config = {}) {
  const rolloutPolicy = resolveRolloutPolicy(config);
  const evaluation = config.evaluation || {};

  return {
    minBaselineSamples: toPositiveInt(
      rolloutPolicy.healthGateMinSamplesBaseline,
      Math.max(1, Math.ceil(Number(evaluation.minSamplesBaseline || 5) / 2)),
    ),
    minCandidateSamples: toPositiveInt(
      rolloutPolicy.healthGateMinSamplesCandidate,
      Math.max(1, Math.ceil(Number(evaluation.minSamplesCandidate || 5) / 2)),
    ),
    maxSuccessRateDrop: Number.isFinite(Number(rolloutPolicy.healthGateMaxSuccessRateDrop))
      ? Math.max(0, Number(rolloutPolicy.healthGateMaxSuccessRateDrop))
      : 0,
    rollbackOnCritical: rolloutPolicy.healthGateRollbackOnCritical !== false,
  };
}

export function getHealthWindowStartMs(state) {
  if (Number(state?.candidateRatio || 0) <= 0) return null;
  return parseTimestamp(state?.lastRatioChangeAt);
}

function buildEmptyResult(state, config, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const baselineName = state?.baseline ?? config.baseline;
  const candidateName = state?.candidate ?? config.candidate;
  const includeSources = Array.isArray(config?.evaluation?.includeSources) && config.evaluation.includeSources.length > 0
    ? config.evaluation.includeSources
    : ['task-runtime', 'manual'];
  const policy = resolveHealthGatePolicy(config);
  const emptyBaseline = buildVariantMetrics(baselineName, []);
  const emptyCandidate = buildVariantMetrics(candidateName, []);

  return {
    status: 'pending',
    evaluatedAt: toIso(nowMs),
    windowStartAt: null,
    includeSources,
    policy,
    sampleSize: 0,
    samples: {
      total: 0,
      baseline: emptyBaseline,
      candidate: emptyCandidate,
    },
    deltas: buildMetricDeltas(emptyBaseline, emptyCandidate),
    checks: {
      sampleChecks: {
        baselineSamples: false,
        candidateSamples: false,
      },
      rolloutChecks: {
        successRate: false,
        latency: false,
        tokens: false,
        cost: false,
      },
      severeChecks: {
        successRate: false,
        latency: false,
        tokens: false,
        cost: false,
      },
      severeThresholds: null,
      healthy: false,
      critical: false,
    },
    rollbackRecommended: false,
  };
}

export function evaluateHealthGate(state, config, episodes, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const includeSources = Array.isArray(config?.evaluation?.includeSources) && config.evaluation.includeSources.length > 0
    ? config.evaluation.includeSources
    : ['task-runtime', 'manual'];
  const windowStartMs = Number.isFinite(options.windowStartMs)
    ? options.windowStartMs
    : getHealthWindowStartMs(state);

  if (!windowStartMs) {
    return buildEmptyResult(state, config, { nowMs });
  }

  const baselineName = state?.baseline ?? config.baseline;
  const candidateName = state?.candidate ?? config.candidate;
  const policy = resolveHealthGatePolicy(config);
  const filtered = filterEpisodes(episodes, { includeSources, sinceMs: windowStartMs });
  const baselineRows = filtered.filter((episode) => episode.variant === baselineName);
  const candidateRows = filtered.filter((episode) => episode.variant === candidateName);
  const baseline = buildVariantMetrics(baselineName, baselineRows);
  const candidate = buildVariantMetrics(candidateName, candidateRows);
  const deltas = buildMetricDeltas(baseline, candidate);
  const sampleChecks = {
    baselineSamples: baseline.samples >= policy.minBaselineSamples,
    candidateSamples: candidate.samples >= policy.minCandidateSamples,
  };
  const rolloutChecks = buildRolloutChecks(deltas, config.metrics || {}, policy);
  const severe = evaluateSevereFailure({ decision: 'keep_baseline', deltas }, config);

  let status = 'degraded';
  if (severe.severeFailure && candidate.samples > 0) {
    status = 'critical';
  } else if (!Object.values(sampleChecks).every(Boolean)) {
    status = 'insufficient_samples';
  } else if (Object.values(rolloutChecks).every(Boolean)) {
    status = 'healthy';
  }

  return {
    status,
    evaluatedAt: toIso(nowMs),
    windowStartAt: toIso(windowStartMs),
    includeSources,
    policy,
    sampleSize: filtered.length,
    samples: {
      total: filtered.length,
      baseline,
      candidate,
    },
    deltas,
    checks: {
      sampleChecks,
      rolloutChecks,
      severeChecks: severe.checks,
      severeThresholds: severe.thresholds,
      healthy: status === 'healthy',
      critical: status === 'critical',
    },
    rollbackRecommended: status === 'critical' && policy.rollbackOnCritical,
  };
}

export function buildHealthGateStatePatch(result) {
  return {
    healthGateStatus: result.status,
    lastHealthCheckAt: result.evaluatedAt,
    healthWindowStartAt: result.windowStartAt,
    healthSamples: {
      total: result.sampleSize,
      includeSources: result.includeSources,
      baseline: result.samples.baseline,
      candidate: result.samples.candidate,
      deltas: result.deltas,
    },
    healthChecks: result.checks,
    healthRollbackApplied: false,
  };
}

export function applyHealthGateToState(state, result) {
  return {
    ...state,
    updatedAt: result.evaluatedAt,
    ...buildHealthGateStatePatch(result),
  };
}

export function evaluateHealthGateFromSqlite(state, config, options = {}) {
  const sqlitePath = options.sqlitePath || getEvolutionSqlitePath();
  const episodes = Array.isArray(options.episodes) ? options.episodes : readEpisodesFromSqlite(sqlitePath);
  return {
    sqlitePath,
    ...evaluateHealthGate(state, config, episodes, options),
  };
}