# 18 — Launch Gate Scorecard

**Audit date:** 2026-08-29/30
**Target:** Controlled B2B pilot launch to CBSE schools (Classes 6–12)
**Overall verdict:** **NO-GO** (5 independently blocking clusters — 2 new identified in Phase 2 audit)

---

## Gate Status Summary

| # | Gate | Verdict | Basis |
|---|------|---------|-------|
| 1 | Repo reproducibility | **CONDITIONAL GO** | CI is green; CI Gate not required in branch protection (P1-03); E2E Nightly red 25+ days |
| 2 | Build & bundle | **GO** | Three-layer bundle gate with vacuity detection; standalone Docker build |
| 3 | Secret scanning | **GO** | Gitleaks blocking; narrow allowlist; advisory regex scan |
| 4 | Database schema integrity | **CONDITIONAL GO** | RLS 100% coverage; DB-12 TRUNCATE now closed; stale DESIGN_ONLY migration still in migrations/ |
| 5 | Migration parity | **CONDITIONAL GO** | Direct-SQL ledger verification; non-vacuity guards; but staging DB unreachable |
| 6 | RLS coverage | **CONDITIONAL GO** | 427/427 tables have RLS enabled; but question_bank answer key exposed (P1-01) |
| 7 | Grant hygiene | **NO-GO** | Default privileges auto-grant INSERT/UPDATE/DELETE to anon/authenticated on all new tables/functions; question_bank answer key is the live consequence |
| 8 | Auth — JWT verification | **GO** | Always server-side against GoTrue; no local/unsigned decode found |
| 9 | Auth — service-role key isolation | **GO** | Server-only singleton; runtime guard throws if found in NEXT_PUBLIC_* |
| 10 | RBAC — role storage | **GO** | DB-backed, server-resolved, Redis-cached with taint-invalidation; never in JWT claims |
| 11 | RBAC — route coverage | **GO** | 410/410 routes have auth checks (full sweep verified) |
| 12 | RBAC — escalation prevention | **CONDITIONAL GO** | Self-escalation hole fixed (20260816000009); institution_admin self-serve unverified by product (P2-03) |
| 13 | Tenant isolation | **CONDITIONAL GO** | Cross-tenant fix TSB-1 holds; Foxy message query lacks defense-in-depth student_id filter (P2-12) |
| 14 | Quiz submission atomicity | **GO** | Fully transactional SQL RPC; idempotency-keyed; single canonical mastery write path |
| 15 | Adaptive learning closed loop | **CONDITIONAL GO** | answer→attempt→mastery→recommendation loop verified; BKT/IRT model divergence risk (P2-11); experiment evidence not persisted (P2-09) |
| 16 | Foxy AI safety | **GO** | Defense-in-depth: FOX-2 + FOX-1 + safety rails + safeguarding system; no mastery/XP writes |
| 17 | RAG retrieval quality | **NO-GO** | recall@10 66.1% vs 95% bar; faithfulness ~40-47% vs 95% bar; 3/5 mandated metrics not computed (P1-02) |
| 18 | Question bank integrity | **NO-GO** | Answer key readable by any authenticated user via direct REST (P1-01) |
| 19 | Payment integrity | **GO** | Money tables fully locked down (live-verified); webhook signature verification holds; atomic subscription activation |
| 20 | Observability & alerting | **CONDITIONAL GO** | Structured logging + Sentry + PostHog + ops_events pipeline; single-person email-only alerting (P1-04) |
| 21 | Cron job reliability | **CONDITIONAL GO** | 19 Vercel + 6 pg_cron jobs; verify-question-bank never worked (P0-01); 2 orphaned routes; most lack overlapping-run protection |
| 22 | PII redaction | **GO** | Multi-layered: shared redactor, Sentry beforeSend, PostHog allowlist, hashed IDs, autocapture disabled |
| 23 | Backup & disaster recovery | **CONDITIONAL GO** | Restore drill executed against staging (2026-08-23); full 6-item checklist needs populated data |
| 24 | CI/CD deployment gating | **CONDITIONAL GO** | Fail-closed quality gate in deploy-production.yml; but CI Gate not in required checks |
| 25 | Error handling & boundaries | **CONDITIONAL GO** | 52 files reference ErrorBoundary; global-error.tsx reports to Sentry; but Foxy error.tsx and 3 Edge Functions leak raw errors |

---

## Phase 2 Audit Additions

Two additional NO-GO gates identified by the deep-dive agents:

| # | Gate | Verdict | Basis |
|---|------|---------|-------|
| 26 | DPDP / Child consent | **NO-GO** | Age gate at 13 vs India DPDP requirement of 18; no DPAs with 11 processors; child can use platform before parental consent obtained |
| 27 | Rate limiting on critical endpoints | **NO-GO** | OAuth token, payment order creation, auth bootstrap/session have no HTTP rate limiting |

Additional Phase 2 findings (not blocking gates, added to domain files):
- Grade encoding: 22+ production files parse grades as integers (P5 rule violation pervasive)
- Schema: `class_students` vs `class_enrollments` duplicate tables; 4 duplicate indexes on rag_content_chunks
- Source of truth: generated types dead (1 consumer); 6 conflicting RoleName definitions; DB-15 feature flags NOT-STARTED
- Vulnerability: PostgREST filter injection in observability events; scan-solve base64 size limit missing

---

## Verdict Tally

| Verdict | Count |
|---------|-------|
| **GO** | 10 |
| **CONDITIONAL GO** | 12 |
| **NO-GO** | 5 |

**Overall: NO-GO** — Gates 7, 17, 18, 26, and 27 are independently blocking.

---

## What Changed Since Prior Scorecard (2026-08-23)

| Gate | Prior | Now | What changed |
|------|-------|-----|-------------|
| DB-12 (TRUNCATE) | FAIL | CLOSED | Live-verified: 0/427 tables grant TRUNCATE to anon/authenticated |
| DB-1 (7 views) | FIXED-UNVERIFIED | VERIFIED CLOSED | Independent behavioral probe confirmed |
| DB-40 (money writes) | VERIFIED | Still VERIFIED | Confirmed still holds |
| Backup/restore | FAIL | CONDITIONAL GO | Drill executed against staging |
| RAG quality | CONDITIONALLY READY | NO-GO | Genuine regression confirmed by live eval |
| Question bank | Ungraded | NO-GO | Answer key exposure confirmed live |
| Deployment gating | FAIL | CONDITIONAL GO | CEO applied Vercel toggle + CLI deploy |

---

## Critical Path to GO

| Priority | Gate | Blocking Finding | Est. Effort |
|----------|------|-----------------|-------------|
| 1 | 18 | P1-01: Close question_bank answer key exposure | 1-2 days |
| 2 | 17 | P1-02: Root-cause RAG retrieval regression | 1-2 weeks |
| 3 | 26 | P-10: Raise DPDP age gate to 18; implement parental consent gate; execute DPAs | 1-2 weeks (legal + eng) |
| 4 | 27 | VULN-D1/D2/D3: Add rate limiting to OAuth, payments, auth bootstrap | 1-2 days |
| 5 | 7 | P2-01/P2-02: Change default privileges for new tables/functions | 1 day |
| 6 | 1 | P1-03: Add CI Gate to required status checks | 30 min |
| 7 | 20 | P1-04: Add redundant alerting channel | 1 day |
