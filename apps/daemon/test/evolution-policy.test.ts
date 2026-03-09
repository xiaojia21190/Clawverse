import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseEvolutionPolicyAction } from '../src/evolution-policy.js';

test('policy proposes when no proposal exists yet', () => {
  const action = chooseEvolutionPolicyAction({
    latest: null,
    rollout: null,
    cooldowns: { globalActive: false, byStep: {} },
  });
  assert.equal(action?.step, 'propose');
});

test('policy evaluates when proposal exists but report is missing', () => {
  const action = chooseEvolutionPolicyAction({
    latest: { proposalId: 'proposal-1', report: null, decision: null },
    cooldowns: { globalActive: false, byStep: {} },
  });
  assert.equal(action?.step, 'evaluate');
});

test('policy decides when report exists but decision is missing', () => {
  const action = chooseEvolutionPolicyAction({
    latest: { proposalId: 'proposal-1', report: {}, decision: null },
    cooldowns: { globalActive: false, byStep: {} },
  });
  assert.equal(action?.step, 'decide');
});

test('policy health-checks adopted candidate after canary ends with pending gate', () => {
  const action = chooseEvolutionPolicyAction({
    latest: { proposalId: 'proposal-1', report: {}, decision: { decision: 'adopt_candidate' } },
    rollout: {
      candidateRatio: 0.3,
      canary: { active: false },
      healthGate: { status: 'pending' },
    },
    cooldowns: { globalActive: false, byStep: {} },
  });
  assert.equal(action?.step, 'health-check');
});

test('policy applies rollout after healthy adopted candidate canary', () => {
  const action = chooseEvolutionPolicyAction({
    latest: { proposalId: 'proposal-1', report: {}, decision: { decision: 'adopt_candidate' } },
    rollout: {
      candidateRatio: 0.3,
      canary: { active: false },
      healthGate: { status: 'healthy' },
    },
    cooldowns: { globalActive: false, byStep: {} },
  });
  assert.equal(action?.step, 'apply-rollout');
});

test('policy applies rollout rollback for keep_baseline with candidate traffic still live', () => {
  const action = chooseEvolutionPolicyAction({
    latest: { proposalId: 'proposal-1', report: {}, decision: { decision: 'keep_baseline' } },
    rollout: {
      candidateRatio: 0.2,
      canary: { active: false },
      healthGate: { status: 'healthy' },
    },
    cooldowns: { globalActive: false, byStep: {} },
  });
  assert.equal(action?.step, 'apply-rollout');
});

test('policy stands down during global cooldown', () => {
  const action = chooseEvolutionPolicyAction({
    latest: { proposalId: 'proposal-1', report: null, decision: null },
    cooldowns: { globalActive: true, byStep: {} },
  });
  assert.equal(action, null);
});

test('policy stands down when target step is cooling down', () => {
  const action = chooseEvolutionPolicyAction({
    latest: { proposalId: 'proposal-1', report: null, decision: null },
    cooldowns: { globalActive: false, byStep: { evaluate: { active: true } } },
  });
  assert.equal(action, null);
});

test('policy waits for enough episodes before first evaluate when min delta is configured', () => {
  const action = chooseEvolutionPolicyAction({
    config: { autopilot: { minEpisodeDelta: 12 } },
    stats: { total: 8 },
    latest: { proposalId: 'proposal-1', report: null, decision: null },
    cooldowns: { globalActive: false, byStep: {} },
  });
  assert.equal(action, null);
});

test('policy waits for enough new episodes before reevaluating a hold decision', () => {
  const action = chooseEvolutionPolicyAction({
    config: { autopilot: { minEpisodeDelta: 10 } },
    stats: { total: 14 },
    latest: {
      proposalId: 'proposal-1',
      report: { sampleSize: 9 },
      decision: { decision: 'hold' },
    },
    cooldowns: { globalActive: false, byStep: {} },
  });
  assert.equal(action, null);
});
