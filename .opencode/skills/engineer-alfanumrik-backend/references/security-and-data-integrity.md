# Security and Data Integrity

## Contents

1. Security model
2. Authentication and authorization
3. Supabase grants and RLS
4. Functions, views, triggers, and hooks
5. Middleware, CORS, CSRF, and validation
6. Secrets and provider access
7. Migrations and integrity
8. Webhooks and payments
9. Child data, AI, and auditability
10. Security test matrix

## 1. Security model

Assume every client-controlled identifier, header, cookie, origin, redirect, upload, prompt, retrieved passage, webhook, and provider response is untrusted. Apply least privilege, deny by default, explicit ownership, and auditable exceptions.

Protect confidentiality, integrity, availability, tenant isolation, learning-evidence provenance, and recoverability. Prioritize child safety and minimize personal data.

## 2. Authentication and authorization

- Validate sessions and tokens server-side using the current supported Supabase SSR pattern.
- Separate authentication from authorization. A valid user is not automatically authorized for a tenant, learner, class, assignment, or admin action.
- Derive tenant and actor scope from server-authorized relationships, not request parameters alone.
- Use `app_metadata` or server-owned tables for authorization claims. Never trust user-editable metadata.
- Account for stale JWT claims. Refresh tokens after role changes and use database checks for sensitive, immediately revocable operations.
- Deleting a user does not by itself invalidate existing access tokens; design session revocation and short expiry appropriate to risk.
- Define parent-child, teacher-class, school-admin-tenant, super-admin, B2C-owner, and service-account relationships explicitly.
- Require step-up verification for destructive or highly privileged operations when supported.

Test horizontal and vertical privilege escalation, inactive memberships, changed roles, deleted users, expired sessions, anonymous sign-ins, and cross-tenant identifiers.

## 3. Supabase grants and RLS

Treat grants and RLS as separate layers:

- Explicit grants decide whether `anon`, `authenticated`, or service roles can reach an exposed table, view, or function.
- RLS decides which rows an allowed role may read or change.
- Enable RLS on every table in an exposed schema and prefer dedicated API schemas with private internal schemas.
- Do not assume newly created tables are automatically exposed to the Data API; verify project settings and explicit grants.
- A policy `TO authenticated` without an ownership predicate permits all authenticated and anonymous-sign-in users in that Postgres role.
- Use `USING` and `WITH CHECK` for updates and ownership-preserving writes.
- Remember UPDATE also needs a matching SELECT policy.
- Wrap stable auth functions such as `(select auth.uid())` where supported to avoid per-row evaluation, and index tenant/owner columns used in policies.
- Test each policy as anon, valid user, unrelated user, related user, tenant admin, service path, and revoked user.

Do not use the service role to compensate for missing policies in ordinary user flows. Service-role clients bypass RLS and must remain server-only, narrowly scoped, and observable.

## 4. Functions, views, triggers, and hooks

- Prefer security-invoker behavior.
- Views may bypass RLS by default; on supported Postgres versions use `security_invoker = true`, otherwise revoke public access or keep views in unexposed schemas.
- Never add `SECURITY DEFINER` merely to resolve a permission error.
- When `SECURITY DEFINER` is genuinely required, place it in a non-exposed schema, set a safe empty or explicit `search_path`, schema-qualify objects, validate `auth.uid()` or the authorized service actor, revoke `EXECUTE` from `PUBLIC`, grant only intended roles, and test bypass scenarios.
- Remember new functions may receive EXECUTE for `PUBLIC` through default privileges. Audit grants after every function migration.
- Keep triggers deterministic, bounded, observable, and free of remote calls. Avoid hidden multi-table side effects without tests.
- Treat Auth hooks as security-critical code with versioned contracts, timeouts, failure policy, and minimal claims.

## 5. Middleware, CORS, CSRF, and validation

- Middleware may refresh sessions, set coarse routing context, or reject obvious invalid requests; it must not be the sole authorization layer.
- Use exact normalized origin allowlists. Never use substring, suffix-only, reflected-origin, or wildcard credentialed CORS checks.
- Distinguish browser CORS from server-side authorization; CORS does not protect non-browser callers.
- Protect cookie-authenticated state changes against CSRF using supported same-site, origin, token, and method controls.
- Validate method, content type, schema, enum, length, range, identifier format, body size, file type, and canonicalization at the boundary.
- Reject unknown privileged fields and mass-assignment attempts.
- Normalize errors into stable client-safe codes while retaining correlated internal details.
- Rate-limit by appropriate identity and resource, not IP alone; avoid punishing schools behind shared networks.

## 6. Secrets and provider access

- Maintain a typed environment schema and fail fast for missing, whitespace-corrupted, newline-containing, malformed, or mutually inconsistent values.
- Never log secret values, tokens, authorization headers, signed URLs, raw payment payloads, or full child data.
- Keep service-role, secret API, webhook, Mailgun, Razorpay, AI-provider, database, and Redis credentials outside public bundles. Any `NEXT_PUBLIC_` value reaches the browser.
- Scope, rotate, and inventory secrets with owners, consumers, expiry, and rollback.
- Test rotation in staging and support overlapping webhook or signing keys where the provider allows.
- Distinguish credential failure, DNS/connectivity, timeout, rate limit, quota, malformed input, safety refusal, and provider outage in telemetry.

Known Alfanumrik incidents include outages after secret rotation and a newline-corrupted AI key. Preserve these checks as regression cases.

## 7. Migrations and integrity

- Use canonical IDs, foreign keys, unique constraints, checks, NOT NULL, enums or validated lookup tables, and transactions to enforce authoritative invariants.
- Index foreign-key columns and all high-cardinality tenant/owner/time predicates proven by query patterns.
- Make migrations forward-only after application, reproducible, reviewed, and safe under concurrent traffic.
- Do not edit an applied migration. Add a corrective migration.
- Separate expand, backfill, dual-read/write when required, verify, cutover, and contract phases for incompatible changes.
- Bound backfills, make them resumable and idempotent, and avoid long locks.
- Create migrations using the installed Supabase CLI workflow discovered through `--help`; run database advisors and verify migration history before release.
- Define backup, restore, point-in-time recovery, and rollback or roll-forward procedures appropriate to the change.

Test constraints, concurrent writes, duplicate delivery, partial failure, old clients, and rollback compatibility.

## 8. Webhooks and payments

For Razorpay and other webhooks:

- verify signatures against the exact raw body before parsing or mutation
- enforce timestamp or replay controls supported by the provider
- store provider event IDs with a unique constraint
- acknowledge only after durable receipt or defined processing semantics
- make processing idempotent and state transitions monotonic
- separate subscription entitlement from payment-attempt status
- retry asynchronous processing safely and reconcile against provider truth
- never trust client-reported payment success

Keep external calls outside database lock windows. Record correlation IDs and immutable financial audit events without leaking sensitive payloads.

## 9. Child data, AI, and auditability

- Minimize collection and retention; classify identifiers, answers, voice, free text, behavior, mastery, parent/teacher messages, and embeddings.
- Enforce tenant and relationship boundaries before retrieval, vector search, prompt construction, logging, export, or analytics.
- Redact or tokenize personal data sent to AI providers where possible and document provider retention settings.
- Treat retrieved documents and model responses as untrusted content; defend against prompt injection and unsafe tool instructions.
- Preserve source, model, content version, policy version, decision reason, and human override for consequential learning outputs.
- Do not infer diagnosis, emotion, disability, or intelligence without an explicitly governed use case.
- Provide audit trails for admin access, role changes, data exports, deletion, safety escalation, and authoritative learning-state changes.

## 10. Security test matrix

Require applicable tests for:

- unauthenticated and anonymous-sign-in access
- same-role cross-user and cross-tenant access
- parent-child and teacher-class relationship changes
- tenant admin versus super-admin scope
- service-role leakage and bypass
- stale JWTs, revoked sessions, and role changes
- RLS SELECT/INSERT/UPDATE/DELETE, including WITH CHECK
- RPC and function EXECUTE grants
- view RLS behavior
- CORS preflight and hostile origins
- CSRF and unsafe methods
- oversized, malformed, duplicate, and replayed requests
- webhook signature, idempotency, and ordering
- secret rotation and malformed environment values
- log and trace redaction
