# Pedagogy v2 — Wave 1 Rollout Runbook

**Date:** 2026-05-09
**Status:** Partial wave shipped. See "Wave 1 actually-shipped scope" below.
**Branch:** `pedagogy-v2-wave-1-daily-rhythm` (commits 6798fd08 → 9b4b46d7)
**Plan:** [docs/superpowers/plans/2026-05-08-pedagogy-v2-wave-1-daily-rhythm.md](../plans/2026-05-08-pedagogy-v2-wave-1-daily-rhythm.md)

## Wave 1 actually-shipped scope

The original plan assumed an `sm2_cards` table with `next_review_at`. Canonical re-audit during execution found that schema doesn't exist — the canonical uses a unified `concept_mastery` table with CME-style retention modeling instead. The portions of Wave 1 that depended on direct SM-2 card scheduling were deferred to a follow-on plan; the persona-adaptive resolver, productive-failure flip, and distractor micro-explainer all shipped because they don't depend on SRS card state.

| Task | Status | Commit |
|---|---|---|
| 1 — Wave 1 feature flags (3 flags, all default OFF) | ✅ Shipped | 9e80a335 |
| 2 — `pedagogy-content-rules.ts` resolver (6 personas × 3 slots) | ✅ Shipped | 163c12cc |
| 3 — `daily-rhythm-orchestrator.ts` (pure-function composer) | ✅ Shipped | 7a634c1b |
| 4 — `wrong-answer-remediation.ts` lookup helper | ✅ Shipped | ec5bd4a2 |
| 5 — `/api/rhythm/today` route | ⏸ Deferred — CME schema, see follow-on plan |
| 6 — Productive-failure flip in `/learn/[subject]/[chapter]` | ✅ Shipped | 792becdb |
| 7 — Distractor micro-explainer (Eedi) in quiz wrong-answer surface | ✅ Shipped | 9b4b46d7 |
| 8 — Dashboard `<DailyRhythmQueue/>` integration | ⏸ Deferred — depends on Task 5 |
| 9 — E2E smoke test for daily rhythm | ⏸ Deferred — depends on Task 8 |

What this rollout covers: **the two student-visible behavioral changes (productive-failure flip + distractor micro-explainer)** plus the foundational pure-function modules and feature flags that the deferred work will consume unchanged.

## Pre-flight (must be true before any flag flip)

- [ ] Branch merged to main and deployed to staging.
- [ ] Migration `20260509120000_pedagogy_v2_wave_1_flags.sql` applied to staging AND production.
- [ ] `wrong_answer_remediations` table has ≥ 100 curated rows in the target environment. Verify with:
      ```sql
      SELECT count(*) FROM wrong_answer_remediations;
      ```
- [ ] Sentry capturing client errors for `/learn/[subject]/[chapter]` and the legacy quiz wrong-answer surface.

## Stage 1 — Internal canary (Day 0)

Set `target_environments = ARRAY['staging']` on both shipped flags; production stays OFF.

```sql
UPDATE feature_flags
SET is_enabled = true,
    target_environments = ARRAY['staging']::text[]
WHERE flag_name IN (
  'ff_productive_failure_v1',
  'ff_distractor_micro_explainer_v1'
);
-- ff_pedagogy_v2_daily_rhythm stays OFF until Task 5 ships in the follow-on plan.
```

Smoke test on staging:
1. Open `/learn/<subject>/<chapter>`. Confirm orange "Try this first" banner appears above the concept card; description and learning objectives are hidden until you select an answer and click "Check Answer". The banner has `data-testid="productive-failure-banner"`.
2. Take a quiz with the legacy (non-v2) MCQ path. Pick a known wrong distractor on a question that has a `wrong_answer_remediations` row. Confirm an amber card appears below the explanation with the curated remediation + "Ask Foxy" link. The card has `data-testid="misconception-explainer"`.
3. Confirm the card does NOT appear when the picked distractor has no curated remediation (renders null without flicker).
4. Toggle language to Hindi. Confirm both surfaces render in Hindi.

## Stage 2 — 5 % production rollout (Day 3 if Stage 1 clean)

```sql
UPDATE feature_flags
SET is_enabled = true,
    rollout_percentage = 5,
    target_environments = NULL
WHERE flag_name IN (
  'ff_productive_failure_v1',
  'ff_distractor_micro_explainer_v1'
);
```

Watch for 48h:
- Sentry error rate for `/api/learn/remediation` and the chapter page < 0.5 %.
- PostHog `learn_quick_check_submitted` events still firing at expected volume (productive failure should not depress submission rate by more than 10 %).
- PostHog session length on `/learn` chapters not regressing (target: stable or rising).

Roll back any flag whose error rate crosses 0.5 %:
```sql
UPDATE feature_flags SET is_enabled = false WHERE flag_name = '<flag>';
```

## Stage 3 — 25 % rollout (Day 5)

```sql
UPDATE feature_flags
SET rollout_percentage = 25
WHERE flag_name IN (
  'ff_productive_failure_v1',
  'ff_distractor_micro_explainer_v1'
);
```

Hold 72 h. Compare cohort metrics in PostHog:
- Chapter Quick Check correctness rate in flagged cohort vs control: productive failure should not regress correctness more than 5 % (some regression is expected and pedagogically desirable — the value is in retention, not first-attempt correctness).
- Wrong-answer follow-through rate (clicks on the misconception explainer's "Ask Foxy" link) ≥ 30 %.

## Stage 4 — 100 % rollout (Day 10)

```sql
UPDATE feature_flags
SET rollout_percentage = 100
WHERE flag_name IN (
  'ff_productive_failure_v1',
  'ff_distractor_micro_explainer_v1'
);
```

2-week observation window before declaring shipped flags as Wave-1-Done. While the observation window runs, the follow-on plan (CME-aligned `/api/rhythm/today` + dashboard queue + e2e smoke) can be drafted and built in parallel — flags `ff_pedagogy_v2_daily_rhythm` is already seeded and waiting.

## Rollback

Set `is_enabled = false` on the affected flag. Effect is immediate (cache TTL 5 min). All shipped flags fail safe: when off, legacy code paths render. No data loss; no schema migration to reverse — the only DB write was to `feature_flags` itself.

## Known limitations of the shipped wave

- **Productive-failure flip is persona-blind today.** Wave 1 reads no `goal_code` on the chapter surface, so the resolver falls back to `pass_comfortably` (productiveFailure=true) for everyone. The `improve_basics` persona exception (worked-example-first) lands once student-profile fetching is wired into the chapter page, which is part of the follow-on plan.
- **Distractor micro-explainer mounts only on the legacy quiz path** (`!isV2Question`). The v2 quiz path defers feedback to the results screen and needs a different mount point — to be addressed in a follow-on enhancement that either threads `(question_id, distractor_index)` pairs into v2 results or updates the v2 results renderer to call `/api/learn/remediation` per wrong response.
- **Daily rhythm orchestrator code is shipped but unwired.** `composeDailyRhythm` exists, is tested, and is correct against the resolver. It will be exercised the moment the CME-aligned `/api/rhythm/today` route lands. Until then, no surface in the app calls it.
