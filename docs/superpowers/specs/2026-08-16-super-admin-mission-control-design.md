# Super-Admin Mission Control — Phase Plan & CEO Decision Record

**Status:** APPROVED (CEO authorization recorded in §3, 2026-08-16). Phase 0 in progress.
**Date:** 2026-08-16
**Owner:** ops (this document + ongoing operational KPI/audit/feature-flag ownership) — implementation spans architect (RBAC/schema/RLS), backend (API routes), frontend (page/component work), assessment (learner-KPI sign-off where applicable), testing, quality.
**Scope:** The super-admin operational surface — `/super-admin/*` (66 `page.tsx`, verified 2026-08-16 via `find apps/host/src/app/super-admin -name page.tsx | wc -l`), `/api/super-admin/*` (127 `route.ts`, same method), `/internal/admin` (1-page tab SPA backed by `/api/internal/admin/*`), and `/api/v1/admin/*`. No student/parent/teacher-facing surface is in scope.
**Related:** `docs/runbooks/super-admin-orphaned-apis.md` (disposition ledger for every orphaned route named in §1.3), `.claude/skills/super-admin-reporting/SKILL.md` (standing ownership matrix and handoff protocol — unchanged by this plan; this plan operates inside it).

---

## 0. Executive summary

The super-admin surface split into two consoles that were never merged, sitting on two privilege models that were never synced, guarding roughly fifteen control-plane capabilities with no UI caller, writing audit trail to a legacy table nobody canonical reads, running duplicated subsystems with asymmetric safety guarantees, and missing basic user-lifecycle primitives (delete/anonymize, create-user). This is eight distinct, independently-verified root causes (§1), not one. CEO authorization on 2026-08-16 (§3, recorded verbatim) approves proceeding immediately on Phase 0 and sets the architectural mandate for everything after it: **RBAC (`user_roles` / `roles` / `role_permissions`) becomes the single authorization source of truth; `admin_users.admin_level` must not remain an independent security authority.**

The roadmap (§4) is seven phases, 0 through 6, ordered so that every phase after 0 depends only on RBAC unification (Phase 1) having landed first — console merge, access studio, user lifecycle, and report center all read the same authorization model rather than reconciling two.

---

## 1. Root-cause analysis (8 causes, verified 2026-08-16)

### R1 — Two consoles, never merged

`/super-admin` is a 66-page, 127-route surface (counted above). `/internal/admin` is a separate single-page app — `apps/host/src/app/internal/admin/page.tsx` (1 `page.tsx`, confirmed via `find apps/host/src/app/internal/admin -maxdepth 1 -name page.tsx`) — with its own 10-tab client-side SPA backed by a distinct API namespace, `/api/internal/admin/*` (`ai-monitor`, `bulk-action`, `command-center`, `content`, `feature-flags`, `logs`, `reports`, `revenue`, `schools`, `stats`, `support`, `support/metrics`, `users`, `users/[id]` — 13 route files). The two consoles overlap heavily in purpose (users, content, stats, feature flags, support all exist in both) but share no code, no nav, and no auth convention. The most damaging instance: the working support-ticket queue lives only in `/internal/admin`'s `SupportTab`; `/super-admin/support` shows unrelated user-activity/diagnostics lookups, not ticket content (root `CLAUDE.md` "Multi-portal app" bullet, `.claude/CLAUDE.md` Critical File Map "Support ticket operator console" row — both already carry a 2026-08-12 F12-audit note on this gap, extended by this plan; see §5 (Phase 0) and §2 of the Doc corrections below).

### R2 — Two unsynced privilege models

`admin_users.admin_level` is a 6-tier text enum — verified in `apps/host/src/app/api/super-admin/users/route.ts:86`: `z.enum(['support', 'analyst', 'content_manager', 'finance', 'admin', 'super_admin'])`. RBAC (`user_roles` JOIN `roles` JOIN `role_permissions`, `packages/lib/src/rbac.ts`) is a separate table set with `student`, `teacher`, `parent`, `institution_admin`, `admin`, `super_admin` and other roles resolved by `get_user_permissions`. The two models are bridged by exactly one migration, `supabase/migrations/20260803140000_reconcile_admin_users_to_rbac_super_admin.sql`, and its own header states the narrowness of the fix precisely: it is additive-only, grants the *existing* RBAC `super_admin` role to operators who are *already* active `admin_users` super_admins, and explicitly does nothing for any other tier. `analyst` already exists as an `admin_level` value but has no RBAC role counterpart at all (`packages/lib/src/rbac.ts` has no `analyst` role check; `analyst` appears only in `packages/lib/src/admin-auth.ts:31` and `packages/lib/src/validation.ts:116`, both `admin_level`-side). Every non-super_admin tier (`support`, `analyst`, `content_manager`, `finance`, `admin`) is authorized purely by the `admin_users` side today — RBAC has no opinion on them.

### R3 — Permission matrix frozen

`/api/v1/admin/roles` is a real, working matrix editor route (confirmed on disk: `apps/host/src/app/api/v1/admin/roles/route.ts`) but it has zero UI callers anywhere in `apps/host/src/app` — no admin page renders it. `authorizeAdmin(request, level)` (99 routes per the 2026-07-17 recount in `.claude/CLAUDE.md`) is the dominant convention over `authorizeRequest(request, 'perm')` (22 routes), so the RBAC permission model that `authorizeRequest` enforces is largely bypassed by the surface that would let an operator inspect or edit it.

### R4 — ~15 orphaned control-plane APIs

Verified present on disk with zero or near-zero UI callers as of 2026-08-16 (full disposition per route in `docs/runbooks/super-admin-orphaned-apis.md`): force logout (`/api/super-admin/sessions` POST, `action: 'force_logout'`), admin-tier change and profile edit (`/api/super-admin/users` PATCH — `admin_level`, `name`, `is_active`, plus `school_admins` reassignment), `force_link_guardian` (lives in `/api/internal/admin/users/[id]` PATCH, not `/api/super-admin` at all — a console-boundary orphan, not just a UI one), school reassignment (same `/api/super-admin/users` PATCH handler), `resend_invite`/`fix_relationship`/`reset_password` (`/api/super-admin/support` POST — three actions, one route file), alerts CRUD (`/api/super-admin/alerts` — full GET/POST/PATCH/DELETE), reconciliation approve/reject (`/api/super-admin/reconciliation` + `[id]/approve` + `[id]/reject` — superseded, see R6 below and the ledger), contracts (`/api/super-admin/contracts` + `[id]`, gated by `ff_school_contracts_v1`), seat-usage (`/api/super-admin/seat-usage`), tax-config (`/api/super-admin/billing/tax-config`), db-performance (`/api/super-admin/db-performance`), governance/health (`/api/super-admin/governance/health`), projectors/replay (`/api/super-admin/projectors/replay` — single-student event-bus subscriber re-invocation), `/api/v1/admin/roles` (R3), `/api/v1/admin/audit-logs`, `analytics/posthog-summary`, `institutions/[id]/admins`, `demo-accounts/[id]/resend-credentials`, and the `ai/[fn]` proxy dispatcher (10 allowed Edge Functions behind HMAC-signed internal-caller headers). Each is a real, auth-gated, working route — the gap is exclusively "no admin can reach it without curling it directly."

### R5 — Fragmented audit trail

All 13 `/api/internal/admin/*` route files write to the legacy `admin_audit_log` table via a `logAdminAction` helper that (per the console's own code) records `admin_id: null` — the acting operator's identity is not captured on that write path at all. The canonical, tamper-evident trail is `audit_logs`, written by `/api/super-admin/*` routes via `logAdminAudit` (`@alfanumrik/lib/admin-auth`). Two audit tables exist; only one is actor-attributed; nothing reconciles them.

### R6 — Duplicated subsystems, asymmetric safety

Feature flags, stats, and bulk actions each exist once under `/api/super-admin/*` and once under `/api/internal/admin/*`, implemented independently with different validation and different audit write paths (R5). Payment reconciliation is the clearest instance: `/api/super-admin/reconciliation` (+ `[id]/approve`, `[id]/reject`) is a full GET/POST route pair, but the live UI — `apps/host/src/app/super-admin/subscriptions/_components/PaymentOpsTab.tsx` — calls only `/api/super-admin/payment-ops/reconcile` (both single-row `reconcileSingle` and batch `reconcileAll`, verified at `PaymentOpsTab.tsx:225` and `:258`). A repo-wide search for other callers of `/api/super-admin/reconciliation` returns only the three route files that implement it — no page anywhere calls it. Two impersonation tables exist (see the orphaned-API ledger) and a `session-guard` Edge Function is dead code per the standing edge-function-catalog audit. `payment-ops/reconcile` is the surviving, UI-wired implementation; `reconciliation/*` is the orphan.

### R7 — Missing lifecycle primitives

No delete or anonymize path exists for a user record anywhere in `/api/super-admin/*` or `/api/internal/admin/*` (verified: no `DELETE` handler on `users/route.ts` in either namespace). No create-user / admin-provisioning route exists — new admin accounts are provisioned outside the panel entirely. This blocks a data-subject deletion request today with no operational tool short of a direct database operation, which is itself an unaudited, unsafe path.

### R8 — UI debt

Bilingual coverage across the panel is 23 of 90 pages (both consoles combined) per the Phase 0 audit inventory. A dark-mode toggle exists in code but has no live effect (dead code path). These are UI/a11y debt items scoped for Phase 6 (§4). **Update 2026-08-16:** `DetailDrawer` (the shared slide-over used across multiple pages) was originally flagged here as having no focus trap — a keyboard-accessibility defect — but this was closed within Phase 0, not deferred to Phase 6: `packages/ui/src/admin-ui/DetailDrawer.tsx` was refactored onto the shared overlay-primitives stack (`Portal`/`useFocusTrap`/`useEscapeKey`/`useScrollLock`/`useOverlayStack`), giving it a real Tab focus trap. Remaining Phase 6 scope for this finding is bilingual conformance and the dark-mode toggle only.

---

## 2. Target design (D1–D8)

**D1 — One privilege model.** RBAC (`user_roles`/`roles`/`role_permissions`) becomes the single source of truth for every admin-tier authorization decision. A new `authorizeOperator(request, permissionCode)` helper (backend/architect-owned) replaces both `authorizeAdmin(level)` and the bare `authorizeRequest(request, 'perm')` call sites inside `/api/super-admin/*` and `/api/internal/admin/*`. A DB trigger on `admin_users` (architect-owned migration) keeps `admin_level` changes synced into the equivalent RBAC role grant going forward — not just the one-time backfill in `20260803140000` — until `admin_level` itself is retired as a security-bearing column. New `analyst` RBAC role: tightly scoped, read-only, operational/reporting permissions only (no mutation permissions) — per CEO authorization §3.

**D2 — One console.** `/internal/admin` is merged into `/super-admin`. The support queue (`SupportTab`'s real ticket content) is the first thing merged, ahead of everything else in Phase 2 scope, given it is the one capability the current `/super-admin/support` page structurally cannot show. Every `/internal/admin` capability gets a capability-parity test (testing-owned) asserting the merged `/super-admin` route/page reproduces it before the legacy `/internal/admin` route or page is deleted — deletion is gated on green parity tests, not on a calendar date.

**D3 — Users 360.** A single user-record view spanning identity, role/permission grants, subscription/plan state, support-ticket history, and audit history for that user, plus full lifecycle: create (admin-provisioning), suspend/restore (already exists), anonymize (new — see D-lifecycle below), and an exceptional hard-delete path that is runbook-controlled, not self-service in the UI.

**D4 — Role & Access Studio.** A real UI over `/api/v1/admin/roles` (or its RBAC-unified successor): permission-matrix editor, custom-role creation, an "effective permission" trace (given a user, show every permission they hold and which role grant produced it), and dual-control (two-operator approval) for the high-risk privilege changes named in the CEO authorization (§3). This is also the intended replacement for the `debug/whoami` route removed in Phase 0 (§3) — access-explanation tooling that answers "what can this operator do and why" without a raw debug endpoint in production.

**D5 — Unified tamper-evident audit.** One audit table (`audit_logs`, the existing canonical one) for every admin-plane write, actor-attributed on every row (closing the `admin_id: null` gap in R5), with the marking-audit-view pattern (`supabase/migrations/20260504100400_marking_audit_view.sql`) as the template for a service-role-only, append-only read model.

**D6 — Single impersonation system.** Collapse the two existing impersonation tables into one, with the same audit and dual-control posture as any other high-risk operation.

**D7 — Report Center.** Charts (not just tables), saved report definitions, and export as both on-demand PDF and scheduled export — built on the existing `reports`/`analytics`/`strategic-reports` API surface rather than a new one, per the standing `super-admin-reporting` skill's ownership matrix (metric definitions stay ops-owned; learner KPIs still require assessment sign-off before this phase touches them).

**D8 — UI/a11y/bilingual conformance.** Close the 23/90 bilingual gap and either wire or remove the dead dark-mode toggle. Frontend-owned; ops defines which pages are in scope per the existing per-page ownership table in the `super-admin-reporting` skill. *(Update 2026-08-16: the `DetailDrawer` focus-trap item originally scoped here shipped early, in Phase 0 — `packages/ui/src/admin-ui/DetailDrawer.tsx` was refactored onto the shared overlay-primitives stack (Portal/useFocusTrap/useEscapeKey/useScrollLock/useOverlayStack), giving it a real Tab focus trap. It is complete and removed from D8's remaining scope.)*

---

## 3. CEO AUTHORIZATION — 2026-08-16 (verbatim record)

> Phase 0 proceed immediately. APPROVED analyst RBAC role as tightly scoped read-only operational/reporting role. APPROVED anonymize-first user lifecycle (hard deletion exceptional, runbook-controlled). APPROVED consolidating /internal/admin into /super-admin subject to capability-parity tests before legacy deletion. APPROVED dual-control for defined high-risk privileges and destructive operations only. APPROVED removing debug/whoami secret path from production (hardened diagnostics remain in dev/staging; ultimately replaced by Access Studio access-explanation tooling). ARCHITECTURAL MANDATE: RBAC becomes the single authorization source of truth — admin_level must not remain an independent security authority. RELEASE BLOCKERS: privilege-sync regression tests, permission-matrix tests, force-logout safety, canonical audit-path verification, console capability-parity tests.

This record is the authorization basis for §2 (D1–D8) and §4 (phase roadmap). It does not itself authorize any specific migration, route change, or page merge — each still goes through the standard review chains in `.claude/CLAUDE.md` (RBAC/auth changes: architect → backend, frontend, ops, testing; super-admin pages: frontend → ops, testing; super-admin reporting APIs: backend → frontend, ops, assessment if learner-facing, testing) and the release gates in `.claude/skills/release-gates/SKILL.md`. The five named release blockers are non-negotiable gates on any phase that touches authorization, audit, or console-merge deletion — none of Phases 1–2 may ship without them passing.

---

## 4. Phase roadmap (0–6)

| Phase | Name | Risk | Scope | Depends on |
|---|---|---|---|---|
| 0 | Quick-wins wiring | Low | Wire the highest-value orphaned APIs (R4) with a UI: force logout, admin PATCH (profile + admin_level), support `resend_invite`/`fix_relationship`/`reset_password`. Remove `debug/whoami` from production (CEO-approved, §3). Add a real "Support Tickets" nav entry in `/super-admin` cross-linking to `/internal/admin`'s working queue as an interim bridge (full merge is Phase 2). No schema change, no authz-model change. | none (self-contained) |
| 1 | Authz unification | High | D1: `authorizeOperator` helper, `admin_users`→RBAC sync trigger, `analyst` RBAC role, migrate `/api/super-admin/*` and `/api/internal/admin/*` call sites off `authorizeAdmin(level)`/bare `authorizeRequest`. Release blockers: privilege-sync regression tests, permission-matrix tests must exist and pass before any route cutover merges. | Phase 0 (clean baseline; no functional dependency but sequenced first for safety) |
| 2 | Console merge | High | D2: merge `/internal/admin` into `/super-admin`, support queue first. Capability-parity tests (testing-owned) required green before any legacy `/internal/admin` route/page deletion. Reconciliation route family (R6) deleted here once parity/no-caller status is reconfirmed at execution time. | Phase 1 (merged console must sit on one authz model, not two) |
| 3 | Access Studio | Medium | D4: matrix editor UI, custom roles, effective-permission trace, dual-control for defined high-risk operations. `/api/v1/admin/roles` gets its first UI caller here. | Phase 1 |
| 4 | Users 360 + lifecycle | Medium | D3: unified user view, create-user/admin-provisioning route, anonymize-first deletion flow, exceptional hard-delete runbook. | Phases 1–2 (needs unified authz + merged console for a single "users" surface) |
| 5 | Report Center | Medium | D7: charts, saved reports, PDF + scheduled export. `/api/v1/admin/audit-logs` gets a UI here (unified audit view, D5 groundwork). | Phase 2 (reads the merged console's data), assessment sign-off for any learner-KPI report per the `super-admin-reporting` skill |
| 6 | Polish / a11y | Low | D8: bilingual conformance, dark-mode toggle wire-or-remove. (`DetailDrawer` focus trap shipped early, in Phase 0 — update 2026-08-16; no longer part of Phase 6 scope.) | none blocking (can run in parallel with 3–5 for pages already stable) |

Every phase above D1 (i.e., Phases 2 onward) that changes authorization, audit, or deletes a legacy route/page must satisfy the five release blockers named in §3 before merge — this is a standing gate, not a per-phase checklist item to be re-litigated.
