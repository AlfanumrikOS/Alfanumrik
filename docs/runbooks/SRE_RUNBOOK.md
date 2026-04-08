# Alfanumrik SRE Runbook — Wave 1 Production

**Last updated:** 2026-04-08  
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
```bash
# 1. Identify failing deployment
vercel list --scope alfanumrik

# 2. Rollback to previous Vercel deployment
vercel rollback --scope alfanumrik

# 3. If DB migration caused issue — migrations are forward-only on Supabase
#    Use feature flag to disable affected feature:
#    UPDATE feature_flags SET is_enabled=false WHERE flag_name='<affected_flag>';

# 4. Notify students via WhatsApp (whatsapp-notify edge function)
# 5. Post incident summary within 24h
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
