# Clawverse Self-Evolution MVP (Guarded)

## Purpose

Build a minimal, controlled self-evolution loop for LLM behavior:

1. Propose candidate change
2. Evaluate on episode data
3. Decide adopt/rollback by thresholds

## Scope (MVP)

- Only evolves strategy/prompt variants (not security/system rules)
- Offline decision from `data/evolution/episodes/episodes.jsonl`
- Outputs machine-readable artifacts:
  - `data/evolution/proposals/*.json`
  - `data/evolution/reports/*.json`
  - `data/evolution/decisions/*.json`

## Commands

```bash
pnpm evolve:propose
pnpm evolve:evaluate
pnpm evolve:decide
# or one-shot:
pnpm evolve:cycle
```

## Decision Gates

Defined in `tools/evolution/config.json`:

- `minSuccessLift`
- `maxLatencyDeltaMs`
- `maxTokenDelta`
- `maxCostDeltaUsd`

Candidate is adopted only if all gates pass.

By default, evaluation uses task-like sources only (`task-runtime`, `manual`) via `tools/evolution/config.json` → `evaluation.includeSources`.

## Runtime Episode Capture (implemented)

Daemon now appends heartbeat episodes to `episodes.jsonl` so evaluation can run on real runtime traces.

Environment variables:

- `CLAWVERSE_EVOLUTION_ENABLED=true|false`
- `CLAWVERSE_EVOLUTION_VARIANT=baseline-v1` (or candidate tag)
- `CLAWVERSE_EPISODES_PATH=data/evolution/episodes/episodes.jsonl`
- `CLAWVERSE_EPISODES_FLUSH_EVERY=1`
- `CLAWVERSE_HEARTBEAT_SAMPLE_EVERY=10` (record 1 in N heartbeats)

Check status:

- `GET /evolution`

Push task-level episodes:

- `POST /evolution/episode` (supports optional `variant` override)
- or via connector wrapper: `runWithEpisode(taskName, fn)`

Example:

```bash
curl -X POST http://127.0.0.1:19820/evolution/episode \
  -H 'content-type: application/json' \
  -d '{
    "success": true,
    "latencyMs": 920,
    "tokenTotal": 4100,
    "costUsd": 0.19,
    "source": "task-runtime",
    "meta": {"task":"iran-brief","provider":"openai-codex"}
  }'
```

## Online A/B (connector)

`runWithEpisode` can auto-assign baseline/candidate via env rollout config:

```bash
export CLAWVERSE_ROLLOUT_JSON='{"baseline":"baseline-v1","candidate":"candidate-v2","candidateRatio":0.1}'
```

Now it supports deterministic (sticky) bucketing:

- default sticky key is `taskName`
- you can override with `runWithEpisode(..., { stickyKey: 'user:123' })`
- same key always maps to same cohort for stable A/B

Then every wrapped task reports with assigned variant.

## Next Step

Persist rollout assignment logs for auditability and replay.
