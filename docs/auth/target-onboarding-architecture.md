# Target Onboarding Architecture

> Implemented 2026-04-02 as part of auth/onboarding hardening program.

## Design Principles

1. **Server-controlled**: Profile creation goes through a server API, not direct client inserts.
2. **Idempotent**: Bootstrap can be called multiple times safely (ON CONFLICT).
3. **Observable**: Every step is logged to `onboarding_state` and `auth_audit_log`.
4. **Repairable**: Admin can diagnose and fix stuck onboarding via `/api/auth/repair`.
5. **Fail-visible**: Errors are surfaced to the user, not swallowed.
6. **Defense in depth**: Multiple layers ensure profile creation (signup -> callback -> AuthContext).

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Identity (Supabase Auth)                           │
│ - Email/password signup via supabase.auth.signUp()          │
│ - Stores user_metadata (name, role, grade) as hints         │
│ - PKCE flow for email confirmation                          │
│ - Session management (cookies + localStorage)               │
└─────────────────┬───────────────────────────────────────────┘
                  │ auth identity created
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Bootstrap (Server-Controlled)                      │
│ - POST /api/auth/bootstrap                                  │
│ - Calls bootstrap_user_profile() RPC via admin client       │
│ - Creates profile in students/teachers/guardians            │
│ - Tracks state in onboarding_state table                    │
│ - Logs events to auth_audit_log                             │
│ - Returns profile_id + redirect destination                 │
└─────────────────┬───────────────────────────────────────────┘
                  │ profile created, role assigned
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Role Detection (get_user_role RPC)                 │
│ - AuthContext calls get_user_role() on every session init    │
│ - Checks students/teachers/guardians tables directly        │
│ - Returns verified roles, not client metadata               │
│ - Sets activeRole for routing/UI                            │
└─────────────────┬───────────────────────────────────────────┘
                  │ roles detected
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Application Routing                                │
│ - Student -> /dashboard                                     │
│ - Teacher -> /teacher                                       │
│ - Parent -> /parent                                         │
│ - Incomplete onboarding -> stays on /login or retry         │
└─────────────────────────────────────────────────────────────┘
```

## Bootstrap Trigger Points

Profile creation is attempted at three points (defense in depth):

| # | Trigger | When | How |
|---|---|---|---|
| 1 | **Signup (primary)** | After `signUp()` returns session | `AuthScreen` calls `POST /api/auth/bootstrap` |
| 2 | **Email callback** | User clicks confirmation link | `auth/callback/route.ts` calls `bootstrap_user_profile()` directly via admin |
| 3 | **AuthContext fallback** | User lands on app with no profile | `AuthContext.fetchUser()` calls `POST /api/auth/bootstrap` |

Each call is idempotent. If bootstrap already completed, it returns `already_completed`.

## Database Schema

### onboarding_state
| Column | Type | Purpose |
|---|---|---|
| auth_user_id | UUID (unique) | Links to auth.users |
| intended_role | TEXT | student, teacher, parent |
| step | TEXT | identity_created -> completed or failed |
| profile_id | UUID | Created profile ID |
| error_message | TEXT | Why it failed |
| retry_count | INTEGER | How many times bootstrap was retried |

### auth_audit_log
| Column | Type | Purpose |
|---|---|---|
| auth_user_id | UUID | Who |
| event_type | TEXT | What happened |
| ip_address | TEXT | Where from |
| metadata | JSONB | Details |

## RLS Policy Summary

| Table | Policy | For | Condition |
|---|---|---|---|
| students | select_own | SELECT | auth_user_id = auth.uid() |
| students | insert_own | INSERT | auth_user_id = auth.uid() |
| students | update_own | UPDATE | auth_user_id = auth.uid() |
| students | select_teacher | SELECT | via class_students + class_teachers |
| students | select_guardian | SELECT | via guardian_student_links |
| students | service_role | ALL | auth.role() = 'service_role' |
| teachers | select_own | SELECT | auth_user_id = auth.uid() |
| teachers | insert_own | INSERT | auth_user_id = auth.uid() |
| teachers | update_own | UPDATE | auth_user_id = auth.uid() |
| teachers | select_public_info | SELECT | authenticated |
| teachers | service_role | ALL | auth.role() = 'service_role' |
| guardians | select/insert/update_own | S/I/U | auth_user_id = auth.uid() |
| guardians | service_role | ALL | auth.role() = 'service_role' |
| onboarding_state | select/insert/update_own | S/I/U | auth_user_id = auth.uid() |
| onboarding_state | service_role | ALL | auth.role() = 'service_role' |
| auth_audit_log | service_role | ALL | auth.role() = 'service_role' |

## Error Recovery

### User-facing
- Bootstrap failure shows error message on signup form
- AuthContext retry on next page load
- "Try logging in again" guidance

### Admin-facing
- `POST /api/auth/repair` with `auth_user_id`
- `admin_repair_user_onboarding()` RPC detects profile state and reconciles
- `onboarding_state` table shows where each user got stuck
