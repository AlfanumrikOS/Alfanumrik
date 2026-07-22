# Digital Twin + Knowledge Graph (Slice 1) / Phase A Loop D — Rollout Runbook

**Date:** 2026-07-22
**Status:** Pre-rollout. Flag seeded OFF; no environment enabled yet.
**Flag:** `ff_digital_twin_v1` (seeded by migration `20260702000700`, default `is_enabled=false, rollout_percentage=0`)
**Data layer:** `concept_edges`, `learner_twin_snapshots`, `learner_twin_memory` (migrations `20260702000100..000300`); RPCs `traverse_prerequisites` / `detect_blocked_dependents` (`…000400` / `…000500`); Loop D signal on the SHARED `adaptive_interventions` substrate (CHECK widened by `…000800`)
**Spec:** Digital Twin + Knowledge Graph Slice 1 (Waves 1–2); pinned by REG-175
**Owner:** ops (this runbook + flip procedure + monitoring) · architect (schema, RPCs, flag seed, CHECK widening, twin RLS) · backend (Loop D branches in the cron worker) · assessment (guardrail floors in `BLOCKED_PREREQUISITE_RULES`, precedence A>D>C>B)

> This is the **program-level Loop D companion** to `docs/runbooks/adaptive-remediation-rollout.md` (Loop A) and `docs/runbooks/adaptive-program-rollout.md` (Loops A+B+C + Pulse). Loop D rides the **same** `adaptive_interventions` state machine, the **same** cron worker (`/api/cron/adaptive-remediation`), and the **same** drain-not-freeze kill-switch contract as A/B/C — this doc does **not** re-document that shared machinery; it cross-references the sibling runbooks and covers only what is Loop-D-specific (the knowledge-graph substrate, the blocked-prerequisite drill, the A>D>C>B precedence-ceiling drill, and the twin-specific preconditions).

## What this controls

**Loop D — blocked prerequisite.** A student is BLOCKED on an advanced (dependent) chapter when an upstream PREREQUISITE chapter in the knowledge graph is not solid enough to support it, WHILE the dependent chapter is actively being attempted/scheduled. "Not solid enough" means the prerequisite is either below the mastery floor (BKT `p_know < 0.4`) OR decayed below the retention floor (`predictRetention < 0.5`). The loop detects the block, opens ONE intervention keyed on the dependent chapter, and verifies whether the prerequisite recovers within 7 days.

Two branches, one worker route (`/api/cron/adaptive-remediation`, CRON_SECRET-gated), triggered nightly by the `adaptive_remediation_triggered` step in the `daily-cron` Edge Function (shared with Loops A/B/C — no new cron step):

- **INJECT** — gated on `ff_digital_twin_v1` (global check + per-student rollout hash). Flag OFF ⇒ Loop D contributes **zero** candidates to the arbiter; behavior is byte-identical to today. Per student the worker calls `detect_blocked_dependents(student_id, decay_floor, mastery_floor)`, classifies each edge with `classifyPrerequisiteBlock` (the SAME floors the RPC was parameterized with), plans through `planBlockedPrerequisiteIntervention`, and hands the candidate to `arbitrateInterventions` alongside any A/B/C candidates.
- **VERIFY** — gated on the existence of `status='active'` `blocked_prerequisite` rows, **not** the flag. Drain-not-freeze (spec §9): mid-flight Loop D rows always reach a terminal state even with the flag OFF.

> **Slice 1 scope note (important for expectations).** Loop D `escalated` is a **durable terminal state, NOT a live human handoff**. Unlike Loops A/B/C, Slice 1 wires **no** teacher/parent notification channel for Loop D — an expired blocked-prerequisite row transitions to `escalated` (which stops it permanently occupying the bounded verify sweep) and writes a metadata-only `audit_logs` row, but sends nobody a message. A notification channel is a later slice. This is intentional and must not be "fixed" during rollout.

## Ratified bounds (single source of truth: `BLOCKED_PREREQUISITE_RULES` in `packages/lib/src/learn/adaptive-loops-rules.ts`)

Do **not** invent or duplicate these — every one is REUSED from an existing platform convention.

| Bound | Value | Provenance |
|---|---|---|
| Prerequisite mastery floor (`mastery_floor`) | 0.4 (BKT p_know) | REUSED from `PULSE_THRESHOLDS.at_risk_mastery` — the platform-wide "at-risk mastery" line |
| Prerequisite retention floor (`decay_floor`) | 0.5 (predicted recall) | The canonical `shouldRetest` threshold in `cognitive-engine.ts` |
| Per-(student,subject) cooldown (`cooldown_days`) | 7 | Mirrors Loop B/C 7-day per-subject cooldown |
| Verify window (`return_window_days`) | 7 (rolling-ms) | Single-chapter recovery → mirrors Loop A's 7-day window (not Loop C's 14) |
| Dependent "actively attempted" window | 14 days (`LOOP_D_DEPENDENT_ACTIVE_DAYS`) | Mirrors the twin-builder active window |
| Cross-loop precedence | **A > D > C > B** | `LOOP_PRECEDENCE = { A:0, D:1, C:2, B:3 }` — D inserted between A and C |
| Per-student daily intervention ceiling | 1 (across A/B/C/D) | Unchanged `ADAPTIVE_LOOPS_BC_RULES.per_student_daily_intervention_ceiling` |

## Prerequisites (must all be true before any flag flip)

- [ ] **Knowledge-graph substrate migrations applied** to the target environment (`20260702000100..000300`, `…000700`, `…000800`, plus the graph seed `20260703000100`). Verify the tables + the CHECK widening:
  ```sql
  SELECT relrowsecurity FROM pg_class WHERE relname IN
    ('concept_edges','learner_twin_snapshots','learner_twin_memory');  -- expect: t for the two learner_* tables
  SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'public.adaptive_interventions'::regclass AND contype='c'
     AND pg_get_constraintdef(oid) ILIKE '%trigger_signal%';
  -- expect adaptive_interventions_trigger_signal_chk to include 'blocked_prerequisite'
  ```
- [ ] **RPCs present + grant-checked**:
  ```sql
  SELECT proname FROM pg_proc WHERE proname IN ('detect_blocked_dependents','traverse_prerequisites');
  -- both present; SECURITY INVOKER; EXECUTE granted to authenticated, service_role
  ```
- [ ] **The knowledge graph is actually populated.** Loop D is a pure no-op with an empty graph. Confirm `concept_edges` has prerequisite edges (seeded by `20260703000100_concept_edges_seed_from_concept_codes.sql`):
  ```sql
  SELECT edge_type, count(*) FROM concept_edges GROUP BY edge_type;  -- expect a nonzero 'prerequisite' count
  ```
- [ ] **Learner twin snapshots exist for real students.** `detect_blocked_dependents` reads each student's LATEST `learner_twin_snapshots` row; with no snapshots the RPC returns nothing and Loop D never fires. Confirm the twin builder has run:
  ```sql
  SELECT count(DISTINCT student_id) FROM learner_twin_snapshots;  -- expect > 0 on the target env
  ```
- [ ] **Flag seed applied** (`20260702000700`). Verify:
  ```sql
  SELECT flag_name, is_enabled, rollout_percentage FROM feature_flags WHERE flag_name = 'ff_digital_twin_v1';
  -- expect: one row, is_enabled=false, rollout_percentage=0
  ```
- [ ] `daily-cron` redeployed with the shared `adaptive_remediation_triggered` step (already required for Loops A/B/C — no new step for Loop D). `CRON_SECRET` set in **both** the Supabase Edge Function secrets and the Vercel environment (the worker fails closed — 401 — without it). `SITE_URL` set per-environment on `daily-cron` (unset falls back to production — keep staging/prod `CRON_SECRET` distinct so a cross-env call can only 401). See the Loop A runbook's prerequisites for the full trigger-wiring checklist.
- [ ] **Know the bus caveat (narrower for Loop D than A/B/C).** Loop D **verify reads LIVE state** (`concept_mastery` via `buildBlockedPrerequisiteVerifyObservations`), NOT a replay of `state_events`, so — unlike Loops A/B/C — Loop D verify is **not blinded** when `ff_event_bus_v1` is OFF. Only the `system.prerequisite_resolved` **event publish** is bus-gated (silently dropped when the bus is off); the `audit_logs` rows and the `adaptive_interventions` ledger are bus-independent. Use those two as the primary monitoring source (see Monitoring).
- [ ] Sentry capturing server errors for `/api/cron/adaptive-remediation`.
- [ ] **Companion monitoring surfaces live** (being built in parallel this session): the `adaptive-loops-monitor` cron and the `super-admin/adaptive-loops` dashboard — the dashboard's `trigger_signal` breakdown must include the **4th `blocked_prerequisite` column** before you rely on it for Loop D. Confirm the column renders before Stage 2.

## Staging synthetic blocked-prerequisite drill

Run the full loop end-to-end on staging with a clearly-marked **test student** before any production flip. Because Loop D reads the knowledge graph and the twin snapshot, the drill has one extra setup step over the A/B/C drills: you must seed a prerequisite edge and a weak-prerequisite snapshot.

### Step 0 — enable the flag on staging only

```sql
UPDATE feature_flags
SET is_enabled = true, rollout_percentage = 100,
    target_environments = ARRAY['staging']::text[], updated_at = now()
WHERE flag_name = 'ff_digital_twin_v1';
```

The worker resolves its environment as `VERCEL_ENV || NODE_ENV`; confirm the string your staging deploy actually reports and include it in the array (a mismatch silently keeps INJECT off). Flag cache TTL is 5 minutes — wait it out before drilling.

### Step 1 — seed a prerequisite edge + a weak-prerequisite twin snapshot

Pick two curriculum topics in one subject for the test student's grade: a PREREQUISITE topic (`:prereq_topic_id`) and a DEPENDENT topic (`:dependent_topic_id`). Create the graph edge and a snapshot where the prerequisite is BELOW the mastery floor (0.4).

```sql
-- 1a. Prerequisite edge: prereq -> dependent (edge_type='prerequisite').
INSERT INTO concept_edges (from_topic_id, to_topic_id, edge_type, strength, source)
VALUES (':prereq_topic_id', ':dependent_topic_id', 'prerequisite', 0.9, 'drill')
ON CONFLICT DO NOTHING;

-- 1b. Latest twin snapshot with the prerequisite weak (mastery 0.20 < 0.4).
--     detect_blocked_dependents reads mastery_by_topic + decay_state from the
--     MOST RECENT snapshot_date row for the student.
INSERT INTO learner_twin_snapshots (student_id, snapshot_date, mastery_by_topic, decay_state)
VALUES (
  ':test_student_id', now(),
  jsonb_build_object(':prereq_topic_id', 0.20),   -- below mastery_floor
  jsonb_build_object(':prereq_topic_id', 0.30)    -- below decay_floor too → reason 'both'
);
```

Also make the DEPENDENT topic count as "actively attempted" so the `dependentIsActive` gate passes — give the test student a `concept_mastery` touch on the dependent topic within the last 14 days:

```sql
INSERT INTO concept_mastery (student_id, topic_id, p_know, last_attempted_at)
VALUES (':test_student_id', ':dependent_topic_id', 0.35, now())
ON CONFLICT (student_id, topic_id) DO UPDATE SET last_attempted_at = now();
```

Ensure NO active Loop A/C row exists for this subject and NO active Loop D row for this (subject, dependent chapter) — the arbiter's precedence and the one-active-max gate would otherwise pre-empt the drill.

### Step 2 — trigger the worker with `phase: 'inject'`

```bash
curl -s -X POST "https://<staging-host>/api/cron/adaptive-remediation" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"phase":"inject"}'
```

Expect `inject.injectedBlockedPrereq: 1`. If the whole inject reports `skipped: "flag_off"`, ALL of A/B/C/D flags are off (check Step 0). A second identical call must report `deduped: 1` (the partial unique index on `(student, subject, chapter)` is the race-proof backstop).

### Step 3 — verify the intervention row + audit

```sql
SELECT id, student_id, subject_code, chapter_number, trigger_signal, status, verify_by, trigger_snapshot
FROM adaptive_interventions
WHERE student_id = ':test_student_id' AND trigger_signal = 'blocked_prerequisite'
ORDER BY created_at DESC LIMIT 1;
-- expect: status='active'; chapter_number = the DEPENDENT chapter;
--   verify_by = created_at + 7 days;
--   trigger_snapshot carries { prereqChapterNumber, prereqMastery, prereqDecay,
--     blockReason:'both', edgeStrength, edgeSource, rulesVersion:'loop-d-v1' }

SELECT action, resource_id, details FROM audit_logs
WHERE action = 'system.blocked_prerequisite_injected'
ORDER BY created_at DESC LIMIT 1;
-- details (jsonb) = subject_code, dependent_chapter, prereq_chapter, block_reason,
--   edge_source, verify_by, rules_version — UUIDs/codes only, no PII (P13).
```

> Note: Loop D inject writes **only** an `audit_logs` row (no `state_events` publish at inject) — do not look for a `system.prerequisite_*` event at this stage.

### Step 4 — recovered branch (prerequisite recovers in-window)

Raise the prerequisite's current mastery above the floor and re-touch it recently, then verify. Loop D verify re-checks LIVE `concept_mastery`, so update the prerequisite's own `concept_mastery` row (not the snapshot):

```sql
INSERT INTO concept_mastery (student_id, topic_id, p_know, last_practiced_at, last_attempted_at)
VALUES (':test_student_id', ':prereq_topic_id', 0.75, now(), now())
ON CONFLICT (student_id, topic_id)
DO UPDATE SET p_know = 0.75, last_practiced_at = now(), last_attempted_at = now();
```

Then POST `{"phase":"verify"}`. Expect `verify.recovered: 1`, the row `status='recovered'` with `resolved_at` set, a `system.prerequisite_resolved` event (only if `ff_event_bus_v1` is ON), and a `system.prerequisite_resolved` audit row (always). To continue to the escalation drill, re-run Steps 1–3 with a different dependent chapter (the 7-day cooldown blocks the same subject).

### Step 5 — expired → `escalated` branch (prerequisite never recovers)

Leave the prerequisite weak (do NOT raise its mastery), fast-forward the window, and verify:

```sql
UPDATE adaptive_interventions
SET verify_by = now() - interval '1 minute'
WHERE id = ':intervention_id' AND status = 'active';
-- keep verify_by > created_at, else the worker falls back to the canonical 7 days.
```

POST `{"phase":"verify"}`. Expect `verify.escalated: 1`, the row `status='escalated'` with `resolved_at` set, and a metadata-only `system.blocked_prerequisite_expired` audit row. **Confirm NO teacher/parent notification was sent** (Slice 1 has no Loop D notification channel — `escalated` is terminal-only). Confirm no `teacher_remediation_assignments` row and no `notifications` row were created for this intervention.

```sql
SELECT action, resource_id, details FROM audit_logs
WHERE action = 'system.blocked_prerequisite_expired' ORDER BY created_at DESC LIMIT 1;
```

### Step 6 — A>D>C>B precedence-ceiling drill (anti-storm)

Trip A + D + C + B for the SAME test student in one run and confirm exactly **ONE** new row opens, by precedence **A > D > C > B**:

1. Seed a mastery-cliff (A — see Loop A runbook Step 1), a blocked prerequisite (D — Steps 1 above), a `'high'`-band subject (C — see adaptive-program-rollout §4.C Step C1), and `'broken'` inactivity (B — see §4.B Step B1), all for the same student.
2. `POST {"phase":"inject"}` once.
3. Expect exactly one new `active` row with `trigger_signal='mastery_cliff'` (A wins). `inject.ceilingDeferred` counts the deferred D/C/B candidates. Now REMOVE the Loop A signal and re-run: expect the winner to become `blocked_prerequisite` (D beats C and B). This is the load-bearing Slice-1 precedence assertion — D sits ABOVE C.

### Step 7 — cleanup

```sql
DELETE FROM adaptive_interventions WHERE student_id = ':test_student_id' AND trigger_signal = 'blocked_prerequisite';
DELETE FROM concept_edges WHERE source = 'drill';
DELETE FROM learner_twin_snapshots WHERE student_id = ':test_student_id' AND mastery_by_topic ? ':prereq_topic_id';
-- restore/remove the drill concept_mastery rows for the prereq + dependent topics.
DELETE FROM audit_logs WHERE action LIKE 'system.%prerequisite%' AND resource_id = ':intervention_id';
```

## Flag flip sequence

All flips go through the super-admin console (`/super-admin/flags` → PATCH `/api/super-admin/feature-flags`; requires the `super_admin` admin tier; writes a `feature_flag.updated` admin audit + `ops_events` row + invalidates the flag cache). SQL below is break-glass only. Treat every flip as taking up to 5 minutes to propagate (cache TTL).

`ff_digital_twin_v1` is on the **constitution-pinned protected-flag list** (`packages/lib/src/flags/protected-flags.ts`). Follow the protected-flag flip procedure — a protected flag cannot be flipped by a lower tier or without the audit trail.

Recommended gate: enable Loop D only **after Loop A is at Stage 3 (global) and Loops B/C are at least at pilot**, so the shared arbiter and verify sweep are already proven at scale.

### Stage 1 — staging (drill above must be green)

```sql
UPDATE feature_flags SET is_enabled = true, rollout_percentage = 100,
    target_environments = ARRAY['staging']::text[], updated_at = now()
WHERE flag_name = 'ff_digital_twin_v1';
```

Let ≥ 2 nightly cron ticks run. Confirm `adaptive_remediation_triggered` in the daily-cron response and zero `inject.errors` / `verify.errors`.

### Stage 2 — production pilot cohort (Day 3+ if staging clean)

```sql
UPDATE feature_flags SET is_enabled = true, rollout_percentage = 10,
    target_environments = NULL, updated_at = now()
WHERE flag_name = 'ff_digital_twin_v1';
```

**Use `rollout_percentage`, NOT `target_institutions`.** The cron worker evaluates the flag WITHOUT an `institutionId` in context, so any institution scoping resolves false and disables Loop D injection entirely (identical trap to Loops A/B/C — see the sibling runbooks). The per-student cohort comes from `hashForRollout(auth_user_id, 'ff_digital_twin_v1')` inside the inject loop. Hold 1 week; watch Monitoring.

### Stage 3 — global (Day 10+ if pilot clean)

```sql
UPDATE feature_flags SET rollout_percentage = 100, updated_at = now()
WHERE flag_name = 'ff_digital_twin_v1';
```

2-week observation window before declaring Loop D Slice 1 shipped.

## Kill-switch semantics

### Flag OFF = DRAIN, not freeze (identical contract to Loops A/B/C)

```sql
UPDATE feature_flags SET is_enabled = false, updated_at = now()
WHERE flag_name = 'ff_digital_twin_v1';   -- prefer the console (audit trail)
```

Effects, in order:
1. Within ≤5 min (cache TTL): the Loop D INJECT branch contributes **zero** candidates to the arbiter — no new blocked-prerequisite interventions. The A/B/C branches keep respecting their own separate flags.
2. VERIFY keeps running nightly — gated on active rows, not the flag. Mid-flight `blocked_prerequisite` rows drain to `recovered` (prerequisite recovered) or `escalated` (window elapsed). No student is left in limbo.
3. Expected full drain: ≤ 7 days (`return_window_days`) + 1 daily cron tick.

The daily-cron trigger is deliberately NOT flag-gated in Deno — gating it there would break the drain. Do not "fix" this.

### Hard stop (ops-only, when natural drain is not acceptable)

Use the program-level hard-stop transaction from `adaptive-program-rollout.md §6`, scoped to Loop D via the `trigger_signal` filter:

```sql
-- inside the standard BEGIN … WITH dismissed AS (UPDATE … WHERE status='active'
--   AND trigger_signal = 'blocked_prerequisite' RETURNING id) … audit … COMMIT;
```

**Flip the flag OFF first** or the next nightly inject recreates rows. `dismissed` rows start the 7-day per-subject cooldown. Because Slice-1 Loop D `escalated` sends no human notification, a hard stop here suppresses nothing user-facing — it only shortcuts the verify drain.

## Monitoring after enablement

Primary sources, in order of reliability (mirrors the sibling runbooks; Loop D specifics called out):

1. **`adaptive_interventions` table** (always available — the loop's own ledger). Filter to Loop D:
   ```sql
   -- Daily Loop D injection volume (last 7 days)
   SELECT date_trunc('day', created_at) AS day, count(*)
   FROM adaptive_interventions
   WHERE trigger_signal = 'blocked_prerequisite' AND created_at >= now() - interval '7 days'
   GROUP BY 1 ORDER BY 1 DESC;

   -- Loop D terminal split (recovered vs escalated) — last 30 days
   SELECT status, count(*)
   FROM adaptive_interventions
   WHERE trigger_signal = 'blocked_prerequisite' AND resolved_at >= now() - interval '30 days'
   GROUP BY status;
   ```
2. **`audit_logs`** (bus-independent — the reliable Loop D event source in Slice 1, since inject/expired write only audit rows):
   ```sql
   SELECT action, count(*) FROM audit_logs
   WHERE action IN ('system.blocked_prerequisite_injected','system.prerequisite_resolved','system.blocked_prerequisite_expired')
     AND created_at >= now() - interval '7 days'
   GROUP BY action;
   ```
3. **`super-admin/adaptive-loops` dashboard** (parallel work) — read the `blocked_prerequisite` (4th) `trigger_signal` column for the per-loop new-row volume + terminal split. The `adaptive-loops-monitor` cron raises the ceiling-violation / escalation-storm / missed-heartbeat alerts (triage in `docs/runbooks/adaptive-loops-oncall.md`).
4. **Cron telemetry / Vercel logs**: `adaptive_remediation: run complete` carries `inject.injectedBlockedPrereq` and the verify `{recovered, escalated}` split. A flat 0 for multiple days with active `blocked_prerequisite` rows present means the worker is failing — check Vercel logs.
5. **`state_events`** (`kind IN ('system.prerequisite_resolved',...)`) — **only populated when `ff_event_bus_v1` is ON**. Do not build alerts on this source unless the bus is verified ON.
6. **Sentry**: error rate on `/api/cron/adaptive-remediation` < 0.5%.

Investigate when:
- `inject.errors` or `verify.errors` > 0 on two consecutive nightly runs.
- Loop D `escalated` share is very high — because Slice-1 `escalated` = "prerequisite never recovered in 7 days with no notification", a high share means students are stuck on prerequisites with no human being told. Escalate to assessment: either the graph edges are wrong (false blocks) or the 7-day window/no-notification design needs the next slice sooner. Review with assessment before adjusting floors.
- Loop D injection volume is implausibly high relative to A/C — likely a `concept_edges` seeding error (spurious prerequisite edges) or stale twin snapshots. Review the graph with architect + assessment.
- The A>D>C>B ceiling appears violated (more than one NEW row per student per night) — top alert; see the on-call runbook.

## Rollback

1. **Standard**: flip `ff_digital_twin_v1` OFF via the console. Drain semantics apply. No data loss; no schema to reverse.
2. **Escalated**: flag OFF + hard-stop SQL scoped `trigger_signal = 'blocked_prerequisite'`.
3. **Optional flag-row removal** (documented manual DOWN in `20260702000700`): `DELETE FROM feature_flags WHERE flag_name = 'ff_digital_twin_v1';` — a missing flag resolves OFF; active rows still drain via verify.
4. Migrations stay in place — `concept_edges`, `learner_twin_*`, the RPCs, and the `trigger_signal` CHECK widening are all additive, RLS-locked / SECURITY INVOKER, and inert while the flag is OFF.

## References

- Loop D verify evaluator (pure): `packages/lib/src/learn/blocked-prerequisite-verify-evaluation.ts`
- Loop D rules + classifier + arbiter: `packages/lib/src/learn/adaptive-loops-rules.ts` (`BLOCKED_PREREQUISITE_RULES`, `classifyPrerequisiteBlock`, `planBlockedPrerequisiteIntervention`, `arbitrateInterventions`, `LOOP_PRECEDENCE`)
- Worker route (Loop D inject + verify branches): `apps/host/src/app/api/cron/adaptive-remediation/route.ts`
- RPCs: `supabase/migrations/20260702000400_traverse_prerequisites.sql`, `20260702000500_detect_blocked_dependents.sql`
- Substrate migrations: `20260702000100_concept_edges.sql`, `…000200_learner_twin_snapshots.sql`, `…000300_learner_twin_memory.sql`, `…000700_seed_ff_digital_twin_v1.sql`, `…000800_adaptive_interventions_allow_blocked_prerequisite.sql`; graph seed `20260703000100_concept_edges_seed_from_concept_codes.sql`
- Event schemas: `packages/lib/src/state/events/registry.ts` (`system.prerequisite_blocked` / `system.prerequisite_resolved`)
- Flag registry: `packages/lib/src/flags/registries/pedagogy.ts` (`DIGITAL_TWIN_FLAGS.V1`); protected-flag pin: `packages/lib/src/flags/protected-flags.ts`
- Sibling runbooks (shared machinery — not duplicated here): `docs/runbooks/adaptive-remediation-rollout.md` (Loop A), `docs/runbooks/adaptive-program-rollout.md` (Loops A+B+C + Pulse)
- On-call triage: `docs/runbooks/adaptive-loops-oncall.md`
- Regression pin: REG-175
</content>
</invoke>
