import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { logger } from './logger.js';

const TASKS_PATH = resolve(process.cwd(), 'data/collab/tasks.jsonl');
const STATS_PATH = resolve(process.cwd(), 'data/collab/stats.json');

export interface CollabTask {
  id: string;
  ts: string;
  from: string;
  fromName: string;
  context: string;
  question: string;
  resolved: boolean;
}

export interface CollabPeerStats {
  peerId: string;
  tasksReceived: number;
  tasksSent: number;
  successCount: number;
  reputationDelta: number;
}

export class CollabSystem {
  private incoming: Map<string, CollabTask> = new Map();
  private outgoing: Map<string, CollabTask> = new Map();
  private stats: Map<string, CollabPeerStats> = new Map();
  private sendResult: ((toPeerId: string, taskId: string, result: string, success: boolean) => Promise<void>) | null = null;
  private onSubmit: ((task: CollabTask) => Promise<void>) | null = null;

  constructor() {
    mkdirSync(dirname(TASKS_PATH), { recursive: true });
    mkdirSync(dirname(STATS_PATH), { recursive: true });
    this._loadStats();
  }

  init(opts: {
    sendResult: (toPeerId: string, taskId: string, result: string, success: boolean) => Promise<void>;
    onSubmit: (task: CollabTask) => Promise<void>;
  }): void {
    this.sendResult = opts.sendResult;
    this.onSubmit = opts.onSubmit;
  }

  enqueueIncoming(task: {
    taskId: string;
    fromPeerId: string;
    fromName: string;
    context: string;
    question: string;
  }): void {
    const ct: CollabTask = {
      id: task.taskId,
      ts: new Date().toISOString(),
      from: task.fromPeerId,
      fromName: task.fromName,
      context: task.context,
      question: task.question,
      resolved: false,
    };
    this.incoming.set(ct.id, ct);
    const s = this._getOrCreateStats(ct.from);
    s.tasksReceived += 1;
    this._saveStats();
    appendFileSync(TASKS_PATH, JSON.stringify({ dir: 'in', ...ct }) + '\n');
    logger.info(`[collab] Task received from ${ct.fromName}: "${ct.question.slice(0, 60)}"`);
  }

  submitTask(to: string, context: string, question: string): CollabTask {
    const id = `col-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const ct: CollabTask = {
      id,
      ts: new Date().toISOString(),
      from: to,
      fromName: '',
      context,
      question,
      resolved: false,
    };
    this.outgoing.set(id, ct);
    const s = this._getOrCreateStats(to);
    s.tasksSent += 1;
    this._saveStats();
    appendFileSync(TASKS_PATH, JSON.stringify({ dir: 'out', ...ct }) + '\n');
    if (this.onSubmit) this.onSubmit(ct).catch(() => {});
    return ct;
  }

  async resolve(id: string, result: string, success: boolean): Promise<boolean> {
    const task = this.incoming.get(id);
    if (!task || task.resolved) return false;

    task.resolved = true;
    this.incoming.delete(id);

    const s = this._getOrCreateStats(task.from);
    if (success) { s.successCount += 1; s.reputationDelta += 1; }
    else { s.reputationDelta -= 1; }
    this._saveStats();

    logger.info(`[collab] Resolved task ${id} (success=${success}): "${result.slice(0, 60)}"`);

    if (this.sendResult) {
      await this.sendResult(task.from, id, result, success);
    }
    return true;
  }

  onResultReceived(taskId: string, result: string, success: boolean): void {
    const task = this.outgoing.get(taskId);
    if (!task) return;
    this.outgoing.delete(taskId);
    const s = this._getOrCreateStats(task.from);
    if (success) { s.successCount += 1; s.reputationDelta += 1; }
    else { s.reputationDelta -= 1; }
    this._saveStats();
    logger.info(`[collab] Result received for task ${taskId}: "${result.slice(0, 60)}"`);
  }

  getPendingIncoming(): CollabTask[] {
    return Array.from(this.incoming.values()).filter((t) => !t.resolved);
  }

  getStats(): CollabPeerStats[] {
    return Array.from(this.stats.values());
  }

  private _getOrCreateStats(peerId: string): CollabPeerStats {
    if (!this.stats.has(peerId)) {
      this.stats.set(peerId, {
        peerId,
        tasksReceived: 0,
        tasksSent: 0,
        successCount: 0,
        reputationDelta: 0,
      });
    }
    return this.stats.get(peerId)!;
  }

  private _loadStats(): void {
    if (!existsSync(STATS_PATH)) return;
    try {
      const data = JSON.parse(readFileSync(STATS_PATH, 'utf8')) as Record<string, CollabPeerStats>;
      for (const [k, v] of Object.entries(data)) this.stats.set(k, v);
    } catch { /* ignore */ }
  }

  private _saveStats(): void {
    const obj: Record<string, CollabPeerStats> = {};
    for (const [k, v] of this.stats) obj[k] = v;
    writeFileSync(STATS_PATH, JSON.stringify(obj, null, 2));
  }
}
