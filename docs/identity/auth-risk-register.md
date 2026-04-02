# Identity Risk Register

> Active risks to the identity/onboarding system.
> Reviewed: 2026-04-02

## Resolved Risks (from hardening program)

| ID | Risk | Severity | Status | Resolution |
|---|---|---|---|---|
| R1 | No RLS on students/teachers/guardians | CRITICAL | RESOLVED | Migration `20260402100000` adds 18 policies |
| R2 | Client-side profile creation fragile | CRITICAL | RESOLVED | Server bootstrap via `/api/auth/bootstrap` |
| R3 | No server-controlled onboarding | HIGH | RESOLVED | `bootstrap_user_profile()` RPC + API route |
| R4 | AuthContext auto-bootstrap unreliable | HIGH | RESOLVED | Now calls server bootstrap, not client insert |
| R5 | No onboarding state tracking | MEDIUM | RESOLVED | `onboarding_state` table with step tracking |
| R6 | P5 grade format violation | MEDIUM | RESOLVED | Bootstrap stores grade as "9" not "Grade 9" |
| R7 | Client-determined role | MEDIUM | RESOLVED | Bootstrap validates role; RPC checks DB |
| R8 | No auth audit trail | MEDIUM | RESOLVED | `auth_audit_log` table + bootstrap logging |
| R9 | Email callback skips bootstrap | MEDIUM | RESOLVED | Callback now runs bootstrap if no profile |
| R10 | No repair capability | LOW | RESOLVED | `admin_repair_user_onboarding()` RPC + API |
| R11 | Password reset session gap | HIGH | RESOLVED | Tokens passed via URL hash for detectSessionInUrl |

## Active Risks

| ID | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| R12 | Mailgun webhook for delivery tracking not implemented | LOW | Auth emails sent fire-and-forget; no delivery confirmation | Identity Agent |
| R13 | `send-auth-email` SITE_URL hardcoded | LOW | Uses `https://alfanumrik.com`; preview deploys may not receive correct URLs in emails | Identity Agent |
| R14 | Demo accounts not protected by onboarding_state | LOW | Demo accounts bypass bootstrap; should have completed onboarding_state | Identity Agent |
| R15 | No CI gate specifically for auth tests | MEDIUM | Auth tests run as part of `npm test` but no explicit gate | Identity Agent |
| R16 | Existing users without `onboarding_state` rows | LOW | AuthContext fallback handles; repair RPC available | Identity Agent |

## Monitoring Points

| What to Watch | How | Alert Condition |
|---|---|---|
| Bootstrap failures | `auth_audit_log.event_type = 'bootstrap_failure'` | Any occurrence |
| Stuck onboarding | `onboarding_state.step = 'failed'` | Count > 0 |
| Auth callback errors | Server logs `[Auth Callback]` | Error rate > 1% |
| Password reset failures | Reset page shows "Invalid or Expired Link" | User reports |
| Demo account corruption | Admin panel demo list shows missing profiles | Any demo with null profile |
| Email delivery failures | Mailgun dashboard bounce rate | Rate > 5% |
