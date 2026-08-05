# Prerequisite Gating — Rollout Runbook

**Date:** 2026-08-05
**Status:** Pre-rollout. `ff_prereq_gating_v1` seeded OFF (0%). Route wired, UI card renders in shadow mode.
**Flag:** `ff_prereq_gating_v1` — seeded OFF by migration `20260809000200_seed_ff_prereq_gating_v1.sql`.
**Data layer:** `packages/lib/src/learn/prereq-gating.ts` (pure resolver), `apps/host/src/app/api/learn/prereq-check/route.ts` (server endpoint), `packages/ui/src/quiz/PrereqSuggestion.tsx` (student-visible card).
**Spec:** `docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md` §1.3 E5
**Owner:** ops (this runbook + flag flips) · ai-engineer (resolver + planner tie-in) · assessment (nudge copy + P7 bilingual) · frontend (`PrereqSuggestion` card)

## What this controls

`ff_prereq_gating_v1` staged in three modes:

- **Shadow (5%)** — route `/api/learn/prereq-check` computes prerequisite gaps from the `concept_edges` graph and returns them; the `PrereqSuggestion` UI card *renders* in the QuizSetup surface. **No quiz start is blocked.** This is a suggestion, not a gate.
- **Cohort (25%)** — same behavior, wider audience. Still fail-open.
- **Full (100%)** — same behavior at full rollout. Still fail-open.

**Fail-open contract (pinned in every code path):**
- `/api/learn/prereq-check` returns HTTP 200 with `{ prerequisites: [], reason: "fail_open:<code>" }` on any error (RPC error, timeout, malformed input, RLS deny, flag OFF). Never 4xx/5xx that would block quiz start.
- The `PrereqSuggestion` card no-ops when the response is empty or when the flag is OFF for the current user.
- Quiz start is **never** blocked by this route. If the card fails to render, the student proceeds normally.
- The planner tier 4 hook (`apps/host/src/app/api/foxy/_lib/cognitive-context.ts`) reads the same resolver and degrades to prior behavior on any error.

## Prerequisites (must all be true before any flag flip)

- [ ] Migration `20260809000200_seed_ff_prereq_gating_v1.sql` applied. Verify:
  ```sql
  SELECT flag_name, is_enabled, rollout_percentage
  FROM feature_flags WHERE flag_name = 'ff_prereq_gating_v1';
  -- expect: is_enabled = false, rollout_percentage = 0
  ```
- [ ] `concept_edges` populated for the target grades/subjects. Verify count is non-zero and coverage is >= 80% of chapters in scope. If empty, resolver returns `[]` and the card no-ops — safe but useless.
- [ ] `POST /api/learn/prereq-check` returns 200 with an empty array when the flag is OFF (fail-open canary — no server error path escapes as a 5xx).
- [ ] `PrereqSuggestion.tsx` renders and dismisses cleanly under Playwright / manual smoke; card carries EN + Hindi copy (P7 invariant).
- [ ] `ff_digital_twin_v1` posture reviewed — the graph read path may reference twin snapshots; if that flag is OFF the resolver still functions on `concept_edges` alone.

## Staged flip (5% → 25% → 100%)

Each stage: minimum 48h dwell, health check between stages. Kill switch = flag OFF (no deploy).

### Stage A — Shadow (5%)

```sql
UPDATE feature_flags
SET is_enabled = true, rollout_percentage = 5,
    target_environments = ARRAY['production']::text[],
    updated_at = now()
WHERE flag_name = 'ff_prereq_gating_v1';
```

### Stage B — Cohort (25%)

Same UPDATE, `rollout_percentage = 25`.

### Stage C — Full (100%)

Same UPDATE, `rollout_percentage = 100`.

**Kill switch — instant, no deploy:**
```sql
UPDATE feature_flags SET is_enabled = false, rollout_percentage = 0,
       updated_at = now()
WHERE flag_name = 'ff_prereq_gating_v1';
```
Flag cache TTL is 5 minutes. The card stops rendering on the next fetch; quiz start behavior is unchanged (it never depended on the card).

## Metrics to watch

**Nudge shown rate (should track the ramp %):**
```sql
SELECT date_trunc('day', occurred_at) AS d,
       count(*) FILTER (WHERE kind = 'prereq.nudge_shown') AS shown,
       count(*) FILTER (WHERE kind = 'prereq.nudge_tapped') AS tapped
FROM state_events
WHERE occurred_at > now() - interval '14 days'
  AND kind IN ('prereq.nudge_shown','prereq.nudge_tapped')
GROUP BY 1 ORDER BY 1 DESC;
```

- **Shown rate:** should scale roughly with the ramp % of quiz starts (5% → 25% → 100%).
- **Tap-through rate:** `tapped / shown`. Healthy range 5-20%. Higher = signal that gaps are salient; lower = card copy or targeting needs review (assessment).

**Warm-up completion (did the student complete the suggested prerequisite work):**
```sql
SELECT date_trunc('day', occurred_at) AS d,
       count(*) AS warmup_completions
FROM state_events
WHERE kind = 'prereq.warmup_completed'
  AND occurred_at > now() - interval '14 days'
GROUP BY 1 ORDER BY 1 DESC;
```

**Quiz-start-block canary (MUST stay zero — fail-open contract):**
```sql
SELECT count(*)
FROM state_events
WHERE kind = 'prereq.quiz_start_blocked'
  AND occurred_at > now() - interval '24 hours';
-- expect: 0. Any non-zero value = a fail-open regression. Kill-switch the flag.
```

**Route error rate (should be near-zero; any spike = investigate):**
- Sentry filter: `route:/api/learn/prereq-check level:error` over 24h. Expect single-digit noise, no sustained spike.

## Rollback

| Symptom | Action |
|---|---|
| Quiz-start-block canary non-zero | Kill-switch `ff_prereq_gating_v1` immediately. Investigate the failing code path — the fail-open contract has been breached. |
| Route error rate > 1% of calls | Kill-switch, root-cause the RPC or `concept_edges` read; re-flip only after regression test lands. |
| Nudge-tap rate ~0% at 25%+ | Not a kill switch. Copy/targeting issue — hand back to assessment, keep flag at current stage. |
| `concept_edges` corruption / mass gaps | Kill-switch. The resolver returning `[]` for everyone is technically fail-open but noise-free; ramping into that state wastes the eval window. |

## Notes

- The nudge is a suggestion. It does not gate quiz start under any stage of this rollout. That was an explicit design choice (§1.3 E5): fail-open first, enforce later. Enforcement is a separate, later record — not part of this runbook.
- P7 invariant: the `PrereqSuggestion` card must render in both EN and Hindi. Assessment owns copy review.
- The planner tier 4 hook consumes the same resolver output as the UI card. If the card is disabled per-user by targeting, tier 4 also degrades cleanly.
- The route response never carries PII — only concept identifiers + short reason codes (P13).
