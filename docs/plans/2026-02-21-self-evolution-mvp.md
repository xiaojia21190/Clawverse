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

## Next Step

Wire episode generation from daemon/task runtime so this loop runs on real production traces.
