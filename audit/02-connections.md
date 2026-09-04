# 02 — Connection & Correctness Audit

Date: 2026-09-03. Every row carries proof: file:line, live query, HTTP probe, or a Vercel/Supabase log entry. Per-route table (407 rows, derived status): `audit/evidence/connections-table.md`; raw census: `audit/evidence/agent-api-routes.csv`. Evidence IDs `C-nnn` are used in the summary.

Limits of this pass (stated, not hidden): (1) No role could be logged in — password entry is prohibited for me and the CEO's browser held no session — so "WORKING" for authenticated routes means *called from the UI + guard present + zero runtime errors in the 7-day Vercel error index*, not a recorded end-to-end request by me. (2) Forms were not submitted live; validation is assessed from code (schema presence) not from posting malformed input. (3) No real Razorpay test order was placed. Each of these is listed as a Gate-1 decision.

## Status totals

| Status | Count | Where |
|---|---|---|
| WORKING (called, guarded, no errors) | 319 API routes (+21 cron/webhook routes scheduled by `vercel.json`/pg_cron) | connections-table.md |
| **BROKEN** | 9 (5 API routes with live errors, 1 retired Edge Function still receiving traffic, 1 webhook never observed, 1 crawler block, 1 cron unverified) | §A |
| **DISCONNECTED** (UI calls nothing / non-existent target) | 6 client literals + 35 orphan pages + 2 dead nav destinations | §B |
| **ORPHAN** (backend exists, nothing calls it) | 62 product API routes (83 minus 21 scheduled), 19 hooks, 13 tombstone Edge Functions, 3 sourceless deployed functions, 17 RPCs missing from types, 5 empty mastery tables | §C |
| **DUPLICATE** | 14 groups (both paths named) | §D |

## A. BROKEN — with the request/response evidence

| ID | Connection point | Evidence | Root cause (one sentence) |
|---|---|---|---|
| C-001 | Teacher → `/api/teacher/messages/threads` → RPC `teacher_list_message_threads` | Vercel `get_runtime_errors` 7d: `"permission denied for function teacher_list_message_threads"`, 5 occurrences, 1 user, 2026-08-23→08-31, route `teacher/messages/threads`. Function exists live (`pg_proc`) and is in generated types. | The RPC lost its EXECUTE grant for `authenticated` in the 2026-09-02 `REVOKE … FROM PUBLIC` sweep (or was created without one); the route calls it with the user-context client, so the DB rejects it. Teacher messaging is down. |
| C-002 | Parent → `/api/parent/messages/threads` → RPC `parent_list_message_threads` | Same error class, 2 occurrences, last 2026-08-31T09:33Z. | Same grant regression. Parent messaging is down. |
| C-003 | Parent → `/api/parent/report` → Edge `parent-report-generator` | `parent_report_edge_function_failed` `deny_auth`, status 401, 3 occurrences (2026-08-15→08-31). Edge census: `parent-report-generator` has no recognised auth pattern in `index.ts` and 0 `parent_weekly_reports` rows exist. | The Next.js route's bearer/signature does not satisfy the function's guard; parents cannot generate reports. |
| C-004 | Cron → `/api/cron/irt-calibrate` | `"learning_objectives read failed: Could not embed because more than one relationship was found for 'chapters' and 'subjects'"` daily 02:50 UTC since 2026-08-06; last error 2026-09-02T02:50 (fix PR merged ~18:00 UTC same day, next run not yet observed). | Ambiguous PostgREST embed; IRT calibration has produced no output for 27 days. Verify at 2026-09-03T02:50Z run. |
| C-005 | Student → `/api/foxy` → `foxy_chat_messages` persist | `foxy.message_persist_failed` stage `streaming_update`, errorCode `P0001`, 2 events (08-28, 08-31), sessions/students identified in log. | A trigger raises (`trg_guard_foxy_chat_message_immutability` is the only P0001-raising guard on that table in `pg_proc`); the streamed answer is shown but not saved. Intermittent, unresolved. |
| C-006 | Mobile → Edge `foxy-tutor` (retired 2026-07-01, tombstone 410) | Deployed ACTIVE v74; `function_edge_logs` last 24 h shows 3 invocations of fn `72d66c23…` (= `foxy-tutor`). `mobile/lib` still references it (edge-census: 2 mobile callers). | Installed APKs pinned to `edge` still hit a 410; those users get a hard failure. |
| C-007 | Razorpay → `/api/payments/webhook` | Live `payment_webhook_events` = **0 rows ever**; `payment_history` = 5 rows, last 2026-08-15, all written by `/api/payments/verify` (client path). Route records every event via `record_webhook_event` (`webhook/route.ts:39-52`). | Either the webhook is not registered against `alfanumrik.com` or Razorpay has never delivered one; server-side reconciliation of payments (captured-without-verify, refunds, subscription events) is not happening. Needs the CEO's Razorpay dashboard check. |
| C-008 | Search engines → every public page | `curl -A "Googlebot/2.1"` `/robots.txt` → **429** `text/html` "Vercel Security Checkpoint"; same for 49 other paths; only `/api/v1/health` 200. PageSpeed Insights could not be run (daily quota exhausted, not a site error). | Vercel attack-challenge / bot-protection is on for all traffic; whether verified Googlebot is exempted cannot be proven from outside — must be confirmed in the Vercel Firewall settings. Until then organic indexing is at risk. |
| C-009 | Client literal `/api/py` (`apps/host/src/hooks/useFoxyOS.ts:4`, duplicate `packages/lib/src/hooks/useFoxyOS.ts:4`) | `next.config.js:196-199` rewrites `/api/py/:path*` → `/api`, which has no handler. `useFoxyOS` importers: 0 (hooks-importers.tsv). | Dead path; harmless today only because the hook is orphaned. |

Anthropic outage note (context, resolved): 420 `claude_api_http_error 401 "API key is invalid"` events, 256 users, 2026-08-26→08-31 on `/api/foxy` and `/api/internal/cron/fix-failed-questions`; none after 08-31 09:16Z.

## B. DISCONNECTED

| ID | UI element | Calls | Proof |
|---|---|---|---|
| B-1 | `packages/ui/src/landing/TrustV2.tsx:38` (WelcomeV2 live-learners counter) | `/api/v1/live-learners` — **no route** | `api-disconnect.tsv`; `find apps/host/src/app/api -path "*live-learners*"` → none. Rendered via `/welcome?v=2`. |
| B-2 | `packages/ui/src/play/MissionStepList.tsx:10` | `/api/play/mission-progress` — no route (file comment admits it) | |
| B-3 | `(student)/exams/mock/[paperId]/results/page.tsx:11` | `/api/exams/attempts/[id]` — no route; results page renders an empty state | |
| B-4 | `parent/consent/page.tsx:110` | `/api/parent/consent/pending` — no route (inline fallback) | |
| B-5 | `useFoxyOS` (both copies) | `/api/py/*` (see C-009) | |
| B-6 | `/tests` page `onAdd`/`onEdit` | "coming soon" banner; write path for `student_exam_entries` never built (`tests/page.tsx:18-22`) | |
| B-7 | 35 orphan pages (01-inventory §1a.3) incl. `/schools`, `/settings`, `/tutor`, `/exam-briefing` | reachable only by typed URL | inbound-links.json |
| B-8 | Nav entries whose targets are flag-off shells: `/tutor` (`ff_tutor_v1` OFF), `/tests` (`ff_exam_schedule_v1` ON but no write path), `/synthesis` (`ff_pedagogy_v2_monthly_synthesis` OFF in production → page shows nothing to do), `/dive` (`ff_pedagogy_v2_weekly_dive` enabled only for development/staging environments per live `feature_flags.target_environments`) while `/dive` and `/synthesis` sit in the student "Explore" nav (`nav-config.ts` MORE_ITEMS L67-68) behind `ff_nav_groups_v1` (OFF). | | live `feature_flags` query |

## C. ORPHAN

- **62 product API routes with no frontend caller** (list in 01-inventory §1c; full list connections-table.md status ORPHAN). Highest-value dead surfaces: `/api/school-admin/students` and `/teachers` (list endpoints the school-admin pages do not use — the pages query Supabase from the browser instead, `supabase-client-tables.tsv`), `/api/v2/quiz/{start,questions}`, `/api/v2/parent/glance`, `/api/student/study-plan`, `/api/public/v1/*` + `/api/oauth/*` (an unused partner API), `/api/v1/*` (11 routes).
- **19 orphan hooks** (01-inventory §1c).
- **13 tombstone Edge Functions deployed** + `foxy-tutor` still called (C-006); **3 deployed functions with no source** (`account-purge`, `data-erasure-purger`, `edge-health-audit`) — undeployable/unreviewable from git.
- **Mastery stores never read by any surface**: `adaptive_mastery` (written by triggers `fn_quiz_response_bkt_update`/`fn_quiz_session_bkt_update`, 0 rows), `topic_mastery` (0 rows, 0 readers), `layer_mastery` (0), `student_concept_state` (0 readers), `concept_mastery_score` (1 reader). The only live store is `concept_mastery` (89 rows; 30 app + 21 lib + 16 edge readers).
- **17 live RPCs missing from generated types** (01-inventory §1d) — callers pass `as any` or use raw fetch; type safety is off for exactly the functions that changed most recently.
- Design-side orphans: `RoleShell` (0 importers), `ExamScheduleCard`, `MissionCard`, `SchoolWelcomeHeader`, `SchoolBrandedHeader`, `SchoolAnnouncementBanner`, `ReselectBanner`, `ConversationHeader`, `UpcomingExamCard` (all 0 importers, census-out.txt).

## D. DUPLICATE (both paths named)

| # | Outcome | Path A | Path B (+C…) | Proof |
|---|---|---|---|---|
| D-1 | Get quiz questions | `/api/quiz` → `select_quiz_questions_rag` (`quiz/route.ts:498`) | `/api/v2/quiz/questions:183` (same RPC, orphan); client `packages/lib/src/supabase.ts:1770` (same RPC from browser); `supabase.ts:1733` `functions.invoke('quiz-generator')`; `(student)/quiz/page.tsx:1680` direct call to Edge `ncert-question-engine`; `packages/lib/src/domains/quiz.ts:135`; WhatsApp `daily6.ts:642` | 6 call paths, 2 RPCs + 2 Edge Functions |
| D-2 | Submit quiz | `/api/quiz/submit` | `/api/v2/quiz/submit`; client `supabase.ts:697` `rpc('submit_quiz_results_v2')` (`ff_server_only_quiz_submit` OFF, `ff_v1_quiz_rpc_blocked` ON); RPC family `submit_quiz_results`, `_v2`, `_rpc`, `_safe` | quiz page imports `submitQuizResults` from `@alfanumrik/lib/supabase` (`quiz/page.tsx:9`) |
| D-3 | Vector retrieval | `match_rag_chunks_ncert` (Foxy live path, `_shared/rag/retrieve.ts:688`; 2 overloads live) | `match_rag_chunks` (`_shared/retrieval.ts:434`, `concept-engine/route.ts:208,513`), `match_rag_chunks_v2` (`retrieval.ts:385`), `match_rag_chunks_v3`, `fast_rag_search(_v2)`, `hybrid_rag_search`, `instant_rag_search`, `search_rag_chunks`, `get_chapter_rag_content`, `get_chapter_qa_from_rag` | 11 live retrieval RPCs over the same `rag_content_chunks` HNSW index |
| D-4 | Chapter taxonomy | `curriculum_topics` (542) | `chapters` (551), `cbse_syllabus` (1,148) — see §E.4 | |
| D-5 | Mastery state | `concept_mastery` via `update_learner_state_post_quiz` | `adaptive_mastery` via `bkt_update`/`fn_quiz_*_bkt_update` triggers; `update_concept_mastery`, `update_concept_mastery_bkt`, `update_mastery_bkt`, `bkt_update_personalized` all write `concept_mastery` with their own formulas | live `pg_proc` scan |
| D-6 | Admin console | `/super-admin/*` + `/api/super-admin/*` (128 routes) | `/internal/admin` + `/api/internal/admin/*` (12 routes) | 01-inventory §1a.4 |
| D-7 | Student roster list | `/api/school-admin/students` (server, RBAC, orphan) | school-admin pages querying `students` from the browser under RLS | supabase-client-tables.tsv |
| D-8 | Bulk student import | `/api/super-admin/bulk-upload` (CSV, template, 1,000 rows) | `/api/school-admin/students/bulk-import` (JSON rows) + `/api/school-admin/roster/validate` (dry-run) + `/api/school-admin/classes/bulk-create` + `/api/internal/admin/bulk-action` | route headers |
| D-9 | Email sending | Edge `send-transactional-email` | `send-auth-email`, `send-welcome-email`, `send-renewal-reminder`, `send-pre-debit-notice`, Node `packages/lib/src/email-delivery.ts` — all Mailgun | edge-census.tsv |
| D-10 | WhatsApp send | `whatsapp-send` | `whatsapp-notify` (+ Next `/api/notifications/whatsapp`, orphan) | |
| D-11 | Payment reconcile | `/api/cron/reconcile-payments` | `/api/cron/payments-health`, `/api/super-admin/payment-ops/{stuck,reconcile}` (shared lib since #1706), RPCs `reconcile_payment`, `reconcile_stuck_payments` | |
| D-12 | Login | `/login` (AuthScreen, 4 tabs) | `/parent` (own form), `/super-admin/login` (own limiter) | |
| D-13 | Rate limiting | `packages/lib/src/api-rate-limit.ts` | `proxy.ts` own limiters; `super-admin/login/route.ts` own limiter; DB `check_rate_limit`, tables `rate_limits`, `api_rate_limits`, `api_rate_limits_v2` | |
| D-14 | Hooks | `apps/host/src/hooks/{useFoxyOS,useRealtimeRevalidator,useRealtimeSubscription,useTouchAndMouse}.ts` | identical names in `packages/lib/src/hooks/` | `ls` both dirs |

## E. Mandatory checks

### E.1 RBAC — server-side role check + audit write, per namespace (file:function)

| Namespace | Server-side role check | Audit-log write | Verdict |
|---|---|---|---|
| `/api/super-admin/*` (128) | `authorizeAdmin(request, level)` `packages/lib/src/admin-auth.ts:312`; 97 routes; tiers: 34 `support`, 11 `admin`, 23 `super_admin`, 32 mixed, **28 with no level literal detected** (default tier applies — verify) | `logAdminAudit` `admin-auth.ts:706` / `logAdminAction` `:953` → `admin_audit_log` (228 rows live); missing on `/ai/[fn]`, `/logout`, `/observability/rules/[id]/test`, `/projectors/replay` | PASS with 4 gaps |
| `/super-admin/*` pages | **none server-side** (`super-admin/layout.tsx:10-27`); client `useAdmin` (`AdminShell.tsx:105`) | n/a | FAIL (UX-only gate; data is protected by the API layer) |
| `/api/internal/admin/*` (12) | `proxy.ts` Layer 2.1 super_admin session; routes use `authorizeAdmin`/`authorizeOperator` | `logAdminAudit` present; **`/api/internal/agents/chapter-explorer`, `/api/internal/cron/*` mutate without audit** | PASS with gaps |
| `/api/school-admin/*` (42) | `authorizeSchoolAdmin` (35) or `authorizeRequest('institution.*')` via `resolveCommandCenterContext` (`command-center-context.ts:122`); RPCs additionally scope with `is_school_admin_of()` | `logAudit` `rbac.ts:700` → `audit_logs` (`school_audit_log` has 1 row — the school-scoped log is effectively unused); missing on `/gst-details`, `/roster/validate` | PASS with 2 gaps |
| `/api/teacher/*` (19) | `authorizeRequest('teacher.*')` + `resolveTeacherRosterScope` `rbac.ts:513` | **11 of 19 mutating teacher routes write no audit entry** (list in §A of 01-inventory §1c) | PASS auth / FAIL audit |
| `/api/parent/*` (17) | `authorizeRequest` + `get_my_guardian_student_ids` / `is_guardian_of` in RPCs | `logAudit` on link/consent routes | PASS |
| `/api/student/*`, `/api/foxy`, `/api/quiz` | `authorizeRequest` / `auth.getUser` + `get_my_student_id()` in RPCs | n/a | PASS |
| Middleware role gate | `proxy.ts:1085-1140` Layer 0.65, **fail-open**, prod-only | `console.warn` breadcrumb only | Defense-in-depth only, by design |

Live RBAC probe results (anon key, placeholder UUIDs): ownership guards hold on `foxy_get_student_state`, `foxy_get_student_timeline`, `get_user_role`, `security_resolve_user_context`; two anon oracles remain (`is_active_admin`, `get_feature_flag_envelope`) — P2.

### E.2 Forms — boundary validation and error codes

Code evidence only (no live submissions): 71 of 407 routes validate with zod/`validateBody`; **169 mutating routes accept unvalidated JSON**, including `/api/auth/bootstrap`, `/api/parent/profile` PATCH, `/api/teacher/assignments` POST, `/api/internal/admin/{content,feature-flags,schools,support,users/[id]}`, `/api/exams/papers/[id]/{autosave,start,submit}` (which export all five HTTP verbs), `/api/payments/setup-plans`. Malformed UUIDs: `isValidUUID` (`admin-auth.ts:881`) or `z.string().uuid()` is present in 60 routes; 55 routes have dynamic `[id]` segments — coverage is nominally complete but the check is applied inconsistently to body IDs (e.g. `student_id` in JSON bodies of bulk routes). Structured error codes: `withRoute()` envelope adopted by 17 routes only; the rest return ad-hoc `{ error }` strings.

### E.3 Lists — pagination and indexes

18 GET routes run `.select()` with no `.limit/.range` (connections-table.md "UNBOUNDED"), notably `/api/teacher/students`, `/api/v2/exam-schedule`, `/api/super-admin/foxy-quality`, `/api/super-admin/synthesis-health`, `/api/revision/overview`, `/api/dashboard/reviews-due`. No shared paginated table primitive exists (`Pagination` implementations = 0). Indexes (live `pg_indexes`) cover the WHERE/ORDER columns used by these routes (`student_id, created_at DESC` composites on quiz_sessions/quiz_responses/foxy_chat_messages/notifications; `school_id` partials on students/teachers/classes) — the risk is payload size, not query plan.

### E.4 Foxy / Quiz / curriculum must share one chapter query and one RAG namespace — **P0 divergence confirmed**

| Surface | Chapter structure source | Retrieval RPC | Embedding | Proof |
|---|---|---|---|---|
| Foxy (Next route) | `chapters` (`api/foxy/_lib/cognitive-context.ts:158`) **and** `curriculum_topics` (`:575`) | delegates to Edge `grounded-answer` (`ff_grounded_ai_foxy` ON) | — | `api/foxy/route.ts:1335-1340` |
| Foxy (Edge `grounded-answer`) | `cbse_syllabus` (`coverage.ts:116,141,171`) **and** `curriculum_topics` (`transfer-retrieval.ts:91,133`) | `match_rag_chunks_ncert` (`_shared/rag/retrieve.ts:688`) with subject_code/grade/chapter_number filters; legacy `match_rag_chunks_v2`/`match_rag_chunks` (`_shared/retrieval.ts:385,434`) | `voyage-3`, 1024-d | |
| Quiz (`/api/quiz`, `/api/v2/quiz/questions`, client) | `chapters` + `question_bank` inside `select_quiz_questions_rag` (live def scan) | none (question bank) | — | `quiz/route.ts:498` |
| Quiz page direct | Edge `ncert-question-engine` (own `voyage-3` + Anthropic; `question_bank`) | own | | `(student)/quiz/page.tsx:1680` |
| Concept engine | `match_rag_chunks`, `get_chapter_rag_content`, `get_chapter_qa_from_rag` | `voyage-3` | | `api/concept-engine/route.ts:186-208,513` |
| Learn / Library / Exams pages | `chapters` (`learn/page.tsx:168`, `[chapter]/page.tsx:348`), `curriculum_topics` (`[chapter]/page.tsx:402`, `exams/page.tsx:141`), `cbse_syllabus` via `available_chapters_for_student_subject_v2` (`useAllowedChapters`) | — | | |
| Today / rhythm | `get_chapter_titles_for_pairs` → `curriculum_topics` | | | `api/v2/today/route.ts:230` |

Three taxonomies with different row counts (542 / 551 / 1,148 — the last includes per-board rows) mean a chapter can be "ready" in one and absent in another; nothing joins them except `rag_syllabus_map` (547 rows) and the `assert_syllabus_corpus_alignment` check function. The embedding index is single (`rag_content_chunks`, all `ncert_2025`), so the "namespace" is consistent, but the `embedding_model` tag is split `voyage-3` / `voyage/voyage-3` (13,859 / 13,919 rows); no RPC filters on it today (live `pg_proc` scan) — cosmetic until someone adds such a filter.

### E.5 Payments

| Check | Result | Proof |
|---|---|---|
| UI ₹ = backend = Razorpay order | Parity **by construction**: PricingPlansV3 and PlanModal read `PRICING` from `packages/lib/src/plans.ts:105-109` (299/2399, 699/5599, 1099/8799); `create-order` charges `CONSUMER_PRICING_PAISA[plan][cycle]` (`create-order/route.ts:147-160`) which is `PRICING×100`; live `subscription_plans.price_monthly/yearly` match (299/2399, 699/5599, 1099/8799). Live pricing page shows ₹299/₹699/₹1,099 (browser JS capture). | Not verified with a real order (would require a payment). |
| Stale display string | `subscription_plans.price_display` for `unlimited` = "₹1,499/mo" while `price_monthly`=1099. Column has **no readers** in app code (grep) — cosmetic, but a future reader will show the wrong price. | live row |
| Marketing copy | FAQ files (`PricingFaqV3.tsx:34`) quote ₹699/₹5,599/₹467 — consistent; older ₹1,499 references exist only in comments. | grep |
| Idempotency | `payment_history.razorpay_payment_id` unique index; webhook path uses event-level dedupe (`record_webhook_event` / `mark_webhook_event_processed`) and `idempotencyKey: paymentId` on activation (`webhook/route.ts:666-858`); `quiz_sessions` and `notifications` carry `idempotency_key` indexes. | live `pg_indexes`, route |
| Webhook registered on exactly one host | Only one host exists now; but **0 webhook events ever received** (C-007). | live table |
| Migrations that reset quotas | No migration sets `foxy_extra_chats = 0` or truncates `student_daily_usage`/quota tables (`grep` over `supabase/migrations` → none). Daily usage is a rolling table with `cleanup_old_daily_usage`. | grep |
| Mailgun | Outbound only (`email-delivery.ts`); there is no inbound Mailgun webhook route in the app (`find api -path "*mailgun*"` → none), so nothing to double-register. | |

### E.6 Dual-host

Not applicable any more: the Fargate host was decommissioned 2026-08-03 (01-inventory §0). Every failing request in §A was served by Vercel (`deploymentId dpl_91fxaB…` etc. in the error index). `Dockerfile`, `compose*.yaml`, `deploy.ps1`, `DEPLOY_TARGET` branches in `next.config.js:8-13`, and the ECS-era `synthetic-host-monitor` remain as dead configuration.

### E.7 Known incident patterns

| Pattern | Finding | Proof |
|---|---|---|
| BKT mastery write target | `update_learner_state_post_quiz` writes `concept_mastery.mastery_probability` (canonical numeric) + `p_know` + derived `mastery_level` band; correct since the 2026-06-23 backfill. But **five other writers** with their own BKT math still exist (D-5), and the trigger pair `fn_quiz_response_bkt_update`/`fn_quiz_session_bkt_update` writes `adaptive_mastery.mastery_level`/`p_know` (0 rows live) — dead-but-armed. | live `pg_get_functiondef` |
| Directory excluded from git that contains live code | None: every `.gitignore` directory that exists on disk has 0 `.ts/.tsx/.sql` files; the 3 sourceless Edge Functions are the real "live code not in git" (deployed from `/tmp`, see `entrypoint_path` for `edge-health-audit`). | `git check-ignore` sweep; `list_edge_functions` |
| Direct Anthropic calls bypassing the retry helper | Retry helpers are `packages/lib/src/ai/clients/claude.ts:163` (`callClaude`, Node) and `supabase/functions/_shared/reliability.ts` (Deno, `fetchWithProviderTimeout`), parity-checked by `scripts/check-ai-retry-parity.mjs`. **Plain `fetch('https://api.anthropic.com…')` with no retry wrapper** at: `daily-cron/index.ts:934`, `grade-experiment-conclusion/index.ts:239`, `grade-written-answer/index.ts:139`, `ncert-question-engine/index.ts:587`, `grounded-answer/claude.ts:28` + `grounding-check.ts:22` (own client), `_shared/mol/grader.ts:52`, `_shared/mol/providers/anthropic.ts:8`, `packages/lib/src/foxy/quality-eval.ts:51`, `packages/lib/src/ai/validation/synthesis-quality-eval.ts:42`, `packages/lib/src/rag/pack-quality-oracle.ts:142` — 11 call sites. (`utils/anthropic.ts` named in the brief does not exist.) | grep |
| Edge Function logging with correlation id | 13 live functions log without any request/correlation id (01-inventory §1c). | edge-census.tsv |

## F. Screenshots / captures index (`audit/evidence/`)

`alfanumrik/*-m.png` (360×800) and `*-d.png` (1366×768) for 19 public/auth pages; `alfanumrik/protected-*.png` + `evidence-log.json` (final URL after 5 s for 29 protected routes, unauthenticated); `perf-results.json` (throttled Moto G4 vitals); `advisors-security.json`; `agent-api-routes.csv`; `edge-census.tsv`; `inbound-links.json`; `inventory.json`; `routes-table.md`; `connections-table.md`.
