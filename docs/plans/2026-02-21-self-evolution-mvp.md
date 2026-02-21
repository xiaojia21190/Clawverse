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
# one-shot (includes summary output):
pnpm evolve:cycle
```

`pnpm evolve:cycle` now writes markdown summaries to:

- `data/evolution/summaries/<proposal-id>.md`
- `data/evolution/summaries/LATEST.md`

Inspect current rollout + last decision:

```bash
pnpm evolve:status
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

State snapshot (daemon peer state persistence):

- `CLAWVERSE_STATE_SNAPSHOT_PATH` (default `data/state/latest.json`)
- `CLAWVERSE_STATE_SNAPSHOT_EVERY` seconds (default `30`)

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

Rollout assignments are persisted for audit/replay:

- default path: `data/evolution/rollout/assignments.jsonl`
- override via `CLAWVERSE_ROLLOUT_AUDIT_PATH`

`runWithEpisode` is fail-open for reporting: if daemon is temporarily down, task execution still returns and only prints warning.

`reportEpisode` also retries transient failures:

- `CLAWVERSE_REPORT_RETRIES` (default 2)
- `CLAWVERSE_REPORT_BACKOFF_MS` (default 300)

## Auto Schedule (optional)

Install/update cron automatically:

```bash
pnpm evolve:cron
# custom expression:
bash tools/evolution/schedule-cron.sh '0 */4 * * *'
```

## Notifications (webhook/telegram)

`pnpm evolve:notify` sends `data/evolution/summaries/LATEST.md` when env is set:

- `CLAWVERSE_NOTIFY_WEBHOOK`
- or `CLAWVERSE_TELEGRAM_BOT_TOKEN` + `CLAWVERSE_TELEGRAM_CHAT_ID`

Enable notify in cycle:

```bash
export CLAWVERSE_NOTIFY_ON_CYCLE=true
pnpm evolve:cycle
```

## Rollout Auto-Gate & Auto-Ratio

`pnpm evolve:cycle` now runs `apply-rollout.mjs` after decision:

- Maintains `data/evolution/rollout/state.json`
- Emits env snippet at `data/evolution/rollout/latest.env`
- Adjusts `candidateRatio` by `rolloutPolicy` in config

## Task-level Real Token/Cost Capture

In connector:

- `runWithEpisode(taskName, fn)` for explicit metrics
- `runTaskAutoMetrics(taskName, fn)` to auto-extract `usage` fields (`total_tokens`, `input/output_tokens`, `cost_usd`, etc.)

## Next Step

Wire connector wrapper into real production task executors so every task path reports metrics without manual changes.
