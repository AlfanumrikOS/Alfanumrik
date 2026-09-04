# Alfanumrik Learning OS — Non-Negotiable Product Rules

## What This Is
Indian K-12 EdTech platform (CBSE grades 6-12). Next.js 16 + Supabase + Razorpay. 753 source files, 1 baseline migration + 349 archived in `supabase/migrations/_legacy/timestamped/` (post Section 10 cleanup, 2026-05-03), Supabase Edge Functions (count drifts constantly — see root `CLAUDE.md` for the measure-it commands; 48 on disk / 50 dirs as of 2026-08-01, not the 29 previously written here), Flutter mobile app. Serves students, parents, teachers, and administrators.

## Architecture Quick Reference

> **Constitution last reconciled: 2026-04-27.** Numbers in this file are point-in-time. To re-reconcile, run the production-readiness audit (see `docs/runbooks/audit-production-readiness.md`) or invoke the orchestrator with "audit production readiness".

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.2 App Router, React 18, Tailwind 3.4, SWR |
| Backend | Next.js API routes (280+ routes — last counted 2026-06-27) + Supabase Edge Functions (count drifts constantly — see root `CLAUDE.md` for the measure-it commands, not the stale "29" this row previously carried) |
| Auth | Supabase Auth (email/PKCE), session cookies via middleware |
| Database | Supabase Postgres, RLS (440+ policies), RBAC (6 roles, 71 permissions) |
| AI | Claude API (Haiku) via Supabase Edge Functions: ncert-solver, quiz-generator, cme-engine (unchanged) + Next.js route: foxy (`apps/host/src/app/api/foxy/route.ts` — replaced `foxy-tutor` Edge Function for web, retired 2026-07-01. **Foxy model routing (corrected 2026-08-31 — the 2026-08-12 entry below had gone stale since the 2026-08-26 swap; verified via `supabase/functions/grounded-answer/config.ts`, `MODEL_ROUTE_REV = 4`):** Claude-primary (`claude-haiku-4-5` → `claude-sonnet-4`) with OpenAI (`gpt-4o-mini` → `gpt-4o`) as automatic fallback — CEO-approved quality-driven provider swap BACK to Claude, 2026-08-26 (`MODEL_FALLBACK_ORDER`, reversing the 2026-08-02 OpenAI-primary swap this line used to describe). A rollback order back to OpenAI-primary exists behind `ff_foxy_openai_primary_rollout_v1`, seeded at 0% rollout — its array is still named `CLAUDE_PRIMARY_FALLBACK_ORDER` (stale name kept from before the 2026-08-26 swap; the array itself is OpenAI-primary, not Claude-primary). Treat "Claude Haiku" as Foxy's current primary model; ⚠️ 2026-07-13: `foxy-tutor` is still deployed AND still invoked by the Flutter app — repoint mobile before deleting. CORRECTION 2026-07-20 (verified in-source): the "still invoked by mobile" half is SUPERSEDED — `mobile/lib/core/constants/api_constants.dart:99-106` defaults `FOXY_ENDPOINT` to `'api'` (mobile POSTs to `/api/foxy`); the `_sendViaEdge` branch in `mobile/lib/data/repositories/chat_repository.dart` is documented dead code for old APKs. Deletion caution STANDS: old installed APKs may still hit the deployed function until forced upgrade — verify invocation metrics before deleting). **`quiz-generator/` is the only generator on disk.** CORRECTION 2026-07-13: the prior claim that `quiz-generator-v2` "was never created / never shipped" was false in production — the function WAS deployed and ACTIVE (reached v35, last hand-deployed ~2026-04), alongside a second orphan duplicate `enhanced-quiz-generator`. Both were tombstoned with structured 410s on 2026-07-13 (docs/runbooks/edge-function-drift-report.md execution log). Lesson: verify deployed state (`supabase functions list`) before asserting it in this constitution. |
| Payments | Razorpay (INR, monthly recurring + yearly one-time) |
| Deployment | Vercel (bom1/Mumbai), GitHub Actions CI/CD (3 workflows) |
| Testing | Vitest (~14,000+ tests, 869 files — last counted 2026-06-27), Playwright E2E (17 specs). **Regression catalog: see `.claude/regression/00-header.md` (the authoritative sharded catalog — 321 entries as of 2026-07-29, target 35 exceeded, latest REG-321). This cell used to hand-maintain the running history in prose and drifted stale more than once (it sat at "142" for a long stretch while the real count moved on); don't re-introduce that by editing a number here — read the header file instead.** Many P-invariants have direct unit/E2E tests that aren't yet promoted into the catalog — see "Regression catalog status by invariant" below. |
| Monitoring | Sentry (client/server/edge), Vercel Analytics, structured logging |
| Mobile | Flutter + Riverpod (/mobile) |
| Offline | Service worker, localStorage cache, background sync |

### Regression catalog status by P-invariant (reconciled 2026-04-29)

Status key: **catalogued** = explicit entry in `.claude/regression-catalog.md`; **tested-only** = unit/integration/E2E tests exist but no catalog entry; **no-coverage** = no enforcing test.

| Invariant | Status | Notes |
|---|---|---|
| P1 Score accuracy | catalogued | REG-45 (E2E happy-path), REG-51 (server-shuffle authority — server is the only re-deriver), REG-52 (production canary on `grounding.scoring`), REG-53 (Phase C integrity hash → tampered snapshot scores zero) |
| P2 XP economy | catalogued | REG-45 (E2E XP from server response, daily-cap copy), REG-48 (daily-cap clamp + SQL/TS literal parity drift detection + `atomic_quiz_profile_update` return-shape pin) |
| P3 Anti-cheat | partial | REG-40 catalogues remediation oracle-shape (defense-in-depth); REG-45 enforces 3-rule checks at the E2E layer; core 3-rule unit checks tested but not separately catalogued |
| P4 Atomic quiz submission | catalogued (partial) | REG-53 covers integrity-failure branch atomic with submit transaction; broader RPC parity test still tested-only |
| P5 Grade format | catalogued | SG-1..SG-6 cover grade-string contract end-to-end |
| P6 Question quality | catalogued | REG-39 (distractor index 0..3), REG-51 (snapshot isolation from mid-session edits), REG-53 (`options_version` monotonic stamp + SHA256 self-verifying snapshot), REG-54 (AI quiz-generator validation oracle — deterministic + LLM-grader gate before `question_bank` insert) |
| P7 Bilingual UI | catalogued (partial) | REG-134 pins the 6 new Loops-B/C notification producers to the bilingual house shape (top-level `message`/`body` EN + Hindi Devanagari in `data.*_hi`, no top-level `body_hi` column). No regression test yet enforces Hi/En parity on the broader critical-surface set |
| P8 RLS boundary | catalogued (partial) | SG covers governance service; REG-121 (Student Pulse cross-role data boundary — `canAccessStudent` is the single boundary on `/api/pulse/*`, no payload on any deny); REG-129 (the adaptive-remediation student lane reads `adaptive_interventions` only through the RLS-scoped server client); REG-131/REG-133 (Loops B & C rows ride the same RLS-scoped `adaptive_interventions` substrate as Loop A — the trigger_signal/chapter_number CHECK widenings in migration `20260619000500` are additive and leave the table's RLS posture unchanged); broader RLS policy coverage is tested-only via `rls-student-id-policies.test.ts` |
| P9 RBAC enforcement | catalogued (partial) | SG-3..SG-5 cover plan/stream gating; REG-120 (full RBAC matrix conformance — every role/permission/grant reproducible from one additive idempotent root migration); REG-127 (fail-closed cron auth before I/O); REG-134 (per-signal flag gating — `ff_adaptive_loops_bc_v1` OFF makes the B/C inject branches no-ops while Loop A keeps respecting its own `ff_adaptive_remediation_v1` flag). Note: PR #1020 removed 6 orphan permission codes that were in the TS registry but granted to no role (every enforcing route 403'd all non-super-admins) and repointed 7 routes to already-granted semantic twins — the matrix-conformance artifact was unaffected (the dead codes were never in the matrix) |
| P10 Bundle budget | tested-only | CI bundle-size check enforces; no catalog entry |
| P11 Payment integrity | catalogued | REG-46 (E2E payment funnel), REG-47 (atomic_plan_change atomicity — bulk plan-change route flows through RPC + advisory lock + audit row in single transaction; per-student isolation; static contract canary blocks direct table updates), REG-65 (P11-adjacent — landing-page pricing-verbatim drift; hallucinated `₹699` is a brand/legal risk even though no payment flows through AlfaBot) |
| P12 AI safety | catalogued | REG-37 (Voyage fallback), REG-39 (kill switch + cache), REG-50 (single-retrieval contract for Foxy — `retrieveChunks` ≤ 1 call/turn, cache short-circuits before retrieval), REG-54 (oracle gates AI hallucinations before `question_bank`), REG-66 (AlfaBot scope-lock — 4 hard-refusal categories enforced both client-prompt-side and server-side), REG-67 (AlfaBot model provenance — gpt-4o-mini stamped on alfabot_messages, audit_logs, and response envelope; user approval gate for model change), REG-75 (Voice 1b — Azure TTS voice catalog Indian-accent-only + SSML escape safety) |
| P13 Data privacy | catalogued | REG-46 (analytics payload redaction at E2E layer), REG-49 (Sentry client `beforeSend` redactor — user identity / headers / URL params / body / cookies / extra / contexts / breadcrumbs / tags all redacted before event leaves browser), REG-68 (AlfaBot audit-log PII boundary — `audit_logs.details` for any `alfabot.*` action carries metadata only, never message text / email / phone / name / raw IP), REG-121 (no student payload on any `/api/pulse/*` deny path), REG-127 (adaptive-remediation worker — counts-only responses, generic 500 body, metadata-only escalation audit), REG-129 (pulse-server whitelist suppresses row identifiers + PII keys; CTA analytics PII-free), REG-133 (metadata-only audit on every Loop C escalation — never matches `/name|email|phone/i`), REG-134 (the escalatedTo pulse-server whitelist for the 3 new escalated kinds suppresses identifiers + scheduling internals + PII-shaped keys; the 6 B/C notification producers carry no name/email/phone) |
| P14 Review chain completeness | n/a (process invariant) | Enforced by `review-chain.sh` hook + orchestrator Gate 5 |
| P15 Onboarding integrity | catalogued (partial) | REG-110/REG-111 (bootstrap Bearer fallback + link-status fail-soft); REG-117 (behavioral pin — `/auth/callback` PKCE + `/auth/confirm` token_hash both-flows handled, every branch redirects 3xx, never 500s the funnel). Structural + role-redirect helper coverage in `auth-callback-role-redirect.test.ts`; 3-role E2E gap remains |

REG-45 through REG-321 span the platform's full build history — quiz-authenticity phases, AlfaBot, Study Menu v2, Python AI service migration, Voice, mobile-parity waves, adaptive remediation Loops A-D, RBAC/RLS + Student Pulse hardening, CI pipeline-failure alerting, Digital Twin + Knowledge Graph, GenAI Phases 1-5, RAG shadow-confidence instrumentation, and the 2026-07-29 forensic-audit batch (REG-318 quiz-scoring RPC defects, REG-319 payment verify-route forgery fix, REG-320 reconcile-payments guard fix, REG-321 ncert-solver AI-safety backport). This paragraph was itemized entry-by-entry here through REG-134 and periodically summarized afterward, but hand-maintaining it kept going stale — this cell and the root `.claude/regression-catalog.md` pointer independently drifted to different wrong counts (142 and 256) before a 2026-07-29 reconciliation found the shards were already at 317. **`.claude/regression/00-header.md` and its 15 shard files are the only authoritative source — don't extend this paragraph with new entries, update the header file instead.**

## Critical File Map

> **MONOREPO PATH CORRECTION — added 2026-07-17 (monorepo migration; verified via Glob/Read on 2026-07-17).** The inline `src/…` paths in the table below (and elsewhere in this doc, plus older specs/runbooks) are STALE pre-monorepo aliases. This repo is now a monorepo (`apps/*` + `packages/*`) and there is **no `src/` at the repo root**. The *Area* labels, ownership, and every rule below remain accurate — only the path prefixes moved. Translate as follows:
>
> | Doc path (stale) | Actual location |
> |---|---|
> | `src/app/…` | `apps/host/src/app/…` — root `src/app/**` no longer exists. Student pages live under the `(student)` route group, e.g. the quiz page is `apps/host/src/app/(student)/quiz/page.tsx`. |
> | `src/app/api/…` | `apps/host/src/app/api/…` (e.g. Foxy route `apps/host/src/app/api/foxy/route.ts`) |
> | `src/lib/<x>` | source of truth (canonical implementation) at `packages/lib/src/<x>`; `apps/host/src/lib/<x>.ts` DOES exist but is a thin **2-line auto-generated re-export stub** (`export * from '../../../../packages/lib/src/<name>'`). **Edit `packages/lib/src/`, never the stub.** Import via the `@alfanumrik/lib/*` alias. Applies to `xp-rules`, `xp-config`, `cognitive-engine`, `razorpay`, `feature-flags`, `logger`, `analytics`, etc. |
> | `src/components/<x>` | shared UI moved to `packages/ui/src/<x>` (the `@alfanumrik/ui` package — canonical implementation); `apps/host/src/components/<x>` is a thin re-export stub. Quiz components (`QuizSetup`, `QuizResults`, `FeedbackOverlay`) live at `packages/ui/src/quiz/`. |
> | `src/proxy.ts`, `src/types/*` | `apps/host/src/proxy.ts`, `apps/host/src/types/*` |
> | `supabase/migrations/`, `supabase/functions/` | **UNCHANGED — still at repo ROOT.** They did NOT move under `apps/host/` (`apps/host/supabase/**` does not exist). |

| Area | Files |
|---|---|
| Quiz orchestrator | `apps/host/src/app/(student)/quiz/page.tsx` |
| Quiz components | `packages/ui/src/quiz/QuizSetup.tsx`, `QuizResults.tsx`, `FeedbackOverlay.tsx` |
| Scoring & XP | `packages/lib/src/xp-rules.ts` |
| Exam timing/presets | `packages/lib/src/exam-engine.ts` |
| Cognitive engine | `packages/lib/src/cognitive-engine.ts` |
| Feedback engine | `packages/lib/src/feedback-engine.ts` |
| Auth context | `packages/lib/src/AuthContext.tsx` |
| RBAC | `packages/lib/src/rbac.ts`, `packages/lib/src/usePermissions.ts` |
| Supabase clients | `packages/lib/src/supabase.ts`, `supabase-server.ts`, `supabase-admin.ts` |
| Admin auth | `packages/lib/src/admin-auth.ts` — `authorizeAdmin(request, level)` with ranked tiers `support(0) < analyst(1) < content_manager(2) < finance(3) < admin(4) < super_admin(5)`. This, **not** `authorizeRequest(permission)`, is the dominant `/api/super-admin/*` convention (99 routes vs 22, verified 2026-07-17). |
| NCERT ingestion pipeline | `scripts/ncert-ingestion/` (repo root) — see `scripts/ncert-ingestion/CLAUDE.md` for the full pipeline stages, the npm-script cwd mismatch, and the paid-API warning. |
| NCERT corpus — **content EXISTS, do not re-ingest blind** | **27,778 chunks** in `rag_content_chunks`, measured read-only against the production project on **2026-08-11**. This supersedes the ~**16,006** figure carried here from the 2026-07 audits, which was **73% low** — and since that is the number anyone would use to scope or fund a re-ingestion, understating it makes re-ingestion look more necessary than it is. **Do not quote it from memory — re-measure:** `GET /rest/v1/rag_content_chunks?select=id&limit=1` with a service-role `apikey` + `Authorization` and the request header `Prefer: count=exact`, then read the total after the `/` in the `Content-Range` response header (`0-0/27778`). Chapter coverage read **750 of 761** `cbse_syllabus` rows (~98.6%) at the 2026-07 audits and was **not** re-measured on 2026-08-11 — treat that one as unverified. The gap is *visibility*, not content. `rag_status='ready'` requires `chunk_count >= 50` AND `verified_question_count >= 40` (`recompute_syllabus_status()`), so a fully-ingested chapter still reads `'partial'` when its questions are merely unverified — **`'partial'` does not mean missing text.** Existing unsurfaced ledger: `ingestion_gaps` view (non-ready in-scope chapters + severity), `cbse_syllabus_rag_diagnostic` view (denormalized `chunk_count` vs actual, `sync_state='STALE'`), `subject_content_readiness_daily` table. |
| Feature flags | `packages/lib/src/feature-flags.ts`. Recently-seeded (all default OFF): `ff_school_pulse_v1` (Student/School Pulse), `ff_adaptive_remediation_v1` (Phase A Loop A closed loop), `ff_adaptive_loops_bc_v1` (Phase A Loops B & C — inactivity + at-risk-concentration; SEPARATE flag from Loop A, ramps independently — seed `20260619000600`). |
| Middleware | `apps/host/src/proxy.ts` (renamed from middleware.ts for Next.js 16; build-enforced by scripts/auth-guard.js) |
| Payments | `packages/lib/src/razorpay.ts`, `apps/host/src/app/api/payments/` |
| AI Edge Functions | `apps/host/src/app/api/foxy/route.ts` (Foxy Next.js route — active; replaced `foxy-tutor` Edge Function which was retired 2026-07-01), `supabase/functions/ncert-solver/`, `quiz-generator/`, `cme-engine/`. Foxy modes: `learn`, `explain`, `practice`, `revise`, `doubt`, `homework`, `explorer` (Pedagogy v2 Wave 2). (No `quiz-generator-v2/` — never existed on disk; constitution corrected 2026-05-04.) |
| Marking-authenticity forensic view | `supabase/migrations/20260504100400_marking_audit_view.sql` → `public.marking_audit_last_30d` (SECURITY INVOKER, service_role-only). Surfaces every `quiz_responses` row in the last 30 days where recorded `is_correct` disagrees with the per-session `quiz_session_shuffles` snapshot, OR where the snapshot is missing (Phase 1.2 silent-zero footprint). UUIDs only, no PII. Powers the super-admin Marking Integrity dashboard (frontend follow-up) and the nightly drift canary. Runbook: `docs/runbooks/forensic-quiz-investigation.md`. |
| Foxy Next.js Route | `apps/host/src/app/api/foxy/route.ts` (RAG+sonnet route — active, replaced `foxy-tutor` Edge Function 2026-07-01) |
| Foxy moat plan | Phases 0-5 shipped via PRs #399, #401-#405. Active: NCERT-grounded RAG (Voyage rerank-2 + RRF k=60), Foxy pedagogy decision tree, IRT 2PL nightly Vercel cron `/api/cron/irt-calibrate` at `50 2 * * *` (02:50 UTC daily, pinned by REG-44 in `vercel.json:33-36`; distinct from the unrelated pg_cron `daily-cron` job at 18:30 UTC in `supabase/migrations/20260404000002_pg_cron_daily.sql`), misconception curator at `/super-admin/misconceptions`. Dormant flags: `ff_irt_question_selection` (off until calibration accumulates). |
| IRT primitives | `packages/lib/src/irt/fisher-info.ts` — TS twin of `select_questions_by_irt_info` SQL RPC. Tested in `apps/host/src/__tests__/lib/irt/fisher-info.test.ts`. |
| Adaptive program — Loop A (closed loop) | `adaptive_interventions` table + RLS in migration `20260619000200_adaptive_interventions.sql`; flag seed `20260619000300_seed_ff_adaptive_remediation_v1.sql` (seeded OFF); teacher-dedupe index `20260619000400_teacher_remediation_dedupe_index.sql`. Cron worker: `apps/host/src/app/api/cron/adaptive-remediation/route.ts` (+ `_lib/subject-match.ts`), triggered thin from `supabase/functions/daily-cron/` (`triggerAdaptiveRemediation` step). Pure modules: `packages/lib/src/learn/remediation-queue-adapter.ts`, `packages/lib/src/learn/recovery-evaluation.ts`. Gated by `ff_adaptive_remediation_v1`; recovery thresholds reuse `PULSE_THRESHOLDS`. Pinned by REG-126..REG-129. Runbook: `docs/runbooks/adaptive-remediation-rollout.md`. Spec: `docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md`. (Loops B/C run on the same substrate — see the next row.) |
| Adaptive program — Loops B & C (inactivity + at-risk concentration) | Same `adaptive_interventions` substrate as Loop A, extended additively by migration `20260619000500_adaptive_interventions_extend_trigger_signal.sql` (widens the `trigger_signal` CHECK to add `inactivity`/`at_risk_concentration`; relaxes the `chapter_number` CHECK from `> 0` to `>= 0` for Loop B's `subject_code='_inactivity'`/chapter 0 sentinel — no new table/index/RLS change) + flag seed `20260619000600_seed_ff_adaptive_loops_bc_v1.sql` (`ff_adaptive_loops_bc_v1`, seeded OFF). Pure modules: `packages/lib/src/learn/adaptive-loops-rules.ts` (B/C constants, planners, cross-loop arbiter), `packages/lib/src/learn/inactivity-return-evaluation.ts` (Loop B return verify), `packages/lib/src/learn/concentration-resolution-evaluation.ts` (Loop C band-drop verify). The B/C inject/verify branches live in the existing Loop A cron worker `apps/host/src/app/api/cron/adaptive-remediation/route.ts` (gated by `ff_adaptive_loops_bc_v1`; verify drains active rows regardless of the flag). 6 new event kinds (`system.engagement_{nudged,returned,escalated}`, `system.concentration_{escalated,resolved,reescalated}`) declared in `packages/lib/src/state/events/registry.ts`. Gated by `ff_adaptive_loops_bc_v1`. Pinned by REG-131..REG-134. Runbook: `docs/runbooks/adaptive-program-rollout.md`. Spec: `docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md`. |
| Student Pulse | `packages/lib/src/pulse/` (`pulse-server.ts`, `signals.ts`, `types.ts`, `use-pulse.ts`); `packages/ui/src/pulse/`; `apps/host/src/app/api/pulse/` (`me`, `school`, `class/[classId]`, `student/[id]`). `canAccessStudent` is the single cross-role data boundary (no payload on any deny). Gated by `ff_school_pulse_v1` (seed `20260619000100_seed_ff_school_pulse_v1.sql`, default OFF). Pinned by REG-120..REG-122, REG-124. Spec: `docs/superpowers/specs/2026-06-12-rbac-conformance-and-student-pulse-design.md`. |
| Non-AI Edge Functions | `supabase/functions/daily-cron/`, `queue-consumer/`, `send-*-email/`, `session-guard/`, `scan-ocr/`. CORRECTION 2026-08-16 (Phase 0 super-admin audit): `export-report/` does not exist on disk (`ls supabase/functions/` has no such directory) and was removed from this row — do not re-add without verifying it was actually re-created. |
| Super admin panel | `apps/host/src/app/super-admin/` (**68 `page.tsx`**), `apps/host/src/app/api/super-admin/` (**121 `route.ts`**). Re-counted 2026-07-17 (`find … -name page.tsx \| wc -l`); supersedes the stale 2026-04-27 figure of 43 pages / 75 routes. Auth convention is `authorizeAdmin(request, level)` (99 routes) over `authorizeRequest(request, 'perm')` (22). |
| Support ticket operator console | **CORRECTED 2026-09-05** (this row previously described Phase 2 as "scheduled" for three weeks after it had already shipped — same night as Phase 0/1, 2026-08-16 22:34 IST). The live, current ticket queue is `/super-admin/support/tickets` (`apps/host/src/app/super-admin/support/page.tsx` is a *different*, non-ticket diagnostics page — don't confuse the two paths). It's a complete Phase 2 capability-parity implementation that consumes the same `/api/internal/admin/support` API verbatim as the legacy `/internal/admin` `SupportTab` (`apps/host/src/app/internal/admin/_components/SupportTab.tsx`) — no new backend route. `/internal/admin` itself is NOT yet retirable: only its Support tab has a `/super-admin` equivalent; the other 9 of its 10 tabs do not. See `docs/superpowers/specs/2026-08-16-super-admin-mission-control-design.md` (full roadmap; §5 notes Phase 1, the authz unification, is explicitly NOT complete — only 3 of ~100 routes migrated to `authorizeOperator`), `docs/superpowers/specs/2026-08-16-phase2-support-console-parity.md` (the parity analysis this page was built from), and `docs/runbooks/super-admin-orphaned-apis.md` (per-route keep/delete/wire dispositions for the ~19 low-caller `/api/super-admin/*` routes found during this work — several the Gate-2 build plan assumed were dead are actually explicitly "Wire in Phase N" or "Keep curl-only" by deliberate design, not orphans; only `reconciliation/*` was confirmed safe to delete and was removed 2026-09-05). |
| Parent portal | `apps/host/src/app/parent/` (**17 `page.tsx`** under `*parent*`, re-counted 2026-07-17; supersedes the stale "6 pages") |
| Teacher portal | `apps/host/src/app/teacher/` (**21 `page.tsx`** under `*teacher*`, re-counted 2026-07-17; supersedes the stale "8 pages") |
| Notifications | `apps/host/src/app/notifications/page.tsx`, daily-cron Edge Function |
| Migrations | `supabase/migrations/` — see `supabase/CLAUDE.md` for the exact recount commands (the number drifts constantly) and the schema-reproducibility runbook. |
| CI/CD | `.github/workflows/ci.yml`, `deploy-production.yml`, `deploy-staging.yml` |
| Mobile | `mobile/` (Flutter app) |
| SEO/PWA | `apps/host/src/app/sitemap.ts`, `public/manifest.json`, `public/sw.js`, `packages/ui/src/JsonLd.tsx` |
| Docs | `docs/` (5 operational docs), root `ARCHITECTURE.md`, `LAUNCH_CHECKLIST.md` |

## Product Invariants
These rules cannot be overridden by any agent. Violating any is a blocking defect.

### P1: Score Accuracy
```
score_percent = Math.round((correct_answers / total_questions) * 100)
```
Identical results in `submitQuizResults()`, `QuizResults.tsx`, and the `atomic_quiz_profile_update()` RPC. No agent may change this formula without user approval.

### P2: XP Economy
```
xp_earned = (correct * XP_RULES.quiz_per_correct)
          + (score_percent >= 80 ? XP_RULES.quiz_high_score_bonus : 0)
          + (score_percent === 100 ? XP_RULES.quiz_perfect_bonus : 0)
```
All XP constants in `src/lib/xp-rules.ts`. No hardcoded XP values elsewhere. Daily quiz cap: 200 XP. Level: 500 XP.

### P3: Anti-Cheat
Three checks, client-side and server-side: (1) minimum 3s avg per question, (2) not all same answer index if >3 questions, (3) response count equals question count.

### P4: Atomic Quiz Submission
Quiz results via `atomic_quiz_profile_update()` RPC (single transaction). Separate operations only as logged fallback.

### P5: Grade Format
Grades are strings `"6"` through `"12"`. Never integers. In database, RPCs, APIs, and TypeScript.

### P6: Question Quality
Every served question: non-empty text (no `{{`/`[BLANK]`), exactly 4 distinct non-empty options, `correct_answer_index` 0-3, non-empty explanation, valid difficulty and bloom_level.

### P7: Bilingual UI
All user-facing text supports Hindi and English via `AuthContext.isHi`. Technical terms (CBSE, XP, Bloom's) not translated.

### P8: RLS Boundary
Client code never bypasses RLS. `supabase-admin.ts` is server-only. Every new table gets RLS + policies in the same migration.

### P9: RBAC Enforcement
API routes use `authorizeRequest(request, 'permission.code')`. Client `usePermissions()` is UI convenience, not security.

### P10: Bundle Budget
Shared JS < 175 kB (temporary; baseline 160 kB). Pages < 260 kB. Middleware < 120 kB. Target: Indian 4G (2-5 Mbps).

Cap-raise rationale (2026-05-04, user-approved per PR #529): React 19 + Turbopack baseline drift pushed the 6 framework chunks measured by scripts/check-bundle-size.mjs from ~155 kB to 168.5 kB between PR #513's morning CI run and end-of-day. Architect investigation confirmed zero application code or third-party libs in the measured chunks. The script's "shared" definition is also artificially narrow — it ignores ~57 kB of layout-level chunks (Supabase auth client, etc.) so the real first-paint shared cost is ~225 kB. Two follow-ups tracked: (a) lazy-load PostHogProvider via next/dynamic; (b) rewrite measureShared() to count layout chunks. Once both land, restore the cap to 160 kB.

Two distinct caps exist in `scripts/check-bundle-size.mjs` — do not conflate them:
- `SHARED_JS_LIMIT_KB` / the **160 kB** number above = the single-largest-shared-chunk metric (the narrow "6 framework chunks" view). Unchanged; passes.
- `CAP_SHARED_KB` = the **authoritative first-load total**, layout-chunk-inclusive (the honest HTML-scan measurement, which counts the ~57 kB of `@supabase/*` AuthContext chunks every page pulls on first paint). This is the gate that fails on framework drift.

`CAP_SHARED_KB` history: 270 → 275 (2026-05-08, dep-bump drift) → 275 → 280 (2026-06-12, CEO-approved) → 280 → 282 (2026-06-21, activation-funnel PR) → 282 → 284 (2026-06-26, Foxy RCA + Digital Twin Slice 1 merge) → 284 → 289 (2026-07-10, CI baseline drift on PR #1238 with no production-JS diff) → **289 → 297 (2026-08-16, CEO-approved)**. The 275→280 raise absorbs 1.8 kB of pure framework baseline drift (React + react-dom + `@supabase/*` via the root-layout AuthContext + Next runtime), confirmed NOT app bloat by the load-readiness audit and bundle-composition analysis. It passes locally (274.1 < 275) but CI measures 276.8 kB from a ~2.7 kB OS/gzip environment delta; each subsequent bump was confirmed NOT app bloat. On 2026-07-10 the authoritative HTML-scan gate measured 286.6 kB / 284 kB on a branch that changed docs plus integration-test gating only, while the older single-shared-chunk check still passed; 289 kB restores narrow headroom without changing the durable fix. The 289→297 raise (2026-08-16) is different in kind from the six before it: CI measured 294.6 kB on `chore/prod-readiness-dependencies`, traced to `@supabase/ssr` 0.12.0→0.12.4 forcing a peer-dependency floor bump of `@supabase/supabase-js`/`auth-js`/`realtime-js` 2.108.2→2.112.3, plus Next.js 16.2.6→16.3.1 framework drift — landed incidentally via a lockfile-only commit (`f649cffa5`) rather than a deliberate version bump. Unlike the prior six raises, this one has an identified, avoidable contributor (pinning `@supabase/ssr` back would likely have recovered the overage without moving the cap); CEO explicitly chose to raise the cap rather than pin the dependency back. PostHog is already lazy (PR #534). Durable fix = split `@supabase/*` out of first paint via an AuthContext client-only boundary (~57 kB, P15-touching, tracked as a follow-up); restore toward the 160 kB baseline once it lands. **Current enforced cap: 297 kB** (mirrors `scripts/check-bundle-size.mjs`'s `CAP_SHARED_KB` constant).

### P11: Payment Integrity
Razorpay webhook signature MUST be verified before processing any payment event. Subscription status changes MUST be written atomically with the payment record. Never grant plan access without verified payment.
Implementation status: split-brain risk is closed. The webhook (`src/app/api/payments/webhook/route.ts`) calls only RPCs — never two separate UPDATE statements. Primary path is `activate_subscription`; on failure it falls back to `atomic_subscription_activation` (single transaction across `students` + `student_subscriptions`, migration `20260424120000`). Both RPCs failing returns HTTP 503 so Razorpay retries. The `ff_atomic_subscription_activation` feature flag (migration `20260425140500`) gates the atomic fallback off if needed (then 503 immediately). Event-level idempotency lives in `payment_webhook_events` (unique on razorpay_event_id). Verify-route + webhook contention is serialized via `pg_advisory_xact_lock` keyed by student_id.

### P12: AI Safety
AI responses (foxy-tutor, ncert-solver) MUST be age-appropriate for grades 6-12. No unfiltered LLM output to students. Responses must stay within CBSE curriculum scope. Daily usage limits enforced per plan.

### P13: Data Privacy
No PII in client-side logs or Sentry events. Logger redacts: password, token, email, phone, API keys. Student data accessible only to: the student, their linked parent, their assigned teacher, or admin via service role.

### P15: Onboarding Integrity
The signup→verification→profile→dashboard funnel MUST never break. This is the #1 user acquisition path. Non-negotiable rules:
1. `send-auth-email` Edge Function MUST return HTTP 200 on ALL code paths (Supabase blocks signup on non-200).
2. Profile creation uses a 3-layer failsafe: client insert → `/api/auth/bootstrap` server fallback → `AuthContext` runtime fallback. All three layers must remain intact.
3. Auth callback routes (`/auth/callback`, `/auth/confirm`) MUST handle both PKCE and token_hash flows.
4. The `bootstrap_user_profile` RPC MUST be idempotent (safe to call multiple times via ON CONFLICT).
5. Onboarding works for ALL three roles: student (grade/board selection), teacher (school/subjects), parent (phone/link code).
6. Email verification links MUST use `SITE_URL` from Edge Function secrets, never hardcoded.
Critical files: `AuthScreen.tsx`, `auth/callback/route.ts`, `auth/confirm/route.ts`, `api/auth/bootstrap/route.ts`, `AuthContext.tsx`, `onboarding/page.tsx`, `send-auth-email/index.ts`, `lib/identity/`.

### P14: Review Chain Completeness
When a critical file is modified, mandatory downstream reviewers must be invoked before the task can be marked complete. The PostToolUse hook (`review-chain.sh`) injects reminders automatically. Orchestrator validates at Gate 5. Quality rejects if chains are incomplete. The full matrix is defined in `.claude/skills/review-chains/SKILL.md`.

Summary of mandatory chains:
| Change | Making Agent | Must Review |
|---|---|---|
| Grading/XP constants | assessment | testing, ai-engineer, backend, frontend, **mobile** |
| Learner-state rules | assessment | ai-engineer, frontend, testing |
| AI tutor behavior | ai-engineer | assessment, testing |
| RAG/retrieval | ai-engineer | assessment, testing |
| Quiz generation | ai-engineer | assessment, testing |
| RBAC/auth | architect | backend, frontend, ops, testing |
| Onboarding/signup flow | architect | backend, frontend, testing (E2E for all 3 roles) |
| Payment flow | backend | architect, testing, **mobile** |
| Deployment config | architect | ops, testing |
| Anti-cheat thresholds | assessment + architect | backend, testing |
| Notification types | backend | frontend, ops |
| Super-admin reporting APIs | backend (per ops) | frontend, ops, assessment (if learner), testing |
| CMS workflow | backend (per ops) | assessment, frontend, testing |
| Admin user/role APIs | backend (per ops/architect) | architect, frontend, testing |
| Feature flag API | ops or backend | ops, testing |
| Super-admin pages | frontend | ops, testing |

## Enforcement Mechanisms

### Mechanically Enforced (hooks — cannot be bypassed by agents)
| Hook | Event | File | What It Enforces |
|---|---|---|---|
| Write Guard | PreToolUse (Edit\|Write) | `guard.sh` | 9 blocking + 5 warning rules: agent ownership by file path |
| Bash Guard | PreToolUse (Bash) | `bash-guard.sh` | Blocks sed/awk/echo bypass of protected files, destructive git ops, secret exposure, warns on direct deploys |
| Review Chain | PostToolUse (Edit\|Write) | `review-chain.sh` | 20 file patterns → mandatory downstream reviewer reminders |
| Content Check | PostToolUse (Edit\|Write) | `post-edit-check.sh` | Detects: hardcoded secrets, NEXT_PUBLIC_ secret exposure, console.log in prod, hardcoded XP values, integer grades, missing RLS on new tables, DROP TABLE/COLUMN |

### Advisory (agent prompt rules — followed by discipline, not mechanical force)
- Orchestrator Gate 5: review chain completion validation
- Quality veto: code review verdict
- Agent rejection conditions: per-agent rules
- Product invariant compliance: P1-P14 checks
- Regression catalog gap reporting

## Agent System
10 agents. Auto-delegation is the default mode. The orchestrator is the default session agent (`settings.json: "agent": "orchestrator"`). Every request goes to the orchestrator, which automatically spawns the minimum required specialist agents.

**Builders**: architect, frontend, backend, assessment, ai-engineer, mobile
**Verifiers**: testing (after every change), quality (before every commit)
**Operator**: ops
**Coordinator**: orchestrator (default session agent, auto-delegates)

### Auto-Delegation Sequence
```
User request → orchestrator (classifies, routes)
  → spawns builder agents in parallel where independent
  → spawns testing after builders complete
  → spawns quality as final reviewer
  → reports results to user
```

### Agent Selection (orchestrator uses these rules)
| Request mentions... | Spawn |
|---|---|
| database, migration, schema, RLS, RBAC, auth, middleware, deploy, CI | architect |
| page, component, UI, styling, layout, Tailwind, loading state, i18n | frontend |
| API route, endpoint, webhook, payment, Razorpay, notification, cron | backend |
| score, XP, quiz logic, Bloom's, CBSE, exam, grading, mastery, question bank | assessment |
| Foxy, AI tutor, NCERT solver, RAG, prompt, Claude API, cme-engine | ai-engineer |
| mobile, Flutter, Dart, Play Store, mobile sync | mobile |
| super admin, analytics, feature flag, monitoring, docs, support ticket | ops |
| test, coverage, regression, E2E, Vitest, Playwright | testing |
| review, type-check, lint, build quality, code quality, UX audit | quality |

### When Multiple Agents Are Needed
Many tasks span agents. The orchestrator decomposes and sequences:
- **New feature**: architect (schema) → backend (API) → frontend (UI) → testing → quality
- **Quiz bug fix**: assessment (define correct behavior) → frontend (fix UI) → testing → quality
- **Payment change**: backend (implement) + architect (security review) → testing → quality → mobile (sync check)
- **AI tutor change**: ai-engineer (implement) + assessment (correctness review) → testing → quality

### Domain Ownership (30 domains → 9 agents)

| # | Domain | Owner | Reviewer | Approver |
|---|---|---|---|---|
| 1 | Founder/CEO decision support | orchestrator (synthesizes metrics for user) | — | user |
| 2 | Product strategy | orchestrator (surfaces options, user decides) | — | user |
| 3 | Project management | orchestrator | — | — |
| 4 | CTO / architecture | architect | quality | user (for breaking changes) |
| 5 | Backend engineering | backend | architect (auth); quality | — |
| 6 | Frontend engineering | frontend | quality; assessment (quiz UI) | — |
| 7 | Full-stack integration | orchestrator (validates contracts in handoffs) | quality | — |
| 8 | Database engineering | architect | quality | user (for DROP ops) |
| 9 | Supabase architecture | architect | quality | — |
| 10 | RBAC and auth | architect | quality | user (for role/perm additions) |
| 11 | Security and privacy | architect | quality | — |
| 12 | DevOps | architect | quality | — |
| 13 | Deployment and release engineering | architect | quality; ops (operational impact) | — |
| 14 | Testing and QA | testing | quality | — |
| 15 | Performance and scalability | architect (infra) + quality (code) | — | — |
| 16 | Analytics and reporting | ops | quality | — |
| 17 | Super admin reporting system | ops | quality | — |
| 18 | AI/LLM orchestration | ai-engineer | assessment (correctness); quality | user (model changes) |
| 19 | Vector embeddings | ai-engineer | quality | — |
| 20 | RAG pipeline | ai-engineer | assessment (retrieval correctness); quality | — |
| 21 | Retrieval quality | ai-engineer (implementation) + assessment (validation) | quality | — |
| 22 | Learning graph / learner state | assessment (rules) + ai-engineer (implementation) | quality | — |
| 23 | CBSE pedagogy and academic correctness | assessment | quality | user (new subject additions) |
| 24 | Assessment / grading / progress logic | assessment | testing; quality | user (P1-P6 changes) |
| 25 | Parent-student mapping | backend (server logic) + frontend (UI) + architect (schema/RLS) | quality | — |
| 26 | Notifications / communication | backend | quality | — |
| 27 | Support / grievances / escalation | ops | quality | — |
| 28 | UX audit | quality | — | — |
| 29 | Content QA | assessment | quality | — |
| 30 | Monitoring / incidents / rollback readiness | ops | architect (infra); quality | — |
| 31 | Mobile app (Flutter) | mobile | quality; assessment (XP sync) | — |
| 32 | Mobile-web API contract sync | mobile (verifies) + backend (implements) | quality | — |

### Reporting Chain

Status reports (product health, system health, release readiness, risk register, academic integrity, AI health, support status) are covered by the `status-report` skill (`.claude/skills/status-report/SKILL.md`), which has the full reporting-chain diagram and the super-admin metrics-by-category table. Short version: orchestrator synthesizes per-agent output — architect, frontend, backend, assessment, ai-engineer, testing, quality, ops — into those seven categories for the user.

### User Approval Required For
- Changes to product invariants P1-P13
- New subscription plans or pricing changes
- RBAC role or permission additions
- Migrations that drop tables or columns
- AI model or provider changes
- New CBSE subject additions
- Changes to the agent system itself

### Autonomous Decisions (no user approval needed)
- Bug fixes within existing behavior
- Test additions
- Code refactoring that doesn't change behavior
- Documentation updates
- Feature flag toggles
- Performance optimizations within existing architecture
- Content quality fixes (fixing a wrong answer, improving an explanation)

## Default Autonomous Operating Loop

The standard execution cycle (understand -> classify -> delegate -> gate -> approve-if-needed -> execute -> report) is fully specified in the `run` skill (`.claude/skills/run/SKILL.md`). It runs automatically for every `/run` command and should be followed by the orchestrator for any direct request even without an explicit `/run`.

### Compact Report Format
Every task ends with this output. Keep it to this structure — no extra prose. **This exact shape is required, not just a suggestion:** `.claude/hooks/verify_before_stop.py` (the Stop hook) hardcodes these marker strings to detect that a report was produced, then cross-checks any Tests:/Build: claims against real tool-call evidence from the transcript. A differently-shaped report — including the `run` skill's own, more detailed "Execution Report" template — will not be recognized, silently skipping that check.
```
## Done: [one sentence]
Agents: [list who ran]
Files: [n] changed | Tests: [pass]/[total] | Build: PASS/FAIL
Catalog: [n]/35 regressions exist | Gaps: [areas]
Chains: [n] complete, [n] pending
Approval: not needed | needed for [reason]
Commit: [hash] on [branch] | ready to merge: YES/NO
```

## Build Commands
```
npm run dev          # Local dev server
npm run build        # Production build
npm run type-check   # TypeScript validation across workspaces (--workspaces --if-present); does NOT cover workspace-less dirs
npm run type-check:scripts  # TypeScript validation for repo-root scripts/ (no workspace; own tsconfig.scripts.json)
npm test             # Vitest (~14,000+ tests, 869 files)
npm run test:e2e     # Playwright E2E
npm run lint         # ESLint
npm run analyze      # Bundle analysis
```
