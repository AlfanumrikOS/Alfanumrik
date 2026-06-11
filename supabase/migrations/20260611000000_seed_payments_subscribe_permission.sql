-- Migration: 20260611000000_seed_payments_subscribe_permission.sql
-- Purpose: CEO-approved (Phase 1 FOUNDATION) seed of ONE RBAC permission code
--          ('payments.subscribe') that the payment-initiation / verification API
--          routes enforce via authorizeRequest() but which has NO row in
--          public.permissions on PROD — so every student-initiated subscribe call
--          currently 403s. Closes the cross-layer gap (Gap 2).
--
--   1. payments.subscribe  → student
--        Closes the prod-403 gap for the subscription-purchase funnel
--        (initiate order + verify payment) which authorizeRequest()s
--        'payments.subscribe'.
--
-- ─── CEO approval ─────────────────────────────────────────────────────────────
-- Per `.claude/CLAUDE.md` ("User Approval Required For → RBAC role or permission
-- additions"), new permission codes require user approval. CEO approved this
-- single-code, single-grant addition as part of Phase 1 FOUNDATION.
--
-- ─── Role-grant scope (mirrors existing posture) ──────────────────────────────
--   student — gets payments.subscribe (students initiate/verify their own
--     subscription purchase).
--   admin / super_admin — no explicit grant needed: admin holds all permissions
--     via the wildcard grant in the base RBAC seed, and super_admin additionally
--     bypasses in hasPermission(). Roles are resolved BY NAME via SELECT-join —
--     never hardcoded UUIDs. If the role row is absent (fresh DB before the role
--     seed), the join yields zero rows and the grant is a silent no-op, matching
--     20260610110000_seed_content_and_diagnostic_permissions.sql.
--
-- ─── Idempotency mechanics ────────────────────────────────────────────────────
--   permissions:      ON CONFLICT (code) DO NOTHING — backed by UNIQUE
--                     constraint permissions_code_key.
--   role_permissions: ON CONFLICT DO NOTHING — backed by UNIQUE constraint
--                     role_permissions_role_id_permission_id_key
--                     (role_id, permission_id), so the bare ON CONFLICT clause is
--                     sufficient; no WHERE NOT EXISTS guard is needed.
--   granted_by is intentionally omitted → NULL (seed-style row, matching every
--   existing migration-seeded grant). granted_at defaults to now().
--
-- ─── Cache behaviour post-deploy ──────────────────────────────────────────────
-- src/lib/rbac.ts caches per-user permission sets with a 5-minute TTL (Redis +
-- in-memory fallback). The new grant self-heals within ≤5 minutes of this
-- migration applying — no manual cache invalidation step is required.
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
--     SELECT id FROM permissions WHERE code = 'payments.subscribe');
--   DELETE FROM permissions WHERE code = 'payments.subscribe';

BEGIN;

-- ─── 1. Insert permission definition (idempotent) ─────────────────────────────

INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('payments.subscribe',
   'payments', 'subscribe',
   'Initiate and verify a subscription purchase',
   true)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Grant payments.subscribe to student (idempotent) ──────────────────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'student'
  AND p.code = 'payments.subscribe'
ON CONFLICT DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ─────────────────────────────────────
-- SELECT r.name AS role, p.code AS permission
--   FROM role_permissions rp
--   JOIN roles r       ON r.id = rp.role_id
--   JOIN permissions p ON p.id = rp.permission_id
--  WHERE p.code = 'payments.subscribe'
--  ORDER BY r.name, p.code;
-- Expected: 1 row — student/payments.subscribe.
