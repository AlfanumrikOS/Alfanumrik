-- Migration: 20260620000100_portal_rbac_remediation_phase0_content_read_alfabot_read_messages.sql
-- Purpose: PHASE 0 (continuation of 20260620000000) of the CEO-approved portal RBAC
--          remediation. Closes two more orphan permission codes found by the
--          rbac-permission-code drift-guard test (same bug class as
--          `school.manage_exams` / `teacher.read`):
--            (1) `content.read`         — LIVE STUDENT-FACING OUTAGE. Seed + grant.
--            (2) `alfabot.read_messages`— unmatrixed super-admin-only read. Seed + grant.
--
-- ─── Why this migration exists (ground truth — confirmed against PROD) ────────
--   PROD (project shktyoxqhundlvkiwguu) was queried read-only via PostgREST with
--   the service role on 2026-06-16. Findings:
--     * `content.read` — ABSENT from the `permissions` table on prod (the only
--       content.* rows are CMS/authoring codes: content.manage / .create / .edit /
--       .submit_review / .view_all / .manage_questions / .manage_media / .review /
--       .approve / .reject / .view_drafts — NONE of which is a student-facing
--       content READ code). It is referenced by:
--         src/app/api/concept-engine/route.ts:720  (action=chapter — student-facing)
--         src/app/api/concept-engine/route.ts:755  (action=search  — student-facing)
--       via authorizeRequest(request, 'content.read'). authorizeRequest resolves
--       the caller's granted codes from role_permissions, so a code that NO role
--       holds 403s EVERY non-super-admin caller — i.e. every STUDENT is currently
--       403'd on chapter/search reads. This is a live student-facing outage.
--     * `alfabot.read_messages` — ABSENT from the `permissions` table on prod (zero
--       alfabot.* rows exist). Referenced by:
--         src/app/api/super-admin/alfabot/sessions/[sessionId]/route.ts
--       That route currently calls authorizeAdmin(request, 'super_admin') (the
--       admin-tier system, NOT the RBAC-code system), so it functions today purely
--       via the super_admin level. The route's own header documents the intent to
--       swap to authorizeRequest(request, 'alfabot.read_messages') once the code
--       lands in the matrix. Seeding + granting it to super_admin makes that swap
--       safe and closes the matrix-drift hole.
--
-- ─── DECISION: SEED `content.read` (do NOT repoint the route) ─────────────────
--   The task asked: repoint the route to an existing granted student-read code
--   ONLY IF one exists that the route SHOULD use. The closest existing granted
--   code is `study_plan.view` (granted on prod to student, admin, super_admin,
--   tutor — and already used by the sibling NCERT content routes
--   /api/v2/learn/concept and /api/v2/learn/curriculum). It was REJECTED as the
--   target for repointing for three reasons:
--     1. Semantics. `study_plan.view` = "View assigned study plans" on the
--        `study_plan` resource. The concept-engine chapter/search branches read
--        raw NCERT curriculum content, not a study plan. `content.read` on the
--        `content` resource is the semantically correct, self-documenting gate.
--     2. Teacher coverage. `study_plan.view` is NOT granted to `teacher` on prod.
--        Teachers legitimately read chapter/search content for their classes;
--        repointing to study_plan.view would leave teachers 403'd. Seeding
--        content.read lets us grant student AND teacher in one shot.
--     3. Blast radius / matrix hygiene. Seeding is a single additive migration
--        that fixes the live outage atomically with no route-code change, no
--        rebuild, and no overloading of an already-overloaded code. It restores
--        matrix completeness (the drift-guard's purpose) rather than perpetuating
--        a semantic-overload workaround.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS — identical to 20260620000000) ─
--   - ADDITIVE ONLY. No DROP / DELETE / UPDATE / TRUNCATE. No destructive op.
--   - NO NEW TABLES -> no new RLS policy required. Only `permissions` and
--     `role_permissions` rows are inserted, through the service-role migration
--     runner, exactly as every prior RBAC seed migration does. Existing RLS
--     posture on permissions/roles/role_permissions is unchanged.
--   - IDEMPOTENT / re-runnable. Every INSERT is guarded:
--       * permissions      -> ON CONFLICT (code) DO NOTHING
--                             (UNIQUE constraint permissions_code_key).
--       * role_permissions -> ON CONFLICT (role_id, permission_id) DO NOTHING
--                             (UNIQUE role_permissions_role_id_permission_id_key).
--     Safe to replay on PROD, main-staging, CI live-DB, and fresh DBs.
--   - RESOLVE BY NAME / CODE, NEVER BY HARDCODED UUID. Every grant is a
--     roles x permissions SELECT-join keyed on r.name / p.code. If a referenced
--     role/permission is absent on a partially-seeded DB the join yields zero rows
--     (a silent no-op).
--   - COLUMN SHAPE. The `permissions` table is (id, code, resource, action,
--     description, is_active, created_at) — confirmed against prod. There is NO
--     `category` column; categorisation is carried by `resource` (here: 'content'
--     and 'alfabot'), matching 20260620000000 and every existing row.
--
-- ─── CEO approval posture ────────────────────────────────────────────────────
--   `content.read` and `alfabot.read_messages` are NEW permission codes and NEW
--   grants; per the constitution RBAC permission additions require user approval —
--   the CEO has approved this Phase 0 remediation and these specific codes.
--
-- ─── Cache behaviour post-deploy ─────────────────────────────────────────────
--   src/lib/rbac.ts caches per-user permission sets with a 5-minute TTL. After
--   this migration grants content.read to student + teacher, affected callers pick
--   the grant up within 5 minutes (or on next cache miss). No manual invalidation
--   required. The alfabot route currently uses the admin-tier path so its
--   behaviour is unchanged until backend swaps in authorizeRequest (optional).
--
-- ─── Testing handoff ─────────────────────────────────────────────────────────
--   `content.read` and `alfabot.read_messages` can now be REMOVED from the
--   KNOWN_UNGRANTED_CODES whitelist in
--   src/__tests__/rbac-permission-code-drift-guard.test.ts — once this migration
--   is on the canonical chain, both codes resolve in the canonical universe and
--   the drift guard stays green without the exceptions.
--
-- Owner: architect. Phase 0 (continuation) of feat/portal-rbac-saas-remediation.

BEGIN;

-- =============================================================================
-- 1. NEW PERMISSION CODE: content.read  (the live student-facing 403 fix)
-- =============================================================================
-- Grouped under the `content` resource alongside the rest of the content.* family
-- (content.manage, content.view_all, ...). This is the READ counterpart used by
-- the NCERT chapter/search content endpoints.
INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('content.read',
   'content',
   'read',
   'Read published curriculum content (NCERT chapter text + content search) via the concept-engine endpoints',
   true)
ON CONFLICT (code) DO NOTHING;

-- GRANT content.read -> student + teacher (the legitimate content readers).
-- Students hit /api/concept-engine action=chapter/search directly; teachers read
-- the same chapter/search content for their classes. study_plan.view (the only
-- pre-existing granted candidate) is NOT granted to teacher on prod, which is the
-- decisive reason we seed a dedicated read code rather than repoint the route.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name IN ('student', 'teacher')
   AND p.code = 'content.read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Defensive: ensure admin + super_admin also hold content.read explicitly, so the
-- grant is present even on an env where this file replays without the wildcard
-- matrix migration (20260612123200) re-running afterwards.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name IN ('admin', 'super_admin')
   AND p.code = 'content.read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =============================================================================
-- 2. NEW PERMISSION CODE: alfabot.read_messages  (matrix-completeness fix)
-- =============================================================================
-- Forensic message-content read for the super-admin AlfaBot session-detail route.
-- Deliberately super_admin-ONLY: this is the highest-privilege AlfaBot read (it
-- returns message CONTENT — the documented P13 exception, see the route header).
INSERT INTO permissions (code, resource, action, description, is_active) VALUES
  ('alfabot.read_messages',
   'alfabot',
   'read_messages',
   'Read full AlfaBot session message content for forensic abuse review (super-admin only; returns message content)',
   true)
ON CONFLICT (code) DO NOTHING;

-- GRANT alfabot.read_messages -> super_admin ONLY. Granting it explicitly (rather
-- than relying solely on the super_admin wildcard in 20260612123200) makes this
-- file self-sufficient on replay and lets the route safely swap to
-- authorizeRequest(request, 'alfabot.read_messages') later without changing the
-- effective authorization boundary.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'super_admin'
   AND p.code = 'alfabot.read_messages'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- 1. content.read now exists and is granted to student, teacher, admin, super_admin:
--    SELECT r.name FROM role_permissions rp
--      JOIN roles r       ON r.id = rp.role_id
--      JOIN permissions p ON p.id = rp.permission_id
--     WHERE p.code = 'content.read' ORDER BY r.name;
--      -- expect: admin, student, super_admin, teacher
-- 2. alfabot.read_messages exists and is granted to super_admin only:
--    SELECT r.name FROM role_permissions rp
--      JOIN roles r       ON r.id = rp.role_id
--      JOIN permissions p ON p.id = rp.permission_id
--     WHERE p.code = 'alfabot.read_messages' ORDER BY r.name;
--      -- expect: super_admin
