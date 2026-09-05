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

## Execution log — 2026-07-13 (full Category A sweep, tech-debt remediation Phase 1)

All 35 remaining Category A orphans were **tombstoned** (structured 410 with a
pointer to the canonical replacement where one exists): adaptive-engine,
adaptive-orchestrator, chat-history, classify-rag-exercises, cognitive-engine,
devops-agent, diagnostic-engine, ingest-orchestrator, learning-analytics,
learning-loop, lesson-engine, mass-gen, misconception-engine, ml-adaptation,
ncert-ingest-v2, ncert-ingest-v3, ncert-ingestion, offline-sync, pdf-diagnose,
pdf-ingestion, pdf-processor, pilot-analytics, pool-generator, quiz-submit,
rag-engine, rag-retrieval, response-handler, session-manager,
student-experience, student-notes, study-plan, tarl-engine, tts-voice,
voice-tutor, welcome-email.

Pre-sweep verification: the Category A reference scan was re-run fresh
(grep across apps/, packages/, src/, mobile/, supabase/functions/, vercel.json
for `functions/v1/<name>` + `invoke('<name>')`) — zero hits for all 35.

**Deliberately NOT touched:**
- `payments` — remains live until the Razorpay dashboard webhook URL is
  confirmed to point at the Vercel route (this runbook's warning stands).
- `super-admin` (Category C) — human eyeball still required per above.
- `quiz-engine` (Category B) — RESOLVED by verification: the function no
  longer exists in production at all, and `packages/lib/src/domains/quiz.ts`
  already invokes `quiz-generator`; only a stale comment remained (fixed).
- `foxy-tutor` — NOT an orphan: still invoked by the live Flutter app
  (mobile/lib/data/repositories/chat_repository.dart) despite the
  constitution's "retired 2026-07-01" claim. Repoint mobile before touching.

Permanent deletion (`supabase functions delete`) remains available per the
command list above after a clean observation window (suggest 30 days —
tombstone hits show up as 410s in edge logs if anything unknown calls one).

## Execution log — 2026-08-04 (foxy-tutor tombstone, P2-4a)

`foxy-tutor` — deliberately excluded from the 2026-07-13 sweep above pending
mobile repoint — was **tombstoned** with the same structured-410 pattern:
`supabase/functions/foxy-tutor/index.ts` now serves
`410 { code: 'GONE', canonical: '/api/foxy' }` for every method (no auth
check, so old APKs that can't send valid auth still get the 410) and logs a
PII-free `method` + truncated user-agent line per hit for the observation
window.

Precondition verified before tombstoning: the 2026-07-13 blocker
("`foxy-tutor` — NOT an orphan: still invoked by the live Flutter app") is
superseded — `mobile/lib/core/constants/api_constants.dart:99-106` defaults
`FOXY_ENDPOINT` to `'api'`, so the Flutter app already POSTs to `/api/foxy`
by default; the `_sendViaEdge` branch in
`mobile/lib/data/repositories/chat_repository.dart` is documented dead code
retained only so any already-installed APK still pinned to `'edge'` fails
predictably rather than silently. Web has invoked `/api/foxy`
(`apps/host/src/app/api/foxy/route.ts`) exclusively since the 2026-07-01
retirement. Net: zero live web/server invocations of `foxy-tutor` remain —
only old installed APKs pinned to `'edge'` can still reach it, and they now
get a structured 410 instead of a silent 200/failure.

Reversible via redeploy (source history: `git log -- supabase/functions/foxy-tutor/`
predates its removal from the working tree). Permanent
`supabase functions delete foxy-tutor` is deferred to the same 30-day clean
observation window as the rest of the sweep — watch edge logs for
`[foxy-tutor:tombstone]` hits before scheduling it.

## Execution log — 2026-08-05 (cme-engine retirement, Foxy North-Star Phase 2 wave 2b)

`cme-engine` was **tombstoned ON DISK** (structured
`410 { error: 'gone', code: 'cme_engine_retired', replacement: '/api + learner-model facade' }`),
following the quiz-generator-v2 precedent above.

Pre-tombstone verification: fresh repo grep for `functions/v1/cme-engine` +
`invoke('cme-engine')` across apps/, packages/, mobile/, supabase/functions/,
vercel.json — the only two invokers were `processAdaptiveLearning()` and
`getCmeNextAction()` in `packages/lib/src/supabase.ts`, both verified dead
(the quiz page stopped calling processAdaptiveLearning when CME mastery moved
server-side; getCmeNextAction had zero callers) and DELETED in the same PR.
The write target `cme_concept_state` is COMMENT-tombstoned RETIRED (migration
`20260808000100`); canonical state is `concept_mastery` via the
`update_learner_state_post_quiz` RPC + `@alfanumrik/lib/learner-model` facade.

**PENDING live steps (ops actions, post-merge — the tombstone is only on disk
until these run):**
1. `supabase functions deploy cme-engine` — ship the tombstone.
2. `supabase functions list` — verify the deployed version bumped (never
   assert deployed state from the filesystem — this runbook's core lesson).
3. 30-day invocation-log watch: any 410 hit means an unknown caller; triage
   before deletion.
4. `supabase functions delete cme-engine --project-ref shktyoxqhundlvkiwguu`
   only after a clean window.

## Execution log — 2026-08-31 (39-function deletion + 11-function tombstone sweep, schema-review H3)

The 39 functions that completed their 30-day observation window with zero
tombstone hits were **permanently deleted** from production
(`shktyoxqhundlvkiwguu`) via `supabase functions delete <slug>` — each
confirmed with a `{"message":"Deleted Edge Function."}` response. Live
`list_edge_functions` re-check afterward confirmed none of the 39 slugs
remain deployed.

Separately, 11 previously-undiscovered orphans were found: **all 11** show
an `entrypoint_path` of `file:///tmp/user_fn_<project>_<id>/source/index.ts`
(a Supabase CLI/dashboard hand-deploy path) rather than the CI runner path
(`file:///home/runner/work/Alfanumrik/Alfanumrik/supabase/functions/...`),
meaning they were never deployed by CI and have no source history in this
repo at all — a different drift mode than the git-tracked-then-orphaned
functions above. Repo-wide grep (`*.ts`, `*.tsx`, `*.dart`, `*.sql`) found
zero call sites for any of the 11. One, `agent-worker`, shares a name with
the unrelated SQL function `public.agent_worker_tick()` driving active
pg_cron job 26 — verified via `pg_get_functiondef` that this SQL function
makes no `net.http_*` call to any Edge Function, so the naming collision is
coincidental and does not make `agent-worker` live.

Tombstoned (same structured-410 pattern, stub committed to
`supabase/functions/<slug>/index.ts`, not yet permanently deleted — lacking
the 39's 30-day window):
`agent-orchestrator`, `agent-worker`, `auth-write-skeleton`,
`embed-ncert-books`, `embed-rag-remaining`, `rag-query-v3`, `rag-answer-v3`,
`rag-answer-v4`, `rag-answer-v5`, `rag-ingest-batch`, `rag-ingest-status`.
Permanent deletion of these 11 is deferred to a clean 30-day window from
2026-08-31, same as every prior tombstone in this log.

`grade-written-answer`'s live source was pulled into git for the first time
(`supabase functions download grade-written-answer`) rather than tombstoned
— it is real, functioning code (a Claude-Haiku-based written-answer grader)
that was simply never committed, not dead code; it remains live and
undisturbed, just now version-controlled.

`export-report` (already archived to `supabase/functions/_archive/` in PR
#1363, superseded by `parent-report-generator`) was permanently deleted from
production directly, without an additional tombstone step — the archive
commit already served as its observation record.

Full writeup: `docs/audit/launch-readiness/29-edge-function-cleanup-and-m5-status.md`.

## Execution log — 2026-09-05 (P1-7 closeout: 13 tombstones permanently deleted)

CEO direction: "delete P1-7's orphaned Edge Functions now". Live state was
re-verified first rather than taken from the 2026-09-02 audit's list:

- `list_edge_functions` returned 57 ACTIVE functions, every one with source
  on disk. The audit's "deployed, no source" orphans (`account-purge`,
  `data-erasure-purger`, `edge-health-audit`) and `session-guard` (P2-9) were
  ALREADY absent from production — nothing left to undeploy in that category.
  `edge_health_probe_requests` (edge-health-audit's write target) last row
  2026-06-19, 0 rows in the prior 7 days — consistent with it being long gone.
- 13 structured-410 tombstone stubs remained on disk; 12 were still deployed
  (`foxy-tutor` was already absent). A 24h `function_edge_logs` query showed
  each live tombstone received exactly ONE hit, all inside a 30-second
  alphabetical sweep at 00:12–00:13 UTC — the nightly auth-sweep self-probe,
  not a caller. Zero `cron.job` entries and zero repo-wide call sites reference
  any of them (the only textual match is mobile's documented-dead legacy
  `foxy-tutor` path, which already resolves to a gateway 404).
- `cme-engine`'s live source was fetched and is byte-identical to the on-disk
  tombstone (the 401 it returns to unauthenticated probes is by design — see
  its header); its 30-day window from 2026-08-05 completed 2026-09-04.
- The 11 tombstones from the 2026-08-31 sweep were deleted ~4 days short of
  their nominal 30-day window, at explicit CEO direction, on the strength of
  the evidence above.

Deleted — disk, `scripts/edge-function-manifest.json`, `AUTH_GUARD_LEDGER`,
and production via `deploy-production.yml`'s existing "Detect removed Edge
Functions" → "Prune removed functions" step on merge (best-effort: an
already-absent slug logs a warning, never fails the release):
`agent-orchestrator`, `agent-worker`, `auth-write-skeleton`, `cme-engine`,
`embed-ncert-books`, `embed-rag-remaining`, `foxy-tutor` (residue only —
already undeployed), `rag-answer-v3`, `rag-answer-v4`, `rag-answer-v5`,
`rag-ingest-batch`, `rag-ingest-status`, `rag-query-v3`.
`cme-engine` was also removed from `deploy_functions.sh`'s `ALL_FUNCTIONS`.

**Post-merge outcome (same day) — the prune did NOT run.** The Deploy
Production run for the #1779 merge (`e09d0c7e`) failed at "Deploy each
changed function": `deploy-production.yml`'s "Detect changed Edge Functions"
step used `git diff --name-only HEAD~1 HEAD` with no `--diff-filter`, so the
13 DELETED directories were treated as changed, `supabase functions deploy
agent-orchestrator` died on the missing entrypoint, and the job ended before
its own "Prune removed functions" step (a later step in the same job) could
run. `list_edge_functions` afterwards still showed all 12 live tombstones.
A latent bug: the prune step was added as a separate path, but the changed
detection was never taught to exclude deletions.

Fix (follow-up PR): `--diff-filter=d` on the changed-detection diff in both
`deploy-production.yml` and `deploy-staging.yml` (same pattern), so deletions
reach only the `--diff-filter=D` prune step. Because the #1779 deletions are
now in history and no future push's `HEAD~1..HEAD` diff will contain them, a
break-glass `workflow_dispatch` reaper was added
(`.github/workflows/edge-function-reaper.yml`): allowlisted to exactly the 12
still-deployed slugs, main-only, confirmation phrase, refuses any slug whose
`supabase/functions/<slug>/` directory still exists at the checkout, and
fails the run if any requested slug is still deployed afterwards. It runs
under the same `environment: production` scoping as the automatic prune
step — no new privilege, no new secrets. The actual reap and its
`list_edge_functions` verification are recorded in that PR.
