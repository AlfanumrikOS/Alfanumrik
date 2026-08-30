# 04 — Auth, RBAC & RLS Audit

**Audit date:** 2026-08-29
**Evidence source:** Auth system agent, RBAC agent, RLS agent, Grants agent (all completed)

---

## 1. Authentication

### Architecture
- **Provider:** Supabase Auth (GoTrue) with email/PKCE flow
- **JWT verification:** Always server-side against GoTrue — no local/unsigned decode found
- **Service-role key isolation:** Server-only singleton (`createAdminClient()`); runtime guard throws if `SUPABASE_SERVICE_ROLE_KEY` appears in any `NEXT_PUBLIC_*` env var
- **Session management:** JWT expiry 3600s (config.toml); refresh via Supabase SDK; cookies set `Secure; SameSite=Lax; HttpOnly`
- **MFA:** Not enabled (not required for CBSE K-12 pilot scope)

### Findings
| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| — | — | No P0/P1 findings in authentication surface | **PASS** |

### Verdict: **GO**

---

## 2. RBAC

### Architecture
- **Role storage:** Database-backed (`user_roles` table), server-resolved via `getUserRole()` / `requireRole()`
- **Caching:** Redis-cached with instant taint-invalidation on role change
- **Never in JWT:** Role is never stored in JWT claims — always resolved server-side
- **Role hierarchy:** 11 roles, 71 permissions, enforced via `role_permissions` table
- **Route coverage:** 410/410 API routes verified to have auth checks (comprehensive sweep)
- **Escalation prevention:** Prior P0 self-escalation hole in `user_roles` RLS was found and fixed via migration `20260816000009`

### Findings
| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| P2-03 | P2 | institution_admin self-serve role creation — unverified by product whether this is intended | OPEN |
| P2-04 | P2 | Permission check mismatch in 3 routes: check runs but result not enforced (teacher-dashboard, parent-portal, assessment) | OPEN |

### Verdict: **GO** (with P2 items in remediation backlog)

---

## 3. Row-Level Security (RLS)

### Architecture
- **Coverage:** 427/427 tables have RLS enabled (100% — live-verified via `pg_class`)
- **Policy count:** 440+ RLS policies across all tables
- **Pattern:** Tenant isolation via `school_id` scoping, student isolation via `student_id = auth.uid()`, role-based policies for teachers/admins

### Findings
| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| P1-01 | P1 | `question_bank` RLS policy `question_bank_authenticated_read USING(true)` exposes answer key columns to any authenticated user | **BLOCKING** |
| P2-06 | P2 | `exam_papers`, `assessment_templates`, `report_templates` have `USING(true)` SELECT policies — over-permissive for admin-only tables | OPEN |

### Verdict: **CONDITIONAL GO** — P1-01 is independently blocking

---

## 4. Grant Hygiene

### Architecture
- **Default privileges (tables):** `ALTER DEFAULT PRIVILEGES` auto-grants INSERT, UPDATE, DELETE to anon and authenticated on all new public tables
- **Default privileges (functions):** `ALTER DEFAULT PRIVILEGES` auto-grants EXECUTE to anon and authenticated on all new public functions
- **DB-12 TRUNCATE:** 0/427 tables grant TRUNCATE to anon/authenticated — **VERIFIED CLOSED** (live query 2026-08-29)
- **Money tables:** `payment_history`, `school_subscriptions`, `subscription_plans`, `coupons` — all fully locked down (live-verified)

### Findings
| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| P2-01 | P2 | Default table privileges auto-grant INSERT/UPDATE/DELETE to anon/authenticated | OPEN |
| P2-02 | P2 | Default function privileges auto-grant EXECUTE to anon/authenticated | OPEN |
| P2-05 | P2 | `compute_mrr_snapshot` executable by anon — financial RPC should be admin-only | OPEN |
| P1-07 | P1 | `match_rag_chunks_ncert` EXECUTE granted to authenticated — exposes raw RAG corpus; all callers use service_role | OPEN |

### Verdict: **NO-GO** on Gate 7 (default privileges); individual grant issues are P1/P2

---

## Cross-Cutting Positive Findings

1. **Auth is unusually well-hardened** for a startup-stage product: the combination of server-only service-role key, runtime env-var guard, server-side JWT verification, DB-backed roles with Redis cache invalidation, and fail-closed admin authorization is enterprise-grade.
2. **Prior self-escalation hole (user_roles RLS)** was found by the team's own audit, fixed, and verified — demonstrates functional audit culture.
3. **100% RLS coverage** across 427 tables is exceptional — most Supabase projects have gaps.
4. **Money table lockdown** is complete and live-verified — no grants of any kind to anon/authenticated on payment tables.
