# Collab System Design — Capability Loan

Date: 2026-02-22

## Summary

Add cross-peer task collaboration to Clawverse via a "capability loan" model: Peer A borrows Peer B's Claude model to answer a question, with results returned asynchronously over P2P.

## Data Flow

```
Peer A                        P2P Network           Peer B daemon       Peer B OpenClaw
──────────────────────────────────────────────────────────────────────────────────────
POST /collab/submit         → TaskRequest msg →    enqueueIncoming()   ← poll /collab/pending
  {to, context, question}                          pending Map           claude --print
  stored in outgoing Map                                                 POST /collab/resolve
                            ← TaskResult msg  ←   sendTo(fromPeer)     reportEpisode()
  onResultReceived()
  update collab stats
```

- Peer A's `/collab/submit` returns immediately with `{ok, taskId}` (non-blocking).
- Result arrives asynchronously via P2P `TaskResult` message.
- collab-worker poll interval: 60s (independent of social-worker).

## Protocol Changes

Two new message types added to `ClawverseMessage.oneof payload` (field numbers 6, 7):

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

`generated.ts` is updated manually (protobufjs loads .proto at runtime; no protoc required).

## CollabSystem (`apps/daemon/src/collab.ts`)

Mirrors SocialSystem's pending queue pattern.

### Types

```typescript
interface CollabTask {
  id: string;         // 'col-<ts>-<rand>'
  ts: string;
  from: string;       // source peer ID
  fromName: string;   // used in prompt context
  context: string;
  question: string;
  resolved: boolean;
}

interface CollabPeerStats {
  peerId: string;
  tasksReceived: number;
  tasksSent: number;
  successCount: number;
  reputationDelta: number; // cumulative +1/-1
}
```

### Public API

| Method | Called by | Description |
|--------|-----------|-------------|
| `enqueueIncoming(task)` | P2P message handler | Stores incoming TaskRequest in pending Map |
| `submitTask(to, context, question)` | HTTP /collab/submit | Creates task, stores in outgoing Map |
| `resolve(id, result)` | HTTP /collab/resolve | Marks resolved, triggers P2P TaskResult send |
| `onResultReceived(taskResult)` | P2P message handler | Updates stats for completed outgoing task |
| `getPendingIncoming()` | HTTP GET /collab/pending | Returns unresolved incoming tasks |
| `getStats()` | HTTP GET /collab/stats | Returns per-peer collaboration stats |

### Reputation

CollabSystem maintains its own `data/collab/stats.json`, decoupled from SocialSystem.
- Task success: `reputationDelta += 1` for that peer
- Task failure: `reputationDelta -= 1`

## HTTP Endpoints (`apps/daemon/src/http.ts`)

| Method | Path | Body / Response |
|--------|------|-----------------|
| POST | `/collab/submit` | Body: `{to: string, context: string, question: string}` → `{ok, taskId}` |
| GET | `/collab/pending` | → `CollabTask[]` |
| POST | `/collab/resolve` | Body: `{id: string, result: string, success: boolean}` → `{ok}` |
| GET | `/collab/stats` | → `CollabPeerStats[]` |

## collab-worker (`apps/connector-skill/src/collab-worker.ts`)

```
poll loop (every 60s):
  1. GET /collab/pending
  2. for each task:
     a. t0 = Date.now()
     b. claude --print -p `${fromName} asks:\n\n${context}\n\n${question}`
     c. POST /collab/resolve {id, result, success: result.length > 0}
     d. reportEpisode(success, Date.now() - t0, 'collab-execution')
```

## Files Changed

| File | Change |
|------|--------|
| `packages/protocol/src/clawverse.proto` | Add TaskRequest, TaskResult messages |
| `packages/protocol/src/generated.ts` | Add ITaskRequest, ITaskResult, update IClawverseMessage |
| `packages/protocol/src/index.ts` | Add createTaskRequest, createTaskResult factories |
| `apps/daemon/src/collab.ts` | New file — CollabSystem class |
| `apps/daemon/src/http.ts` | Add 4 new endpoints, wire CollabSystem |
| `apps/daemon/src/index.ts` | Instantiate CollabSystem, handle P2P task messages |
| `apps/connector-skill/src/collab-worker.ts` | New file — collab poll worker |
