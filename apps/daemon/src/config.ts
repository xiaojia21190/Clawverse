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
  };
}
