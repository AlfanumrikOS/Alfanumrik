# Phase A Loops B & C — Adaptive Closed Loops on the Loop A Substrate — Design Spec

- **Date**: 2026-06-13
- **Status**: DESIGN (docs-only; no code in this step). Implementation ships on a feature branch with this spec. Authority: Loop B = full-auto (a nudge — lowest stakes); Loop C = TIERED like Loop A but escalation is **immediate** (the trigger already means sustained weakness).
- **Owning agents**: architect (schema/CHECK extension, RLS reuse, migration, cron-route security), assessment (guardrail constants, recovery/return windows, cross-loop ceiling), backend (worker phases, notifications, event registry), frontend (Pulse timeline rendering of new event kinds; nudge surface), testing (unit/integration/E2E + REG entries), quality (gates).
- **Product invariants in scope**: P5 (grades are strings), P7 (bilingual UI), P8 (RLS boundary), P9 (RBAC enforcement), P12 (AI safety — no new LLM output), P13 (data privacy).
- **Program context**: Phase A of the monitoring program. Phase C (backbone), Phase B (Student Pulse, PR #1013) — shipped. **Loop A** (mastery-cliff → auto-remediation → recovery) shipped via **PR #1018** (`adaptive_interventions` table `20260619000200`, seed `…000300`, dedupe `…000400`, single worker route `src/app/api/cron/adaptive-remediation/route.ts`). This spec closes the remaining two Pulse signals — **Loop B (inactivity)** and **Loop C (at-risk concentration)** — on the **same** substrate. "Phase B/C" are program phases; "Loop B/C" are Phase A loops — distinct namespaces.
- **Canonical root**: all work happens under `d:\Alfa_local\Alfanumrik\` — never the nested `Alfanumrik\Alfanumrik\` clone or `.claude/worktrees/*` copies.

> **As-built deltas vs the Loop A spec this template descends from.** The Loop A design spec (`2026-06-12-phase-a-loop-a-adaptive-remediation-design.md`) proposed a two-route split (`…/inject/route.ts` + `…/verify/route.ts`) and a separate audit-event actor section. The code that actually shipped (PR #1018) is a **single route** `src/app/api/cron/adaptive-remediation/route.ts` with `POST { phase?: 'inject' | 'verify' | 'all' }`, and the `system.*` event registry work has its own status. **This spec describes Loops B/C against the AS-BUILT code, not the Loop A spec's proposal.** Where the two disagree, the shipped code wins.

---

## 1. Context

Two of the three Pulse signals (`src/lib/pulse/signals.ts`) still only render and wait for a human:

- **`inactivity`** — `deriveInactivity` returns `'at_risk'` (the streak grace day — last active yesterday UTC) or `'broken'` (last active 2+ UTC days; streak reset / about to reset). Today a disengaged student simply drifts away; the only existing touchpoint is `onStreakBroken` (parent-only, fires from `daily-cron`'s `resetMissedStreaks` reset path), which does nothing to pull the *student* back and nothing before the streak is already lost.
- **`atRiskConcentration`** — `deriveAtRiskConcentration` buckets per-subject at-risk-chapter counts into `low` (1-2), `medium` (3-4), `high` (5+ chapters with mastery `< 0.4`). A `high` band means the **subject itself is at risk** — systemic, sustained weakness. Today nobody is told.

Loop A proved the pattern: a Pulse signal can drive a deterministic, cron-evaluated, guardrailed state machine (`active → recovered | escalated`) on `adaptive_interventions`, with a flag-gated inject, a drain-not-freeze verify, best-effort events + always-on `audit_logs`, and bilingual notifications. **Loops B and C reuse that entire spine.** The table was deliberately built `trigger_signal`-generic from day one (the CHECK pins `'mastery_cliff'` *only* and the migration comment explicitly reserves the extension for B/C).

```
LOOP B  inactivity ('at_risk'|'broken')  → re-engagement nudge (student + parent) → return-within-window check → escalate to parent on expiry
LOOP C  atRiskConcentration band 'high'  → IMMEDIATE escalation (teacher B2B / parent B2C) → band-drop-within-window check → re-notify on expiry
```

## 2. Goals / Non-Goals

**Goals**
- Close the inactivity and at-risk-concentration loops end-to-end with deterministic, cron-evaluated state transitions, reusing the Loop A substrate everywhere: the `adaptive_interventions` table (with an additive CHECK extension), the single `adaptive-remediation` worker route, the `state_events` + `audit_logs` audit spine, the `feature_flags` gate + drain semantics, and the bilingual notifications house shape.
- Add **one** new pure planning/evaluation surface per loop (Loop B is queue-less; Loop C reuses Loop A's escalation machinery), keeping every threshold in ONE place and reusing `PULSE_THRESHOLDS`.
- Add a **cross-loop interaction layer** so A/B/C never produce notification storms for one student (per-student daily intervention ceiling + per-loop guardrails + a subject-level A↔C coexistence rule).
- Ship flag-gated, default OFF, staging-first, with the same kill-switch drain semantics and the same rollout runbook (extended).

**Non-Goals**
- Real-time (non-cron) triggering. Both loops are daily-grained, evaluated inside the daily-cron cycle.
- Any LLM-generated content (P12). Loop B nudge copy and Loop C escalation copy are pre-authored bilingual strings, like Loop A.
- New RBAC permission or role (P9). Cron is service-role behind `CRON_SECRET`; reads ride existing scopes.
- Mobile (Flutter) UI for the new event kinds / nudge surface.
- Replacing or duplicating `resetMissedStreaks` / `onStreakBroken` — Loop B *complements* them (it nudges the student to return; `onStreakBroken` only tells the parent after the fact). Interaction with `onStreakBroken` is defined in §6.

## 3. Resolved Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| B1 | **Loop B intervention is a NUDGE, not a queue injection.** No `RemediationCard`, no rhythm lane. The "intervention" is a student notification + (if linked) a parent alert; the `adaptive_interventions` row is the state machine that tracks *whether the student returned*. | An inactive student is not in a session and has no queue to inject into; the action that matters is pulling them back. The row still gives us verify (returned?) + escalate (still gone?) for free on the existing spine. |
| B2 | **Loop B authority = FULL-AUTO at every phase**, including escalation. No human approval gate, ever. | A nudge and a "your child hasn't studied in N days" parent alert are the lowest-stakes actions in the program — strictly more benign than Loop A's auto-injection. Disengagement escalation goes to the *parent*, never a teacher (Decision B4). |
| B3 | **Loop B trigger = `inactivity.verdict === 'broken'` only; `'at_risk'` (grace day) does NOT open an intervention.** The grace-day case is already handled by the existing streak system; opening a row on every grace day would fire daily and storm. | `'broken'` (2+ UTC days, no freeze) is the actionable "they've actually drifted" state. `'at_risk'` is one missed day with the streak still intact today — too noisy to act on, and the student may simply study tonight. (Open item §12-B: a single grace-day "gentle reminder" notification — NOT an intervention row — is a possible v1.1 add.) |
| B4 | **Loop B parent involvement is two-toned: an ENCOURAGING parent alert at INTERVENE (nudge, day 0) and a CONCERNED parent ESCALATION at expiry — both PARENT, never teacher, for B2C and B2B alike.** Disengagement is a home/motivation problem, not a subject-mastery problem — the parent is the right audience, never the teacher. No teacher path, no `teacher_remediation_assignments` row for Loop B. No parent linked ⇒ both phases degrade to student-only; at expiry that means terminal `escalated` with `escalated_to = NULL`, ops-visible via the event payload. | Honors the prompt's INTERVENE spec ("student notification + (if linked) parent alert, encouraging"). Mirrors the existing `onStreakBroken` audience (parent) and the program's division of labor: Loop C owns subject weakness → teacher; Loop B owns engagement → parent. The two alerts differ in tone and idempotency key so they never read as a duplicate. |
| B5 | **Loop B return-window N = 3 days** (rolling-ms, same boundary math as `recovery-evaluation.ts`). `recovered` = any qualifying activity inside `[created_at, created_at + 3d]`; `expired` = still no activity after the window. | Tuned against the streak-reset cadence (a streak resets after ~2 missed days): 3 days gives a just-drifted student a full weekend-spanning chance to come back on the nudge alone before pulling the parent in, but is short enough that a genuinely-gone student reaches the parent within the school week. Assessment ratifies (§12). |
| C1 | **Loop C intervention IS the escalation** — there is no "inject practice then wait" phase. On a `high`-band subject, the inject phase **directly** creates the escalation (teacher B2B / parent B2C), opens the `adaptive_interventions` row already in a `escalated`-equivalent terminal-of-intervene posture, and the verify phase then watches for the band to drop. | A `high` band (5+ at-risk chapters in one subject) already means *sustained* systemic weakness — the signal itself is the evidence Loop A spends a 7-day window gathering. Waiting would be redundant. TIERED authority is honored by escalating to a human, immediately, rather than silently auto-acting. |
| C2 | **Loop C escalation target reuses Loop A's resolver VERBATIM** — `resolveEscalationTarget()` + `resolveChapterId()` + the `teacher_remediation_assignments` insert + the `20260619000400` dedupe index. B2B → roster teacher assignment (subject-matched class, deterministic tie-break); B2C → parent alert; neither → terminal no-recipient, ops-visible. | Zero new escalation code. The only Loop-C-specific input is *which chapter* to attach (Decision C3). The dedupe index already buckets NULL chapter via COALESCE-to-nil-UUID, so a subject-level (chapter-less) escalation is a first-class case. |
| C3 | **Loop C attaches the WORST at-risk chapter in the subject as `chapter_number`** (lowest mastery; tie-broken by lowest chapter number), and the `teacher_remediation_assignments.chapter_id` maps from it (NULL when unmapped → renders as "general/subject-level" remediation, which is semantically correct for a subject-wide gap). The `adaptive_interventions` triple is `(student, subject_code, worstChapter)`. | The table's natural key is `(student, subject, chapter)` (one-active partial unique index). Loop C is conceptually subject-level, but it must pick a representative chapter to fit the existing key and the teacher-assignment FK. The worst chapter is the most defensible representative and the one the teacher should look at first. (Open item §12-C: a future subject-level key variant if subject-only interventions become common.) |
| C4 | **Loop C verify = band drop below `high`.** `recovered` = the subject's current at-risk-chapter count `< concentration_high_min` (i.e. back to `medium`/`low`/`none`) within the window; `expired` = still `high` at window end → **re-notify** the same human (teacher re-flag / parent re-alert / ops), it does NOT silently close. | Symmetric with the trigger: the loop opened because the subject was `high`; it closes when the subject is no longer `high`. Re-notify (not a new escalation row) avoids both silent failure and duplicate-row storms — it bumps the existing assignment / sends a follow-up parent alert keyed idempotently. |
| C5 | **Loop C return-window N = 14 days** (rolling-ms). Longer than Loop A's 7 because moving a *subject* (5+ chapters) out of the `high` band is a multi-week effort, not a single-chapter recovery. | Assessment ratifies (§12-C). Denormalized to `verify_by` at insert, so a later window change is non-retroactive (Decision-6 pattern from Loop A). |
| X1 | **ONE flag for both loops: `ff_adaptive_loops_bc_v1`** (NEW, default OFF). NOT a reuse of `ff_adaptive_remediation_v1`. | Independent kill switches: ops must be able to enable Loop A (proven) without B/C, and roll B/C back without touching A. B and C share a flag because they ship together as "the rest of Phase A" and have no reason to ramp independently of each other; if that changes, splitting one flag into two is a trivial follow-up. See §3-X2 for the worker-gating consequence. |
| X2 | **Per-`trigger_signal` inject gating; shared verify drain.** Inside the worker, the inject phase gates the `mastery_cliff` branch on `ff_adaptive_remediation_v1` (unchanged) and the `inactivity` + `at_risk_concentration` branches on `ff_adaptive_loops_bc_v1`. The verify phase stays gated on **active rows existing, not any flag** — the existing drain-not-freeze semantics now drain B/C rows too. | Preserves Loop A's kill-switch contract per loop. A B/C row, once opened, always drains to terminal even if the flag is flipped OFF mid-flight — no student left in limbo. |
| X3 | **Per-student daily intervention ceiling across ALL loops = 1 NEW intervention opened per (student, day).** Loop precedence when multiple signals fire the same night: **A (mastery_cliff) > C (concentration) > B (inactivity)**. | Severity-ordered: a fresh regression (A) is the most acute and most actionable; a systemic subject gap (C) next; disengagement (B) is real but lowest-urgency for a single day's ceiling and is partially covered by the streak system. The ceiling is the primary anti-storm guardrail (§6). |

## 4. Loop Definitions (State Machines)

Both loops live on `adaptive_interventions`. States, columns, indexes, RLS, and the worker route are all Loop A's. The differences are the trigger, the intervene action, the verify predicate, and the snapshot shape.

### 4.1 Loop B — Inactivity

One cycle per `(student, subject_code, chapter_number)` — but Loop B is **not chapter-scoped**. To fit the existing triple key + one-active partial unique index without schema change, Loop B uses **sentinel target columns**: `subject_code = '_inactivity'` (a reserved lowercase pseudo-subject, passes the `subject_code = lower(subject_code)` CHECK) and `chapter_number = 0`. **This requires relaxing the existing `chapter_number > 0` CHECK** (see §5.2 — additive, drop+recreate) OR using `chapter_number = 0` only after the CHECK is widened to `>= 0`. The sentinel guarantees one-active-max per student for inactivity (you cannot be "inactive in two ways") via the existing `adaptive_interventions_one_active` partial unique index — zero new index needed.

```
TRIGGER (worker inject, gated ff_adaptive_loops_bc_v1)
  deriveSignals({ nowMs, lastActiveMs, hasStreakFreeze }).inactivity.verdict === 'broken'
  AND NOT onboarding-grace (student younger than ONBOARDING_GRACE_DAYS — §6 B-G6)
  AND nudge cooldown satisfied (no terminal inactivity intervention within NUDGE_COOLDOWN_DAYS — §6 B-G3)
  AND per-student daily ceiling not already spent by A/C tonight (§6 X3)
  → INSERT adaptive_interventions (trigger_signal='inactivity', subject_code='_inactivity',
      chapter_number=0, status='active', verify_by=created_at+3d, trigger_snapshot={ daysSinceActive, hadStreakFreeze, evaluatedAtIso, rulesVersion })
  → system.engagement_nudged event (best-effort) + audit_logs row (always)
  → onReEngagementNudge(student + linked parent)  [student notification ALWAYS (encouraging);
      ENCOURAGING parent alert when a guardian is linked (status approved/active), preference-respecting.
      This day-0 alert is supportive ("a nudge to get them studying"), distinct from the CONCERNED
      escalation alert at expiry (Decision B4) — different tone, different idempotency key.]

INTERVENE  — there is NO read-time queue lane. The notification (student + encouraging parent alert) IS the intervention. Nothing renders in /api/rhythm/today.

VERIFY (worker verify, gated on active rows)
  returned = ANY qualifying activity (lastActiveMs advanced to inside [created_at, verify_by]) → status='recovered', resolved_at, system.engagement_returned + onReEngagementReturned(student) [optional celebratory]
  pending  = window open, still inactive → no transition
  expired  = window elapsed, still inactive → ESCALATE (parent)

ESCALATE (verify, verdict 'expired')  — PARENT ONLY (Decision B4)
  parent linked (guardian_student_links status approved/active) → escalated_to='parent', onInactivityEscalated(student+parent)
  none → escalated_to=NULL, student-only notification, ops-visible via event payload
  Always: status='escalated', resolved_at, system.engagement_escalated event + audit_logs row
  NEVER a teacher_remediation_assignments row.
```

### 4.2 Loop C — At-risk Concentration

One cycle per `(student, subject_code, worstChapter)` (Decision C3). The existing one-active partial unique index gives one-active-max per (student, subject, chapter); combined with the §6 C-G1 per-(student,subject) guardrail it enforces one active concentration intervention per subject.

```
TRIGGER (worker inject, gated ff_adaptive_loops_bc_v1)
  deriveSignals({ nowMs, subjectSnapshots }).atRiskConcentration — for each subject whose band === 'high'
  pick the WORST subject (highest atRiskChapterCount; tie → worst-first ordering already in the signal)
  worstChapter = lowest-mastery at-risk chapter in that subject (tie → lowest chapter_number)
  AND NOT already covered by an active Loop A intervention on a chapter IN that subject (§6 C-G3 — A↔C coexistence)
  AND concentration cooldown satisfied (no terminal concentration intervention for this (student,subject) within CONC_COOLDOWN_DAYS — §6 C-G2)
  AND per-student daily ceiling not already spent (§6 X3)
  → resolveEscalationTarget(student, subject)  [REUSE Loop A verbatim]
  → B2B: INSERT teacher_remediation_assignments(worstChapter→chapter_id) [REUSE + dedupe index] → escalated_to='teacher', teacher_assignment_id
     B2C: escalated_to='parent'
     none: escalated_to=NULL
  → INSERT adaptive_interventions (trigger_signal='at_risk_concentration', subject_code=<subject>,
      chapter_number=worstChapter, status='active', verify_by=created_at+14d,
      trigger_snapshot={ atRiskChapterCount, worstChapterMastery, bandAtTrigger:'high', evaluatedAtIso, rulesVersion })
  → system.concentration_escalated event (best-effort) + audit_logs row (always)
  → onConcentrationEscalated(student + teacher-via-assignment OR parent)

INTERVENE  — the escalation already happened at inject. No read-time lane. (The teacher/parent acts off the existing Phase 3A surfaces / the alert.)

VERIFY (worker verify, gated on active rows)
  recovered = subject's CURRENT atRiskChapterCount < concentration_high_min (5) within window → status='recovered', resolved_at, system.concentration_resolved + onConcentrationResolved
  pending   = window open, subject still 'high' → no transition
  expired   = window elapsed, subject still 'high' → RE-NOTIFY (Decision C4):
              teacher path → bump/re-flag existing assignment (idempotent) ; parent path → follow-up alert (idempotent key) ; none → ops event
              Then status='escalated' stays escalated; the row transitions to a terminal that records the re-notify
              (status='escalated' with a re-notify audit row — NOT a second adaptive_interventions row).
```

> **Loop C status nuance.** Because Loop C escalates at inject, its `adaptive_interventions` row carries `escalated_to` from creation while `status='active'` (the verify phase watches the band). On `recovered` it goes `active → recovered`. On `expired` it goes `active → escalated` (the re-notify is the human handoff confirmation). This is a valid path through the existing CHECK (`active`, `recovered`, `escalated`, `dismissed`) — no status enum change. The escalation *write* (assignment row + notification) happens at **inject**; the status *transition to `escalated`* happens at **expiry** to mean "automation could not resolve it; the human handoff is now the durable owner". Assessment/architect ratify this two-beat semantics at review (§12-C).

## 5. Data Model

### 5.1 No new table

Both loops live on `public.adaptive_interventions` (`20260619000200`). All four RLS policies (service-role ALL, student/parent/teacher SELECT), the partial unique `adaptive_interventions_one_active` index, the `(status, verify_by)` verify-sweep index, the `(student_id, status)` lane index, and the `(student_id, subject_code, chapter_number, resolved_at)` cooldown index are **reused as-is**. No new index is required: Loop B's sentinel triple and Loop C's worst-chapter triple both ride the existing indexes.

### 5.2 Migration — extend two CHECK constraints (architect)

`YYYYMMDDHHMMSS_adaptive_interventions_loops_bc.sql` (timestamp assigned at implementation; must sort AFTER `20260619000400`). Idempotent, additive, no DROP TABLE/COLUMN, no data rewrite.

**(a) Extend `trigger_signal` CHECK** — add `'inactivity'` and `'at_risk_concentration'`. Postgres has no "ALTER CHECK"; the idempotent pattern is **drop-the-named-constraint-if-exists then add-with-the-new-IN-list**, wrapped so a re-run is a no-op:

```sql
-- The original CHECK was created INLINE in 20260619000200 (column-level,
-- unnamed → Postgres auto-named it adaptive_interventions_trigger_signal_check).
-- Drop by that auto-name IF EXISTS, then add a NAMED replacement so future
-- extensions (none planned) have a stable handle. DROP ... IF EXISTS makes the
-- whole block re-runnable.
ALTER TABLE public.adaptive_interventions
  DROP CONSTRAINT IF EXISTS adaptive_interventions_trigger_signal_check;
ALTER TABLE public.adaptive_interventions
  DROP CONSTRAINT IF EXISTS adaptive_interventions_trigger_signal_chk;  -- defensive: future-name idempotency
ALTER TABLE public.adaptive_interventions
  ADD CONSTRAINT adaptive_interventions_trigger_signal_chk
  CHECK (trigger_signal IN ('mastery_cliff', 'inactivity', 'at_risk_concentration'));
```

The ADD must be guarded so a second run (constraint already present under the new name) does not error — wrap in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` OR precede the ADD with `DROP CONSTRAINT IF EXISTS adaptive_interventions_trigger_signal_chk`. Recommended: the explicit drop-then-add shown above (the named DROP IF EXISTS immediately before ADD makes the ADD always run against a clean slate — fully idempotent, no exception handler needed). **Verify the auto-generated name on prod first** (`SELECT conname FROM pg_constraint WHERE conrelid = 'public.adaptive_interventions'::regclass AND contype='c';`) and pin the exact name in the migration — do not guess.

**(b) Relax `chapter_number > 0` to `chapter_number >= 0`** — required ONLY for Loop B's `chapter_number = 0` sentinel (§4.1). Same drop-then-add idempotent pattern:

```sql
ALTER TABLE public.adaptive_interventions
  DROP CONSTRAINT IF EXISTS adaptive_interventions_chapter_number_check;
ALTER TABLE public.adaptive_interventions
  DROP CONSTRAINT IF EXISTS adaptive_interventions_chapter_number_chk;
ALTER TABLE public.adaptive_interventions
  ADD CONSTRAINT adaptive_interventions_chapter_number_chk
  CHECK (chapter_number >= 0);
```

> **Sentinel-vs-real-chapter safety.** `chapter_number = 0` is reserved for Loop B; real curriculum chapters are always `>= 1`. Loop C always uses a real chapter (`>= 1`). The `_inactivity` pseudo-subject (lowercase, passes `subject_code = lower(subject_code)`) can never collide with a real subject code (no real subject is `_inactivity`). The cooldown index `(student_id, subject_code, chapter_number, resolved_at)` therefore naturally partitions Loop B rows from A/C rows. **Decision point for review:** the alternative to relaxing the `> 0` CHECK is a non-sentinel approach (e.g. a real-but-arbitrary chapter for Loop B), which is worse — it would let an inactivity row collide with a real-chapter Loop A/C row on the one-active index. The sentinel + `>= 0` relax is the clean choice; architect signs off the CHECK relax at review.

**No `trigger_snapshot` shape migration** — `trigger_snapshot` is `jsonb` and already shape-free. Per-signal shapes are a code/spec contract only (documented below), not a DB constraint.

**`trigger_snapshot` shape per signal (code contract; jsonb, no DB enforcement):**

| `trigger_signal` | snapshot keys |
|---|---|
| `mastery_cliff` (existing) | `{ largestDrop, baselineMastery, postCliffMastery, declineStreak, evaluatedAtIso, rulesVersion }` |
| `inactivity` (NEW) | `{ daysSinceActive, hadStreakFreeze, evaluatedAtIso, rulesVersion }` — derived metrics only, no PII |
| `at_risk_concentration` (NEW) | `{ atRiskChapterCount, worstChapterMastery, bandAtTrigger: 'high', evaluatedAtIso, rulesVersion }` — derived metrics only, no PII |

### 5.3 New feature flag (architect — seed migration)

`YYYYMMDDHHMMSS_seed_ff_adaptive_loops_bc_v1.sql` — seeds `ff_adaptive_loops_bc_v1` (default OFF / 0% / NULL scoping), mirroring `20260619000300` verbatim (the `to_regclass` guard + `ON CONFLICT (flag_name) DO NOTHING`). Add `ADAPTIVE_LOOPS_BC_FLAGS = { V1: 'ff_adaptive_loops_bc_v1' }` to `src/lib/feature-flags.ts` and `[ADAPTIVE_LOOPS_BC_FLAGS.V1]: false` to `FLAG_DEFAULTS` (keep-in-sync rule).

### 5.4 `state_events` audit kinds (registry — backend)

Six new kinds under the existing `system` actor (added for Loop A). Same envelope contract as Loop A (`actorAuthUserId` = the learner, `tenantId` = school for B2B else null, `idempotencyKey = '<loop>:<interventionId>:<phase>'`). Best-effort via `publishEvent()`; never load-bearing.

| Kind | Payload (bounded, no PII) |
|---|---|
| `system.engagement_nudged` | `interventionId`, `daysSinceActive`, `verifyBy` |
| `system.engagement_returned` | `interventionId`, `daysToReturn` |
| `system.engagement_escalated` | `interventionId`, `escalatedTo` (`'parent' \| null`) |
| `system.concentration_escalated` | `interventionId`, `subjectCode`, `chapterNumber`, `atRiskChapterCount`, `escalatedTo` (`'teacher' \| 'parent' \| null`), `teacherAssignmentId` (nullable), `verifyBy` |
| `system.concentration_resolved` | `interventionId`, `subjectCode`, `atRiskChapterCount`, `daysToResolve` |
| `system.concentration_reescalated` | `interventionId`, `subjectCode`, `escalatedTo`, `teacherAssignmentId` (nullable) |

Registry pin impact: `events-registry.test.ts` `CANONICAL_ACTORS` already has `system`; the **kind-count pin** + `ALL_EVENT_KINDS` + the discriminated union must be updated with these six (testing notified). No new actor.

## 6. Guardrails & Cross-Loop Interaction (assessment-ratified; constants in ONE module)

**Where the constants live.** Loop A's `ADAPTIVE_REMEDIATION_RULES` lives in `remediation-queue-adapter.ts` and is mastery-cliff-specific. To avoid bloating that object with unrelated B/C constants AND to avoid scattering numbers, B/C constants live in **one new sibling module** `src/lib/learn/adaptive-loops-rules.ts` exporting `ADAPTIVE_LOOPS_BC_RULES`, which **imports `PULSE_THRESHOLDS`** for any shared threshold (the `concentration_high_min` boundary is read from `PULSE_THRESHOLDS`, never redefined — guardrail B/C-6, the Loop A "no duplicate thresholds" rule). The new pure modules (§7) import from here; the worker and tests import from here. No number is defined twice.

```
ADAPTIVE_LOOPS_BC_RULES = {
  // Loop B
  inactivity_return_window_days: 3,        // B5 — verify window (rolling-ms)
  nudge_cooldown_days: 7,                   // B-G3 — don't re-nudge within a week of a terminal inactivity row
  onboarding_grace_days: 7,                 // B-G6 — never nudge a student created < 7 days ago
  // Loop C
  concentration_return_window_days: 14,    // C5 — verify window (rolling-ms)
  concentration_cooldown_days: 7,          // C-G2 — per-(student,subject) cooldown after terminal
  // shared / cross-loop
  per_student_daily_intervention_ceiling: 1, // X3 — at most 1 NEW intervention opened per student per day, across A/B/C
  // band boundary is REUSED, not redefined:
  concentration_high_min: PULSE_THRESHOLDS.concentration_high_min, // re-export for the verify predicate
}
```

| # | Guardrail | Value | Enforced where |
|---|---|---|---|
| B-G1 | One active inactivity intervention per student | structural | existing `adaptive_interventions_one_active` index (sentinel triple `(student,'_inactivity',0)`) + inject pre-check |
| B-G2 | Trigger only on `verdict === 'broken'` (not `'at_risk'`) | structural | worker inject branch |
| B-G3 | Nudge cooldown — no new inactivity intervention within `nudge_cooldown_days` (7) of a terminal inactivity row | 7 days | inject, against the cooldown index (existing) filtered to `trigger_signal='inactivity'` |
| B-G4 | Respect notification preferences (student + guardian) | structural | the notification trigger (existing `isNotificationEnabled` path) |
| B-G5 | Return window | 3 days | the new pure module + denormalized `verify_by` |
| B-G6 | Onboarding grace — never nudge a student whose `students.created_at` is within `onboarding_grace_days` (7) | 7 days | inject pre-check (read `students.created_at`) |
| C-G1 | One active concentration intervention per (student, subject) | structural | existing one-active index (worst-chapter triple) + inject pre-check keyed on `(student, subject, trigger_signal='at_risk_concentration')` |
| C-G2 | Subject cooldown — no new concentration intervention for a (student, subject) within `concentration_cooldown_days` (7) of a terminal one | 7 days | inject, cooldown index filtered to `trigger_signal='at_risk_concentration'` |
| C-G3 | **A↔C coexistence** — do NOT open a Loop C concentration intervention for a subject that already has an ACTIVE Loop A (`mastery_cliff`) intervention on any chapter in that subject. Loop A is already working that subject chapter-by-chapter; adding a subject-wide escalation on top would double-message. (The reverse — Loop A may still inject a chapter in a subject Loop C escalated — is ALLOWED: chapter-level practice complements the teacher handoff and does not notify the same human.) | structural | inject pre-check: query active `mastery_cliff` rows for the student, skip the subject if any matches |
| C-G4 | Return window | 14 days | new pure module + denormalized `verify_by` |
| X3 | **Per-student daily intervention ceiling = 1 new intervention opened per student per day, across A/B/C.** Precedence A > C > B (Decision X3). If A or C already opened a row for the student in tonight's run, B (and the lower-precedence of C) is skipped for that student today (it re-evaluates next night; the signal persists). | 1/student/day | worker inject — a per-run `Set<studentId>` of "already opened tonight", checked across all three branches in precedence order |
| B/C-6 | No duplicate thresholds — all shared numbers (`concentration_high_min`) read from `PULSE_THRESHOLDS`; loop math from `signals.ts` | structural | code review + unit test asserting `adaptive-loops-rules.ts` imports, not redefines, the band boundary |

**Why precedence A > C > B and a ceiling of 1.** The dominant risk for B/C is notification storms — a struggling, disengaged student could trip all three signals the same night. The ceiling guarantees at most one *new* automated touch per student per day; precedence guarantees the most acute signal wins that slot. A student who is both inactive AND has a `high`-band subject gets the concentration escalation (more actionable) tonight and, if still inactive, the inactivity nudge a subsequent night — never both in one night. (Verify-phase transitions — recovered/escalated/re-notify on *already-open* rows — are NOT subject to the ceiling; the ceiling caps *new* interventions only, so in-flight loops always drain.)

## 7. Components & File Map

| Component | Path | Status | Owner |
|---|---|---|---|
| B/C loop rules (pure): `ADAPTIVE_LOOPS_BC_RULES`; imports `PULSE_THRESHOLDS` for the band boundary | `src/lib/learn/adaptive-loops-rules.ts` | NEW | assessment |
| Inactivity return evaluation (pure): intervention record + latest-activity reading → `returned \| pending \| expired`; rolling-ms window math reusing the exact boundary semantics of `recovery-evaluation.ts` (`verificationWindowEndMs`-style helper, exported for the cron sweep) | `src/lib/learn/inactivity-return-evaluation.ts` | NEW | assessment |
| Concentration resolution evaluation (pure): intervention record + current subject at-risk-chapter count → `resolved \| pending \| expired`; band predicate uses `concentration_high_min` from rules | `src/lib/learn/concentration-resolution-evaluation.ts` | NEW | assessment |
| Worker route — extend the existing single route: inject branches by `trigger_signal` (cliff branch unchanged; add `inactivity` + `at_risk_concentration` branches, each flag-gated on `ff_adaptive_loops_bc_v1`); verify branches by `trigger_signal` (cliff branch unchanged; add B return-check + C band-check); per-run daily-ceiling `Set`; A↔C coexistence query | `src/app/api/cron/adaptive-remediation/route.ts` | MODIFIED | backend (architect reviews auth gate stays intact) |
| daily-cron thin trigger — **unchanged**: the existing `triggerAdaptiveRemediation` already POSTs `{ phase: 'all' }`; B/C ride the same call, no new step, no new fetch-out. The step's flag-agnostic posture is correct (worker gates per branch). | `supabase/functions/daily-cron/index.ts` | UNCHANGED | — (note in spec) |
| Notifications: `onReEngagementNudge` (student + encouraging parent alert when linked), `onReEngagementReturned` (student, optional celebratory), `onInactivityEscalated` (student + concerned parent alert), `onConcentrationEscalated` (student + parent-on-B2C; teacher rides the assignment), `onConcentrationResolved` (student), `onConcentrationReescalated` (parent follow-up / ops). All reuse the `RemediationNotificationRow` house shape + `upsertRemediationNotifications` (idempotency_key, bilingual `data.*_hi`, P13 metadata-only). The two Loop B parent alerts use distinct idempotency keys (`engagement_nudge_<id>_<guardian>` vs `engagement_escalated_<id>_<guardian>`) so they never collide. | `src/lib/notification-triggers.ts` | MODIFIED | backend |
| Event registry: 6 `system.*` kinds (§5.4) | `src/lib/state/events/registry.ts` (+ `CANONICAL_ACTORS`/kind-count pin in `src/__tests__/state/events-registry.test.ts`) | MODIFIED | backend |
| Migration: `trigger_signal` CHECK extension + `chapter_number >= 0` relax | `…_adaptive_interventions_loops_bc.sql` | NEW | architect |
| Seed migration: `ff_adaptive_loops_bc_v1` (default OFF) | `…_seed_ff_adaptive_loops_bc_v1.sql` | NEW | architect |
| Feature-flags registry: `ADAPTIVE_LOOPS_BC_FLAGS` + `FLAG_DEFAULTS` entry | `src/lib/feature-flags.ts` | MODIFIED | architect (ops reviews flag definition) |
| Frontend: Pulse timeline renders the six new `system.*` event kinds on student/parent/teacher lenses (bilingual, supportive copy) | `src/components/pulse/*` | MODIFIED | frontend |
| Escalation resolver + chapter mapping + teacher-assignment insert + dedupe (REUSED verbatim) | `resolveEscalationTarget`, `resolveChapterId`, `./_lib/subject-match.ts`, `teacher_remediation_assignments`, `20260619000400` | EXISTING | — |

**No `/api/rhythm/today` change.** Neither Loop B (nudge, no cards) nor Loop C (escalation, no cards) injects a rhythm lane. The Loop A remediation lane is untouched. This is a deliberate consequence of Decisions B1 and C1.

## 8. Security & Invariants

- **P8** — no new table; the `adaptive_interventions` RLS (four patterns) already covers Loop B/C rows (a parent/teacher/student sees inactivity + concentration rows for their student through the exact same policies). The CHECK-extension migration changes no RLS. Loop B's `_inactivity` pseudo-subject rows are still `student_id`-scoped, so RLS holds. No client write path exists (writes are service-role cron).
- **P9** — no new permission. Worker stays service-role behind the fail-closed `CRON_SECRET` gate (deny before any DB I/O — REG-118/119 posture, unchanged). Reads ride existing scopes (Pulse lenses, teacher Phase 3A surfaces, parent portal).
- **P12** — Loop B nudge copy and Loop C escalation copy are pre-authored bilingual strings in `notification-triggers.ts`, exactly like Loop A. No LLM output. No generated content reaches students/parents/teachers.
- **P13** — new `trigger_snapshot` shapes, event payloads, notification payloads, and `audit_logs` rows carry UUIDs + derived metrics + subject codes only — never names, emails, phones, raw activity timestamps tied to identity beyond what Loop A already emits. `daysSinceActive` / `atRiskChapterCount` are derived integers, not PII.
- **P5** — grades appear only in Loop C's `resolveChapterId` lookup (reused verbatim) and stay strings end-to-end. Loop B touches no grade. `chapter_number` (incl. the `0` sentinel) is an integer, not a grade.
- **P7** — all new student/parent-facing copy (nudge, return, escalation, resolution, re-escalation) ships en + hi via the `data.*_hi` house shape; Pulse timeline labels for the six new kinds ship en + hi.
- **Flag-gated, default OFF** — `ff_adaptive_loops_bc_v1`. Kill-switch drain semantics in §9.

## 9. Validation & Rollout

**Hard precondition (inherited from Loop A): `ff_adaptive_loops_bc_v1` ON ⇒ `ff_event_bus_v1` ON in the same environment.** Loop C's verify reads the current at-risk-chapter count from `learner_mastery` (the bus-projection rollup) and Loop B reads `last_active` from the canonical student state — but the audit/event trail and (for C) fresh mastery observations depend on the bus. Loop B's verify (activity returned?) reads `last_active`/`student_learning_profiles` which is updated by the quiz path independent of the bus, so Loop B is *less* bus-dependent than A/C — but for consistency and audit-trail survivability, the same precondition applies. Killing the bus where the loops are ON requires draining first (flag OFF, let active rows drain) — same procedure as Loop A.

**Tests**
- Unit (Vitest): `adaptive-loops-rules.test.ts` (every constant; the structural test that the band boundary is imported from `PULSE_THRESHOLDS`, not redefined — B/C-6); `inactivity-return-evaluation.test.ts` (window at day 2/3/4, returned-at-boundary beats same-instant expiry, still-inactive → expired, malformed → pending); `concentration-resolution-evaluation.test.ts` (count at 4/5/6 vs `high_min`, resolved/pending/expired, window boundary).
- Integration: worker route — `ff_adaptive_loops_bc_v1` OFF ⇒ B/C inject branches are no-ops (cliff branch still respects its own flag); per-student daily ceiling (a student tripping A+C+B opens exactly ONE row, the A row); A↔C coexistence (no C row when an active cliff row exists for the subject); B sentinel one-active-max under double-invocation (23505 benign dedupe); C escalation reuses the dedupe index (23505 benign); verify drains B/C rows with the flag OFF.
- E2E (Playwright): a `'broken'`-inactivity student gets a bilingual nudge notification and no rhythm-lane change; a `high`-band student's teacher sees a `teacher_remediation_assignments` row; flag OFF renders zero B/C behavior.
- **REG-118 impact**: NONE — the daily-cron step list is unchanged (the existing `adaptive_remediation_triggered` step carries B/C). The static-source contract canary still passes without edit. (Confirm at implementation; if any helper/step pair changes, update the canary in the same PR.)
- **Registry pin impact**: `events-registry.test.ts` kind-count + `ALL_EVENT_KINDS` + union updated for the six new `system.*` kinds.

**Regression catalog** — Loop A occupies **REG-126..REG-129** (latest used = REG-129). Next free is **REG-130**, BUT the prompt flags REG-130 may be claimed by the #1015 testing review. **To avoid collision, Loops B/C propose REG-131..REG-134** and explicitly cede REG-130 to #1015:
  - **REG-131** — Loop B closed-loop state machine (trigger only on `'broken'`; sentinel one-active-max; return-window recovered/expired; parent-only escalation, never a teacher row).
  - **REG-132** — Cross-loop interaction (per-student daily ceiling = 1 with precedence A>C>B; A↔C subject coexistence; verify-phase drains are NOT ceiling-capped).
  - **REG-133** — Loop C escalation-at-inject + band-drop verify (reuses Loop A resolver + dedupe index; re-notify on expiry, no second row).
  - **REG-134** — B/C flag + worker gating (inject branches gated on `ff_adaptive_loops_bc_v1`; verify drains regardless; CHECK-extension idempotency / sentinel-vs-real-chapter isolation).

  **Dependency flag for testing:** if #1015 does NOT take REG-130, testing may renumber B/C to REG-130..REG-133 to keep the catalog dense. Final numbering + text are testing-owned; this spec coordinates by reserving REG-131+ and naming the #1015 dependency explicitly.

**Rollout** (same runbook, extended — `docs/runbooks/adaptive-remediation-rollout.md` gains a B/C section):
1. Merge with `ff_adaptive_loops_bc_v1` OFF everywhere (zero behavior change; the CHECK extension + flag seed are additive + idempotent; Loop A unaffected).
2. Enable on **staging** first; seed a synthetic `'broken'`-inactivity student and a synthetic `high`-band subject; observe full cycles (nudge → forced return → recovered; nudge → no return → parent escalation; concentration → teacher assignment → forced band drop → resolved; concentration → still-high → re-notify) before any prod flip.
3. Prod enablement is a flag flip (ops-logged), optionally `rollout_percentage` cohort ramp. **Loop A and Loops B/C ramp independently** (separate flags — Decision X1).

**Kill switch** = `ff_adaptive_loops_bc_v1` OFF. Semantics identical to Loop A: no new B/C injections; mid-flight B/C interventions drain to terminal via the verify phase (gated on active rows, not the flag). Hard stop = ops bulk-resolve active rows to `dismissed` via service-role SQL (documented with the runbook), filterable by `trigger_signal IN ('inactivity','at_risk_concentration')` to leave Loop A untouched.

## 10. Risks

- **Notification storms** (top risk for B/C). Mitigated by the per-student daily ceiling (1/day, precedence A>C>B), per-loop cooldowns (nudge 7d, concentration 7d), one-active-max per loop, A↔C coexistence rule, onboarding grace, and notification-preference respect. Assessment owns ratifying every number before enablement.
- **Sentinel chapter collision** — Loop B's `(student, '_inactivity', 0)` triple sharing the table with real-chapter rows. Mitigated by the reserved lowercase pseudo-subject (can't collide with a real subject) + `chapter_number = 0` (real chapters are `>= 1`) + the CHECK relax to `>= 0`. The one-active index naturally partitions. Architect signs off the CHECK relax (the only schema-semantics change).
- **CHECK-extension idempotency** — drop-then-add must use the EXACT auto-generated constraint name from prod. Mitigated by the "verify conname on prod first, pin it" instruction (§5.2) and a re-runnable drop-IF-EXISTS-then-add. Migration tested against the live-DB CI path.
- **Loop C two-beat status semantics** (escalate-at-inject, transition-to-`escalated`-at-expiry; `active+escalated_to` in between). Slightly subtle; mitigated by explicit documentation (§4.2 nuance) and REG-133. Assessment/architect ratify at review.
- **Loop B verify data source** — "did the student return?" reads `last_active`/`student_learning_profiles`, which the streak system also mutates (incl. the freeze-bump in `resetMissedStreaks`). A freeze-bump could read as a "return" without real activity. Mitigated by snapshotting `hadStreakFreeze` and (open item §12-B) defining "qualifying activity" as a genuine session event, not a freeze-bump. Assessment defines the exact predicate.
- **Loop C "band still high but different chapters" churn** — the worst chapter may change across the 14-day window. The row's `chapter_number` is fixed at inject (the worst-at-trigger chapter); verify keys on the *subject's* count, not the specific chapter, so chapter churn does not break verify. Documented.
- **Double escalation across loops to the same teacher** — Loop A and Loop C can both create `teacher_remediation_assignments` rows for the same student. The `20260619000400` dedupe index buckets by `(student, class, chapter)`; a Loop A chapter and a Loop C worst-chapter in the same subject could be different chapters → two assignment rows. This is acceptable (different chapters = different signals), but the A↔C coexistence rule (C-G3) prevents the *common* overlap. Monitored on staging.
- **Nested clone** — all work under the canonical root only.

## 11. Out of Scope

- A fourth loop / any signal beyond inactivity + at-risk-concentration.
- Real-time (non-cron) triggering.
- LLM-generated nudge or escalation content (P12).
- Mobile (Flutter) UI for nudges / new event kinds.
- New RBAC permissions/roles, pricing, or AI model changes.
- A read-time rhythm lane for B or C (deliberately none — Decisions B1, C1).
- Splitting `ff_adaptive_loops_bc_v1` into per-loop flags (trivial follow-up if independent ramp is ever needed — Decision X1).
- A grace-day (`'at_risk'`) gentle reminder (Decision B3 open item).
- A subject-level (chapter-less) `adaptive_interventions` key variant (Decision C3 open item).

## 12. Open Items

**Cross-loop**
- **Daily ceiling value + precedence** — assessment ratifies ceiling = 1/student/day and precedence A>C>B (Decision X3). Should the ceiling ever be 2 (allow A+B in one night)? Default to 1 for v1.
- **Single flag vs two** — `ff_adaptive_loops_bc_v1` is recommended (Decision X1); ops confirms independent ramp from A is the requirement, not independent ramp of B vs C.

**Loop B**
- **"Qualifying activity" predicate** — define genuine-return vs freeze-bump (§10). Assessment owns; likely "a session/quiz event after `created_at`", explicitly excluding the `resetMissedStreaks` freeze-bump.
- **Return window N=3, nudge cooldown 7, onboarding grace 7** — assessment ratifies.
- **Grace-day gentle reminder** — Decision B3 defers a possible v1.1 non-intervention reminder for `'at_risk'`.

**Loop C**
- **Worst-chapter selection + window N=14 + cooldown 7** — assessment ratifies.
- **Two-beat status semantics** (Decision C1/C4 / §4.2 nuance) — assessment + architect ratify that `active` with a non-null `escalated_to` during the verify window is acceptable, and that expiry → `escalated` (with a re-notify audit row, not a second intervention) is the right terminal.
- **Re-notify mechanism** — bump the existing assignment vs follow-up parent alert vs ops-only; idempotency key shape for the re-notify (`concentration:<interventionId>:reescalated`).
- **Subject-level key variant** — if subject-only interventions become common, a future key variant (Decision C3).

**Process**
- **REG numbering** — REG-131..134 proposed; **REG-130 ceded to the #1015 testing review** per the prompt. Testing owns final numbering (may compact to REG-130.. if #1015 does not claim REG-130) and text.
- **Constraint name pin** — architect verifies the auto-generated `trigger_signal`/`chapter_number` CHECK names on prod before pinning them in the drop-then-add migration (§5.2).
- **Registry pin** — backend lands the six `system.*` kinds + the `events-registry.test.ts` kind-count update inside this feature branch.
- **Runbook** — ops extends `docs/runbooks/adaptive-remediation-rollout.md` with the B/C synthetic-signal drill + the trigger-signal-filtered hard-stop SQL.

## 13. Decision Log

| Date | Decision | By |
|---|---|---|
| 2026-06-13 | Loop B = nudge (no queue lane); full-auto; trigger on `'broken'` only; escalate to PARENT only; return window 3d (Decisions B1-B5). | this spec (assessment/architect ratify) |
| 2026-06-13 | Loop C = escalation-IS-the-intervention (immediate at inject); reuse Loop A resolver + dedupe verbatim; attach worst at-risk chapter; verify = band drop below `high`; re-notify (not re-row) on expiry; window 14d (Decisions C1-C5). | this spec (assessment/architect ratify) |
| 2026-06-13 | ONE new flag `ff_adaptive_loops_bc_v1` for both loops (NOT a reuse of `ff_adaptive_remediation_v1`); per-`trigger_signal` inject gating; shared active-rows verify drain (Decisions X1-X2). | this spec |
| 2026-06-13 | Per-student daily ceiling = 1 new intervention/day across A/B/C, precedence A>C>B; verify-phase drains exempt (Decision X3). | this spec (assessment ratifies value) |
| 2026-06-13 | `trigger_signal` CHECK extended additively (drop-named-IF-EXISTS then add); `chapter_number > 0` relaxed to `>= 0` for Loop B's `(student,'_inactivity',0)` sentinel; no new table, no new index. | this spec (architect signs off the relax) |
