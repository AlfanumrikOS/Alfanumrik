-- Migration: 20260507110000_add_school_manage_modules_permission.sql
-- Purpose: Phase C follow-up — adds the `school.manage_modules` RBAC
--          permission so a tenant admin can toggle module enablement from
--          /school-admin/modules. Backed by the tenant_modules table that
--          already shipped in 20260507000005 (#558).
--
-- Why a separate permission (not folded into school.manage_settings):
--   - Module enablement carries higher blast radius than colour/tagline
--     changes. Disabling Analytics or Communication mid-term affects every
--     student/teacher on that subdomain.
--   - Splitting the permission lets a tenant grant view-only branding
--     access to one role and module-toggle access to another, without a
--     custom_role row. Mirrors how school.manage_branding,
--     school.manage_billing, school.manage_domain are already split out
--     (see 20260416200100_school_admin_extra_permissions.sql).
--
-- Pattern: identical to the predecessor migration
-- 20260416200100_school_admin_extra_permissions.sql — INSERT … ON CONFLICT
-- DO NOTHING for both the permission row and the role binding.
--
-- Idempotent: ✅ both inserts use ON CONFLICT DO NOTHING.
-- Reversible:
--   DELETE FROM role_permissions
--     WHERE permission_id = (SELECT id FROM permissions WHERE code = 'school.manage_modules');
--   DELETE FROM permissions WHERE code = 'school.manage_modules';

INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('school.manage_modules', 'school', 'manage_modules', 'Toggle which platform modules (LMS, AI Tutor, Live Classes, etc.) are enabled for this school', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'institution_admin'
  AND p.code = 'school.manage_modules'
ON CONFLICT DO NOTHING;
