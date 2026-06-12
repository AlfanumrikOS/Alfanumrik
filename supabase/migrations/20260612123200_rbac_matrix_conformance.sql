-- Migration: 20260612123200_rbac_matrix_conformance.sql
-- Purpose: ADDITIVE, IDEMPOTENT RBAC MATRIX CONFORMANCE GUARD.
--
--          This migration is the single, replayable source of truth that
--          asserts the full Alfanumrik RBAC Matrix is 100% present in the DB:
--            - all 11 roles,
--            - every matrix permission code,
--            - every role -> permission (X) grant,
--            - the 4 resource_access_rules ownership patterns
--              (student->own, parent->linked, teacher->assigned, admin->any),
--            - the institution_admin -> teacher permission inheritance grant.
--
--          It exists because the production RBAC seed lived in a chain of
--          legacy migrations now archived under supabase/migrations/_legacy/
--          (20260324070000_production_rbac_system.sql,
--           20260327210000_extended_rbac_roles.sql,
--           20260409000005_add_diagnostic_permissions.sql,
--           20260415000011_subject_governance_rbac_permission.sql,
--           20260416200100_school_admin_extra_permissions.sql,
--           20260417100000_rbac_phase1_security_hardening.sql,
--           20260418120000_super_admin_access_permission_seed.sql)
--          plus a few in-tree root seeds (20260507110000, 20260610110000,
--          20260611000050, 20260613000000, 20260614000002). The Supabase CLI
--          only applies files at the immediate supabase/migrations/ root, so
--          _legacy/ is NOT applied on FRESH DBs (CI live-DB, new staging, DR).
--          This file consolidates the FULL matrix at the root so every
--          environment converges to the same RBAC posture from a single,
--          replayable artifact.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE ONLY. This migration NEVER deletes/removes any role, permission,
--     grant, or resource_access_rule. The DB currently holds a SUPERSET of the
--     matrix (~84 permission codes on PROD); those extras are intentionally left
--     untouched. There is no DROP / DELETE / UPDATE / TRUNCATE anywhere below.
--   - IDEMPOTENT. Every INSERT is guarded:
--       * roles               -> ON CONFLICT (name) DO NOTHING
--                                (UNIQUE constraint roles_name_key,
--                                 baseline line 15912).
--       * permissions         -> ON CONFLICT (code) DO NOTHING
--                                (UNIQUE constraint permissions_code_key,
--                                 baseline line 15732).
--       * role_permissions    -> ON CONFLICT (role_id, permission_id) DO NOTHING
--                                (UNIQUE constraint
--                                 role_permissions_role_id_permission_id_key,
--                                 baseline line 15908).
--       * resource_access_rules -> guarded with WHERE NOT EXISTS, because this
--                                table has NO unique constraint (only a PK on
--                                id, baseline line 15876) — a bare ON CONFLICT
--                                would NOT dedupe by (role, resource, ownership).
--                                The WHERE NOT EXISTS guard makes replay a no-op.
--     Safe to replay on PROD, staging, CI live-DB, and fresh DBs.
--   - RESOLVE BY NAME / CODE, NEVER BY HARDCODED UUID. Every grant is a
--     roles x permissions SELECT-join keyed on r.name / p.code. If a referenced
--     role or permission row is absent on a partially-seeded DB, the join simply
--     yields zero rows (a silent no-op), exactly mirroring the established seed
--     pattern (e.g. 20260507110000_add_school_manage_modules_permission.sql).
--   - NO NEW TABLES -> no new RLS policy needed. permissions / roles /
--     role_permissions / resource_access_rules keep their existing baseline RLS
--     posture; rows are inserted through the service-role migration runner.
--
-- ─── CEO approval posture ────────────────────────────────────────────────────
--   This migration introduces NO new permission codes and NO new roles beyond
--   what the prior, individually CEO-approved seed migrations already
--   established. It is a CONFORMANCE RE-ASSERTION of the existing, approved
--   matrix — not an authorization expansion — so it does not itself require a
--   fresh approval gate. Every code/role/grant below traces to one of the seed
--   migrations enumerated above.
--
-- ─── Cache behaviour post-deploy ─────────────────────────────────────────────
--   src/lib/rbac.ts caches per-user permission sets with a 5-minute TTL. On a
--   DB that already has the full matrix this migration is a pure no-op and
--   touches no rows, so no cache invalidation is required. On a fresh DB the
--   rows are present before any user session exists.

BEGIN;

-- =============================================================================
-- 1. ROLES (11 total)
-- =============================================================================
-- student/parent/teacher/tutor/admin/super_admin: base seed
--   (_legacy/20260324070000). institution_admin/content_manager/support/
--   finance/reviewer: extended seed (_legacy/20260327210000).
INSERT INTO roles (name, display_name, display_name_hi, hierarchy_level, is_system_role, description) VALUES
  ('student',           'Student',            'छात्र',          10,  true,  'Learner (CBSE grades 6-12) with own-data access'),
  ('parent',            'Parent',             'अभिभावक',        30,  true,  'Guardian with linked-child read access'),
  ('tutor',             'Tutor',              'ट्यूटर',          40,  false, 'Private tutor assigned to specific students'),
  ('teacher',           'Teacher',            'शिक्षक',          50,  true,  'Class teacher with assigned-student management'),
  ('support',           'Support',            'सहायता',          55,  false, 'Support and operations staff'),
  ('reviewer',          'Reviewer',           'समीक्षक',         58,  false, 'Content reviewer (approve/reject)'),
  ('content_manager',   'Content Manager',    'सामग्री प्रबंधक', 60,  false, 'Creates and moderates curriculum content'),
  ('finance',           'Finance',            'वित्त',           65,  false, 'Finance and accounts team'),
  ('institution_admin', 'Institution Admin',  'संस्था प्रशासक', 70,  false, 'School/institution administrator (inherits teacher)'),
  ('admin',             'Admin',              'एडमिन',          90,  true,  'Platform administrator (holds all permissions)'),
  ('super_admin',       'Super Admin',        'सुपर एडमिन',     100, true,  'Root super administrator (holds all permissions + runtime bypass)')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 2. PERMISSION CODES (the full matrix; ~70 codes)
-- =============================================================================
-- One INSERT covering every matrix code. Extra prod codes outside the matrix
-- are NOT listed here and are left untouched (additive guard, not a reset).
INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  -- ── Student (own-data) ────────────────────────────────────────────────────
  ('study_plan.view',       'study_plan',  'view',          'View assigned study plans', true),
  ('study_plan.create',     'study_plan',  'create',        'Generate new study plans', true),
  ('quiz.attempt',          'quiz',        'attempt',       'Attempt quizzes and tests', true),
  ('quiz.view_results',     'quiz',        'view',          'View own quiz results', true),
  ('exam.view',             'exam',        'view',          'View own exam configurations', true),
  ('exam.create',           'exam',        'create',        'Create exam configurations', true),
  ('image.upload',          'image',       'upload',        'Upload assignment/question images', true),
  ('image.view_own',        'image',       'view',          'View own uploaded images', true),
  ('report.view_own',       'report',      'view',          'View own performance reports', true),
  ('report.download_own',   'report',      'download',      'Download own monthly reports', true),
  ('review.view',           'review',      'view',          'View spaced repetition cards', true),
  ('review.practice',       'review',      'practice',      'Practice flashcards', true),
  ('foxy.chat',             'foxy',        'chat',          'Chat with Foxy AI tutor', true),
  ('foxy.interact',         'foxy',        'interact',      'Use advanced Foxy AI interactive features', true),
  ('simulation.view',       'simulation',  'view',          'View interactive simulations', true),
  ('simulation.interact',   'simulation',  'interact',      'Use interactive simulations', true),
  ('leaderboard.view',      'leaderboard', 'view',          'View leaderboard', true),
  ('profile.view_own',      'profile',     'view',          'View own profile', true),
  ('profile.update_own',    'profile',     'update',        'Update own profile', true),
  ('notification.view',     'notification','view',          'View notifications', true),
  ('notification.dismiss',  'notification','update',        'Dismiss notifications', true),
  ('progress.view_own',     'progress',    'view',          'View own learning progress', true),
  ('diagnostic.attempt',    'diagnostic',  'attempt',       'Start a diagnostic assessment', true),
  ('diagnostic.complete',   'diagnostic',  'complete',      'Submit a completed diagnostic assessment', true),
  ('stem.observe',          'stem',        'observe',       'Observe STEM interactive demonstrations', true),
  ('payments.subscribe',    'payments',    'subscribe',     'Initiate and verify own subscription purchase', true),
  ('account.delete',        'account',     'delete',        'Initiate/cancel/check own account deletion (DPDP Act 2023 s.17)', true),
  -- ── Parent (child-scoped) ─────────────────────────────────────────────────
  ('child.view_performance','child',       'view',          'View linked child performance', true),
  ('child.view_progress',   'child',       'view_progress', 'View linked child progress', true),
  ('child.download_report', 'child',       'download',      'Download child monthly report', true),
  ('child.view_exams',      'child',       'view_exams',    'View child exam schedule', true),
  ('child.receive_alerts',  'child',       'alerts',        'Receive alerts about child', true),
  ('child.encourage',       'child',       'encourage',     'Send an encouragement ("cheer") to a linked child', true),
  -- ── Teacher ───────────────────────────────────────────────────────────────
  ('class.manage',          'class',       'manage',        'Manage classes and enrollments', true),
  ('class.view_analytics',  'class',       'analytics',     'View class analytics', true),
  ('exam.assign',           'exam',        'assign',        'Assign exams to classes', true),
  ('exam.create_for_class', 'exam',        'create_class',  'Create exams for class', true),
  ('test.create',           'test',        'create',        'Create tests and quizzes', true),
  ('test.edit',             'test',        'edit',          'Edit tests and quizzes', true),
  ('student.view_uploads',  'student',     'view_uploads',  'Review student uploaded images', true),
  ('student.provide_feedback','student',   'feedback',      'Provide feedback to students', true),
  ('worksheet.create',      'worksheet',   'create',        'Create worksheets', true),
  ('worksheet.assign',      'worksheet',   'assign',        'Assign worksheets', true),
  ('report.view_class',     'report',      'view_class',    'View class performance reports', true),
  -- ── Tutor ─────────────────────────────────────────────────────────────────
  ('tutor.view_student',    'tutor',       'view_student',  'View assigned student profiles and progress', true),
  ('tutor.provide_feedback','tutor',       'provide_feedback','Provide feedback to assigned students', true),
  ('tutor.view_analytics',  'tutor',       'view_analytics','View analytics for assigned students', true),
  ('tutor.create_worksheet','tutor',       'create_worksheet','Create practice worksheets for students', true),
  ('tutor.assign_worksheet','tutor',       'assign_worksheet','Assign worksheets to students', true),
  -- ── Admin ─────────────────────────────────────────────────────────────────
  ('user.manage',           'user',        'manage',        'Manage all users', true),
  ('role.manage',           'role',        'manage',        'Manage roles and permissions', true),
  ('permission.manage',     'permission',  'manage',        'Manage permission definitions', true),
  ('system.audit',          'system',      'audit',         'View audit logs', true),
  ('system.config',         'system',      'config',        'Manage system configuration', true),
  ('content.manage',        'content',     'manage',        'Manage curriculum content', true),
  ('analytics.global',      'analytics',   'global',        'View global platform analytics', true),
  -- ── Content manager ───────────────────────────────────────────────────────
  ('content.create',        'content',     'create',        'Create new curriculum content items', true),
  ('content.edit',          'content',     'edit',          'Edit existing curriculum content', true),
  ('content.submit_review', 'content',     'submit_review', 'Submit content for review/approval', true),
  ('content.view_all',      'content',     'view_all',      'View all content including unpublished drafts', true),
  ('content.manage_questions','content',   'manage_questions','Create, edit, and organize question banks', true),
  ('content.manage_media',  'content',     'manage_media',  'Upload and manage media assets', true),
  -- ── Reviewer ──────────────────────────────────────────────────────────────
  ('content.review',        'content',     'review',        'Review content submitted for approval', true),
  ('content.approve',       'content',     'approve',       'Approve content for publication', true),
  ('content.reject',        'content',     'reject',        'Reject content and send back for revision', true),
  ('content.view_drafts',   'content',     'view_drafts',   'View draft content pending review', true),
  -- ── Support ───────────────────────────────────────────────────────────────
  ('support.view_tickets',  'support',     'view_tickets',  'View support tickets and requests', true),
  ('support.manage_tickets','support',     'manage_tickets','Respond to, assign, and close support tickets', true),
  ('support.view_user_activity','support', 'view_user_activity','View user activity logs for troubleshooting', true),
  ('support.fix_relationships','support',  'fix_relationships','Fix guardian-student and teacher-class relationships', true),
  ('support.resend_invites','support',     'resend_invites','Resend invitation emails and onboarding links', true),
  ('support.reset_passwords','support',    'reset_passwords','Trigger password reset flows for users', true),
  -- ── Finance ───────────────────────────────────────────────────────────────
  ('finance.view_revenue',  'finance',     'view_revenue',  'View revenue dashboards and reports', true),
  ('finance.view_subscriptions','finance', 'view_subscriptions','View subscription plans and user subscriptions', true),
  ('finance.manage_refunds','finance',     'manage_refunds','Process and manage refund requests', true),
  ('finance.export_reports','finance',     'export_reports','Export financial reports as CSV/PDF', true),
  -- ── Institution admin ─────────────────────────────────────────────────────
  ('institution.manage',          'institution','manage',          'Manage institution settings and configuration', true),
  ('institution.view_analytics',  'institution','view_analytics',  'View institution-level analytics and dashboards', true),
  ('institution.manage_teachers', 'institution','manage_teachers', 'Add, remove, and manage teachers within the institution', true),
  ('institution.manage_students', 'institution','manage_students', 'Add, remove, and manage students within the institution', true),
  ('institution.view_reports',    'institution','view_reports',    'View institution-wide performance reports', true),
  ('institution.export_reports',  'institution','export_reports',  'Export school reports (mastery/Bloom/performance) as CSV/PDF', true),
  ('institution.manage_billing',  'institution','manage_billing',  'Manage the school subscription, plan changes, and billing', true),
  ('institution.view_billing',    'institution','view_billing',    'View the school subscription, seat usage, and invoices', true),
  ('institution.manage_staff',    'institution','manage_staff',    'Assign and revoke school-admin roles within the school', true),
  -- ── School (institution_admin-scoped) ─────────────────────────────────────
  ('school.manage_branding','school',      'manage_branding','Update school logo, colors, and tagline', true),
  ('school.manage_billing', 'school',      'manage_billing','View subscription details and seat usage', true),
  ('school.manage_domain',  'school',      'manage_domain', 'Configure custom domain for school', true),
  ('school.export_data',    'school',      'export_data',   'Export school data (students, reports)', true),
  ('school.manage_settings','school',      'manage_settings','Update school-level configuration', true),
  ('school.manage_modules', 'school',      'manage_modules','Toggle which platform modules are enabled for this school', true),
  ('school.manage_content', 'school',      'manage_content','Manage school-scoped question content (create, edit, approve, bulk upload)', true),
  -- ── Super admin (root-scoped) ─────────────────────────────────────────────
  ('super_admin.access',         'super_admin',          'access', 'Access the super-admin panel and super-admin API routes', true),
  ('super_admin.subjects.manage','super_admin_subjects', 'manage', 'Manage CBSE subject catalogue and per-student subject overrides (Phase E)', true)
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- 3. ROLE -> PERMISSION GRANTS (the X marks of the matrix)
-- =============================================================================

-- ── student ──────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'student' AND p.code IN (
  'study_plan.view', 'study_plan.create', 'quiz.attempt', 'quiz.view_results',
  'exam.view', 'exam.create', 'image.upload', 'image.view_own',
  'report.view_own', 'report.download_own', 'review.view', 'review.practice',
  'foxy.chat', 'foxy.interact', 'simulation.view', 'simulation.interact',
  'leaderboard.view', 'profile.view_own', 'profile.update_own',
  'notification.view', 'notification.dismiss', 'progress.view_own',
  'diagnostic.attempt', 'diagnostic.complete', 'stem.observe',
  'payments.subscribe', 'account.delete'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── parent ───────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'parent' AND p.code IN (
  'child.view_performance', 'child.view_progress', 'child.download_report',
  'child.view_exams', 'child.receive_alerts', 'child.encourage',
  'profile.view_own', 'profile.update_own', 'notification.view',
  'notification.dismiss', 'account.delete'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── teacher ──────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'teacher' AND p.code IN (
  'class.manage', 'class.view_analytics', 'exam.assign', 'exam.create_for_class',
  'test.create', 'test.edit', 'student.view_uploads', 'student.provide_feedback',
  'worksheet.create', 'worksheet.assign', 'report.view_class',
  'profile.view_own', 'profile.update_own', 'notification.view',
  'notification.dismiss', 'leaderboard.view', 'account.delete'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── tutor ────────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'tutor' AND p.code IN (
  'tutor.view_student', 'tutor.provide_feedback', 'tutor.view_analytics',
  'tutor.create_worksheet', 'tutor.assign_worksheet',
  'profile.view_own', 'profile.update_own', 'notification.view',
  'notification.dismiss', 'leaderboard.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── content_manager ──────────────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'content_manager' AND p.code IN (
  'content.create', 'content.edit', 'content.submit_review', 'content.view_all',
  'content.manage_questions', 'content.manage_media',
  'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── reviewer ─────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'reviewer' AND p.code IN (
  'content.review', 'content.approve', 'content.reject', 'content.view_drafts',
  'content.view_all',
  'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── support ──────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'support' AND p.code IN (
  'support.view_tickets', 'support.manage_tickets', 'support.view_user_activity',
  'support.fix_relationships', 'support.resend_invites', 'support.reset_passwords',
  'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── finance ──────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'finance' AND p.code IN (
  'finance.view_revenue', 'finance.view_subscriptions', 'finance.manage_refunds',
  'finance.export_reports',
  'profile.view_own', 'profile.update_own', 'notification.view', 'notification.dismiss'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── institution_admin (direct institution.* + school.* grants) ───────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'institution_admin' AND p.code IN (
  'institution.manage', 'institution.view_analytics', 'institution.manage_teachers',
  'institution.manage_students', 'institution.view_reports',
  'institution.export_reports', 'institution.manage_billing',
  'institution.view_billing', 'institution.manage_staff',
  'school.manage_branding', 'school.manage_billing', 'school.manage_domain',
  'school.export_data', 'school.manage_settings', 'school.manage_modules',
  'school.manage_content'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── institution_admin INHERITS all teacher permissions ───────────────────────
-- Copies every grant currently held by the teacher role into institution_admin.
-- Mirrors _legacy/20260327210000_extended_rbac_roles.sql lines 86-93.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r_inst.id, rp.permission_id
FROM roles r_inst
CROSS JOIN roles r_teacher
JOIN role_permissions rp ON rp.role_id = r_teacher.id
WHERE r_inst.name = 'institution_admin'
  AND r_teacher.name = 'teacher'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── admin -> ALL permissions (wildcard) ──────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── super_admin -> ALL permissions (wildcard; also bypasses in hasPermission) ─
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =============================================================================
-- 4. RESOURCE ACCESS RULES (4 ownership patterns)
-- =============================================================================
-- NOTE: resource_access_rules has NO unique constraint (PK on id only), so a
-- plain ON CONFLICT cannot dedupe. Each rule is therefore guarded with
-- WHERE NOT EXISTS on (role_id, resource_type, ownership_check). This makes
-- every replay a no-op and keeps the migration idempotent.
--   student  -> own       (auth_user_id = auth.uid())
--   parent   -> linked    (via guardian_student_links)
--   teacher  -> assigned  (via class_teachers/class_students)
--   admin    -> any       (service-role / unrestricted)
INSERT INTO resource_access_rules (role_id, resource_type, ownership_check)
SELECT r.id, v.resource_type, v.ownership_check
FROM (VALUES
  ('student', 'student',    'own'),
  ('student', 'quiz',       'own'),
  ('student', 'study_plan', 'own'),
  ('student', 'report',     'own'),
  ('student', 'image',      'own'),
  ('parent',  'student',    'linked'),
  ('parent',  'report',     'linked'),
  ('parent',  'image',      'linked'),
  ('teacher', 'student',    'assigned'),
  ('teacher', 'class',      'assigned'),
  ('teacher', 'report',     'assigned'),
  ('teacher', 'image',      'assigned'),
  ('admin',   'student',    'any'),
  ('admin',   'report',     'any'),
  ('admin',   'class',      'any')
) AS v(role_name, resource_type, ownership_check)
JOIN roles r ON r.name = v.role_name
WHERE NOT EXISTS (
  SELECT 1 FROM resource_access_rules rar
  WHERE rar.role_id = r.id
    AND rar.resource_type = v.resource_type
    AND rar.ownership_check = v.ownership_check
);

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT count(*) FROM roles;                                  -- >= 11
-- SELECT r.name, count(*) FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id GROUP BY r.name ORDER BY r.name;
-- SELECT r.name AS role, rar.resource_type, rar.ownership_check
--   FROM resource_access_rules rar JOIN roles r ON r.id = rar.role_id
--  ORDER BY r.name, rar.resource_type;                          -- 15 rows, 4 patterns
