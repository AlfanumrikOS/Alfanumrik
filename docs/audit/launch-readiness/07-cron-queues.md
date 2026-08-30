# 07 — Cron Jobs, Queues & Background Workers

**Audit date:** 2026-08-29
**Evidence source:** Cron jobs agent (completed), edge functions agent (completed), vercel.json

---

## 1. Cron Job Inventory

### Vercel Cron (vercel.json)
19 cron routes configured:

| Route | Schedule | Purpose | Status |
|-------|----------|---------|--------|
| /api/cron/daily-cron | 0 1 * * * | Master daily orchestrator (IST 06:30) | Active |
| /api/cron/streak-guardian | 30 0 * * * | Maintain streaks, freeze/reset | Active |
| /api/cron/adaptive-remediation | 0 2 * * * | Spaced repetition scheduling | Active |
| /api/cron/school-operations | 0 3 * * * | School data sync/cleanup | Active |
| /api/cron/verify-question-bank | 0 4 * * * | Question integrity verification | **BROKEN (P0-01)** |
| /api/cron/quiz-integrity-checker | 0 5 * * * | Quiz data consistency | Active |
| /api/cron/content-sync | 0 6 * * * | Content/curriculum sync | Active |
| /api/cron/analytics-aggregator | 0 7 * * * | Daily analytics rollup | Active |
| /api/cron/notification-dispatcher | */15 * * * * | Push notification batching | Active |
| /api/cron/session-cleanup | 0 0 * * * | Expired session cleanup | Active |
| /api/cron/cache-warmer | 0 22 * * * | Pre-warm Redis caches | Active |
| /api/cron/report-generator | 0 8 * * 1 | Weekly school reports | Active |
| /api/cron/subscription-checker | 0 9 * * * | Subscription expiry checks | Active |
| /api/cron/backup-verification | 0 10 * * * | Backup health checks | Active |
| /api/cron/queue-consumer | */5 * * * * | Process background task queue | Active |
| /api/cron/xp-reconciliation | 0 11 * * * | XP ledger reconciliation | Active |
| /api/cron/learning-path-optimizer | 0 12 * * * | Optimize learning paths | Active |
| /api/cron/parent-report-sender | 0 14 * * 5 | Weekly parent reports (Fri) | Active |
| /api/cron/webhook-retry | */10 * * * * | Retry failed webhooks | Active |

### pg_cron (Supabase)
6 pg_cron jobs configured:

| Job | Schedule | Purpose |
|-----|----------|---------|
| daily-cron | 30 1 * * * | Supabase-side daily orchestrator |
| SM-2 review scheduler | 0 2 * * * | Schedule spaced-repetition reviews |
| analytics-snapshot | 0 3 * * * | Daily analytics snapshot |
| stale-session-cleanup | 0 0 * * * | Clean expired Supabase sessions |
| event-bus-runner | */5 * * * * | Process state_events outbox |
| mastery-recalc | 0 4 * * 0 | Weekly mastery recalculation |

### Orphaned Routes (no vercel.json trigger)
| Route | Notes |
|-------|-------|
| /api/cron/evaluate-alerts | Handler exists but no cron trigger wired |
| /api/cron/goal-daily-plan-reminder | Handler exists but no cron trigger wired |

---

## 2. Findings

### P0
| ID | Finding | Impact |
|----|---------|--------|
| P0-01 | verify-question-bank never worked — signing headers in `grounded-client.ts` (`x-internal-timestamp` + `x-internal-signature`) are not validated by the Edge Function endpoint, causing 401 on every invocation | Platform's primary runtime integrity check for question bank answers has been a no-op since deployment |

### P1
| ID | Finding | Impact |
|----|---------|--------|
| P1-06 | streak-guardian uses INSERT without idempotency key — duplicate runs create duplicate streak records | Data integrity: students could have inflated streak counts |

### P2
| ID | Finding | Impact |
|----|---------|--------|
| P2-19 | queue-consumer task claim uses simple UPDATE without SELECT FOR UPDATE SKIP LOCKED — concurrent workers could claim the same task | Duplicate processing under high concurrency |
| P2-20 | streak-guardian, school-operations, evaluate-alerts lack overlapping-run protection (no run-lock pattern) — concurrent invocations could conflict | Data races on concurrent execution |
| P2-26 | daily-cron step `recalculatePerformanceScores` references a table that doesn't exist or has been renamed — step is dead code | Silent failure in daily orchestrator |

### P3
| ID | Finding | Impact |
|----|---------|--------|
| P3-15 | 2 orphaned cron routes (evaluate-alerts, goal-daily-plan-reminder) have handlers but no trigger | Dead code / incomplete feature |

---

## 3. Positive Findings

- `adaptive-remediation` has run-lock protection (advisory lock pattern) — a model for other cron jobs
- `daily-cron` orchestrates steps sequentially with per-step error isolation — one step failing doesn't abort the chain
- `queue-consumer` processes tasks with individual try/catch and marks failures — no silent drops
- `notification-dispatcher` runs every 15 min for near-real-time delivery while batching for efficiency
- Event bus (`state_events` outbox) with pg_cron runner is a well-designed eventually-consistent pattern

---

## 4. Gate Verdict

**CONDITIONAL GO** — P0-01 (verify-question-bank) is in Phase 0 blockers. P1-06 and P2 items are in remediation phases 1-2.
