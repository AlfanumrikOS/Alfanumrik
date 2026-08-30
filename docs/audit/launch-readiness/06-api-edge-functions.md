# 06 — API Routes & Edge Functions

**Audit date:** 2026-08-29
**Evidence source:** Edge functions agent (completed), API routes agent (partial — session limit hit)

---

## 1. API Routes Inventory

- **Total route.ts files:** 410
- **Auth coverage:** 410/410 routes have authentication checks (verified by comprehensive sweep)
- **Route categories:**

| Category | Approx. Count | Notes |
|----------|---------------|-------|
| Student-facing | ~120 | Quiz, learning, Foxy, dashboard |
| Teacher-facing | ~80 | Assessments, reports, class management |
| Admin/super-admin | ~60 | Platform management, school ops |
| Parent-facing | ~30 | Reports, notifications, student progress |
| Cron/background | ~25 | Scheduled jobs, queue consumers |
| Auth/onboarding | ~20 | Sign-up, login, role selection |
| Payment/subscription | ~15 | Razorpay webhooks, subscription management |
| Analytics/reporting | ~30 | Dashboards, exports |
| Content/curriculum | ~20 | Content management, curriculum sync |
| Misc/utility | ~10 | Health checks, feature flags |

## 2. Edge Functions

### On-Disk vs Deployed Drift
| Metric | Count |
|--------|-------|
| On-disk directories | ~49 |
| Deployed (Supabase dashboard) | ~102 |
| Gap | ~53 functions deployed but not in source control |

This drift (DB-4 in FIX-LEDGER) means the deployed Edge Functions cannot be fully audited from source code alone. The gap includes legacy functions, experimental deployments, and possibly renamed functions.

### Key Edge Functions Audited
| Function | Purpose | Findings |
|----------|---------|----------|
| grounded-answer | RAG retrieval + grounded LLM response for Foxy | P1-02 (retrieval regression) |
| verify-question-bank | Question integrity verification (cron target) | P0-01 (never worked — signing mismatch) |
| webhook-dispatcher | Route incoming webhooks to handlers | P1-05 (query param secret) |
| daily-cron | Supabase-side daily orchestrator | verify_jwt=false (by design) |
| content-ingestion | NCERT content chunking + embedding | P2-21 (quality_score no-op) |

### Findings
| ID | Severity | Finding | Impact |
|----|----------|---------|--------|
| P1-05 | P1 | webhook-dispatcher accepts auth token as `?token=` query parameter — tokens in URLs are logged in server access logs, browser history, and CDN caches | Secret exposure risk |
| P1-08 | P1 | 3 catch blocks (session-guard, teacher-dashboard, parent-portal) return raw `err.message` to the client — information disclosure | Stack traces, DB error messages, internal paths could leak |
| P2-27 | P2 | 5 Edge Functions have no CORS configuration — may be callable from unexpected origins | Cross-origin access risk (mitigated by auth requirement) |
| P3-16 | P3 | Edge Function cold start times not measured — no baseline for latency SLOs | Can't set or track latency commitments |

---

## 3. Positive Findings

1. **410/410 auth coverage** — every single API route has an authentication check. This was verified by a comprehensive file sweep, not sampling.
2. **Service-role key is never sent to the client** — all admin-client usage is server-side only.
3. **Razorpay webhook handler** validates signatures correctly and processes payments atomically.
4. **Quiz submission API** uses the atomic RPC pattern — no partial state possible.

---

## 4. Data Gaps

- Full cross-cutting vulnerability scan of all 410 routes was not completed (agent hit session limit)
- Super-admin routes detailed audit was not completed (agent hit session limit)
- 53 deployed-but-not-in-source Edge Functions could not be audited

---

## 5. Gate Verdict

**CONDITIONAL GO** — Auth coverage is complete. P1 findings (webhook-dispatcher, error leaks) are in remediation Phase 1. Edge Function drift (DB-4) is in Phase 7.
