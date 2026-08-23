---
name: alfanumrik-identity-rbac
description: Auth, users, roles, tenant membership, school membership, enrolment, student rosters, admin consoles, and privilege checks. Use for anything touching who a user is, what school/tenant they belong to, what role or permission gates an action, or how a student ends up on a class roster.
user-invocable: false
---

# Skill: Identity & RBAC

Governs identity, tenancy, and privilege — not the SQL that implements it (see `supabase-patterns` for RLS/RPC templates) and not the general system-boundary question of who owns which table (see `alfanumrik-architecture` for that, and `docs/architecture/DATA_OWNERSHIP_MATRIX.md` for the full per-table write-owner list).

## Core rule: one source of truth per privilege/roster concept

Before adding a new roster, membership, or privilege table, check whether an existing one already owns that concept. Adding a second table (or a second code path) for the same real-world fact — "who is enrolled in this class", "who administers this school" — is exactly the failure mode this skill exists to prevent. See the live example below: it is not hypothetical.

## Live, unresolved example: the roster split-brain

Two tables both represent class-roster membership today:
- `class_students` — written by the school-admin "add student" path; read by SECURITY DEFINER roster RPCs.
- `class_enrollments` — written by self-service enroll/join paths; read by parent/calendar/teacher/report/leaderboard surfaces.

`supabase/migrations/20260620000700_sync_class_students_class_enrollments.sql` bridges them with bidirectional triggers so a student enrolled via either table appears on both. **This is a transitional implementation detail, not a design pattern to imitate, and not evidence that either table is canonical.** Which one *should* be the single source of truth is an open architecture decision, gated on a CEO-approved cutover — this skill does not decide it, and no code change should silently declare one canonical (e.g. by reading only one of the two going forward) without that approval.

**Before touching either table:** identify which surfaces read which table today, propose an explicit compatibility/migration/rollback plan (which reads move first, what breaks if the sync trigger is removed early, how to revert), and get architect + orchestrator sign-off before writing new code against only one side.

## Auth surface (current implementation)

- `apps/host/src/proxy.ts` — middleware entrypoint (session refresh, rate limiting, bot detection); renamed from `middleware.ts` for Next.js 16.
- `packages/lib/src/rbac.ts` — `authorizeRequest(request, 'permission.code')`, the 3-layer check (permission → ownership → audit log) used by most API routes.
- `packages/lib/src/admin-auth.ts` — `authorizeAdmin(request, level)`, ranked tiers `support(0) < analyst(1) < content_manager(2) < finance(3) < admin(4) < super_admin(5)`, the dominant convention for `/api/super-admin/*`.
- `packages/lib/src/school-admin-auth.ts` — a **separate** tier system for school-admin (not unified with `admin-auth.ts`'s super-admin tiers). Treat these as two distinct authority ladders; do not assume a school-admin level implies an equivalent super-admin level or vice versa.
- `packages/lib/src/identity/*` — signup/onboarding/bootstrap surface: `bootstrap-profile.ts`, `complete-signup.ts`, `onboarding.ts`, `guardian-invite.ts`, `school-admin-bootstrap.ts`, `school-claim.ts` + `school-claim-wiring.ts`, `audit.ts`, `constants.ts`, `recovery-session-hash.ts`.
- `usePermissions()` (client) is UI convenience only — never a security boundary. Every enforcing check is server-side via `authorizeRequest`/`authorizeAdmin`/`school-admin-auth`.

## Tenant model

`School`/`Class` types carry a `tenant_type` (`school | coaching | corporate | government`, default `school`). Tenant isolation is enforced through RLS (policy detail owned by `supabase-patterns`) plus the application-layer checks above. A feature that reads across schools/tenants without an explicit, reviewed cross-tenant grant (e.g. a super-admin route) is a defect, not a convenience.

## Rules for any identity/RBAC/roster change

1. **No new roster, membership, or privilege table** without first checking `docs/architecture/DATA_OWNERSHIP_MATRIX.md` and this skill's live-example section for an existing owner.
2. **Never declare `class_students` or `class_enrollments` canonical** in code comments, a migration, or a skill/doc, without the CEO-approved cutover decision referenced above.
3. **Any consolidation of an identity/roster/privilege model requires, before implementation:** an explicit compatibility plan (what keeps working during the transition), a migration plan (order of operations), and a rollback plan (how to undo if the cutover fails partway).
4. **RLS syntax and migration templates are not repeated here** — write them per `supabase-patterns`; this skill only states the policy (isolation required, one owner per concept), not the SQL.
5. **Negative authorisation and cross-tenant tests are mandatory** for any new or changed privilege check. Follow existing patterns: `apps/host/src/__tests__/lib/rbac.test.ts`, `apps/host/src/__tests__/lib/rbac/matrix-conformance.test.ts`, `apps/host/src/__tests__/rbac-b2b-b2c-gaps.test.ts`, `apps/host/src/__tests__/school-admin-auth-rbac-narrowing.test.ts`, `eval/tenant-isolation/run.ts` (+ `eval/tenant-isolation/baseline.json`). A new permission or role without an accompanying "wrong actor is denied" test is incomplete.
6. Do not treat any untracked document as a required reference for the rules above -- an untracked file has not been reviewed or committed and may not reflect current, agreed guidance.

## Checklist

- [ ] Checked `DATA_OWNERSHIP_MATRIX.md` for an existing owner before adding a roster/privilege table
- [ ] Did not declare `class_students` or `class_enrollments` canonical without approval
- [ ] Compatibility/migration/rollback plan written before any roster/identity consolidation
- [ ] Server-side enforcement via `authorizeRequest`/`authorizeAdmin`/`school-admin-auth` — never client-only
- [ ] Negative + cross-tenant test added
- [ ] RLS policy detail deferred to `supabase-patterns`, not re-derived here

## What this skill does not own

RLS policy SQL and migration templates (`supabase-patterns`). System-wide domain-boundary/ownership framing beyond identity (`alfanumrik-architecture`). Student-data safety policy — consent, retention, PII redaction — (`alfanumrik-student-safety`).

## Review chain

Making agent: architect (schema/RBAC), backend (route enforcement), frontend (`usePermissions()` UI gating). Required reviewers: architect (permission model), backend, testing (negative/cross-tenant coverage), quality. Any roster/privilege consolidation escalates to the user per rule 3 above.
