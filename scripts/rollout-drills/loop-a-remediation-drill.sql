-- ============================================================================
-- STAGING ONLY — NEVER RUN AGAINST PRODUCTION.
-- ============================================================================
-- Loop A (Phase A adaptive remediation) — synthetic mastery-cliff drill.
--
-- Grounded verbatim in docs/runbooks/adaptive-remediation-rollout.md
--   §"Staging synthetic-cliff drill" (Steps 0-7, lines 52-201).
-- Thresholds grounded in ADAPTIVE_REMEDIATION_RULES
--   (packages/lib/src/learn/remediation-queue-adapter.ts) and the recovery
--   branches in packages/lib/src/learn/recovery-evaluation.ts.
--
-- WHAT THIS PROVES: mastery-cliff (drop >= 0.15) -> inject one `active`
--   intervention on fictional chapter 99 -> either the RECOVERED branch (an
--   in-window mastery recovery) or the ESCALATED branch (window elapses with no
--   recovery -> teacher B2B / guardian B2C).
--
-- HOW TO RUN: phase by phase. Between phases, fire the worker from a second
--   terminal (see the `curl` comments). Keep ONE psql session open so the
--   \set params below persist. Do NOT run this file top-to-bottom in one shot —
--   the cron HTTP calls happen BETWEEN the SQL phases.
--
-- PARAMETERS (edit these, then paste the phases in order):
--   :test_student_id  = students.id       of a clearly-marked staging test acct
--   :auth_user_id     = students.auth_user_id of the SAME test account
--                       (NOT students.id — the inject scan reads state_events by
--                        actor_auth_user_id; runbook Step 1, line 71)
--   :intervention_id  = the adaptive_interventions.id printed by PHASE 3
--                       (set it after PHASE 3 with: \set intervention_id '...')
-- ============================================================================

\set test_student_id  '00000000-0000-0000-0000-000000000000'
\set auth_user_id     '11111111-1111-1111-1111-111111111111'
-- Defaults so cleanup phases never error on an unset psql variable. Overwrite
-- :intervention_id after PHASE 2, and :teacher_assignment_id after PHASE 5 (B2B
-- only). The sentinel below is a valid UUID that matches no real row.
\set intervention_id       'ffffffff-ffff-ffff-ffff-ffffffffffff'
\set teacher_assignment_id 'ffffffff-ffff-ffff-ffff-ffffffffffff'

-- ── SAFETY GUARD: confirm you are on staging before doing anything. ──────────
-- Abort immediately if this prints a production-looking database/host.
\echo '>>> Connected database / user / host (MUST be staging):'
SELECT current_database() AS db, current_user AS usr, inet_server_addr() AS host;
\echo '>>> If the above is not STAGING, STOP NOW. This script seeds synthetic data.'


-- ============================================================================
-- PHASE 0 — enable the Loop A flag on STAGING ONLY.
--   Runbook Step 0, lines 56-67. Confirm the env string your staging deploy
--   reports (VERCEL_ENV || NODE_ENV) is in target_environments, else INJECT
--   stays off silently. Wait out the 5-minute flag cache TTL before PHASE 2.
-- ============================================================================
UPDATE feature_flags
SET is_enabled = true,
    rollout_percentage = 100,
    target_environments = ARRAY['staging']::text[],   -- add 'preview' if your deploy reports it
    updated_at = now()
WHERE flag_name = 'ff_adaptive_remediation_v1';

SELECT flag_name, is_enabled, rollout_percentage, target_environments
FROM feature_flags WHERE flag_name = 'ff_adaptive_remediation_v1';
-- expect: is_enabled=true, rollout_percentage=100, target_environments={staging}


-- ============================================================================
-- PHASE 1 — fabricate the mastery cliff (drop 0.20 >= the 0.15 cliff floor).
--   Runbook Step 1, lines 69-92. Direct INSERT into state_events is intentional
--   (the inject scan reads state_events directly, so it works even with
--   ff_event_bus_v1 OFF). Event must be within the last 24h (inject window) and
--   the student must be is_active=true, deleted_at IS NULL.
--   Drop = 0.65 -> 0.45 = 0.20 >= ADAPTIVE_REMEDIATION_RULES cliff threshold 0.15.
-- ============================================================================
INSERT INTO public.state_events
  (event_id, kind, actor_auth_user_id, tenant_id, idempotency_key, occurred_at, payload)
VALUES (
  gen_random_uuid(),
  'learner.mastery_changed',
  :'auth_user_id',
  NULL,
  'drill_adaptive_remediation_cliff_' || to_char(now(), 'YYYYMMDDHH24MISS'),
  now() - interval '1 hour',
  jsonb_build_object(
    'subjectCode',   'math',
    'chapterNumber', 99,          -- fictional chapter: no real learner_mastery interferes (Step 0 note, line 54)
    'fromMastery',   0.65,
    'toMastery',     0.45
  )
);
-- expect: cliff signal flags worstSubject='math', worstChapter=99, drop 0.20.

-- >>> NOW fire the worker (second terminal):
--   curl -s -X POST "$STAGING_HOST/api/cron/adaptive-remediation" \
--     -H "Content-Type: application/json" -H "x-cron-secret: $CRON_SECRET" \
--     -d '{"phase":"inject"}'
-- expect: {"success":true,"data":{"phase":"inject","injected":1,...}}
-- (inject.skipped=="flag_off" => Step 0 env/flag mismatch. A second identical
--  call must report deduped:1, injected:0 — the partial unique index backstop.)


-- ============================================================================
-- PHASE 2 — verify the intervention row + rhythm lane + notification.
--   Runbook Step 3, lines 105-123.
-- ============================================================================
SELECT id, student_id, subject_code, chapter_number, status, verify_by, trigger_snapshot
FROM adaptive_interventions
WHERE subject_code = 'math' AND chapter_number = 99
  AND student_id = :'test_student_id'
ORDER BY created_at DESC LIMIT 1;
-- expect: status='active'; trigger_snapshot carries largestDrop=0.2,
--   baselineMastery=0.65, postCliffMastery=0.45, rulesVersion='loop-a-v1'.
-- >>> Copy the printed id and: \set intervention_id '<that-uuid>'
--
-- Also (manual): log in to staging as the test student, GET /api/rhythm/today —
-- items must include a kind='remediation_review' card after the 5-item SRS block
-- and before the ZPD problem. Toggle Hindi and confirm bilingual copy (P7).

SELECT type, recipient_type, title, idempotency_key FROM notifications
WHERE type = 'remediation_assigned'
ORDER BY created_at DESC LIMIT 1;
-- expect: one student row, idempotency_key='remediation_assigned_<intervention_id>'.


-- ============================================================================
-- PHASE 3 (branch RECOVERED) — in-window recovery observation.
--   Runbook Step 4, lines 125-143. Recovery is checked BEFORE expiry so it fires
--   immediately. 0.45 -> 0.70 satisfies BOTH recovery branches
--   (recovery-evaluation.ts lines 21-22, 238-248):
--     branch A: masteryNow 0.70 >= baselineMastery 0.65 (full restoration), AND
--     branch B: gainFromTrough 0.25 >= 0.15 AND masteryNow 0.70 >= 0.4.
--   RUN THIS ONLY for the recovered-branch drill. Skip to PHASE 4 for escalation.
-- ============================================================================
INSERT INTO public.state_events
  (event_id, kind, actor_auth_user_id, tenant_id, idempotency_key, occurred_at, payload)
VALUES (
  gen_random_uuid(),
  'learner.mastery_changed',
  :'auth_user_id',
  NULL,
  'drill_adaptive_remediation_recovery_' || to_char(now(), 'YYYYMMDDHH24MISS'),
  now(),
  jsonb_build_object('subjectCode','math','chapterNumber',99,'fromMastery',0.45,'toMastery',0.70)
);

-- >>> NOW fire the worker: curl ... -d '{"phase":"verify"}'
-- Then confirm the recovered verdict:
SELECT id, status, resolved_at FROM adaptive_interventions WHERE id = :'intervention_id';
-- expect: status='recovered', resolved_at set.
SELECT type, recipient_type, idempotency_key FROM notifications
WHERE type = 'remediation_recovered' ORDER BY created_at DESC LIMIT 1;
-- expect: one remediation_recovered notification.
--
-- To then run the ESCALATION branch, re-run PHASE 1-2 with a DIFFERENT chapter
-- number (the 3-day same-chapter cooldown blocks chapter 99 — runbook line 143).


-- ============================================================================
-- PHASE 4 (branch ESCALATED, step 1) — fast-forward the verification window.
--   Runbook Step 5, lines 145-153. Keep verify_by > created_at, else the worker
--   discards the malformed window and falls back to the canonical 7 days and the
--   row stays pending. Do NOT insert any recovery observation for this branch.
-- ============================================================================
UPDATE adaptive_interventions
SET verify_by = now() - interval '1 minute'
WHERE id = :'intervention_id' AND status = 'active';
-- (Sanity: this UPDATE must set verify_by to a value still strictly after
--  created_at. If created_at is < 1 minute ago on a brand-new drill row, wait a
--  couple of minutes before running this, or the fallback kicks in.)

-- >>> NOW fire the worker: curl ... -d '{"phase":"verify"}'


-- ============================================================================
-- PHASE 5 (branch ESCALATED, step 2) — confirm the terminal escalation.
--   Runbook Step 6, lines 155-191.
-- ============================================================================
-- B2B (teacher path) — precondition: test student has an active class_students
-- row in a class with an active class_teachers row (runbook line 159).
SELECT status, escalated_to, teacher_assignment_id, resolved_at
FROM adaptive_interventions WHERE id = :'intervention_id';
-- expect (B2B): status='escalated', escalated_to='teacher', teacher_assignment_id NOT NULL.
-- expect (B2C): status='escalated', escalated_to='parent',  teacher_assignment_id NULL.

-- B2B teacher-assignment detail (only if escalated_to='teacher'):
--   >>> \set teacher_assignment_id '<the teacher_assignment_id printed above>'
SELECT id, teacher_id, student_id, class_id, chapter_id, status
FROM teacher_remediation_assignments WHERE id = :'teacher_assignment_id';
-- expect: status='assigned'; chapter_id NULL for fictional chapter 99
--   (nullable by design — renders as "general" remediation teacher-side; line 168-169).

-- B2C parent path — precondition: NO roster teacher + a guardian_student_links
-- row status approved/active (runbook line 172).
SELECT type, recipient_type, idempotency_key FROM notifications
WHERE type = 'remediation_escalated' ORDER BY created_at DESC LIMIT 5;
-- expect: one student row (..._student) + one row per linked guardian
--   (..._<guardian_id>), each preference-gated (default ON).

-- Both branches — the bus-independent audit row MUST exist (runbook lines 183-191):
SELECT action, resource_type, resource_id, details FROM audit_logs
WHERE action = 'system.remediation_escalated'
ORDER BY created_at DESC LIMIT 5;
-- expect details carry UUIDs + codes only (REG-68 pattern): subject_code,
--   chapter_number, escalated_to, teacher_assignment_id, verify_by, rules_version.


-- ============================================================================
-- PHASE 6 — CLEANUP (sentinel-scoped; always safe to re-run).
--   Runbook Step 7, lines 193-201. Deletes exactly what the drill seeded.
--   NOTE: adjust the chapter list if you ran the escalation branch on a second
--   chapter number in PHASE 3's re-run.
-- ============================================================================
DELETE FROM adaptive_interventions
 WHERE student_id = :'test_student_id'
   AND chapter_number IN (99 /*, add any extra escalation-branch chapters here */);

-- teacher assignment (only if the B2B branch created one):
DELETE FROM teacher_remediation_assignments
 WHERE student_id = :'test_student_id'
   AND id = :'teacher_assignment_id';

DELETE FROM notifications
 WHERE idempotency_key LIKE 'remediation_%' || :'intervention_id' || '%';

DELETE FROM state_events
 WHERE idempotency_key LIKE 'drill_adaptive_remediation_%';

-- Verify the drill left nothing behind:
SELECT count(*) AS leftover_interventions FROM adaptive_interventions
 WHERE student_id = :'test_student_id' AND chapter_number = 99;
SELECT count(*) AS leftover_drill_events FROM state_events
 WHERE idempotency_key LIKE 'drill_adaptive_remediation_%';
-- expect: both 0.

-- ── OPTIONAL: return the flag to its seeded-OFF state on staging after drilling ──
-- (Only if you are NOT proceeding straight to the staging Stage-1 ramp.)
-- UPDATE feature_flags SET is_enabled = false, rollout_percentage = 0,
--        target_environments = NULL, updated_at = now()
-- WHERE flag_name = 'ff_adaptive_remediation_v1';
</content>
