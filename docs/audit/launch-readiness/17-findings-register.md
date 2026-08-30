# 17 — Findings Register

**Audit date:** 2026-08-29/30
**Status:** COMPLETE (investigation phase)
**Methodology:** Static code analysis of full monorepo + live read-only queries against production Supabase (shktyoxqhundlvkiwguu) + cross-reference with FIX-LEDGER.md (42+ prior findings) and prior launch-readiness scorecard

---

## Severity Definitions

| Severity | Definition |
|----------|-----------|
| **P0** | Launch-blocking. Immediate fix required. Active exploitation risk or data integrity violation. |
| **P1** | Must fix before launch. High severity — security, correctness, or core-promise violation. |
| **P2** | Should fix. Medium severity — defense-in-depth gap, maintenance risk, or degraded functionality. |
| **P3** | Low priority. Informational, hygiene, or hardening opportunity. |

## Confidence Definitions

| Confidence | Definition |
|-----------|-----------|
| **Confirmed** | Verified against live production or reproducible evidence |
| **Likely** | Strong code-level evidence, not live-verified |
| **Possible** | Inferred from code patterns, needs verification |

---

## P0 — CRITICAL

### P0-01: verify-question-bank Edge Function has NEVER successfully verified a question
- **Source:** Cron jobs audit (migration 20260825150000)
- **Confidence:** Confirmed (migration self-documents the failure)
- **Evidence:** grounded-client.ts missing x-internal-timestamp + x-internal-signature headers. Every invocation claims rows, releases them unverified, reports success. Zero ops_events with category='grounding.verifier' exist. The signing fix ships separately and must merge FIRST.
- **Impact:** RAG verification gate (ff_grounded_ai_enforced_pairs) can never be enabled. Question bank content is served without grounding verification.
- **Remediation:** Ship the signing header fix to grounded-client.ts, then verify the cron produces real verification results.

---

## P1 — HIGH

### P1-01: Question bank answer key readable by any authenticated user
- **Source:** RLS audit + Grants audit + FIX-LEDGER DB-41 (cross-confirmed)
- **Confidence:** Confirmed (live query against production pg_policies + has_column_privilege)
- **Evidence:** RLS policy `question_bank_authenticated_read USING(true)` grants SELECT on `correct_answer_index`, `correct_answer_text`, `explanation`, `solution_steps`, `hint_level_1/2/3` for all 12,826+ questions. Any student can bypass quiz UI via direct REST API query.
- **Impact:** Core academic integrity violation for a K-12 assessment platform.
- **Prior art:** Self-documented as open in migrations 20260806000004, 20260814000000, 20260814000020, 20260814000023. Column ACL designed but not applied because 3/4 quiz-serving RPCs still return the key in-payload.
- **Remediation:** Column-level ACL revoke + migrate remaining RPCs to keyless serving.

### P1-02: RAG retrieval quality regression — recall@10 at 66.1% vs 95% bar
- **Source:** Prior launch-readiness scorecard (2026-08-23 eval run)
- **Confidence:** Confirmed (harness ran with real Voyage rerank-2 + Claude judge)
- **Evidence:** recall@10 0.822→0.661, nDCG@10 0.662→0.512, MRR 0.729→0.575, faithfulness ~40-47%. Three mandated metrics (recall@3, correctness, abstention) not computed at all.
- **Impact:** Core product promise (grounded NCERT AI tutor) degraded below launch mandate bars.
- **Remediation:** Root-cause corpus-growth dilution (16k→27k chunks), retune retrieval, extend harness for missing metrics.

### P1-03: CI Gate is NOT a required status check in branch protection
- **Source:** CI/CD audit (ci.yml line 3093 comment)
- **Confidence:** Confirmed (ruleset main-protection documented)
- **Evidence:** Required checks are only: Secret Scanning, Lint/Type-check/Test, Production Build, CodeQL Analysis. CI Gate (the aggregate fan-in for integration-tests, edge-function-tests, e2e-critical-paths, secret-scan, foxy-alignment) is NOT required. PRs can merge despite failures in these jobs.
- **Impact:** Broken code can enter main; this is the likely structural enabler of the b00b9c872 stale-base merge incident.
- **Remediation:** Add "CI Gate" to main-protection required status checks.

### P1-04: Single-person email-only alerting pipeline
- **Source:** Observability audit
- **Confidence:** Confirmed (migration 20260713160000 wires single CEO email channel)
- **Evidence:** All alert rules dispatch to one notification channel (CEO email via Mailgun). No Slack, no escalation chain, no redundancy. If CEO email unreachable, critical alerts (payment webhook failures, adaptive loop ceiling violations) go unnoticed.
- **Impact:** Ops blindness during CEO unavailability.
- **Remediation:** Add at least one redundant channel (Slack webhook or second email).

### P1-05: webhook-dispatcher accepts CRON_SECRET via query parameter
- **Source:** Edge functions audit (webhook-dispatcher/index.ts lines 91-92)
- **Confidence:** Confirmed (code inspection)
- **Evidence:** `url.searchParams.get('token')` as fallback auth. Query parameters logged in HTTP access logs, Vercel edge logs, CDN logs — secret leakage vector.
- **Remediation:** Remove `?token=` auth path; enforce header-only auth.

### P1-06: streak-guardian creates duplicate notifications on re-run
- **Source:** Cron jobs audit (streak-guardian/route.ts)
- **Confidence:** Likely (code uses INSERT not UPSERT; no idempotency key)
- **Evidence:** Vercel retry or manual re-trigger creates duplicate streak-protection notifications for every affected student. No unique constraint or idempotency_key prevents duplicates.
- **Remediation:** Switch to UPSERT with per-day idempotency key.

### P1-07: match_rag_chunks_ncert RPC EXECUTE granted to authenticated role
- **Source:** RAG system audit (migration 20260707020000 lines 64-76)
- **Confidence:** Confirmed (live has_function_privilege query)
- **Evidence:** SECURITY DEFINER RPC callable directly by any authenticated user via client SDK, bypassing rate limiting, circuit breaker, output screening, quota enforcement, and audit logging. Returns shared NCERT curriculum (not a data leak) but enables compute abuse.
- **Remediation:** REVOKE EXECUTE from authenticated; all legitimate callers use service_role via Edge Functions.

### P1-08: Error messages leaked to clients in 3+ Edge Functions
- **Source:** Edge functions audit (session-guard, teacher-dashboard, parent-portal)
- **Confidence:** Confirmed (code inspection of catch blocks)
- **Evidence:** Raw `err.message` returned in HTTP responses. Can include DB table names, constraint names, column names, Deno runtime details. Violates P13.
- **Remediation:** Return generic error messages; log raw errors server-side only.

---

## P2 — MEDIUM

### P2-01: Default privileges auto-grant INSERT/UPDATE/DELETE to anon/authenticated on new tables
- **Source:** Grants audit (confirmed live via pg_default_acl)
- **Confidence:** Confirmed
- **Evidence:** anon has INSERT on 392/427 tables, authenticated on 399/427. RLS is the only backstop. Any future table shipped without correct RLS write policies is immediately anon-writable. No CI/lint gate enforces this.

### P2-02: Default ACL auto-grants EXECUTE to anon/authenticated on new functions
- **Source:** Grants audit (confirmed live via pg_default_acl)
- **Confidence:** Confirmed
- **Evidence:** Already caused ~200 functions to need retroactive REVOKE across 4 remediation migrations. The default was never changed, so the same exposure recurs for every new function.

### P2-03: institution_admin self-serve creates tenant with no verification gate
- **Source:** RBAC audit (bootstrap/route.ts)
- **Confidence:** Confirmed (code inspection)
- **Evidence:** POST /api/auth/bootstrap with role='institution_admin' + school_name creates a new schools row + principal entry. No invitation, payment gate, or human review. Scripted mass-creation of fake school tenants is bounded only by auth account creation rate.

### P2-04: 316 SECURITY DEFINER functions reachable by anon/authenticated
- **Source:** RLS audit (Security Advisor query)
- **Confidence:** Confirmed (live query). Only ~20 sampled for body audit.
- **Evidence:** 209 executable by authenticated, 107 also by anon. Sampled functions all enforce internal auth, but unsampled ~296 are a scope risk.

### P2-05: compute_mrr_snapshot() SECURITY DEFINER, anon-executable, no auth check
- **Source:** RLS audit
- **Confidence:** Confirmed (live function body inspection)
- **Evidence:** Any anonymous caller can trigger MRR recomputation. No data leak (returns integer) but data-integrity/DoS-adjacent.

### P2-06: exam_papers, cbse_board_papers, exam_paper_templates USING(true) for authenticated
- **Source:** RLS audit
- **Confidence:** Confirmed (live pg_policies query)
- **Evidence:** Assessment content accessible to any authenticated user, not scoped to teacher/admin.

### P2-07: Stale DESIGN_ONLY migration in supabase/migrations/
- **Source:** Grants audit (20260823154500_db12_..._DESIGN_ONLY.sql)
- **Confidence:** Confirmed
- **Evidence:** Header says "DO NOT push" but it was accidentally applied to production on 2026-08-23. File remaining means next `db push --include-all` against staging applies it again.

### P2-08: Learning velocity clamped to non-negative hides regression signals
- **Source:** Adaptive learning audit (cognitive-engine.ts line 563)
- **Confidence:** Confirmed (code inspection)
- **Evidence:** `Math.max(0, slope)` suppresses signal that student is regressing. `predictMasteryDate` returns null for velocity ≤ 0.

### P2-09: STEM-lab experiment evidence computed but never persisted
- **Source:** Adaptive learning audit (cognitive-engine.ts lines 1524-1538)
- **Confidence:** Confirmed (header documents "No DB write happens here")
- **Evidence:** recordExperimentEvidence is pure function — STEM-lab viva performance has zero effect on mastery profile.

### P2-10: No deduplication between remediation cards and SRS review slots
- **Source:** Adaptive learning audit
- **Confidence:** Likely
- **Evidence:** remediation-queue-adapter plans cards independently of daily rhythm. Student could see same topic in both remediation and SRS slots same day.

### P2-11: IRT theta and BKT mastery are separate models that could diverge
- **Source:** Adaptive learning audit (irt/fisher-info.ts + cognitive-engine.ts)
- **Confidence:** Confirmed (architectural design)
- **Evidence:** Question difficulty selection (IRT) may not align with knowledge state tracking (BKT).

### P2-12: Foxy GET /api/foxy message query lacks student_id defense-in-depth filter
- **Source:** Foxy audit (route.ts lines 3585-3589)
- **Confidence:** Confirmed (not exploitable today due to session-level guard)
- **Evidence:** Message query filters by session_id only, not student_id. If session verification is ever separated from message retrieval, this becomes tenant-unsafe.

### P2-13: Input guard regex may miss sophisticated multilingual prompt injection
- **Source:** Foxy audit (input-guard.ts)
- **Confidence:** Likely
- **Evidence:** Pattern-based guard won't catch base64-encoded instructions, Hindi/Urdu injection variants, or "pretend you are" patterns not matching exact regexes. Output screen (FOX-1) is the hard backstop.

### P2-14: Single notification channel for all alerts
- **Source:** Observability audit
- **Confidence:** Confirmed
- **Evidence:** If CEO email or Mailgun fails, all alerts are silently lost. No redundant delivery.

### P2-15: Alert delivery retry behavior unclear
- **Source:** Observability audit
- **Confidence:** Likely
- **Evidence:** retry_count column exists but no evidence of exponential backoff or dead-letter for repeatedly failed deliveries.

### P2-16: Edge Function auth sweep is advisory (continue-on-error: true)
- **Source:** CI/CD audit (edge-auth-sweep.yml line 41)
- **Confidence:** Confirmed
- **Evidence:** Nightly auth probe for unauthenticated Edge Function access is advisory, not blocking. Has been advisory since at least 2026-07-28.

### P2-17: Migration lint (SELECT-1 guard) is NOT a required status check
- **Source:** CI/CD audit (migration-lint.yml)
- **Confidence:** Confirmed

### P2-18: Staging deploy disabled since 2026-08-25
- **Source:** CI/CD audit (deploy-staging.yml)
- **Confidence:** Confirmed
- **Evidence:** Staging Supabase project unreachable. Integration tests may be running against an unreachable project.

### P2-19: queue-consumer claim lacks SELECT FOR UPDATE atomicity
- **Source:** Cron jobs audit (queue-consumer/index.ts)
- **Confidence:** Likely
- **Evidence:** Two concurrent consumers could claim the same row.

### P2-20: No overlapping-run protection on most Vercel cron jobs
- **Source:** Cron jobs audit (systemic)
- **Confidence:** Confirmed
- **Evidence:** Only adaptive-remediation has run-lock. Vercel retries can cause concurrent runs.

### P2-21: RAG quality_score is effectively a no-op
- **Source:** RAG audit
- **Confidence:** Confirmed (68% NULL rows, rest all exactly 0.7, gate at 0.4)

### P2-22: No embedding staleness detection or re-embedding trigger
- **Source:** RAG audit
- **Confidence:** Confirmed

### P2-23: No chunk overlap in NCERT ingestion
- **Source:** RAG audit
- **Confidence:** Confirmed
- **Evidence:** Concepts spanning paragraph boundaries are split such that neither chunk alone provides complete information.

### P2-24: No deduplication in NCERT ingestion
- **Source:** RAG audit
- **Confidence:** Confirmed
- **Evidence:** Same PDF ingested twice creates duplicate chunks.

### P2-25: Grounding check 5s timeout causes widespread abstentions during API latency spikes
- **Source:** RAG audit (grounding-check.ts line 25)
- **Confidence:** Likely

### P2-26: recalculatePerformanceScores always throws (dead step in daily-cron)
- **Source:** Cron audit + Edge functions audit
- **Confidence:** Confirmed
- **Evidence:** References nonexistent 'chapter_topics' table. Silently caught by Promise.allSettled.

### P2-27: XP credit read-then-write race in queue-consumer fallback
- **Source:** Edge functions audit (M3)
- **Confidence:** Likely
- **Evidence:** When atomic award_xp_points RPC unavailable, fallback path has read-then-write race.

---

## P3 — LOW / INFORMATIONAL (selected highlights, not exhaustive)

### P3-01: Internal ops/metadata tables readable by any authenticated user (kpi_metric_contracts, data_classification, etc.)
### P3-02: 21 functions with mutable search_path; vector/pg_trgm extensions in public schema
### P3-03: Debug secret bypass on /api/super-admin/debug/whoami (gated off in production)
### P3-04: Plaintext generated passwords returned in test-accounts API response
### P3-05: No auto-injection of request IDs in logger
### P3-06: Staging/preview Sentry completely disabled (beforeSend returns null)
### P3-07: Health endpoint always returns HTTP 200 (intentional, but simple monitors can't detect degradation)
### P3-08: Foxy error.tsx does not report to Sentry
### P3-09: Multiple mastery threshold sets exist (intentional, documented, maintenance overhead)
### P3-10: Internal BKT vs canonical BKT parameter divergence (intentional, maintenance risk)
### P3-11: System prompt can grow very large with all additive sections enabled
### P3-12: No per-second/per-minute rate limiting at Foxy API route level
### P3-13: Single CODEOWNERS team for entire repo
### P3-14: No branch protection auditing workflow
### P3-15: Cosine similarity floor hardcoded (0.22), not configurable
### P3-16: Citation regex [N] fragile for math content
### P3-17: WhatsApp send permanently disabled in daily-cron
### P3-18: domain_events bus handlers are all no-op stubs

---

## PRIOR FINDINGS CROSS-REFERENCE (FIX-LEDGER.md)

| FIX-LEDGER ID | Description | Status in this audit |
|---|---|---|
| DB-1 | 7 views RLS bypass with write-capable grants | **VERIFIED CLOSED** (2026-08-23, independent behavioral probe — 7/7 permission-denied) |
| DB-2 | coupons anon-readable | FIXED-UNVERIFIED (not re-verified this audit) |
| DB-3 | XP ledger drift (14/68 students) | NOT-STARTED (confirmed still open) |
| DB-4 | Edge Function drift (102 deployed vs ~47 on disk) | NOT-STARTED |
| DB-9 | Grade encoding split ("Grade 11" vs "11") | NOT-STARTED (6,061 assets unreachable) |
| DB-10 | user_roles.auth_user_id orphaned (31/65 = 48%) | NOT-STARTED |
| DB-11 | Notifications to nonexistent recipients (259/806 = 32%) | NOT-STARTED |
| DB-12 | TRUNCATE grant gap on money tables | **VERIFIED CLOSED** (live-verified: 0/427 tables grant TRUNCATE to anon/authenticated) |
| DB-13 | concept_mastery total_attempts/total_correct never written (40% mismatch) | NOT-STARTED |
| DB-14 | XP divergence students.xp_total vs Σ student_learning_profiles.xp (30.7%) | NOT-STARTED |
| DB-15 | 3 flags documented OFF are ON with NULL rollout_percentage | NOT-STARTED |
| DB-16 | 41 functions + 11 relations in zero migrations, 30 SECURITY DEFINER | NOT-STARTED |
| DB-17 | atomic_quiz_profile_update 4 overloads with disagreeing argument order | NOT-STARTED |
| DB-18 | Two RAG chunk stores incompatible vector geometry (1024 vs 1536) | NOT-STARTED |
| DB-40 | Money table client-write policies | **VERIFIED CLOSED** (2026-08-23, live behavioral probe — RLS-denied on INSERT) |
| DB-41 | question_bank answer key exposed | **CONFIRMED STILL OPEN** (elevated to P1-01 in this audit) |

### Key status changes from prior scorecard:
- **DB-12 (TRUNCATE):** Was listed as NOT-STARTED → now **VERIFIED CLOSED** by Grants audit live query
- **DB-1 (7 views):** Was FIXED-UNVERIFIED → now **VERIFIED CLOSED** by prior scorecard independent probe
- **DB-40 (money write policies):** Was VERIFIED → confirmed still VERIFIED CLOSED
- **RAG retrieval regression:** Was framed as stale measurement → confirmed **GENUINE REGRESSION** by live eval run

---

## POSITIVE FINDINGS (well-implemented, no issues)

| Area | Finding |
|---|---|
| Authentication | JWT always verified server-side against GoTrue; service-role key never reaches client; role escalation explicitly guarded |
| Quiz submission | Fully atomic via SQL RPC; idempotency-keyed; single canonical mastery write path |
| Foxy safety | Defense-in-depth: FOX-2 input guard + FOX-1 output screen + safety rails + grounding scope + safeguarding system |
| Foxy isolation | No mastery/XP/grade writes from Foxy; grade-spoof defense; tenant isolation via dual-filter queries |
| PII redaction | Multi-layered: shared redactor, Sentry beforeSend, PostHog allowlist, hashed distinct IDs, autocapture disabled |
| Money tables | Fully locked down: zero INSERT/UPDATE/DELETE/TRUNCATE for anon/authenticated (live-verified) |
| quiz_session_shuffles | Answer-key columns correctly column-ACL'd to service_role only (live-verified) |
| XP economy | Well-bounded: daily cap 200 XP, anti-cheat checks, idempotency keys prevent replay |
| RBAC storage | Server-resolved, DB-backed, Redis-cached with instant taint-invalidation; never in JWT claims |
| API auth coverage | 410/410 routes have auth checks (full sweep, all 31 grep-misses manually verified) |
| Deployment pipeline | Fail-closed quality gate, multi-stage health verification, auto-rollback with post-rollback verification |
| Migration deployment | Direct-SQL ledger verification (not CLI parsing), post-deploy behavioral assertions, non-vacuity guards |
| Daily-cron isolation | 27 steps in Promise.allSettled — one failure cannot cascade |
| Cron auth | Constant-time comparison throughout; fail-closed on missing CRON_SECRET |
