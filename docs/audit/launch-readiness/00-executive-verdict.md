# 00 — Executive Verdict

**Audit date:** 2026-08-29/30 (continued after usage-limit reset)
**Auditor:** Independent launch-readiness audit (Claude Code session)
**Scope:** Full production-readiness audit of Alfanumrik Adaptive Learning OS
**Target:** Controlled B2B pilot launch to CBSE schools (Classes 6–12)

---

## Verdict: NO-GO

**Confidence: HIGH** — based on confirmed, live findings against the production Supabase project `shktyoxqhundlvkiwguu`, static analysis of 410 API routes, 49 edge functions, 632 migrations, and cross-reference with two prior audits (engineering-audit 8-cycle June 2026, FIX-LEDGER behavioral audit Aug 20–21 2026).

---

## Why NO-GO

Five independently blocking clusters prevent a responsible launch to schools with real students (two new clusters identified in Phase 2 of the audit):

### 1. Academic Integrity — Question Bank Answer Key Exposed (P1)

The `question_bank` table's RLS policy (`question_bank_authenticated_read USING(true)`) grants **any authenticated user** (including students) full `SELECT` access to `correct_answer_index`, `correct_answer_text`, `explanation`, `solution_steps`, and `hint_level_1/2/3` for all 12,826+ questions. A student can bypass the quiz UI and directly query the REST API to obtain every answer key. This is confirmed live against production today. The team self-documented this as open (`20260814000023_keyless_question_serving_and_server_side_p6.sql`) but the residual is still live. For a K-12 assessment platform, this is a core-promise violation.

### 2. AI Tutor Quality — RAG Retrieval Regression (P1, from prior scorecard)

The RAG retrieval eval harness (last run 2026-08-23) returned a genuine measured regression: recall@10 at 66.1% and faithfulness at ~40–47% against the launch mandate's bars of 95% each. Three of five mandated metrics (recall@3, correctness, abstention) are not computed by the harness at all. The leading hypothesis is corpus-growth dilution (16k → 27k chunks) but this is not root-caused. This is the single finding that directly degrades the core product promise (a grounded, accurate AI tutor for CBSE students).

### 3. Cron Integrity — verify-question-bank Never Worked (P0)

The `verify-question-bank` cron job — designed to continuously verify quiz-answer integrity — has never successfully executed because the Edge Function call in `grounded-client.ts` uses signing headers (`x-internal-timestamp`, `x-internal-signature`) that the Supabase Edge Function entry point does not validate or expect. Every invocation returns a 401. This means the platform's primary runtime integrity check for its most critical data asset (question bank answers) has been a no-op since deployment.

> **Note (TRUNCATE — DB-12):** The prior scorecard listed TRUNCATE grants as a launch blocker. This audit's Grants agent live-verified against production on 2026-08-29 that 0/427 tables grant TRUNCATE to anon or authenticated. **DB-12 is VERIFIED CLOSED** and is no longer blocking.

### 4. Legal Compliance — DPDP Age Gate at 13, India Requires 18 (P1)

India's Digital Personal Data Protection Act 2023 §9 requires parental consent for all users under **18**. The platform's age gate is currently set at **13** (COPPA-style, appropriate for US law, not Indian law). The target audience is CBSE Classes 6–12 (ages approximately 11–18). Every student aged 13–17 is currently on the platform without valid parental consent under Indian law. Additionally, there is no mechanism to block a student's access while parental consent is pending — children can complete onboarding and use Foxy before a parent responds. No Data Processing Agreements are executed with any of the 11 third-party processors (OpenAI, Voyage AI, Razorpay, Mailgun, Twilio, PostHog, Sentry, Vercel, Supabase, Upstash, Anthropic). For a children's educational platform in India, DPDP compliance is not optional.

### 5. Security — Three Unauthenticated Endpoints Lack Rate Limiting (P1)

Static analysis of all 410 API routes found three endpoints with no rate limiting that are either public or easily reached with a valid JWT:
- **OAuth token endpoint** (`/api/oauth/token`): client credentials exchangeable for tokens with unlimited attempts — client secrets can be brute-forced
- **Payment order creation** (`/api/payments/create-order`, `subscribe`): no per-user limit — a compromised session can create unlimited Razorpay orders, incurring real costs
- **Auth bootstrap/session** (`/api/auth/bootstrap`, `session`): no application-layer rate limit beyond Supabase GoTrue's own limits

These are separately blocking because rate limiting gaps on an OAuth endpoint and payment endpoints expose the platform to credential stuffing and financial abuse.

---

## What IS Genuinely Good

This is not a failing system built on bad engineering. The opposite case is true and documented:

- **Authentication** is unusually well-hardened: JWT verification is always server-side against GoTrue, service-role key never reaches the client, role escalation is explicitly guarded, admin authorization is layered and fail-closed. No P0/P1 findings in the auth surface.
- **Quiz submission atomicity** is a genuinely strong design: fully transactional inside a SQL RPC, idempotency-keyed, anti-cheat checks, single canonical mastery write path.
- **Foxy AI tutor safety** is defense-in-depth: input guard (FOX-2) + output screen (FOX-1) + safety rails + grounding scope + safeguarding system for child welfare disclosures. No mastery/XP/grade writes from Foxy. Grade-spoof defense is thorough.
- **RBAC** is server-resolved, DB-backed, Redis-cached with instant taint-invalidation. No role stored in JWT claims. All 410 API routes have auth checks (verified by sweep). A prior P0 self-escalation hole in `user_roles` RLS was found and fixed (migration 20260816000009).
- **PII redaction** is multi-layered: shared redactor, Sentry beforeSend hooks, PostHog allowlist filtering, hashed distinct IDs, autocapture disabled.
- **Prior audit culture** is real: the team runs its own periodic production-readiness audits, maintains dated evidence trails, and has a FIX-LEDGER with independent verification requirements.

---

## Critical Path to GO

| # | Blocking Cluster | Specific Finding | Estimated Effort | Owner |
|---|---|---|---|---|
| 1 | Academic integrity | Close question_bank answer key exposure (column-level ACL or RPC-only serving) | 1–2 sprint days | Backend |
| 2 | AI tutor quality | Root-cause RAG retrieval regression; restore recall@10 ≥ 95%, faithfulness ≥ 95% | 1–2 weeks | AI/ML |
| 3 | Cron integrity | Fix verify-question-bank signing headers | 1 day | Backend |
| 4 | DPDP compliance | Raise age gate to 18; implement parental consent gate; execute DPAs with 11 processors | 1–2 weeks (legal + eng) | Legal + Backend |
| 5 | Rate limiting | Add per-IP/per-user limits to OAuth token, payment order, auth bootstrap | 1–2 days | Backend |
| 6 | Alerting | Establish redundant alerting channel (not single-person email) | 1 day | Ops |

**Critical path is dominated by items 2 (RAG regression) and 4 (DPDP compliance) which can proceed in parallel — total: ~2–3 weeks.** All other blockers can close within that window.

The remaining P2/P3 findings (see `17-findings-register.md`) are worth fixing but are not individually launch-blocking for a controlled B2B pilot with known school partners.

---

## Methodology

- **Static code analysis:** 410 API routes, 49 edge functions, 632 migrations, full monorepo
- **Live read-only queries:** Production Supabase `pg_policies`, `pg_class`, `information_schema`, Security Advisor (via MCP — no destructive SQL)
- **Cross-reference:** FIX-LEDGER.md (42+ findings), prior launch-readiness scorecard (7 gates all FAIL/CONDITIONAL), known risks register
- **Agent-based deep dives:** Auth system, RBAC, RLS, adaptive learning engines, Foxy AI tutor, observability, API routes, edge functions, cron jobs, CI/CD, RAG system, full table-by-table schema analysis, source-of-truth drift (grade encoding + role definitions + feature flags), cross-cutting OWASP vulnerability scan (410 routes), privacy/consent/DPDP deep audit, duplicate/dead code inventory
- **Evidence protocol:** Per memory `evidence-protocol.md`, no status claim without command + raw output

---

## Next Steps

1. **Do not begin remediation** until CEO reviews this audit and separately approves a remediation phase
2. The remediation roadmap (`19-remediation-roadmap.md`) proposes an 8-phase sequence with the 5 blocking items in Phase 0
3. All findings are registered in `17-findings-register.md` with severity, confidence, evidence, and recommended remediation
