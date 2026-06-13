# Phase A Loop A — Adaptive Closed Loop: Mastery-Cliff → Auto-Remediation → Recovery Verification — Design Spec

- **Date**: 2026-06-12
- **Status**: DESIGN APPROVED (CEO approved Loop A with TIERED authority — model 3). Docs-only; no code in this step. Implementation ships on a feature branch with this spec.
- **Owning agents**: architect (schema, RLS, migration, cron-route security), assessment (guardrail constants, recovery thresholds, queue-composition rules), backend (cron steps, API routes, notifications, event registry), frontend (DailyRhythmQueue lane, Pulse timeline), testing (unit/integration/E2E + regression entries), quality (gates).
- **Product invariants in scope**: P5 (grades are strings), P7 (bilingual UI), P8 (RLS boundary), P9 (RBAC enforcement), P12 (AI safety — no new LLM output), P13 (data privacy).
- **Program context**: Phase A of the monitoring program. Phase C (backbone) — shipped. Phase B (visibility) — shipped as Student Pulse (PR #1013). Phase A makes the signals act; this spec covers **Loop A** (mastery-cliff) only — Loops B (inactivity) and C (at-risk concentration) are follow-up specs (§11). Note: "Phase B/C" are program phases; "Loop B/C" are Phase A loops — distinct namespaces.

---

## 1. Context

Today a mastery-cliff signal (`masteryCliff.verdict === 'flagged'` from `src/lib/pulse/signals.ts`) renders on the Pulse dashboards and then **waits for a human**. A parent or teacher must notice the flag, interpret it, and decide what to do. For B2C students with disengaged parents, nobody acts at all.

Loop A makes the signal **act**:

```
detect cliff → auto-inject targeted remediation into the student's daily rhythm
            → verify p_know recovery within a fixed window
            → escalate to a human ONLY if recovery fails
```

**Authority model (CEO-approved: TIERED, model 3).** The system may inject extra targeted practice into the student's daily rhythm **without human approval** — this is pedagogically low-risk (it is more practice on a chapter the student already studies, using pre-authored content). The system may **not** silently absorb failure: if mastery does not recover within the verification window, the loop escalates to a human — the roster teacher (B2B) or the linked parent (B2C, no teacher) — with a notification and an audit event. Humans are pulled in exactly when automation has demonstrably not worked.

This is the first learner-state mutation driven by a Pulse signal. The RBAC Conformance + Student Pulse spec (`docs/superpowers/specs/2026-06-12-rbac-conformance-and-student-pulse-design.md`) explicitly deferred adaptive loops; this spec lifts that deferral for Loop A only.

## 2. Goals / Non-Goals

**Goals**
- Close the mastery-cliff feedback loop end-to-end with deterministic, cron-evaluated state transitions.
- Reuse existing substrate everywhere: `signals.ts` for detection, `wrong_answer_remediations` + SM-2 due-review machinery for content, `composeDailyRhythm()` for delivery, `teacher_remediation_assignments` for B2B escalation, the notifications system for humans, `state_events` for the audit trail.
- Keep every threshold in ONE module, assessment-ratified, with no duplicate definitions.
- Ship flag-gated (`ff_adaptive_remediation_v1`, default OFF), staging-first, with a clean kill switch.

**Non-Goals**
- Closing loops B (inactivity) and C (at-risk concentration) — follow-up specs reusing the same `adaptive_interventions` substrate (see §12).
- Real-time (non-cron) triggering.
- Generating remediation content with an LLM (P12: only pre-authored bilingual text reaches students).
- Mobile (Flutter) UI for the remediation lane.
- Any new RBAC permission or role.

## 3. Resolved Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **TIERED authority (model 3)** — auto-inject without approval; escalate to a human only on verified recovery failure. | CEO-approved. Extra targeted practice is pedagogically low-risk; unresolved regression is not. Humans intervene exactly where automation failed, so attention is spent only where it matters. |
| 2 | **Cron-evaluated, not real-time** — the trigger is evaluated once per day inside the daily-cron cycle, never inline on quiz submit. | Determinism and idempotency: one evaluation per (student, day) makes guardrails (cooldowns, one-active-max, daily caps) enforceable and testable. Mid-session injection would also fight the anti-frustration design of the quiz flow. |
| 3 | **Detection and verification math run in Next.js, not Deno** — the two daily-cron steps are thin, flag-gated triggers that POST (with `CRON_SECRET`) to internal Next.js cron routes; those routes import `deriveSignals` from `signals.ts` and the two new pure modules directly. | daily-cron is a Deno Edge Function and cannot import `src/lib/*`. Re-implementing the cliff math in Deno would violate the "cliff evaluation only from `signals.ts`" guardrail (§6.6). The thin-trigger pattern is the existing `triggerMonthlySynthesis` precedent (flag check + `CRON_SECRET` fetch-out + `Promise.allSettled` isolation); the Next-route-as-cron-worker pattern is the existing `/api/cron/irt-calibrate` precedent. |
| 4 | **`adaptive_interventions` row is the canonical state machine; `state_events` is the observability trail.** `publishEvent` is flag-gated on `ff_event_bus_v1`, so events are best-effort; every escalation additionally writes an `audit_logs` row (metadata only, REG-68 pattern) so the audit trail survives a bus-off environment. | Mirrors the `teacher_remediation_assignments` precedent (status-machine table) and the platform-wide rule that the event bus is never load-bearing for correctness. |
| 5 | **Cards are materialized at read time, not stored.** The cron writes only the intervention row; `/api/rhythm/today` reads active rows and calls the pure `remediation-queue-adapter.ts` to compose that day's remediation cards into a new optional `composeDailyRhythm()` lane. | No card-storage table, no staleness. The fatigue guardrail (§6.3) must be evaluated against *today's* state at queue-composition time anyway. Flag off ⇒ adapter returns an empty lane with zero schema impact. |
| 6 | **Snapshot the baseline at injection time** — `trigger_snapshot` jsonb stores the pre-cliff mastery, post-cliff mastery, largest drop, decline streak, and a thresholds version. | Recovery verification then needs only the *current* mastery reading; it never depends on old `state_events` rows surviving retention (the Pulse spec's "events pruned" risk does not propagate into Loop A). Also makes mid-flight threshold changes non-retroactive. |
| 7 | **Escalation target resolution**: B2B — the student has a roster teacher via `class_students × class_teachers` ⇒ create a `teacher_remediation_assignments` row owned by that teacher. B2C — no roster teacher ⇒ notify the linked guardian(s) (`guardian_student_links`, status `approved`/`active`). Neither ⇒ terminal `escalated` with `escalated_to = NULL`, student-facing notification only, flagged in the event payload for ops visibility. | Reuses Phase 3A semantics verbatim for B2B; degrades gracefully for unlinked B2C students instead of silently dropping the failure. |
| 8 | **New `system` event actor.** The three audit kinds are `system.remediation_injected` / `system.remediation_recovered` / `system.remediation_escalated`. The registry's canonical-actor set (currently learner, parent, teacher, school, ai, billing, mesh) is extended with `system` in BOTH `src/lib/state/events/registry.ts` (header comment + union) and the `CANONICAL_ACTORS` pin in `src/__tests__/state/events-registry.test.ts` — the test file itself documents this as the sanctioned procedure. | No existing actor fits: the producer is the platform acting autonomously, not a learner/teacher/ai-tutor action. `system.*` is the honest provenance label for tiered-authority automation and will be reused by loops B/C. |

## 4. Loop Definition (State Machine)

One intervention cycle per `(student, subject_code, chapter_number)`. States: `active → recovered | escalated` (both terminal for the cycle). **At most one `active` intervention per (student, subject, chapter)** — DB-enforced (§5).

```
                ┌──────────────────────────────────────────────────────────┐
                │ TRIGGER (daily-cron → injectAdaptiveRemediations)        │
                │ masteryCliff.verdict === 'flagged' from signals.ts;      │
                │ worstSubject/worstChapter identify the target.           │
                │ All guardrails pass (§6) → INSERT adaptive_interventions │
                │ (status='active') + system.remediation_injected event    │
                │ + onRemediationAssigned notification (student).          │
                └────────────────────────┬─────────────────────────────────┘
                                         │
                ┌────────────────────────▼─────────────────────────────────┐
                │ INTERVENE (read-time, /api/rhythm/today)                 │
                │ While status='active': remediation-queue-adapter.ts     │
                │ composes ≤3 remediation cards/day for the flagged       │
                │ chapter (wrong_answer_remediations content + SM-2       │
                │ due-review machinery) into the new optional lane of     │
                │ composeDailyRhythm(). Total queue ≤ 10 items.            │
                └────────────────────────┬─────────────────────────────────┘
                                         │ daily, until window closes
                ┌────────────────────────▼─────────────────────────────────┐
                │ VERIFY (daily-cron → evalRemediationRecovery)            │
                │ recovery-evaluation.ts verdict per active row:           │
                │  • recovered — current chapter mastery ≥ pre-cliff       │
                │    baseline OR ≥ post-cliff + recovery_gain, within      │
                │    the window  → status='recovered', resolved_at,        │
                │    system.remediation_recovered + onRemediation-         │
                │    Recovered notification.                               │
                │  • pending   — window still open, not yet recovered      │
                │    → no transition.                                      │
                │  • expired   — window elapsed without recovery → ESCALATE│
                └────────────────────────┬─────────────────────────────────┘
                                         │ expired only
                ┌────────────────────────▼─────────────────────────────────┐
                │ ESCALATE (same cron step; DB writes — status transition  │
                │ + assignment insert — atomic; event/notification are     │
                │ post-commit best-effort per Decision 4)                   │
                │ B2B: INSERT teacher_remediation_assignments (existing    │
                │      Phase 3A table/API semantics); link via             │
                │      teacher_assignment_id; escalated_to='teacher'.      │
                │ B2C (no teacher): guardian notification;                 │
                │      escalated_to='parent'.                              │
                │ Neither: escalated_to=NULL (student notification only).  │
                │ Always: status='escalated', resolved_at,                 │
                │ system.remediation_escalated event + audit_logs row +    │
                │ onRemediationEscalated notification.                     │
                └──────────────────────────────────────────────────────────┘
```

**Trigger details.** Evaluated during daily-cron (not real-time) for determinism. The inject route assembles the per-student `PulseRawInput` using the **same assembly the Pulse self-lens uses** (`src/lib/pulse/pulse-server.ts`) and calls `deriveSignals()`. Only a `flagged` verdict with **non-null** `worstSubject` and `worstChapter` (the drop path) is actionable. A decline-streak-only flag (Path 2 in `signals.ts`) can carry null target fields — Loop A v1 logs it and does **not** inject (you cannot target a chapter you cannot name); a worst-subject fallback heuristic is an open item (§12).

**Verify details.** `recovered` is assessed against the `trigger_snapshot` baseline using only the *current* mastery reading for the `(subject_code, chapter_number)` pair, read from the same store the trigger used (latest `learner.mastery_changed` `toMastery`, falling back to the `learner_mastery` rollup — the canonical bus-projection rollup; read order ratified by assessment at review). Placeholder thresholds pending assessment ratification: recovery = mastery back to **≥ pre-cliff level** OR a **+0.15 gain** over the post-cliff value (deliberately symmetric with `PULSE_THRESHOLDS.mastery_cliff_drop = 0.15`); window **N = 7 days**, denormalized to a `verify_by` column at injection time so a later window change is non-retroactive.

## 5. Data Model

### 5.1 `adaptive_interventions` (NEW table — architect)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `student_id` | uuid NOT NULL FK → `students(id)` ON DELETE CASCADE | internal id, NOT `auth.uid()` (matches `teacher_remediation_assignments` convention) |
| `subject_code` | text NOT NULL | `worstSubject` from the signal |
| `chapter_number` | int NOT NULL | `worstChapter` from the signal (chapter numbers are integers platform-wide; P5 covers *grades*, which never appear on this table) |
| `trigger_signal` | text NOT NULL DEFAULT `'mastery_cliff'` | CHECK constraint; loops B/C add values later |
| `trigger_snapshot` | jsonb NOT NULL | `{ largestDrop, baselineMastery, postCliffMastery, declineStreak, evaluatedAtIso, rulesVersion }` — derived metrics only, **no PII** |
| `status` | text NOT NULL DEFAULT `'active'` | CHECK IN (`'active'`,`'recovered'`,`'escalated'`) |
| `verify_by` | timestamptz NOT NULL | `created_at + RECOVERY_WINDOW_DAYS` denormalized at insert |
| `escalated_to` | text NULL | CHECK IN (`'teacher'`,`'parent'`) OR NULL (NULL also covers the no-recipient edge case) |
| `teacher_assignment_id` | uuid NULL FK → `teacher_remediation_assignments(id)` ON DELETE SET NULL | set on B2B escalation |
| `created_at` | timestamptz NOT NULL DEFAULT `now()` | |
| `resolved_at` | timestamptz NULL | set on terminal transition |

No `updated_at`: the row has exactly one transition (`active` → terminal), pinned by `resolved_at` — same shape as `teacher_remediation_assignments`.

**Indexes**
- `UNIQUE (student_id, subject_code, chapter_number) WHERE status = 'active'` — partial unique index; DB-level enforcement of one-active-max (§6.5), race-proof against concurrent cron runs.
- `(status, verify_by)` — the verify sweep ("all active rows past/approaching deadline").
- `(student_id, status)` — `/api/rhythm/today` lane lookup.
- `(student_id, subject_code, chapter_number, resolved_at)` — the 3-day cooldown check (§6.4).

**RLS (same migration — P8).** Reuses the ratified Pulse/Phase-3A patterns verbatim:
- **Service role ALL** (`auth.role() = 'service_role'`) — the cron routes are the only writers.
- **Student SELECT own** — `student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())`.
- **Parent SELECT linked** — via `guardian_student_links` with `status IN ('approved','active')` (the dual-status convention `canAccessStudent` already accepts; do not re-derive).
- **Teacher SELECT assigned** — the canonical `class_students × class_teachers` roster join copied from `20260613000004_teacher_remediation_assignments.sql`.
- **No client INSERT/UPDATE/DELETE policies.** All writes are service-role (cron). Idempotent: `CREATE TABLE/INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` before each `CREATE POLICY`.

The same migration seeds `ff_adaptive_remediation_v1` (default OFF) into `feature_flags` following the `20260511000000_pedagogy_v2_wave_3_monthly_synthesis.sql` seed pattern (`ON CONFLICT (flag_name) DO NOTHING`).

### 5.2 `state_events` audit kinds (registry change — backend)

Three new kinds in `src/lib/state/events/registry.ts` (+ `ALL_EVENT_KINDS` + the discriminated union + the `system` actor addition per Decision 8):

| Kind | Payload (bounded, no PII) |
|---|---|
| `system.remediation_injected` | `interventionId`, `subjectCode`, `chapterNumber`, `largestDrop`, `declineStreak`, `baselineMastery`, `verifyBy` |
| `system.remediation_recovered` | `interventionId`, `subjectCode`, `chapterNumber`, `recoveredMastery`, `daysToRecovery` |
| `system.remediation_escalated` | `interventionId`, `subjectCode`, `chapterNumber`, `escalatedTo` (`'teacher' \| 'parent' \| null`), `teacherAssignmentId` (nullable) |

Envelope: `actorAuthUserId` carries the **learner's** auth_user_id (the envelope contract is "who the event is about"); `tenantId` carries the school for B2B, null for B2C; `idempotencyKey` = `remediation:<interventionId>:<phase>` so cron retries dedupe. Published via `publishEvent()` only (best-effort per Decision 4 — never load-bearing).

**Rationale.** The status-machine table mirrors the `teacher_remediation_assignments` precedent (queryable current state, FK-linked escalation); the events give the immutable, replayable audit trail the tiered-authority model requires ("show me every time the system acted on its own").

## 6. Guardrails (assessment-ratified; constants in ONE module)

All constants live in **one exported object** — `ADAPTIVE_REMEDIATION_RULES` in `src/lib/learn/remediation-queue-adapter.ts` — imported by `recovery-evaluation.ts`, the cron routes, and tests. Values below are placeholders pending assessment ratification (open item §12); the *structure* is fixed.

| # | Guardrail | Placeholder value | Enforced where |
|---|---|---|---|
| 1 | Max remediation cards per day | **3** | `remediation-queue-adapter.ts` (pure) |
| 2 | Total daily queue cap | **≤ 10 items** (base queue is exactly 7: 5 SRS + 1 ZPD + 1 reflection; lane cap = `min(3, 10 − base)`) | adapter + `composeDailyRhythm()` |
| 3 | Fatigue skip — no injection into today's queue if `fatigueScore > 0.6`; cards defer to the next day (the intervention row stays active; the window does NOT extend) | **0.6** — deliberately the same threshold as cognitive-engine's `shouldEaseOff` | adapter, at queue-composition time |
| 4 | Chapter cooldown — same `(student, subject, chapter)` not re-targeted within **3 days** of a *terminal* intervention (`resolved_at`) | **3 days** | inject route, against the cooldown index |
| 5 | One active intervention max per `(student, subject, chapter)` | structural | DB partial unique index (§5.1) + inject-route pre-check |
| 6 | Cliff evaluation comes ONLY from `signals.ts` (`deriveSignals` / `PULSE_THRESHOLDS`) — **no duplicate threshold definitions anywhere**, including the Deno cron (which therefore delegates to the Next routes, Decision 3) | structural | code review + unit test asserting the adapter imports, not redefines |
| 7 | Recovery window / recovery gain | **7 days / +0.15 or ≥ baseline** | `recovery-evaluation.ts` |

**Ratified at review (assessment, 2026-06-13) — guardrail 3 fatigue source.** `fatigueScore = null` at read time is RATIFIED v1 behavior: fatigue is a within-session construct that resets at session start, so no live fatigue source exists at queue-composition time and the guardrail-3 skip simply does not fire (`null` is never `> 0.6`). A last-session error-streak proxy was academically REJECTED — the students who most need remediation are exactly those carrying recent error streaks, so the proxy would systematically starve remediation for its target population. **Binding obligation**: any future live read-time fatigue source MUST be wired into BOTH lanes — the inject lane and the read-time queue-composition lane (`remediation-queue-adapter.ts`) — before shipping; a single-lane wire-up would reintroduce inconsistent skip behavior between injection and delivery.

## 7. Components & File Map

| Component | Path | Status | Owner |
|---|---|---|---|
| Remediation queue adapter (pure): active intervention rows + today's student state → `RemediationCard[]` respecting guardrails 1–3; exports `ADAPTIVE_REMEDIATION_RULES` | `src/lib/learn/remediation-queue-adapter.ts` | NEW | assessment (rules) — pure, unit-tested |
| Recovery evaluation (pure): intervention row + current mastery reading → `recovered \| pending \| expired` | `src/lib/learn/recovery-evaluation.ts` | NEW | assessment |
| daily-cron steps: `injectAdaptiveRemediations()` + `evalRemediationRecovery()` — thin triggers POSTing to the Next cron routes with `CRON_SECRET`; registered in the step list with `Promise.allSettled` isolation (the `triggerMonthlySynthesis` pattern). Gating differs by step: **inject is gated on `ff_adaptive_remediation_v1`**; **verify is gated on the existence of `active` rows**, not the flag — drain semantics required by the §9 kill switch | `supabase/functions/daily-cron/index.ts` | MODIFIED | backend |
| Cron worker routes (service-role; fail-closed `CRON_SECRET` check before any DB I/O; bounded batches to respect the 30s API timeout — see §10) | `src/app/api/cron/adaptive-remediation/inject/route.ts`, `…/verify/route.ts` | NEW | backend (architect reviews auth gate) |
| Rhythm route: read active interventions → adapter → pass `RemediationCard[]` into the new optional lane | `src/app/api/rhythm/today/route.ts` | MODIFIED | backend |
| Orchestrator: optional `remediationCards` input + new `{ kind: 'remediation' }` `RhythmItem` member; lane placed after the SRS block, before the ZPD problem (warm-up → targeted repair → stretch — ordering subject to assessment ratification); existing callers/tests unaffected (optional field) | `src/lib/learn/daily-rhythm-orchestrator.ts` | MODIFIED | assessment (+backend wiring) |
| Remediation content lookup (existing — reused as-is, no schema change) | `src/lib/learn/wrong-answer-remediation.ts` → `wrong_answer_remediations` table; SM-2 due-review machinery via `get_due_reviews` / `src/lib/learn/due-reviews-adapter.ts` | EXISTING | — |
| Notifications: `onRemediationAssigned` / `onRemediationRecovered` / `onRemediationEscalated` (bilingual, P7; metadata-only payloads, P13) following the `onStreakBroken` style | `src/lib/notification-triggers.ts` | MODIFIED | backend |
| Migration: `adaptive_interventions` + RLS + indexes + `ff_adaptive_remediation_v1` seed (default OFF) | `supabase/migrations/20260612150000_adaptive_interventions_loop_a.sql` (proposed; final timestamp assigned at implementation, `YYYYMMDDHHMMSS` per migration rules) | NEW | architect |
| Event registry: 3 `system.*` kinds + `system` actor | `src/lib/state/events/registry.ts` (+ `CANONICAL_ACTORS` in `src/__tests__/state/events-registry.test.ts`) | MODIFIED | backend |
| Frontend: remediation card rendering in the daily queue with bilingual "Foxy is helping you with Chapter X" framing (en/hi; never punitive language) | `src/components/dashboard/sections/DailyRhythmQueue.tsx` | MODIFIED | frontend |
| Frontend: Pulse timeline renders the three intervention events on the student/parent/teacher lenses | `src/components/pulse/*` | MODIFIED | frontend |
| B2B escalation target (existing — reused) | `teacher_remediation_assignments` (migration `20260613000004`) | EXISTING | — |

**Escalation mapping note (B2B).** `teacher_remediation_assignments` requires NOT NULL `teacher_id` + `class_id` and a *uuid* `chapter_id` (`curriculum_topics.id`), while the signal yields `(subject_code, chapter_number)`. The verify route resolves: (a) the class — deterministic rule: the student's class whose subject matches `subject_code`, tie-broken by most recent class creation (rule subject to assessment/backend ratification, §12); (b) the owning teacher — that class's `class_teachers` row; (c) `chapter_id` — mapped from `(subject_code, chapter_number, students.grade)` via `curriculum_topics`, using the grade **string** (P5); left NULL when unmapped (the column is nullable by design for general remediation). `source_alert_id` stays NULL (that FK is for `at_risk_alerts`).

## 8. Security & Invariants

- **P8** — `adaptive_interventions` ships RLS + policies in the same migration; four patterns covered (student own / parent linked / teacher assigned / service role). No client write path exists at all.
- **P9** — **no new permissions.** Cron routes are service-role behind a fail-closed `CRON_SECRET` gate (deny before any DB I/O — the REG-118/REG-119 posture). Student/teacher/parent reads ride existing scopes: the rhythm lane is inside the already-authorized `/api/rhythm/today`; Pulse lenses keep their existing `authorizeRequest()` permissions; the teacher sees escalations through the existing Phase 3A surfaces.
- **P12** — remediation content is pre-authored bilingual text from `wrong_answer_remediations` plus existing question-bank items via SM-2. **No new LLM output reaches students.** The "Foxy is helping you" framing is static UI copy, not generated.
- **P13** — `trigger_snapshot`, event payloads, notification payloads, and the escalation `audit_logs` row carry UUIDs and derived metrics only — never names, emails, phones, or raw message text (REG-68 pattern).
- **P5** — grades appear only in the `curriculum_topics` mapping lookup and remain strings end-to-end.
- **P7** — all student/parent/teacher-facing copy (lane framing, notifications, Pulse timeline labels) ships en + hi.
- **Flag-gated, default OFF** — `ff_adaptive_remediation_v1`. See kill-switch semantics in §9.

## 9. Validation & Rollout

**Tests**
- Unit (Vitest): `remediation-queue-adapter.test.ts` and `recovery-evaluation.test.ts` — every guardrail boundary in §6 (caps at 0/1/3 cards, queue at 9/10/11, fatigue at 0.59/0.60/0.61, cooldown at day 2/3/4, window at day 6/7/8, recovery at baseline−ε / baseline / +0.149 / +0.15), plus the structural test that the adapter imports `PULSE_THRESHOLDS` rather than redefining any threshold (guardrail 6).
- Integration: cron steps + routes — flag OFF ⇒ inject is a no-op; missing/wrong `CRON_SECRET` ⇒ 401 before any DB read; one-active-max under double-invocation (idempotency via the partial unique index); escalation writes the assignment row, the event, and the audit row together.
- E2E (Playwright): student with an active intervention sees ≤3 remediation cards in the daily queue with bilingual framing; flag OFF renders the unchanged 7-item queue.
- **REG-118 impact**: the daily-cron static-source contract canary pins the cron's step/helper pairs — adding two steps requires updating that canary in the same PR (testing agent notified).
- **Registry pin impact**: `events-registry.test.ts` `CANONICAL_ACTORS` + kind-count pins must be updated with the `system` actor and the three kinds (Decision 8).

**Regression catalog** — next free ids (REG-120 is reserved by the RBAC-conformance spec): proposed **REG-121** (tiered-authority gate: no escalation before window expiry; no injection when any guardrail fails), **REG-122** (queue-cap + fatigue-skip invariants on `/api/rhythm/today`), **REG-123** (escalation completeness: terminal row + event + audit row + notification move together; RLS boundary on `adaptive_interventions`). Final numbering and text owned by testing.

**Rollout**

**Hard precondition (ratified): `ff_adaptive_remediation_v1` ON ⇒ `ff_event_bus_v1` ON in the same environment.** The inject scan and recovery verification both read `learner.mastery_changed` observations (with the `learner_mastery` bus-projection rollup as fallback); with the bus OFF, no new mastery observations land, so **verification is blind** — every intervention would expire to escalation regardless of actual recovery. Never enable the loop where the bus is OFF. Conversely, killing the bus in an environment where the loop is ON requires draining first: flip `ff_adaptive_remediation_v1` OFF and let active interventions drain to terminal state (or hard-stop bulk-dismiss) BEFORE disabling `ff_event_bus_v1`. Procedure, verification SQL, and hard-stop transaction: `docs/runbooks/adaptive-remediation-rollout.md`.

1. Merge with flag OFF everywhere (zero behavior change; migration is additive + idempotent).
2. Enable on **staging** first; seed a synthetic cliff; observe a full cycle (inject → cards render → forced recovery, and a second cycle forced to expiry → escalation) before any prod enablement.
3. Prod enablement is a flag flip (ops-logged), optionally via `rollout_percentage` for a cohort ramp.

**Kill switch** = flag OFF. Semantics (CEO-specified): **no new injections** (inject step short-circuits; the rhythm lane renders empty), but **mid-flight interventions complete naturally via cron** — the verify step keeps processing already-active rows to terminal state (including escalation at expiry), so no student is left in limbo. This is precisely why the verify step's gate is "active rows exist", not the flag (§7): the kill switch drains, it does not freeze. Hard stop, if ever needed: ops runbook bulk-resolves active rows via service-role SQL (documented with the rollout runbook).

## 10. Risks

- **Top risk — unwanted automation (the loop annoys rather than helps).** Mitigated by the tiered model itself (lowest-stakes action first), the fatigue skip, the 3-card/day + 10-item caps, the 3-day cooldown, and one-active-max. Assessment owns ratifying every number before enablement.
- **Cron worker timeout** — the inject route iterates students inside Vercel's 30s API budget. Mitigation: candidate pre-filter (flag-enabled + recently-active students only), bounded batches with carry-over to the next daily run (a one-day detection delay is acceptable by design — the loop is daily-grained). If cohorts outgrow this, promote to a paginated multi-invocation pattern (the `monthly-synthesis-builder` per-student POST precedent).
- **Decline-streak-only flags are not actionable** — Path 2 of `deriveMasteryCliff` can flag with null `worstSubject`/`worstChapter`; v1 skips these (logged). Coverage gap is visible in events; fallback heuristic tracked in §12.
- **Escalation target ambiguity** — students in multiple classes for the same subject, or with stale rosters. The deterministic class-selection rule (§7) needs assessment/backend ratification; worst case the assignment lands with a real-but-suboptimal teacher, which is still strictly better than silence.
- **`curriculum_topics` mapping gaps** — `(subject_code, chapter_number, grade)` may not resolve to a `chapter_id`; handled (nullable column), but unmapped escalations render as "general" remediation on the teacher side. Track mapping coverage on staging.
- **Event-bus flag off in an enabled environment** — `state_events` trail goes quiet AND recovery verification goes blind while the loop runs (no new mastery observations land). Closed as a **hard precondition** (§9): `ff_adaptive_remediation_v1` ON ⇒ `ff_event_bus_v1` ON; killing the bus requires draining/dismissing active interventions first (`docs/runbooks/adaptive-remediation-rollout.md`). Audit-trail survivability on escalation remains covered by Decision 4 (canonical table + `audit_logs`).
- **Nested clone** — all work happens under the canonical root `d:\Alfa_local\Alfanumrik\`; never the nested `Alfanumrik\Alfanumrik\` clone or `.claude/worktrees/*` copies.

## 11. Out of Scope

- **Loop B (inactivity) and Loop C (at-risk concentration)** — follow-up specs; both reuse the `adaptive_interventions` substrate (`trigger_signal` enum extension + new adapter rules), which is why the table is signal-generic from day one.
- Real-time (non-cron) triggering.
- LLM-generated remediation content (P12).
- Mobile (Flutter) UI for the remediation lane and intervention timeline.
- New RBAC permissions/roles, pricing, or AI model changes.

## 12. Open Items

- **Assessment ratification** of every constant in `ADAPTIVE_REMEDIATION_RULES` (§6) and the recovery definition (§4 — "≥ baseline OR +0.15 gain", window N=7), plus the canonical current-mastery read order and the lane position in the queue (§7).
- **Escalation class-selection rule** (§7) — assessment + backend ratify; architect reviews the roster join reuse.
- **Decline-streak fallback** — should a null-target flag remediate the lowest-mastery chapter in the worst subject? Deferred to a Loop A v1.1 decision.
- **`system` actor addition** — backend lands the registry + test change inside this feature branch (Decision 8); flagged here so the events-registry pin update is not mistaken for drift.
- **REG numbering** — REG-121..123 proposed; testing owns final catalog entries and text.
- **Ops runbook** — flag-flip procedure, staging synthetic-cliff drill, and the hard-stop bulk-resolve SQL; ops owns the doc with this feature branch.
