# Collab System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add cross-peer capability loan — Peer A sends a `{context, question}` to Peer B, Peer B's OpenClaw executes it via `claude --print`, result returns over P2P.

**Architecture:** CollabSystem mirrors SocialSystem (pending queue, EventEmitter, file persistence). Two new proto message types (`TaskRequest` / `TaskResult`) carry payloads over P2P. collab-worker polls `/collab/pending`, executes, resolves — same pattern as social-worker.

**Tech Stack:** TypeScript + ESM, protobufjs (runtime proto load, no protoc), Fastify, tsx (dev runner), pnpm workspaces.

---

### Task 1: Protocol — add TaskRequest / TaskResult

**Files:**
- Modify: `packages/protocol/src/clawverse.proto`
- Modify: `packages/protocol/src/generated.ts`
- Modify: `packages/protocol/src/index.ts`

**Step 1: Edit clawverse.proto**

Replace the `ClawverseMessage` block and add two new message definitions at the bottom:

```proto
message ClawverseMessage {
  uint32 version = 1;
  oneof payload {
    Heartbeat heartbeat = 2;
    YjsSync yjs_sync = 3;
    PeerAnnounce announce = 4;
    PrivateMessage private_msg = 5;
    TaskRequest task_request = 6;
    TaskResult task_result = 7;
  }
}
```

Append after the existing `PrivateMessage` definition:

```proto
message TaskRequest {
  string task_id = 1;
  string from_peer_id = 2;
  string from_name = 3;
  string context = 4;
  string question = 5;
  int64 ts = 6;
}

message TaskResult {
  string task_id = 1;
  bool success = 2;
  string result = 3;
  int64 ts = 4;
}
```

**Step 2: Edit generated.ts**

Add two new interfaces after `IPrivateMessage`:

```typescript
export interface ITaskRequest {
  taskId: string;
  fromPeerId: string;
  fromName: string;
  context: string;
  question: string;
  ts: number;
}

export interface ITaskResult {
  taskId: string;
  success: boolean;
  result: string;
  ts: number;
}
```

Update `IClawverseMessage` — add two optional fields:

```typescript
export interface IClawverseMessage {
  version: number;
  heartbeat?: IHeartbeat;
  yjsSync?: IYjsSync;
  announce?: IPeerAnnounce;
  privateMsg?: IPrivateMessage;
  taskRequest?: ITaskRequest;
  taskResult?: ITaskResult;
}
```

Update `MessagePayload` union — add two new variants:

```typescript
export type MessagePayload =
  | { type: 'heartbeat'; data: IHeartbeat }
  | { type: 'yjsSync'; data: IYjsSync }
  | { type: 'announce'; data: IPeerAnnounce }
  | { type: 'privateMsg'; data: IPrivateMessage }
  | { type: 'taskRequest'; data: ITaskRequest }
  | { type: 'taskResult'; data: ITaskResult };
```

**Step 3: Edit index.ts**

Add `ITaskRequest` and `ITaskResult` to the import line at the top.

Append two factory functions after `createPrivateMessage`:

```typescript
export function createTaskRequest(data: ITaskRequest): IClawverseMessage {
  return { version: PROTOCOL_VERSION, taskRequest: data };
}

export function createTaskResult(data: ITaskResult): IClawverseMessage {
  return { version: PROTOCOL_VERSION, taskResult: data };
}
```

**Step 4: Verify TypeScript compiles**

```bash
cd packages/protocol && pnpm build
```

Expected: no errors.

**Step 5: Commit**

```bash
git add packages/protocol/src/clawverse.proto packages/protocol/src/generated.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): add TaskRequest and TaskResult message types"
```

---

### Task 2: CollabSystem class

**Files:**
- Create: `apps/daemon/src/collab.ts`

**Step 1: Create the file**

```typescript
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

  constructor() {
    mkdirSync(dirname(TASKS_PATH), { recursive: true });
    mkdirSync(dirname(STATS_PATH), { recursive: true });
    this._loadStats();
  }

  init(opts: {
    sendResult: (toPeerId: string, taskId: string, result: string, success: boolean) => Promise<void>;
  }): void {
    this.sendResult = opts.sendResult;
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
```

**Step 2: Verify**

```bash
cd apps/daemon && pnpm build
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/daemon/src/collab.ts
git commit -m "feat(daemon): add CollabSystem (pending queue, stats, reputation)"
```

---

### Task 3: HTTP endpoints

**Files:**
- Modify: `apps/daemon/src/http.ts`

**Step 1: Add `collab` to APIContext**

In the `APIContext` interface, add one field after `social`:

```typescript
collab: CollabSystem;
```

Add the import at the top of the file:

```typescript
import { CollabSystem } from './collab.js';
```

**Step 2: Add 4 new routes**

Paste the following block before the SSE routes (i.e., before the `// SSE: peer state stream` comment):

```typescript
  // Collab: submit a capability loan task to a peer
  fastify.post<{
    Body: { to: string; context: string; question: string };
  }>('/collab/submit', async (request, reply) => {
    const { to, context, question } = request.body || {};
    if (!to || typeof context !== 'string' || typeof question !== 'string') {
      reply.code(400);
      return { error: 'to, context, and question are required' };
    }
    const task = context.collab.submitTask(to, context, question);
    return { ok: true, taskId: task.id };
  });

  // Collab: collab-worker polls for incoming tasks to execute
  fastify.get('/collab/pending', async () =>
    context.collab.getPendingIncoming()
  );

  // Collab: collab-worker resolves an incoming task with its result
  fastify.post<{
    Body: { id: string; result: string; success: boolean };
  }>('/collab/resolve', async (request, reply) => {
    const { id, result, success } = request.body || {};
    if (!id || typeof result !== 'string' || typeof success !== 'boolean') {
      reply.code(400);
      return { error: 'id, result, and success are required' };
    }
    const ok = await context.collab.resolve(id, result, success);
    if (!ok) {
      reply.code(404);
      return { error: 'Task not found or already resolved' };
    }
    return { ok: true };
  });

  // Collab: per-peer collaboration stats
  fastify.get('/collab/stats', async () =>
    context.collab.getStats()
  );
```

**Important:** The `/collab/submit` handler has a variable shadowing bug in the template above — `context` is used both as the Fastify route context and the body field. Fix it by destructuring the body differently:

```typescript
  fastify.post<{
    Body: { to: string; context: string; question: string };
  }>('/collab/submit', async (request, reply) => {
    const body = request.body || {} as any;
    if (!body.to || typeof body.context !== 'string' || typeof body.question !== 'string') {
      reply.code(400);
      return { error: 'to, context, and question are required' };
    }
    const task = context.collab.submitTask(body.to, body.context, body.question);
    return { ok: true, taskId: task.id };
  });
```

**Step 3: Verify**

```bash
cd apps/daemon && pnpm build
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/daemon/src/http.ts
git commit -m "feat(http): add /collab endpoints (submit, pending, resolve, stats)"
```

---

### Task 4: Wire CollabSystem into daemon

**Files:**
- Modify: `apps/daemon/src/index.ts`

**Step 1: Import CollabSystem and protocol factories**

Add to the existing import block (around line 9):

```typescript
import { CollabSystem } from './collab.js';
```

Add `createTaskRequest` and `createTaskResult` to the existing `@clawverse/protocol` import:

```typescript
import { createHeartbeat, createYjsSync, createAnnounce, createTaskRequest, createTaskResult } from '@clawverse/protocol';
```

**Step 2: Instantiate CollabSystem after SocialSystem**

After the `social.init(...)` block, add:

```typescript
// Initialize Collab System
const collab = new CollabSystem();
collab.init({
  sendResult: async (toPeerId, taskId, result, success) => {
    const msg = createTaskResult({
      taskId,
      success,
      result,
      ts: Date.now(),
    });
    await network.sendTo(toPeerId, msg).catch((err) => {
      logger.warn(`[collab] Failed to send TaskResult to ${toPeerId}: ${(err as Error).message}`);
    });
  },
});
```

**Step 3: Pass `collab` to createHttpServer**

In the `createHttpServer(config.port, {...})` call, add:

```typescript
  collab,
```

**Step 4: Handle incoming P2P task messages**

Inside the `network.on('message', (peerId, message) => { ... })` handler, add two new `if` blocks after the existing `message.yjsSync` block:

```typescript
  if (message.taskRequest) {
    const tr = message.taskRequest;
    collab.enqueueIncoming({
      taskId: tr.taskId,
      fromPeerId: tr.fromPeerId,
      fromName: tr.fromName,
      context: tr.context,
      question: tr.question,
    });
  }

  if (message.taskResult) {
    const tr = message.taskResult;
    collab.onResultReceived(tr.taskId, tr.result, tr.success);
  }
```

**Step 5: Wire submit to network.sendTo**

The `submitTask` in CollabSystem stores the task but does not send it over P2P — that must happen in index.ts. Replace the simple `context.collab.submitTask(...)` call pattern by doing the send after submit.

In `http.ts`, the `/collab/submit` route calls `context.collab.submitTask(...)`. We need to also trigger a P2P send. The cleanest way: add a `onSubmit` callback to CollabSystem, similar to `sendResult`.

**Edit `collab.ts`**: add an `onSubmit` callback field and call it in `submitTask`:

```typescript
// Add field after sendResult:
private onSubmit: ((task: CollabTask) => Promise<void>) | null = null;

// Add to init opts:
init(opts: {
  sendResult: (toPeerId: string, taskId: string, result: string, success: boolean) => Promise<void>;
  onSubmit: (task: CollabTask) => Promise<void>;
}): void {
  this.sendResult = opts.sendResult;
  this.onSubmit = opts.onSubmit;
}

// At end of submitTask, before return:
if (this.onSubmit) this.onSubmit(ct).catch(() => {});
```

**Edit `index.ts`**: add `onSubmit` to `collab.init(...)`:

```typescript
collab.init({
  onSubmit: async (task) => {
    const myState = stateStore.getMyState();
    const msg = createTaskRequest({
      taskId: task.id,
      fromPeerId: myId,
      fromName: myState?.name ?? myId.slice(0, 8),
      context: task.context,
      question: task.question,
      ts: Date.now(),
    });
    await network.sendTo(task.from, msg).catch((err) => {
      logger.warn(`[collab] Failed to send TaskRequest to ${task.from}: ${(err as Error).message}`);
    });
  },
  sendResult: async (toPeerId, taskId, result, success) => {
    const msg = createTaskResult({ taskId, success, result, ts: Date.now() });
    await network.sendTo(toPeerId, msg).catch((err) => {
      logger.warn(`[collab] Failed to send TaskResult to ${toPeerId}: ${(err as Error).message}`);
    });
  },
});
```

**Step 6: Verify daemon builds and starts**

```bash
cd apps/daemon && pnpm build
```

Expected: no errors.

Start daemon in dev mode and confirm no startup crash:

```bash
cd apps/daemon && pnpm dev
```

Expected: `Daemon running. Press Ctrl+C to stop.` with no error lines.

**Step 7: Quick smoke test — check endpoints exist**

With daemon running:

```bash
curl http://127.0.0.1:19820/collab/pending
# Expected: []

curl http://127.0.0.1:19820/collab/stats
# Expected: []
```

**Step 8: Commit**

```bash
git add apps/daemon/src/index.ts apps/daemon/src/collab.ts
git commit -m "feat(daemon): wire CollabSystem, handle P2P TaskRequest/TaskResult"
```

---

### Task 5: collab-worker

**Files:**
- Create: `apps/connector-skill/src/collab-worker.ts`
- Modify: `apps/connector-skill/package.json`

**Step 1: Create collab-worker.ts**

```typescript
/**
 * Clawverse Collab Worker
 * Runs inside OpenClaw environment.
 *
 * Flow (every POLL_INTERVAL_MS):
 *   1. GET /collab/pending — fetch tasks submitted by remote peers
 *   2. For each task: claude --print to answer
 *   3. POST /collab/resolve with result
 *   4. POST /evolution/episode to record outcome
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const execFileAsync = promisify(execFile);

const DAEMON_URL = process.env.CLAWVERSE_DAEMON_URL || 'http://127.0.0.1:19820';
const POLL_INTERVAL_MS = Number(process.env.CLAWVERSE_COLLAB_POLL_MS || 60_000);
const CLAUDE_MODEL = process.env.CLAWVERSE_COLLAB_MODEL || 'claude-haiku-4-5';
const COLLAB_LOG = resolve(process.cwd(), 'data/collab/worker.log');

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  mkdirSync(dirname(COLLAB_LOG), { recursive: true });
  appendFileSync(COLLAB_LOG, line + '\n');
}

interface CollabTask {
  id: string;
  fromName: string;
  context: string;
  question: string;
}

async function reportEpisode(success: boolean, latencyMs: number): Promise<void> {
  try {
    await fetch(`${DAEMON_URL}/evolution/episode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success, latencyMs, source: 'task-runtime', variant: 'collab-execution' }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch { /* non-critical */ }
}

async function poll(): Promise<void> {
  let tasks: CollabTask[];
  try {
    const res = await fetch(`${DAEMON_URL}/collab/pending`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return;
    tasks = (await res.json()) as CollabTask[];
  } catch {
    return;
  }

  if (tasks.length === 0) return;
  log(`Processing ${tasks.length} pending collab task(s)...`);

  for (const task of tasks) {
    log(`  Task from ${task.fromName}: "${task.question.slice(0, 60)}"`);

    const prompt = [
      `${task.fromName} asks for your help:`,
      ``,
      task.context,
      ``,
      task.question,
      ``,
      `Answer concisely and helpfully.`,
    ].join('\n');

    let result = '';
    let success = false;
    const t0 = Date.now();

    try {
      const { stdout } = await execFileAsync(
        'claude',
        ['--print', '--model', CLAUDE_MODEL, '-p', prompt],
        { timeout: 60_000 },
      );
      result = stdout.trim();
      success = result.length > 0;
    } catch (err) {
      log(`  claude --print failed: ${(err as Error).message}`);
    }

    const latencyMs = Date.now() - t0;

    try {
      const res = await fetch(`${DAEMON_URL}/collab/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: task.id, result, success }),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        log(`  Resolved (${latencyMs}ms): "${result.slice(0, 80)}"`);
      } else {
        log(`  Resolve rejected: ${res.status}`);
        success = false;
      }
    } catch (err) {
      log(`  Resolve error: ${(err as Error).message}`);
      success = false;
    }

    reportEpisode(success, latencyMs).catch(() => {});
  }
}

log('Clawverse Collab Worker started');
log(`  Daemon: ${DAEMON_URL}`);
log(`  Model: ${CLAUDE_MODEL}`);
log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);

poll().catch((err) => log(`Poll error: ${(err as Error).message}`));
const timer = setInterval(() => {
  poll().catch((err) => log(`Poll error: ${(err as Error).message}`));
}, POLL_INTERVAL_MS);

process.on('SIGINT', () => { clearInterval(timer); log('Collab worker stopped.'); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(timer); log('Collab worker stopped.'); process.exit(0); });
```

**Step 2: Add script to package.json**

In `apps/connector-skill/package.json`, add to `scripts`:

```json
"collab": "tsx src/collab-worker.ts",
```

**Step 3: Verify**

```bash
cd apps/connector-skill && pnpm build
```

Expected: no errors.

**Step 4: Integration smoke test**

With daemon running, test the full local cycle (simulating a self-task for smoke test):

```bash
# Submit a task to yourself (use your own peerId from /status)
PEER_ID=$(curl -s http://127.0.0.1:19820/status | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
curl -s -X POST http://127.0.0.1:19820/collab/submit \
  -H 'content-type: application/json' \
  -d "{\"to\":\"$PEER_ID\",\"context\":\"My CPU is 40%.\",\"question\":\"Am I running healthy?\"}"
# Expected: {"ok":true,"taskId":"col-..."}

# Check it appeared in pending
curl -s http://127.0.0.1:19820/collab/pending
# Expected: [{id: "col-...", fromName: "", ...}]

# Run the worker once
cd apps/connector-skill && pnpm collab
# Expected: worker logs processing the task, resolves, then exits (or wait for next poll)

# Check stats
curl -s http://127.0.0.1:19820/collab/stats
# Expected: [{"peerId":"...", "tasksReceived":1, "successCount":1, ...}]
```

**Step 5: Commit**

```bash
git add apps/connector-skill/src/collab-worker.ts apps/connector-skill/package.json
git commit -m "feat(connector-skill): add collab-worker (capability loan executor)"
```

---

## Summary

| Task | Key Change | Verify |
|------|-----------|--------|
| 1. Protocol | .proto + generated.ts + index.ts | `pnpm build` in packages/protocol |
| 2. CollabSystem | New collab.ts | `pnpm build` in apps/daemon |
| 3. HTTP routes | 4 new endpoints in http.ts | `pnpm build` in apps/daemon |
| 4. Daemon wiring | index.ts: instantiate, P2P handlers | daemon starts clean, curl /collab/pending returns [] |
| 5. collab-worker | New collab-worker.ts | full smoke test cycle |

After all 5 tasks: `GET /evolution/stats` will show `byVariant.collab-execution` alongside `social-dialogue`, `walk-decision`, `soul-enrichment`.
