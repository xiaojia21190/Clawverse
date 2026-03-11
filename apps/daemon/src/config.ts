import { DaemonConfig, DEFAULT_CONFIG } from '@clawverse/types';
import { loadRingConfig } from './ring-config.js';

export function loadConfig(): DaemonConfig {
  const defaultEvolution = DEFAULT_CONFIG.evolution;
  const defaultCooldowns = defaultEvolution.cooldowns.stepMs;
  const topic = process.env.CLAWVERSE_TOPIC || DEFAULT_CONFIG.topic;
  const orchestrationMode = DEFAULT_CONFIG.autonomy.orchestrationMode;

  return {
    port: parseInt(process.env.CLAWVERSE_PORT || String(DEFAULT_CONFIG.port), 10),
    topic,
    heartbeatInterval: parseInt(
      process.env.CLAWVERSE_HEARTBEAT_INTERVAL || String(DEFAULT_CONFIG.heartbeatInterval),
      10
    ),
    debug: process.env.CLAWVERSE_DEBUG === 'true',
    ring: loadRingConfig(topic),
    autonomy: {
      orchestrationMode,
    },
    evolution: {
      enabled: process.env.CLAWVERSE_EVOLUTION_ENABLED
        ? process.env.CLAWVERSE_EVOLUTION_ENABLED === 'true'
        : defaultEvolution.enabled,
      variant: process.env.CLAWVERSE_EVOLUTION_VARIANT || defaultEvolution.variant,
      flushEvery: parseInt(
        process.env.CLAWVERSE_EPISODES_FLUSH_EVERY || String(defaultEvolution.flushEvery),
        10
      ),
      heartbeatSampleEvery: parseInt(
        process.env.CLAWVERSE_HEARTBEAT_SAMPLE_EVERY || String(defaultEvolution.heartbeatSampleEvery),
        10
      ),
      autopilot: {
        enabled: process.env.CLAWVERSE_EVOLUTION_AUTOPILOT_ENABLED
          ? process.env.CLAWVERSE_EVOLUTION_AUTOPILOT_ENABLED === 'true'
          : defaultEvolution.autopilot.enabled,
        intervalMs: parseInt(
          process.env.CLAWVERSE_EVOLUTION_AUTOPILOT_INTERVAL_MS || String(defaultEvolution.autopilot.intervalMs),
          10
        ),
        minEpisodeDelta: parseInt(
          process.env.CLAWVERSE_EVOLUTION_AUTOPILOT_MIN_EPISODE_DELTA || String(defaultEvolution.autopilot.minEpisodeDelta),
          10
        ),
      },
      cooldowns: {
        globalMs: parseInt(
          process.env.CLAWVERSE_EVOLUTION_RUN_COOLDOWN_MS || String(defaultEvolution.cooldowns.globalMs),
          10
        ),
        stepMs: {
          propose: parseInt(
            process.env.CLAWVERSE_EVOLUTION_PROPOSE_COOLDOWN_MS || String(defaultCooldowns.propose),
            10
          ),
          evaluate: parseInt(
            process.env.CLAWVERSE_EVOLUTION_EVALUATE_COOLDOWN_MS || String(defaultCooldowns.evaluate),
            10
          ),
          decide: parseInt(
            process.env.CLAWVERSE_EVOLUTION_DECIDE_COOLDOWN_MS || String(defaultCooldowns.decide),
            10
          ),
          healthCheck: parseInt(
            process.env.CLAWVERSE_EVOLUTION_HEALTH_CHECK_COOLDOWN_MS || String(defaultCooldowns.healthCheck),
            10
          ),
          applyRollout: parseInt(
            process.env.CLAWVERSE_EVOLUTION_APPLY_ROLLOUT_COOLDOWN_MS || String(defaultCooldowns.applyRollout),
            10
          ),
          cycle: parseInt(
            process.env.CLAWVERSE_EVOLUTION_CYCLE_COOLDOWN_MS || String(defaultCooldowns.cycle),
            10
          ),
          initRollout: parseInt(
            process.env.CLAWVERSE_EVOLUTION_INIT_ROLLOUT_COOLDOWN_MS || String(defaultCooldowns.initRollout),
            10
          ),
        },
      },
    },
  };
}
