-- Migration: 20260610110000_seed_content_and_diagnostic_permissions.sql
-- Purpose: CEO-approved (2026-06-10) seed of THREE RBAC permission codes that
--          API routes already enforce via authorizeRequest()/authorizeSchoolAdmin()
--          but which have NO row in public.permissions on PROD — so every call
--          currently 403s. Discovered in the cross-layer gap audit.
--
--   1. school.manage_content  → institution_admin
--        Closes the prod-403 gap for /api/school-admin/content and
--        /api/school-admin/content/bulk (GET/POST/PATCH/DELETE all call
--        authorizeSchoolAdmin(request, 'school.manage_content')).
--   2. diagnostic.attempt     → student
--   3. diagnostic.complete    → student
--        Close the prod-403 gap for /api/diagnostic/start and
--        /api/diagnostic/complete (authorizeRequest 'diagnostic.attempt' /
--        'diagnostic.complete').
--
-- ─── CEO approval ─────────────────────────────────────────────────────────────
-- Per `.claude/CLAUDE.md` ("User Approval Required For → RBAC role or permission
-- additions"), new permission codes require user approval. CEO approved this
-- exact 3-code, 3-grant matrix on 2026-06-10.
--
-- ─── Provenance note (diagnostic.*) ───────────────────────────────────────────
-- A legacy file (_legacy/timestamped/20260409000005_add_diagnostic_permissions.sql)
-- defined the same two diagnostic codes, but it lives under supabase/migrations/
-- _legacy/ — the Supabase CLI only applies files at the immediate migrations/
-- root, and a read-only PROD check (2026-06-10, 84 active permission rows)
-- confirmed NONE of the three codes exist there. This is therefore a FIRST-TIME
-- seed that will actually execute on PROD, not a re-assertion.
--
-- ─── Role-grant scope (mirrors existing posture) ──────────────────────────────
--   institution_admin (hierarchy 70) — gets school.manage_content only. Every
--     existing school.* permission is granted to exactly ONE role
--     (institution_admin); this preserves that 1:1 pattern.
--   student — gets the two diagnostic.* codes only.
--   admin / super_admin — no explicit grant needed: admin holds all permissions
--     via the wildcard grant in the base RBAC seed, and super_admin additionally
--     bypasses in hasPermission(). Roles are resolved BY NAME via SELECT-join —
--     never hardcoded UUIDs. If a role row is absent (fresh DB before the role
--     seed), the join yields zero rows and the grant is a silent no-op, matching
--     20260507110000_add_school_manage_modules_permission.sql.
--
-- ─── Idempotency mechanics ────────────────────────────────────────────────────
--   permissions:      ON CONFLICT (code) DO NOTHING — backed by UNIQUE
--                     constraint permissions_code_key (baseline line 15732).
--   role_permissions: ON CONFLICT DO NOTHING — backed by UNIQUE constraint
--                     role_permissions_role_id_permission_id_key
--                     (role_id, permission_id) (baseline line 15908), so the
--                     bare ON CONFLICT clause is sufficient; no WHERE NOT EXISTS
--                     guard is needed.
--   granted_by is intentionally omitted → NULL (seed-style row, matching every
--   existing migration-seeded grant). granted_at defaults to now().
--
-- ─── Cache behaviour post-deploy ──────────────────────────────────────────────
-- src/lib/rbac.ts caches per-user permission sets with a 5-minute TTL
-- (CACHE_TTL_SECS, rbac.ts:50; Redis + in-memory fallback). New grants
-- self-heal within ≤5 minutes of this migration applying — no manual cache
-- invalidation step is required.
--
-- ─── Scope / safety contract ──────────────────────────────────────────────────
--   - ADDITIVE: only INSERTs into permissions + role_permissions. No new tables,
--     no schema mutation, no DROP, no UPDATE/DELETE. RLS: N/A — no new tables;
--     both target tables keep their existing baseline RLS posture and rows are
--     inserted through the service-role migration runner.
--   - IDEMPOTENT: safe to replay on PROD, staging, CI live-DB, and fresh DBs.
--
-- ─── Reversible ───────────────────────────────────────────────────────────────
--   DELETE FROM role_permissions WHERE permission_id IN (
--     SELECT id FROM permissions WHERE code IN (
--       'school.manage_content', 'diagnostic.attempt', 'diagnostic.complete'));
--   DELETE FROM permissions WHERE code IN (
--     'school.manage_content', 'diagnostic.attempt', 'diagnostic.complete');

BEGIN;

-- ─── 1. Insert permission definitions (idempotent) ────────────────────────────

INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('school.manage_content',
   'school', 'manage_content',
   'Manage school-scoped question content (create, edit, approve, bulk upload)',
   true),
  ('diagnostic.attempt',
   'diagnostic', 'attempt',
   'Start a diagnostic assessment',
   true),
  ('diagnostic.complete',
   'diagnostic', 'complete',
   'Submit a completed diagnostic assessment',
   true)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Grant school.manage_content to institution_admin (idempotent) ─────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'institution_admin'
  AND p.code = 'school.manage_content'
ON CONFLICT DO NOTHING;

-- ─── 3. Grant diagnostic.attempt + diagnostic.complete to student (idempotent) ─

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'student'
  AND p.code IN ('diagnostic.attempt', 'diagnostic.complete')
ON CONFLICT DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ─────────────────────────────────────
-- SELECT r.name AS role, p.code AS permission
--   FROM role_permissions rp
--   JOIN roles r       ON r.id = rp.role_id
--   JOIN permissions p ON p.id = rp.permission_id
--  WHERE p.code IN ('school.manage_content', 'diagnostic.attempt', 'diagnostic.complete')
--  ORDER BY r.name, p.code;
-- Expected: 3 rows — institution_admin/school.manage_content,
--           student/diagnostic.attempt, student/diagnostic.complete.
