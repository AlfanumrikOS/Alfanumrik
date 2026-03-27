-- =============================================================================
-- Extended RBAC Roles for Alfanumrik EdTech Platform
-- Migration: 20260327210000_extended_rbac_roles.sql
--
-- Adds five new operational roles and their permissions on top of the existing
-- RBAC system (student, parent, teacher, tutor, admin, super_admin).
--
-- New roles:
--   institution_admin  (70) - School/institution administrator
--   finance            (65) - Finance/accounts team
--   content_manager    (60) - Content creation and moderation
--   reviewer           (58) - Content reviewer
--   support            (55) - Support/operations staff
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. NEW ROLES
-- ---------------------------------------------------------------------------
INSERT INTO roles (name, display_name, display_name_hi, hierarchy_level, is_system_role, description) VALUES
  ('institution_admin', 'Institution Admin', 'संस्था प्रशासक', 70, false,
    'School or institution administrator with teacher/student management capabilities'),
  ('content_manager', 'Content Manager', 'सामग्री प्रबंधक', 60, false,
    'Creates and moderates curriculum content, questions, and media'),
  ('support', 'Support', 'सहायता', 55, false,
    'Support and operations staff handling tickets, user issues, and invitations'),
  ('finance', 'Finance', 'वित्त', 65, false,
    'Finance and accounts team managing revenue, subscriptions, and refunds'),
  ('reviewer', 'Reviewer', 'समीक्षक', 58, false,
    'Reviews and approves or rejects content submitted by content managers')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. NEW PERMISSIONS
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, resource, action, description) VALUES
  -- Institution admin permissions
  ('institution.manage',          'institution', 'manage',          'Manage institution settings and configuration'),
  ('institution.view_analytics',  'institution', 'view_analytics',  'View institution-level analytics and dashboards'),
  ('institution.manage_teachers', 'institution', 'manage_teachers', 'Add, remove, and manage teachers within the institution'),
  ('institution.manage_students', 'institution', 'manage_students', 'Add, remove, and manage students within the institution'),
  ('institution.view_reports',    'institution', 'view_reports',    'View institution-wide performance reports'),
  -- Content manager permissions
  ('content.create',              'content', 'create',             'Create new curriculum content items'),
  ('content.edit',                'content', 'edit',               'Edit existing curriculum content'),
  ('content.submit_review',       'content', 'submit_review',     'Submit content for review/approval'),
  ('content.view_all',            'content', 'view_all',          'View all content including unpublished drafts'),
  ('content.manage_questions',    'content', 'manage_questions',  'Create, edit, and organize question banks'),
  ('content.manage_media',        'content', 'manage_media',      'Upload and manage media assets (images, videos, etc.)'),
  -- Reviewer permissions
  ('content.review',              'content', 'review',            'Review content submitted for approval'),
  ('content.approve',             'content', 'approve',           'Approve content for publication'),
  ('content.reject',              'content', 'reject',            'Reject content and send back for revision'),
  ('content.view_drafts',         'content', 'view_drafts',      'View draft content pending review'),
  -- Support permissions
  ('support.view_tickets',        'support', 'view_tickets',      'View support tickets and requests'),
  ('support.manage_tickets',      'support', 'manage_tickets',    'Respond to, assign, and close support tickets'),
  ('support.view_user_activity',  'support', 'view_user_activity','View user activity logs for troubleshooting'),
  ('support.fix_relationships',   'support', 'fix_relationships', 'Fix guardian-student and teacher-class relationships'),
  ('support.resend_invites',      'support', 'resend_invites',    'Resend invitation emails and onboarding links'),
  ('support.reset_passwords',     'support', 'reset_passwords',   'Trigger password reset flows for users'),
  -- Finance permissions
  ('finance.view_revenue',        'finance', 'view_revenue',      'View revenue dashboards and reports'),
  ('finance.view_subscriptions',  'finance', 'view_subscriptions','View subscription plans and user subscriptions'),
  ('finance.manage_refunds',      'finance', 'manage_refunds',    'Process and manage refund requests'),
  ('finance.export_reports',      'finance', 'export_reports',    'Export financial reports as CSV/PDF')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. ROLE-PERMISSION MAPPINGS
-- ---------------------------------------------------------------------------

-- institution_admin gets institution permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'institution_admin' AND p.code IN (
  'institution.manage',
  'institution.view_analytics',
  'institution.manage_teachers',
  'institution.manage_students',
  'institution.view_reports'
)
ON CONFLICT DO NOTHING;

-- institution_admin also inherits all teacher permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r_inst.id, rp.permission_id
FROM roles r_inst
CROSS JOIN roles r_teacher
JOIN role_permissions rp ON rp.role_id = r_teacher.id
WHERE r_inst.name = 'institution_admin'
  AND r_teacher.name = 'teacher'
ON CONFLICT DO NOTHING;

-- content_manager gets content management permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'content_manager' AND p.code IN (
  'content.create',
  'content.edit',
  'content.submit_review',
  'content.view_all',
  'content.manage_questions',
  'content.manage_media',
  'profile.view_own',
  'profile.update_own',
  'notification.view',
  'notification.dismiss'
)
ON CONFLICT DO NOTHING;

-- reviewer gets review permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'reviewer' AND p.code IN (
  'content.review',
  'content.approve',
  'content.reject',
  'content.view_drafts',
  'content.view_all',
  'profile.view_own',
  'profile.update_own',
  'notification.view',
  'notification.dismiss'
)
ON CONFLICT DO NOTHING;

-- support gets support permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'support' AND p.code IN (
  'support.view_tickets',
  'support.manage_tickets',
  'support.view_user_activity',
  'support.fix_relationships',
  'support.resend_invites',
  'support.reset_passwords',
  'profile.view_own',
  'profile.update_own',
  'notification.view',
  'notification.dismiss'
)
ON CONFLICT DO NOTHING;

-- finance gets finance permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'finance' AND p.code IN (
  'finance.view_revenue',
  'finance.view_subscriptions',
  'finance.manage_refunds',
  'finance.export_reports',
  'profile.view_own',
  'profile.update_own',
  'notification.view',
  'notification.dismiss'
)
ON CONFLICT DO NOTHING;

-- super_admin gets ALL new permissions (admin too, since admin already has all)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin'
  AND p.code IN (
    'institution.manage', 'institution.view_analytics', 'institution.manage_teachers',
    'institution.manage_students', 'institution.view_reports',
    'content.create', 'content.edit', 'content.submit_review', 'content.view_all',
    'content.manage_questions', 'content.manage_media',
    'content.review', 'content.approve', 'content.reject', 'content.view_drafts',
    'support.view_tickets', 'support.manage_tickets', 'support.view_user_activity',
    'support.fix_relationships', 'support.resend_invites', 'support.reset_passwords',
    'finance.view_revenue', 'finance.view_subscriptions', 'finance.manage_refunds',
    'finance.export_reports'
  )
ON CONFLICT DO NOTHING;

-- admin also gets all new permissions (mirrors existing behavior)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.code IN (
    'institution.manage', 'institution.view_analytics', 'institution.manage_teachers',
    'institution.manage_students', 'institution.view_reports',
    'content.create', 'content.edit', 'content.submit_review', 'content.view_all',
    'content.manage_questions', 'content.manage_media',
    'content.review', 'content.approve', 'content.reject', 'content.view_drafts',
    'support.view_tickets', 'support.manage_tickets', 'support.view_user_activity',
    'support.fix_relationships', 'support.resend_invites', 'support.reset_passwords',
    'finance.view_revenue', 'finance.view_subscriptions', 'finance.manage_refunds',
    'finance.export_reports'
  )
ON CONFLICT DO NOTHING;
