# Adaptive Program (Phase A: Loops A + B + C + Student Pulse) — Consolidated Rollout Runbook

**Date:** 2026-06-13
**Status:** Pre-rollout. All three adaptive flags seeded OFF; no environment has the loops enabled.
**Owner:** ops (this runbook + flip procedure + monitoring) · architect (schema/CHECK extension/flag seeds/cron-route security) · backend (cron worker phases, notifications, event registry) · assessment (guardrail constants, recovery/return windows, cross-loop ceiling)

> This runbook is the **program-level** rollout plan for the whole adaptive monitoring program. The Loop A mechanics (synthetic-cliff drill, escalation branches, monitoring queries, kill switch) are documented in full in **`docs/runbooks/adaptive-remediation-rollout.md`** — that doc is **not duplicated here**; this one cross-references it and adds the Loop B / Loop C drills, the cross-loop anti-storm expectations, the consolidated enablement order, and the program-level kill/rollback story.

---

## 0. What ships together (the deployment fact)

Verified live 2026-06-13 (read-only, Supabase Management API):

| Environment | Project ref | Migration head | `adaptive_interventions` table | `ff_adaptive_remediation_v1` | `ff_adaptive_loops_bc_v1` |
|---|---|---|---|---|---|
| **Prod** | `shktyoxqhundlvkiwguu` (Alfanumrik Adaptive Learning OS) | `20260619000100` | **absent** | **absent** | **absent** |
| **Staging** | `gzpxqklxwzishrkiaatd` | `20260619000400` | present | present (OFF/0%) | absent (`bc_flag_rows=0`) |

Consequence (architect-verified): prod's applied migrations stop at `20260619000100`. **Loop A** (`20260619000200` table / `…000300` seed / `…000400` dedupe), the **Student Pulse** flag (`…000100`, already on prod), and **Loops B/C** (`…000500` CHECK-extension / `…000600` seed) are all merged-or-pending and will **ALL apply together on the next successful prod `db push`**. After that single deploy, prod will have:

- the `adaptive_interventions` table (with the widened `trigger_signal` + `chapter_number >= 0` CHECKs),
- all three flags present and **seeded OFF** (`is_enabled=false, rollout=0`),
- zero behavior change until an operator flips a flag.

Staging is one step ahead (Loop A applied; B/C migrations pending), so the same `db push` that hits prod will only add `…000500/…000600` on staging.

---

## 1. The four flags (three loop flags + one hard precondition)

| Flag | Seed migration | Controls | Default | Authority |
|---|---|---|---|---|
| `ff_event_bus_v1` | `20260507000007_add_ff_event_bus_v1.sql` | **HARD PRECONDITION** — gates `publishEvent()` writes to `state_events` and the in-process event bus. NOT a loop flag. | OFF | n/a (infra) |
| `ff_school_pulse_v1` | `20260619000100_seed_ff_school_pulse_v1.sql` | **Pulse panel** on the school-admin Command Center (visibility only; mounts inside `ff_school_command_center`). | OFF | CEO-approved F3 |
| `ff_adaptive_remediation_v1` | `20260619000300_seed_ff_adaptive_remediation_v1.sql` | **Loop A** — mastery-cliff → auto-inject remediation cards → verify recovery → escalate. | OFF | CEO-approved TIERED model 3 |
| `ff_adaptive_loops_bc_v1` | `20260619000600_seed_ff_adaptive_loops_bc_v1.sql` | **Loops B + C together** — Loop B (inactivity `'broken'` → re-engagement nudge → parent escalation) + Loop C (at-risk-concentration `'high'` band → immediate teacher/parent escalation → band-drop verify). Separate flag from Loop A (Decision X1 — independent ramp). | OFF | Loop B full-auto; Loop C TIERED w/ immediate escalation |

All three loop flags are seeded **OFF via the double gate** (`is_enabled=false` AND `rollout_percentage=0`). The read path (`isFeatureEnabled` in `src/lib/feature-flags.ts`) returns `false` when **either** `is_enabled=false` **or** `rollout_percentage <= 0` (lines 111-135). Merging the migrations is a zero-behavior change.

### Worker gating (Decision X2 — per-`trigger_signal` inject, shared verify drain)

The single worker route `src/app/api/cron/adaptive-remediation/route.ts` (`POST { phase?: 'inject'|'verify'|'all' }`, CRON_SECRET-gated) gates **inject** per loop:

- `mastery_cliff` inject branch → gated on `ff_adaptive_remediation_v1` (Loop A).
- `inactivity` + `at_risk_concentration` inject branches → gated on `ff_adaptive_loops_bc_v1` (Loops B/C).

**Verify is gated on the existence of `status='active'` rows, NOT on any flag.** This is the drain-not-freeze contract: a row, once opened, always reaches a terminal state even if its flag is flipped OFF mid-flight.

---

## 2. HARD PRECONDITION — `ff_event_bus_v1` (verified state + blocker call)

Both Loop A recovery verify and Loop B/C verify read learner observations (`learner.mastery_changed`, activity) that flow through the event bus into `state_events` / the bus projections. **With the bus OFF, verification is BLIND: no recovery/return observation is recorded, every active intervention sits `pending` until its window elapses, and then EVERY intervention expires straight to escalation** (Loop A → teacher/parent; Loop B → parent; Loop C → re-notify). That is a notification-storm + false-escalation failure mode, not a graceful degrade.

Spec §9 states the precondition explicitly: **`ff_adaptive_loops_bc_v1` ON ⇒ `ff_event_bus_v1` ON in the same environment** (and the same inheritance applies to Loop A).

### Verified flag state (read-only, 2026-06-13)

| Environment | `ff_event_bus_v1` row | Resolves to | Precondition |
|---|---|---|---|
| **Prod** (`shktyoxqhundlvkiwguu`) | `is_enabled=true, rollout_percentage=100` | **ON** | **SATISFIED** |
| **Staging** (`gzpxqklxwzishrkiaatd`) | `is_enabled=true, rollout_percentage=0` | **OFF** | **NOT SATISFIED — BLOCKER** |

### Why staging is OFF despite `is_enabled=true`

`isFeatureEnabled` (`src/lib/feature-flags.ts:134-135`): when `rollout_percentage !== null && < 100`, a value `<= 0` returns `false` **before** the `is_enabled` result can matter. Staging's `rollout_percentage=0` is the effective kill — the bus does not broadcast on staging.

### BLOCKER (must clear before ANY loop flag is flipped on staging)

Staging is exactly where the loops are enabled first and where all synthetic drills run (§4). **Do not flip `ff_school_pulse_v1`, `ff_adaptive_remediation_v1`, or `ff_adaptive_loops_bc_v1` ON on staging until `ff_event_bus_v1` resolves ON on staging.** Clear it first:

```sql
-- STAGING ONLY. Bring the bus fully ON (clears the rollout=0 kill).
UPDATE feature_flags
SET is_enabled = true, rollout_percentage = 100, updated_at = now()
WHERE flag_name = 'ff_event_bus_v1';
-- Verify: expect is_enabled=true, rollout_percentage=100
SELECT flag_name, is_enabled, rollout_percentage FROM feature_flags WHERE flag_name='ff_event_bus_v1';
```

Prefer the super-admin console for the audit trail; SQL shown for break-glass. Wait out the 5-minute flag cache TTL before drilling.

**Prod is fine** — the bus is already ON at 100%, so no precondition work is needed there. (Pulse alone — `ff_school_pulse_v1` — is visibility-only and does NOT read the bus, so Pulse could technically render with the bus off; but the loops cannot verify, so the program order below keeps the bus-first rule for both environments to avoid a half-instrumented state.)

---

## 3. Recommended enablement ORDER

**One-liner:** event bus ON (staging) → Pulse (visibility, lowest risk) → Loop A (proven) → Loops B/C — each gate staging-first, then a prod `rollout_percentage` cohort ramp (NOT `target_institutions`), then global, every flip via the super-admin console with audit.

```
0. ff_event_bus_v1 ON on STAGING        (clears the §2 blocker; prod already ON)
   │
1. ff_school_pulse_v1 ON                 (Pulse panel — pure visibility, no cron, no writes; lowest risk)
   │
2. ff_adaptive_remediation_v1 ON         (Loop A — proven; full synthetic-cliff drill in adaptive-remediation-rollout.md)
   │
3. ff_adaptive_loops_bc_v1 ON            (Loops B + C — on the Loop A substrate, after A is stable)
```

Each numbered gate runs the same three-stage ramp:

| Stage | Where | How | Hold |
|---|---|---|---|
| **Stage 1 — staging** | staging project | `is_enabled=true, rollout_percentage=100, target_environments=ARRAY['staging']` (confirm the actual env string the deploy reports — `VERCEL_ENV \|\| NODE_ENV`; a mismatch silently keeps inject off). Run the drills in §4. | ≥ 2 nightly cron ticks, clean |
| **Stage 2 — prod pilot** | prod | `is_enabled=true, rollout_percentage=10, target_environments=NULL`. | 1 week, watch §5 |
| **Stage 3 — prod global** | prod | `rollout_percentage=100`. | 2-week observation before declaring shipped |

### Use `rollout_percentage`, NOT `target_institutions`, for the pilot cohort

**The cron worker evaluates the loop flags WITHOUT an `institutionId` in context.** Per `isFeatureEnabled` institution scoping (lines 126-128), any non-empty `target_institutions` array resolves to `false` when no `institutionId` is supplied → injection is disabled entirely. The per-student pilot cohort comes from the deterministic `hashForRollout(auth_user_id, flag_name)` check inside the inject loop; the worker's global gate passes for any `rollout_percentage > 0`. **Institution scoping is a trap for these flags — do not use it.** (Pulse, a UI flag read with role/institution context, *could* use institution scoping, but keep the program consistent and ramp Pulse by percentage too.)

### Independent ramps

Loop A and Loops B/C are **separate flags** (Decision X1) and ramp independently. Loop A reaching Stage 3 (global) is the recommended gate before starting Loop B/C Stage 1, but ops can hold B/C at any stage without touching A, and can roll B/C back without touching A.

---

## 4. Staging drills (per loop)

> Loop A's full drill — synthetic mastery-cliff insert, inject/verify trigger, rhythm-lane + notification checks, recovery branch, fast-forward, B2B/B2C escalation confirmation, cleanup — is in **`docs/runbooks/adaptive-remediation-rollout.md` §"Staging synthetic-cliff drill" (Steps 0-7)**. Run that verbatim for Loop A. Below are the **Loop B and Loop C** drills, which reuse the same worker, the same `x-cron-secret` trigger, and the same fast-forward technique.

**Common preamble (all loop drills):**
- `ff_event_bus_v1` must resolve ON on staging (§2 blocker cleared) — otherwise verify is blind and every drill expires to escalation, masking the recovered/returned branches.
- Use a clearly-marked **test student** (`is_active=true, deleted_at IS NULL`).
- The flag for the loop under test must be ON + env-matched on staging.
- Flag cache TTL is 5 minutes — wait it out after any flip.
- Trigger the worker with the CRON_SECRET; inject then verify are separate POSTs so you control the phase.

```bash
# Generic worker trigger (phase = inject | verify | all)
curl -s -X POST "https://<staging-host>/api/cron/adaptive-remediation" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"phase":"inject"}'
```

### 4.A Loop A — synthetic mastery-cliff

See `adaptive-remediation-rollout.md` Steps 0-7. Summary: insert a `learner.mastery_changed` event with a ≥ 0.15 drop (e.g. 0.65 → 0.45) on a fictional chapter (99) within the last 24h → `phase:inject` opens an `active` row + a `remediation_review` rhythm card + a `remediation_assigned` notification → optionally inject an in-window recovery observation and `phase:verify` for the `recovered` branch → else fast-forward `verify_by` and `phase:verify` for the escalation branch.

### 4.B Loop B — synthetic inactivity / streak-break (`'broken'` verdict)

Loop B triggers only on `inactivity.verdict === 'broken'` (last active **2+ UTC days** ago, no streak freeze — Decision B3). `'at_risk'` (one grace day) does NOT open a row. Loop B is queue-less: the intervention is a **notification** (student + encouraging parent alert), and the `adaptive_interventions` row tracks *whether the student returned*. It uses the sentinel triple `(student, '_inactivity', chapter_number=0)`.

**Step B1 — back-date last activity to create the `'broken'` state.** Set the test student's last-active marker 2+ UTC days in the past (the streak path reads `student_learning_profiles` / `last_active`):

```sql
-- Back-date last activity for the test student so inactivity.verdict = 'broken'.
UPDATE student_learning_profiles
SET last_active = now() - interval '3 days', updated_at = now()
WHERE student_id = '<test_student_id>';
-- (If your staging reads last_active from students, back-date there too.)
-- Also ensure no active streak freeze for the student (hasStreakFreeze=false),
-- and that students.created_at is OLDER than onboarding_grace_days (7) — Loop B
-- never nudges a student created < 7 days ago (guardrail B-G6).
```

**Step B2 — inject.** `POST {"phase":"inject"}`. Expect one new row:

```sql
SELECT id, subject_code, chapter_number, trigger_signal, status, verify_by, trigger_snapshot
FROM adaptive_interventions
WHERE student_id = '<test_student_id>' AND trigger_signal = 'inactivity'
ORDER BY created_at DESC LIMIT 1;
-- expect: subject_code='_inactivity', chapter_number=0, status='active',
--   verify_by = created_at + 3 days,
--   trigger_snapshot carries { daysSinceActive, hadStreakFreeze, evaluatedAtIso, rulesVersion }
```

Confirm the notifications: one **student** nudge (encouraging) ALWAYS, plus an **encouraging parent alert** when a guardian is linked (status approved/active), preference-gated. Confirm **no** `remediation_review` rhythm card was added (Loop B is queue-less — `GET /api/rhythm/today` is unchanged). Toggle Hindi and confirm bilingual copy (P7).

```sql
SELECT type, recipient_type, idempotency_key FROM notifications
WHERE idempotency_key LIKE 'engagement_nudge_%' ORDER BY created_at DESC LIMIT 5;
-- expect: one ..._student + (if linked) one ..._<guardian_id>; day-0 ENCOURAGING tone
```

**Step B3 — recovered branch (return within window).** Simulate a genuine return inside `[created_at, verify_by]` (a real session/quiz event, NOT a streak freeze-bump — assessment's "qualifying activity" predicate, spec §12-B). Then `POST {"phase":"verify"}`:

```sql
UPDATE student_learning_profiles SET last_active = now(), updated_at = now()
WHERE student_id = '<test_student_id>';   -- inside the 3-day window
-- POST verify → expect status='recovered', resolved_at set,
--   system.engagement_returned event (if bus ON) + optional celebratory notification.
```

**Step B4 — escalation branch (no return → expiry → PARENT).** Fast-forward and verify with the student still inactive (do NOT advance last_active):

```sql
UPDATE adaptive_interventions
SET verify_by = now() - interval '1 minute'
WHERE id = '<intervention_id>' AND status = 'active';
-- keep verify_by > created_at, else the worker falls back to the canonical window.
-- POST {"phase":"verify"}
```

Confirm the **parent-only** escalation (Decision B4 — Loop B NEVER routes to a teacher, NEVER writes a `teacher_remediation_assignments` row):

```sql
SELECT status, escalated_to, teacher_assignment_id FROM adaptive_interventions WHERE id='<intervention_id>';
-- expect: status='escalated', escalated_to='parent' (or NULL if no guardian linked),
--   teacher_assignment_id IS NULL  (always — Loop B has no teacher path)

SELECT type, recipient_type, idempotency_key FROM notifications
WHERE idempotency_key LIKE 'engagement_escalated_%' ORDER BY created_at DESC LIMIT 5;
-- expect: CONCERNED-tone parent alert, distinct idempotency key from the day-0 nudge

SELECT action, details FROM audit_logs
WHERE action = 'system.engagement_escalated' ORDER BY created_at DESC LIMIT 3;
-- bus-independent; details carry UUIDs + derived metrics only (P13)
```

### 4.C Loop C — synthetic high concentration (`'high'` band)

Loop C triggers when a subject's at-risk-chapter count reaches the `high` band (≥ `concentration_high_min` = 5 chapters with mastery < 0.4). **The escalation IS the intervention** (Decision C1) — it fires immediately at inject (teacher B2B / parent B2C, reusing Loop A's resolver verbatim), opens the row `active` with `escalated_to` already set, and verify watches for the band to drop. Window N = 14 days.

**Step C1 — seed 5+ at-risk chapters in one subject.** Create/lower mastery on ≥ 5 chapters in the same subject for the test student so `deriveAtRiskConcentration` buckets to `'high'`:

```sql
-- Seed 5 at-risk chapters (mastery < 0.4) in one subject for the test student.
-- Adjust table/columns to your learner_mastery shape on staging.
INSERT INTO learner_mastery (student_id, subject_code, chapter_number, mastery, updated_at)
VALUES
  ('<test_student_id>','science', 1, 0.20, now()),
  ('<test_student_id>','science', 2, 0.25, now()),
  ('<test_student_id>','science', 3, 0.30, now()),
  ('<test_student_id>','science', 4, 0.18, now()),  -- lowest → worst chapter
  ('<test_student_id>','science', 5, 0.35, now())
ON CONFLICT (student_id, subject_code, chapter_number)
DO UPDATE SET mastery = EXCLUDED.mastery, updated_at = now();
-- Ensure NO active Loop A (mastery_cliff) row exists for 'science' — the A↔C
-- coexistence guardrail (C-G3) would otherwise skip the Loop C injection.
```

**Step C2 — inject (escalates immediately).** `POST {"phase":"inject"}`. Expect one row, already escalated:

```sql
SELECT id, subject_code, chapter_number, trigger_signal, status, escalated_to,
       teacher_assignment_id, verify_by, trigger_snapshot
FROM adaptive_interventions
WHERE student_id='<test_student_id>' AND trigger_signal='at_risk_concentration'
ORDER BY created_at DESC LIMIT 1;
-- expect: subject_code='science', chapter_number=4 (worst — lowest mastery),
--   status='active', escalated_to IN ('teacher','parent',NULL) set AT INJECT,
--   verify_by = created_at + 14 days,
--   trigger_snapshot = { atRiskChapterCount>=5, worstChapterMastery, bandAtTrigger:'high', ... }
```

Confirm the escalation branch (reuses Loop A's `resolveEscalationTarget` + `teacher_remediation_assignments` + the `20260619000400` dedupe index):
- **B2B (teacher path)** — precondition: test student has an active `class_students` row in a class with an active subject-matched `class_teachers` row → `escalated_to='teacher'`, `teacher_assignment_id` NOT NULL; a `teacher_remediation_assignments` row exists (chapter_id from worst chapter, or NULL → "general/subject-level").
- **B2C (parent path)** — precondition: NO roster teacher + an `approved`/`active` `guardian_student_links` row → `escalated_to='parent'`, `teacher_assignment_id` NULL, parent + student notifications.
- **none** — neither → `escalated_to=NULL`, student-only, ops-visible via the event payload.

```sql
SELECT action, details FROM audit_logs
WHERE action = 'system.concentration_escalated' ORDER BY created_at DESC LIMIT 3;
```

**Step C3 — recovered branch (band drops below `high`).** Raise enough chapters out of at-risk so the subject's current at-risk count `< 5`, then `POST {"phase":"verify"}`:

```sql
UPDATE learner_mastery SET mastery = 0.70, updated_at = now()
WHERE student_id='<test_student_id>' AND subject_code='science' AND chapter_number IN (1,2);
-- now only 3 chapters < 0.4 → band 'medium' (< high_min)
-- POST verify → expect status='recovered', resolved_at, system.concentration_resolved.
```

**Step C4 — re-notify branch (still `high` at expiry).** Keep the subject `'high'` (revert C3), fast-forward, verify:

```sql
UPDATE adaptive_interventions SET verify_by = now() - interval '1 minute'
WHERE id='<intervention_id>' AND status='active';  -- keep verify_by > created_at
-- POST {"phase":"verify"} with the subject still 'high'
```

Expect the **re-notify** (Decision C4 — NOT a second `adaptive_interventions` row): teacher path bumps/re-flags the existing assignment (idempotent); parent path sends a follow-up alert (idempotent key `concentration:<id>:reescalated`); none → ops event. The row ends `status='escalated'` (the human handoff is now the durable owner — the two-beat semantics, §4.2 of the spec). Confirm `system.concentration_reescalated` audit row.

### 4.D Cross-loop ceiling drill (anti-storm)

Trip A + C + B for the SAME test student in one run and confirm exactly **ONE** new row opens, by precedence **A > C > B** (Decision X3):
1. Seed a mastery-cliff (A), a `'high'`-band subject (C), and `'broken'` inactivity (B) all for the same student.
2. `POST {"phase":"inject"}` once.
3. Expect exactly one new `active` row, `trigger_signal='mastery_cliff'` (A wins). C and B are skipped tonight (they re-evaluate next night; the signals persist). Verify-phase transitions on already-open rows are NOT ceiling-capped.

### 4.E Cleanup (all drills)

```sql
DELETE FROM adaptive_interventions
 WHERE student_id='<test_student_id>'
   AND (chapter_number IN (99,0) OR trigger_signal IN ('inactivity','at_risk_concentration'));
DELETE FROM teacher_remediation_assignments WHERE id = '<teacher_assignment_id>';
DELETE FROM notifications WHERE idempotency_key LIKE 'remediation_%' OR idempotency_key LIKE 'engagement_%' OR idempotency_key LIKE 'concentration_%';
DELETE FROM state_events WHERE idempotency_key LIKE 'drill_%';
-- restore the test student's learner_mastery / last_active to a sane baseline.
```

---

## 5. Cross-loop anti-storm expectations (healthy vs storm)

The dominant risk for B/C is **notification storms** — a struggling, disengaged student can trip all three signals the same night. The guardrails (`src/lib/learn/adaptive-loops-rules.ts`, `ADAPTIVE_LOOPS_BC_RULES`, assessment-ratified):

| Guardrail | Value | Effect |
|---|---|---|
| Per-student daily intervention ceiling (across A/B/C) | **1 new / student / day** | At most one new automated touch per student per day. |
| Precedence when multiple signals fire | **A > C > B** | The most acute signal wins the day's single slot. |
| Loop A cards per student per day | 3 | (Loop A internal, unchanged) |
| Loop B nudge cooldown | 7 days | No new inactivity row within a week of a terminal one. |
| Loop B onboarding grace | 7 days | Never nudge a student created < 7 days ago. |
| Loop C subject cooldown | 7 days | No new concentration row for a (student, subject) within a week of terminal. |
| A↔C coexistence (C-G3) | structural | No Loop C row for a subject that already has an ACTIVE Loop A row. |
| One-active-max per loop | structural | Partial unique index; sentinel triple for B, worst-chapter triple for C. |

**Healthy volume looks like:**
- **≤ 1 new intervention per student per day** (the ceiling — this is the load-bearing number to watch).
- Per-loop volume ordered roughly **A > C > B** in NEW-row counts (A is the most common acute signal; C is systemic and rarer; B is gated by the 7-day cooldown + onboarding grace).
- `remediation_assigned` (Loop A) bounded by the 200-student scan cap × 3 cards = **≤ 600/day** structural ceiling.
- One notification per intervention per type (deterministic idempotency keys + upsert); guardian rows only on parent-escalation paths, preference-gated.
- Verify-phase transitions (recovered/returned/escalated/re-notify on *already-open* rows) are NOT ceiling-capped — in-flight loops always drain. This is expected and is not a storm.

**A storm looks like (investigate immediately):**
- More than one NEW `adaptive_interventions` row per student per day → the ceiling is not being enforced (worker bug). Top alert.
- B volume spiking above A/C → cooldown/onboarding-grace not applied, or a back-dated-activity data issue mass-tripping `'broken'`.
- Guardian-facing escalations clustering on a few families beyond ~once per chapter / ~10 days → multi-subject collapse routing many escalations to one home (human review with assessment).
- Escalation share > 50% of terminal outcomes during a pilot → verify is blind (**check `ff_event_bus_v1` first** — §2) or the windows/content are not working (review with assessment).
- `remediation_assigned` approaching 600/day → scan-cap saturation; review the cliff threshold with assessment before raising caps with backend.

---

## 6. Kill switches (each flag OFF = DRAIN, not freeze)

Every loop flag OFF drains rather than freezes — the inject branch short-circuits (no NEW interventions) while the verify phase keeps draining active rows to terminal. **No student is left in limbo.** The daily-cron trigger is deliberately NOT flag-gated in Deno (gating it there would break the drain — do not "fix" this).

| Flag OFF | Immediate effect (≤ 5 min cache TTL) | Drain horizon |
|---|---|---|
| `ff_school_pulse_v1` | Pulse panel stops mounting; Command Center byte-identical to before. No cron, no rows — instant. | n/a (visibility only) |
| `ff_adaptive_remediation_v1` | Loop A inject short-circuits (`skipped:'flag_off'`); rhythm remediation lane renders empty. | ≤ 7 days (longest Loop A `verify_by`) + 1 tick |
| `ff_adaptive_loops_bc_v1` | Loop B + C inject branches short-circuit; mastery_cliff branch still respects its own flag. | ≤ 14 days (longest Loop C `verify_by`) + 1 tick |

Standard rollback for any layer = flip that flag OFF via the super-admin console (audit trail) and let active rows drain.

### Hard stop (ops-only — when the natural drain is not acceptable)

Bulk-resolve active rows to the ops-only terminal `dismissed` (the cron loop never writes it), in ONE transaction with an audit row. **Flip the relevant flag OFF FIRST** or the next nightly inject recreates rows. Filter by `trigger_signal` to scope the hard stop to specific loops and leave the others untouched.

```sql
BEGIN;

WITH dismissed AS (
  UPDATE public.adaptive_interventions
     SET status = 'dismissed', resolved_at = now()
   WHERE status = 'active'
     -- Scope: choose ONE of the filters below.
     -- Loops B/C only (leave Loop A running):
     AND trigger_signal IN ('inactivity','at_risk_concentration')
     -- Loop A only:               AND trigger_signal = 'mastery_cliff'
     -- Whole program:             (remove the trigger_signal filter)
   RETURNING id
)
INSERT INTO public.audit_logs
  (auth_user_id, action, resource_type, resource_id, details, status)
SELECT
  NULL,
  'system.adaptive_hard_stop',
  'adaptive_interventions',
  NULL,
  jsonb_build_object(
    'actor_role',      'ops',
    'dismissed_count', (SELECT count(*) FROM dismissed),
    'scope',           '<mastery_cliff | inactivity+at_risk_concentration | all>',
    'reason',          '<FILL IN: incident ref / why drain was insufficient>'
  ),
  'success';

COMMIT;
```

`dismissed` rows start the normal cooldown, so re-enabling later does not instantly re-inject the same chapters/subjects. A hard stop suppresses escalations that expiring rows would have produced — if stopped for a non-pedagogical reason (infra bug), review the dismissed rows with assessment afterward.

> The Loop A hard-stop precedent (action `system.remediation_hard_stop`) is in `adaptive-remediation-rollout.md`; the program-level version above generalizes it with the `trigger_signal` scope filter.

---

## 7. Monitoring after enablement

**Reliability order — the `adaptive_interventions` table is the always-available ledger; `state_events` is bus-gated; `audit_logs` escalations are bus-independent.**

1. **`adaptive_interventions` (the loop's own ledger — always reliable):**
   ```sql
   -- Daily NEW-intervention volume by loop (anti-storm primary signal)
   SELECT date_trunc('day', created_at) AS day, trigger_signal, count(*)
   FROM adaptive_interventions
   WHERE created_at >= now() - interval '7 days'
   GROUP BY 1, 2 ORDER BY 1 DESC, 2;

   -- Per-student new rows per day MUST be <= 1 (ceiling check)
   SELECT student_id, date_trunc('day', created_at) AS day, count(*) AS new_rows
   FROM adaptive_interventions
   WHERE created_at >= now() - interval '7 days'
   GROUP BY 1, 2 HAVING count(*) > 1;   -- expect: ZERO rows

   -- Terminal outcomes + escalation split by loop (last 30 days)
   SELECT trigger_signal, status, escalated_to, count(*)
   FROM adaptive_interventions
   WHERE resolved_at >= now() - interval '30 days'
   GROUP BY 1, 2, 3 ORDER BY count(*) DESC;
   ```
2. **Cron telemetry:** the nightly daily-cron response carries `results.adaptive_remediation_triggered` (the existing step carries A + B + C — no new step). A flat `0` for multiple days with active rows present means the worker is failing (the Deno trigger soft-fails) — check Vercel logs.
3. **Vercel function logs:** `adaptive_remediation: run complete` with inject/verify structured summaries.
4. **`notifications` volume** (spam guard):
   ```sql
   SELECT type, recipient_type, count(*)
   FROM notifications
   WHERE created_at >= now() - interval '7 days'
     AND (type LIKE 'remediation_%' OR type LIKE 'engagement_%' OR type LIKE 'concentration_%')
   GROUP BY type, recipient_type;
   ```
5. **`audit_logs` escalations (bus-independent):** `action IN ('system.remediation_escalated','system.engagement_escalated','system.concentration_escalated','system.concentration_reescalated')` — one row per escalation, UUIDs + derived metrics only (P13).
6. **`state_events` (bus-gated — only when `ff_event_bus_v1` is ON):** `kind IN ('system.engagement_nudged','system.engagement_returned','system.engagement_escalated','system.concentration_escalated','system.concentration_resolved','system.concentration_reescalated', 'system.remediation_*')`. **Do NOT build alerts on this source unless the bus flag is verified ON in the environment** (prod: ON; staging: clear the §2 blocker first).
7. **`ops_events`:** records the flag flips themselves (who flipped what, when) — `category='deploy'`, source `feature-flags/route.ts`.
8. **Sentry:** error rate on `/api/cron/adaptive-remediation` and `/api/rhythm/today` < 0.5%.

---

## 8. Rollback per layer

| Layer | Standard rollback | Escalated rollback |
|---|---|---|
| **Pulse panel** | `ff_school_pulse_v1` OFF (instant; visibility only). | n/a |
| **Loop A** | `ff_adaptive_remediation_v1` OFF → drains ≤ 7 days. | + hard-stop SQL scoped `trigger_signal='mastery_cliff'`. |
| **Loops B/C** | `ff_adaptive_loops_bc_v1` OFF → drains ≤ 14 days. | + hard-stop SQL scoped `trigger_signal IN ('inactivity','at_risk_concentration')`. |
| **Whole program** | all three loop flags OFF → drains ≤ 14 days. | + hard-stop SQL with no `trigger_signal` filter. |
| **Schema** | no reversal needed — `adaptive_interventions` + the CHECK extensions are additive, RLS-locked, service-role-write, inert while flags are OFF. | Optional flag-row deletes (documented manual DOWNs in each seed migration) — a missing flag resolves OFF; active rows still drain. |
| **Event bus** | Do NOT flip `ff_event_bus_v1` OFF where loops are ON without draining first (flag OFF → let rows drain) — killing the bus mid-flight blinds verify. | Drain the loops first, then adjust the bus. |

---

## 9. References

- Loop A rollout (full drill + monitoring + kill switch): `docs/runbooks/adaptive-remediation-rollout.md`
- Loop A spec: `docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md`
- Loops B/C spec: `docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md`
- Worker route: `src/app/api/cron/adaptive-remediation/route.ts`
- Loop rules: `src/lib/learn/adaptive-loops-rules.ts` (`ADAPTIVE_LOOPS_BC_RULES`), `src/lib/learn/remediation-queue-adapter.ts` (`ADAPTIVE_REMEDIATION_RULES`)
- Flag evaluation: `src/lib/feature-flags.ts` (`isFeatureEnabled`; double-gate semantics, lines 111-142)
- Seeds: `20260619000100` (Pulse), `20260619000300` (Loop A), `20260619000600` (Loops B/C); CHECK extension `20260619000500`; table `20260619000200`; dedupe `20260619000400`; event bus `20260507000007`
- Cron trigger: `supabase/functions/daily-cron/index.ts` (`triggerAdaptiveRemediation`)
