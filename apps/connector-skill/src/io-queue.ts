import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

type QueueWriteType = 'state' | 'append';

export interface FileWriteQueueOptions {
  stateDebounceMs?: number;
  stateRetryMs?: number;
  appendFlushMs?: number;
  appendRetryInitialMs?: number;
  appendRetryMaxMs?: number;
  appendBatchLines?: number;
  flushTimeoutMs?: number;
  onError?: (type: QueueWriteType, path: string, error: unknown) => void;
}

interface StateSlot {
  latest: string | null;
  timer: NodeJS.Timeout | null;
  writing: boolean;
}

interface AppendSlot {
  queue: string[];
  timer: NodeJS.Timeout | null;
  writing: boolean;
  retryMs: number;
}

export class FileWriteQueue {
  private readonly stateSlots = new Map<string, StateSlot>();
  private readonly appendSlots = new Map<string, AppendSlot>();
  private readonly stateDebounceMs: number;
  private readonly stateRetryMs: number;
  private readonly appendFlushMs: number;
  private readonly appendRetryInitialMs: number;
  private readonly appendRetryMaxMs: number;
  private readonly appendBatchLines: number;
  private readonly flushTimeoutMs: number;
  private readonly onError?: (type: QueueWriteType, path: string, error: unknown) => void;
  private destroyed = false;

  constructor(opts: FileWriteQueueOptions = {}) {
    this.stateDebounceMs = Math.max(0, opts.stateDebounceMs ?? 200);
    this.stateRetryMs = Math.max(10, opts.stateRetryMs ?? 1_000);
    this.appendFlushMs = Math.max(0, opts.appendFlushMs ?? 400);
    this.appendRetryInitialMs = Math.max(50, opts.appendRetryInitialMs ?? 500);
    this.appendRetryMaxMs = Math.max(this.appendRetryInitialMs, opts.appendRetryMaxMs ?? 5_000);
    this.appendBatchLines = Math.max(1, opts.appendBatchLines ?? 200);
    this.flushTimeoutMs = Math.max(100, opts.flushTimeoutMs ?? 3_000);
    this.onError = opts.onError;
  }

  scheduleStateWrite(path: string, value: unknown | string): void {
    if (this.destroyed) return;
    const payload = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const slot = this.getOrCreateStateSlot(path);
    slot.latest = payload;
    this.scheduleStateFlush(path, this.stateDebounceMs);
  }

  appendLine(path: string, line: string): void {
    if (this.destroyed) return;
    const slot = this.getOrCreateAppendSlot(path);
    slot.queue.push(line);
    if (slot.queue.length >= this.appendBatchLines) {
      this.scheduleAppendFlush(path, 0, true);
      return;
    }
    this.scheduleAppendFlush(path, this.appendFlushMs);
  }

  async flushNow(): Promise<void> {
    this.clearAllTimers();
    const deadline = Date.now() + this.flushTimeoutMs;

    while (this.hasPendingWork()) {
      await Promise.all(
        Array.from(this.stateSlots.keys()).map((path) => this.flushStatePath(path, false))
      );
      await Promise.all(
        Array.from(this.appendSlots.keys()).map((path) => this.flushAppendPath(path, false, true))
      );

      if (!this.hasPendingWork()) break;
      if (Date.now() >= deadline) break;
      await this.delay(10);
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.flushNow();
    this.clearAllTimers();
    this.stateSlots.clear();
    this.appendSlots.clear();
  }

  private getOrCreateStateSlot(path: string): StateSlot {
    if (!this.stateSlots.has(path)) {
      this.stateSlots.set(path, { latest: null, timer: null, writing: false });
    }
    return this.stateSlots.get(path)!;
  }

  private getOrCreateAppendSlot(path: string): AppendSlot {
    if (!this.appendSlots.has(path)) {
      this.appendSlots.set(path, {
        queue: [],
        timer: null,
        writing: false,
        retryMs: this.appendRetryInitialMs,
      });
    }
    return this.appendSlots.get(path)!;
  }

  private scheduleStateFlush(path: string, delayMs: number): void {
    const slot = this.getOrCreateStateSlot(path);
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = setTimeout(() => {
      slot.timer = null;
      void this.flushStatePath(path);
    }, Math.max(0, delayMs));
    slot.timer.unref?.();
  }

  private scheduleAppendFlush(path: string, delayMs: number, force = false): void {
    const slot = this.getOrCreateAppendSlot(path);
    if (slot.timer && !force && delayMs > 0) return;
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = setTimeout(() => {
      slot.timer = null;
      void this.flushAppendPath(path);
    }, Math.max(0, delayMs));
    slot.timer.unref?.();
  }

  private async flushStatePath(path: string, scheduleRetry = true): Promise<void> {
    const slot = this.stateSlots.get(path);
    if (!slot || slot.writing || slot.latest === null) return;

    const payload = slot.latest;
    slot.latest = null;
    slot.writing = true;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, payload, 'utf8');
    } catch (error) {
      if (slot.latest === null) slot.latest = payload;
      this.onError?.('state', path, error);
      if (scheduleRetry !== false) {
        this.scheduleStateFlush(path, this.stateRetryMs);
      }
    } finally {
      slot.writing = false;
      if (slot.latest !== null && !slot.timer && scheduleRetry !== false) {
        this.scheduleStateFlush(path, 0);
      }
    }
  }

  private async flushAppendPath(path: string, scheduleRetry = true, drainAll = false): Promise<void> {
    const slot = this.appendSlots.get(path);
    if (!slot || slot.writing || slot.queue.length === 0) return;

    const count = drainAll ? slot.queue.length : Math.min(slot.queue.length, this.appendBatchLines);
    const lines = slot.queue.splice(0, count);
    slot.writing = true;

    let writeFailed = false;
    try {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, lines.join(''), 'utf8');
      slot.retryMs = this.appendRetryInitialMs;
    } catch (error) {
      writeFailed = true;
      slot.queue.unshift(...lines);
      this.onError?.('append', path, error);
      if (scheduleRetry !== false) {
        this.scheduleAppendFlush(path, slot.retryMs, true);
        slot.retryMs = Math.min(slot.retryMs * 2, this.appendRetryMaxMs);
      }
    } finally {
      slot.writing = false;
      if (!writeFailed && slot.queue.length > 0 && !slot.timer && scheduleRetry !== false) {
        this.scheduleAppendFlush(path, 0, true);
      }
    }
  }

  private clearAllTimers(): void {
    for (const slot of this.stateSlots.values()) {
      if (slot.timer) {
        clearTimeout(slot.timer);
        slot.timer = null;
      }
    }
    for (const slot of this.appendSlots.values()) {
      if (slot.timer) {
        clearTimeout(slot.timer);
        slot.timer = null;
      }
    }
  }

  private hasPendingWork(): boolean {
    for (const slot of this.stateSlots.values()) {
      if (slot.writing || slot.latest !== null) return true;
    }
    for (const slot of this.appendSlots.values()) {
      if (slot.writing || slot.queue.length > 0) return true;
    }
    return false;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
