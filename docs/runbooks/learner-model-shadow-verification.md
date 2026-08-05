# Runbook: Learner-Model Shadow Verification (R1 — event-bus shadow → promote-or-delete)

**Owner:** ops (execution) · backend (projector code) · assessment (drift-gate sign-off)
**Governing spec:** `docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md` §1.7 (R1) — "Enable bus in shadow → live; verify `learner_mastery` projection vs canonical then promote-or-delete."
**Tracker record:** R1 in `docs/trackers/foxy-north-star/tracker.json`
**Created:** 2026-08-05 (Phase 2)

## What this verifies

The `state_events` bus (`ff_event_bus_v1`) drives a read-side projection,
`learner_mastery` (per **chapter**), off the same quiz-submit signals that feed
the canonical learner state, `concept_mastery` (per **topic/concept**, written
ONLY by `update_learner_state_post_quiz` inside the atomic submit chain —
migration `20260623000100`; E1/E6). Before the projection may be promoted to a
trusted read model (or deleted, if it cannot be made trustworthy), it must run
in **shadow** — written but not load-bearing — and be verified against canon at
a matched grain.

**Decision on exit: DR-10 (promote-or-delete).** There is no third option; a
permanently-unverified parallel mastery store is exactly the duplicate-store
rot the North-Star plan retires (analyzer checks 7/9).

## Safety posture (read before flipping anything)

- **Kill switch:** `ff_event_bus_v1` OFF. `publish()` in
  `packages/lib/src/state/events/publish.ts` is flag-gated at the module
  boundary — callers always call it; the module enforces the gate. OFF means
  publish is a no-op everywhere, instantly.
- **Publish failures never block submit.** `publish()` does one INSERT, does
  not synchronously call subscribers, and does not retry; the quiz submit
  chain (`atomic`/`submit_quiz_results_v2` RPC) is upstream and unaffected by
  bus errors (P4 stays intact). This is the fail-open contract documented in
  `publish.ts`; any change to it requires architect review before this runbook
  is executed.
- **Shadow means:** `learner_mastery` rows are written, but no student-facing
  decision reads them as authority. (Student Pulse reads `learner_mastery`
  behind `ff_school_pulse_v1`, which is OFF — confirm it is still OFF for the
  shadow window so the shadow store is not silently load-bearing.)

## Prerequisites (hard gates — do not flip the flag until both are done)

1. **Wave 2b bkt-mirror re-point MERGED.** The projector path
   (`packages/lib/src/state/services/quiz-completion-service.ts`) must be
   re-pointed onto the canonical facade mirror
   `packages/lib/src/learner-model/bkt-mirror.ts` (the ONE approved TS mirror
   of the SQL RPC — analyzer check 6 allowlist). Shadow data produced by the
   old divergent local `bktUpdate` copy would measure the wrong thing: drift
   between two implementations, not projection health. Verify the wave 2b PR
   is merged and the analyzer's `BKT update` allowlist debt entry for
   `quiz-completion-service.ts` has been removed in that PR.
2. **Truncate stale `learner_mastery` rows.** The table has historical rows
   from earlier partial enablements written by pre-consolidation code. The
   verification window must contain only rows produced by the re-pointed
   projector:

   ```sql
   -- staging first, then prod, immediately BEFORE the flag flip.
   -- Service-role console. Record row count before truncating (audit trail).
   SELECT COUNT(*) FROM public.learner_mastery;
   TRUNCATE TABLE public.learner_mastery;
   ```

   Record the pre-truncate count and timestamp in the ops log. The truncate
   timestamp is your `:shadow_start`.

## Procedure

### Step 1 — Flip `ff_event_bus_v1` ON (staging → prod)

> ⚠️ **Verify live flag state FIRST — the written record is contradictory.**
> The North-Star spec (§1.7 R1) says the bus flag is OFF / publish is a no-op,
> but `scripts/feature-flag-matrix.json` carries live Supabase evidence
> (captured 2026-07-10) of `ff_event_bus_v1` **is_enabled=true, rollout=100%**
> in production. On-disk ≠ deployed applies to flags too: read the live
> `feature_flags` row (flags console) before doing anything. If the flag is
> already ON, rows in `learner_mastery` are being written by the
> **pre-consolidation** projector — which makes the truncate prerequisite
> above mandatory, and makes the wave-2b-merge + truncate moment (not the
> flag flip) your `:shadow_start`. Reconcile the matrix snapshot and the
> tracker R1 flag expectation with whatever you find, and log the finding.

Ops action via the super-admin flags console (`/super-admin/flags`). **No
migration** — this is a `feature_flags` row update, and it must be logged to
the admin audit trail (standard flags-console behavior; verify the audit row
exists after each flip).

1. Staging: enable `ff_event_bus_v1` (100%). Soak ≥ 48h. Confirm:
   - `state_events` rows accrue on quiz submits;
   - `learner_mastery` rows appear via the subscriber;
   - submit latency and error rate unchanged (Sentry + `/api/v1/health`).
2. Prod: enable `ff_event_bus_v1`. Record flip timestamp as prod
   `:shadow_start` (must be ≥ the prod truncate timestamp).
3. Update `scripts/feature-flag-matrix.json` / overrides so the analyzer's
   flag-posture check reflects reality (shadow = the flag is ON but the
   projection is not load-bearing; the R1 tracker record's flag expectation
   should be updated in the same PR that records the flip).

### Step 2 — Run ≥ 2 weeks

Minimum 14 days of prod shadow. Do not shorten: SM-2/review cadences and
weekly rhythm surfaces need at least two weekly cycles to exercise re-reviews.

Weekly during the window, run the verification query (Step 3) as a trend
check — drift should be flat or shrinking. A growing drift trend is a
projector bug; fix and restart the window (re-truncate).

### Step 3 — Grain-matched verification SQL

Canon is per-topic; the projection is per-chapter. Comparison is therefore at
the **chapter aggregate**: canon = `AVG(concept_mastery.mastery_probability)`
over the chapter's topics, keyed exactly like the projection
(`auth_user_id`, `lower(subjects.code)`, `chapter_number`).

```sql
-- :shadow_start = the prod truncate/flip timestamp (Step 1).
WITH canon AS (
  SELECT
    st.auth_user_id,
    lower(s.code)                 AS subject_code,
    ct.chapter_number,
    AVG(cm.mastery_probability)   AS canonical_mastery,
    COUNT(*)                      AS concept_rows
  FROM public.concept_mastery cm
  JOIN public.curriculum_topics ct ON ct.id = cm.topic_id
  JOIN public.subjects s           ON s.id  = ct.subject_id
  JOIN public.students st          ON st.id = cm.student_id
  WHERE cm.updated_at >= :shadow_start
    AND st.auth_user_id IS NOT NULL
    AND ct.chapter_number IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT
  c.auth_user_id,
  c.subject_code,
  c.chapter_number,
  c.canonical_mastery,
  lm.mastery                             AS shadow_mastery,
  ABS(lm.mastery - c.canonical_mastery)  AS drift,
  c.concept_rows,
  lm.attempts                            AS shadow_attempts,
  lm.last_updated_at                     AS shadow_last_updated_at
FROM canon c
LEFT JOIN public.learner_mastery lm
  USING (auth_user_id, subject_code, chapter_number)
ORDER BY drift DESC NULLS FIRST;
```

Notes:
- `LEFT JOIN … NULLS FIRST` deliberately surfaces **missing shadows** (canon
  moved in-window, projection never wrote) at the top — these are the worst
  failure mode, not a rounding concern.
- Rows where `shadow_mastery IS NOT NULL` but no canon row exists in-window
  are not produced by this query (canon-anchored by design); a separate
  orphan check is optional but recommended:
  `SELECT COUNT(*) FROM learner_mastery lm WHERE NOT EXISTS (SELECT 1 FROM canon …)`.

Summary metrics for the gate:

```sql
-- Wrap the query above as shadow_check, then:
SELECT
  COUNT(*)                                                    AS chapters_compared,
  COUNT(*) FILTER (WHERE shadow_mastery IS NULL)              AS null_shadows,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY drift)         AS median_drift,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY drift)         AS p95_drift
FROM shadow_check;
```

### Step 4 — Gate

ALL three must hold over the full ≥ 2-week window:

| Metric | Threshold |
|---|---|
| NULL shadows in-window | **zero** (`null_shadows = 0`) |
| Median drift | **≤ 0.10** |
| p95 drift | **≤ 0.25** |

Grain-mismatch tolerance is why the thresholds are non-zero: a chapter
average over topics updated at different times will legitimately diverge from
an event-fold projection. Systematic bias (all drift one direction) at any
magnitude is a projector bug — investigate even inside thresholds.

### Step 5 — Promote-or-delete (DR-10)

- **PASS →** propose **promote**: `learner_mastery` becomes a blessed read
  model (Pulse et al. may read it; the facade remains the mastery authority
  for AI paths per E6). Record the DR-10 decision + gate numbers in the
  tracker (R1 → tested/verified with this runbook + query output as
  evidence). Assessment signs off on the drift numbers; orchestrator routes
  the promote PR.
- **FAIL →** either fix the projector and restart the window (re-truncate,
  re-run), or execute **delete**: flag OFF, drop the projection
  (compensating migration through normal review — never a panic DROP), and
  record DR-10 = delete. Do not leave the bus ON with a failed projection.

At any point: rollback = `ff_event_bus_v1` OFF (Step 1 console, audit-logged).
Publishes stop instantly; submits were never coupled to it.

---

## Appendix A — cme-engine tombstone (E3, post-merge steps)

Wave 2b tombstones the `cme-engine` Edge Function (canonical explainable
state is now the facade `packages/lib/src/learner-model/explain-mastery.ts`;
`board-score` was re-pointed off `cme_concept_state` in Phase 0 F6). On-disk ≠
deployed — follow the tombstone protocol used for `quiz-generator-v2`
(`docs/runbooks/edge-function-drift-report.md`):

1. **Deploy** the tombstoned function (structured 410 body) after the wave 2b
   merge: `supabase functions deploy cme-engine`.
2. **Verify deployed state**: `supabase functions list` — confirm the new
   version is ACTIVE. Never assert deployment from the filesystem.
3. **30-day invocation watch**: check Supabase Edge Function logs/metrics for
   `cme-engine` invocations (old mobile builds or forgotten callers). Any
   non-zero traffic → identify and re-point the caller; restart the watch.
4. **Delete** only after 30 clean days: `supabase functions delete cme-engine`,
   then remove the source directory (or move to `supabase/functions/_archive/`)
   in the same PR that lowers the analyzer baseline (Appendix B).

## Appendix B — analyzer retired-table baseline ratchet (PENDING ops action)

`scripts/foxy-alignment/analyze.mjs` → `RETIRED_TABLE_REF_BASELINE.cme_concept_state`
is a downward-only ratchet. The Phase 0 F6 board-score re-point brought real
references below the frozen baseline; the wave 2b cme-engine tombstone sweep
lowers them again (target: cme-engine EF refs go to 0 at deletion; check 9
requires **zero** non-migration refs once E3 is built+).

**Pending action (ops, AFTER the wave 2b merge — do not edit now):** re-measure
(`node scripts/foxy-alignment/analyze.mjs` prints per-file counts on check 7),
then lower the baseline (frozen at 20 on 2026-08-05; F6 already took real refs
to ~18 — the intermediate ratchet the E3 tracker note records) to the measured
post-sweep count in the same PR that lands the sweep, so the ratchet locks the
improvement in. Same PR: delete any paid-down `DUP_SIGNATURES` allowlist
entries the analyzer flags with "debt paid down? — remove it".
