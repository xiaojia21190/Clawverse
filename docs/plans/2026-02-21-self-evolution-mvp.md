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

## Runtime Episode Capture (implemented)

Daemon now appends heartbeat episodes to `episodes.jsonl` so evaluation can run on real runtime traces.

Environment variables:

- `CLAWVERSE_EVOLUTION_ENABLED=true|false`
- `CLAWVERSE_EVOLUTION_VARIANT=baseline-v1` (or candidate tag)
- `CLAWVERSE_EPISODES_PATH=data/evolution/episodes/episodes.jsonl`
- `CLAWVERSE_EPISODES_FLUSH_EVERY=1`

Check status:

- `GET /evolution`

## Next Step

Feed task-level success/cost metrics (not only heartbeat metrics) into episode records for higher-quality evolution decisions.
