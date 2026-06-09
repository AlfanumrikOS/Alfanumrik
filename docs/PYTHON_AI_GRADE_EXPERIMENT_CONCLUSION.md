# Python AI - grade-experiment-conclusion port

Phase 2 port of `supabase/functions/grade-experiment-conclusion/index.ts`
to Python FastAPI on Cloud Run. Tier 3 R10 experiment-conclusion grader.
Default OFF.

## What's ported

- Auth (auth.py): Bearer JWT - student verification (same pattern as
  voice.auth).
- Models (models.py): typed Pydantic for request/GradingResult/response.
- Scoring (scoring.py): rule-based heuristic scoring (length + keyword
  density). Phase 2.5 will swap to MoL routing.
- Repository (repository.py): observation lookup + idempotency check +
  persist + award_coins RPC.
- Handler (handler.py): 6-step orchestrator with P11 idempotency contract
  preserved (grading_result + coin_transactions both checked).

## Coin tiers (TS-verbatim)

- weak (0-4) - +0 coins
- developing (5-7) - +5 coins
- proficient (8-10) - +15 coins
- strong (11-12) - +30 coins

## Phase 2.5 follow-up

The TS path calls Claude for nuanced rubric grading. This Python port uses
deterministic rule-based heuristics (length + method/evidence keyword
detection). The contract surface (request/response, P11 idempotency,
coin-award semantics) is preserved, so the Phase 2.5 swap to MoL routing is
strictly internal - no DB or wire shape changes.

## REG-103

See `.claude/regression-catalog.md` for the catalog entry.
