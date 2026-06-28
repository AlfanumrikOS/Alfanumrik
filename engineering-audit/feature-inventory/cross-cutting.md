# Feature Inventory — Cross-Cutting

Horizontal concerns that span every role. These are audited last (PRIORITY-BACKLOG
rank 8) as a sweep, but gaps found earlier are cross-linked here. DB tables / APIs
best-effort — **to be verified per cycle**.

---

### Auth & Onboarding (P15)
- **Business purpose:** signup → verify → profile → onboarding → dashboard, all 3 roles.
- **Key files:** `AuthScreen.tsx`, `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts`, `src/app/api/auth/bootstrap/route.ts`, `src/lib/AuthContext.tsx`, `onboarding/page.tsx`, `supabase/functions/send-auth-email/`, `src/lib/identity/`.
- **DB tables (best-effort):** `students`, `teachers`, `guardians`, `auth.users`.
- **APIs:** `/api/auth/session`, `/api/auth/onboarding-status`, `/api/auth/bootstrap`.
- **Status:** partial — **Cycle 1 in progress**; 3-layer profile failsafe + token/PKCE flows.
- **Known gaps:** 3-role E2E parity gap (per REG-117 notes); empty-state coverage.

### Bilingual i18n (P7)
- **Business purpose:** every user-facing string in Hindi + English via `AuthContext.isHi`.
- **Key files:** `src/lib/AuthContext.tsx` (`isHi`), component-level strings.
- **Status:** partial — no automated Hi/En parity gate across critical surfaces.
- **Known gaps:** parity enforcement; notification producers (P7 partial per catalog).

### RLS / RBAC (P8 / P9)
- **Business purpose:** server-side data + permission boundaries on every route/table.
- **Key files:** `src/lib/rbac.ts`, `src/lib/usePermissions.ts`, `src/lib/supabase-admin.ts`, migrations under `supabase/migrations/`.
- **Status:** partial — 440+ RLS policies; matrix conformance pinned (REG-120). Breadth tested-only.
- **Known gaps:** per-table RLS coverage breadth; `authorizeRequest()` on every mutation route.

### Feature flags
- **Business purpose:** gated rollout by role/env/institution/percentage.
- **Key files:** `src/lib/feature-flags.ts`, `feature_flags` table.
- **Status:** partial — recently seeded flags all default OFF (`ff_school_pulse_v1`, `ff_adaptive_remediation_v1`, `ff_adaptive_loops_bc_v1`, `ff_digital_twin_v1`).
- **Known gaps:** flag-change audit trail; evaluation-order correctness.

### Notifications / Communication
- **Business purpose:** in-app + email/WhatsApp notifications across roles.
- **Key files:** `src/app/notifications/page.tsx`, `supabase/functions/daily-cron/`, `.../whatsapp-notify/`, `.../alert-deliverer/`.
- **Status:** partial — bilingual shape (P7) + producer parity to verify.
- **Known gaps:** delivery reliability; dedupe.

### Bundle / Performance (P10)
- **Business purpose:** fast load on Indian 4G (2–5 Mbps).
- **Key files:** `scripts/check-bundle-size.mjs`, `next.config.js`.
- **Status:** partial — `CAP_SHARED_KB` at 280; durable fix (split `@supabase/*` from first paint) pending.
- **Known gaps:** largest page (/foxy ~254 kB) headroom; layout-chunk accounting.

### Mobile (Flutter) + API contract sync
- **Business purpose:** Flutter app sharing the web API contract.
- **Key files:** `mobile/` (Flutter/Riverpod/GoRouter).
- **Status:** partial — mobile-web contract drift gate (REG-90) exists; parity sweeps ongoing.
- **Known gaps:** XP/scoring sync parity; offline replay invariants (REG-91).

### Observability / Monitoring
- **Business purpose:** Sentry (client/server/edge) + structured logging with PII redaction.
- **Key files:** `sentry.*.config.ts`, `src/lib/logger.ts`, `src/lib/analytics.ts`.
- **Status:** partial — logger redacts password/token/email/phone/API keys (P13).
- **Known gaps:** redaction coverage on new event types; health endpoint contract.
