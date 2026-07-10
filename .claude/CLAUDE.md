# Alfanumrik Learning OS — Non-Negotiable Product Rules

## What This Is
Indian K-12 EdTech platform (CBSE grades 6-12). Next.js 16 + Supabase + Razorpay. 753 source files, 1 baseline migration + 349 archived in `supabase/migrations/_legacy/timestamped/` (post Section 10 cleanup, 2026-05-03), 29 Supabase Edge Functions, Flutter mobile app. Serves students, parents, teachers, and administrators.

## Architecture Quick Reference

> **Constitution last reconciled: 2026-04-27.** Numbers in this file are point-in-time. To re-reconcile, run the production-readiness audit (see `docs/runbooks/audit-production-readiness.md`) or invoke the orchestrator with "audit production readiness".

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.2 App Router, React 18, Tailwind 3.4, SWR |
| Backend | Next.js API routes (280+ routes — last counted 2026-06-27) + Supabase Edge Functions (29 functions) |
| Auth | Supabase Auth (email/PKCE), session cookies via middleware |
| Database | Supabase Postgres, RLS (440+ policies), RBAC (6 roles, 71 permissions) |
| AI | Claude API (Haiku) via Supabase Edge Functions: ncert-solver, quiz-generator, cme-engine + Next.js route: foxy (`src/app/api/foxy/route.ts` — replaced `foxy-tutor` Edge Function, retired 2026-07-01). **`quiz-generator/` is the only generator** — the historical `quiz-generator-v2/` directory was never created on disk; the constitution previously referenced a planned-but-not-shipped fork. Removed 2026-05-04 (Marking-Authenticity Wave 4). |
| Payments | Razorpay (INR, monthly recurring + yearly one-time) |
| Deployment | Vercel (bom1/Mumbai), GitHub Actions CI/CD (3 workflows) |
| Testing | Vitest (~14,000+ tests, 869 files — last counted 2026-06-27), Playwright E2E (17 specs). **Regression catalog: 142 entries catalogued (target: 35 — TARGET EXCEEDED; this cell's running list below was last reconciled through REG-134 — `.claude/regression-catalog.md` is authoritative and now reads 142, latest REG-175 Digital Twin + Knowledge Graph Slice 1). REG-56..REG-64 added 2026-05-04 (Marking-Authenticity Wave 5); REG-65..REG-68 added 2026-05-19 (AlfaBot v1); REG-69 added 2026-05-20 (Study Menu v2); REG-70..REG-71 added 2026-06-03 (MoL Phase 1A admin-functions rollback flag + oracle grader bypass); REG-72 added 2026-05-24 (Python AI service health contract — Phase 0 Cloud Run migration); REG-73..REG-74 added 2026-05-24 (Python AI Phase 1 — request/response parity + cutover kill-switch); REG-75 added 2026-05-24 (Voice 1b — Azure Indian-accent TTS voice catalog + SSML escape safety); REG-90 added 2026-06-07 (mobile APK-compile / Android toolchain-drift gate); REG-91 added (Phase 2 Wave 2.5 — offline quiz replay invariant safety: P1/P2/P3/P6/P13); REG-115..REG-116 added 2026-06-12 (Phase 5 — dashboard per-student cache P13 isolation + internal-admin secret-gate enforcement); REG-117 added 2026-06-12 (Phase 4 OAuth/parent-link cluster — parent↔child approve-link boundary P8/P13 + auth-callback funnel resilience P15); REG-118 added 2026-06-12 (daily-cron static-source contract canary — P11-adjacent + operational-integrity); REG-119 added 2026-06-12 (Phase 4 final cluster — high-blast-radius mutation-route gate pins: P9 + P13); REG-120..REG-122 added 2026-06-12 (RBAC matrix conformance + Student Pulse cross-role boundary + signal derivation: P8/P13/P-learner-state); REG-124 added 2026-06-12 (`ff_school_pulse_v1` flag-gate default-OFF — REG-123 id taken by renumbered Foxy-OS entry); REG-125 added 2026-06-12 (feature_flags seed-shape conformance — staging-sync wall closure, PR #1014); REG-126..REG-129 added 2026-06-13 (Phase A Loop A adaptive-remediation closed loop — state machine, cron-worker posture, B2B escalation attribution, student-facing lane); REG-130 added 2026-06-12 (CI pipeline-failure alerting — out-of-band `workflow_run` watcher, watched-name byte-equality, dedupe + self-heal, PR #1015); REG-131..REG-134 added 2026-06-13 (Phase A Loops B & C — closed-loop state machines + drain-not-freeze, cross-loop arbiter ≤1/student/day precedence A>C>B + A↔C coexistence, Loop C escalate-at-inject + two-beat re-escalation + B2B/B2C + 23505 dedupe, Loop B nudge→return→parent-escalation + per-signal flag gating + the 6 notification producers + escalatedTo whitelist: P5/P7/P8/P9/P13); see `.claude/regression-catalog.md`.** Many P-invariants have direct unit/E2E tests that aren't yet promoted into the catalog — see "Regression catalog status by invariant" below. |
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

Round 2 audit promotions (atomic_plan_change atomicity, daily XP cap, Sentry client PII redaction, single-retrieval contract for Foxy) shipped as REG-47, REG-48, REG-49, REG-50. Phase A/B/C quiz-authenticity work shipped as REG-51, REG-52, REG-53. AI quiz-generator validation oracle shipped as REG-54. Foxy structured rendering envelope shipped as REG-55 (2026-05-02). Marking-Authenticity Wave 5 shipped as REG-56..REG-64 (2026-05-04). AlfaBot v1 landing-page widget shipped as REG-65..REG-68 (2026-05-19). Study Menu v2 consolidation shipped as REG-69 (2026-05-20). MoL Phase 1A admin-functions rollback flag + oracle grader bypass shipped as REG-70..REG-71 (2026-06-03). Python AI service health contract shipped as REG-72 (2026-05-24, Phase 0 Cloud Run migration). Python AI Phase 1 request/response parity + cutover kill-switch shipped as REG-73..REG-74 (2026-05-24). Voice 1b — Azure Indian-accent TTS voice-catalog + SSML-escape safety shipped as REG-75 (2026-05-24). REG-76..REG-89 shipped across subsequent waves (generate-concepts, Voice 2, Cosmic redesign, Consumer Minimalism Waves A–D, Phase 2 mobile-parity contract Waves 2.2–2.4). Mobile APK-compile / Android toolchain-drift gate shipped as REG-90 (2026-06-07). Offline quiz replay invariant safety (Phase 2 Wave 2.5 — P1/P2/P3/P6/P13) shipped as REG-91. Phase 5 per-student cache isolation + internal-admin secret gate shipped as REG-115..REG-116. Phase 4 OAuth/parent-link cluster (parent↔child approve-link boundary + auth-callback funnel resilience) shipped as REG-117 (2026-06-12). daily-cron static-source contract canary (fail-closed CRON_SECRET auth gate + 14 step/helper pairs + `Promise.allSettled` per-step isolation + flag-gated monthly-synthesis/school-contract steps) shipped as REG-118 (2026-06-12). High-blast-radius mutation-route gate pins (7 routes — privilege/tenant elevation, abuse-blocklist, OAuth client-secret issuance, bulk student-PII export, destructive + dead-letter replay; exact tier/permission pinned + deny short-circuits before DB I/O) shipped as REG-119 (2026-06-12). RBAC matrix conformance (single additive idempotent root migration covers every role/permission/grant + resource-access rule) + Student Pulse cross-role data boundary (`canAccessStudent` is the single data boundary on `/api/pulse/*`, no payload on any deny) + Pulse signal derivation (inactivity/mastery-cliff/at-risk-concentration anchored to existing platform conventions) shipped as REG-120..REG-122 (2026-06-12). `ff_school_pulse_v1` flag-gate default-OFF (School Pulse cannot reach a school admin until an operator flips the DB flag — pinned in code, seed, render guard) shipped as REG-124 (2026-06-12; REG-123 id was taken by the renumbered Foxy-OS entry). feature_flags seed-shape conformance (schema-adaptive `flag_name` insert canary that turns the staging-sync wall into a PR-CI failure) shipped as REG-125 (2026-06-12, PR #1014). Phase A Loop A adaptive-remediation closed loop — the platform's first autonomous detect→remediate→verify→escalate loop, all gated behind `ff_adaptive_remediation_v1` (seeded OFF) — shipped as REG-126 (closed-loop state machine — drain-not-freeze kill switch, affirmative-evidence recovery, escalation completeness), REG-127 (cron-worker posture — fail-closed auth before I/O, counts-only responses, metadata-only audit), REG-128 (B2B escalation attribution — subject-match tiering + cross-teacher 23505 idempotency), REG-129 (student-facing lane — capped/killable/bilingual) (2026-06-13). CI pipeline-failure alerting shipped as REG-130 (2026-06-12, PR #1015 — an out-of-band `workflow_run`-triggered watcher opens/closes a GitHub issue when a watched pipeline concludes `failure`/recovers; watched-name byte-equality invariant, at-most-one-open-issue dedupe, self-heal on the next green run, `issues:write`-only scope). Phase A Loops B & C — inactivity re-engagement (Loop B) + at-risk-concentration escalation (Loop C) on the SAME `adaptive_interventions` substrate, gated behind the SEPARATE `ff_adaptive_loops_bc_v1` flag (seeded OFF; ramps independently of Loop A's flag) — shipped as REG-131 (B & C closed-loop state machines — independent, cannot double-fire/freeze/false-resolve, and DRAIN regardless of the flag; Loop B sentinel triple `_inactivity`/chapter 0, Loop C band-drop resolution), REG-132 (cross-loop arbiter — ≤1 NEW intervention per student per night, precedence A>C>B independent of input order, A↔C subject coexistence, deterministic tie-break), REG-133 (Loop C escalate-AT-inject + two-beat re-escalation — B2B teacher-assignment reuse / B2C parent / neither, no-half-escalation abort, 23505 dedupe), REG-134 (Loop B nudge→return→parent-escalation + per-signal flag gating + the 6 new notification producers + the escalatedTo P13 whitelist for the 3 new escalated kinds) (2026-06-13; REG-131..134 are the next free ids after Loop A's REG-126..129). Digital Twin + Knowledge Graph (Slice 1, Waves 1-2) — flag-gated learner digital twin (concept_edges unified prereq graph + learner_twin_snapshots/learner_twin_memory + traverse_prerequisites/detect_blocked_dependents RPCs) and Loop D blocked-prerequisite (precedence A>D>C>B), all behind the default-OFF `ff_digital_twin_v1` — shipped as REG-175 (prerequisite-block classifier strict-floor boundaries + cross-loop arbiter A>D>C>B + buildTwinContext purity/PII + flag-OFF gating + Edge-reader fail-CLOSED, 2026-07-02; REG-170 remains the intentionally skipped gap, so REG-175 is the next free id after REG-174). This narrative line was last reconciled through REG-134; the authoritative running count lives in `.claude/regression-catalog.md`, which now reads **142 entries (target: 35 — TARGET EXCEEDED).**

## Critical File Map
| Area | Files |
|---|---|
| Quiz orchestrator | `src/app/quiz/page.tsx` |
| Quiz components | `src/components/quiz/QuizSetup.tsx`, `QuizResults.tsx`, `FeedbackOverlay.tsx` |
| Scoring & XP | `src/lib/xp-rules.ts` |
| Exam timing/presets | `src/lib/exam-engine.ts` |
| Cognitive engine | `src/lib/cognitive-engine.ts` |
| Feedback engine | `src/lib/feedback-engine.ts` |
| Auth context | `src/lib/AuthContext.tsx` |
| RBAC | `src/lib/rbac.ts`, `src/lib/usePermissions.ts` |
| Supabase clients | `src/lib/supabase.ts`, `supabase-server.ts`, `supabase-admin.ts` |
| Admin auth | `src/lib/admin-auth.ts` |
| Feature flags | `src/lib/feature-flags.ts`. Recently-seeded (all default OFF): `ff_school_pulse_v1` (Student/School Pulse), `ff_adaptive_remediation_v1` (Phase A Loop A closed loop), `ff_adaptive_loops_bc_v1` (Phase A Loops B & C — inactivity + at-risk-concentration; SEPARATE flag from Loop A, ramps independently — seed `20260619000600`). |
| Middleware | `src/proxy.ts` (renamed from middleware.ts for Next.js 16; build-enforced by scripts/auth-guard.js) |
| Payments | `src/lib/razorpay.ts`, `src/app/api/payments/` |
| AI Edge Functions | `src/app/api/foxy/route.ts` (Foxy Next.js route — active; replaced `foxy-tutor` Edge Function which was retired 2026-07-01), `supabase/functions/ncert-solver/`, `quiz-generator/`, `cme-engine/`. Foxy modes: `learn`, `explain`, `practice`, `revise`, `doubt`, `homework`, `explorer` (Pedagogy v2 Wave 2). (No `quiz-generator-v2/` — never existed on disk; constitution corrected 2026-05-04.) |
| Marking-authenticity forensic view | `supabase/migrations/20260504100400_marking_audit_view.sql` → `public.marking_audit_last_30d` (SECURITY INVOKER, service_role-only). Surfaces every `quiz_responses` row in the last 30 days where recorded `is_correct` disagrees with the per-session `quiz_session_shuffles` snapshot, OR where the snapshot is missing (Phase 1.2 silent-zero footprint). UUIDs only, no PII. Powers the super-admin Marking Integrity dashboard (frontend follow-up) and the nightly drift canary. Runbook: `docs/runbooks/forensic-quiz-investigation.md`. |
| Foxy Next.js Route | `src/app/api/foxy/route.ts` (RAG+sonnet route — active, replaced `foxy-tutor` Edge Function 2026-07-01) |
| Foxy moat plan | Phases 0-5 shipped via PRs #399, #401-#405. Active: NCERT-grounded RAG (Voyage rerank-2 + RRF k=60), Foxy pedagogy decision tree, IRT 2PL nightly Vercel cron `/api/cron/irt-calibrate` at `50 2 * * *` (02:50 UTC daily, pinned by REG-44 in `vercel.json:33-36`; distinct from the unrelated pg_cron `daily-cron` job at 18:30 UTC in `supabase/migrations/20260404000002_pg_cron_daily.sql`), misconception curator at `/super-admin/misconceptions`. Dormant flags: `ff_irt_question_selection` (off until calibration accumulates). |
| IRT primitives | `src/lib/irt/fisher-info.ts` — TS twin of `select_questions_by_irt_info` SQL RPC. Tested in `src/__tests__/lib/irt/fisher-info.test.ts`. |
| Adaptive program — Loop A (closed loop) | `adaptive_interventions` table + RLS in migration `20260619000200_adaptive_interventions.sql`; flag seed `20260619000300_seed_ff_adaptive_remediation_v1.sql` (seeded OFF); teacher-dedupe index `20260619000400_teacher_remediation_dedupe_index.sql`. Cron worker: `src/app/api/cron/adaptive-remediation/route.ts` (+ `_lib/subject-match.ts`), triggered thin from `supabase/functions/daily-cron/` (`triggerAdaptiveRemediation` step). Pure modules: `src/lib/learn/remediation-queue-adapter.ts`, `src/lib/learn/recovery-evaluation.ts`. Gated by `ff_adaptive_remediation_v1`; recovery thresholds reuse `PULSE_THRESHOLDS`. Pinned by REG-126..REG-129. Runbook: `docs/runbooks/adaptive-remediation-rollout.md`. Spec: `docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md`. (Loops B/C run on the same substrate — see the next row.) |
| Adaptive program — Loops B & C (inactivity + at-risk concentration) | Same `adaptive_interventions` substrate as Loop A, extended additively by migration `20260619000500_adaptive_interventions_extend_trigger_signal.sql` (widens the `trigger_signal` CHECK to add `inactivity`/`at_risk_concentration`; relaxes the `chapter_number` CHECK from `> 0` to `>= 0` for Loop B's `subject_code='_inactivity'`/chapter 0 sentinel — no new table/index/RLS change) + flag seed `20260619000600_seed_ff_adaptive_loops_bc_v1.sql` (`ff_adaptive_loops_bc_v1`, seeded OFF). Pure modules: `src/lib/learn/adaptive-loops-rules.ts` (B/C constants, planners, cross-loop arbiter), `src/lib/learn/inactivity-return-evaluation.ts` (Loop B return verify), `src/lib/learn/concentration-resolution-evaluation.ts` (Loop C band-drop verify). The B/C inject/verify branches live in the existing Loop A cron worker `src/app/api/cron/adaptive-remediation/route.ts` (gated by `ff_adaptive_loops_bc_v1`; verify drains active rows regardless of the flag). 6 new event kinds (`system.engagement_{nudged,returned,escalated}`, `system.concentration_{escalated,resolved,reescalated}`) declared in `src/lib/state/events/registry.ts`. Gated by `ff_adaptive_loops_bc_v1`. Pinned by REG-131..REG-134. Runbook: `docs/runbooks/adaptive-program-rollout.md`. Spec: `docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md`. |
| Student Pulse | `src/lib/pulse/` (`pulse-server.ts`, `signals.ts`, `types.ts`, `use-pulse.ts`); `src/components/pulse/`; `src/app/api/pulse/` (`me`, `school`, `class/[classId]`, `student/[id]`). `canAccessStudent` is the single cross-role data boundary (no payload on any deny). Gated by `ff_school_pulse_v1` (seed `20260619000100_seed_ff_school_pulse_v1.sql`, default OFF). Pinned by REG-120..REG-122, REG-124. Spec: `docs/superpowers/specs/2026-06-12-rbac-conformance-and-student-pulse-design.md`. |
| Non-AI Edge Functions | `supabase/functions/daily-cron/`, `queue-consumer/`, `send-*-email/`, `session-guard/`, `scan-ocr/`, `export-report/` |
| Super admin panel | `src/app/super-admin/` (43 pages), `src/app/api/super-admin/` (75 routes). Last reconciled: 2026-04-27 — admin surface grew ~80% in pages, ~23% in routes since the prior count of 24/61. |
| Parent portal | `src/app/parent/` (6 pages) |
| Teacher portal | `src/app/teacher/` (8 pages) |
| Notifications | `src/app/notifications/page.tsx`, daily-cron Edge Function |
| Migrations | `supabase/migrations/` (post Section 10 cleanup, 2026-05-03: root contains 0 timestamped migrations until `capture-and-pr` workflow lands the baseline; the 349-file pre-baseline chain plus the original 10 pre-timestamp legacy files are archived under `supabase/migrations/_legacy/` and `_legacy/timestamped/`). **Schema reproducibility P0 fix runbook: `docs/runbooks/schema-reproducibility-fix.md`** — replaces the legacy chain with a pg_dump-derived idempotent baseline (`00000000000000_baseline_from_prod.sql`), pre-marked applied on prod and main-staging via `supabase migration repair` so the merge skips execution on those envs and only runs against fresh projects (CI live-DB tests, new staging, DR). Supabase CLI's `db push` only applies files at the immediate `supabase/migrations/` root, so `_legacy/` is skipped automatically on every deploy. |
| CI/CD | `.github/workflows/ci.yml`, `deploy-production.yml`, `deploy-staging.yml` |
| Mobile | `mobile/` (Flutter app) |
| SEO/PWA | `src/app/sitemap.ts`, `public/manifest.json`, `public/sw.js`, `src/components/JsonLd.tsx` |
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

`CAP_SHARED_KB` history: 270 → 275 (2026-05-08, dep-bump drift) → 275 → 280 (2026-06-12, CEO-approved) → 280 → 282 (2026-06-21, activation-funnel PR) → 282 → 284 (2026-06-26, Foxy RCA + Digital Twin Slice 1 merge) → **284 → 288 (2026-07-10, CI baseline drift on PR #1238 with no production-JS diff)**. The 275→280 raise absorbs 1.8 kB of pure framework baseline drift (React + react-dom + `@supabase/*` via the root-layout AuthContext + Next runtime), confirmed NOT app bloat by the load-readiness audit and bundle-composition analysis. It passes locally (274.1 < 275) but CI measures 276.8 kB from a ~2.7 kB OS/gzip environment delta; each subsequent bump was confirmed NOT app bloat. On 2026-07-10 the authoritative HTML-scan gate measured 286.6 kB / 284 kB on a branch that changed docs plus integration-test gating only, while the older single-shared-chunk check still passed; 288 kB restores narrow headroom without changing the durable fix. PostHog is already lazy (PR #534). Durable fix = split `@supabase/*` out of first paint via an AuthContext client-only boundary (~57 kB, P15-touching, tracked as a follow-up); restore toward the 160 kB baseline once it lands. **Current enforced cap: 288 kB** (mirrors `scripts/check-bundle-size.mjs` comments).

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
```
User (Founder/CEO)
  │
  │  Receives from orchestrator:
  │  ├─ Product health    (ops: users, DAU/MAU, quiz completion, revenue)
  │  ├─ System health     (ops: error rate, uptime, health check, latency)
  │  ├─ Release readiness (quality: gate status, test count, bundle sizes)
  │  ├─ Risk register     (orchestrator: blockers, high-risk changes pending)
  │  ├─ Academic integrity (assessment: scoring accuracy, content coverage gaps)
  │  ├─ AI health         (ai-engineer: API success rate, circuit breaker, RAG quality)
  │  └─ Support status    (ops: open tickets, resolution time, top issues)
  │
  └── orchestrator (synthesizes all agent reports)
        ├── architect     → schema changes, security assessments, deploy status
        ├── frontend      → files changed, UI states, i18n, mobile impact
        ├── backend       → API changes, payment impact, notification changes
        ├── assessment    → scoring accuracy, grading consistency, content coverage
        ├── ai-engineer   → AI changes, prompt changes, safety, RAG quality
        ├── testing       → test results, regression catalog, coverage gaps
        ├── quality       → checks passed/failed, review findings, UX audit, verdict
        └── ops           → system metrics, user metrics, revenue, support, flags
```

### Super Admin Reporting Visibility
The super admin panel (ops-owned) exposes:
| Category | Source | Metrics |
|---|---|---|
| Product health | ops + assessment | Active users, signups, DAU/MAU, quiz completion, avg score |
| Learner metrics | assessment + ai-engineer | Topics mastered, Bloom's distribution, knowledge gaps, XP velocity |
| Revenue | backend + ops | Active subs, MRR, churn, plan distribution, payment failures |
| System health | architect + ops | Health endpoint, error rate, latency, DB connections, memory |
| AI health | ai-engineer | Claude API success rate, circuit breaker state, response time, RAG hit rate |
| Release readiness | quality + testing | Gate status, test count, regression results, bundle sizes |
| Content coverage | assessment | Questions per subject/grade, gap analysis, Bloom's per topic |
| Support | ops | Open tickets, resolution time, top issue categories |

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

This is the standard execution cycle. It runs automatically for every `/run` command and should be followed by the orchestrator for any direct request.

```
┌─ UNDERSTAND ──────────────────────────────────────────┐
│ Read the request. Identify affected files, domains,   │
│ product invariants, and risk level.                    │
├─ CLASSIFY ────────────────────────────────────────────┤
│ Type: feature | bugfix | audit | architecture |       │
│       release | scaling | ai-change | reporting       │
│ Risk: low (auto) | medium (proceed with care) |       │
│       high (ask user first)                           │
├─ DELEGATE ────────────────────────────────────────────┤
│ Background: research, scans, audits (read-only)       │
│ Foreground: implementation, tests, reviews (write)    │
│ Parallel: independent agents on different files       │
├─ GATE ────────────────────────────────────────────────┤
│ Hooks enforce: ownership, bash safety, content rules  │
│ Testing verifies: tests pass, catalog gaps reported   │
│ Quality verifies: type-check, lint, build, review     │
│ Orchestrator: review chain completeness (P14)         │
├─ APPROVE (only when required) ────────────────────────┤
│ Stop for: destructive ops, deploys, invariant changes,│
│           pricing, AI model, CBSE subjects, DROP ops  │
│ Auto for: bug fixes, tests, refactors, docs, flags   │
├─ EXECUTE ─────────────────────────────────────────────┤
│ Commit with descriptive message. Push to branch.      │
├─ REPORT ──────────────────────────────────────────────┤
│ What was done. What passed. What needs attention.     │
│ Catalog gaps. Risk items. Ready-to-merge status.      │
└───────────────────────────────────────────────────────┘
```

### Compact Report Format
Every task ends with this output. Keep it to this structure — no extra prose.
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
npm run type-check   # TypeScript validation
npm test             # Vitest (~14,000+ tests, 869 files)
npm run test:e2e     # Playwright E2E
npm run lint         # ESLint
npm run analyze      # Bundle analysis
```
