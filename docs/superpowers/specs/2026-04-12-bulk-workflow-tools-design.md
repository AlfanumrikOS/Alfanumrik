# Phase 4: Bulk Workflow Tools — Design Spec

**Date:** 2026-04-12
**Status:** Design approved

---

## Context

Four admin workflows are currently one-at-a-time: subscription plan changes, account suspension/restoration, notification dispatch, and invite resends. An internal bulk-action API exists (`/api/internal/admin/bulk-action/`) for plan changes and suspend/restore but is not exposed in the super-admin UI. The `notifications` table and batch insertion pattern (parent digests) already exist. This phase surfaces existing capabilities and adds two new batch endpoints.

## Architecture

One new page at `/super-admin/bulk-actions` with 4 tabs. No new database tables.

### Tabs and backends

| Tab | Backend | New? |
|---|---|---|
| Plan Changes | Wraps `/api/internal/admin/bulk-action` (upgrade_plan/downgrade_plan) | New super-admin wrapper route |
| Suspend/Restore | Wraps `/api/internal/admin/bulk-action` (suspend/restore) | New super-admin wrapper route |
| Notifications | `POST /api/super-admin/bulk-actions/notify` → batch insert into `notifications` | New route |
| Invite Resend | `POST /api/super-admin/bulk-actions/resend-invites` → batch call `send-auth-email` | New route |

### Shared UI pattern

All 4 tabs share the same structure:
1. Filter bar — grade, plan, status, last active, search
2. Student table with checkboxes — select rows or "select all matching"
3. Action panel — appears when ≥1 selected, shows count + action config + execute button
4. Progress indicator — X of Y processed
5. Result summary — success/failure counts, error details

### API routes (4 new)

| Route | Method | Purpose |
|---|---|---|
| `/api/super-admin/bulk-actions/plan-change` | POST | Wrapper: validates admin auth, calls internal bulk-action API with upgrade/downgrade |
| `/api/super-admin/bulk-actions/suspend-restore` | POST | Wrapper: validates admin auth, calls internal bulk-action API with suspend/restore |
| `/api/super-admin/bulk-actions/notify` | POST | Batch inserts notifications for selected student IDs with custom title/body/type |
| `/api/super-admin/bulk-actions/resend-invites` | POST | Batch resends verification emails for selected unverified students |

All routes: `authorizeAdmin()` + `logAdminAudit()` + `logOpsEvent()` for full audit trail.

### Student list API

Uses existing `/api/super-admin/users?role=student` with additional filter params. No new list endpoint needed — the existing users API supports search, pagination, and role filtering.

## Scope

### Ships
- Bulk Actions page with 4 tabs (1 page + ~5 components)
- 4 API routes (2 wrappers + 2 new)
- Nav entry in AdminShell
- Tests (Vitest + Playwright)
- Regression entries R50-R51

### Non-goals
- No CSV export of results
- No scheduled/deferred actions
- No approval workflow
- No undo
- No new database tables