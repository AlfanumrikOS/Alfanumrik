# Target Identity Mechanism

**Status**: Design document (not yet implemented)
**Author**: Architect agent
**Date**: 2026-04-02
**Scope**: Auth, onboarding, access control, session management
**Out of scope**: Quiz logic, Foxy AI, billing flows, CMS, landing page, dashboard business logic

---

## 1. Design Principles

| # | Principle | Meaning |
|---|-----------|---------|
| 1 | Server-authoritative | The client never decides identity state. Every state transition originates from a server RPC, middleware check, or database trigger. The client reads and displays state; it does not compute it. |
| 2 | Idempotent | Every identity operation (bootstrap, repair, role assignment) is safe to call multiple times with the same inputs. Duplicate calls produce the same result without side effects. |
| 3 | Observable | Every state transition writes to `auth_audit_log`. Every failed transition writes to `auth_audit_log` with an error payload. No silent failures. |
| 4 | Repairable | Every broken state (missing profile, missing onboarding_state, orphaned auth user) has a documented recovery path. The `repair_user_identity()` RPC can fix any known broken state. |
| 5 | Testable | Every auth flow has at least one regression test. Every state transition has a unit test. Every error path has a negative test. |
| 6 | Deterministic | Given the same auth.uid(), role, and onboarding state, the system always routes to the same destination. No race conditions in bootstrap. No ambiguous states. |

---

## 2. Architecture Layers

The identity system has four layers. Each layer depends only on the layer below it.

```
+------------------------------------------------------------------+
|  Layer 4: DELIVERY                                                |
|  Route protection, redirects, role-based destinations             |
|  Files: middleware.ts, route-access-contract.md                   |
+------------------------------------------------------------------+
|  Layer 3: ACCESS CONTROL                                          |
|  RBAC permissions, RLS policies, API authorization                |
|  Files: rbac.ts, admin-auth.ts, authorizeRequest()               |
+------------------------------------------------------------------+
|  Layer 2: APP IDENTITY                                            |
|  User profile, role assignment, onboarding state machine          |
|  Files: bootstrap_user_profile() RPC, onboarding-contract.md     |
+------------------------------------------------------------------+
|  Layer 1: AUTH                                                    |
|  Supabase Auth, session tokens, PKCE, email verification          |
|  Files: supabase auth, auth-contract.md                           |
+------------------------------------------------------------------+
```

### Layer 1: Auth (Supabase Auth)

Responsibility: Authenticate the human. Produce a JWT with `auth.uid()`.

- Email/password sign-up and sign-in
- PKCE code exchange for OAuth-style callback
- Token hash handling for email confirmation and password reset
- Session cookie management via middleware
- Token refresh on page load and tab switch

This layer knows nothing about roles, profiles, or onboarding. It only answers: "Is this a valid authenticated user, and what is their `auth.uid()`?"

### Layer 2: App Identity (Bootstrap + Onboarding)

Responsibility: Given an `auth.uid()`, ensure the user has a complete application identity.

- `bootstrap_user_profile()` RPC: Creates `profiles` row, `user_roles` row, `onboarding_state` row in a single transaction
- Onboarding state machine: Tracks whether the user has completed all required setup steps for their role
- Role assignment: Determines the user's role (student, parent, teacher, tutor, admin, super_admin)
- Demo account provisioning: Special bootstrap path for demo accounts

This layer knows nothing about route protection or permissions. It only answers: "Does this `auth.uid()` have a complete profile, and has onboarding been completed?"

### Layer 3: Access Control (RBAC + RLS)

Responsibility: Given a user with a known role, determine what they can do.

- RBAC: 6 roles, 71 permissions, checked via `authorizeRequest()` on API routes
- RLS: Row-level security policies on all tables, enforced by Postgres
- Parent-child links: `guardian_student_links` with `status = 'approved'`
- Teacher-student links: `class_enrollments` via `classes`
- Admin bypass: Service role client (`supabase-admin.ts`) for server-only operations

This layer knows nothing about routes or UI. It only answers: "Can this user perform this action on this resource?"

### Layer 4: Delivery (Routes + Middleware)

Responsibility: Given a user's identity state, route them to the correct page.

- Middleware: Session refresh, security headers, bot blocking, rate limiting, auth checks
- Route protection: Public vs. protected vs. onboarding-required vs. admin
- Role-based destinations: After login, each role goes to their portal
- Redirect rules: Unauthenticated users to /login, incomplete onboarding to /onboarding

This layer depends on all three layers below it.

---

## 3. State Machine: User Lifecycle

```
                     +------------------+
                     |  UNAUTHENTICATED |
                     +--------+---------+
                              |
                        sign up / sign in
                              |
                     +--------v---------+
                     |  AUTHENTICATED   |
                     |  (JWT exists,    |
                     |   no profile)    |
                     +--------+---------+
                              |
                    bootstrap_user_profile()
                              |
                     +--------v---------+
                     |  BOOTSTRAPPING   |
                     |  (profile being  |
                     |   created)       |
                     +--------+---------+
                              |
                       success / failure
                       /              \
              +-------v---+     +------v--------+
              | ONBOARDING|     | BOOTSTRAP_    |
              | _PENDING  |     | FAILED        |
              | (profile  |     | (repair path) |
              |  exists,  |     +---------------+
              |  setup    |
              |  incomplete)
              +-----+-----+
                    |
              complete onboarding steps
                    |
              +-----v------+
              |  ONBOARDED  |
              |  (all setup |
              |   complete) |
              +-----+------+
                    |
              first meaningful action
                    |
              +-----v------+
              |   ACTIVE    |
              |  (using the |
              |   platform) |
              +-------------+
```

### State Definitions

| State | Condition | Allowed Routes |
|-------|-----------|----------------|
| UNAUTHENTICATED | No valid session | Public routes only |
| AUTHENTICATED | Valid JWT, no `profiles` row | /auth/callback, bootstrap triggers |
| BOOTSTRAPPING | `bootstrap_user_profile()` in progress | Wait state (< 2 seconds) |
| BOOTSTRAP_FAILED | Bootstrap RPC returned error | /onboarding (with repair trigger) |
| ONBOARDING_PENDING | Profile exists, `onboarding_state.status != 'completed'` | /onboarding only |
| ONBOARDED | `onboarding_state.status = 'completed'` | All role-appropriate routes |
| ACTIVE | Onboarded + has at least one quiz attempt or session | All role-appropriate routes |

### State Transitions

| From | To | Trigger | Side Effects |
|------|----|---------|--------------|
| UNAUTHENTICATED | AUTHENTICATED | Supabase auth sign-in/sign-up | JWT issued, session cookie set |
| AUTHENTICATED | BOOTSTRAPPING | Auth callback or AuthContext detects missing profile | `bootstrap_user_profile()` called |
| BOOTSTRAPPING | ONBOARDING_PENDING | Bootstrap RPC succeeds | `profiles`, `user_roles`, `onboarding_state` rows created; `auth_audit_log` entry |
| BOOTSTRAPPING | BOOTSTRAP_FAILED | Bootstrap RPC fails | `auth_audit_log` error entry |
| BOOTSTRAP_FAILED | BOOTSTRAPPING | Retry (automatic or manual) | `repair_user_identity()` called |
| ONBOARDING_PENDING | ONBOARDED | All required onboarding steps completed | `onboarding_state.status` set to `'completed'`; `auth_audit_log` entry |
| ONBOARDED | ACTIVE | First quiz attempt, AI interaction, or meaningful action | Organic transition, no explicit trigger |
| ANY | UNAUTHENTICATED | Logout or session expiry | Session cookie cleared, JWT revoked |

---

## 4. Component Inventory (Target State)

### Server Components (Source of Truth)

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `bootstrap_user_profile()` | SQL RPC | Single-transaction profile creation. Inputs: auth_user_id, email, role, full_name. Creates: profiles, user_roles, onboarding_state. Idempotent. |
| `repair_user_identity()` | SQL RPC (new) | Detects and fixes broken states. Checks for: missing profile, missing onboarding_state, missing user_roles, orphaned records. Idempotent. |
| `get_identity_state()` | SQL RPC (new) | Returns the complete identity state for an auth.uid(): profile, role, onboarding status, subscription. Single query. |
| `complete_onboarding_step()` | SQL RPC (new) | Marks a single onboarding step as complete. Checks if all steps done and transitions to ONBOARDED. |
| Auth callback handler | `/api/auth/callback` | PKCE code exchange, token hash handling, bootstrap trigger. |
| Session middleware | `src/middleware.ts` | Session refresh, identity state check, route protection. |
| `authorizeRequest()` | `src/lib/rbac.ts` | RBAC permission check for API routes. |

### Client Components (Display Only)

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `AuthContext` | `src/lib/AuthContext.tsx` | Subscribes to auth state changes. Calls `get_identity_state()` on mount. Provides identity state to UI. Does NOT compute identity state. |
| `useIdentityState()` | `src/lib/useIdentityState.ts` (new) | Hook that reads identity state from AuthContext. Returns: loading, user, profile, role, onboardingComplete, isDemo. |
| `usePermissions()` | `src/lib/usePermissions.ts` | UI convenience for showing/hiding elements by permission. Not a security boundary. |
| Role destination map | `src/lib/role-destinations.ts` (new) | Single source of truth for where each role goes after login. Currently duplicated in 4 places. |

### Database Tables (Identity-Related)

| Table | Purpose | RLS |
|-------|---------|-----|
| `profiles` | Core user profile (full_name, avatar, grade, is_demo) | User reads own; parent reads linked; teacher reads assigned |
| `user_roles` | Role assignment (role, is_active, assigned_by) | User reads own; admin manages |
| `onboarding_state` | Onboarding progress (status, current_step, steps_completed) | User reads own; admin reads all |
| `students` | Student-specific data (auth_user_id, grade, school) | Student reads own; parent reads linked; teacher reads assigned |
| `teachers` | Teacher-specific data (auth_user_id, subjects, school) | Teacher reads own; admin reads all |
| `guardians` | Parent/guardian data (auth_user_id, relation) | Guardian reads own; admin reads all |
| `guardian_student_links` | Parent-child relationships (status: pending/approved/rejected) | Both parties read own; admin manages |
| `demo_accounts` | Demo account registry (role, is_active, last_reset) | Admin only |
| `auth_audit_log` | All identity state transitions | User reads own; admin reads all |

---

## 5. Migration Plan: Current to Target

### Phase 1: Centralize (Non-Breaking)

**Goal**: Move scattered logic into single-source-of-truth locations without changing behavior.

| Step | Change | Risk |
|------|--------|------|
| 1.1 | Create `role-destinations.ts` with the canonical role-to-route map | Low |
| 1.2 | Replace all 4 duplicated destination maps to import from `role-destinations.ts` | Low |
| 1.3 | Create `get_identity_state()` RPC that returns profile + role + onboarding in one call | Low |
| 1.4 | Create `repair_user_identity()` RPC | Low |
| 1.5 | Add `auth_audit_log` entries for all state transitions not currently logged | Low |

### Phase 2: Simplify AuthContext (Careful)

**Goal**: Reduce AuthContext from 425 lines to under 200 by moving logic server-side.

| Step | Change | Risk |
|------|--------|------|
| 2.1 | Replace multi-query profile fetch with single `get_identity_state()` call | Medium |
| 2.2 | Remove client-side bootstrap fallback chain; rely on callback + repair RPC | Medium |
| 2.3 | Extract `useIdentityState()` hook from AuthContext | Low |
| 2.4 | Ensure demo accounts always have onboarding_state rows (migration) | Low |

### Phase 3: Formalize Onboarding State Machine (New Feature)

**Goal**: Explicit state machine with guards and transitions.

| Step | Change | Risk |
|------|--------|------|
| 3.1 | Add `onboarding_state.status` enum: `pending`, `in_progress`, `completed`, `skipped` | Low |
| 3.2 | Create `complete_onboarding_step()` RPC with step validation | Low |
| 3.3 | Add middleware check: if onboarding incomplete, redirect to /onboarding | Medium |
| 3.4 | Ensure all existing users have valid onboarding_state rows (backfill migration) | Medium |

### Phase 4: Harden (CI + Tests)

**Goal**: Prevent regressions with CI gates and comprehensive tests.

| Step | Change | Risk |
|------|--------|------|
| 4.1 | Add CI gate: auth tests must pass before merge | Low |
| 4.2 | Add regression tests for every auth flow in auth-contract.md | Low |
| 4.3 | Add regression tests for onboarding state transitions | Low |
| 4.4 | Add E2E test: sign up -> bootstrap -> onboard -> active | Medium |

### Phase 5: Clean Up

**Goal**: Remove dead code and fix remaining issues.

| Step | Change | Risk |
|------|--------|------|
| 5.1 | Remove hardcoded SITE_URL from email Edge Function; use env var | Low |
| 5.2 | Remove any remaining client-side identity computation | Low |
| 5.3 | Audit all auth_audit_log entries for completeness | Low |

---

## 6. Risk Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| AuthContext refactor breaks existing sessions | Medium | High | Phase 2 changes are behind a feature flag. Old path remains as fallback for 2 weeks. |
| Onboarding redirect blocks existing users who never onboarded | Medium | High | Backfill migration (Phase 3.4) runs before middleware check (Phase 3.3) is enabled. |
| `repair_user_identity()` creates duplicate records | Low | High | RPC uses `INSERT ... ON CONFLICT DO NOTHING` and `IF NOT EXISTS` throughout. Covered by unit tests. |
| Demo accounts break during AuthContext simplification | Medium | Medium | Demo account tests run in CI. Phase 2 includes explicit demo account test coverage. |
| Race condition: two tabs trigger bootstrap simultaneously | Low | Medium | `bootstrap_user_profile()` already uses `ON CONFLICT DO NOTHING`. `get_identity_state()` is a pure read. |
| Email Edge Function breaks when SITE_URL changes | Low | Low | Phase 5.1 moves to env var. Existing hardcoded value remains as fallback default. |

---

## 7. Success Criteria

The target identity mechanism is complete when:

1. **Single source of truth**: Role destinations defined in exactly 1 file. Identity state computed by exactly 1 RPC.
2. **AuthContext under 200 lines**: No fallback chains, no multi-query profile fetching, no client-side bootstrap logic.
3. **All demo accounts have onboarding_state rows**: Zero demo accounts missing required identity records.
4. **Onboarding state machine enforced**: Middleware redirects incomplete onboarding. State transitions logged.
5. **No hardcoded SITE_URL**: Email Edge Function reads from environment.
6. **CI gate for auth tests**: Auth test failures block merge.
7. **100% auth flow coverage**: Every flow in auth-contract.md has at least one regression test.
8. **Zero silent failures**: Every identity operation failure is logged to auth_audit_log.
9. **Repair RPC works**: `repair_user_identity()` can fix every known broken state documented in the risk register.
10. **117+ auth tests passing**: No test regressions from current baseline.

---

## 8. Cross-Agent Notifications

Per the review chain requirements, changes to the identity mechanism trigger:

| Change | Notify |
|--------|--------|
| New RPCs (get_identity_state, repair_user_identity, complete_onboarding_step) | backend, testing |
| AuthContext refactor | frontend, testing |
| Middleware route protection changes | backend, frontend, ops, testing |
| Onboarding state machine migration | frontend, testing |
| CI pipeline changes | ops, testing |
| RLS policy changes on identity tables | backend, frontend, testing |
| Demo account provisioning changes | ops, testing |
