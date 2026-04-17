# Unicorn RBAC Phase 2C: Admin UI — RBAC Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add RBAC management pages to the super admin panel — API routes for elevations/impersonation/delegations CRUD, and a unified RBAC management page with tabbed views.

**Architecture:** Three new API routes under `/api/super-admin/rbac/` that use the Phase 2B manager modules. One new page at `/super-admin/rbac/` with tabs for Roles, Elevations, Impersonation, and Delegations. Follows existing super-admin patterns: `authorizeAdmin()` for auth, `AdminShell` wrapper, `DataTable`/`StatusBadge` components, `admin-styles` tokens. Nav item added to AdminShell.

**Tech Stack:** Next.js App Router, React 18, Tailwind 3.4, AdminShell pattern

**Depends on:** Phase 2B (rbac-elevation.ts, rbac-impersonation.ts, rbac-delegation.ts)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/app/api/super-admin/rbac/route.ts` | Unified RBAC API: elevations, impersonation, delegations CRUD |
| Create | `src/app/super-admin/rbac/page.tsx` | RBAC management page with tabs |
| Modify | `src/app/super-admin/_components/AdminShell.tsx` | Add RBAC nav item |

---

## Task 1: API Route — `/api/super-admin/rbac/route.ts`

Unified API route handling all RBAC management operations via `?action=` query parameter. Follows the existing pattern used by `/api/super-admin/roles/route.ts`.

**GET actions:** `elevations`, `impersonation_sessions`, `delegation_tokens`, `dashboard_stats`
**POST actions:** `grant_elevation`, `start_impersonation`, `create_delegation`, `revoke_elevation`, `end_impersonation`, `revoke_delegation`

Uses `authorizeAdmin()` from admin-auth.ts. Delegates to manager modules from Phase 2B. Logs all admin actions via `logAdminAudit()`.

## Task 2: RBAC Management Page

`/super-admin/rbac/page.tsx` — tabbed view with:
- **Dashboard tab**: Active elevations count, active impersonation sessions, active delegation tokens, recent audit events
- **Elevations tab**: DataTable of role_elevations, "Grant Elevation" form (user ID, role, duration, reason)
- **Impersonation tab**: DataTable of impersonation_sessions, "Start Impersonation" form (target user, reason)
- **Delegations tab**: DataTable of delegation_tokens, revoke button per row

Uses `AdminShell`, `useAdmin()`, `DataTable`, `StatusBadge` from existing admin components.

## Task 3: Nav Integration

Add `{ href: '/super-admin/rbac', label: 'RBAC', icon: '⛉' }` to NAV_ITEMS in AdminShell.tsx, positioned after "Users & Roles".

## Task 4: Verification

Type-check, lint, full test suite.
