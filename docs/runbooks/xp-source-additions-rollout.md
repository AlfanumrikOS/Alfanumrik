# XP Source Additions (Phase 3, U8/A2) — Rollout Runbook

**Date:** 2026-08-05
**Status:** Code merged (Phase 3 wave); no active ramp required — the `award_xp_capped` RPC is EXECUTE-granted only to `service_role`, so lanes light up as callers invoke them, not by flag flip.
**Approval:** CEO A2 (2026-08-05, full approval, no conditions) — amounts, caps, and lane definitions.
**Data layer:** `award_xp_capped` RPC + `xp_transactions.source` CHECK widen (migration `20260809000300_xp_sources_widen_and_award_rpc.sql`); constants in `packages/lib/src/xp-config.ts`; helper `packages/lib/src/xp-award.ts`.
**Regression pin:** REG-354 (XP capped-award contract).
**P2 invariant:** all XP amounts + caps live ONLY in `xp-config.ts`; helpers and callers take literals from `XP_RULES.*` at the call site.
**Spec:** `docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md` §1.5 U8
**Owner:** ops (this runbook + monitoring) · assessment (amounts + P2 invariant) · backend (RPC + call sites) · ai-engineer (thoughtful-question classifier `quality-eval.ts`) · frontend + mobile (XP display; no XP literals in client)

## Lanes added

| Lane (xp_transactions.source) | Amount | Daily cap | Reference-id pattern (idempotency) | Producer |
|---|---|---|---|---|
| `review_graded` | `XP_RULES.review_graded_xp` = 2 | `review_graded_daily_cap` = 20 (=10 reviews) | `review:<spaced_repetition_cards.id>:<yyyymmdd-IST>` | `POST /api/learner/review/grade` when quality >= 3 |
| `remediation_recovered` | `remediation_recovered_xp` = 8 | `remediation_recovered_daily_cap` = 16 (=2 recoveries) | `remediation:<student_misconceptions.id>:recovered` | `submit_quiz_v2` post-remediation success chain (per-misconception, single lifetime credit — idempotent replay returns `{idempotent_replay: true, effective_xp: 0}`) |
| `unhinted_mastery` | `unhinted_mastery_bonus` = 2 | `unhinted_mastery_daily_cap` = 30 (=15 unhinted corrects) | `unhinted:<quiz_responses.id>` | `submit_quiz_v2` per-response chain when `hint_level === 0` AND correct (D5/P8 anchor) — migration `20260809000500_submit_quiz_v2_unhinted_bonus.sql` |
| `thoughtful_question` | `thoughtful_question_xp` = 5 | `thoughtful_question_daily_cap` = 5 (=1/day) | `thoughtful:<yyyymmdd-IST>:<student_id>` | `/api/cron/foxy-quality-sample` — server-classified via `packages/lib/src/foxy/quality-eval.ts` v3 (question-depth extension in migration `20260809000700_foxy_quality_scores_question_depth.sql`); NOT per message (U9) |

**Package invariant:** sum-of-lanes daily maximum = **20 + 16 + 30 + 5 = 71 XP/day**, which is `<<` the 200 XP/day `quiz_daily_cap`. These are ACCENTS on the mastery economy, not a parallel economy. Values are pinned as literal constants in `xp-config.ts` with a comment-anchored derivation, and REG-354 pins the sum-of-lanes contract.

## RPC contract (REG-354)

`award_xp_capped(p_student_id uuid, p_source text, p_amount int, p_daily_cap int, p_reference_id text)` returns `(effective_xp int, idempotent_replay boolean, today_earned int)`:

- **`SECURITY DEFINER`**, `EXECUTE granted to service_role only` — browser / anon / authenticated callers cannot invoke it.
- **Idempotency**: repeat calls with the same `p_reference_id` return `{idempotent_replay: true, effective_xp: 0}`. Enforced by the `xp_transactions_reference_id_uniq` partial-unique index at the DB layer.
- **IST day boundary**: `today_earned` is scoped to `date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')`. Never UTC (P2 IST anchor, extends REG-318's mixed-anchor fix).
- **Daily-cap clamp**: `effective_xp = LEAST(p_amount, GREATEST(0, p_daily_cap - today_earned))`. When the cap is hit, subsequent same-lane awards on the same IST day return `effective_xp = 0` (not an error).
- **Browser fail-safe**: the `awardXpCapped` helper in `packages/lib/src/xp-award.ts` never throws / never rejects. RPC error → warn-log with counts-only metadata (P13) + returns null. Malformed return → null. No XP number lives in the helper module.

## Pre-ramp condition (from Phase 2 quality finding)

Multi-subject preference-writer newest-row shadow (`ff_preference_writer_v1`) has a documented explicit-vs-implicit read collision (tracker D9 notes, 2026-08-05):

> multi-subject newest-row read can shadow explicit prefs — fix read to prefer `preferences_set_by_user=true` rows (or scope writer to newest row) BEFORE ramping `ff_preference_writer_v1`.

Wave 3 does **not** touch that flag. It stays OFF. The `ff_preference_writer_v1` fix is a Phase 2 prerequisite for its own ramp, not for the XP-source additions in this runbook. Recorded here so the ops calendar keeps that flag pinned OFF until D9's read-side fix lands.

## Monitoring queries

Run daily during the first 14 days of live callers, then weekly.

**Per-lane volume & cap-hit rate (last 7 days, IST):**
```sql
WITH ist AS (
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today
)
SELECT
  source,
  (created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
  count(*)                       AS awards,
  count(*) FILTER (WHERE amount = 0) AS cap_hits,
  sum(amount)                    AS total_xp
FROM xp_transactions
WHERE source IN ('review_graded','remediation_recovered','unhinted_mastery','thoughtful_question')
  AND created_at >= (SELECT today - 7 FROM ist)
GROUP BY 1, 2
ORDER BY 2 DESC, 1;
```

**Per-student daily-package sanity check (must stay `<= 71`):**
```sql
SELECT student_id,
       (created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_day,
       sum(amount) AS phase3_lanes_xp
FROM xp_transactions
WHERE source IN ('review_graded','remediation_recovered','unhinted_mastery','thoughtful_question')
  AND created_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 1
GROUP BY 1, 2
HAVING sum(amount) > 71
ORDER BY phase3_lanes_xp DESC;
-- expect: zero rows. Any row = a cap bug — investigate immediately.
```

**Idempotency canary (should be near-zero non-idempotent duplicates):**
```sql
SELECT source, reference_id, count(*)
FROM xp_transactions
WHERE created_at >= now() - interval '24 hours'
  AND reference_id IS NOT NULL
GROUP BY 1, 2 HAVING count(*) > 1
ORDER BY count(*) DESC;
-- expect: zero rows. Any row indicates the partial-unique index is missing / disabled.
```

## Rollback

**Temporary halt (no data loss, no code change):** revoke the EXECUTE grant on the RPC. This freezes all four new lanes atomically; the underlying `xp_transactions` and helper code stay in place.

```sql
BEGIN;
REVOKE EXECUTE ON FUNCTION public.award_xp_capped(uuid, text, int, int, text)
FROM service_role;
COMMIT;
```

Callers (`awardXpCapped` helper) will warn-log and return null; students continue to earn quiz XP normally on the unchanged mastery-economy path. Recorded IST day totals for the halted period are simply zero for the four new lanes.

**Restore:**
```sql
BEGIN;
GRANT EXECUTE ON FUNCTION public.award_xp_capped(uuid, text, int, int, text)
TO service_role;
COMMIT;
```

**Do not** rely on rolling migrations back — the `xp_transactions.source` CHECK widen and the `xp_transactions_reference_id_uniq` index are additive and safe to keep. Rollback via GRANT/REVOKE only.

## Notes

- Quiz-per-correct, high-score bonus, perfect bonus, and daily quiz cap are UNCHANGED. P2 invariant remains: `xp_earned = (correct * quiz_per_correct) + high_score_bonus? + perfect_bonus?`.
- `foxy_chat = 0` and `streak_daily = 0` stay pinned (U9). Analyzer check 8 (`scripts/foxy-alignment/analyze.mjs`) enforces this in CI.
- No XP-to-money / voucher conversion path exists (U11). Analyzer check 8c blocks any such path.
- The thoughtful-question classifier decision is server-owned (`quality-eval.ts` v3). Client cannot flag its own message as thoughtful.
