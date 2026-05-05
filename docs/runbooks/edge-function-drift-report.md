# Production Edge Function Drift Report

**Generated:** 2026-05-05 during launch-readiness production -> staging sync.

## Summary

| Source | Count |
|---|---|
| Local source (`supabase/functions/`) — canonical | **35** |
| Production deployed (`shktyoxqhundlvkiwguu`) | **71** |
| Staging deployed (`gzpxqklxwzishrkiaatd`) | **0** (now syncing to 35) |
| Production-only orphans (no local source) | **36** |

## What this means

Production has 36 Edge Functions that exist on the deployed Supabase project but have NO source code in the current `supabase/functions/` directory. These are typically:

- Legacy functions superseded by newer ones (still live because nobody manually disabled them)
- Functions deployed from older branches that were never merged or were reverted
- Experimental functions deployed for one-off testing and never cleaned up

## Production-only orphans (36)

These are deployed on PROD but have no local source. They are NOT being deployed to staging (staging tracks local source).

```
adaptive-engine
adaptive-orchestrator
chat-history
classify-rag-exercises
cognitive-engine
devops-agent
diagnostic-engine
enhanced-quiz-generator
ingest-orchestrator
learning-analytics
learning-loop
lesson-engine
mass-gen
misconception-engine
ml-adaptation
ncert-ingest-v2
ncert-ingest-v3
ncert-ingestion
offline-sync
payments
pdf-diagnose
pdf-ingestion
pdf-processor
pilot-analytics
pool-generator
quiz-engine
quiz-generator-v2
quiz-submit
rag-engine
rag-retrieval
response-handler
session-manager
student-experience
student-notes
study-plan
super-admin
tarl-engine
tts-voice
voice-tutor
welcome-email
```

## Recommended next steps (separate cleanup task)

For each function above, the ops team should:

1. **Check if anything in production code calls it** — grep `src/` and `supabase/functions/` for `functions.invoke('<name>')` and `_supabase_url/functions/v1/<name>` patterns
2. **Check Supabase function-invocation logs for the last 30 days** — if zero invocations, safe to remove
3. **If deployed but unreferenced**: delete via `supabase functions delete <name> --project-ref shktyoxqhundlvkiwguu`
4. **If deployed AND referenced but no local source**: that means production is running code that's not in version control — either restore the source or rewrite the consumer to call something that IS in source

## Smoke-test SQL to detect future drift

Run this on each Supabase project to count active functions; compare to `ls supabase/functions/ | wc -l` locally:

```bash
# Counts should match between production / staging / local source.
# If they drift, run sync-staging-functions.yml workflow.
supabase functions list --project-ref shktyoxqhundlvkiwguu | grep -c ACTIVE
supabase functions list --project-ref gzpxqklxwzishrkiaatd | grep -c ACTIVE
ls -d supabase/functions/*/ | grep -vE '(_archive|_shared)' | wc -l
```

## Why staging matches local source (not production)

Staging is for testing what's about to ship. The 36 prod-only orphans are NOT about to ship (they're not in source). Deploying them to staging would mislead developers into thinking those functions are part of the supported product surface. Staging matching local source = staging matches the next production deploy.
