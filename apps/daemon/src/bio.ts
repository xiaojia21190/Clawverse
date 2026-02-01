import si from 'systeminformation';
import { HardwareMetrics, Mood } from '@clawverse/types';
import { logger } from './logger.js';

export async function getHardwareMetrics(): Promise<HardwareMetrics> {
  const [cpu, mem, disk, osInfo, time, cpuLoad] = await Promise.all([
    si.cpu(),
    si.mem(),
    si.fsSize(),
    si.osInfo(),
    si.time(),
    si.currentLoad(),
  ]);

  const diskFree = disk.reduce((acc, d) => acc + d.available, 0) / (1024 ** 3); // GB

  return {
    cpuUsage: Math.round(cpuLoad.currentLoad),
    ramUsage: Math.round((mem.used / mem.total) * 100),
    ramTotal: Math.round(mem.total / (1024 ** 3)),
    diskFree: Math.round(diskFree),
    uptime: time.uptime,
    platform: osInfo.platform,
    hostname: osInfo.hostname,
    cpuModel: cpu.brand,
    cpuCores: cpu.cores,
  };
}

export function getMoodFromCpu(cpuUsage: number): Mood {
  if (cpuUsage < 20) return 'idle';
  if (cpuUsage < 60) return 'working';
  if (cpuUsage < 80) return 'busy';
  return 'stressed';
}

export class BioMonitor {
  private metrics: HardwareMetrics | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private updateInterval: number;

  constructor(updateInterval: number = 5000) {
    this.updateInterval = updateInterval;
  }

  async start(): Promise<void> {
    logger.info('Bio-Monitor starting...');

    // Initial read
    this.metrics = await getHardwareMetrics();
    logger.info(`Hardware: ${this.metrics.cpuModel} (${this.metrics.cpuCores} cores)`);
    logger.info(`Platform: ${this.metrics.platform}, Host: ${this.metrics.hostname}`);
    logger.info(`RAM: ${this.metrics.ramTotal}GB, Disk Free: ${this.metrics.diskFree}GB`);

    // Periodic updates
    this.intervalId = setInterval(async () => {
      try {
        this.metrics = await getHardwareMetrics();
        logger.debug(`CPU: ${this.metrics.cpuUsage}%, RAM: ${this.metrics.ramUsage}%`);
      } catch (err) {
        logger.error('Failed to read hardware metrics:', err);
      }
    }, this.updateInterval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('Bio-Monitor stopped');
  }

  getMetrics(): HardwareMetrics | null {
    return this.metrics;
  }

  getMood(): Mood {
    if (!this.metrics) return 'sleeping';
    return getMoodFromCpu(this.metrics.cpuUsage);
  }
}
