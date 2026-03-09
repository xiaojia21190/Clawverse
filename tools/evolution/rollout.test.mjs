import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { evaluateHealthGate } from './_health-gate.mjs';
import {
  applyRolloutDecision,
  evaluateSevereFailure,
  getCanaryWindowStatus,
  getHealthGateState,
  initializeRolloutState,
} from './_rollout.mjs';

const config = {
  baseline: 'baseline-v1',
  candidate: 'candidate-v2',
  metrics: {
    minSuccessLift: 0.03,
    maxLatencyDeltaMs: 150,
    maxTokenDelta: 300,
    maxCostDeltaUsd: 0.02,
  },
  evaluation: {
    includeSources: ['manual'],
    minSamplesBaseline: 5,
    minSamplesCandidate: 5,
  },
  rolloutPolicy: {
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
  },
};

test('evaluateSevereFailure flags hard regressions for rollback', () => {
  const severe = evaluateSevereFailure({
    decision: 'keep_baseline',
    deltas: {
      successRate: -0.05,
      avgLatencyMs: 40,
      avgTokenTotal: 20,
      avgCostUsd: 0.001,
    },
  }, config);

  assert.equal(severe.severeFailure, true);
  assert.equal(severe.checks.successRate, true);
});

test('applyRolloutDecision performs immediate rollback on severe keep_baseline failure', () => {
  const result = applyRolloutDecision({
    baseline: 'baseline-v1',
    candidate: 'candidate-v2',
    candidateRatio: 0.5,
    initializedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRatioChangeAt: new Date().toISOString(),
    canaryLockedUntil: new Date(Date.now() + 1000).toISOString(),
  }, config, {
    decision: 'keep_baseline',
    deltas: {
      successRate: -0.05,
      avgLatencyMs: 90,
      avgTokenTotal: 80,
      avgCostUsd: 0.005,
    },
  });

  assert.equal(result.rollbackApplied, true);
  assert.equal(result.state.candidateRatio, 0);
  assert.equal(result.state.canaryLockedUntil, null);
});

test('applyRolloutDecision only steps down mildly on non-severe failure', () => {
  const result = applyRolloutDecision({
    baseline: 'baseline-v1',
    candidate: 'candidate-v2',
    candidateRatio: 0.5,
    initializedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRatioChangeAt: null,
    canaryLockedUntil: null,
  }, config, {
    decision: 'keep_baseline',
    deltas: {
      successRate: 0.01,
      avgLatencyMs: 180,
      avgTokenTotal: 80,
      avgCostUsd: 0.01,
    },
  }, { nowMs: Date.parse('2026-03-08T00:00:00.000Z') });

  assert.equal(result.rollbackApplied, false);
  assert.equal(result.state.candidateRatio, 0.4);
  assert.ok(typeof result.state.canaryLockedUntil === 'string');
  assert.equal(result.state.healthGateStatus, 'pending');
});

test('initializeRolloutState starts a canary observation window', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawverse-rollout-'));
  try {
    const init = initializeRolloutState(root, config, {
      force: true,
      candidateRatio: 0.1,
      nowMs: Date.parse('2026-03-08T00:00:00.000Z'),
    });

    assert.equal(init.state.candidateRatio, 0.1);
    assert.equal(init.state.lastRatioChangeAt, '2026-03-08T00:00:00.000Z');
    assert.equal(init.state.canaryLockedUntil, '2026-03-08T02:00:00.000Z');
    assert.equal(init.state.healthGateStatus, 'pending');
    assert.equal(init.state.healthWindowStartAt, '2026-03-08T00:00:00.000Z');
    assert.equal(init.state.lastHealthCheckAt, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applyRolloutDecision holds ratio during active canary window', () => {
  const result = applyRolloutDecision({
    baseline: 'baseline-v1',
    candidate: 'candidate-v2',
    candidateRatio: 0.1,
    initializedAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    lastRatioChangeAt: '2026-03-08T00:00:00.000Z',
    canaryLockedUntil: '2026-03-08T02:00:00.000Z',
    healthGateStatus: 'healthy',
    lastHealthCheckAt: '2026-03-08T01:00:00.000Z',
    healthWindowStartAt: '2026-03-08T00:00:00.000Z',
    healthSamples: null,
    healthChecks: null,
    healthRollbackApplied: false,
  }, config, {
    decision: 'adopt_candidate',
    deltas: {
      successRate: 0.05,
      avgLatencyMs: 20,
      avgTokenTotal: 10,
      avgCostUsd: 0.001,
    },
  }, { nowMs: Date.parse('2026-03-08T01:00:00.000Z') });

  assert.equal(result.canaryHoldApplied, true);
  assert.equal(result.state.candidateRatio, 0.1);
  assert.equal(result.canary.active, true);
});

test('applyRolloutDecision steps up after canary window expires when health gate is healthy', () => {
  const result = applyRolloutDecision({
    baseline: 'baseline-v1',
    candidate: 'candidate-v2',
    candidateRatio: 0.1,
    initializedAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    lastRatioChangeAt: '2026-03-08T00:00:00.000Z',
    canaryLockedUntil: '2026-03-08T02:00:00.000Z',
    healthGateStatus: 'healthy',
    lastHealthCheckAt: '2026-03-08T02:30:00.000Z',
    healthWindowStartAt: '2026-03-08T00:00:00.000Z',
    healthSamples: null,
    healthChecks: null,
    healthRollbackApplied: false,
  }, config, {
    decision: 'adopt_candidate',
    deltas: {
      successRate: 0.05,
      avgLatencyMs: 20,
      avgTokenTotal: 10,
      avgCostUsd: 0.001,
    },
  }, { nowMs: Date.parse('2026-03-08T03:00:00.000Z') });

  assert.equal(result.canaryHoldApplied, false);
  assert.equal(result.healthGateHoldApplied, false);
  assert.equal(result.state.candidateRatio, 0.3);
  const canary = getCanaryWindowStatus(result.state, config, Date.parse('2026-03-08T03:00:00.000Z'));
  assert.equal(canary.active, true);
  assert.equal(result.state.lastRatioChangeAt, '2026-03-08T03:00:00.000Z');
  assert.equal(result.state.canaryLockedUntil, '2026-03-08T05:00:00.000Z');
  assert.equal(getHealthGateState(result.state).status, 'pending');
});

test('applyRolloutDecision holds ratio after canary window when health gate lacks samples', () => {
  const result = applyRolloutDecision({
    baseline: 'baseline-v1',
    candidate: 'candidate-v2',
    candidateRatio: 0.1,
    initializedAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T02:10:00.000Z',
    lastRatioChangeAt: '2026-03-08T00:00:00.000Z',
    canaryLockedUntil: '2026-03-08T02:00:00.000Z',
    healthGateStatus: 'insufficient_samples',
    lastHealthCheckAt: '2026-03-08T02:10:00.000Z',
    healthWindowStartAt: '2026-03-08T00:00:00.000Z',
    healthSamples: null,
    healthChecks: null,
    healthRollbackApplied: false,
  }, config, {
    decision: 'adopt_candidate',
    deltas: {
      successRate: 0.05,
      avgLatencyMs: 20,
      avgTokenTotal: 10,
      avgCostUsd: 0.001,
    },
  }, { nowMs: Date.parse('2026-03-08T03:00:00.000Z') });

  assert.equal(result.healthGateHoldApplied, true);
  assert.equal(result.healthRollbackApplied, false);
  assert.equal(result.state.candidateRatio, 0.1);
});

test('applyRolloutDecision rolls back when health gate turns critical', () => {
  const result = applyRolloutDecision({
    baseline: 'baseline-v1',
    candidate: 'candidate-v2',
    candidateRatio: 0.3,
    initializedAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T02:10:00.000Z',
    lastRatioChangeAt: '2026-03-08T00:00:00.000Z',
    canaryLockedUntil: '2026-03-08T02:00:00.000Z',
    healthGateStatus: 'critical',
    lastHealthCheckAt: '2026-03-08T02:10:00.000Z',
    healthWindowStartAt: '2026-03-08T00:00:00.000Z',
    healthSamples: null,
    healthChecks: null,
    healthRollbackApplied: false,
  }, config, {
    decision: 'adopt_candidate',
    deltas: {
      successRate: 0.05,
      avgLatencyMs: 20,
      avgTokenTotal: 10,
      avgCostUsd: 0.001,
    },
  }, { nowMs: Date.parse('2026-03-08T03:00:00.000Z') });

  assert.equal(result.healthRollbackApplied, true);
  assert.equal(result.state.candidateRatio, 0);
  assert.equal(result.state.canaryLockedUntil, null);
  assert.equal(result.state.healthRollbackApplied, true);
});

test('evaluateHealthGate reports healthy when the current rollout window is stable', () => {
  const result = evaluateHealthGate({
    baseline: 'baseline-v1',
    candidate: 'candidate-v2',
    candidateRatio: 0.1,
    lastRatioChangeAt: '2026-03-08T00:00:00.000Z',
  }, config, [
    { ts: '2026-03-08T00:10:00.000Z', variant: 'baseline-v1', success: true, latencyMs: 100, tokenTotal: 100, costUsd: 0.01, source: 'manual' },
    { ts: '2026-03-08T00:20:00.000Z', variant: 'baseline-v1', success: true, latencyMs: 110, tokenTotal: 105, costUsd: 0.01, source: 'manual' },
    { ts: '2026-03-08T00:30:00.000Z', variant: 'baseline-v1', success: false, latencyMs: 90, tokenTotal: 95, costUsd: 0.01, source: 'manual' },
    { ts: '2026-03-08T00:11:00.000Z', variant: 'candidate-v2', success: true, latencyMs: 120, tokenTotal: 120, costUsd: 0.014, source: 'manual' },
    { ts: '2026-03-08T00:21:00.000Z', variant: 'candidate-v2', success: true, latencyMs: 115, tokenTotal: 125, costUsd: 0.015, source: 'manual' },
    { ts: '2026-03-08T00:31:00.000Z', variant: 'candidate-v2', success: true, latencyMs: 105, tokenTotal: 110, costUsd: 0.014, source: 'manual' },
  ], {
    nowMs: Date.parse('2026-03-08T02:10:00.000Z'),
  });

  assert.equal(result.status, 'healthy');
  assert.equal(result.rollbackRecommended, false);
  assert.equal(result.checks.sampleChecks.baselineSamples, true);
  assert.equal(result.checks.sampleChecks.candidateSamples, true);
});