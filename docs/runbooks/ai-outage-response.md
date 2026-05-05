# AI Outage Response Runbook

**Severity:** SEV-2 (Major) — degrades to SEV-1 if Foxy is the primary product surface for the affected cohort.
**Time to respond:** 15 minutes (SEV-1) / 1 hour (SEV-2).
**On-call:** [ON-CALL: TBD] (no rotation defined yet — escalate to ai-engineer + ops in #ai-incidents).
**Scope:** Anthropic Claude API down, rate-limited, or returning 5xx; Voyage embedding API down; circuit breaker open across multiple AI surfaces.
**Related runbooks:** `docs/runbooks/grounding/claude-outage.md` (Foxy-specific), `docs/runbooks/grounding/voyage-outage.md` (RAG-specific). This document is the cross-surface umbrella.

## 1. Detection

### Signals (any one is sufficient)
- Sentry alert: spike in `error.type:ClaudeAPIError` or `error.type:VoyageAPIError` events.
- Super-admin AI-health card (`/super-admin` control room → AI Health tile): success rate < 90%, circuit breaker shows `open`.
- Customer reports in support inbox referencing "Foxy not responding", "tutor stuck", "quiz not generating".
- Synthetic probe failure on `/api/foxy` endpoint (if configured).

### Sentry query (paste into Sentry search)
```
event.type:error AND (
  exception.type:ClaudeAPIError OR
  exception.type:VoyageAPIError OR
  message:"circuit breaker open" OR
  message:"abstain_reason*llm_error"
) AND timestamp:>-15m
```

### SQL detection (super-admin SQL editor)
```sql
SELECT caller,
       count(*) FILTER (WHERE abstain_reason = 'llm_error') AS errors,
       count(*) AS total,
       100.0 * count(*) FILTER (WHERE abstain_reason = 'llm_error') / NULLIF(count(*), 0) AS error_pct
  FROM grounded_ai_traces
 WHERE created_at > now() - interval '10 minutes'
 GROUP BY caller
 ORDER BY error_pct DESC;
```
Threshold: any `caller` with `error_pct > 20%` confirms outage.

## 2. Triage

Identify which AI surfaces are affected. Each surface has its own kill-switch flag (see `supabase/migrations/20260418100800_feature_flags.sql`).

| Surface | Flag (kill switch) | User impact if disabled |
|---|---|---|
| Foxy AI tutor (chat) | `ff_grounded_ai_foxy` | Foxy chat returns "temporarily unavailable" banner |
| Quiz generator (AI-generated MCQs) | `ff_grounded_ai_quiz_generator` | Falls back to question_bank-only quizzes |
| NCERT solver | `ff_grounded_ai_ncert_solver` | Solver page disabled; static help text shown |
| Concept engine (CME) | `ff_grounded_ai_concept_engine` | Concept Map fallback to last cached version |
| Global (all surfaces) | `ff_grounded_ai_enabled` | All grounded AI off; legacy paths if available |

Run this to see current state:
```sql
SELECT flag_name, is_enabled, rollout_percentage, updated_at
  FROM feature_flags
 WHERE flag_name LIKE 'ff_grounded_ai%'
 ORDER BY flag_name;
```

## 3. Mitigation

### Step 3a — Flip the global kill switch (worst-case Anthropic-wide outage)

Via super-admin UI: `/super-admin/flags` → toggle `ff_grounded_ai_enabled` to **off** → Save.

Via direct SQL (if super-admin UI is also down):
```sql
UPDATE feature_flags
   SET is_enabled = false,
       updated_at = now()
 WHERE flag_name = 'ff_grounded_ai_enabled';

-- Force cache invalidation (5min TTL otherwise)
SELECT pg_notify('feature_flags_invalidate', 'all');
```

Verify within 5 minutes (cache TTL):
```bash
curl https://alfanumrik.vercel.app/api/foxy -X POST -H "Content-Type: application/json" \
  -d '{"message":"test","studentId":"<test-student-uuid>"}' | jq '.disabled'
# Expect: true
```

### Step 3b — Selective degradation (only one provider down)

If only Claude is down (Voyage healthy → embeddings still work):
```sql
UPDATE feature_flags SET is_enabled = false WHERE flag_name IN (
  'ff_grounded_ai_foxy',
  'ff_grounded_ai_quiz_generator',
  'ff_grounded_ai_ncert_solver',
  'ff_grounded_ai_concept_engine'
);
```

If only Voyage is down (Claude healthy → can serve cached/non-RAG responses):
- Leave `ff_grounded_ai_*` enabled. The retrieval layer falls back to BM25-only mode automatically per `src/lib/retrieval/voyage-rerank.ts`.
- Monitor `grounding.voyage_fallback_active` ops events.

### Step 3c — In-app customer comms banner

Set the maintenance banner via super-admin (`/super-admin/flags` → `maintenance_banner` flag with comms text in `target_environments` JSON):
```sql
UPDATE feature_flags
   SET is_enabled = true,
       target_environments = '{"message_en":"AI tutor temporarily offline; quizzes still work normally.","message_hi":"AI ट्यूटर अस्थायी रूप से बंद है; क्विज़ सामान्य रूप से काम कर रहे हैं।"}'::jsonb::text[]
 WHERE flag_name = 'maintenance_banner';
```

**Customer comms — English:**
> AI tutor (Foxy) is temporarily offline due to a service issue. All quizzes, progress tracking, and saved notes still work. We will update you as soon as Foxy is back.

**Customer comms — Hindi (हिंदी):**
> AI ट्यूटर (Foxy) किसी सेवा समस्या के कारण अस्थायी रूप से बंद है। सभी क्विज़, प्रगति ट्रैकिंग और सहेजे गए नोट्स सामान्य रूप से काम कर रहे हैं। Foxy के वापस आते ही हम आपको सूचित करेंगे।

## 4. Recovery

### Step 4a — Verify upstream is back
- Anthropic status: https://status.anthropic.com/
- Voyage status: check provider dashboard
- Synthetic probe:
```bash
curl -X POST https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-haiku-20241022","max_tokens":10,"messages":[{"role":"user","content":"ping"}]}'
# Expect: 200 with {"content":[...]}
```

### Step 4b — Staged re-enablement (do NOT flip back to 100% immediately)

**1% canary** (15 minutes):
```sql
UPDATE feature_flags
   SET is_enabled = true, rollout_percentage = 1
 WHERE flag_name = 'ff_grounded_ai_enabled';
```
Watch SQL detection query (Section 1) for `error_pct < 5%` over 15 minutes.

**10% rollout** (30 minutes):
```sql
UPDATE feature_flags SET rollout_percentage = 10 WHERE flag_name = 'ff_grounded_ai_enabled';
```

**100% rollout:**
```sql
UPDATE feature_flags SET rollout_percentage = NULL WHERE flag_name = 'ff_grounded_ai_enabled';
```

Re-enable per-surface flags only after the global flag has been at 100% for 30 minutes with `error_pct < 2%`.

### Step 4c — Remove customer banner
```sql
UPDATE feature_flags SET is_enabled = false WHERE flag_name = 'maintenance_banner';
```

## 5. Post-mortem checklist

Within 48 hours, file a post-mortem in `docs/postmortems/YYYY-MM-DD-ai-outage.md` answering:

1. **What was the upstream root cause?** (Anthropic incident ID, Voyage status link, our own bug)
2. **How long did detection take?** (event start → first responder ack). Target: < 5 min.
3. **Did the kill switch work as designed?** Did the flag cache invalidate within 5 min?
4. **Did students see broken UI or graceful degradation?** Pull a session replay sample from Sentry.
5. **What follow-up reduces blast radius next time?** (Sonnet-as-default, second AI provider, response cache extension, etc.)

Cross-link the post-mortem to: `.claude/regression-catalog.md` (add a REG entry if a new failure mode was discovered).
