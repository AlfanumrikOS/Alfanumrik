-- Migration: 20260416200100_school_admin_extra_permissions.sql
-- Purpose: Add missing permissions for school admin branding, billing, domain management
-- Applied via Supabase MCP on 2026-04-16

INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('school.manage_branding', 'school', 'manage_branding', 'Update school logo, colors, and tagline', true),
  ('school.manage_billing', 'school', 'manage_billing', 'View subscription details and seat usage', true),
  ('school.manage_domain', 'school', 'manage_domain', 'Configure custom domain for school', true),
  ('school.export_data', 'school', 'export_data', 'Export school data (students, reports)', true),
  ('school.manage_settings', 'school', 'manage_settings', 'Update school-level configuration', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'institution_admin'
  AND p.code IN (
    'school.manage_branding',
    'school.manage_billing',
    'school.manage_domain',
    'school.export_data',
    'school.manage_settings'
  )
ON CONFLICT DO NOTHING;