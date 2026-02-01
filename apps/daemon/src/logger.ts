const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function formatTime(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(level: LogLevel, prefix: string, ...args: unknown[]): void {
  if (LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]) {
    console.log(`[${formatTime()}] ${prefix}`, ...args);
  }
}

export const logger = {
  debug: (...args: unknown[]) => log('debug', '[DEBUG]', ...args),
  info: (...args: unknown[]) => log('info', '[CLAW]', ...args),
  warn: (...args: unknown[]) => log('warn', '[WARN]', ...args),
  error: (...args: unknown[]) => log('error', '[ERROR]', ...args),
  peer: (...args: unknown[]) => log('info', '[PEER]', ...args),
  network: (...args: unknown[]) => log('info', '[NET]', ...args),
};
