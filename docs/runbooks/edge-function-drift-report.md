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

---

## Orphan analysis (2026-05-05)

Per-orphan reference scan was run across `src/`, `supabase/functions/`, `mobile/lib/`, and `docs/` looking for: `functions.invoke('<name>')` (single + double quotes), raw `/functions/v1/<name>` URLs, `<name>.supabase.co`, and pg_cron / `vercel.json` schedules. The current orphan count is **40** (production grew to 74 active functions; local source is 34). Counts: **A=37, B=1, C=2, total=40**. (`cognitive-engine` is initially ambiguous by name with `src/lib/cognitive-engine.ts` but disambiguates clean — counted in A. The two C entries are kept ambiguous out of caution because the bare names appear inside route paths or doc topology diagrams that a human should eyeball before deletion.)

### Category A — SAFE TO DELETE (37)

Zero Edge Function invocation references found across `src/`, `supabase/functions/`, `mobile/lib/`, `docs/` (any string match was either to the drift report itself, an unrelated TS module, an unrelated Next.js route, an `_archive/` README, or stale topology docs that name the function but never invoke it).

```
adaptive-engine
adaptive-orchestrator
chat-history
classify-rag-exercises
cognitive-engine          (name clash with src/lib/cognitive-engine.ts — TS lib, not an Edge Function call; no functions.invoke('cognitive-engine'), no /functions/v1/cognitive-engine)
devops-agent
diagnostic-engine
enhanced-quiz-generator
ingest-orchestrator
learning-analytics
learning-loop
lesson-engine
mass-gen
misconception-engine
ml-adaptation             (only in docs/runbooks/SRE_RUNBOOK.md:20 topology diagram — no invocation)
ncert-ingest-v2
ncert-ingest-v3
ncert-ingestion           (name clash with scripts/ncert-ingestion/ — local CLI tooling, not the Edge Function)
offline-sync
payments                  (only in stale comment src/app/api/payments/webhook/route.ts:13 — "legacy Edge Function payments handleWebhook path is disabled"; no invocation)
pdf-diagnose
pdf-ingestion
pdf-processor
pilot-analytics
pool-generator
quiz-generator-v2         (active source is in supabase/functions/_archive/quiz-generator-v2/ — README says archived; no functions.invoke('quiz-generator-v2'); CLAUDE.md confirms "never live")
quiz-submit               (only in docs/runbooks/SRE_RUNBOOK.md:18 topology diagram — no invocation)
rag-engine
rag-retrieval             (name clash with supabase/functions/_shared/rag-retrieval.ts — SHARED MODULE imported via "../_shared/rag-retrieval.ts", not Edge Function call; no functions.invoke('rag-retrieval'))
response-handler
session-manager
student-experience
student-notes             (name clash with src/app/api/super-admin/students/[id]/notes route + student-notes-api.test.ts — Next.js route + tests, not Edge Function call)
study-plan                (name clash with /study-plan page, /api/v1/study-plan, /api/student/study-plan — Next.js routes, not Edge Function call)
tarl-engine
tts-voice
voice-tutor
welcome-email             (active function in source is send-welcome-email — bare welcome-email has zero refs; no functions.invoke('welcome-email'))
```

### Category B — REFERENCED BUT NO SOURCE (1)

These are deployed in production AND invoked by code in the repo, but the source is not in `supabase/functions/`. **This is a serious bug — production is running code that is not in version control.**

- **`quiz-engine`** — invoked from `src/lib/domains/quiz.ts:105` via `supabase.functions.invoke('quiz-engine', { body: { student_id, subject, grade, count, difficulty, chapter_number, ability_estimate } })`. This is the **first source in the quiz-question fetch chain** (Source 1 of 4 fallbacks per `src/lib/domains/quiz.ts:90-94`). Comment at line 91 says "quiz-engine Edge Function (adaptive, IRT, RAG) → best". When the Edge Function fails (errors silently swallowed and next source tried), the chain falls through to `select_quiz_questions_rag` RPC, then `select_quiz_questions_v2` RPC, then a direct `question_bank` query. So the consumer is degraded but not broken — quiz-question fetch works via the RPC fallbacks. Recommended: either restore the source to version control via `supabase functions download` so we can audit + maintain it, or rewrite `fetchQuizQuestions` Source 1 to skip the Edge Function and start from the RPC.

### Category C — AMBIGUOUS (2)

The bare function name appears in the repo in a way that is technically not an Edge Function invocation but is close enough that a human eyeball pass should confirm before deletion.

- **`super-admin`** — referenced from `src/app/admin` (line 9): `fetch(\`${SB_URL}/functions/v1/super-admin\`, { method: 'POST', body: JSON.stringify({ action, ...params }) })`. **However**, `src/app/admin` is a flat file (not a directory with `page.tsx`), so it is NOT a routable Next.js page — it is dead code. The Edge Function it would call is also dead. Both should likely be removed together as a paired cleanup. The reason this is C and not A is that an orphaned `.tsx`-style file at the App Router root is unusual and a human should confirm it isn't being referenced from somewhere else (e.g. pulled in as a string, imported by name) before deletion.
- **`super-admin` name clash** — also matches `src/app/super-admin/` (43 pages, the live admin panel) and `src/app/api/super-admin/` (75 routes). None of those invoke an Edge Function named `super-admin` — they are all Next.js routes that talk to RPCs and the database directly. The Edge Function is genuinely orphaned, but the name clash means a careful human re-check is warranted.

---

## Recommended deletion commands

**WARNING: deletion is irreversible without redeploy. After each delete, immediately run `supabase functions list --project-ref shktyoxqhundlvkiwguu | grep <name>` to confirm the function is gone (no row returned).**

```powershell
# Category A — 37 SAFE TO DELETE (run one-by-one; verify after each)
supabase functions delete adaptive-engine --project-ref shktyoxqhundlvkiwguu
supabase functions delete adaptive-orchestrator --project-ref shktyoxqhundlvkiwguu
supabase functions delete chat-history --project-ref shktyoxqhundlvkiwguu
supabase functions delete classify-rag-exercises --project-ref shktyoxqhundlvkiwguu
supabase functions delete cognitive-engine --project-ref shktyoxqhundlvkiwguu
supabase functions delete devops-agent --project-ref shktyoxqhundlvkiwguu
supabase functions delete diagnostic-engine --project-ref shktyoxqhundlvkiwguu
supabase functions delete enhanced-quiz-generator --project-ref shktyoxqhundlvkiwguu
supabase functions delete ingest-orchestrator --project-ref shktyoxqhundlvkiwguu
supabase functions delete learning-analytics --project-ref shktyoxqhundlvkiwguu
supabase functions delete learning-loop --project-ref shktyoxqhundlvkiwguu
supabase functions delete lesson-engine --project-ref shktyoxqhundlvkiwguu
supabase functions delete mass-gen --project-ref shktyoxqhundlvkiwguu
supabase functions delete misconception-engine --project-ref shktyoxqhundlvkiwguu
supabase functions delete ml-adaptation --project-ref shktyoxqhundlvkiwguu
supabase functions delete ncert-ingest-v2 --project-ref shktyoxqhundlvkiwguu
supabase functions delete ncert-ingest-v3 --project-ref shktyoxqhundlvkiwguu
supabase functions delete ncert-ingestion --project-ref shktyoxqhundlvkiwguu
supabase functions delete offline-sync --project-ref shktyoxqhundlvkiwguu
supabase functions delete payments --project-ref shktyoxqhundlvkiwguu
supabase functions delete pdf-diagnose --project-ref shktyoxqhundlvkiwguu
supabase functions delete pdf-ingestion --project-ref shktyoxqhundlvkiwguu
supabase functions delete pdf-processor --project-ref shktyoxqhundlvkiwguu
supabase functions delete pilot-analytics --project-ref shktyoxqhundlvkiwguu
supabase functions delete pool-generator --project-ref shktyoxqhundlvkiwguu
supabase functions delete quiz-generator-v2 --project-ref shktyoxqhundlvkiwguu
supabase functions delete quiz-submit --project-ref shktyoxqhundlvkiwguu
supabase functions delete rag-engine --project-ref shktyoxqhundlvkiwguu
supabase functions delete rag-retrieval --project-ref shktyoxqhundlvkiwguu
supabase functions delete response-handler --project-ref shktyoxqhundlvkiwguu
supabase functions delete session-manager --project-ref shktyoxqhundlvkiwguu
supabase functions delete student-experience --project-ref shktyoxqhundlvkiwguu
supabase functions delete student-notes --project-ref shktyoxqhundlvkiwguu
supabase functions delete study-plan --project-ref shktyoxqhundlvkiwguu
supabase functions delete tarl-engine --project-ref shktyoxqhundlvkiwguu
supabase functions delete tts-voice --project-ref shktyoxqhundlvkiwguu
supabase functions delete voice-tutor --project-ref shktyoxqhundlvkiwguu
supabase functions delete welcome-email --project-ref shktyoxqhundlvkiwguu
```

**Special note on `payments`**: deletion is safe ONLY because the canonical Razorpay webhook is now `src/app/api/payments/webhook/route.ts` (Next.js API route on Vercel) and Razorpay's webhook URL is configured to point there, NOT to the Supabase Edge Function. Confirm in Razorpay dashboard before deleting. If Razorpay still has the webhook URL pointing at `…/functions/v1/payments`, deleting will break payment ingestion immediately.

---

## Recommended source restore for Category B

If the team decides to keep `quiz-engine` as an Edge Function rather than rewrite the consumer to skip it, restore the source via:

```powershell
supabase functions download quiz-engine --project-ref shktyoxqhundlvkiwguu
# Output goes to supabase/functions/quiz-engine/. Inspect, commit, then ensure
# CI deploys it on next push (so source ↔ deployment stay aligned going forward).
```

Alternatively, rewrite `src/lib/domains/quiz.ts` `fetchQuizQuestions()` to drop Source 1 (Edge Function) entirely and start from Source 2 (`select_quiz_questions_rag` RPC). The chain already silently falls through, so removal is non-breaking — but it does eliminate the "best" adaptive+IRT path until something replaces it.

---

## Execution log — 2026-07-13 (ADR-006 consolidation)

`quiz-generator-v2` and `enhanced-quiz-generator` (both Category A) were
**tombstoned in production**: each now serves a structured
`410 { code: 'GONE' }` pointing callers at the canonical `quiz-generator`.
Verification before tombstoning: fresh repo grep (zero invocations, matching
the Category A scan above) + zero invocations in Supabase edge logs. The
tombstone is reversible (redeploy) and fails loudly per Hard Rule 10; run the
`supabase functions delete` commands above for permanent removal after a clean
observation window. The remaining Category A orphans are untouched — deleting
them stays a separate ops task per this runbook.
