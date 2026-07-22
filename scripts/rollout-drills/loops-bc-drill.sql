-- ============================================================================
-- STAGING ONLY — NEVER RUN AGAINST PRODUCTION.
-- ============================================================================
-- Loops B (inactivity) + C (at-risk-concentration) + cross-loop ceiling drill.
--
-- Grounded verbatim in docs/runbooks/adaptive-program-rollout.md
--   §4.B Loop B (lines 143-213), §4.C Loop C (lines 215-278),
--   §4.D cross-loop ceiling (lines 280-286), §4.E cleanup (lines 287-297).
-- Thresholds grounded in ADAPTIVE_LOOPS_BC_RULES
--   (packages/lib/src/learn/adaptive-loops-rules.ts) and PULSE_THRESHOLDS
--   (packages/lib/src/pulse/signals.ts):
--     inactivity_return_window_days = 3   (Loop B verify window)
--     onboarding_grace_days         = 7   (never nudge accounts < 7 days old)
--     concentration_high_min        = 5   (Loop C 'high' band = >= 5 chapters < 0.4)
--     concentration_return_window_days = 14 (Loop C verify window)
--     per_student_daily_intervention_ceiling = 1, precedence A > C > B
--
-- HARD PRECONDITION: ff_event_bus_v1 must resolve ON on staging, else verify is
--   BLIND and every drill falsely expires to escalation (runbook §2, lines 52-84).
--
-- HOW TO RUN: phase by phase; fire the worker from a second terminal between
--   phases. Keep ONE psql session so \set params persist. The three drills
--   (Loop B, Loop C, ceiling) are independent — run them in separate sittings
--   and CLEAN UP between them so a leftover active row does not distort the next.
--
-- PARAMETERS:
--   :test_student_id  = students.id of a clearly-marked staging test account
--   :intervention_id  = the adaptive_interventions.id printed by each drill's
--                        inject-verify step (set with \set after you read it)
--   :teacher_assignment_id = printed only on a Loop C B2B teacher escalation
-- ============================================================================

\set test_student_id  '00000000-0000-0000-0000-000000000000'
-- Defaults so cleanup phases never error on an unset psql variable. Overwrite
-- :intervention_id after each drill's inject-verify, :teacher_assignment_id on a
-- Loop C B2B escalation, and :auth_user_id (test account's auth_user_id) before
-- the ceiling drill. The sentinel is a valid UUID that matches no real row.
\set intervention_id       'ffffffff-ffff-ffff-ffff-ffffffffffff'
\set teacher_assignment_id 'ffffffff-ffff-ffff-ffff-ffffffffffff'
\set auth_user_id          '11111111-1111-1111-1111-111111111111'

-- ── SAFETY GUARD: confirm you are on staging. ───────────────────────────────
\echo '>>> Connected database / user / host (MUST be staging):'
SELECT current_database() AS db, current_user AS usr, inet_server_addr() AS host;
\echo '>>> If not STAGING, STOP NOW.'

-- ── PRECONDITION CHECK: the event bus must resolve ON on staging. ────────────
SELECT flag_name, is_enabled, rollout_percentage FROM feature_flags
WHERE flag_name = 'ff_event_bus_v1';
-- expect: is_enabled=true AND rollout_percentage=100 (NOT 0). If rollout=0,
--   clear the §2 blocker first (see README / adaptive-program-rollout.md §2).


-- ============================================================================
-- PHASE 0 — enable the Loops B/C flag on STAGING ONLY.
--   Runbook §3 Stage 1 (lines 104-108); one flag gates BOTH B and C.
--   Confirm the staging env string (VERCEL_ENV || NODE_ENV) is in the array,
--   else inject stays off silently. Wait out the 5-minute cache TTL.
-- ============================================================================
UPDATE feature_flags
SET is_enabled = true,
    rollout_percentage = 100,
    target_environments = ARRAY['staging']::text[],
    updated_at = now()
WHERE flag_name = 'ff_adaptive_loops_bc_v1';

SELECT flag_name, is_enabled, rollout_percentage, target_environments
FROM feature_flags WHERE flag_name = 'ff_adaptive_loops_bc_v1';


-- ############################################################################
-- ## DRILL 1 — LOOP B: inactivity -> nudge -> return / parent-escalation
-- ##   Runbook §4.B (lines 143-213).
-- ####################################################

-- ── B1 — back-date last activity so inactivity.verdict = 'broken'. ──────────
--   Runbook Step B1 (lines 147-158). 'broken' = last active 2+ UTC days ago
--   with no streak freeze (deriveInactivity returns 'broken' at >= 2 days).
--   3 days back is comfortably 'broken'. Guardrails that must ALSO hold:
--     - no active streak freeze (hasStreakFreeze=false), and
--     - students.created_at OLDER than onboarding_grace_days (7) — Loop B never
--       nudges an account younger than 7 days (guardrail B-G6, line 158).
UPDATE student_learning_profiles
SET last_active = now() - interval '3 days', updated_at = now()
WHERE student_id = :'test_student_id';
-- (If your staging reads last_active from `students` too, back-date there as well.)

-- >>> NOW fire the worker: curl ... -d '{"phase":"inject"}'

-- ── B2 — verify the inactivity row (sentinel triple). ───────────────────────
--   Runbook Step B2 (lines 160-178).
SELECT id, subject_code, chapter_number, trigger_signal, status, verify_by, trigger_snapshot
FROM adaptive_interventions
WHERE student_id = :'test_student_id' AND trigger_signal = 'inactivity'
ORDER BY created_at DESC LIMIT 1;
-- expect: subject_code='_inactivity', chapter_number=0, status='active',
--   verify_by = created_at + 3 days (inactivity_return_window_days),
--   trigger_snapshot carries { daysSinceActive, hadStreakFreeze, evaluatedAtIso, rulesVersion }.
-- >>> \set intervention_id '<the printed id>'

SELECT type, recipient_type, idempotency_key FROM notifications
WHERE idempotency_key LIKE 'engagement_nudge_%' ORDER BY created_at DESC LIMIT 5;
-- expect: one ..._student (encouraging, day-0 tone) + (if a guardian is linked)
--   one ..._<guardian_id>, preference-gated.
-- Also (manual): GET /api/rhythm/today must be UNCHANGED — Loop B is queue-less,
--   no remediation_review card is added (line 172). Toggle Hindi (P7).

-- ── B3 (branch RETURNED) — a genuine return inside the 3-day window. ─────────
--   Runbook Step B3 (lines 180-187). Must be a real session/quiz return, NOT a
--   streak freeze-bump (the backend filters freeze-bumps out; spec §12-B).
UPDATE student_learning_profiles SET last_active = now(), updated_at = now()
WHERE student_id = :'test_student_id';   -- inside [created_at, verify_by]
-- >>> NOW fire the worker: curl ... -d '{"phase":"verify"}'
SELECT id, status, resolved_at FROM adaptive_interventions WHERE id = :'intervention_id';
-- expect: status='recovered', resolved_at set; system.engagement_returned event
--   (only if bus ON) + optional celebratory notification.
--   To then run the ESCALATION branch, CLEAN UP (Loop B cleanup below) and
--   re-run B1-B2 — the 7-day nudge cooldown (nudge_cooldown_days) blocks a fresh
--   inactivity row for a week after this terminal one.

-- ── B4 (branch ESCALATED -> PARENT) — no return, window elapses. ────────────
--   Runbook Step B4 (lines 189-213). Do NOT advance last_active. Keep
--   verify_by > created_at or the worker falls back to the canonical window.
UPDATE adaptive_interventions
SET verify_by = now() - interval '1 minute'
WHERE id = :'intervention_id' AND status = 'active';
-- >>> NOW fire the worker: curl ... -d '{"phase":"verify"}'

SELECT status, escalated_to, teacher_assignment_id
FROM adaptive_interventions WHERE id = :'intervention_id';
-- expect: status='escalated', escalated_to='parent' (or NULL if no guardian),
--   teacher_assignment_id IS NULL ALWAYS — Loop B NEVER routes to a teacher
--   (Decision B4, line 199).

SELECT type, recipient_type, idempotency_key FROM notifications
WHERE idempotency_key LIKE 'engagement_escalated_%' ORDER BY created_at DESC LIMIT 5;
-- expect: CONCERNED-tone parent alert, distinct idempotency key from the day-0 nudge.

SELECT action, details FROM audit_logs
WHERE action = 'system.engagement_escalated' ORDER BY created_at DESC LIMIT 3;
-- bus-independent; details carry UUIDs + derived metrics only (P13).

-- ── Loop B cleanup (scoped; safe to re-run). ────────────────────────────────
DELETE FROM adaptive_interventions
 WHERE student_id = :'test_student_id' AND trigger_signal = 'inactivity';
DELETE FROM notifications
 WHERE idempotency_key LIKE 'engagement_%';
-- restore last_active so the student is no longer 'broken' for the next drill:
UPDATE student_learning_profiles SET last_active = now(), updated_at = now()
 WHERE student_id = :'test_student_id';


-- ####################################################################
-- ## DRILL 2 — LOOP C: at-risk-concentration -> escalate -> resolve / re-notify
-- ##   Runbook §4.C (lines 215-278).
-- ####################################################

-- ── C1 — seed 5+ at-risk chapters (mastery < 0.4) in ONE subject. ───────────
--   Runbook Step C1 (lines 219-235). >= concentration_high_min (5) chapters
--   below at_risk_mastery (0.4) buckets deriveAtRiskConcentration to 'high'.
--   Chapter 4 has the lowest mastery -> becomes the "worst" chapter.
--   Precondition: NO active Loop A (mastery_cliff) row for 'science', else the
--   A<->C coexistence guardrail (C-G3) skips the Loop C injection (line 234).
--   NOTE: real subject 'science' is used deliberately so the B2B teacher
--   resolver can subject-match. Adjust table/columns to your learner_mastery
--   shape on staging (line 224).
INSERT INTO learner_mastery (student_id, subject_code, chapter_number, mastery, updated_at)
VALUES
  (:'test_student_id','science', 1, 0.20, now()),
  (:'test_student_id','science', 2, 0.25, now()),
  (:'test_student_id','science', 3, 0.30, now()),
  (:'test_student_id','science', 4, 0.18, now()),  -- lowest -> worst chapter
  (:'test_student_id','science', 5, 0.35, now())
ON CONFLICT (student_id, subject_code, chapter_number)
DO UPDATE SET mastery = EXCLUDED.mastery, updated_at = now();

-- >>> NOW fire the worker: curl ... -d '{"phase":"inject"}'

-- ── C2 — verify the row (escalates IMMEDIATELY at inject). ──────────────────
--   Runbook Step C2 (lines 237-259). The escalation IS the intervention
--   (Decision C1): the row opens 'active' with escalated_to already set.
SELECT id, subject_code, chapter_number, trigger_signal, status, escalated_to,
       teacher_assignment_id, verify_by, trigger_snapshot
FROM adaptive_interventions
WHERE student_id = :'test_student_id' AND trigger_signal = 'at_risk_concentration'
ORDER BY created_at DESC LIMIT 1;
-- expect: subject_code='science', chapter_number=4 (worst — lowest mastery),
--   status='active', escalated_to IN ('teacher','parent',NULL) SET AT INJECT,
--   verify_by = created_at + 14 days (concentration_return_window_days),
--   trigger_snapshot = { atRiskChapterCount>=5, worstChapterMastery,
--                        bandAtTrigger:'high', ... }.
-- >>> \set intervention_id '<the printed id>'
--   Escalation branches (reuse Loop A's resolveEscalationTarget):
--     B2B teacher  -> escalated_to='teacher', teacher_assignment_id NOT NULL,
--                     a teacher_remediation_assignments row exists.
--     B2C parent   -> escalated_to='parent',  teacher_assignment_id NULL.
--     none         -> escalated_to=NULL, student-only.

SELECT action, details FROM audit_logs
WHERE action = 'system.concentration_escalated' ORDER BY created_at DESC LIMIT 3;

-- ── C3 (branch RESOLVED) — band drops below 'high'. ─────────────────────────
--   Runbook Step C3 (lines 261-268). Raise 2 chapters out of at-risk so the
--   subject's at-risk count is 3 (< concentration_high_min 5) -> band 'medium'.
UPDATE learner_mastery SET mastery = 0.70, updated_at = now()
WHERE student_id = :'test_student_id' AND subject_code = 'science'
  AND chapter_number IN (1,2);
-- >>> NOW fire the worker: curl ... -d '{"phase":"verify"}'
SELECT id, status, resolved_at FROM adaptive_interventions WHERE id = :'intervention_id';
-- expect: status='recovered', resolved_at set; system.concentration_resolved.
--   (For the re-notify branch instead, DO NOT run C3 — go straight to C4 with the
--    subject still 'high'. If you already ran C3, revert chapters 1,2 to < 0.4.)

-- ── C4 (branch RE-NOTIFY) — still 'high' at expiry. ─────────────────────────
--   Runbook Step C4 (lines 270-278). Keep the subject 'high' (revert C3 first if
--   needed), fast-forward, verify. Keep verify_by > created_at.
UPDATE learner_mastery SET mastery = 0.20, updated_at = now()
WHERE student_id = :'test_student_id' AND subject_code = 'science'
  AND chapter_number IN (1,2);   -- revert so count is back to >= 5 (still 'high')
UPDATE adaptive_interventions SET verify_by = now() - interval '1 minute'
WHERE id = :'intervention_id' AND status = 'active';
-- >>> NOW fire the worker: curl ... -d '{"phase":"verify"}'
SELECT id, status, escalated_to FROM adaptive_interventions WHERE id = :'intervention_id';
-- expect: status='escalated' (two-beat: the human handoff is now the durable
--   owner). NOT a second adaptive_interventions row (Decision C4). Teacher path
--   re-flags the existing assignment (idempotent); parent path sends a follow-up
--   alert (idempotency key concentration:<id>:reescalated); none -> ops event.
SELECT action, details FROM audit_logs
WHERE action = 'system.concentration_reescalated' ORDER BY created_at DESC LIMIT 3;

-- ── Loop C cleanup (scoped; safe to re-run). ────────────────────────────────
DELETE FROM adaptive_interventions
 WHERE student_id = :'test_student_id' AND trigger_signal = 'at_risk_concentration';
DELETE FROM teacher_remediation_assignments
 WHERE student_id = :'test_student_id' AND id = :'teacher_assignment_id';
DELETE FROM notifications WHERE idempotency_key LIKE 'concentration_%';
DELETE FROM learner_mastery
 WHERE student_id = :'test_student_id' AND subject_code = 'science'
   AND chapter_number IN (1,2,3,4,5);


-- ####################################################################
-- ## DRILL 3 — CROSS-LOOP CEILING (anti-storm): A > C > B, <= 1 new row/night
-- ##   Runbook §4.D (lines 280-286).
-- ####################################################
-- Trip A + C + B for the SAME student in one run and confirm exactly ONE new
-- row opens, by precedence A > C > B (Decision X3;
-- per_student_daily_intervention_ceiling = 1).
--
-- Seed all three signals for :test_student_id:
--   A: a mastery-cliff — insert the state_events cliff event from
--      loop-a-remediation-drill.sql PHASE 1 (drop 0.65 -> 0.45 on chapter 99).
--      REQUIRES :auth_user_id — \set it here too.
\set auth_user_id '11111111-1111-1111-1111-111111111111'
INSERT INTO public.state_events
  (event_id, kind, actor_auth_user_id, tenant_id, idempotency_key, occurred_at, payload)
VALUES (
  gen_random_uuid(), 'learner.mastery_changed', :'auth_user_id', NULL,
  'drill_adaptive_ceiling_cliff_' || to_char(now(),'YYYYMMDDHH24MISS'),
  now() - interval '1 hour',
  jsonb_build_object('subjectCode','math','chapterNumber',99,'fromMastery',0.65,'toMastery',0.45)
);
--   C: a 'high'-band subject — reuse the DRILL 2 / C1 INSERT (science chapters 1-5).
INSERT INTO learner_mastery (student_id, subject_code, chapter_number, mastery, updated_at)
VALUES
  (:'test_student_id','science', 1, 0.20, now()),
  (:'test_student_id','science', 2, 0.25, now()),
  (:'test_student_id','science', 3, 0.30, now()),
  (:'test_student_id','science', 4, 0.18, now()),
  (:'test_student_id','science', 5, 0.35, now())
ON CONFLICT (student_id, subject_code, chapter_number)
DO UPDATE SET mastery = EXCLUDED.mastery, updated_at = now();
--   B: 'broken' inactivity — reuse the DRILL 1 / B1 back-date.
UPDATE student_learning_profiles
SET last_active = now() - interval '3 days', updated_at = now()
WHERE student_id = :'test_student_id';

-- >>> NOW fire the worker ONCE: curl ... -d '{"phase":"inject"}'

-- Assert exactly ONE new active row opened tonight, and it is Loop A (A wins):
SELECT trigger_signal, status, count(*)
FROM adaptive_interventions
WHERE student_id = :'test_student_id'
  AND created_at >= date_trunc('day', now())
GROUP BY trigger_signal, status;
-- expect: exactly ONE row, trigger_signal='mastery_cliff', status='active'.
--   C and B are skipped tonight (their signals persist; they re-evaluate next
--   night). Verify-phase transitions on already-open rows are NOT ceiling-capped
--   (line 285).

SELECT student_id, date_trunc('day', created_at) AS day, count(*) AS new_rows
FROM adaptive_interventions
WHERE student_id = :'test_student_id'
GROUP BY 1,2 HAVING count(*) > 1;
-- expect: ZERO rows (the <= 1-new-row-per-student-per-day ceiling holds).


-- ============================================================================
-- FINAL CLEANUP (all drills) — sentinel-scoped; always safe to re-run.
--   Runbook §4.E (lines 287-297).
-- ============================================================================
DELETE FROM adaptive_interventions
 WHERE student_id = :'test_student_id'
   AND (chapter_number IN (99, 0)
        OR trigger_signal IN ('inactivity','at_risk_concentration','mastery_cliff'));
DELETE FROM teacher_remediation_assignments
 WHERE student_id = :'test_student_id' AND id = :'teacher_assignment_id';
DELETE FROM notifications
 WHERE idempotency_key LIKE 'remediation_%'
    OR idempotency_key LIKE 'engagement_%'
    OR idempotency_key LIKE 'concentration_%';
DELETE FROM state_events WHERE idempotency_key LIKE 'drill_%';
DELETE FROM learner_mastery
 WHERE student_id = :'test_student_id' AND subject_code = 'science'
   AND chapter_number IN (1,2,3,4,5);
-- restore the test student's last_active to a sane baseline:
UPDATE student_learning_profiles SET last_active = now(), updated_at = now()
 WHERE student_id = :'test_student_id';

-- Verify nothing was left behind:
SELECT count(*) AS leftover_rows FROM adaptive_interventions
 WHERE student_id = :'test_student_id'
   AND (chapter_number IN (99,0) OR trigger_signal IN ('inactivity','at_risk_concentration','mastery_cliff'));
SELECT count(*) AS leftover_drill_events FROM state_events
 WHERE idempotency_key LIKE 'drill_%';
-- expect: both 0.

-- ── OPTIONAL: return the flag to seeded-OFF on staging after drilling ────────
-- UPDATE feature_flags SET is_enabled = false, rollout_percentage = 0,
--        target_environments = NULL, updated_at = now()
-- WHERE flag_name = 'ff_adaptive_loops_bc_v1';
</content>
