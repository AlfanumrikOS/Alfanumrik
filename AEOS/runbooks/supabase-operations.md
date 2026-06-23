# Supabase Operations Runbook

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Runbook
**Priority:** Critical
**Applies To:** Every operator or AI engineer applying migrations, authoring RLS, deploying Edge Functions, managing Edge Function secrets, or performing routine backup/restore on Alfanumrik's Supabase project.

---

# Purpose

This runbook is the operational how-to layer for Alfanumrik's Supabase platform. The AEOS core docs `07_DATABASE_ENGINEERING.md` and `09_SECURITY_PROTOCOL.md` define *what* good database and security engineering look like; the extension `docs/extensions/supabase.md` binds those standards to this repo's conventions. This document tells you *how to actually run the commands* without breaking an invariant.

Supabase is, simultaneously, Alfanumrik's system of record (Postgres + RLS), Auth provider (email/PKCE), RBAC substrate, serverless compute (Deno Edge Functions), and vector store (pgvector). An operator who treats it as "just a database" will eventually disable RLS, leak the service-role key, or push a migration that the next fresh environment cannot reproduce. This runbook exists to prevent that.

Deep disaster-recovery (point-in-time recovery drills, full project restore, RPO/RTO targets) is out of scope here and is handed off to `disaster-recovery.md`. This document covers routine backup/restore only.

---

# Preconditions

Before running any procedure in this runbook, confirm:

1. The Supabase CLI is installed and authenticated (`supabase --version`, `supabase login`).
2. The project is linked: `supabase link --project-ref <ref>` for the target environment (staging vs production are distinct refs — never cross them).
3. You are operating against the intended environment. Production changes follow the deployment pipeline and require approval per `09_SECURITY_PROTOCOL.md`; ad-hoc production `db push` is a last resort, not a default.
4. Secrets are sourced from the secret manager, never from your shell history. The service-role key bypasses RLS and is the single most dangerous credential in the platform.

---

# Section 1 — Applying Migrations

Migrations live in `supabase/migrations/`, ordered by `YYYYMMDDHHMMSS_descriptive_name.sql`. The current root holds the idempotent baseline `00000000000000_baseline_from_prod.sql` followed by the post-baseline timestamped chain (for example `20260505100000_disable_pg_cron_daily_in_favor_of_vercel.sql`).

## The root-vs-_legacy rule

The Supabase CLI applies **only** files at the immediate `supabase/migrations/` root. The pre-baseline history is archived under `supabase/migrations/_legacy/` (and `_legacy/timestamped/`) and is **skipped automatically** on every deploy. This is by design — do not move legacy files back to the root, and do not delete the baseline.

Procedure to apply pending migrations:

1. Pull latest `main` and confirm the migration files you expect are present at the root (not under `_legacy/`).
2. Dry-confirm the diff: `supabase db diff --linked` to see what the local schema would change against the linked DB.
3. Apply: `supabase db push`.
4. Confirm the migration was recorded: `supabase migration list` — the applied file should appear in both local and remote columns.
5. Verify RLS and behavior with the checks in Section 4 before declaring the change live.

Never edit a migration that has already executed on production (`07_DATABASE_ENGINEERING.md` — "Never modify previously executed migrations in production"). To change applied schema, write a new forward migration.

---

# Section 2 — The Idempotent Baseline and `supabase migration repair`

Schema reproducibility flows from a single pg_dump-derived idempotent baseline, `00000000000000_baseline_from_prod.sql`. Why this matters operationally:

* **Fresh environments** (CI live-DB tests, a new staging project, a disaster-recovery rebuild) run the baseline plus the post-baseline chain from zero and arrive at the production schema deterministically.
* **Existing environments** (production, main-staging) already *contain* the baseline schema. Re-running it would be wasteful and risky, so the baseline is **pre-marked as applied** on those environments via `supabase migration repair`. The merge therefore skips execution there and only the post-baseline files run.

Procedure to mark the baseline applied on an environment that already has the schema:

1. Link the target environment: `supabase link --project-ref <ref>`.
2. Mark the baseline as applied without running it:
   `supabase migration repair --status applied 00000000000000`.
3. Confirm: `supabase migration list` shows the baseline as applied remotely.
4. Run `supabase db push` for the post-baseline chain only.

`migration repair` is also the tool for reconciling drift when `migration list` shows a file the remote believes is unapplied (or vice versa). Use `--status applied` to claim a file ran, `--status reverted` to claim it did not. Always confirm with `migration list` afterward. Treat repair as a reconciliation action, not a routine one — every use should be deliberate and traceable.

The authoritative walkthrough of the baseline cutover lives in the project runbook `docs/runbooks/schema-reproducibility-fix.md`; do not reinvent that procedure here.

---

# Section 3 — Creating and Reviewing Migrations (RLS in the Same File)

Every schema change is a version-controlled migration (`07_DATABASE_ENGINEERING.md`). Create one with:

```
supabase migration new descriptive_name
```

This scaffolds `supabase/migrations/<timestamp>_descriptive_name.sql` at the root.

## The non-negotiable RLS rule (P8)

Every new table ships **RLS enabled plus its policies in the same migration file**. A migration that creates a table without `ENABLE ROW LEVEL SECURITY` and the relevant access policies is incomplete and rejectable — this is enforced culturally and by the `post-edit-check.sh` hook. There is no "add policies later."

The canonical student-owned policy set covers four readers (mirrored by the `supabase-patterns` skill):

* **Student reads/writes own** — `student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())`.
* **Parent reads linked child** — joined through `guardian_student_links` **with `status = 'approved'`**. The approval gate is itself a privacy boundary (P13); never expose child data on a pending link.
* **Teacher reads assigned class** — joined through `class_enrollments` / `classes` to the teacher's `auth.uid()`.
* **Service role** — scope service policies to `service_role`, never to `true` (see `..._fix_rls_service_policies_scope_to_service_role.sql` and `..._tighten_rls_policy_always_true.sql` for the historical hardening).

## Migration authoring checklist (per `docs/extensions/supabase.md`)

1. Idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP ... IF EXISTS` before `CREATE` for triggers.
2. New table: `ENABLE ROW LEVEL SECURITY` + student/parent/teacher/service policies in the same file.
3. Indexes on FK columns and any column used in `WHERE` / `JOIN` / `ORDER BY`.
4. **Grade columns are `TEXT`, never `INTEGER`** (P5) — `"6"` through `"12"`.
5. No `DROP TABLE` / `DROP COLUMN` without explicit user approval (blocked by `bash-guard.sh` / `post-edit-check.sh`).
6. RPCs default to `SECURITY INVOKER` + `SET search_path = public`. `SECURITY DEFINER` only with documented justification, and a DEFINER function must re-verify the caller owns the row via an `auth.uid()` check, since it runs with elevated rights.

Run the schema review checklist in `07_DATABASE_ENGINEERING.md` before approving any migration. If any answer is "No," revise before approval.

---

# Section 4 — Verifying RLS

RLS is defense in depth, not a substitute for `authorizeRequest` (P9), and it must be validated, not assumed (`07_DATABASE_ENGINEERING.md` — "Validate RLS behavior with automated tests").

Procedure:

1. **Confirm RLS is enabled** on the new table. In the SQL editor or via `psql`:
   `SELECT relname, relrowsecurity FROM pg_class WHERE relname = '<table>';` — `relrowsecurity` must be `true`.
2. **List the policies** that exist:
   `SELECT polname, polcmd FROM pg_policy WHERE polrelid = '<table>'::regclass;` — confirm SELECT/INSERT (and UPDATE/DELETE where applicable) policies for student, parent, teacher, and service role are present.
3. **Positive test** — as a signed-in student (anon/cookie-bound client), the student can read and write only their own rows.
4. **Negative test** — the same student cannot read another student's rows; a parent on a *pending* link cannot read the child's rows.
5. **Automated coverage** — back the change with the RLS test suite (e.g. `rls-student-id-policies.test.ts`) so the boundary is regression-protected, not verified once and forgotten.

A route that uses the admin client (service role) has RLS bypassed, so the route itself becomes the only authorization boundary — it must call `authorizeRequest(request, 'permission.code')` and re-check ownership in SQL where relevant.

---

# Section 5 — Deploying Edge Functions (Deno)

Supabase Edge Functions are **Deno**, not Node.js. They use `Deno.serve()` (older functions use the std `serve` import), ES-module URL imports (`https://esm.sh/@supabase/supabase-js@2`), and have **no `node_modules`**. Each function is a directory under `supabase/functions/<name>/` with an `index.ts`; shared utilities (CORS, auth, PII redaction, rate limiting, RAG retrieval) live in `supabase/functions/_shared/`.

The repo splits functions into AI (`foxy-tutor`, `ncert-solver`, `cme-engine`, `grounded-answer`, `quiz-generator`) and non-AI (`daily-cron`, `queue-consumer`, `send-auth-email`, `send-welcome-email`, `session-guard`, `scan-ocr`, `export-report`, and the embedding/ingestion jobs).

Procedure to deploy a single function:

1. Local test first: `supabase functions serve <name> --env-file .env.local`, then exercise it with a real request (including an `OPTIONS` preflight).
2. Confirm the function returns a structured `{ success, error }` body on every path and never crashes. Auth-email functions (`send-auth-email`) MUST return HTTP 200 on every code path or signup breaks (P15).
3. Confirm CORS and `Authorization` boilerplate is present (`_shared/cors.ts`, `_shared/auth.ts`).
4. Deploy: `supabase functions deploy <name>`.
5. Smoke-test the deployed function with a real request and confirm logs in the Supabase dashboard.

Functions invoked synchronously from Next.js API routes must respect the **Vercel ~30s timeout** (the admin client fails fast at 10s for the same reason).

---

# Section 6 — pg_cron Is Disabled in Favor of Vercel Cron

A common operational trap: assuming scheduled work runs inside Postgres. It does not. The legacy pg_cron daily job was **disabled** by migration `20260505100000_disable_pg_cron_daily_in_favor_of_vercel.sql`. Scheduled work now runs as follows:

* The **IRT calibration** job and other recurring tasks run on **Vercel cron** (see `vercel.json`), which invokes the corresponding Next.js API route on a schedule.
* The `daily-cron` Edge Function is triggered from that pipeline and orchestrates streak resets, leaderboard updates, parent digests, and the adaptive-program steps.

Operational consequences:

1. Do **not** re-enable pg_cron to "fix" a missed nightly run. If a nightly job did not run, investigate the Vercel cron invocation and the route logs first.
2. `daily-cron` must be **idempotent** — safe to run twice. A manual re-trigger to recover a missed run must not double-award XP, double-send digests, or double-insert interventions.
3. When changing anything that affects `daily-cron`, treat it as operationally significant and follow the review chain (ops reviews operational impact).

---

# Section 7 — Secret Management for Edge Functions

Edge Function secrets are **set as Supabase function secrets, not in `.env`** and never in source (`09_SECURITY_PROTOCOL.md` — secrets never in source code, logs, or commits). Email credentials in particular live as function secrets.

Procedure:

1. Set or rotate a secret:
   `supabase secrets set SECRET_NAME=<value>` (sourced from the secret manager, never typed inline into shared history where avoidable).
2. List configured secret names (names only, never values):
   `supabase secrets list`.
3. Reference secrets in function code via `Deno.env.get("SECRET_NAME")`.
4. After rotation, redeploy the consuming function and smoke-test.

Hard rules:

* Never print, log, or commit `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or any JWT. The logger (`src/lib/logger.ts`) redacts password, token, email, phone, and API keys — do not defeat it.
* The service-role key is server-only. It belongs in `src/lib/supabase-admin.ts` consumers and Edge Functions, never in client code. Never `NEXT_PUBLIC_`-prefix it.
* Required environment variables fail fast if missing (`validateServerEnv()`), per the secure-by-default posture in `09_SECURITY_PROTOCOL.md`.

---

# Section 8 — Backup and Restore Basics

Production backups, retention, and recovery verification are mandatory (`07_DATABASE_ENGINEERING.md` — "Backups are not considered valid until restoration has been successfully tested"). This section covers routine basics only; full disaster recovery is handed off to `disaster-recovery.md`.

Routine procedures:

1. **Managed backups** — Supabase provides automated daily backups (and point-in-time recovery on eligible plans). Confirm in the dashboard that automated backups are enabled and the retention window matches the data-retention policy.
2. **On-demand logical snapshot** — before a high-risk migration, capture a schema-and-data dump for the affected scope:
   `supabase db dump --linked -f backup_<date>.sql` (use `--data-only` or `--schema-only` to scope as needed). Store the artifact in approved storage, never in the repo.
3. **Restore verification** — a backup is not valid until a restore has succeeded. Periodically restore a dump into a throwaway environment and run the schema review and RLS verification (Section 4) against it.
4. **Never copy production data into development** without approved anonymization (`07_DATABASE_ENGINEERING.md` — Test Data). Use synthetic or anonymized data for non-production environments.

For point-in-time recovery, full project restore, RPO/RTO targets, and incident-grade recovery drills, follow `disaster-recovery.md`.

---

# Operator Checklist

Before declaring any Supabase operation complete, verify:

- [ ] Correct environment linked (staging vs production not crossed); production changes approved.
- [ ] `db push` applied only root-level migrations; nothing was moved out of `_legacy/`.
- [ ] On environments that already hold the schema, the baseline was `migration repair --status applied`, not re-run.
- [ ] Every new table has `ENABLE ROW LEVEL SECURITY` + student/parent/teacher/service policies in the same migration file.
- [ ] Parent policies gate on `guardian_student_links.status = 'approved'`.
- [ ] Grade columns are `TEXT`; no `DROP TABLE`/`DROP COLUMN` without user approval.
- [ ] RPCs set `search_path`; any `SECURITY DEFINER` re-checks `auth.uid()` ownership.
- [ ] RLS verified positive and negative; automated RLS coverage updated.
- [ ] Edge Function returns structured errors, never crashes; auth-email paths return 200; `daily-cron` is idempotent.
- [ ] No pg_cron re-enablement; missed jobs investigated via Vercel cron + route logs.
- [ ] Secrets set via `supabase secrets`, never in `.env`/source/logs; service-role key server-only.
- [ ] Pre-migration dump captured for high-risk changes; restore path is verified, not assumed.

---

# References

* `07_DATABASE_ENGINEERING.md` — migrations, RLS, transactions, backup strategy, schema review checklist.
* `09_SECURITY_PROTOCOL.md` — secrets management, least privilege, database security, secure defaults.
* `docs/extensions/supabase.md` — the three-client model, RLS-everywhere rule, migration conventions, the Deno Edge Function reality, the pg_cron/Vercel cron split.
* Project runbook `docs/runbooks/schema-reproducibility-fix.md` — the authoritative baseline cutover and `migration repair` walkthrough.
* Sibling AEOS runbook `disaster-recovery.md` — point-in-time recovery, full restore, RPO/RTO, recovery drills.
* Skill `.claude/skills/supabase-patterns` — concrete migration / RPC / Edge Function templates.
* Project constitution `.claude/CLAUDE.md` — invariants P5 (grade format), P8 (RLS boundary), P9 (RBAC), P13 (data privacy), P15 (onboarding integrity).

---

# Final Directive

Default to the least-privileged path that gets the job done. Apply only what belongs at the migration root; let the baseline and `_legacy/` do their job rather than fighting them. Every new table is born with RLS and its policies in the same breath — there is no "add policies later." Treat the service-role key and every function secret as loaded weapons: server-only, never in logs, never committed. Verify the restore, not just the backup. When this runbook and a product invariant disagree, the invariant wins and the discrepancy is logged for reconciliation.

**End of Document**
