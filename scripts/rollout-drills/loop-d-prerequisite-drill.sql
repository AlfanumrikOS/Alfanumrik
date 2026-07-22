-- ============================================================================
-- STAGING ONLY — NEVER RUN AGAINST PRODUCTION.
-- ============================================================================
-- Loop D (Digital Twin + Knowledge Graph, Slice 1) — blocked-prerequisite drill
-- + the A > D > C > B precedence-ceiling drill.
--
-- Grounded verbatim in docs/runbooks/digital-twin-rollout.md
--   §"Staging synthetic blocked-prerequisite drill" (Steps 0-7, lines 71-196)
--   and §Step 6 A>D>C>B ceiling (lines 180-187).
-- Thresholds grounded in BLOCKED_PREREQUISITE_RULES + classifyPrerequisiteBlock
--   (packages/lib/src/learn/adaptive-loops-rules.ts) and the verify evaluator
--   evaluateBlockedPrerequisiteResolution
--   (packages/lib/src/learn/blocked-prerequisite-verify-evaluation.ts):
--     mastery_floor      = 0.4  (PULSE_THRESHOLDS.at_risk_mastery) — p_know floor
--     decay_floor        = 0.5  (cognitive-engine shouldRetest) — predictRetention floor
--     return_window_days = 7    (single-chapter recovery, mirrors Loop A)
--     cooldown_days      = 7    (per-subject)
--     precedence A > D > C > B  (LOOP_PRECEDENCE = { A:0, D:1, C:2, B:3 })
--   blockReason 'both' fires when the prerequisite is below BOTH floors
--     (classifyPrerequisiteBlock: masteryLow && decayLow -> 'both').
--
-- BUS CAVEAT (narrower than A/B/C): Loop D VERIFY reads LIVE concept_mastery, so
--   it is NOT blinded when ff_event_bus_v1 is OFF (runbook line 67). Only the
--   system.prerequisite_resolved event publish is bus-gated; audit_logs +
--   adaptive_interventions are bus-independent.
--
-- HOW TO RUN: phase by phase; fire the worker from a second terminal between
--   phases. Keep ONE psql session so \set params persist.
--
-- PARAMETERS:
--   :test_student_id   = students.id of a clearly-marked staging test account
--   :prereq_topic_id   = a curriculum topic id (the PREREQUISITE) for the
--                        student's grade/subject
--   :dependent_topic_id= a curriculum topic id (the DEPENDENT/advanced topic)
--   :intervention_id   = the adaptive_interventions.id printed by PHASE 3
-- ============================================================================

\set test_student_id    '00000000-0000-0000-0000-000000000000'
\set prereq_topic_id    '22222222-2222-2222-2222-222222222222'
\set dependent_topic_id '33333333-3333-3333-3333-333333333333'
-- Defaults so cleanup never errors on an unset psql variable. Overwrite
-- :intervention_id after PHASE 2, and :auth_user_id (test account's
-- auth_user_id) before the PHASE 5 ceiling drill. Sentinel = valid UUID, no match.
\set intervention_id    'ffffffff-ffff-ffff-ffff-ffffffffffff'
\set auth_user_id       '11111111-1111-1111-1111-111111111111'

-- ── SAFETY GUARD: confirm you are on staging. ───────────────────────────────
\echo '>>> Connected database / user / host (MUST be staging):'
SELECT current_database() AS db, current_user AS usr, inet_server_addr() AS host;
\echo '>>> If not STAGING, STOP NOW.'

-- ── PREREQUISITE-STATE CHECK (runbook lines 39-60): the graph + twin must exist.
SELECT edge_type, count(*) FROM concept_edges GROUP BY edge_type;
-- expect a nonzero 'prerequisite' count (seed 20260703000100).
SELECT count(DISTINCT student_id) AS students_with_twin FROM learner_twin_snapshots;
-- expect > 0 (the twin builder has run); with no snapshots Loop D never fires.


-- ============================================================================
-- PHASE 0 — enable the Loop D flag on STAGING ONLY.
--   Runbook Step 0 (lines 75-84). Confirm the staging env string
--   (VERCEL_ENV || NODE_ENV) is in the array. Wait out the 5-minute cache TTL.
--   NOTE: ff_digital_twin_v1 is a PROTECTED flag — prefer the super-admin
--   console (protected-flag flip procedure). SQL below is break-glass only.
-- ============================================================================
UPDATE feature_flags
SET is_enabled = true,
    rollout_percentage = 100,
    target_environments = ARRAY['staging']::text[],
    updated_at = now()
WHERE flag_name = 'ff_digital_twin_v1';

SELECT flag_name, is_enabled, rollout_percentage, target_environments
FROM feature_flags WHERE flag_name = 'ff_digital_twin_v1';


-- ============================================================================
-- PHASE 1 — seed a prerequisite edge + a weak-prerequisite twin snapshot.
--   Runbook Step 1 (lines 86-115).
-- ============================================================================
-- 1a. Prerequisite edge: prereq -> dependent (edge_type='prerequisite'). The
--     source='drill' sentinel makes cleanup unambiguous.
INSERT INTO concept_edges (from_topic_id, to_topic_id, edge_type, strength, source)
VALUES (:'prereq_topic_id', :'dependent_topic_id', 'prerequisite', 0.9, 'drill')
ON CONFLICT DO NOTHING;

-- 1b. Latest twin snapshot with the prerequisite weak. mastery 0.20 < 0.4 floor
--     AND decay_state 0.30 < 0.5 floor -> classifyPrerequisiteBlock returns
--     blockReason='both' (the most severe block). detect_blocked_dependents
--     reads mastery_by_topic + decay_state from the MOST RECENT snapshot_date row.
INSERT INTO learner_twin_snapshots (student_id, snapshot_date, mastery_by_topic, decay_state)
VALUES (
  :'test_student_id', now(),
  jsonb_build_object(:'prereq_topic_id', 0.20),   -- below mastery_floor (0.4)
  jsonb_build_object(:'prereq_topic_id', 0.30)    -- below decay_floor (0.5) too -> 'both'
);

-- 1c. Make the DEPENDENT topic count as "actively attempted" (dependentIsActive
--     gate) — a concept_mastery touch within the last 14 days
--     (LOOP_D_DEPENDENT_ACTIVE_DAYS). Runbook lines 107-113.
INSERT INTO concept_mastery (student_id, topic_id, p_know, last_attempted_at)
VALUES (:'test_student_id', :'dependent_topic_id', 0.35, now())
ON CONFLICT (student_id, topic_id) DO UPDATE SET last_attempted_at = now();

-- Precondition (runbook line 115): NO active Loop A/C row for this subject and
-- NO active Loop D row for this (subject, dependent chapter), else the arbiter's
-- precedence / one-active-max gate pre-empts the drill.

-- >>> NOW fire the worker: curl ... -d '{"phase":"inject"}'
-- expect: inject.injectedBlockedPrereq: 1. (skipped:"flag_off" => ALL of A/B/C/D
--   flags are off — recheck PHASE 0. A second identical call => deduped: 1,
--   the partial unique index on (student, subject, chapter) backstop.)


-- ============================================================================
-- PHASE 2 — verify the intervention row + audit.
--   Runbook Step 3 (lines 128-147).
-- ============================================================================
SELECT id, student_id, subject_code, chapter_number, trigger_signal, status, verify_by, trigger_snapshot
FROM adaptive_interventions
WHERE student_id = :'test_student_id' AND trigger_signal = 'blocked_prerequisite'
ORDER BY created_at DESC LIMIT 1;
-- expect: status='active'; chapter_number = the DEPENDENT chapter;
--   verify_by = created_at + 7 days (return_window_days);
--   trigger_snapshot carries { prereqChapterNumber, prereqMastery, prereqDecay,
--     blockReason:'both', edgeStrength, edgeSource, rulesVersion:'loop-d-v1' }.
-- >>> \set intervention_id '<the printed id>'

SELECT action, resource_id, details FROM audit_logs
WHERE action = 'system.blocked_prerequisite_injected'
ORDER BY created_at DESC LIMIT 1;
-- details (jsonb) = subject_code, dependent_chapter, prereq_chapter, block_reason,
--   edge_source, verify_by, rules_version — UUIDs/codes only, no PII (P13).
-- NOTE: Loop D inject writes ONLY an audit row (no state_events publish at
--   inject) — do not look for a system.prerequisite_* event at this stage (line 147).


-- ============================================================================
-- PHASE 3 (branch RECOVERED) — prerequisite recovers in-window.
--   Runbook Step 4 (lines 149-160). Loop D verify re-checks LIVE concept_mastery,
--   so update the PREREQUISITE's own concept_mastery row (not the snapshot).
--   p_know 0.75 >= mastery_floor 0.4 AND a fresh last_practiced/last_attempted
--   lifts predictRetention >= decay_floor 0.5 -> classifyPrerequisiteBlock
--   returns blocked=false -> 'resolved'. RUN THIS ONLY for the recovered branch.
-- ============================================================================
INSERT INTO concept_mastery (student_id, topic_id, p_know, last_practiced_at, last_attempted_at)
VALUES (:'test_student_id', :'prereq_topic_id', 0.75, now(), now())
ON CONFLICT (student_id, topic_id)
DO UPDATE SET p_know = 0.75, last_practiced_at = now(), last_attempted_at = now();

-- >>> NOW fire the worker: curl ... -d '{"phase":"verify"}'
-- expect: verify.recovered: 1.
SELECT id, status, resolved_at FROM adaptive_interventions WHERE id = :'intervention_id';
-- expect: status='recovered', resolved_at set.
SELECT action, resource_id, details FROM audit_logs
WHERE action = 'system.prerequisite_resolved' ORDER BY created_at DESC LIMIT 1;
-- expect: a system.prerequisite_resolved audit row (always); the matching
--   state_events publish appears only if ff_event_bus_v1 is ON.
--   To then run the ESCALATION branch, re-run PHASE 1-2 with a DIFFERENT
--   dependent chapter (the 7-day per-subject cooldown blocks the same subject —
--   line 160).


-- ============================================================================
-- PHASE 4 (branch ESCALATED) — prerequisite never recovers, window elapses.
--   Runbook Step 5 (lines 162-178). Leave the prerequisite WEAK (do NOT raise
--   its mastery). Keep verify_by > created_at, else the worker falls back to the
--   canonical 7 days.
-- ============================================================================
UPDATE adaptive_interventions
SET verify_by = now() - interval '1 minute'
WHERE id = :'intervention_id' AND status = 'active';

-- >>> NOW fire the worker: curl ... -d '{"phase":"verify"}'
-- expect: verify.escalated: 1.
SELECT id, status, resolved_at FROM adaptive_interventions WHERE id = :'intervention_id';
-- expect: status='escalated', resolved_at set.
--
-- SLICE-1 EXPECTATION (line 173, 20-21, 173): 'escalated' is a DURABLE TERMINAL
--   STATE, NOT a live human handoff. Loop D has NO teacher/parent notification
--   channel in Slice 1. Confirm NOTHING was sent:
SELECT count(*) AS loop_d_teacher_assignments FROM teacher_remediation_assignments
WHERE student_id = :'test_student_id';
-- expect: 0 rows attributable to this intervention (Loop D writes none).
SELECT count(*) AS loop_d_notifications FROM notifications
WHERE idempotency_key LIKE '%prerequisite%';
-- expect: 0 — no Loop D notification channel exists yet.

SELECT action, resource_id, details FROM audit_logs
WHERE action = 'system.blocked_prerequisite_expired' ORDER BY created_at DESC LIMIT 1;
-- expect: one metadata-only audit row (the only trace of the escalation).


-- ============================================================================
-- PHASE 5 — A > D > C > B precedence-ceiling drill (anti-storm).
--   Runbook Step 6 (lines 180-187). Trip A + D + C + B for the SAME student in
--   one run; confirm exactly ONE new row opens, by precedence A > D > C > B.
--   This is the load-bearing Slice-1 assertion: D sits ABOVE C.
--   FIRST clean up any active Loop D row from PHASE 3/4 (final CLEANUP below),
--   then seed all four signals fresh.
-- ============================================================================
\set auth_user_id '11111111-1111-1111-1111-111111111111'

-- A: mastery-cliff (drop 0.65 -> 0.45 on chapter 99) — see loop-a drill PHASE 1.
INSERT INTO public.state_events
  (event_id, kind, actor_auth_user_id, tenant_id, idempotency_key, occurred_at, payload)
VALUES (
  gen_random_uuid(), 'learner.mastery_changed', :'auth_user_id', NULL,
  'drill_adaptive_precedence_cliff_' || to_char(now(),'YYYYMMDDHH24MISS'),
  now() - interval '1 hour',
  jsonb_build_object('subjectCode','math','chapterNumber',99,'fromMastery',0.65,'toMastery',0.45)
);
-- D: blocked prerequisite — re-run PHASE 1 (edge + weak snapshot + active dependent).
INSERT INTO concept_edges (from_topic_id, to_topic_id, edge_type, strength, source)
VALUES (:'prereq_topic_id', :'dependent_topic_id', 'prerequisite', 0.9, 'drill')
ON CONFLICT DO NOTHING;
INSERT INTO learner_twin_snapshots (student_id, snapshot_date, mastery_by_topic, decay_state)
VALUES (:'test_student_id', now(),
        jsonb_build_object(:'prereq_topic_id', 0.20),
        jsonb_build_object(:'prereq_topic_id', 0.30));
INSERT INTO concept_mastery (student_id, topic_id, p_know, last_attempted_at)
VALUES (:'test_student_id', :'dependent_topic_id', 0.35, now())
ON CONFLICT (student_id, topic_id) DO UPDATE SET last_attempted_at = now();
-- C: 'high'-band subject 'science' (>= 5 chapters < 0.4). See loops-bc drill C1.
INSERT INTO learner_mastery (student_id, subject_code, chapter_number, mastery, updated_at)
VALUES
  (:'test_student_id','science', 1, 0.20, now()),
  (:'test_student_id','science', 2, 0.25, now()),
  (:'test_student_id','science', 3, 0.30, now()),
  (:'test_student_id','science', 4, 0.18, now()),
  (:'test_student_id','science', 5, 0.35, now())
ON CONFLICT (student_id, subject_code, chapter_number)
DO UPDATE SET mastery = EXCLUDED.mastery, updated_at = now();
-- B: 'broken' inactivity.
UPDATE student_learning_profiles
SET last_active = now() - interval '3 days', updated_at = now()
WHERE student_id = :'test_student_id';

-- >>> NOW fire the worker ONCE: curl ... -d '{"phase":"inject"}'

-- Assert exactly ONE new active row, and it is Loop A (A wins over D, C, B):
SELECT trigger_signal, status, count(*)
FROM adaptive_interventions
WHERE student_id = :'test_student_id'
  AND created_at >= date_trunc('day', now())
GROUP BY trigger_signal, status;
-- expect: exactly ONE row, trigger_signal='mastery_cliff', status='active'.
--   inject.ceilingDeferred counts the deferred D/C/B candidates (line 186).

SELECT student_id, date_trunc('day', created_at) AS day, count(*) AS new_rows
FROM adaptive_interventions
WHERE student_id = :'test_student_id'
GROUP BY 1,2 HAVING count(*) > 1;
-- expect: ZERO rows (the <= 1-new-row/student/night ceiling holds).

-- Second half of the assertion (line 186): REMOVE the Loop A signal and re-run
-- inject; the winner must become 'blocked_prerequisite' (D beats C and B).
DELETE FROM state_events WHERE idempotency_key LIKE 'drill_adaptive_precedence_cliff_%';
DELETE FROM adaptive_interventions
 WHERE student_id = :'test_student_id' AND trigger_signal = 'mastery_cliff'
   AND created_at >= date_trunc('day', now());
-- >>> fire the worker AGAIN: curl ... -d '{"phase":"inject"}'
SELECT trigger_signal, status, count(*)
FROM adaptive_interventions
WHERE student_id = :'test_student_id'
  AND created_at >= date_trunc('day', now())
GROUP BY trigger_signal, status;
-- expect now: exactly ONE new row, trigger_signal='blocked_prerequisite'
--   (D > C > B). THIS is the Slice-1 precedence proof.


-- ============================================================================
-- PHASE 6 — CLEANUP (sentinel-scoped; always safe to re-run).
--   Runbook Step 7. audit_logs column names are the REAL schema columns
--   (resource_id + details jsonb), matching the baseline DDL
--   (00000000000000_baseline_from_prod.sql) and how the auditLog() helper
--   (packages/lib/src/audit.ts) actually writes — same as Loops A/B/C.
-- ============================================================================
DELETE FROM adaptive_interventions
 WHERE student_id = :'test_student_id'
   AND trigger_signal IN ('blocked_prerequisite','mastery_cliff','at_risk_concentration','inactivity');
DELETE FROM concept_edges WHERE source = 'drill';
DELETE FROM learner_twin_snapshots
 WHERE student_id = :'test_student_id' AND mastery_by_topic ? :'prereq_topic_id';
-- remove the drill concept_mastery rows for the prereq + dependent topics:
DELETE FROM concept_mastery
 WHERE student_id = :'test_student_id'
   AND topic_id IN (:'prereq_topic_id', :'dependent_topic_id');
-- ceiling-drill leftovers from other loops:
DELETE FROM learner_mastery
 WHERE student_id = :'test_student_id' AND subject_code = 'science'
   AND chapter_number IN (1,2,3,4,5);
DELETE FROM state_events WHERE idempotency_key LIKE 'drill_%';
UPDATE student_learning_profiles SET last_active = now(), updated_at = now()
 WHERE student_id = :'test_student_id';
-- audit rows (real schema: action LIKE + resource_id):
DELETE FROM audit_logs
 WHERE action LIKE 'system.%prerequisite%' AND resource_id = :'intervention_id';

-- Verify nothing was left behind:
SELECT count(*) AS leftover_loop_d FROM adaptive_interventions
 WHERE student_id = :'test_student_id' AND trigger_signal = 'blocked_prerequisite';
SELECT count(*) AS leftover_drill_edges FROM concept_edges WHERE source = 'drill';
-- expect: both 0.

-- ── OPTIONAL: return the protected flag to seeded-OFF on staging after drilling.
-- Prefer the super-admin console (protected-flag procedure + audit trail).
-- UPDATE feature_flags SET is_enabled = false, rollout_percentage = 0,
--        target_environments = NULL, updated_at = now()
-- WHERE flag_name = 'ff_digital_twin_v1';
</content>
