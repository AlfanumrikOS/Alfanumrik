# Alfanumrik SRE Runbook — Wave 1 Production

**Last updated:** 2026-07-17 (§13 escalation: prod OOM, kill switch renamed to `_V2`)  
**On-call:** ceo@alfanumrik.com  
**Stack:** Next.js (Vercel) · Supabase (ap-south-1) · Edge Functions · Razorpay

---

## 1. Service Topology

```
Student / Parent / Teacher
        │
   Vercel Edge (Next.js App Router)
        │
   Supabase Edge Functions
   ├── foxy-tutor      (AI tutor, verify_jwt=false, own auth)
   ├── quiz-submit     (verify_jwt=false, own auth)
   ├── rag-retrieval   (verify_jwt=true)
   ├── ml-adaptation   (verify_jwt=true, BKT)
   ├── payments        (Razorpay webhook, verify_jwt=false)
   └── daily-cron      (pg_cron, verify_jwt=false, x-cron-secret)
        │
   Supabase Postgres 17 (ap-south-1)
   └── pgvector · pg_cron · pg_net
```

---

## 2. Alert Thresholds & Response

| Alert | Warn | Critical | Action |
|---|---|---|---|
| `signup_failure_rate` | 5% | 20% | Check auth logs → Supabase Auth status |
| `login_p95_latency` | 800ms | 2000ms | Check DB connections, RLS policies |
| `edge_fn_error_rate` | 2% | 10% | Check Supabase edge function logs |
| `foxy_tutor_p95_latency` | 3s | 8s | Check Voyage API, OpenAI/Anthropic status |
| `quiz_submit_p95_latency` | 2s | 5s | Check DB indexes, BKT trigger load |
| `db_connection_utilization` | 70% | 90% | Scale connection pool; check for long-running queries |
| `db_query_p95_latency` | 500ms | 2s | Run `EXPLAIN ANALYZE` on slow queries, check `pg_stat_statements` |
| `daily_cron_failure` | 1 | 1 | Check edge function logs for daily-cron; run manually |
| `quota_exceeded_rate` | 15% | 40% | Check `student_daily_usage`; verify `check_and_record_usage` |
| `payment_failure_rate` | 5% | 20% | Check Razorpay dashboard; check `payments` edge function logs |
| `subscription_drift` | 0 | 5 | Run subscription reconciliation script |
| `rag_zero_results_rate` | 5% | 20% | Check `rag_content_chunks` embeddings; verify Voyage API |
| `irt_theta_stale` | 10 | 50 | Check `trg_quiz_response_irt_theta` trigger; run backfill |

---

## 3. Runbook: Daily-Cron Failure

**Symptoms:** `daily_cron_failure` alert fires; daily-cron returns non-200/207.

**Diagnosis:**
```bash
# Check recent logs via Supabase dashboard
# Project → Edge Functions → daily-cron → Logs

# Manual test (replace secret if rotated)
curl -X POST https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/daily-cron \
  -H "x-cron-secret: alf_cron_8kP3xR7mW2vN9qT4jL6yB1dF5hS0cA" \
  -H "Content-Type: application/json" -d '{}'
```

**Known fixes:**
- 500 "cron secret unavailable" → `get_cron_secret()` function missing; run migration `000017`
- 207 with step errors → Schema mismatch; check column names against current DB
- 401 Unauthorized → Cron job sending wrong secret; check `cron.job` table

---

## 4. Runbook: Auth Failures

**Symptoms:** Users can't sign in; 500s on `/api/auth/` routes.

**Diagnosis:**
```sql
-- Check recent auth errors
SELECT * FROM auth.audit_log_entries
WHERE created_at > now() - interval '1 hour'
  AND instance_id IS NOT NULL
ORDER BY created_at DESC LIMIT 50;
```

**Known fixes:**
- Check Supabase Auth service status at status.supabase.com
- If RLS infinite recursion: check `students` table RLS policies
- If JWT expired: check `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel env vars

---

## 5. Runbook: Foxy Tutor Slow / Failing

**Symptoms:** `foxy_tutor_p95_latency` alert; students report AI tutor not responding.

**Diagnosis:**
```bash
# Test foxy with a valid student JWT
curl -X POST https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/foxy-tutor \
  -H "Authorization: Bearer <student_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","student_id":"<uuid>","subject":"math","grade":"8"}'
```

**Check quota enforcement:**
```sql
SELECT * FROM student_daily_usage
WHERE student_id = '<uuid>' AND feature = 'foxy_chat'
ORDER BY usage_date DESC LIMIT 7;
```

**Known fixes:**
- 429 quota hit → Check `subscription_plans` limits for student's plan
- Slow → Check Voyage AI API status; check `rag_content_chunks` index on embeddings
- 500 → Check `foxy-tutor` edge function logs; verify `ANTHROPIC_API_KEY` / `VOYAGE_API_KEY` secrets set

---

## 6. Runbook: Payment Failures

**Symptoms:** Students report payment not going through; `payment_failure_rate` alert.

**Diagnosis:**
```sql
-- Check recent payment events
SELECT * FROM subscription_events
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC LIMIT 20;

-- Check for drift: active subscriptions vs quota
SELECT s.id, s.email, ss.status, ss.ends_at,
       sdu.usage_count, sp.foxy_chat_daily_limit
FROM students s
JOIN student_subscriptions ss ON ss.student_id = s.id
JOIN subscription_plans sp ON sp.id = ss.plan_id
LEFT JOIN student_daily_usage sdu ON sdu.student_id = s.id
  AND sdu.feature = 'foxy_chat' AND sdu.usage_date = current_date
WHERE ss.status = 'active' AND ss.ends_at < now();
```

**Known fixes:**
- Check Razorpay dashboard for webhook delivery failures
- Re-send webhook manually from Razorpay → payments edge function
- For subscription drift: run `UPDATE student_subscriptions SET status='expired' WHERE ends_at < now() AND status='active'`

---

## 7. Runbook: RAG Zero Results

**Symptoms:** Foxy answers missing content; `rag_zero_results_rate` alert.

**Diagnosis:**
```sql
-- Check embedding coverage
SELECT subject, count(*) as chunks, count(embedding) as with_embedding
FROM rag_content_chunks
GROUP BY subject ORDER BY subject;

-- Test vector search
SELECT id, content_text, similarity
FROM match_rag_chunks(
  '[0.1, 0.2, ...]'::vector,  -- test embedding
  0.5, 5, '{}', NULL, NULL, NULL
);
```

**Known fixes:**
- Missing embeddings → Re-run `embed-ncert-qa` or `generate-embeddings` edge function
- Low similarity → Lower match threshold in `foxy-tutor` (currently 0.65)
- Voyage API down → Check `VOYAGE_API_KEY` secret; check api.voyageai.com status

---

## 8. Runbook: IRT Theta Stale

**Symptoms:** `irt_theta_stale` alert; students getting wrong difficulty.

**Diagnosis:**
```sql
-- Check trigger is active
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgname = 'trg_quiz_response_irt_theta';

-- Manual backfill for specific student
SELECT update_irt_theta('<student_uuid>', 'math');

-- Check recent IRT updates
SELECT student_id, subject, irt_theta, irt_theta_se, updated_at
FROM student_learning_profiles
WHERE irt_theta IS NOT NULL
ORDER BY updated_at DESC LIMIT 20;
```

---

## 9. Wave Activation Checklist

### Wave 1 → Wave 2 Gate (trigger when ≥500 DAU sustained for 7 days)
- [ ] `wave2_jee_neet_prep`: enable when Class 11/12 student count ≥ 100
- [ ] `wave2_all_subjects`: NCERT content for History/Geo/Civics embedded in RAG
- [ ] `wave2_multilingual_12`: all 12 language translations QA'd
- [ ] `wave2_teacher_classroom`: teacher portal load-tested at 50 concurrent teachers
- [ ] Run `UPDATE feature_flags SET is_enabled=true, rollout_percentage=10 WHERE flag_name='wave2_jee_neet_prep'`

### Wave 2 → Wave 3 Gate (trigger at ≥10,000 MAU)
- [ ] Phygital center partner agreements signed
- [ ] Government MoU signed
- [ ] Offline sync infrastructure tested (migration `20260321092003`)
- [ ] Run `UPDATE feature_flags SET is_enabled=true, rollout_percentage=5 WHERE flag_name='wave3_phygital_centers'`

### Leaderboard Enable (trigger at ≥50 students with mastery data)
```sql
UPDATE feature_flags SET is_enabled=true, updated_at=now()
WHERE flag_name IN ('leaderboard_global', 'wave1_leaderboard');
```

---

## 10. Incident Response

### Severity Levels
| P0 | Complete outage — all students affected | Page immediately, 15-min updates |
| P1 | Partial outage — auth/payment/foxy down | 30-min response |
| P2 | Degraded performance — slow but functional | 2-hour response |
| P3 | Non-critical feature broken | Next business day |

### P0 Rollback Procedure

> Alfanumrik deploys across TWO INDEPENDENT planes with SEPARATE rollback mechanisms:
> - **Web plane (Vercel)** — the Next.js app. Reverted by `vercel rollback`.
> - **Edge-function plane (Supabase)** — deployed independently. `vercel rollback` does NOT
>   touch it. Triage first, then roll back the correct plane.

**Triage note:** If the incident traces to an AI/edge path (`foxy-tutor`, `ncert-solver`,
`quiz-generator`, `cme-engine`, `daily-cron`, or any webhook-adjacent function),
`vercel rollback` will NOT fix it — roll back the edge-function plane (step 3).

```bash
# 1. Identify failing deployment
vercel list --scope alfanumrik

# 2. WEB PLANE — roll back to previous Vercel deployment (promote previous build)
vercel rollback --scope alfanumrik
#    Why this is safe: the forward migration chain is additive-only (verified: no executable
#    DROP COLUMN/TABLE/TRUNCATE in supabase/migrations/*.sql, excluding _legacy/). The DB does
#    NOT roll back with the web build, so the previous build stays schema-compatible after a
#    migration lands. A migration needing a destructive change requires CEO approval per
#    CLAUDE.md precisely because it would break this rollback path.

# 3. EDGE-FUNCTION PLANE — only if the incident traces to an edge/AI path.
#    Supabase Edge Functions have NO built-in version pinning, so roll back by redeploying
#    the previous known-good version from git:
git checkout <last-good-sha> -- supabase/functions/<name>
supabase functions deploy <name>
git checkout HEAD -- supabase/functions/<name>   # restore working tree

# 4. If a DB migration caused the issue — migrations are forward-only on Supabase.
#    Do NOT hand-write a destructive rollback. Disable the affected feature via flag:
#    UPDATE feature_flags SET is_enabled=false WHERE flag_name='<affected_flag>';

# 5. VERIFY before declaring resolved — health endpoint must be green:
curl -s https://<prod-host>/api/v1/health
#    Expect: {"ok":true,"status":"healthy"} with every checks/dependencies entry
#    (database, auth, edge_functions, redis, razorpay) reporting ok. Do NOT close the
#    incident until this passes.

# 6. Notify students via WhatsApp (whatsapp-notify edge function)
# 7. Post incident summary within 24h
```

---

## 11. Key Credentials & Config

| Item | Location |
|---|---|
| Supabase project | `shktyoxqhundlvkiwguu` (ap-south-1) |
| Cron secret | `get_cron_secret()` DB function (service_role only) |
| Razorpay | Supabase Edge Function secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` |
| Voyage AI | Supabase Edge Function secret: `VOYAGE_API_KEY` |
| Anthropic | Supabase Edge Function secret: `ANTHROPIC_API_KEY` |
| Vercel | Dashboard: vercel.com/alfanumrik |

---

## 12. Daily Health Check Query
```sql
SELECT * FROM record_platform_health_snapshot();

SELECT snapshot_at, dau, quiz_sessions_24h, avg_score_24h,
       foxy_chats_24h, new_signups_24h, active_subscriptions,
       irt_updates_24h, leaderboard_students
FROM platform_health_snapshots
ORDER BY snapshot_at DESC LIMIT 7;
```

---

## 13. Runbook: Vercel Build OOM (webpackBuildWorker)

**Incident signature** (first seen 2026-07-16, e.g. `dpl_D3QM6VDKj1u1f7GTwaBEzoF1n6QZ`):
- Preview deploys fail mid-compile with **SIGKILL** — the 8 GB build container OOMs while
  webpack compiles the entire app (280+ routes, mermaid, recharts, katex) in a single process.
- Build log prints **`⨯ webpackBuildWorker`** in the experiments line. That `⨯` is the tell:
  Next.js auto-disables the build worker when a custom webpack function is present
  (`withSentryConfig` injects one on Vercel/CI) unless explicitly opted in.

**Fix** (two parts — BOTH required):
1. Code (shipped 2026-07-17): `apps/host/next.config.js` sets
   `experimental.webpackBuildWorker: true` by default, so compilation runs in a separate
   worker process. Verified locally: identical bundle output, Sentry-wrapped build 28% faster.
2. **REQUIRED operator dashboard step** — the fix is INERT on Vercel until this is done:
   Vercel Dashboard → project → Settings → Environment Variables →
   **DELETE `NEXT_DISABLE_WEBPACK_BUILD_WORKER` (value `1`)**.
   It was a 2026-07-10 local-Windows-only workaround
   (engineering-audit/PRODUCT_READINESS_EXECUTION_2026-07-09.md, item 36) that leaked into
   the Vercel project env; while set, it forces the worker off and the OOM persists.
   **Keep `NEXT_WEBPACK_MEMORY_OPTIMIZATIONS=1`** — do not delete that one.

**Escalation 2026-07-17 — production deploys OOMing too; kill switch renamed to `_V2`:**
Production deploys began failing with the same OOM signature (3× consecutive), freezing
production on an old build, because step 2 above had not been executed — the leaked
`NEXT_DISABLE_WEBPACK_BUILD_WORKER=1` was still overriding the #1313 code fix.
Since dashboard access could not be obtained in time, the code-side kill switch was
**renamed to `NEXT_DISABLE_WEBPACK_BUILD_WORKER_V2`** (branch `fix/oom-killswitch-rename`),
which neutralizes the leaked legacy var without dashboard access: the config now
deliberately ignores the legacy name. Pinned by
`apps/host/src/__tests__/product-readiness-release-gate.test.ts` (the config must read the
`_V2` name and must NOT read the legacy expression).
- **Operator cleanup (when dashboard access is available):** delete BOTH the legacy
  `NEXT_DISABLE_WEBPACK_BUILD_WORKER` var AND (if it was ever set) the
  `NEXT_DISABLE_WEBPACK_BUILD_WORKER_V2` var from the Vercel project env.
  Still keep `NEXT_WEBPACK_MEMORY_OPTIMIZATIONS=1`.

**Verify** (unchanged by the rename): trigger a fresh deploy; the build log must now print
**`✓ webpackBuildWorker`** (checkmark, not `⨯`) and the build must complete without SIGKILL.

**Kill switch / rollback** (env-only, no code revert): set
`NEXT_DISABLE_WEBPACK_BUILD_WORKER_V2=1` in the Vercel project env and redeploy. This
restores the pre-fix single-process behavior instantly. (The legacy un-suffixed name no
longer does anything as of 2026-07-17.)

**Escalation if the worker alone is insufficient:**
1. Enable **Enhanced Builds** (16 GB build machine): project Settings → Build & Deployment.
2. Or set Preview-scoped `NODE_OPTIONS=--max-old-space-size=6144` (matches the local
   release-gate build path; scope to Preview only).

**Not this incident:** the `Sentry instrumentation.ts` build warning is a separate known
issue and is not fixed by any step above.

**Lesson:** local-shell workaround env vars must NEVER be set in the Vercel project env
without an expiry note (owner + removal condition in the var's comment/notes field). A
local-only workaround silently changed production build behavior for 6 days.
