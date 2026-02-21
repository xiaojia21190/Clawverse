import { DaemonConfig, DEFAULT_CONFIG } from '@clawverse/types';

export function loadConfig(): DaemonConfig {
  return {
    port: parseInt(process.env.CLAWVERSE_PORT || String(DEFAULT_CONFIG.port), 10),
    topic: process.env.CLAWVERSE_TOPIC || DEFAULT_CONFIG.topic,
    heartbeatInterval: parseInt(
      process.env.CLAWVERSE_HEARTBEAT_INTERVAL || String(DEFAULT_CONFIG.heartbeatInterval),
      10
    ),
    debug: process.env.CLAWVERSE_DEBUG === 'true',
    evolution: {
      enabled: process.env.CLAWVERSE_EVOLUTION_ENABLED
        ? process.env.CLAWVERSE_EVOLUTION_ENABLED === 'true'
        : DEFAULT_CONFIG.evolution.enabled,
      variant: process.env.CLAWVERSE_EVOLUTION_VARIANT || DEFAULT_CONFIG.evolution.variant,
      episodesPath: process.env.CLAWVERSE_EPISODES_PATH || DEFAULT_CONFIG.evolution.episodesPath,
      flushEvery: parseInt(
        process.env.CLAWVERSE_EPISODES_FLUSH_EVERY || String(DEFAULT_CONFIG.evolution.flushEvery),
        10
      ),
      heartbeatSampleEvery: parseInt(
        process.env.CLAWVERSE_HEARTBEAT_SAMPLE_EVERY || String(DEFAULT_CONFIG.evolution.heartbeatSampleEvery),
        10
      ),
    },
  };
}
