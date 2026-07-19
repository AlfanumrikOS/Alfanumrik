## Voice 3 — adaptive-language spoken-reply resolver (2026-06-09) - REG-107

Closes the Python AI Voice loop (Voice 1a STT → Voice 1b TTS): when a student
SPEAKS, Foxy's spoken reply adapts to the language they actually used. The
Whisper STT call already returns `detected_language`
('en' | 'hi' | 'hinglish' | 'unknown') and `voice.ts` already emits it via the
`onPythonResult` hook; Voice 3 wires that signal up through
`ChatInput` → `MessageInput` → `foxy/page.tsx`, where it updates `voiceLangRef`
(the ref `speak()` reads for the TTS language). Activates only on the Python STT
path — no new flag, no behaviour change when `ff_python_voice_*` is OFF.

Pure resolver `adoptVoiceReplyLanguage(detected, current)` is the single decision
point; it MUST drop 'unknown' (the Azure TTS catalog has no 'unknown' voice and
would HTTP 400) and keep the current language instead.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-107 | `voice_3_adaptive_language_reply_resolver` | (1) Synthesizable set is exactly ['en','hi','hinglish']. (2) `isSynthesizableVoiceLanguage` rejects 'unknown'/''/unexpected and is case-sensitive. (3) `adoptVoiceReplyLanguage` adopts a concrete detected language over current. (4) 'unknown'/empty/garbage detected → current kept (never forwarded to TTS). (5) Idempotent when detected==current. | `src/__tests__/lib/voice-reply-language.test.ts` | E |

### Invariants covered by this section

- P7 (bilingual UI) - the spoken-reply language tracks the language the student
  actually spoke (en/hi/hinglish), reinforcing the Hindi/English parity contract
  on the voice surface.
- P12 (AI safety) - 'unknown' is never forwarded to the TTS synthesize endpoint;
  only catalog-valid languages reach the provider.
- P13 (data privacy) - resolver is pure over a language enum; no transcript /
  student text flows through it.

### Catalog total

Pre-Voice-3: 74 entries. Adds REG-107.

**Total: 75 entries.**

## Phase A Loop A — Adaptive Remediation closed loop (2026-06-13) — REG-126..REG-129

Source: Phase A Loop A adaptive remediation
(`docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md`
§9; the spec proposed REG-121..123 before the RBAC/Pulse cluster took those ids —
final numbering owned by testing per §12). The platform's first autonomous
closed loop: detect a mastery cliff → inject ≤3 remediation cards into the
daily rhythm queue → verify recovery over a 7-day window → escalate to a human
(teacher via the Phase 3A assignment spine, else linked parent, else
student-only) when recovery does not happen. Everything is gated behind
`ff_adaptive_remediation_v1` (seeded OFF by
`20260619000300_seed_ff_adaptive_remediation_v1.sql`).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-126 | `adaptive_remediation_closed_loop_state_machine` | The `adaptive_interventions` state machine (migration `20260619000200_adaptive_interventions.sql`) cannot double-fire, freeze, or falsely self-resolve. INJECT dedupe: a 23505 from the `adaptive_interventions_one_active` partial unique index (one ACTIVE row per student × subject × chapter) is a benign dedupe — no event, no notification, `deduped` counted, never an error; an existing active row blocks BEFORE any insert (adapter guardrail 5); the injection planner's guardrails are pinned at their boundaries (fatigue strict >0.6 with exactly-0.6 injecting, 3-day same-chapter cooldown with exclusive end, no_cliff gate, null-target decline-streak flags skipped). DRAIN, NOT FREEZE (CEO-specified kill-switch semantics): flag OFF ⇒ the inject phase is a no-op with ZERO candidate scans, but the verify phase still processes already-active rows to terminal state (expiry → escalation + audit + notification) — pinned at the worker route AND in the Deno daily-cron canary (contract 4c: `triggerAdaptiveRemediation` stays THIN — fetch-out with `x-cron-secret`, no `feature_flags` read, no `PULSE_THRESHOLDS`/`ADAPTIVE_REMEDIATION_RULES` in Deno — because a Deno-side flag gate would freeze mid-flight interventions). VERDICT DIRECTION (never false recovery): `evaluateRecovery` recovers ONLY on affirmative evidence — the LATEST in-window observation at/above the pre-cliff baseline (branch A, inclusive, no at-risk floor) or gain-from-trough ≥0.15 with mastery ≥0.4 (branch B, epsilon-guarded for IEEE 0.7−0.55); transient early peaks do not count; ambiguity/corruption (non-finite clock, corrupt record, no observations) degrades to `pending` with nulls; `expired` fires only STRICTLY after the inclusive 7-day window end, and in-window recovery beats late evaluation — so the loop's failure mode is always "a human gets asked" (escalation), never "the system claims recovery it cannot prove". ESCALATION COMPLETENESS: the terminal transition (guarded `eq status='active'` — race-safe), the `system.remediation_escalated` event, the `audit_logs` row, and the notification move together; a B2B assignment-insert failure leaves the row ACTIVE for next-run retry (no half-escalation: zero updates/events/audits/notifications). Notifications pin the house shape: top-level `message`/`body` EN + Hindi (real Devanagari) in `data.title_hi/body_hi/message_hi` (P7), deterministic `idempotency_key` per intervention cycle upserted `onConflict (recipient_id,type,idempotency_key) ignoreDuplicates` (cron retries never duplicate), guardians notified ONLY on the parent path with dual-status link filter + per-guardian preference opt-out, fire-and-forget (DB failure never throws). Observability trail: the `system` actor + 3 kinds (`system.remediation_{injected,recovered,escalated}`) are pinned in the events-registry canon. **Hard precondition (spec §9, ratified): `ff_adaptive_remediation_v1` ON ⇒ `ff_event_bus_v1` ON in the same environment** — both the inject scan and recovery verification read `learner.mastery_changed` observations from the bus; with the bus OFF, verification is BLIND and every intervention would expire to escalation regardless of actual recovery. Killing the bus where the loop is ON requires draining first (flag OFF → let actives reach terminal state) per `docs/runbooks/adaptive-remediation-rollout.md`. | `src/__tests__/api/cron/adaptive-remediation.test.ts` (kill-switch drain; inject happy path/23505 dedupe/guardrail-5 block; verify recovered/pending/expired ×3 escalation branches; mixed-case `subjectCode` observation matching; B2B failure-stays-ACTIVE), `src/__tests__/lib/learn/recovery-evaluation.test.ts`, `src/__tests__/lib/learn/remediation-queue-adapter.test.ts`, `src/__tests__/lib/notification-triggers-remediation.test.ts`, `src/__tests__/state/events-registry.test.ts` (`system` actor + 3 kinds), `supabase/functions/daily-cron/__tests__/contract.test.ts` (contract 4c) | U |
| REG-127 | `adaptive_remediation_cron_worker_posture` | The `/api/cron/adaptive-remediation` worker holds the REG-118/REG-119 posture. FAIL-CLOSED AUTH BEFORE ANY I/O: missing secret, wrong secret, and unset `CRON_SECRET` env (misconfig) all → 401 with the recorded DB seam proven EMPTY (zero reads — deny short-circuits before the supabase-admin seam AND before any flag read). Three pinned carriers (`Authorization: Bearer`, `x-cron-secret`, `?token=` — the daily-cron fetch-out + both Vercel-cron precedents) with FIRST-PRESENT-WINS precedence: a wrong higher-precedence carrier does NOT fall through to a correct lower one (still 401, still zero I/O). COUNTS-ONLY RESPONSES: the success envelope carries phase counters only (`inject: {scanned, injected, deduped, blocked, errors}`, `verify: {evaluated, recovered, escalated, pending, errors}` + `skipped` reasons) — never student rows; the unhandled-error path returns EXACTLY `{success:false, error:'internal_error'}` (no message field, internal detail provably absent from the body, logger-only). METADATA-ONLY AUDIT (REG-68 pattern): every escalation writes `audit_logs` with `actor_id null`, `action 'system.remediation_escalated'`, `target_entity 'adaptive_interventions'`, and metadata that never matches `/name\|email\|phone/i` — UUIDs and academic codes only (P13). The Deno daily-cron side keeps its own REG-118 canary (fail-closed CRON_SECRET, constant-time compare, auth-before-dispatch, `Promise.allSettled` isolation) now extended with the `adaptive_remediation_triggered`/`triggerAdaptiveRemediation` step pair. | `src/__tests__/api/cron/adaptive-remediation.test.ts` (auth-gate describe: carrier/precedence/zero-I/O pins; generic-500 describe; the B2B escalation test pins the audit row + metadata regex), `supabase/functions/daily-cron/__tests__/contract.test.ts` | U |
| REG-128 | `adaptive_remediation_b2b_escalation_attribution` | Escalation reaches the RIGHT teacher and survives concurrent duplicates. SUBJECT-MATCH TIERING (`src/app/api/cron/adaptive-remediation/_lib/subject-match.ts`): separator normalization on BOTH sides (`[_\s]+` → single space, lowercase, trim) kills the underscore false negatives (`social_studies` ≡ "Social Studies"); token-boundary matching (NOT bare substring) kills THE blocking false positive — code `science` returns tier 0 against "Social Science"/"Political Science"/"Computer Science"/"Environmental Science"; tier ordering exact(2) > partial(1) > none(0). The full 15-code CBSE matrix is pinned (math, science, english, hindi, social_studies, physics, chemistry, biology, business_studies, political_science, computer_science, economics, accountancy, geography, history) plus CBSE display variants ("Mathematics Standard/Basic", "English Core", "Hindi B", "Maths") and the documented `social_studies` vs "Social Science" alias limitation (tier 0 — alias mapping out of scope). ROUTE-LEVEL CONSEQUENCE: code `science` selects the older exact-match Science class over a NEWER "Social Science" class, and exact beats partial for `social_studies` — the wrong-teacher substring bug cannot regress silently. CROSS-TEACHER 23505 IDEMPOTENCY: the partial unique index `uq_teacher_remediation_assignments_open_dedupe` (migration `20260619000400`, keyed `(student_id, class_id, chapter-bucket)` WHERE status='assigned' — teacher_id deliberately NOT in the key) makes a colleague's open row invisible to the per-teacher pre-check, so the duplicate surfaces as 23505 on INSERT; the teacher API route recovers it as the SAME idempotent-success envelope (200, `idempotent:true`, surviving row returned) via a survivor lookup on the index's natural key (student_id + class_id + chapter eq/IS-NULL + status='assigned', explicitly WITHOUT teacher_id), never a 500; non-23505 errors still 500 (handling not widened); 23505-with-no-survivor stays a 500. The cron worker's escalation path holds the mirror-image pins: its survivor lookup MUST filter by the escalation-chosen `class_id` (cross-handoff fix — without it a same-student row from a DIFFERENT class could become the FK), links the existing assignment id on dedupe, and leaves the intervention ACTIVE for retry when the survivor cannot be resolved. | `src/__tests__/api/cron/adaptive-remediation-subject-match.test.ts` (tier matrix), `src/__tests__/api/cron/adaptive-remediation.test.ts` (tiered class selection ×2; B2B 23505 dedupe ×3), `src/__tests__/api/teacher/remediation/route.test.ts` (cross-teacher 23505 ×4 + pre-check idempotency) | U |
| REG-129 | `adaptive_remediation_student_lane` | The student-facing surface stays capped, killable, and bilingual. SERVER HALF (`/api/rhythm/today`): flag OFF ⇒ the lane builder short-circuits BEFORE the `adaptive_interventions` read (zero lane I/O proven) and the response carries no `remediation_review` kind — the base Wave 1B queue object is returned untouched (byte-identical kill switch); flag ON ⇒ ≤`max_remediation_cards_per_day` (3) cards even with 5 active interventions, ordered deepest `trigger_snapshot.largestDrop` first via the adapter's EXPORTED `compareBySeverity` (single source of truth with the injection planner; corrupt/null snapshots sort last), 1-based priorities, spliced as a CONTIGUOUS block after the SRS slice with the surrounding base items element-for-element identical to the flag-OFF run; the frozen card contract is exactly `{kind:'remediation_review', subjectCode, chapterNumber, interventionId, priority}`; lane failures (query error OR lane-builder exception) degrade to the base queue at 200 — remediation is an enhancement, never a reason to 500 the daily queue; the lane read goes through the RLS-scoped server client filtered `eq(student_id)` + `eq(status,'active')` (P8 — `adaptive_interventions_student_select` is the boundary). CAPS MATH (adapter): capacity = min(3, 10 − queue size) pinned at 0/1/3-card boundaries, queue 9/10/12, negative-clamp, and NaN fails CLOSED as `queue_full`; the ratified constants themselves are pinned and recovery thresholds are REUSED from `PULSE_THRESHOLDS` (no duplicate constants — guardrail 6). CLIENT HALF (DailyRhythmQueue): warm EN framing + Hindi (P7: "Foxy ने देखा कि अध्याय 4 थोड़ा मुश्किल लगा…", "मज़बूत करो", "प्राथमिकता 1"), canonical `/quiz?subject=&chapter=` deep link with a full-sentence aria-label, no-remediation-kind ⇒ no card with base rows untouched (flag-OFF shape — server-gated, no client flag check), unknown/future kinds never break rendering, malformed cards (missing routing fields) dropped (no dead links), and the CTA analytics payload is PII-free (section/action/destination — no interventionId emitted). TIMELINE COPY (Pulse): variant-aware bilingual lines for the 3 system.* kinds (student encouraging / parent + teacher actionable; icon + accent never colour-alone); the escalated line claims a specific helper ONLY when `escalatedTo` is present — and `escalatedTo` passes the pulse-server whitelist ONLY for `system.remediation_escalated` (value domain teacher/parent; null omitted; the per-kind addition does not leak onto other kinds), while `interventionId`/`teacherAssignmentId` and PII-shaped keys NEVER pass the whitelist (P13). | `src/__tests__/api/rhythm/today-remediation-lane.test.ts` (server half — NEW this PR), `src/__tests__/lib/learn/remediation-queue-adapter.test.ts` (caps + constants), `src/__tests__/components/dashboard/DailyRhythmQueue.remediation.test.tsx` (client half), `src/__tests__/components/pulse/pulse-copy-remediation.test.ts`, `src/__tests__/lib/pulse/pulse-server-whitelist.test.ts` | U |

### Invariants covered by this section

- P7 Bilingual UI — REG-126 (notification house shape carries real Devanagari in
  `data.*_hi`), REG-129 (lane card + pulse timeline copy EN/HI).
- P8 RLS boundary — REG-129 (the student lane reads `adaptive_interventions`
  through the RLS-scoped server client; policies land in the same migration as
  the table per `20260619000200`); REG-128 (teacher route roster scope holds —
  pre-existing pins in the same file remain).
- P13 Data privacy — REG-127 (counts-only worker responses, generic 500 body,
  metadata-only audit), REG-129 (whitelist suppresses row identifiers + PII keys;
  CTA analytics PII-free), REG-126 (notification payloads carry opaque ids +
  academic codes only).
- P-learner-state correctness — REG-126 anchors recovery to affirmative-evidence
  semantics and the adapter to `PULSE_THRESHOLDS` reuse (no threshold drift).
- Operational integrity (REG-118/REG-119 posture) — REG-127 (fail-closed cron
  auth, deny-before-I/O, carrier precedence), REG-126 (Deno trigger stays thin
  and ungated so the kill switch drains).
- OFF-path safety / kill switch — REG-126 (drain, not freeze), REG-129
  (flag-OFF byte-identical queue, zero lane I/O); `ff_adaptive_remediation_v1`
  seeded OFF.

### Catalog total

Pre-2026-06-12: 92 entries. REG-125 (feature_flags seed-shape conformance —
staging-sync wall closure, PR #1014). Phase A Loop A adds REG-126 (closed-loop
state machine), REG-127 (cron worker posture), REG-128 (B2B escalation
attribution), REG-129 (student-facing lane). **Total catalog: 97 entries
(target: 35 — TARGET EXCEEDED).**

**Total: 97 entries.**

## Phase A Loops B & C — Inactivity + At-Risk-Concentration closed loops (2026-06-13) — REG-131..REG-134

Source: `docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md`. Loop B
(inactivity re-engagement) and Loop C (at-risk-concentration escalation) ride
the SAME `adaptive_interventions` substrate as Loop A, share the verify-drain
kill-switch semantics, and add the cross-loop arbiter (the anti-storm core).
Uncommitted scope on `feat/phase-a-loops-bc`: migrations `20260619000500`
(`trigger_signal` CHECK extend to `inactivity`/`at_risk_concentration` +
`chapter_number >= 0` for the Loop B sentinel) / `20260619000600`
(`ff_adaptive_loops_bc_v1` seed, OFF); `src/lib/learn/adaptive-loops-rules.ts`
+ the two backend evaluators; the worker B/C inject+verify branches; 6 new
notification triggers; 6 new `system.*` event kinds; the pulse whitelist
extension; `ff_adaptive_loops_bc_v1`.

> **ID note:** REG-130 is the CI pipeline-alert promotion (PR #1015, above);
> REG-131..134 are the next free ids after Loop A's REG-126..129.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-131 | `adaptive_loops_bc_closed_loop_state_machines` | Loops B & C are independent closed-loop state machines on the SHARED `adaptive_interventions` substrate that cannot double-fire, freeze, or falsely self-resolve, and DRAIN regardless of the flag. LOOP B (inactivity): a `deriveInactivity`-'broken' student opens the reserved sentinel triple (`subject_code='_inactivity'` — passes the lowercase CHECK; `chapter_number=0` — passes the extended `>= 0` CHECK; `trigger_signal='inactivity'`), `verify_by = createdAt + 3 days`, emits `system.engagement_nudged` (idempotencyKey `inactivity:<id>:nudged`) + a nudge notification, with NO queue/card injection and NO teacher row (Decisions B1/B4); one-active-max blocks a second nudge; a 23505 on the sentinel insert is a benign dedupe (no event/notification, `deduped` counted). LOOP B planner gates pinned at their boundaries: trigger-on-'broken'-ONLY (ok/at_risk/never/unknown → `not_broken`), onboarding grace EXCLUSIVE (created exactly 7 days ago is eligible; unparseable created-at degrades to in-grace), nudge cooldown EXCLUSIVE +7d, ceiling deference, and the documented decision precedence (`not_broken` > `onboarding_grace` > `active_exists` > `cooldown` > `ceiling_spent`). LOOP B verify (`evaluateReturn`/`evaluateInactivityReturn`): returned/pending/expired across the rolling-ms window with INCLUSIVE ends; 'expired' fires only STRICTLY after windowEnd; a return at the exact boundary beats same-instant expiry; earliest qualifying return wins; before-nudge/after-window/future observations ignored; malformed record/clock/observations degrade to 'pending' (never a false parent escalation). LOOP C verify (`evaluateConcentrationResolution`): resolved when the LATEST in-window subject snapshot drops below `concentration_high_min` (count 4 resolves, 5 = exactly high_min stays high/pending, 6 pending), a transient mid-window dip that climbs back to high is NOT resolved, malformed → pending. DRAIN, NOT FREEZE: with `ff_adaptive_loops_bc_v1` OFF the verify phase still transitions already-active B & C rows to terminal (returned→recovered, expired→escalate, resolved→recovered, expired→re-notify) — pinned with the flag explicitly OFF, including a mixed A+B+C single-sweep drain. Canonical reuse is structural: the band boundary and window constants are IMPORTED from `PULSE_THRESHOLDS` / `ADAPTIVE_LOOPS_BC_RULES`, never re-typed (guardrail B/C-6; `cooldown > return_window` for Loop B pinned so a just-expired row cannot instantly re-open). | `src/__tests__/lib/learn/adaptive-loops-rules.test.ts`, `src/__tests__/lib/learn/inactivity-return-evaluation.test.ts`, `src/__tests__/lib/learn/concentration-resolution-evaluation.test.ts`, `src/__tests__/api/cron/adaptive-remediation-loops-bc.test.ts` (Loop B inject + verify drain; mixed-loop sweep), `src/__tests__/state/events-registry.test.ts` (6 new `system.*` kinds) | U |
| REG-132 | `adaptive_loops_bc_cross_loop_arbiter` | The cross-loop arbiter enforces the per-student anti-storm ceiling and precedence. CEILING ≤ 1/STUDENT/DAY: `arbitrateInterventions` opens AT MOST `per_student_daily_intervention_ceiling` (=1, pinned) NEW intervention per student per night across A/B/C; with the slot already spent tonight it opens nothing (`ceiling_already_spent`); the ceiling caps NEW opens only — verify-phase transitions on already-open rows are NOT routed through the arbiter, so in-flight loops always drain. PRECEDENCE A > C > B (Decision X3), independent of input order: with A+C+B all eligible exactly ONE row opens and it is the Loop A `mastery_cliff` row (`injectedCliff:1`, `injectedInactivity:0`, `injectedConcentration:0`, exactly one `interventions.insert`); with only C+B eligible the Loop C row wins and B is `ceilingDeferred`; same-loop ties break by descending severity (null/non-finite last) then subjectCode asc then chapterNumber asc (fully deterministic); malformed candidates with an unknown loop id are filtered out. A↔C COEXISTENCE (C-G3): no Loop C row opens for a subject that already has an ACTIVE Loop A (`mastery_cliff`) row on any chapter (`coexists_with_a`), while an active A row in a DIFFERENT subject does not block; the reverse (A injecting into a C-escalated subject) is intentionally allowed and not this module's concern. Per-loop ceiling deference is pinned in BOTH planners (`planInactivityIntervention`/`planConcentrationIntervention` return `ceiling_spent` when a higher-precedence loop already spent the slot). | `src/__tests__/lib/learn/adaptive-loops-rules.test.ts` (arbiter ceiling/precedence/tie-break; A↔C coexistence in `planConcentrationIntervention`; per-loop ceiling deference), `src/__tests__/api/cron/adaptive-remediation-loops-bc.test.ts` (route-level: A+C+B→A only; C+B→C with B deferred; A↔C coexistence skip) | U |
| REG-133 | `adaptive_loops_c_escalate_at_inject_and_reescalation` | Loop C escalates AT INJECT (the escalation IS the intervention) and survives concurrent duplicates. ESCALATE-AT-INJECT: a `deriveAtRiskConcentration`-'high' subject opens the worst-chapter triple (lowest-mastery chapter) with `trigger_signal='at_risk_concentration'`, `verify_by = createdAt + 14 days`, and `escalated_to` SET AT INJECT — B2B (roster teacher present): reuses Loop A's resolver to create a `teacher_remediation_assignments` row, stamps `escalated_to='teacher'` + `teacher_assignment_id`, emits `system.concentration_escalated` (payload carries `escalatedTo`, `teacherAssignmentId`, `atRiskChapterCount`) + an `audit_logs` row whose metadata never matches `/name|email|phone/i` (P13); B2C (no teacher, linked guardian): `escalated_to='parent'`, no assignment insert; neither (no teacher, no guardian): `escalated_to=null`, still event + audit + student notification. NO HALF-ESCALATION: a B2B assignment-insert failure ABORTS before the intervention row is inserted (`injectedConcentration:0`, `errors:1`, zero inserts, no event) so the next run retries cleanly. B2B 23505 DEDUPE: a duplicate-key on the assignment insert links the EXISTING assignment (survivor lookup) and still opens the intervention with `escalated_to='teacher'` + the surviving `teacher_assignment_id`. TWO-BEAT RE-ESCALATION (Decision C4 — re-notify, NOT a 2nd row): on verify, an expired row still in the 'high' band transitions `status='escalated'` WITHOUT inserting a second intervention row, re-flags the existing teacher assignment (bump to 'assigned') on the B2B path, emits `system.concentration_reescalated` + an audit row; the B2C path re-notifies the parent (`escalatedTo='parent'`, no assignment bump). A resolved row (band dropped below high in-window) transitions `status='recovered'` + `system.concentration_resolved`. | `src/__tests__/api/cron/adaptive-remediation-loops-bc.test.ts` (Loop C inject: B2B/B2C/neither, assignment-failure abort, 23505 dedupe; Loop C verify: resolved, expired→re-notify ×2 (B2B re-flag + B2C parent)), `src/__tests__/state/events-registry.test.ts` (`system.concentration_{escalated,resolved,reescalated}` payload shapes) | U |
| REG-134 | `adaptive_loops_b_nudge_verify_flag_gating_and_whitelist` | Loop B's nudge→return→parent-escalation flow, the B/C flag gate, and the P13 escalatedTo whitelist for the three new escalated kinds. LOOP B NUDGE + RETURN VERIFY: returned (genuine in-window activity) → `status='recovered'` + `system.engagement_returned` + `onReEngagementReturned`; expired + linked guardian → `status='escalated'`, `escalated_to='parent'` (NEVER a teacher row — Decision B4), `system.engagement_escalated` + audit + parent notification; expired + no guardian → `escalated_to=null` (ops-visible), student-only; pending (window open, still inactive) → no transition. PER-SIGNAL FLAG GATING (Decision X2 — independent kill switches): `ff_adaptive_loops_bc_v1` OFF ⇒ the B/C inject branches are no-ops (NO inactive-student scan, NO B/C insert) while the `mastery_cliff` branch still respects its OWN `ff_adaptive_remediation_v1` flag; both flags OFF ⇒ inject reports `skipped:'flag_off', injected:0`; B/C ON ⇒ the inactive-student scan runs. The VERIFY phase drains B & C rows even with the flag OFF (gated on active rows, not the flag). NOTIFICATION PRODUCER CONTRACT (the 6 new triggers — direct shape pins, not just the route's mocked calls): house shape (top-level `message`/`body` EN, Hindi Devanagari in `data.title_hi/body_hi/message_hi`, no top-level `body_hi` column — P7), deterministic per-cycle `idempotency_key` upserted `onConflict (recipient_id,type,idempotency_key) ignoreDuplicates`, the day-0 nudge key (`engagement_nudge_<id>_*`) is namespaced distinctly from the at-expiry escalation key (`engagement_escalated_<id>_*`) so a returning student never collides (B4); recipient routing — nudge/returned/resolved → student (nudge ALSO alerts guardians), inactivity-escalated → student always + guardian ONLY on the parent path (never teacher), concentration-escalated → student always + guardian only on parent (teacher rides the assignment, student-only here), concentration-reescalated → parent follow-up ONLY (guardian rows, no student row; teacher/null sends NOTHING); guardian fetch is dual-status (approved|active) + per-guardian preference opt-out; fire-and-forget (DB failure never throws); P13 (no name/email/phone in any payload). ESCALATEDTO WHITELIST (P13): `escalatedTo` passes the pulse-server timeline whitelist for the THREE new kinds (`system.engagement_escalated`, `system.concentration_escalated`, `system.concentration_reescalated`) — value domain teacher/parent, null omitted — exactly as it does for Loop A's `system.remediation_escalated`; the per-kind addition does NOT leak onto other kinds; identifiers (`interventionId`, `teacherAssignmentId`), scheduling internals (`daysSince*`, `verifyBy`), and PII-shaped keys (studentName/email/phone) NEVER pass for any kind. | `src/__tests__/api/cron/adaptive-remediation-loops-bc.test.ts` (Loop B verify: returned/expired-parent/expired-null/pending; per-signal flag gating; verify-drain-with-flag-OFF), `src/__tests__/lib/notification-triggers-loops-bc.test.ts` (NEW this PR — the 6 producer shapes), `src/__tests__/lib/pulse/pulse-server-whitelist.test.ts` (3 new escalated kinds + PII suppression + per-kind scoping) | U |

### Invariants covered by this section

- P7 Bilingual UI — REG-134 (the 6 B/C notification producers carry real
  Devanagari in `data.*_hi`).
- P8 RLS boundary — REG-131/REG-133 (B & C rows ride `adaptive_interventions`,
  whose student/teacher/parent RLS lands in `20260619000200`; the worker uses
  the service-role admin client server-side only).
- P13 Data privacy — REG-133 (metadata-only audit on every C escalation),
  REG-134 (escalatedTo whitelist suppresses identifiers + PII for the 3 new
  kinds; notification payloads carry opaque ids + academic codes only).
- P-learner-state correctness — REG-131 (verdict direction: B return + C
  resolution anchored to affirmative in-window evidence; ambiguity/corruption
  degrades to pending, never a false recovery/escalation).
- Anti-storm / operational integrity — REG-132 (≤1 new intervention per
  student per day, A>C>B precedence, A↔C coexistence).
- OFF-path safety / kill switch — REG-131 + REG-134 (drain, not freeze:
  `ff_adaptive_loops_bc_v1` OFF ⇒ no B/C inject but verify still drains
  in-flight rows to terminal).

### Catalog total

Pre-2026-06-13: 97 entries (Phase A Loop A through REG-129). REG-130
(CI pipeline-failure alerting, retroactively promoted from PR #1015). Phase A
Loops B & C add REG-131 (B/C closed-loop state machines + drain), REG-132
(cross-loop arbiter — ceiling + precedence + A↔C coexistence), REG-133 (Loop C
escalate-at-inject + two-beat re-escalation + B2B/B2C + 23505 dedupe), REG-134
(Loop B nudge/return/parent-escalation + flag gating + notification producers +
escalatedTo whitelist). **Total catalog: 102 entries (target: 35 — TARGET
EXCEEDED).**

**Total: 102 entries.**

## Digital Twin + Knowledge Graph (Slice 1, Waves 1-2) — flag-gated learner twin + Loop D blocked-prerequisite (2026-07-02) — REG-175

Source: Slice 1 (Digital Twin + Knowledge Graph). Additive migrations
`20260702000100..000800` (concept_edges unifying 3 prereq models + transfer
edges; learner_twin_snapshots; learner_twin_memory vector(1024); RPCs
traverse_prerequisites + detect_blocked_dependents; backward-compatible
extensions to detect_knowledge_gaps / generate_learning_path; `ff_digital_twin_v1`
seed default-OFF; trigger_signal CHECK widened to allow `blocked_prerequisite`).
Pure modules: `src/lib/learn/adaptive-loops-rules.ts`
(BLOCKED_PREREQUISITE_RULES, Loop 'D', precedence A>D>C>B,
classifyPrerequisiteBlock, planBlockedPrerequisiteIntervention),
`src/lib/learn/build-twin-context.ts` (buildTwinContext / renderTwinPromptSection),
Edge reader `supabase/functions/grounded-answer/_twin-flag.ts`
(isDigitalTwinEnabled). Everything ships behind the default-OFF
`ff_digital_twin_v1` flag.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-175 | `digital_twin_block_classifier_arbiter_twin_context_flag_off` | **classifyPrerequisiteBlock boundaries (A):** rules reuse the platform floors (mastery 0.4 = `PULSE_THRESHOLDS.at_risk_mastery`, decay 0.5 = shouldRetest line); EXACTLY at mastery 0.4 → NOT blocked; just below (0.39) → `'mastery'`; EXACTLY at decay 0.5 (`predictRetention(ln2,1) === 0.5`, strict `<`) → NOT blocked; just over → `'decay'`; both axes low → `'both'` with `deficit = max(masteryDeficit, decayDeficit)` (most severe ≥ either single axis); unevaluable (no p_know AND no recency) → NOT blocked; null input never throws. **Arbiter precedence A>D>C>B + ceiling=1 (B):** a Loop D candidate LOSES to A, BEATS C, BEATS B; full A,D,C,B field → A wins, remove A → D wins, order-independent; `alreadyOpenedTonight=true` → NOTHING opens (`ceiling_already_spent`); empty set → `no_candidates`; planner defers with `ceiling_spent`/null candidate when slot spent. **buildTwinContext purity + NO PII (C):** identical inputs → byte-identical output (deep + JSON equal); floors from BLOCKED_PREREQUISITE_RULES (weak < 0.4, decayed < 0.5); junk name/email/phone fields forced into raw input NEVER leak (`!/name\|email\|phone/i`); render surfaces COUNTS+CODES only, never raw topic UUIDs; empty/all-filtered snapshot → `isEmpty` and render === `''` (OFF-path identity). **Flag-OFF gating (D):** registry/DB default OFF; the worker gate replica yields ZERO Loop D candidates when the flag is OFF (→ arbiter `no_candidates`) even though the same input WOULD open with the gate on. | `src/__tests__/regressions/reg-175-digital-twin-knowledge-graph.test.ts` (28) + `src/__tests__/lib/digital-twin-flag-off-identity.test.ts` (12 — FLAG_DEFAULTS OFF + `isDigitalTwinEnabled` fail-CLOSED + 60s TTL cache) | U (pure functions + fake-sb Edge reader; no live DB) |

### Invariants covered by this section

- P5 Grade format — Loop D never touches grade; chapter numbers are integers,
  subject codes are strings (the `_inactivity` sentinel triple is unaffected).
- P8 RLS boundary — the twin substrate (concept_edges, learner_twin_snapshots,
  learner_twin_memory) ships RLS in its own additive migrations; the
  detect_blocked_dependents RPC is parameterized, not a client table read.
  (Pure-module tests here pin the in-process logic; RLS is integration-lane.)
- P12 AI safety — `buildTwinContext` emits IDs/numbers/codes only and
  `renderTwinPromptSection` instructs Foxy to use signals to shape HOW it
  teaches and never read them aloud; the transfer-retrieval widening is
  fail-CLOSED behind `ff_digital_twin_v1`.
- P13 Data privacy — buildTwinContext is an allow-list reader: no name/email/
  phone reaches the prompt context or the rendered block, even when PII-shaped
  junk rides along on a raw row.
- Flag-gate safety — `ff_digital_twin_v1` defaults OFF in the registry
  (FLAG_DEFAULTS) and the Edge reader fail-CLOSEs on a missing row, a non-true
  value, or any thrown error; Loop D contributes zero candidates when OFF.

### Notes on ID assignment

REG-175 is the next free id after REG-174 (REG-170 remains the intentionally
skipped gap documented in the prior section). Slice 1 occupies the single id
REG-175 with two asserting files (the regression pins + the flag-off identity
pins), matching the REG-124/REG-134 precedent of co-locating a flag-default-OFF
pin with the feature's behavioral pins.

### Catalog total

Pre-REG-175: 141 entries (through Today's Mission five-issue fix, REG-174).
Digital Twin + Knowledge Graph Slice 1 adds REG-175: prerequisite-block
classifier boundaries + cross-loop arbiter precedence A>D>C>B + buildTwinContext
purity/PII + flag-OFF gating (28 tests) plus the flag-off identity pins (12
tests). 40 tests across 2 files.
**Total catalog: 142 entries (target: 35 — TARGET EXCEEDED).** *(Superseded:
REG-176 brought this to 143 and Engineering-Audit Cycle 1's REG-177 to 144 —
see the authoritative running count in the final "Catalog total" block below.)*

**Total: 141 entries.**

---

