# extensions/supabase.md

# Alfanumrik Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Extension Module
**Priority:** Critical
**Applies To:** Every interaction with Supabase as Alfanumrik's Postgres database, Auth provider, Row Level Security boundary, and Edge Function runtime.

---

# Purpose

AEOS core docs 07 (Database Engineering) and 09 (Security Protocol) are written to be platform-agnostic. This module binds that generic guidance to Alfanumrik's actual Supabase implementation, so an AI engineer touching the database, RLS, or Edge Functions does not have to rediscover the conventions already enforced in this repo.

Supabase is not "a database we happen to use." It is, simultaneously, the platform's:

* **System of record** — Postgres with Row Level Security (RLS) on every table.
* **Auth provider** — email/PKCE flow, JWT sessions managed via middleware.
* **RBAC substrate** — 6 roles, 71 permissions, 440+ RLS policies.
* **Serverless compute** — Edge Functions on the Deno runtime (not Node.js).
* **Vector store** — pgvector for the NCERT RAG pipeline.

---

# Scope

In scope: the three Supabase clients and when to use each; the RLS-everywhere rule; migration conventions; RPC patterns; the Deno Edge Function reality; auth/session handling at the data layer.

Out of scope: payment-specific data flows (see `extensions/razorpay.md`), AI Edge Function prompt engineering (ai-engineer domain), score/XP formulas (assessment domain).

---

# How AEOS core binds here

* **07_DATABASE_ENGINEERING** — the database-is-system-of-record posture, schema-change discipline, and "the database must not become the primary location for business logic" all apply directly. Alfanumrik's nuance: a controlled, documented set of `SECURITY DEFINER` / `SECURITY INVOKER` RPCs (e.g. `atomic_quiz_profile_update`, `activate_subscription`) *is* the sanctioned home for transaction-atomic logic. RPCs are the exception that keeps integrity invariants (P1–P4, P11) enforceable in a single transaction — not a license to push general business logic into SQL.
* **09_SECURITY_PROTOCOL** — "security is a system property" maps onto the RLS boundary (product invariant **P8**) and RBAC enforcement (**P9**). The service-role key is the single most dangerous credential in the platform; this module pins exactly where it may and may not appear.

Where this module and a product invariant (P1–P15) disagree, the invariant wins and the discrepancy is logged for reconciliation.

---

# The Three-Client Model

Alfanumrik runs **three** distinct Supabase clients. Choosing the wrong one is a security defect, not a style preference.

| Client | File | Key used | RLS | Use from |
|---|---|---|---|---|
| Browser / client | `src/lib/supabase-client.ts` (re-exported by the legacy `src/lib/supabase.ts`) | anon | **Respected** | Client components, hooks, browser code |
| Server (SSR) | `src/lib/supabase-server.ts` (`createSupabaseServerClient`) | anon, cookie-bound | **Respected** | Route handlers, Server Components, middleware — anywhere acting *as the signed-in user* |
| Admin | `src/lib/supabase-admin.ts` (`supabaseAdmin` / `getSupabaseAdmin`) | **service role** | **BYPASSED** | Server-only API routes that must transcend a single user's RLS scope |

Decision rule:

1. Need to act **as the user**, honoring their RLS scope? Use the **client** (browser) or **server** (SSR, cookie-bound) client. The server client exists primarily for the PKCE flow — it exchanges the `code` param for a session and writes session cookies, which is why email verification and password reset depend on it.
2. Need to read/write **across users** (webhooks, cron, admin reporting, system writes with no user in context)? Use the **admin** client — and only ever on the server.

Hard rules, mechanically and culturally enforced:

* **`supabase-admin.ts` is server-only.** Never import it into client code. The `post-edit-check.sh` hook and `validateServerEnv()` guard against `NEXT_PUBLIC_`-leaking the service key. The admin client itself is a lazy singleton (one pooled client across requests) precisely so a per-request `createClient()` cannot exhaust the connection pool under load.
* **`supabase.ts` is legacy.** It is deprecated in favor of `supabase-client.ts` + `src/lib/domains/*`; do not add new imports from it. New code imports the pure client from `supabase-client.ts`.
* Acting as admin disables RLS, so the route is now the *only* authorization boundary. It must call `authorizeRequest(request, 'permission.code')` (P9) and re-check ownership in SQL where relevant.

---

# RLS Everywhere

Every new table ships **RLS enabled plus policies in the same migration**. This is non-negotiable (P8) and is checked by `post-edit-check.sh`. A migration that creates a table without `ENABLE ROW LEVEL SECURITY` and at least the relevant access policies is an incomplete, rejectable change.

The canonical policy set for student-owned data covers four readers, mirrored by the `supabase-patterns` skill:

* **Student reads/writes own** — `student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())`.
* **Parent reads linked child** — joined through `guardian_student_links` **with `status = 'approved'`**. The approval gate is itself a privacy boundary (P13); never expose child data on a pending link.
* **Teacher reads assigned class** — joined through `class_enrollments` / `classes` to the teacher's `auth.uid()`.
* **Service role** — admin-client writes; scope service policies to `service_role`, never to `true` (see migration `..._fix_rls_service_policies_scope_to_service_role.sql` and `..._tighten_rls_policy_always_true.sql` for the historical hardening).

---

# Migration Conventions

Migrations live in `supabase/migrations/`, ordered by `YYYYMMDDHHMMSS_descriptive_name.sql`. The CLI's `db push` applies only files at the immediate root; the legacy chain is archived under `supabase/migrations/_legacy/` and is skipped automatically. Schema reproducibility now flows from a pg_dump-derived idempotent baseline (`00000000000000_baseline_from_prod.sql`) — see `docs/runbooks/schema-reproducibility-fix.md`.

Checklist for every migration:

* Idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP ... IF EXISTS` before `CREATE` for triggers.
* New tables: RLS enabled + student/parent/teacher/service policies in the same file.
* Indexes on FK columns and any column used in `WHERE` / `JOIN` / `ORDER BY`.
* **Grade columns are `TEXT`, never `INTEGER`** (P5) — `"6"` through `"12"`.
* No `DROP TABLE` / `DROP COLUMN` without explicit user approval (enforced by `bash-guard.sh` / `post-edit-check.sh`).
* RPCs default to `SECURITY INVOKER` + `SET search_path = public`; `SECURITY DEFINER` only with documented justification, and DEFINER functions must re-verify the caller owns the row (`auth.uid()` check) since they run with elevated rights.

---

# Edge Functions — The Deno Reality

Supabase Edge Functions are **Deno**, not Node.js. They use `Deno.serve()` (older functions use the std `serve` import), ES-module URL imports (`https://esm.sh/@supabase/supabase-js@2`), and have **no `node_modules`**. Each function is a directory under `supabase/functions/<name>/` with an `index.ts`; shared utilities live in `supabase/functions/_shared/` (CORS, auth, PII redaction, rate limiting, RAG retrieval, etc.).

Operational reality in this repo:

* Functions split into AI (`foxy-tutor`, `ncert-solver`, `cme-engine`, `grounded-answer`, `alfabot-answer`, quiz generation) and non-AI (`daily-cron`, `queue-consumer`, `send-*-email`, `session-guard`, `scan-ocr`, `export-report`, `alert-deliverer`, embedding/ingestion jobs). The archived `quiz-generator-v2` under `_shared/.../_archive` was never live.
* Functions must **handle errors gracefully** and return a structured `{ success, error }` body — never crash. Supabase auth-email functions in particular MUST return HTTP 200 on every code path (P15) or signup breaks.
* Functions invoked synchronously via Next.js API routes must respect the **Vercel ~30s timeout** (the admin client fails fast at 10s for the same reason).
* `daily-cron` must be **idempotent** — safe to run twice. Note the cron split: the IRT calibration job runs on a Vercel cron, while the legacy pg_cron daily job was disabled in favor of it (`..._disable_pg_cron_daily_in_favor_of_vercel.sql`).
* CORS preflight (`OPTIONS`) and the `Authorization` header (forwarded so the user's JWT is honored, or `apikey` for anon access) are mandatory boilerplate — see `_shared/cors.ts` and `_shared/auth.ts`.

---

# Security Notes

* The service-role key bypasses RLS. Treat any admin-client route as a privilege boundary that must independently authorize (P9) and never leak student-identifiable data to logs or Sentry (P13 — `src/lib/logger.ts` redacts).
* RLS is defense in depth, not a substitute for `authorizeRequest`. A route can be RLS-correct and still over-expose if it skips RBAC.
* Never print or commit `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or any JWT. Secrets for Edge Functions are set as Supabase function secrets, not in `.env`.
* PKCE auth depends on the server client writing session cookies; do not "simplify" `supabase-server.ts` in a way that drops the `setAll` cookie handler — it silently breaks email verification.

---

# Checklist

- [ ] Picked the right client: user-scoped → client/server (RLS respected); cross-user/system → admin (server-only).
- [ ] No `supabase-admin` import in client code; no new imports from legacy `supabase.ts`.
- [ ] New table migration enables RLS + student/parent/teacher/service policies in the same file.
- [ ] Parent access checks `guardian_student_links.status = 'approved'`.
- [ ] Grade columns are `TEXT`; no `DROP TABLE/COLUMN` without approval.
- [ ] RPCs set `search_path`; `SECURITY DEFINER` justified and re-checks ownership.
- [ ] Edge Function returns structured errors, never crashes; auth-email paths return 200; cron is idempotent.
- [ ] Admin-client routes still call `authorizeRequest`; no service key or JWT in logs.

---

# References

* `07_DATABASE_ENGINEERING.md` — schema, migration, and integrity standards.
* `09_SECURITY_PROTOCOL.md` — security-as-system-property, secrets, least privilege.
* `08_TESTING_PROTOCOL.md`, `10_VERIFICATION_ENGINE.md` — verify before claiming done.
* Project constitution `.claude/CLAUDE.md` — invariants P5 (grade format), P8 (RLS boundary), P9 (RBAC), P13 (data privacy), P15 (onboarding integrity).
* Skill: `.claude/skills/supabase-patterns` — concrete migration / RPC / Edge Function templates.

---

# Final Directive

Default to the least-privileged client that can do the job. Treat the service-role key as a loaded weapon: server-only, never in client code, never in logs, and always behind an explicit authorization check. Every new table is born with RLS and its policies in the same breath — there is no "add policies later." When AEOS guidance and a product invariant disagree, the invariant wins.

**End of Document**
