# Environment Readiness Remediation — 2026-07-02 Certification Wave

**Date:** 2026-07-02
**Status:** Sentry fix + traceability runbook complete (this record). FK/teardown fix in progress in parallel by architect, same remediation wave. Testing to verify all three once architect's fix lands.
**Origin:** Certification-on-staging Environment Readiness Assessment.
**Evidence:** `docs/audit/2026-07-02-certification/evidence/stage-1-static/code-trace-notes/environment-readiness-ops.md` (ops, this pass) and its cross-referenced prior pass `docs/audit/2026-07-02-certification/evidence/stage-1-static/code-trace-notes/ops-findings.md`.

## What was found

The ops Environment Readiness Assessment (`environment-readiness-ops.md`) verified four areas ahead of authorizing a certification run against staging and surfaced three distinct, independently-confirmed issues:

1. **Sentry environment-tagging defect (confirmed, safety-relevant).** All three Sentry init files (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`) keyed the `environment` tag off `process.env.NODE_ENV` only. Next.js's `next build` always sets `NODE_ENV=production` for a production-mode build regardless of which Vercel environment (Production vs Preview) the build is destined for — Vercel does not override `NODE_ENV` per deploy target; `VERCEL_ENV` (`production`/`preview`/`development`) is the only value Vercel itself varies. Since staging deploys as a genuine Vercel Preview environment (`deploy-staging.yml`: `vercel pull --yes --environment=preview`), every Sentry event generated on staging — including any error thrown by certification testing — was tagged `environment: production`, byte-identical to a real production incident, and indistinguishable from one by an on-call engineer filtering Sentry's `environment` field. 35+ other environment-sensitive call sites in the codebase (feature flags, PostHog, health check, entitlements resolver, `src/proxy.ts`-adjacent routes, etc.) already correctly read `VERCEL_ENV`/`NEXT_PUBLIC_VERCEL_ENV` first — the three Sentry configs were the sole outlier. See §2 ("Sentry environment tagging — CONFIRMED DEFECT") of the evidence file for the full trace.

2. **No canonical certification-traffic traceability convention.** Three partial, inconsistent conventions existed for marking synthetic/test data (`is_demo` alone; `is_demo` + a `drill-synthetic-*` email marker; `is_demo` + `is_test_account` + `account_status='test'` with no registry row), none documented as canonical, and the one existing staging E2E test seed (`seed-staging-test-student.yml`) does not set `is_demo` at all — it is indistinguishable from a real student by any DB column. See §1 of the evidence file.

3. **No single-operation teardown path for a school-scoped certification tenant.** `students.school_id` and `teachers.school_id` reference `schools(id)` with no `ON DELETE CASCADE` (`NO ACTION`/`RESTRICT` default), contradicting the super-admin institutions route's own code comment claiming a full cascade. Hard-deleting a `schools` row while certification-seeded students/teachers still reference it fails with a Postgres `23503` foreign-key violation. See §3 of the evidence file.

## What was fixed here (ops, this pass)

**Defect 1 — Sentry environment detection.** Changed the `environment:` value in all three Sentry config files to prioritize the Vercel-specific environment variable, falling back to `NODE_ENV` only when unset (pure local dev), matching the exact precedence pattern already used by 35+ other call sites in the codebase:

| File | Before | After |
|---|---|---|
| `sentry.client.config.ts` | `process.env.NODE_ENV \|\| 'development'` | `process.env.NEXT_PUBLIC_VERCEL_ENV \|\| process.env.NODE_ENV \|\| 'development'` |
| `sentry.server.config.ts` | `process.env.NODE_ENV \|\| 'development'` | `process.env.VERCEL_ENV \|\| process.env.NODE_ENV \|\| 'development'` |
| `sentry.edge.config.ts` | `process.env.NODE_ENV \|\| 'development'` | `process.env.VERCEL_ENV \|\| process.env.NODE_ENV \|\| 'development'` |

The client config uses `NEXT_PUBLIC_VERCEL_ENV` (the client-readable mirror wired in `next.config.js`'s `env` block: `NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? ''`, and already consumed the same way by `src/app/layout.tsx`) because this file executes in the browser bundle and `VERCEL_ENV` itself is not exposed to client code without the `NEXT_PUBLIC_` prefix. The server and edge configs use the non-prefixed `VERCEL_ENV` directly (matching `src/lib/feature-flags.ts` and `src/app/api/v1/health/route.ts`), since neither file ever executes in a browser context and `VERCEL_ENV` is available as a system environment variable in both the Node.js and Edge runtimes on Vercel.

**Net effect:** a Vercel Preview (staging) deployment will now report `environment: preview` to Sentry (the literal string Vercel sets for `VERCEL_ENV` on preview deployments, confirmed against `next.config.js`'s own comment: `"'production' on the production deploy, 'preview' on PR preview deploys, and 'development' on vercel dev"`), no longer `environment: production`. This was left as the raw Vercel-provided value (`preview`) rather than remapped to a custom label, consistent with how every other correct call site in the codebase treats it — an unmapped, filterable literal.

**Out of scope for this fix** (not requested, not changed): the `beforeSend` guard in `sentry.server.config.ts`/`sentry.edge.config.ts` (`if (process.env.NODE_ENV !== 'production') return null;`) and `sentry.client.config.ts`'s equivalent. These already do not drop staging events today (since `NODE_ENV` resolves to `'production'` there), and that behavior is unchanged by this fix — only the `environment` *tag* changed, not the send/drop decision. Staging events will continue to be sent to Sentry, now correctly tagged `environment: preview` instead of `environment: production`.

**Defect 2 — certification traceability convention.** Specified (not implemented — no seeding script was written by ops; that is testing's follow-up) in the new runbook `docs/runbooks/certification-traffic-traceability.md`. Summary of the convention: every certification-seeded row sets `is_demo = true` on its base table (column already exists on all eight relevant tables — no migration needed), uses the email domain `@certification.alfanumrik.invalid` (RFC 2606 reserved `.invalid` TLD), embeds a per-run marker `cert-<run_id_short>-<role>-<n>` in its name field, and registers one row per top-level account into the existing `demo_accounts` table so the existing `purge_demo_account_by_id` RPC becomes usable for teardown. Full exact shapes, query patterns, and a mandatory post-teardown leak-check query are in the runbook. Two gaps were flagged to architect within that runbook (not fixed by ops, since migrations are outside ops's domain): (a) no dedicated `certification_run_id` column exists anywhere — optional hardening, not blocking; (b) `purge_demo_account_by_id`'s `role='school_admin'` branch is missing a `teachers` deletion step, which is directly related to the FK gap architect is fixing in parallel (see below).

## In progress, same remediation wave (architect)

Defect 3 from the evidence file — the missing `ON DELETE CASCADE` on `students_school_id_fkey`/`teachers_school_id_fkey` (and the resulting lack of a single-operation teardown path for a school-scoped certification tenant) — is being addressed in parallel by architect, in this same remediation wave. This record does not describe architect's fix in detail since it had not landed at the time this record was written; refer to architect's own remediation notes/migration once available. Testing should verify architect's fix independently once it lands.

## What testing verifies next

- Sentry fix: confirm a staging (Vercel Preview) build reports `environment: preview` on both client and server events, and that no other Sentry behavior (PII redaction, `beforeSend` filtering, sampling rates) regressed.
- Traceability runbook: build the actual seeding script against `docs/runbooks/certification-traffic-traceability.md` and confirm every signal (email domain, `is_demo`, name marker, `demo_accounts` registry row) is written exactly as specified, and that the reporting-isolation claim (`is_demo=eq.false` filters in `stats`/`analytics` routes) holds against seeded data.
- Architect's FK/teardown fix: once landed, verify a full seed → certify → teardown cycle on staging leaves zero rows behind (the leak-check query in the traceability runbook), including the school_admin branch's teacher-cleanup gap noted above.
