# Python AI - verify-question-bank port (Phase 2 stub)

Phase 2 STRUCTURAL port of `supabase/functions/verify-question-bank/index.ts`
to Python FastAPI on Cloud Run. Default OFF.

## What's ported

- auth.py: cron-secret constant-time match (CRON_SECRET env).
- scheduling.py: pure helpers - peak-hour detection (IST 14:00-22:00),
  adaptive batch sizing (1000 off-peak / 250 peak; halved if throttled),
  throttle threshold (RPM > 2400). Constants match TS shared.ts byte-for-byte.
- models.py: empty request body + per-tick summary response.
- repository.py: claim_verification_batch RPC + release helper +
  get_grounded_traces_rpm_last_minute throttle signal.
- handler.py: 6-step pipeline (auth -> throttle -> batch sizing -> claim ->
  STUB release -> summary).

## Phase 2 STUB behavior

The TS path calls grounded-answer's verifier template for each claimed row
and updates verification_state based on the verdict. **The Python port
STUBS this step**: each claimed row is released back to legacy_unverified
without calling the verifier. The cron's next tick reclaims them.

This is acceptable for Phase 2 because:
- The claim/release infrastructure is exercised end-to-end.
- The TS path remains the verifier-of-record until Phase 2.5.
- Flag default OFF means production traffic still hits the TS verifier.

## Phase 2.5 follow-up

Replace the `release_claim` loop in handler._generate_hpc with an HTTP
call to the grounded-answer Edge Function (or direct MoL once
grounded-answer is also ported). The contract surface (claim, summary
response) remains unchanged.

## REG-104

See `.claude/regression-catalog.md` for the scheduling-helpers contract pin.
