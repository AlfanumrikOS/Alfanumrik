-- Migration: 20260806000400_seed_memory_self_access_permissions.sql
-- Purpose: Foxy North-Star Phase 1 (T2 What-Foxy-remembers screen) — seed the
--          permission codes `memory.view_own` + `memory.erase_own` and GRANT
--          both to the `student` role. Student self-access RBAC addition
--          approved 2026-08-05 under A3 (read + per-item erase only).
--
-- ─── What these codes gate ───────────────────────────────────────────────────
--   memory.view_own  — GET /api/learner/memory: the student reads what Foxy
--                      remembers about THEM (facade + memory layers), plus
--                      "correct" (annotation flag) on their own items.
--   memory.erase_own — per-item / per-layer erasure of the student's OWN
--                      memory, flowing THROUGH the existing DPDP machinery
--                      (data_erasure_requests + scope column from
--                      20260806000300 + memory/erasure-guard.ts). Never a
--                      direct DELETE from the route.
--
--   Like account.delete (20260505120000), these are SELF-SCOPE codes: a
--   regulatory/transparency floor (DPDP), not an authorization expansion.
--   Server-side ownership checks in the route layer are the actual security
--   boundary; the codes exist so the standard authorizeRequest pattern
--   doesn't reject the call. Nothing here grants access to ANOTHER student's
--   memory.
--
-- ─── Scope / safety contract (mirrors 20260620000500) ────────────────────────
--   - ADDITIVE ONLY. No DROP / DELETE / UPDATE / TRUNCATE.
--   - NO NEW TABLES -> no new RLS policy required.
--   - IDEMPOTENT: ON CONFLICT (code) DO NOTHING /
--     ON CONFLICT (role_id, permission_id) DO NOTHING.
--   - RESOLVE BY NAME / CODE, never by hardcoded UUID.
--   - Column shape (code, resource, action, description, is_active) per the
--     baseline; no `category` column — categorisation carried by `resource`.
--
-- Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
--       (T2 row; approval A3 APPROVED 2026-08-05, full approval, no conditions).
-- Owner: architect. Added: 2026-08-05.

BEGIN;

-- =============================================================================
-- 1. NEW PERMISSION CODES: memory.view_own / memory.erase_own
-- =============================================================================

INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('memory.view_own',
   'memory',
   'view_own',
   'View what Foxy remembers about YOUR OWN account (What-Foxy-remembers transparency screen; read + annotate). Self-scope only.',
   true),
  ('memory.erase_own',
   'memory',
   'erase_own',
   'Request per-item/per-layer erasure of YOUR OWN Foxy memory via the DPDP erasure flow (data_erasure_requests.scope). Self-scope only; never a direct delete.',
   true)
ON CONFLICT (code) DO NOTHING;

-- GRANT both codes -> student (the self-access role, per approval A3).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'student'
   AND p.code IN ('memory.view_own', 'memory.erase_own')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Defensive: admin + super_admin hold everything via the wildcard CROSS JOIN
-- grants in 20260612123200_rbac_matrix_conformance.sql, but the wildcard only
-- captures codes that exist when IT runs — explicit grants close the
-- replay-order hole (house pattern, mirrors 20260620000500).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name IN ('admin', 'super_admin')
   AND p.code IN ('memory.view_own', 'memory.erase_own')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
--   SELECT p.code, r.name FROM role_permissions rp
--     JOIN roles r       ON r.id = rp.role_id
--     JOIN permissions p ON p.id = rp.permission_id
--    WHERE p.code IN ('memory.view_own', 'memory.erase_own')
--    ORDER BY p.code, r.name;
--     -- expect each code: admin, student, super_admin
