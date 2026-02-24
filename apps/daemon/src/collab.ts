import { logger } from './logger.js';
import { ClawverseDbHandle, openClawverseDb } from './sqlite.js';

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

export interface CollabSubmitResult {
  task: CollabTask;
  submitted: boolean;
  error?: string;
}

export class CollabSystem {
  private readonly dbHandle: ClawverseDbHandle;
  private incoming: Map<string, CollabTask> = new Map();
  private outgoing: Map<string, CollabTask> = new Map();
  private stats: Map<string, CollabPeerStats> = new Map();
  private sendResult: ((toPeerId: string, taskId: string, result: string, success: boolean) => Promise<void>) | null = null;
  private onSubmit: ((task: CollabTask) => Promise<boolean>) | null = null;

  constructor(opts?: { dbPath?: string }) {
    this.dbHandle = openClawverseDb(opts?.dbPath);
    this._loadStats();
  }

  init(opts: {
    sendResult: (toPeerId: string, taskId: string, result: string, success: boolean) => Promise<void>;
    onSubmit: (task: CollabTask) => Promise<boolean>;
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
    this._appendTaskLog('in', ct);
    logger.info(`[collab] Task received from ${ct.fromName}: "${ct.question.slice(0, 60)}"`);
  }

  async submitTask(to: string, context: string, question: string): Promise<CollabSubmitResult> {
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

    let submitted = false;
    let error: string | undefined;

    if (!this.onSubmit) {
      error = 'submit_handler_not_initialized';
    } else {
      try {
        submitted = await this.onSubmit(ct);
        if (!submitted) error = 'send_to_peer_failed';
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }

    if (!submitted) {
      this.outgoing.delete(id);
      this._appendTaskLog('out-failed', ct, error);
      logger.warn(`[collab] Task submit failed to ${to}: ${error ?? 'unknown'}`);
      return { task: ct, submitted: false, error };
    }

    const s = this._getOrCreateStats(to);
    s.tasksSent += 1;
    this._saveStats();
    this._appendTaskLog('out', ct);
    return { task: ct, submitted: true };
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

  async destroy(): Promise<void> {
    this.dbHandle.close();
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
    const rows = this.dbHandle.db.prepare(`
      SELECT peer_id, tasks_received, tasks_sent, success_count, reputation_delta
      FROM collab_stats
    `).all() as Array<{
      peer_id: string;
      tasks_received: number;
      tasks_sent: number;
      success_count: number;
      reputation_delta: number;
    }>;

    for (const row of rows) {
      this.stats.set(row.peer_id, {
        peerId: row.peer_id,
        tasksReceived: row.tasks_received,
        tasksSent: row.tasks_sent,
        successCount: row.success_count,
        reputationDelta: row.reputation_delta,
      });
    }
  }

  private _saveStats(): void {
    const db = this.dbHandle.db;
    const upsert = this.dbHandle.db.prepare(`
      INSERT INTO collab_stats (
        peer_id, tasks_received, tasks_sent, success_count, reputation_delta
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(peer_id) DO UPDATE SET
        tasks_received = excluded.tasks_received,
        tasks_sent = excluded.tasks_sent,
        success_count = excluded.success_count,
        reputation_delta = excluded.reputation_delta
    `);

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const stat of this.stats.values()) {
        upsert.run(
          stat.peerId,
          stat.tasksReceived,
          stat.tasksSent,
          stat.successCount,
          stat.reputationDelta
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    }
  }

  private _appendTaskLog(dir: string, task: CollabTask, error?: string): void {
    this.dbHandle.db.prepare(`
      INSERT INTO collab_logs (ts, dir, task_id, peer_id, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      dir,
      task.id,
      task.from,
      JSON.stringify({ ...task, error })
    );
  }
}
