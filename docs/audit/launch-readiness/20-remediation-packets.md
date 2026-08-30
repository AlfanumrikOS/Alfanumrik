# 20 — P0/P1 Remediation Packets

**Status:** PLANNING ONLY — no execution authorized. Awaiting separate CEO approval per finding/phase.
**Authorization scope:** CEO conditional approval, 2026-08-30. Formal DPDPA compliance work (age gate, consent engine, DPAs, consent dashboards) is explicitly OUT of scope and excluded from all packets below. Essential technical security (auth, authz, tenant isolation, RLS/grants, answer-key protection, secrets, role boundaries, private-record access, privileged access, backup/recovery) is IN scope.
**Evidence basis:** Six parallel read-only research passes against the live repo (`C:\Users\User\Alfanumrik\Alfanumrik`, HEAD `b04e725d17dd68f2ac2cc232668d7f85fb57b1dd`) conducted 2026-08-30, superseding prose-only claims in the original audit where the two conflict. Where a research pass found a finding already resolved or requiring a materially different fix than originally stated, that correction is called out explicitly in the packet.

**IMPORTANT CAVEAT (all packets):** This checkout is confirmed to be `main` at the stated commit. Per `alfanumrik-verified-infra` memory, this is **not confirmed to be what's deployed to production** (Supabase project `shktyoxqhundlvkiwguu`, Vercel). Every packet's "current evidence" is "true of this checkout." Before executing any packet, the owner must independently confirm the deployed SHA/migration state matches, per the evidence protocol (command + raw output, no assumptions).

---

## Packet Index

| # | ID | Title | Severity | Status found | Blocking? |
|---|----|----|----|----|----|
| 1 | P0-01 | verify-question-bank signing/cron integrity | P0 | **CLOSED 2026-08-30** — confirmed working live; minor telemetry gap remains (P3) | No longer blocking |
| 2 | P1-01 | question_bank answer key RLS/grant exposure | P1 | **RPC leak already closed**; RLS/grant leak open, blocked on mobile | Yes — blocked on mobile forced-upgrade |
| 3 | P1-02 | RAG retrieval regression | P1 | Root cause reframed; faithfulness leg not a real regression | Yes |
| 4 | P1-03 | CI Gate not required status check | P1 | **CLOSED 2026-08-30** — already fixed live, `ci.yml` comment just stale | No longer blocking |
| 5 | P1-04 | Single-person alerting | P1 | Confirmed; delivery code for 2nd channel already exists | Yes |
| 6 | P1-05 | webhook-dispatcher query-param secret | P1 | Confirmed; incidental bearer-priority bug found | No |
| 7 | P1-06 | streak-guardian duplicate notifications | P1 | Confirmed; fix pattern already proven elsewhere | No |
| 8 | P1-07 | match_rag_chunks_ncert EXECUTE grant | P1 | Confirmed, but conflicts with a deliberate prior design decision | No — needs decision |
| 9 | P1-08 | Error message leaks | P1 | Confirmed; scope is ~750 sites, not 3 | No — needs scope decision |
| 10 | VULN-D1/D2/D3 | No rate limiting: OAuth, payments, auth bootstrap | P1 | Confirmed; shared fix pattern identified | Yes |
| 11 | P-01 | Admin routes leak unfiltered child PII | P1 | Confirmed 5 routes (not 6); reference pattern exists | Yes |
| 12 | P2-04→P1 | RBAC check-not-enforced in 3 routes | P2→P1 (reclassified) | Newly surfaced as a real authz-bypass instance | Yes — folds into P-01 phase |

---

## Packet 1 — P0-01: verify-question-bank / grounded-answer signing integrity

**Finding ID / Severity:** P0-01 / P0 (Launch-blocking, data-integrity) — **UPDATE 2026-08-30: functionally CLOSED in production, confirmed via live verification. One minor residual observability gap remains (not launch-blocking).**

**Evidence & Confidence:** CONFIRMED FIXED AND WORKING, via live production queries against `shktyoxqhundlvkiwguu` on 2026-08-30:
- `verify-question-bank-hourly` pg_cron job is **active**, `cron.job` confirms `schedule: '20 * * * *'` (hourly), `active: true`. The job's own command comment documents a manual test invocation on 2026-08-25 (the day the signing fix and this scheduling migration both landed) that "touched 531 rows" successfully server-side, and explicitly warns that pg_net's client-side timeout (120s) makes a completed run look like a failure in `cron.job_run_details` — "do not treat a timeout here as a failed run."
- `question_bank.verified_at` shows two distinct clusters: a one-time bulk backfill 2026-05-09/10 (~4,600 rows, `verifier_model IS NULL`, unrelated to this cron, predates it by 3+ months) and **real, ramping activity from 2026-08-26 onward** (10 → 17 → 1,103 → 152/day-so-far as of 2026-08-30) — starting exactly one day after the signing-fix merge (`52f5388f`, 2026-08-25). This is strong evidence the cron is genuinely running and verifying rows in production right now.
- **Residual gap:** `ops_events` shows **zero rows ever** for `category='grounding.verifier', source='verify-question-bank'` — the batch-completion telemetry write this packet originally specified as the acceptance signal is not firing, even though the underlying verification work is completing successfully. This is a real but minor, non-launch-blocking bug (observability only) — worth a small follow-up fix, not a re-open of P0-01.
- **Ruled out during investigation:** a `qb_fixer`/`fix-failed-questions` job (Next.js cron route, `packages/lib/src/qb-fixer/*`, built May 2026) initially looked like it might be a second, undocumented parallel verification system producing the `verified_at` activity instead of `verify-question-bank`. Confirmed via code read: it's a legitimate, separate, already-documented pipeline (spec: `docs/superpowers/specs/2026-05-10-qb-qa-fix-failed-questions-design.md`) that *repairs* already-failed rows — complementary to, not in conflict with, `verify-question-bank`.

**Original evidence (superseded by the above, kept for context):** Original audit's premise ("grounded-client.ts sends signing headers the entry point rejects") was inverted — the entry point (`resolveSecurityPrincipal`) always required `x-internal-timestamp`/`x-internal-signature`; the Deno caller (`grounded-client.ts`) simply never sent them. Commit `52f5388f` (2026-08-25) added `buildInternalCallerHeaders()` to `supabase/functions/_shared/grounded-client.ts` (lines 39–70), signing every internal call and failing closed (`config-missing`) if `INTERNAL_CALLER_SIGNING_SECRET` is unset.

**Root Cause:** `resolveSecurityPrincipal()` (`supabase/functions/_shared/security/auth.ts:100-102`, called from `grounded-answer/index.ts:145`) rejects any service-role-bearer call lacking both signature headers with `401 deny_signature`. The Deno `grounded-client.ts` caller used by `verify-question-bank` didn't send them prior to `52f5388f`.

**Affected components:**
- `supabase/functions/_shared/grounded-client.ts` (fix location, lines 39-70)
- `supabase/functions/_shared/security/auth.ts` (validator, lines 100-102)
- `supabase/functions/grounded-answer/index.ts` (entry point, line 145)
- `supabase/functions/verify-question-bank/index.ts` (caller `verifyOneRow`, line 129; writes `ops_events` at lines 318-335 success / 342-351 exception)
- `supabase/migrations/20260825150000_schedule_verify_question_bank_cron.sql` (cron schedule, `:20 past the hour`)
- `security_internal_callers` table — `'quiz-generator'` caller name registered active via `20260618000001_platform_security_layer.sql:1177-1205`
- Env var: `INTERNAL_CALLER_SIGNING_SECRET` (Edge Function secret)

**Production Impact:** NONE remaining — confirmed working. The residual telemetry gap means `ops_events(category='grounding.verifier')` cannot be used as a monitoring signal today, but the underlying integrity check (verifying question_bank answers) is confirmed running and producing real state transitions.

**Dependencies:** None.

**Proposed Correction:** Original 3-step verification plan is now DONE (steps 1-2 confirmed live, superseding the need to separately check deploy status). Remaining work, downgraded from P0 to a small P3 follow-up:
1. ~~Confirm `52f5388f` is deployed to production~~ — CONFIRMED (cron active, real verified_at activity since day-after-merge).
2. ~~Confirm `INTERNAL_CALLER_SIGNING_SECRET` is set~~ — CONFIRMED (function is working, would fail closed otherwise).
3. **Still open, downgraded:** fix the `ops_events(category='grounding.verifier')` completion-write so it actually fires (currently zero rows ever, despite real work completing) — needed to restore this as a usable monitoring signal. Also still recommend the missing end-to-end test (`resolveSecurityPrincipal` + `buildInternalCallerHeaders()`).

**Exact Implementation Sequence:** N/A (no migration). Verification sequence: (a) live read-only query `select verification_state, count(*) from public.question_bank where content_status='published' and is_active and deleted_at is null group by verification_state` — expect non-zero `verified` rows growing hourly; (b) query `ops_events where category='grounding.verifier' and source='verify-question-bank'` for post-fix timestamps; (c) if either check fails, escalate — do not assume the merge alone means the fix is live.

**Acceptance Tests:** New Deno integration test (to be written) + the two live read-only queries above, run 24-48h apart to confirm the hourly cron is producing real verified rows.

**Cross-tenant negative tests:** N/A — not a tenant-boundary finding.

**Rollout Plan:** None required if already deployed; if not, standard Edge Function deploy via existing CI pipeline.

**Rollback / Roll-forward:** N/A (verification-only). If the secret is missing in production, roll-forward is setting the secret (config change, not code).

**Lock / Downtime / Data-mutation risk:** None — read-only verification.

**Observability requirements:** Alert if `ops_events(category='grounding.verifier')` produces zero rows over any 4-hour window once the hourly cron should be running.

**Responsible Owner:** Backend (verification) + DevOps (confirm deployed secret).

**Unresolved Decisions:** None — this packet is ready to execute (verification only) pending the separate go-ahead. Recommend running the verification steps immediately since they carry zero risk, even before "execution" is formally authorized, as they are read-only.

---

## Packet 2 — P1-01: question_bank answer key exposure (RLS/grant layer)

**Finding ID / Severity:** P1-01 / P1

**Evidence & Confidence:** CONFIRMED for the RLS/grant layer; **the RPC-leak sub-claim in the original audit is stale and already fixed.**

- **Still open (confirmed):** `CREATE POLICY "question_bank_authenticated_read" ON "public"."question_bank" FOR SELECT TO "authenticated" USING (true)` (`supabase/migrations/20260728090000_lockdown_anon_readable_public_tables.sql:308-312`) combined with a table-level `ALTER DEFAULT PRIVILEGES` grant to `authenticated` in the baseline — no migration anywhere revokes table-level SELECT or adds column-level grants on `question_bank`. Any authenticated user can `GET /rest/v1/question_bank?select=id,correct_answer_index` directly.
- **Already closed (2026-08-14, migration `20260814000023`):** All previously-leaking quiz-serving RPCs (`select_quiz_questions_rag`, `select_quiz_questions_v2`, `get_quiz_questions` both overloads) were made keyless with a server-side `question_bank_p6_valid()` gradeability check replacing the client-side one. `check_formative_answer` replaced browser-side Quick Check grading. Verified by a currently-passing regression test: `apps/host/src/__tests__/security/question-bank-answer-key-exposure.test.ts` (476 lines) — Lane B blocker inventory is asserted EMPTY.

**Root Cause:** RLS is row-level only; `question_bank` was never given column-level ACLs, so the table-level default grant (SELECT to `authenticated`) exposes every column including the 9-column answer-key set to any signed-in session via direct REST, independent of what the RPCs return.

**Affected components:**
- Policy: `question_bank_authenticated_read` (`20260728090000`, lines 308-312)
- Table: `public.question_bank` (~12,826+ rows), 9-column answer-key set per the exposure test (`question-bank-answer-key-exposure.test.ts:99-109`): `correct_answer_index, correct_answer_text, expected_answer, expected_answer_hi, answer_text, answer_text_hi, answer_rubric, answer_methodology, solution_steps`. **Note:** `explanation`/`explanation_hi` and `hint_level_1/2/3` are deliberately NOT in this set per the test's own comment (explanation is legitimately read pre-answer by feedback flows) — see Unresolved Decisions.
- Proven-safe precedent: `supabase/migrations/20260814000020_quiz_session_shuffles_answer_key_column_acl.sql` — same REVOKE-then-column-GRANT pattern already applied to the related `quiz_session_shuffles` table.
- **Blocker:** `mobile/lib/data/repositories/quiz_repository.dart:104` calls PostgREST `.select()` with no column argument (needs `SELECT *`); `mobile/lib/core/constants/api_constants.dart:61` — `useV2` is a compile-time constant defaulting `false`; `mobile/build_apk.sh:93` bakes `USE_V2=false` into every build unless explicitly overridden. **Every already-installed APK on a student's device is compiled against the leaking path.** A column ACL breaks the installed base immediately.
- Blast radius of the already-fixed RPCs (for context, no further action needed): `apps/host/src/app/(student)/quiz/page.tsx`, `apps/host/src/app/api/quiz/route.ts`, `apps/host/src/app/api/v2/quiz/questions/route.ts`, `apps/host/src/app/api/whatsapp/_lib/daily6.ts`, `apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx`.

**Production Impact:** Any authenticated user (student) can retrieve the answer key for all 12,826+ questions via a direct REST call, bypassing the quiz UI entirely — core academic-integrity violation, unchanged by the RPC fix since that only stops the *app's own* code from leaking the key, not a hand-crafted API call.

**Dependencies:** **Hard-blocked** on shipping and achieving meaningful adoption of a mobile app version with `USE_V2=true` (or equivalent column-scoped queries) before the column ACL can go live — otherwise it is a live outage for every installed Android client, not a security fix.

**Proposed Correction:** Two-phase:
1. **Phase A (mobile):** Fix `quiz_repository.dart` to select an explicit column list (or flip `useV2` default), ship as a mandatory app update, and force-upgrade-gate the API (reject old client versions) once adoption is confirmed high enough via app-version telemetry.
2. **Phase B (database, only after Phase A's adoption gate clears):** Apply the same REVOKE-then-column-GRANT pattern used for `quiz_session_shuffles` (`20260814000020`) to `question_bank`, using the 9-column key set above.

**Exact Implementation Sequence:**
1. Ship mobile fix (app release, outside this repo's migration sequence).
2. Instrument and monitor app-version adoption (needs a metric — check if one exists; if not, add one).
3. Once adoption threshold is met (owner decision — e.g., 95% of active sessions on the fixed client), draft migration modeled directly on `20260814000020_quiz_session_shuffles_answer_key_column_acl.sql`: `REVOKE ALL ON TABLE public.question_bank FROM authenticated;` then `GRANT SELECT (<all columns except the 9-column key set>) ON public.question_bank TO authenticated;` with `has_column_privilege` self-verifying `DO $$` post-condition blocks, matching the precedent migration's structure exactly.
4. Invert `question-bank-answer-key-exposure.test.ts` Lane A from documenting-the-gap to asserting `authenticated` is refused (42501) on the 9 key columns — the file's own comments (lines 259-262) already say this inversion is expected once the ACL ships.

**Acceptance Tests:** `question-bank-answer-key-exposure.test.ts` (Lane A inverted per above; Lane B/C already pass and must keep passing). `quiz-session-shuffles-answer-key-acl.test.ts` as the structural template for the new Lane A assertion.

**Cross-tenant negative tests:** N/A — this is a role-level (authenticated vs. anon), not tenant-level, exposure. No cross-school leakage risk beyond what already exists.

**Rollout Plan:** Mobile release train (outside this repo) → adoption monitoring → DB migration only after adoption gate.

**Rollback / Roll-forward:** If the column ACL is applied before mobile adoption is sufficient, the immediate roll-forward-safe fix is to re-run the inverse grant (`GRANT SELECT ON TABLE ... TO authenticated` unconditionally) — this is non-destructive and instantly reversible, no data loss. Recommend the migration be written with an explicit, tested down-migration from day one given the outage risk if sequencing is wrong.

**Lock / Downtime / Data-mutation risk:** The column-ACL migration itself is a fast metadata-only change (REVOKE/GRANT), no table lock beyond a brief `ACCESS EXCLUSIVE` on the grant statement — safe. The *product* risk is entirely in sequencing against mobile adoption, not database locking.

**Observability requirements:** App-version adoption dashboard (may need to be built) before Phase B can be scheduled; post-Phase-B, monitor 42501 error rates from old clients to detect breakage.

**Responsible Owner:** Mobile team (Phase A) + DBA (Phase B) + Product (adoption-gate sign-off).

**Unresolved Decisions:**
1. **Whether `explanation`/`explanation_hi` and `hint_level_1/2/3` should be added to the protected-column set.** The codebase's own working definition (9 columns, used by the `quiz_session_shuffles` precedent and this exposure test) excludes both — this is a scope call the CEO or product owner should make explicitly, not something engineering should silently decide.
2. **What adoption threshold gates Phase B**, and whether a hard version-reject at the API layer is acceptable given it will lock out users on old app versions who haven't updated.

---

## Packet 3 — P1-02: RAG retrieval quality regression

**Finding ID / Severity:** P1-02 / P1

**Evidence & Confidence:** CONFIRMED for recall@10/nDCG@10/MRR degradation; **the "faithfulness regression" framing is not well-supported and should be corrected in the launch-gate scorecard.**

- Baseline (2026-06-14, `eval/rag/baseline/ncert-baseline-v1.json`): nDCG@10=0.6617, recall@10=0.8222, MRR=0.7286, hit-rate@10=0.9667, **groundedness-rate=0.3667**.
- Cited "current" numbers (recall 0.661, nDCG 0.512, MRR 0.575, faithfulness ~40-47%) come from an **uncommitted 2026-08-23 run** — `eval/rag/reports/` is gitignored and no report was ever committed. These numbers are **not independently reproducible from the repo**; they exist only as prose in `17-findings-register.md`.
- **Faithfulness/groundedness was never close to 95% even at baseline** (36.7%). The harness's own code (`eval/rag/harness/cli.ts:188-192`) discloses that its "candidate answer" for the groundedness judge is **not a real generated answer** — it's the top retrieved chunk's first 400 characters, explicitly commented as "a thin proxy... skews groundedness HIGH and must not be over-read." Citing ~40-47% "faithfulness" against a 95% bar as commensurate with the recall/nDCG regression **overstates the case** — it is a chronic, structurally-mismeasured gap (the harness doesn't test what "faithfulness" is meant to mean), not a fresh regression.
- **Two eval harnesses exist and are easily confused:** `eval/rag/harness/` (computes recall/nDCG/MRR/faithfulness-proxy, behind the P1-02 numbers) vs. `scripts/rag-eval.mjs` + `eval/rag/runner.ts` (a different, older harness computing binary pass/fail scope-correctness against the live `grounded-answer` function, gated in CI at `.github/workflows/rag-eval.yml` but currently advisory-only).

**Root Cause — UPDATE 2026-08-30, live-verified:** Hypothesis #2 below is **RULED OUT** by direct query against production. Corpus-growth timeline is now precisely dated. Two live candidates remain: #1 and #3.
1. **Corpus-growth dilution (still live).** Live query confirms corpus grew via two batches, both after the 2026-06-14 baseline: **10,722 chunks on 2026-06-22** and **2,564 chunks on 2026-07-04**, on top of ~14,492 pre-existing (8,880 + 5,039 + 573 from earlier batches) = 27,778 total — closely matching the "~16k→27k" estimate. No compensating change to fetch-pool size (`RERANK_DEFAULT_FETCH=40`, `v_fetch_count = GREATEST(match_count*4, 60)`), and `quality_score` filtering inert (see below) so nothing triages the larger pool.
2. **Embedding-coverage gap — RULED OUT.** Live query: `SELECT count(*) FILTER (WHERE embedding IS NULL), count(*) FROM rag_content_chunks` → **0 NULL embeddings out of 27,778 total.** Every chunk, old and new, has an embedding. This hypothesis does not explain the regression.
3. **Cosine floor (0.22), new since baseline — now the strongest remaining candidate.** PR #1394 (`2ad5ad37`, 2026-07-27) introduced the first-ever absolute cosine-similarity floor on the vector arm — notably **after both corpus-growth batches completed** (2026-06-22, 2026-07-04) and shortly before the regression was measured (2026-08-23). `retrieve.ts`'s own code comments admit "real student queries are median 8 words — shorter than the 36-token anchors used [to measure the 0.22 floor], so the true recall penalty of a high floor is worse than measured." Chunks that survived via the FTS/no-floor path pre-July-27 could now be filtered from the vector arm. **Recommend this be the first thing tuned/tested**, given corpus dilution (#1) was already present before the cosine floor shipped, but the floor is the most recent change closest in time to the actual regression measurement.

**Affected components:**
- Eval harness: `eval/rag/harness/{cli,run-eval,metrics,verdict}.ts`, golden set `eval/rag/golden/ncert-golden-v1.json`, baseline `eval/rag/baseline/ncert-baseline-v1.json`
- Ingestion: `scripts/ncert-ingestion/storage-ingest.ts` (chunker, lines 312-341, zero overlap confirmed), `scripts/ncert-ingestion/embed-chunks.ts` (separate embedding step)
- Retrieval: `supabase/functions/_shared/rag/retrieve.ts`, RPC `match_rag_chunks_ncert` (`supabase/migrations/20260727130000_rag_ncert_expose_cosine_similarity.sql:99-277`)
- `quality_score` column on `rag_content_chunks` — confirmed no-op (68% NULL, rest exactly 0.7 per legacy one-time backfill, gate at 0.4 which both values pass)
- Grounding/faithfulness: `supabase/functions/grounded-answer/grounding-check.ts` (5s timeout, `claude-haiku-4-5-20251001`, fails closed on ANY uncertainty — timeout/missing-key/non-200/parse-failure/unrecognized-verdict all collapse to `verdict: 'fail'`, amplifying any latency-driven dip)
- Unfinished replacement pipeline (not live, do not assume it fixes anything yet): `scripts/pdf-ingestion/extractor/` (Python) — has real chunk-overlap and a real multi-tier quality_score, but its own README says "Phase 2 writes NOTHING to the database."
- **Doc-hygiene issue found:** `docs/audit/launch-readiness/09-foxy-rag-ai.md` disagrees with `17-findings-register.md` on P2-21 (states quality_score is "always 1.0" — wrong, code confirms 68% NULL/rest 0.7) and on P2-25 (states hardcoded 0.6/0.4 RRF weights — wrong, code confirms pure `1/(60+rank)` RRF with `v_k=60`, no weighting). `17-findings-register.md` is accurate; `09-foxy-rag-ai.md` needs correcting.

**Production Impact:** Foxy's grounded-answer quality is measurably degraded for retrieval ranking (recall/nDCG/MRR), which risks surfacing less-relevant NCERT content to students. The faithfulness/groundedness figure, while genuinely low, should not be presented as evidence of a *regression* — it needs its own, correctly-designed measurement before any bar can be meaningfully gated on it.

**Dependencies:** Live DB access needed to verify embedding coverage on the growth batch (hypothesis #2) before deciding which fix to prioritize.

**Proposed Correction:**
1. ~~Query embedding coverage~~ — **DONE 2026-08-30, ruled out hypothesis #2** (0 NULL out of 27,778). Next step is testing hypothesis #3 (cosine floor recalibration) — e.g., re-run the eval harness at a lower floor (say 0.18-0.20) and compare against baseline bands.
2. Re-run the eval harness with `VOYAGE_API_KEY` set (live cost, small — ~$0.0001/call × 30 golden items) and **commit the report** this time, so future comparisons are reproducible instead of prose-only.
3. Normalize top-k across the three inconsistent configurations found (`retrieve.ts` prod default `limit=8`; `run-eval.ts` harness `limit=20`; `eval/rag/runner.ts` `match_count=5`) before drawing further conclusions from comparisons across them.
4. Separately and explicitly redesign the faithfulness/groundedness measurement (real generated answer, not top-chunk-text proxy) before re-gating on a 95% bar — this is a measurement-design task, not a retrieval-tuning task, and should not block the recall/nDCG remediation.

**Exact Implementation Sequence:** Step 1 (read-only query) → decision point based on result → either (a) trigger `npm run ncert:embed` backfill if coverage gap confirmed [data-mutation: adds embeddings, does not modify existing rows, low risk] or (b) proceed to retrieval-parameter tuning (fetch-pool size, cosine-floor recalibration) if coverage is already complete.

**Acceptance Tests:** Re-run `eval:rag:harness` post-fix; require nDCG@10/recall@10/MRR to return to within the baseline's regression bands (`verdict.ts`: nDCG 2% rel, recall 2% rel, MRR 3% rel, hit-rate 2pp abs) — do NOT gate this phase on faithfulness/groundedness until that metric is redesigned (see Unresolved Decisions).

**Cross-tenant negative tests:** N/A — RAG corpus is shared curriculum content, not tenant-scoped.

**Rollout Plan:** Embedding backfill (if needed) can run against production directly — it only fills NULL embedding columns, does not touch existing data. Retrieval-parameter changes (if pursued) should go through a staged eval-harness-gated release, not direct production tuning.

**Rollback / Roll-forward:** Embedding backfill has no meaningful rollback need (additive only). Any retrieval-parameter change should be behind a feature flag or easily-revertible config value, not hardcoded.

**Lock / Downtime / Data-mutation risk:** Embedding backfill is additive UPDATE on NULL columns only — low risk, no lock contention expected at this scale, but should be batched/rate-limited given it calls the live Voyage API per chunk.

**Observability requirements:** Committed eval reports going forward (currently gitignored/never committed — recommend un-gitignoring `eval/rag/reports/` or otherwise persisting run history), embedding-coverage dashboard/alert for future ingestion batches.

**Responsible Owner:** AI/ML.

**Unresolved Decisions:**
1. **Whether to redesign the faithfulness/groundedness metric before or after the retrieval-quality fix** — recommend after, since it's a separate measurement problem, not blocking recall/nDCG remediation, but the CEO's stated acceptance gates (§ Packet Index intro, "Faithfulness ≥ 95%") cannot be honestly evaluated until this redesign happens. Flag explicitly: **the current faithfulness number should not be used to gate GO/NO-GO decisions as-is** — it's measuring the wrong thing.
2. Whether `09-foxy-rag-ai.md` should be corrected in this pass or a follow-up doc-hygiene task.

---

## Packet 4 — P1-03: CI Gate not a required status check

**Finding ID / Severity:** P1-03 / P1 — **UPDATE 2026-08-30: ALREADY CLOSED, confirmed live via `gh api`.**

**Evidence & Confidence:** Live query against `repos/AlfanumrikOS/Alfanumrik/rulesets/20528052` ("main-protection") confirms `required_status_checks` already includes **`CI Gate` alongside `Secret Scanning`, `Lint, Type-check & Test`, `Production Build`, `CodeQL Analysis`** — 5 required checks, not 4. The ruleset's `updated_at` timestamp is `2026-08-24T00:35:28+05:30`, meaning this was fixed 6 days before this investigation. **No settings change is needed.**

The only remaining issue is documentation staleness: `.github/workflows/ci.yml`'s own comments (lines 39-44, 3089-3093) still assert CI Gate is NOT a required check and instruct the reader to add it — this is now factually wrong and should be corrected as a small doc-hygiene follow-up (not urgent, not launch-blocking). Original evidence (superseded, kept for context): `ci-gate` job (lines 3094-3236) is a fan-in over 12 upstream jobs (`secret-scan`, `selected-school-rpc-integration`, `protected-flag-migration-guard`, `foxy-alignment`, `gen-mol-matrix`, `quality`, `unit-tests` ×4 shards + `unit-tests-changed` + `unit-tests-merge`, `edge-function-tests`, `integration-tests`, `build`, `e2e-critical-paths`).

**Root Cause:** GitHub branch-protection ruleset configuration was never updated when `ci-gate` was introduced as an aggregate job; `ci-gate` running "visible but not blocking" was called out by the workflow's own authors as a known gap.

**Affected components:** GitHub repo settings (main-protection ruleset) — not a code or database change.

**Production Impact:** PRs can merge to `main` despite failures in integration tests, edge-function tests, e2e-critical-paths, secret-scan, or foxy-alignment. Plausible structural enabler of at least one known stale-base merge incident referenced in the workflow's own history.

**Dependencies:** None — GitHub repo-settings change, independent of all other packets.

**Proposed Correction:** Add "CI Gate" as a required status check in the `main-protection` ruleset, alongside the 4 already-required checks.

**Exact Implementation Sequence:** Repo Settings → Rules → Rulesets → `main-protection` → add `CI Gate` to Required status checks. No migration, no code change, no deploy.

**Acceptance Tests:** Open a throwaway PR with a deliberately failing integration test; confirm merge is blocked. Revert the deliberate failure.

**Cross-tenant negative tests:** N/A.

**Rollout Plan:** Immediate, single settings change — no phased rollout needed. Recommend doing this first among all P1 items since it's zero-risk and closes a real structural gap immediately.

**Rollback / Roll-forward:** Instantly reversible (remove from required-checks list) if it unexpectedly blocks legitimate merges (e.g., a known-flaky job in the fan-in).

**Lock / Downtime / Data-mutation risk:** None.

**Observability requirements:** None beyond normal CI dashboards.

**Responsible Owner:** Ops / repo admin (CEO or delegate with GitHub admin access).

**Unresolved Decisions:** None. Ready to execute — this is the lowest-risk item in the entire packet set and could reasonably be greenlit independently of the broader remediation approval, if the CEO wants an immediate quick win.

---

## Packet 5 — P1-04: Single-person email-only alerting

**Finding ID / Severity:** P1-04 / P1

**Evidence & Confidence:** CONFIRMED as committed/seeded state, **with an important nuance: the delivery mechanism for a second channel already exists in code and admin UI — this may not require new engineering.**

- `supabase/migrations/20260713160000_wire_ops_alerting_to_email.sql` seeds exactly one channel: `('CEO email', 'email', {"to": "ceo@alfanumrik.com"})`. Every subsequent `alert_rules` seed migration attaches only this channel's ID — no migration ever inserts a second channel row.
- **Already built, currently unused:** `apps/host/src/app/api/super-admin/observability/channels/route.ts` (+`[id]/route.ts`, `[id]/test/route.ts`) supports `VALID_TYPES = ['slack_webhook', 'email']` with a full admin UI (`apps/host/src/app/super-admin/observability/channels/page.tsx`) and a working test-send endpoint. `supabase/functions/alert-deliverer/index.ts:97-108` already implements Slack webhook delivery (`buildSlackPayload`, POST to `webhook_url`). `20260716093000_verification_delivery_monitor.sql:83-103` already attaches "every enabled slack_webhook channel plus CEO email" to its alert rule — it just currently resolves to CEO-email-only because no slack_webhook row has ever been seeded.
- Separately, `.github/workflows/pipeline-alert.yml` / `synthetic-monitor.yml` have their own independent best-effort Slack path via GitHub secrets (`PIPELINE_ALERT_SLACK_WEBHOOK`, `SYNTHETIC_MONITOR_SLACK_WEBHOOK`), gated on the secret being non-empty — live population state is unverifiable from the repo.

**Root Cause:** Operational gap (no channel row ever seeded / no Slack webhook URL ever configured), not a code gap.

**Affected components:** `notification_channels` table, `alert_rules.channel_ids`, `alert-deliverer` Edge Function (already correct), admin UI (already correct).

**Production Impact:** If CEO email is unreachable, all critical alerts (payment webhook failures, adaptive-loop ceiling violations, RAG verification failures) go unnoticed with zero redundancy.

**Dependencies:** Requires a Slack workspace + incoming webhook URL to be provisioned (an operational/business decision, not engineering) before this can be wired.

**Proposed Correction:** Once a Slack webhook URL is available: (a) add a `slack_webhook` row via the existing admin UI (`channels/page.tsx`) — no code change needed; (b) attach it to the existing `alert_rules` via the same UI or a small seed migration; (c) use the existing test-send endpoint to confirm delivery before relying on it.

**Exact Implementation Sequence:** 1. Provision Slack incoming webhook (ops/business action, outside engineering scope). 2. Via admin UI: create channel row, type=`slack_webhook`, `webhook_url` set. 3. Attach to all existing critical `alert_rules` (payment, verification, adaptive-loop). 4. Fire test-send. 5. Optionally also populate `PIPELINE_ALERT_SLACK_WEBHOOK`/`SYNTHETIC_MONITOR_SLACK_WEBHOOK` GitHub secrets for CI-side alerting parity.

**Acceptance Tests:** Trigger a known alert condition in a non-production-affecting way (or use the test-send endpoint) and confirm both CEO email AND Slack receive it.

**Cross-tenant negative tests:** N/A.

**Rollout Plan:** No phased rollout needed — additive channel, does not remove or modify the existing email channel.

**Rollback / Roll-forward:** Trivially reversible — deactivate the channel row via the admin UI.

**Lock / Downtime / Data-mutation risk:** None — a single INSERT into an existing, already-supported table via existing admin UI.

**Observability requirements:** None beyond confirming the test-send succeeds.

**Responsible Owner:** Ops (webhook provisioning) — no engineering owner needed if the UI path is used.

**Unresolved Decisions:** Whether to also fix the CI-side Slack secrets (`pipeline-alert.yml`/`synthetic-monitor.yml`) in the same pass, or treat as a separate lower-priority follow-up — recommend bundling since it's the same underlying gap (single-channel alerting) and the webhook URL, once provisioned, can be reused for both.

---

## Packet 6 — P1-05: webhook-dispatcher accepts secret via query parameter

**Finding ID / Severity:** P1-05 / P1

**Evidence & Confidence:** CONFIRMED, exact code verified. `supabase/functions/webhook-dispatcher/index.ts`, `isAuthorized()` (lines 85-96):
```ts
const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
const headerSecret = req.headers.get('x-cron-secret') ?? '';
const url = new URL(req.url);
const token = url.searchParams.get('token') ?? '';   // line 92
const provided = bearer || headerSecret || token;
return constantTimeEqual(provided, secret);
```

**Root Cause:** Legacy auth pattern never migrated when the rest of the platform's cron routes were hardened.

**Affected components:** `supabase/functions/webhook-dispatcher/index.ts` (lines 85-96). **Only production caller:** `supabase/functions/daily-cron/index.ts`'s `triggerWebhookDispatcher()` (lines 1373-1394), which sends `x-cron-secret` header, never `?token=` — removing the query-param path is safe against this caller. No other caller found in the repo.

**Incidental bug discovered (flag, out of primary scope but relevant):** `daily-cron`'s call sends BOTH `x-cron-secret` and `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`. Since `isAuthorized` evaluates `bearer || headerSecret || token`, the non-empty bearer wins, meaning the code path actually compares the service-role JWT against `CRON_SECRET` — not the intended `x-cron-secret` header. This looks like a pre-existing, independent bug that should be verified (does this call currently succeed at all in production, and via which branch?) before or alongside this fix.

**Broader context:** `webhook-dispatcher` is the only Edge Function still using `searchParams.get('token')` — a prior hardening pass (REG-339, `packages/lib/src/cron-auth.ts`) already removed this pattern from every Next.js `/api/cron/*` route via a shared `verifyCronAuth()` module, but never touched the Deno Edge Functions (`webhook-dispatcher`, `account-purge`, `alert-deliverer`, `send-pre-debit-notice`, `send-renewal-reminder`, `coverage-audit`), which each hand-roll their own auth.

**Production Impact:** Query-parameter secrets are logged in server access logs, Vercel/CDN edge logs — a leakage vector for `CRON_SECRET`.

**Dependencies:** Should investigate and resolve the incidental bearer-priority bug in the same change, since fixing one without understanding the other risks either breaking `daily-cron`'s trigger or leaving a latent auth confusion in place.

**Proposed Correction:** Remove the `?token=` fallback (delete line 92 and the `token` term from the `provided` computation). Simultaneously fix the priority order so `x-cron-secret` is checked deterministically rather than being silently shadowed by an incidentally-present bearer token — or explicitly document why bearer-priority is intended, if it is.

**Exact Implementation Sequence:** Single-file code change in `webhook-dispatcher/index.ts`. Deploy via existing Edge Function CI pipeline. No migration.

**Acceptance Tests:** Call `webhook-dispatcher` with only `?token=<secret>` and no headers — must now return 401. Call with `x-cron-secret` header — must succeed. Verify `daily-cron`'s actual production trigger path continues to work post-fix (this is where the incidental bug needs resolving first).

**Cross-tenant negative tests:** N/A — internal service-to-service auth, not tenant-scoped.

**Rollout Plan:** Standard Edge Function deploy.

**Rollback / Roll-forward:** Trivial — revert the one-file change.

**Lock / Downtime / Data-mutation risk:** None.

**Observability requirements:** Monitor `daily-cron`'s webhook-dispatcher trigger success rate before/after to confirm no regression from the bearer-priority fix.

**Responsible Owner:** Backend.

**Unresolved Decisions:** Whether to extend the same pass to migrate the other 5 Deno functions with hand-rolled auth (`account-purge`, `alert-deliverer`, `send-pre-debit-notice`, `send-renewal-reminder`, `coverage-audit`) onto the shared pattern, or scope this packet narrowly to `webhook-dispatcher` only. Recommend narrow scope for the launch-blocking pass; flag the other 5 as a P2 follow-up.

---

## Packet 7 — P1-06: streak-guardian creates duplicate notifications

**Finding ID / Severity:** P1-06 / P1

**Evidence & Confidence:** CONFIRMED. `apps/host/src/app/api/cron/streak-guardian/route.ts` (lines 85-99) builds `notifications` rows with no `idempotency_key` and calls `.insert()` (not `.upsert()`).

**Root Cause:** `notifications` table has an `idempotency_key` column and a partial unique index `notifications_idempotency_idx ON (recipient_id, type, idempotency_key) WHERE idempotency_key IS NOT NULL` (added by `20260505100100_notifications_idempotency_key.sql`) — but streak-guardian never sets the column, so it stays NULL and the partial index doesn't apply, allowing unlimited duplicate rows on re-run/retry.

**Affected components:** `apps/host/src/app/api/cron/streak-guardian/route.ts` (lines 85-99), table `public.notifications`.

**Established fix pattern (already proven elsewhere, not novel design):** `supabase/functions/daily-cron/index.ts` sets `idempotency_key: '<type>_<YYYY_MM_DD>_<student_id>[...]'` and writes via `.upsert(rows, { onConflict: 'recipient_id,type,idempotency_key', ignoreDuplicates: true })` for multiple notification types already (lines 274-275, 345-346, 746-782, 812, 1872, 1881).

**Production Impact:** Vercel retries or manual re-triggers create duplicate "streak at risk" notifications per affected student, inflating notification volume and potentially confusing/alarming students/parents.

**Dependencies:** None.

**Proposed Correction:** Add `idempotency_key: 'streak_at_risk_' + <YYYY_MM_DD> + '_' + row.student_id` to each notification object; change `.insert(notifications)` to `.upsert(notifications, { onConflict: 'recipient_id,type,idempotency_key', ignoreDuplicates: true })` — an exact copy of the existing `daily-cron` convention.

**Exact Implementation Sequence:** Single-file code change. No migration needed (the column and index already exist). Deploy via standard route-handler deploy.

**Acceptance Tests:** Invoke streak-guardian twice in succession with identical eligible-student data; assert exactly one notification row per (student, day) pair after both runs.

**Cross-tenant negative tests:** N/A.

**Rollout Plan:** Standard deploy, no phasing needed.

**Rollback / Roll-forward:** Trivial single-file revert.

**Lock / Downtime / Data-mutation risk:** None — behavior-only change to a write path; does not touch existing rows.

**Observability requirements:** Monitor notification insert-conflict rate post-deploy (should show non-zero `ignoreDuplicates` hits on retry, confirming the fix is working as intended).

**Responsible Owner:** Backend.

**Unresolved Decisions:** None.

---

## Packet 8 — P1-07: match_rag_chunks_ncert EXECUTE grant to authenticated

**Finding ID / Severity:** P1-07 / P1

**Evidence & Confidence:** CONFIRMED the grant exists and is safe to revoke against all current callers — **but this packet conflicts with a deliberate, documented prior design decision and needs an explicit decision, not a default "revoke."**

- Grant: `supabase/migrations/20260707020000_rca18_db_function_execute_grants.sql:64-76` — `GRANT EXECUTE ON FUNCTION public.match_rag_chunks_ncert(...) TO authenticated, service_role`.
- All current callers traced and confirmed to use `service_role`, not the `authenticated` grant: `supabase/functions/_shared/rag/retrieve.ts:688` (single unified call site) is invoked with `supabaseAdmin` from `apps/host/src/app/api/foxy/route.ts`, module-level service-role clients in `grounded-answer/_sb.ts`, `ncert-solver/index.ts`. `quiz-generator/index.ts` does construct an anon-key `authSupabase` client, but it's used only for `auth.getUser()` and an unrelated governance RPC — never for retrieval.
- **Conflict:** The repo's own test suite treats `authenticated` as the intended, hardened state: `apps/host/src/__tests__/db-function-live-grant-verifier.test.ts` (backed by `scripts/verify-db-function-hardening-live.ts`) has an RCA-18 manifest asserting `allowedRoles: ['authenticated', 'service_role']` for this exact function and would fail if the grant is revoked without also updating the manifest. `run-eval.integration.test.ts:20-29` contains an explicit code comment: "match_rag_chunks_ncert is GRANT EXECUTE ... TO authenticated. A future least-privilege pass could swap the corpus read to an anon/authenticated client..." — i.e., a prior engineer deliberately left this grant in place as an intentional least-privilege *option*, reasoning that NCERT curriculum content (not student data) is what's exposed, so the risk is compute-abuse (bypassing rate-limit/circuit-breaker/quota), not a data leak. `17-findings-register.md`'s own P1-07 framing is consistent with this ("compute abuse," not data exposure).

**Root Cause:** N/A — this is an intentional grant, not a bug; the "finding" is a risk-acceptance question, not a defect.

**Affected components:** `match_rag_chunks_ncert` RPC grant; `db-function-live-grant-verifier.test.ts` RCA-18 manifest; `run-eval.integration.test.ts`.

**Production Impact if left as-is:** Any authenticated user could directly invoke the RPC via the client SDK, bypassing the app's own rate limiting, circuit breaker, output screening, quota enforcement, and audit logging that Edge-Function-mediated calls receive — a compute-abuse/cost vector, not a student-data exposure (content returned is shared curriculum, already visible to authenticated users through legitimate app paths).

**Dependencies:** If revoked, `db-function-live-grant-verifier.test.ts`'s manifest must be updated in the same change or CI will fail on a stale expectation.

**Proposed Correction (pending decision):** If the CEO/engineering owner decides compute-abuse risk outweighs the "intentional least-privilege option" rationale: `REVOKE EXECUTE ON FUNCTION public.match_rag_chunks_ncert(...) FROM authenticated;` and update the RCA-18 manifest + `run-eval.integration.test.ts`'s comment accordingly. If the decision is to keep it (accepting the risk as documented/intentional), this packet closes as "risk accepted, no change" — but should be explicitly recorded as such rather than left ambiguous.

**Exact Implementation Sequence (if revoking):** 1. Draft migration modeled on the same REVOKE pattern used elsewhere. 2. Update `db-function-live-grant-verifier.test.ts` RCA-18 manifest entry for this function to `allowedRoles: ['service_role']`. 3. Update the comment in `run-eval.integration.test.ts` to remove the now-stale "future least-privilege pass" note. 4. Deploy migration + test changes together.

**Acceptance Tests:** `db-function-live-grant-verifier.test.ts` (updated manifest) must pass; a new negative test confirming `authenticated`-role client calls to this RPC now fail with a permission error.

**Cross-tenant negative tests:** N/A — content is shared curriculum, not tenant-scoped.

**Rollout Plan:** Standard migration deploy if revoking.

**Rollback / Roll-forward:** Trivially reversible (re-grant) if revoking causes unexpected breakage.

**Lock / Downtime / Data-mutation risk:** None — metadata-only grant change.

**Observability requirements:** Monitor for unexpected 403/permission-denied spikes post-revoke in case an undiscovered caller exists.

**Responsible Owner:** DBA + whoever owns the RAG/compute-cost risk tradeoff decision (likely CEO or Eng lead, since it reverses a documented prior decision).

**Unresolved Decisions:** **This entire packet is one unresolved decision**: revoke (closing compute-abuse risk, reversing a documented prior least-privilege stance) vs. accept-as-is (keep the intentional grant, treat as a known, low-severity, non-PII risk). Recommend explicit sign-off either way rather than defaulting to "fix everything."

---

## Packet 9 — P1-08: Error messages leaked to clients

**Finding ID / Severity:** P1-08 / P1

**Evidence & Confidence:** CONFIRMED for the 3 named functions with exact line numbers; **the true scope is far larger than "3 files" and needs an explicit scope decision before implementation.**

- `supabase/functions/session-guard/index.ts:146-147` — `return json({ error: err.message || 'Internal error' }, 500)`
- `supabase/functions/teacher-dashboard/index.ts:4915-4918` (top-level catch) **plus ~20 more direct leaks scattered through individual handlers in the same file** (lines 2176, 2268, 2365, 3097, 4056, 4394, 2884, 2918, 3023, 3714, 3771, 3810, 4114, 4279, 4312, 4631, 4664, 4693, 4735, 4709 — some include Postgres `.details`/`.hint` alongside `.message`, e.g. `[insErr.message, insErr.details, insErr.hint].filter(Boolean).join(' ')`).
- `supabase/functions/parent-portal/index.ts:1468-1470` (top-level) plus lines 168/171/175 in an earlier handler.
- **Repo-wide scope (supports VULN-F1's "85+" as an undercount, not an overstatement):** 203 raw `err(or)?\.message` occurrences across 47 files in `supabase/functions/**`; 547 across `apps/host/src/app/api/**`. Not all ~750 are client-facing HTTP leaks — some are server-side-only `console.error`/log calls — but the pattern is confirmed systemic, not confined to 3 functions.

**Root Cause:** No shared, enforced error-response helper across Edge Functions/API routes; each catch block was hand-written independently.

**Affected components:** See above — 3 named functions (~25 total leak sites across them) plus a much larger unaudited surface (~700+ remaining sites, needing per-file triage to separate client-facing leaks from server-only logging).

**Production Impact:** Raw Postgres/Deno error messages (table names, column names, constraint names, runtime paths) returned to clients — information-disclosure risk, primarily useful to an attacker for reconnaissance rather than direct exploitation, but a genuine hardening gap. Confirmed admin-only surfaces mitigate but don't eliminate risk (per the original vulnerability scan's own note).

**Dependencies:** None blocking a first pass; a shared error-response helper (if built) should be reused by any future route/function rather than each hand-rolling its own pattern going forward.

**Proposed Correction:** **Scope decision required (see Unresolved Decisions) before implementation sequence can be finalized.** Recommended minimum-viable scope for this launch-blocking packet: fix the 3 named functions' top-level catches (session-guard, teacher-dashboard, parent-portal) plus teacher-dashboard's ~20 additional in-file leaks since the file is already being touched — replace with generic client-facing messages, log the real error server-side (e.g., to existing Sentry/ops_events pipeline). Defer the remaining ~700 repo-wide sites to a dedicated, non-launch-blocking hardening ticket (they were already tracked as VULN-F1/P3 in the original audit, consistent with this being a broad hygiene task rather than a single fixable defect).

**Exact Implementation Sequence:** 1. Introduce (or confirm existence of) a shared `safeErrorResponse(err, status)` helper that logs full detail server-side and returns a generic client message. 2. Apply to the ~25 sites across the 3 named functions. 3. Open a separate tracked ticket for the remaining ~700 sites with a per-file triage pass (distinguish client-facing from server-only) as its own scoped effort.

**Acceptance Tests:** For each of the 3 functions, trigger a DB error path and assert the HTTP response contains no table/column/constraint names or stack details, while confirming the real error still appears in server-side logs/Sentry.

**Cross-tenant negative tests:** N/A — information-disclosure hardening, not a tenant-isolation defect.

**Rollout Plan:** Standard deploy per function, no phasing needed for the minimum-viable scope.

**Rollback / Roll-forward:** Trivial per-function revert.

**Lock / Downtime / Data-mutation risk:** None.

**Observability requirements:** Confirm server-side logging (Sentry/ops_events) captures the full error detail that's no longer returned to clients — this must not become a net observability loss.

**Responsible Owner:** Backend.

**Unresolved Decisions:** **Scope boundary for the launch-blocking phase.** Options: (a) 3 named functions only (narrowest, matches original audit's literal claim); (b) 3 functions + teacher-dashboard's full in-file leak set (~25 sites, recommended above); (c) full repo-wide sweep (~700 sites) before launch (large effort, likely disproportionate for a launch gate). Recommend (b) for this phase, with (c) tracked separately — but this is a scope call for the CEO/Eng lead, not a default engineering judgment.

---

## Packet 10 — Rate Limiting Cluster: VULN-D1 (OAuth), VULN-D2 (payments), VULN-D3 (auth bootstrap/session)

**Finding ID / Severity:** VULN-D1, VULN-D2, VULN-D3 / P1 each. Grouped into one packet because all three share an identical remediation pattern and can be implemented as one coordinated change.

**Evidence & Confidence:** CONFIRMED for all three. None of the 6 target routes (`oauth/token`, `payments/create-order`, `payments/subscribe`, `payments/verify`, `auth/bootstrap`, `auth/session`) import or call any rate-limiting mechanism. They receive only `proxy.ts`'s blanket 600 req/min/IP general bucket (Layer 3 edge middleware) — not exempted, but also not given a tighter bucket.

**Root Cause:** These 6 routes were never onboarded onto the platform's existing, reusable rate-limiting helper when they were built.

**Affected components & exact insertion points:**
- **Reusable helper (already exists, already used at 6 call sites):** `packages/lib/src/api-rate-limit.ts`, `checkApiRateLimit(keyId, limit, windowMs)` — Upstash `Ratelimit.slidingWindow`, in-memory fallback with TTL if Upstash unreachable. Already used by `parent/link-code/request-otp`, `parent/link-code/redeem`, `schools/trial`, `schools/claim-admin`, `v1/school/students`, `v1/school/reports`.
- **Upstash already provisioned** — `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` already set in `.env.local`, already backing this exact helper, the super-admin login limiter, `proxy.ts`, and `alfabot/limits.ts`. **No new infrastructure or credentials needed.**
- **`apps/host/src/app/api/oauth/token/route.ts`** — insert at top of `POST` (line 283), before dispatching to grant handlers. Key: `oauth-token:${ip}` (pre-validation, only IP is known); optionally add a secondary per-`client_id` bucket once parsed, since a distributed attacker could rotate IPs against one `client_id`.
- **`apps/host/src/app/api/auth/bootstrap/route.ts`** — insert right after `resolveAuthUser()` returns a non-null `user` (line 137), before body parsing. Key: `bootstrap:${user.id}` (post-auth, authenticated-user throttling, not credential brute-force).
- **`apps/host/src/app/api/auth/session/route.ts`** — insert at top of `POST`, before `resolveAuthUser()` (line 82) — this route can return 200 for unauthenticated callers by design (`no_session_yet`), so IP-only limiting is needed pre-auth; switch to per-`user.id` for authenticated callers. **Note:** file is marked CRITICAL AUTH PATH with strict change-testing instructions in its own header comments — follow those.
- **`apps/host/src/app/api/payments/create-order/route.ts`**, **`subscribe/route.ts`**, **`verify/route.ts`** — all three share the identical `authorizeRequest(request, 'payments.subscribe')` → Supabase-user-resolution shape. Insert immediately after the RBAC gate succeeds, before user lookup, in all three. Key: `payments:${userId}`.

**Production Impact:** OAuth token endpoint is brute-forceable for client secrets with unlimited attempts. Payment order-creation endpoints have no per-user cap — a compromised session could create unlimited Razorpay orders (real cost, real API-limit exhaustion). Session/bootstrap endpoints have no application-layer throttle beyond Supabase GoTrue's own limits.

**Dependencies:** None — reuses existing, already-provisioned infrastructure.

**Proposed Correction:** Import `checkApiRateLimit` into each of the 6 files; call at the insertion points above; on `!allowed`, return `429` with `Retry-After` and `X-RateLimit-Remaining` headers matching the exact response shape already used in `schools/claim-admin/route.ts` and `parent/link-code/redeem/route.ts`.

**Exact Implementation Sequence:**
```ts
import { checkApiRateLimit } from '@alfanumrik/lib/api-rate-limit';
const rl = await checkApiRateLimit(`<bucket>:${key}`, <limit>, <windowMs>);
if (!rl.allowed) {
  return NextResponse.json({ error: '<context-appropriate message>' }, {
    status: 429,
    headers: {
      'Retry-After': String(rl.resetAt - Math.floor(Date.now()/1000)),
      'X-RateLimit-Remaining': '0',
    },
  });
}
```
Suggested starting limits (owner should confirm against real traffic patterns before finalizing): OAuth token 20/5min per IP (matches super-admin login's established convention); payments 10/hour per user (matches `schools/claim-admin`'s convention); auth/bootstrap and auth/session 30/5min per user or IP respectively. Deploy the three payment routes as one uniform diff (identical insertion pattern), then oauth/token and auth/{bootstrap,session} as a second coordinated diff given `auth/session`'s CRITICAL AUTH PATH designation warrants isolated, careful testing.

**Acceptance Tests:** For each route, script N+1 requests within the window and assert the (N+1)th returns 429 with correct headers; assert legitimate traffic under the limit is unaffected; for `auth/session` specifically, run the file's own existing test suite in full post-change given its critical-path designation.

**Cross-tenant negative tests:** N/A — rate limiting is per-IP/per-user, not tenant-scoped; no cross-tenant leakage risk.

**Rollout Plan:** Deploy behind normal CI/CD; consider a brief monitoring window (a few hours to a day) after deploy watching 429 rates before considering this fully closed, in case configured limits are miscalibrated against real traffic.

**Rollback / Roll-forward:** Trivial per-file revert of the rate-limit-check insertion; the helper itself fails open to the in-memory fallback if Upstash is unreachable, so no risk of the fix itself causing an outage via infra failure.

**Lock / Downtime / Data-mutation risk:** None — no schema/migration involved, pure application-layer change.

**Observability requirements:** Dashboard/alert on 429 rate per route post-deploy to catch miscalibrated limits early (both false-positive lockouts of legitimate users and confirmation the limiter is actually engaging against abuse).

**Responsible Owner:** Backend.

**Unresolved Decisions:** Exact numeric limits (requests/window) per route — proposed above as starting points based on existing conventions elsewhere in the codebase, but should be confirmed against real production traffic data (if available) rather than assumed.

---

## Packet 11 — P-01 + newly-surfaced P2-04: Admin routes leak unfiltered child PII / RBAC check-not-enforced

**Finding ID / Severity:** P-01 / P1 (retained — this is "restricted access to private student records," not formal DPDPA compliance work). Folding in newly-surfaced **P2-04→P1 reclassified**: 3 routes where an RBAC permission check runs but its result isn't enforced — a related, equally-in-scope authorization defect discovered during dependency-graph research.

**Evidence & Confidence:** CONFIRMED — **5 routes, not 6** (the original audit's "teacher remediation export" and "school-admin roster" categories were checked and found already using explicit column allowlists; not reproducible).

**5 confirmed unfiltered-SELECT routes on child/student data:**
1. `apps/host/src/app/api/super-admin/users/route.ts:39,43` — raw REST `select=*` via service-role headers, bypasses RLS entirely. Table resolves to `students`/`teachers`/`guardians` per `?role=`. Documented consumer shape (`UserRecord`, `super-admin/users/page.tsx:16-21`): `id, auth_user_id, name, email, role, grade?, board?, xp_total?, streak_days?, school_name?, is_active?, account_status?, subscription_plan?, created_at`.
2. `apps/host/src/app/api/super-admin/students/[id]/dashboard/route.ts:42,63` — two `select('*')` calls on `students`. Consumers read only `name, xp_total, streak_days, board, grade, language_preference, is_active`.
3. `apps/host/src/app/api/super-admin/students/[id]/profile/route.ts:40,102` — `select('*')` on `students` and on `student_subscriptions`. Documented consumer shape (`StudentProfile`, `super-admin/students/[id]/page.tsx:102-115`): `id, name?, email?, grade?, stream?, board?, subscription_plan?, selected_subjects?, preferred_subject?, is_active?, created_at?`. Note: every other join in this file's `Promise.all` already uses explicit column lists — the `students` row itself is the sole outlier in an otherwise well-minimized file.
4. `apps/host/src/app/api/internal/admin/users/[id]/route.ts:19` — `select('*')` on `students`. Consumer (`UserDrawer.tsx`) reads only `id, is_active, subscription_plan, name, email, xp_total, streak_days, grade, board, created_at`.
5. `apps/host/src/app/api/v1/child/[id]/report/route.ts:49` — `select('*')` on `monthly_reports`. **Lower severity** — no direct name/DOB/contact PII, aggregate academic performance keyed by `student_id`, but still returns raw unprojected `report_data`/`test_scores` jsonb blobs. Frontend consumer could not be confidently matched (a differently-shaped `report` object is read elsewhere) — recommend explicitly enumerating needed columns rather than inferring from a mismatched consumer.

**Reference pattern (verified-good, already in the codebase):** `apps/host/src/app/api/v2/student/profile/route.ts` → `supabase-learner-repository.ts` → `learner-profile-dto.ts`: a named `LEARNER_COLUMNS` constant, `Pick<>`-narrowed TypeScript type against the generated DB schema, a pure snake_case→camelCase row mapper, a frozen presentation DTO, RLS-scoped (never service-role) client. For these 5 internal admin-tool routes, full DTO/Zod-contract machinery is unnecessary — recommend adopting just the named-column-constant + `Pick<>`-type layer (steps 1-3 of the v2 pattern), matching what `school-admin/reports/route.ts` and `teacher/remediation/route.ts` already do correctly elsewhere in the same codebase.

**Newly-surfaced, folded in — P2-04→P1:** Original audit's P2-04 ("3 routes run permission checks but don't enforce the result" — teacher-dashboard, parent-portal, assessment) is a real, confirmed authz-bypass instance, not a theoretical concern — reclassified from P2 to P1 given it's directly "authorization," in-scope per the CEO's retained essential-security list. **Exact files/lines not yet pinned down by the research passes** — needs a follow-up targeted grep before a full packet can be written; flagging its existence and reclassification here so it isn't silently dropped, with the specific file/line evidence to be gathered as the first step of implementation.

**Root Cause (P-01):** Ad hoc query-writing in admin tooling without an enforced no-`select('*')` convention outside the v2 module boundary.

**Affected components:** See the 5 routes above; `students`, `student_subscriptions`, `monthly_reports` tables.

**Production Impact:** Child PII (DOB, phone, contact fields, address-adjacent fields per the 47-column `students` schema) returned to admin sessions far beyond what any consuming UI actually renders — a data-minimization / blast-radius issue (if an admin session or token is compromised, more is exposed than necessary), not a public-facing leak (all 5 routes require admin-level auth already).

**Dependencies:** None between the 5 routes — each can be fixed independently and in parallel.

**Proposed Correction:** For each of the 5 routes, replace `select('*')` with an explicit named column list matching the documented/verified consumer shape given above.

**Exact Implementation Sequence:** Per route: (1) define a named column-list constant near the top of the file (or in a shared admin-DTO module if a second instance of the same table's projection is needed elsewhere); (2) replace the `select('*')` call with `select(COLUMNS)`; (3) if TypeScript typing allows, narrow the row type with `Pick<Database['public']['Tables']['students']['Row'], ...>` to catch future drift. Route 1 (`super-admin/users/route.ts`) additionally needs its raw-REST `select=*` query-string param changed to an explicit column list. Route 5 (`v1/child/[id]/report/route.ts`) needs the consumer relationship clarified first (see Unresolved Decisions) before finalizing its column list.

**Acceptance Tests:** For each route, assert the response no longer contains fields outside the defined projection (e.g., `date_of_birth`, `phone`, `parent_phone`, `emergency_contact` should be absent from responses that don't need them); assert existing consuming UI continues to render correctly (regression test against current frontend usage).

**Cross-tenant negative tests:** Not the primary defect here (all 5 routes are already admin-gated), but worth a pass: confirm each route's existing school/tenant-scoping (if any) is unaffected by the column-projection change — the fix should be additive/restrictive only, not alter row-level filtering logic.

**Rollout Plan:** Standard deploy, 5 independent single-file changes, can ship incrementally or as one coordinated PR.

**Rollback / Roll-forward:** Trivial per-route revert.

**Lock / Downtime / Data-mutation risk:** None — read-path-only change, no schema/migration.

**Observability requirements:** None beyond standard route testing.

**Responsible Owner:** Backend.

**Unresolved Decisions:**
1. Route 5's exact required-column set — the frontend consumer relationship is unclear from static analysis; needs a quick manual trace or a question to whoever owns the parent-reports feature before finalizing.
2. **P2-04's exact file/line evidence still needs to be gathered** — this reclassified item is flagged but not yet fully packetized; recommend a short, targeted follow-up investigation (grep for permission-check-result-ignored patterns in `teacher-dashboard`, `parent-portal`, `assessment` routes) before this sub-item is executed, separate from the 5 already-fully-evidenced routes above.

---

## Cross-Packet Notes

- **Packets 4, 5, 6, 7 (P1-03, P1-04, P1-05, P1-06)** are all low-risk, well-understood, independently executable, and could reasonably be greenlit as a fast-follow batch ahead of the larger P0-01/P1-01/P1-02 investigation work, if the CEO wants early wins.
- **Packets 1 and 2 (P0-01, P1-01)** turned out to require far less new engineering than the original audit implied — but Packet 2 is now blocked on a **mobile release cycle**, which is likely the single longest lead-time item in the entire launch-blocking set (longer than the RAG root-cause work in Packet 3, depending on app-store review times and forced-upgrade adoption curves). This should be sequenced first given its lead time, even though the DB-side change itself is small.
- **Packets 8 and 9 (P1-07, P1-08)** are not simple "apply the fix" items — both require an explicit scope/risk-acceptance decision from the CEO or Eng lead before implementation can proceed, and should not be silently resolved by engineering judgment alone.
- **Packet 3 (P1-02)** should not be considered closeable on the "faithfulness ≥ 95%" acceptance gate as currently measured — that metric needs to be redesigned before it's a meaningful gate at all. Recommend the CEO's stated acceptance gates for RAG be revisited: recall/nDCG/MRR gates are real and actionable now; the faithfulness/correctness/abstention gates need the harness fixed first (see Packet 3 and `26-launch-gate-matrix-and-recommendation.md`).
