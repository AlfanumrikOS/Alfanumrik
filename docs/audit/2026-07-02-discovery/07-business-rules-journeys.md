# 07 — Business Rules & User Journey Inventory (Phase 1 Discovery, Read-Only)

Scope: as-implemented business rules for scoring/XP/anti-cheat/atomicity/grade/question-quality
(P1-P6), exam timing, Bloom's/SRS/mastery/streaks, Pedagogy v2 (daily rhythm, weekly dive, monthly
synthesis, wrong-answer remediation), and plan/subscription gating — plus canonical end-to-end user
journeys per role, cross-role boundaries, and gaps. This is an inventory only. No code was modified
to produce this document.

Audit date: 2026-07-02. All file:line citations verified against the working tree at that date.

---

## 1. Core Learning Business Rules (as implemented)

### 1.1 P1 — Score Accuracy

**Given** a student submits `total` responses with `correct` matching `selected_original_index === correct_answer_index_snapshot`
**When** the server computes the result
**Then** `score_percent = ROUND((correct / total) * 100)`

Evidence:
- Server (authoritative, v2 path): `supabase/migrations/20260622030000_submit_quiz_v2_resilient_mastery_perform.sql:250-251` — `v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);`
- Client fallback (only reached if both RPCs fail): `src/lib/supabase.ts:534` calls `calculateScorePercent(correct, total)` from `src/lib/scoring.ts`
- Display: `src/components/quiz/QuizResults.tsx:314` — `const pct = results.score_percent;` (read from submission response, not recalculated)
- Legacy v1 RPC (`submit_quiz_results`) still callable for mobile/in-flight web clients per contract note in `src/lib/supabase.ts:488-500`.

Confirms P1 holds identically across the v2 RPC, the client fallback, and the display component. The three-layer dispatch (v2 RPC → v1 RPC → client fallback, `src/lib/supabase.ts:501-626`) is new since the constitution's simple "one RPC" description — see §4 Gaps.

### 1.2 P2 — XP Economy (incl. caps, bonuses, levels)

**Given** a flagged-free submission with `correct` answers and `score_percent`
**When** XP is computed
**Then** `xp = correct*10 + (score_percent>=80 ? 20 : 0) + (score_percent===100 ? 50 : 0)`, capped so that the sum of today's `quiz` XP transactions (Asia/Kolkata day boundary) never exceeds 200.

Evidence:
- Constants (single source of truth): `src/lib/xp-config.ts:37-67` — `quiz_per_correct=10`, `quiz_high_score_bonus=20`, `quiz_perfect_bonus=50`, `quiz_daily_cap=200`. `src/lib/xp-rules.ts` is now a deprecated re-export shim (`export * from './xp-config'`, `src/lib/xp-rules.ts:26`) — kept on disk because SQL/mobile/runbooks reference the filename.
- Server XP compute (v2): `supabase/migrations/20260622030000...sql:253-260` — literal 10/20/50, comment-tagged `-- P2: XP_RULES...`.
- Daily cap enforcement (ledger-based, IST boundary): `supabase/migrations/20260623000600_fix_atomic_quiz_reference_id_on_conflict_42p10.sql:78-89` — sums `xp_transactions.amount WHERE daily_category='quiz' AND created_at >= CURRENT_DATE AT TIME ZONE 'Asia/Kolkata'`, then `v_xp_to_award := GREATEST(0, LEAST(p_xp, 200 - v_today_quiz_xp))`.
- Idempotent ledger write with dedupe key `quiz_<session_id>`: same file, lines 99-143 (`ON CONFLICT (reference_id) WHERE reference_id IS NOT NULL DO NOTHING`, gated on `v_rows_inserted > 0` before incrementing `students.xp_total`).
- Level formula: `Math.floor(totalXp/500)+1` — `src/lib/xp-config.ts:73-75` (`calculateLevel`); server mirror at `supabase/migrations/20260623000600...sql:210` (`FLOOR(xp/500.0)+1`).
- Level names: `LEVEL_NAMES` / `LEVEL_NAMES_HI` — `src/lib/xp-config.ts:88-115`, resolved via `getLevelName(level, isHi)` (never hardcoded in components — see §1.7).
- Sole-writer de-duplication (2026-07-02, same day as this audit): `supabase/migrations/20260702020000_slc1_dedupe_quiz_session_xp_trigger.sql` neuters the `fn_quiz_session_sync_profile()` completion trigger's XP/level/counter writes so `atomic_quiz_profile_update()` is the **only** XP writer — previously the trigger and the RPC both incremented `students.xp_total` for a normal (non-back-to-back) quiz, double-awarding XP and bypassing the cap on the trigger's half (see file header, lines 9-31, for the RCA). Trigger now maintains only `streak_days`/`longest_streak` (lines 139-161).

### 1.3 P3 — Anti-Cheat

**Given** a quiz submission with `total` responses over `time` seconds
**When** the server evaluates anti-cheat
**Then** it flags (does not reject) the submission if: (a) `time/total < 3.0`, (b) `total > 3` and all `selected_displayed_index` values are identical, or (c) `jsonb_array_length(p_responses) <> total`. A flagged submission still records `quiz_sessions` with the real `score_percent`, but `xp_earned = 0`.

Evidence:
- Server checks (v2): `supabase/migrations/20260622030000...sql:228-248` (three checks, `v_flagged := true`), zero-XP branch at line 254-255.
- Client-side checks are **advisory only**, not enforcement: `src/app/quiz/page.tsx:927-970`. Comment block at lines 927-937 explicitly documents the SLC-5 convergence: "the client is NOT a security boundary... performs these checks ADVISORY-ONLY (warn + telemetry) and ALWAYS proceeds to submitQuizResults. It must NEVER discard the attempt or override the score to 0."
  - Check 1 (speed): lines 945-951, `console.warn` only.
  - Check 2 (pattern): lines 954-962, `console.warn` only.
  - Check 3 (count): lines 964-970, `console.warn` only.

**Gap vs constitution/skill wording**: the constitution and `quiz-integrity` skill both describe anti-cheat as "Reject submission" for speed/count violations. The actual implemented behavior (both client comment and server SQL) is **flag + zero XP + still record the session**, never a hard reject. This is a documented, deliberate divergence (see the SLC-5 comment), not an accidental drift, but the top-level docs have not been updated to match. Flagged as a discovery gap in §4.

### 1.4 P4 — Atomic Quiz Submission

**Given** a completed quiz
**When** the client calls `submitQuizResults()`
**Then** the write path is: v2 RPC `submit_quiz_results_v2` (session-scoped, server-shuffle authority) → v1 RPC `submit_quiz_results` (legacy/mobile) → client-side fallback that itself calls `atomic_quiz_profile_update()` as a single-transaction step, with a last-resort non-atomic upsert only on genuine RPC transport failure.

Evidence:
- Dispatch contract: `src/lib/supabase.ts:488-626` (`submitQuizResults`), see architectural-contract comment at lines 488-500 marked "DO NOT MODIFY WITHOUT REVIEW."
- v2 RPC does INSERT `quiz_sessions` + INSERT `quiz_responses` (loop) + `PERFORM atomic_quiz_profile_update(...)` + best-effort CME action, all inside one PL/pgSQL function body (single transaction): `supabase/migrations/20260622030000...sql:267-277` (session insert), `348-358` (response insert), `405-408` (atomic XP call).
- `atomic_quiz_profile_update()` itself is one function body covering: ledger write → `students.xp_total` → `student_learning_profiles` upsert → `students.streak_days` → `state_events` publish (`learner.quiz_completed`): `supabase/migrations/20260623000600...sql:96-266`.
- Fallback path (client-side, only on RPC failure) still routes through the same `atomic_quiz_profile_update` RPC: `src/lib/supabase.ts:565-609`, with a documented last-resort non-atomic `student_learning_profiles` upsert only in the `catch` branch (lines 593-608), explicitly commented as "DEGRADED LAST-RESORT."

### 1.5 P5 — Grade Format

Grades are TEXT throughout: `p_grade TEXT` param in `submit_quiz_results_v2` (`supabase/migrations/20260622030000...sql:33`), `GRADE_TIME_MULTIPLIER: Record<string, number>` keyed `'6'..'12'` (`src/lib/exam-engine.ts:47-51`), curriculum_topics join uses `ct.grade = p_grade` directly as TEXT (`supabase/migrations/20260622030000...sql:328`). No integer-grade usage found in the files inspected.

### 1.6 P6 — Question Quality Gate

Gate is enforced where questions are served (quiz-generator / question-bank read path — not directly re-inspected in this pass beyond the `quiz-integrity` skill's checklist), and structurally relied upon by `src/app/quiz/page.tsx:128` (`isQuestionMCQ` requires `opts.length === 4` and `correct_answer_index` in `0..3`) and `:434` (defensive re-check before render: `if (typeof q.correct_answer_index !== 'number' || q.correct_answer_index < 0 || q.correct_answer_index > 3) return false;`). Full question-bank insert-time validation (oracle grader, REG-54) lives in the AI/ai-engineer domain and was not re-read in this pass — flagged for a follow-up discovery doc if AI-engineer's file map is in scope.

### 1.7 Scorecard Sourcing (Invariant 7)

- `QuizResults.tsx` reads `results.score_percent` (`:314`) and `results.xp_earned` (`:337, 454, 468, 1256`) directly from the `submitQuizResults()` return value — no local recompute found.
- `results.xp_capped` / `results.xp_uncapped` (daily-cap UI banner): `QuizResults.tsx:83-84, 422-428` — sourced from the RPC's JSONB return, never recomputed client-side.
- Level name: `getLevelName(level, isHi)` used in `ProgressSnapshot.tsx:32` — never a hardcoded string.
- Streak: `ProgressSnapshot` receives `streak` as a prop (server value) — no client-side day-counting found in this component.
- **Note/gap**: `ProgressSnapshot.tsx:37-53` fetches `performance_scores` rows directly from the client and computes `avg = reduce(...) / length` client-side (lines 44-47) to show the "Performance Score" headline number. This is a client-side aggregation across multiple DB rows for a *different* metric system (Performance Score, not legacy XP) than the one Invariant 7 governs, but it is exactly the pattern the invariant warns against ("Progress metrics must come from database queries, not client-side aggregation"). Flagged in §4.
- Knowledge-gap severity thresholds: `src/app/progress/page.tsx:466` — `(g.confidence_score ?? 0) > 0.7 ? 'critical' : (g.confidence_score ?? 0) > 0.4 ? 'high' : 'medium'`. Note this uses **strict `>`**, not `>=`, vs the skill doc's "≥0.7 critical, ≥0.4 high" wording — a boundary-value discrepancy (value exactly 0.7 or 0.4 lands one severity band lower than the skill doc implies). Flagged in §4.
- Subject mastery display (BKT, not raw correct/attempted ratio): `src/components/dashboard/SubjectProgress.tsx:51-70` bands mastery at `>=70` (Strong/green), `>=40` (Growing/orange), else Needs-practice/red — a different threshold model than the skill doc's `Math.round((correct/attempted)*100)` formula, because mastery here is the BKT `mastery_probability`, not a raw ratio. XP progress bar formula matches spec: `(p.xp % 500)/500*100` (`SubjectProgress.tsx:30`, matches `ProgressSnapshot`'s use of `xpToNextLevel` from `xp-config.ts:77-84`).

### 1.8 Exam Timing Model

Matches the constitution/skill table exactly:
- Category → per-difficulty seconds: `src/lib/exam-engine.ts:39-44` (`TIME_PER_QUESTION`).
- Grade multiplier: `src/lib/exam-engine.ts:47-51` (`GRADE_TIME_MULTIPLIER`), 6→1.3 … 11-12→1.0.
- Duration formula: `rawSeconds = questionCount * baseTime * gradeMultiplier`, `+10%` buffer, round up to 5 min: `src/lib/exam-engine.ts:157-163` (`calculateExamConfig`).
- Validation bounds (min/max duration, min/max question count by grade band): `src/lib/exam-engine.ts:186-220` (`validateExamConfig`) — question-count caps: junior (≤8) max 20, 9-10 max 30, 11-12 max 40, min 3 (lines 211-217). This per-grade question-count ceiling is **not** documented in the constitution or skill files — flagged in §4.
- Exam presets (Quick Check / Standard Test / Challenge / Full Exam) with grade-varying question counts: `src/lib/exam-engine.ts:71-131` (`getExamPresets`).

### 1.9 Bloom's Progression

- Canonical order: `remember → understand → apply → analyze → evaluate → create`, `src/lib/cognitive-engine.ts:31, 33, 35-42` (`BloomLevel` type, `BLOOM_LEVELS` array, `BLOOM_ORDER` numeric map) — matches the constitution/skill exactly.
- Display config (labels, Hindi, color, icon, description) per level: `src/lib/cognitive-engine.ts:44-100` (`BLOOM_CONFIG`).
- Target Bloom distribution by exam type is documented in the skill file but was not independently verified against a live quiz-generator distribution check in this pass (that logic lives in `supabase/functions/quiz-generator/`, an ai-engineer-owned surface).

### 1.10 SRS / Spaced Repetition

- SM-2 card type (`easeFactor`, `interval`, `repetitions`) declared at `src/lib/cognitive-engine.ts:104-108` (`SM2Card`). The algorithm implementation itself (update rules) was not read line-by-line in this pass; only the data contract was confirmed here.
- Daily-rhythm SRS integration: exactly 5 SRS review slots per day is a named constant, `SRS_TARGET = 5` — `src/lib/learn/daily-rhythm-orchestrator.ts:92`, consumed by `pickSrsItems` (`:94-131`) which allocates an "ahead of grade" quota only for personas whose `resolvePedagogyRule(...).allowAheadOfGrade` is true (competitive_exam/olympiad), excluding it entirely for `improve_basics` (comment at lines 100-104).

### 1.11 Mastery Bands

Three distinct mastery-band systems coexist and were each independently verified:
1. **Goal-aware display bands** (Layer 4, flag-gated): `mastered` if `mastery >= threshold`, `developing` if `mastery >= 0.5*threshold`, else `building` — `src/lib/goals/mastery-display.ts:93-102` (`classifyMasteryForDisplay`). Threshold is goal-specific (`READINESS_TARGET_PCT_BY_GOAL`, lines 42-49: 60/70/80/85/85/90 by persona) but defaults to the legacy `0.8` / `80%` for null/unknown goal (lines 35, 38, 63-66, 78-81) so the flag being OFF is a byte-identical no-op.
2. **BKT mastery bands** (dashboard `SubjectProgress`): `>=70` strong, `>=40` growing, else needs-practice — `src/components/dashboard/SubjectProgress.tsx:54-63`.
3. **Bloom's heatmap opacity**: `opacity = Math.max(0.1, avg)` where `avg` is the mean `mastery` (0-1) across question attempts at that Bloom level for the subject — `src/app/progress/page.tsx:117-150` (`BloomHeatmap`), matches skill doc's "mastery_percentage / 100 per level" intent (avg is already 0-1, not divided again).

### 1.12 Streaks

- `students.streak_days` is the sole source read by dashboard components (per §1.7); it is written exclusively inside `atomic_quiz_profile_update()` (`supabase/migrations/20260623000600...sql:216-223`, `CASE WHEN last_active::date = CURRENT_DATE ... WHEN = CURRENT_DATE-1 THEN +1 ELSE 1`) after the 2026-07-02 de-duplication migration removed the competing trigger-side `students.xp_total`/level/counter writes (the trigger still separately maintains `student_learning_profiles.streak_days`/`longest_streak`, a *different* column pair, per `20260702020000...sql:139-161`).
- Streak milestone XP bonuses (not daily-login XP): `streak_7_day_bonus=25`, `streak_30_day_bonus=100`, `streak_100_day_bonus=500` — `src/lib/xp-config.ts:53-57`. `streak_daily=0` (login-only XP intentionally removed, same file line 54, comment explains the 2026-04-08 design mandate).
- Foxy voice-line escalation by streak tier (1 / 2-3 / 4-5 / 6+): `src/lib/feedback-engine.ts:28-53` (`CORRECT_LINES`), compassionate (never mocking) wrong-answer lines at `56-69` (`WRONG_LINES`), bilingual throughout.

### 1.13 Daily Rhythm (5 SRS + 1 ZPD + reflection)

- Composer contract: `DailyRhythmInput` → `DailyRhythmQueue` (`items: RhythmItem[]`), pure function, no persona conditionals in the orchestrator file itself (all persona logic delegated to `resolvePedagogyRule`) — `src/lib/learn/daily-rhythm-orchestrator.ts:1-70` (header + types).
- `RhythmItem` union covers exactly the three item kinds: `srs_review`, `zpd_problem`, `reflection` — lines 56-65.
- Session-end reflection prompts: 7-entry bilingual rotation, `SESSION_REFLECTION_PROMPTS` — lines 74-82, selected via `reflectionPromptAt(index)` with modulo wraparound (lines 84-88).
- API surface: `src/app/api/rhythm/today/route.ts` (today's queue) and `src/app/api/rhythm/remediation/[id]/resolve/route.ts` (remediation resolution) — both present, not read line-by-line in this pass.

### 1.14 Weekly Dive

- Pure planner `planWeeklyDive(ctx): WeeklyDivePlan` — `src/lib/learn/weekly-dive-orchestrator.ts:87-100+`. State is `'open'` unless `lastCompletedIsoWeek === currentIsoWeek` (line 89-90), computed via a from-scratch ISO-8601 week function (`isoWeekOf`, lines 57-70, Thursday-rule implementation, no external date lib).
- Per-persona default picker table: `DEFAULT_PICKER_BY_PERSONA` (lines 74-81) — e.g. `school_topper → phenomenon`, `competitive_exam/olympiad → own_topic`, others → `weak_topic`.
- Option visibility gates on upstream data availability (`showPhenomenonOption = eligiblePhenomenaCount > 0`, `showWeakTopicOption = weakTopicCount > 0`); `own_topic` is always shown (universal escape hatch, line 94 + interface comment line 44).
- Explicitly documented "ZERO IO, ZERO React, ZERO PII" (file header, line 15) — a pure module; the route handler (Task 5, not re-read here) supplies live data.

### 1.15 Monthly Synthesis

- `composeSynthesisBundle()` is a "trivial" pure shape-enforcer (comment, lines 90-94) taking `MonthBoundaries + weeklyArtifactIds + MasteryDelta + ChapterMockSummary` and returning a `SynthesisBundle` — `src/lib/learn/monthly-synthesis-orchestrator.ts:99-100+`.
- `monthBoundariesOf(date)` computes UTC month start/end + `'YYYY-MM'` label (lines 76-87) — pure, no timezone-shift subtlety beyond UTC (contrast with the IST-day-boundary XP cap logic in §1.2, which is a *different* clock convention for a *different* subsystem — worth tracking if synthesis month boundaries and XP-cap day boundaries are ever compared side by side).
- Downstream wiring (Edge Function builder, cron trigger, WhatsApp notify caller) is enumerated in the file's "Pre-flight audit" comment (lines 15-21: C1-C5) but not independently re-verified in this discovery pass.

### 1.16 Wrong-Answer Remediation

- `lookupRemediation(supabase, questionId, distractorIndex)` reads the existing `wrong_answer_remediations` table keyed on `(question_id, distractor_index)`, returns `null` (UI falls back to legacy generic feedback) when no curated row exists — `src/lib/learn/wrong-answer-remediation.ts:26-62`. No schema changes, server-side only (RLS-respecting client passed in, per file header lines 13).

### 1.17 Plan / Subscription Gating (which features per plan)

- Canonical plan tiers: `free(0) < starter(1) < pro(2) < unlimited(3)` — `src/lib/plans.ts:27-88` (`PLANS`), with legacy alias normalization (`basic→starter`, `premium→pro`, `ultimate→unlimited`, `src/lib/plans.ts:111-113`) and billing-cycle-suffix stripping (`normalizePlanCode`, lines 116-119).
- Per-plan feature summary (display-only benefits list, not the enforcement source): free = 5 Foxy chats/day + 5 quizzes/day + 2 subjects; starter = 30 chats + 20 quizzes + 4 subjects + STEM Lab; pro = 100 chats + unlimited quizzes + all subjects + STEM Lab + advanced analytics; unlimited = fully unlimited + priority support (`src/lib/plans.ts:37-38, 52-53, 67-68, 82-83`).
- Pricing (single source for all UI): `src/lib/plans.ts:94-98` (`PRICING` — starter ₹299/₹2399, pro ₹699/₹5599, unlimited ₹1099/₹8799 monthly/yearly).
- **Actual enforcement** is separate from the display config: `src/lib/plan-gate.ts` — `checkPlanGate(userId, permissionCode, plan, schoolId?, increment?)` looks up `plan_permission_overrides` (plan × permission_code → `is_granted` + `usage_limit{max,period}`), fails OPEN on any DB/RPC error (explicit design principle, file header lines 8-9; every catch branch returns `{granted:true}`, e.g. lines 212-213, 230-241). Daily-limit enforcement delegates to the `check_and_increment_permission_usage` RPC (lines 190-227).
- `checkPlanGateEffective(...)` (lines 274-304) is the B2B/B2C coexistence entry point: resolves the higher of (a) the caller-supplied plan and (b) the school-derived "effective plan" via `resolveEffectivePlanCode`, and **only ever gates UP, never down** (comment lines 255-263) — a school-covered student can't lose access relative to their personal plan, and a pure-B2C student's gate is byte-identical to pre-B2B behavior.
- `checkParentPlanGate(parentUserId, parentPermission, childStudentId)` (lines 316-360) maps a parent-facing permission to a required child permission via `parent_plan_permission_map`, then re-checks against the *child's* `subscription_plan` — parent feature access rides the child's plan tier, not a separate parent plan.

---

## 2. User Journeys Per Role

### 2.1 Student

#### Journey S1 — Signup → Verify → Onboard → Dashboard

| # | Step | Pages / APIs / RPCs | Business rules enforced |
|---|---|---|---|
| 1 | Signup form submit | `AuthScreen.tsx` (not re-read this pass) | P15: role selection (student/teacher/parent) |
| 2 | Verification email sent | `supabase/functions/send-auth-email/` — must return HTTP 200 on all paths (P15 rule 1) | P15 |
| 3 | Email link click | `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts` — both PKCE and token_hash flows handled (P15 rule 3) | P15 |
| 4 | Profile bootstrap (3-layer failsafe) | Client insert → `src/app/api/auth/bootstrap/route.ts` (`bootstrap_user_profile` RPC, idempotent via `ON CONFLICT`, comment at `route.ts:41, 327, 372-383`) → `AuthContext.tsx` runtime fallback | P15 rules 2 & 4 |
| 5 | Grade/board selection | `src/app/onboarding/page.tsx` | P5 (grade stored as string) |
| 6 | Redirect to dashboard | `src/app/dashboard/` (not re-read this pass) | — |

#### Journey S2 — Daily Rhythm

| # | Step | Pages / APIs / RPCs | Business rules |
|---|---|---|---|
| 1 | Dashboard loads today's queue | `src/components/dashboard/sections/DailyRhythmQueue.tsx` → `src/app/api/rhythm/today/route.ts` | §1.13 (5 SRS + 1 ZPD + reflection composition) |
| 2 | Student works through items | Quiz/practice UI (per item kind) | Bloom's ZPD targeting (§1.9), SM-2 due-card selection (§1.10) |
| 3 | Remediation surfaced on wrong answer | `MisconceptionExplainer.tsx` ← `src/lib/learn/wrong-answer-remediation.ts` | §1.16 |
| 4 | Remediation resolved | `src/app/api/rhythm/remediation/[id]/resolve/route.ts` | Adaptive program Loop A/B/C substrate (`adaptive_interventions`), flag-gated |

#### Journey S3 — Take Quiz → Score → XP → Progress

| # | Step | Pages / APIs / RPCs | Business rules |
|---|---|---|---|
| 1 | Configure quiz (subject/mode/preset) | `src/app/quiz/page.tsx`, `QuizSetup.tsx`, `getExamPresets`/`calculateExamConfig` (`exam-engine.ts`) | §1.8 timing model |
| 2 | Server starts session, snapshots shuffle | `start_quiz_session` RPC (not re-read this pass; referenced in `supabase.ts:493` contract comment) | Server-shuffle authority — prevents mid-session option edits |
| 3 | Answer questions | `src/app/quiz/page.tsx` (timer via `useRef`, not `useState` per Invariant 5) | P6 (4-option/valid-index guards at `:128, 434`) |
| 4 | Client-side advisory anti-cheat check | `src/app/quiz/page.tsx:927-970` | P3 (advisory only — see §1.3 gap) |
| 5 | Submit | `submitQuizResults()` → `submit_quiz_results_v2` RPC (or v1/fallback) | P1, P2, P3 (server-authoritative), P4 |
| 6 | Results displayed | `QuizResults.tsx` | Invariant 7 (no recompute) |
| 7 | Adaptive/mastery state updated (best-effort, non-blocking) | `processAdaptiveLearning()` → CME Edge Function `record_response` (`src/lib/supabase.ts:645-680+`) | Bloom's progression, SM-2 retention, knowledge-gap detection |
| 8 | Progress page reflects new state | `src/app/progress/page.tsx` (Bloom heatmap, knowledge gaps, mastery) | §1.11, §1.7 |

#### Journey S4 — Foxy Tutoring

| # | Step | Pages / APIs |
|---|---|---|
| 1 | Open Foxy | `/foxy` page (ai-engineer domain) |
| 2 | Send message | `src/app/api/foxy/route.ts` — modes: `learn, explain, practice, revise, doubt, homework, explorer` |
| 3 | Response returned (age-appropriate, CBSE-scoped) | P12 (ai-engineer + assessment shared invariant) |
| 4 | Usage counted against plan | `checkPlanGate`/`checkPlanGateEffective` (`src/lib/plan-gate.ts`) — free plan 5 chats/day (`src/lib/plans.ts:37`) |

Not independently re-verified in this pass beyond the plan-gate wiring already confirmed in §1.17; Foxy prompt/RAG internals are ai-engineer-owned.

#### Journey S5 — Weekly Dive

| # | Step | Pages / APIs |
|---|---|---|
| 1 | Dive state check | `src/app/dive/page.tsx` → `src/app/api/dive/state/route.ts` → `planWeeklyDive()` |
| 2 | Start dive (pick phenomenon/weak-topic/own-topic) | `src/app/api/dive/start/route.ts` |
| 3 | Submit artifact | `src/app/api/dive/artifact/route.ts` |
| 4 | View history | `src/app/dive/history/`, `src/app/api/dive/history/route.ts` |

Streak logic: `src/lib/learn/weekly-streak.ts` (not re-read this pass beyond file map reference).

#### Journey S6 — Monthly Synthesis

| # | Step | Pages / APIs |
|---|---|---|
| 1 | View synthesis | `src/app/synthesis/page.tsx` → `src/app/api/synthesis/state/route.ts` |
| 2 | Built by cron | `supabase/functions/monthly-synthesis-builder/`, triggered from `daily-cron` (`triggerMonthlySynthesis` step) |
| 3 | Parent share | `src/app/api/synthesis/parent-share/route.ts` — gated on `guardians.monthly_synthesis_optin` (per orchestrator header comment, `monthly-synthesis-orchestrator.ts:18`) |

#### Journey S7 — Leaderboard

`src/app/leaderboard/page.tsx` reads aggregate XP/rank data — not independently re-verified this pass for client-vs-server aggregation; flagged as a follow-up check in §4 (this file was in the git-status diff at session start, meaning it was recently touched — worth a targeted assessment review).

#### Journey S8 — Subscription Purchase

| # | Step | Pages / APIs / RPCs | Business rules |
|---|---|---|---|
| 1 | View pricing | `PricingCards` (frontend), reads `src/lib/plans.ts:PRICING` | Single pricing source |
| 2 | Create order | `src/app/api/payments/create-order/route.ts` | P11 |
| 3 | Checkout + verify | `src/app/api/payments/verify/route.ts` | Razorpay signature verification |
| 4 | Webhook confirms payment | `src/app/api/payments/webhook/route.ts` → `activate_subscription` RPC, fallback `atomic_subscription_activation` (migration `20260424120000`) | P11 atomicity; `ff_atomic_subscription_activation` flag gate |
| 5 | Status/cancel | `src/app/api/payments/status/route.ts`, `.../cancel/route.ts` | — |

### 2.2 Parent

| # | Step | Pages / APIs | Business rules |
|---|---|---|---|
| 1 | Signup | `AuthScreen.tsx` (parent role) | P15 rule 5 |
| 2 | Link child (request OTP → redeem code, or approve a student-initiated link) | `src/app/api/parent/link-code/request-otp/route.ts`, `.../redeem/route.ts`, `src/app/api/parent/approve-link/route.ts` (student approves; ownership verified via server session before mutation — `approve-link/route.ts:9-16`) | Cross-role boundary (§3) |
| 3 | View progress | `src/app/parent/page.tsx`, `src/app/parent/children/page.tsx` | `canAccessStudent` gate (via guardian link, `rbac.ts:283-299`) |
| 4 | Reports | `src/app/parent/reports/page.tsx`, `src/app/api/parent/report/route.ts` | `checkParentPlanGate` (child's plan tier) |
| 5 | Synthesis share | `src/app/api/synthesis/parent-share/route.ts` | Opt-in gate (`guardians.monthly_synthesis_optin`) |
| 6 | Billing | `src/app/parent/billing/page.tsx`, `src/app/api/parent/billing/route.ts` | P11 |

### 2.3 Teacher

| # | Step | Pages / APIs | Business rules |
|---|---|---|---|
| 1 | Onboard | `src/app/teacher/onboarding/page.tsx` | P15 rule 5 (school/subjects) |
| 2 | Classes | `src/app/teacher/classes/page.tsx` | `class_teachers` ownership |
| 3 | Students roster | `src/app/teacher/students/page.tsx` | `canAccessStudent` teacher branch — `teachers → class_teachers → class_students` join chain, fail-closed on any error (`rbac.ts:310-343`) |
| 4 | Assignments / worksheets | `src/app/teacher/assignments/page.tsx`, `.../worksheets/page.tsx` | — |
| 5 | Grade book | `src/app/teacher/grade-book/page.tsx` | Score display should mirror P1 sourcing (not independently re-verified this pass) |
| 6 | At-risk alerts | Adaptive program Loop A/B/C escalation (`adaptive_interventions`), teacher-dedupe index (migration `20260619000400`) | B2B escalation attribution (subject-match tiering) |
| 7 | Reports | `src/app/teacher/reports/page.tsx` | — |

### 2.4 School-Admin / Internal-Admin / Super-Admin

| Role | Key journey | Pages / APIs | Business rules |
|---|---|---|---|
| School-admin (Pulse) | View school/class/student pulse | `src/app/api/pulse/{me,school,class/[classId],student/[id]}/route.ts` | `canAccessStudent` single boundary (no payload on deny), flag-gated `ff_school_pulse_v1` |
| Internal-admin | Admin dashboard | `src/app/internal/admin/page.tsx`, `src/app/api/v1/admin/*` | Secret-gated (per constitution REG-115/116) |
| Super-admin | Marking integrity | `src/app/super-admin/marking-integrity/page.tsx` ← `public.marking_audit_last_30d` view | Forensic, service-role-only |
| Super-admin | Subscriptions / entitlements | `src/app/super-admin/subscriptions/page.tsx`, `.../entitlements/page.tsx` | Reads `plan_permission_overrides` (same table `plan-gate.ts` enforces against) |
| Super-admin | Feature flags | `src/app/super-admin/flags/page.tsx` | `src/lib/feature-flags.ts` |
| Super-admin | Learning / content | `src/app/super-admin/learning/page.tsx`, `.../misconceptions/page.tsx`, `.../subjects/page.tsx` | assessment content-QA domain |

Full 38-page super-admin surface enumerated via glob; not all individually journey-mapped in this pass (see §4 for scope note).

---

## 3. Cross-Role Boundaries

| Boundary | Enforcement point | Evidence |
|---|---|---|
| Parent ↔ child link | `guardian_student_links` table, status `active`/`approved` required | `rbac.ts:284-299` (`canAccessStudent` guardian branch) |
| Student approves/rejects a pending parent link | Server session ownership check before mutation; admin client used only for the actual UPDATE (RLS doesn't grant students write on `guardian_student_links`) | `src/app/api/parent/approve-link/route.ts:9-16` (header comment), `:33-44` (auth) |
| Teacher ↔ student assignment | `teachers → class_teachers → class_students`, fail-closed on any query error | `rbac.ts:310-343` |
| Institution-admin ↔ school | `school_admins(auth_user_id, school_id, is_active)` matched against `students.school_id` | `rbac.ts:250-272` |
| `canAccessStudent` — the single cross-role data-access boundary | Checked in order: admin/super_admin → institution_admin (school match) → self (student) → guardian (approved link) → teacher (assigned class); default deny | `rbac.ts:243-346` |
| Student Pulse cross-role boundary | Reuses `canAccessStudent` + class/school ownership; service-role admin client used only for bulk reads *after* the boundary check | `src/lib/pulse/pulse-server.ts:9-12` (header comment) |

---

## 4. Findings & Gaps (inventory only — no fixes applied)

1. **Anti-cheat wording drift (P3)**: `.claude/CLAUDE.md` and the `quiz-integrity` skill both describe speed/count violations as causing a submission "Reject." The actual, deliberately-designed behavior (both client comment at `src/app/quiz/page.tsx:927-937` and server SQL at `supabase/migrations/20260622030000...sql:228-260`) is "flag + zero XP + still record the real score," never a hard reject. This is intentional (SLC-5 convergence, documented in-code) but the top-level constitution/skill text has not been updated to match. **Client and server implementations do NOT drift from each other** — both agree on flag-not-reject — but they drift from the written product-invariant description.

2. **Client/server pairs that could drift** (explicitly flagged for future-change vigilance):
   - `src/lib/xp-config.ts` (constants) ↔ `supabase/migrations/20260622030000...sql:253-260` + `20260623000600...sql` (SQL literals `10`/`20`/`50`/`200`) — currently in sync but the SQL hardcodes the literals rather than reading a shared config; any future XP-constant change must touch both.
   - `src/app/quiz/page.tsx` client anti-cheat thresholds (`:945-970`, hardcoded `3`, `>3`) ↔ server thresholds (`supabase/migrations/20260622030000...sql:228-248`, hardcoded `3.0`, `> 3`) — currently identical values, duplicated in two languages.
   - `src/lib/exam-engine.ts` timing tables ↔ any server-side timer enforcement (not located in this pass — if the exam countdown is purely client-enforced with no server-side session-expiry check, that is itself a gap; recommend a targeted follow-up read of the exam/session-start RPC).
   - `LEVEL_NAMES`/`LEVEL_NAMES_HI` (`xp-config.ts:88-115`) ↔ any server-side level-name usage (e.g. notification templates, WhatsApp copy) — not located in this pass; if a server function independently computes a level name string, it should import from the same source or risk drifting.

3. **Client-side aggregation exceptions** (Scorecard Rule "must come from DB query, not client-side aggregation"):
   - `ProgressSnapshot.tsx:37-53` averages `performance_scores.overall_score` across subject rows client-side (`reduce(...)/length`) to produce the headline "Performance Score" number. This is a distinct metric system from legacy XP (no invariant violation of P1/P2 sourcing), but it is exactly the client-aggregation pattern the Scorecard Rules table warns against for progress metrics. Not flagged as a P-invariant violation because Performance Score is outside the explicitly-named XP/score/streak/mastery list, but worth an assessment-agent decision on whether it should move server-side.

4. **Knowledge-gap severity boundary mismatch**: skill doc says `confidence_score >= 0.7` → critical, `>= 0.4` → high. Implementation (`src/app/progress/page.tsx:466`) uses **strict `>`**. A gap with `confidence_score` exactly `0.7` or `0.4` is classified one severity band lower than the skill doc implies. Low-impact (boundary-value only) but a real drift between spec text and code.

5. **Per-grade question-count ceiling undocumented**: `validateExamConfig()` (`src/lib/exam-engine.ts:211-217`) enforces `min 3` / `max 20 (grade≤8) / 30 (9-10) / 40 (11-12)` questions per custom exam. Neither the constitution nor the `cbse-rules` skill documents this ceiling — it exists only in code. Not a violation, but an undocumented business rule that should be captured if `.claude/CLAUDE.md` or the skill file is ever revised.

6. **Two independent "day boundary" clock conventions coexist**: the XP daily cap uses `CURRENT_DATE AT TIME ZONE 'Asia/Kolkata'` (IST) (`supabase/migrations/20260623000600...sql:85`), while `monthBoundariesOf()` for monthly synthesis uses plain UTC month boundaries (`monthly-synthesis-orchestrator.ts:76-87`), and the streak-day comparison in `atomic_quiz_profile_update` uses `CURRENT_DATE`/`last_active::date` (server default timezone, not explicitly IST-cast) (`supabase/migrations/20260623000600...sql:216-223`). These are three different subsystems with three different day/month boundary conventions. Not necessarily wrong (synthesis genuinely wants calendar-month-UTC; XP cap genuinely wants IST-day), but the streak-day comparison's implicit (non-IST-cast) `CURRENT_DATE`/`last_active::date` should be double-checked against the DB server's configured timezone to confirm it actually means "IST midnight" and not "UTC midnight" — a silent mismatch here would cause streaks to reset at the wrong hour for Indian users. Flagged for a targeted architect/assessment follow-up, not confirmed as a bug in this read-only pass.

7. **Journeys with no obvious E2E spec** (checked `e2e/*.spec.ts` filenames against the journeys in §2; a spec's *existence* was checked by filename pattern only — this pass did not open each spec to confirm depth of coverage):
   - **Covered by name**: auth/onboarding (`auth-onboarding-3role.spec.ts`, `auth-onboarding-p15.spec.ts`, `auth-flow.spec.ts`), quiz happy path (`quiz-happy-path.spec.ts`), payments (`payment-checkout.spec.ts`, `payment-ops.spec.ts`), monthly synthesis (`monthly-synthesis.spec.ts`), teacher remediation (`teacher-remediation-spine.spec.ts`), pulse RLS (`pulse-rls.spec.ts`), school-admin (`school-admin.spec.ts`), subject governance (`subject-governance.spec.ts`).
   - **No matching spec filename found** for: **Weekly Dive** (S5 — no `dive*.spec.ts`), **Leaderboard** (S7 — no `leaderboard*.spec.ts`), **Parent reports / synthesis-share** (no `parent-report*.spec.ts` or `parent-synthesis*.spec.ts` — only `strategic-reports.spec.ts`, which reads as an internal/super-admin reporting spec by name, not parent-facing), **Foxy tutoring end-to-end** (no `foxy*.spec.ts` beyond `foxy-structured-rendering.spec.ex` which likely covers rendering, not the full learn/explain/practice/revise/doubt/homework/explorer mode matrix), **Daily Rhythm queue** (no `rhythm*.spec.ts` or `daily-rhythm*.spec.ts`), **Teacher grade-book / assignments / worksheets** (only `teacher-remediation-spine.spec.ts` exists by name — grade-book and assignment-creation flows have no obvious dedicated spec). These are inventory gaps only; confirm with `testing` agent before treating any as a confirmed coverage hole (filename absence ≠ proven absence of coverage, e.g. a broader spec could exercise the journey under a different name).

8. **Full super-admin journey mapping incomplete**: 38 super-admin pages exist (§2.4 lists a representative subset); this pass did not journey-map all 38. If a complete super-admin journey inventory is needed, it should be a dedicated follow-up (likely owned jointly by ops + backend, reviewed by assessment only for the learner-metrics-surfacing pages).

9. **Foxy/RAG and quiz-generator internals out of scope**: Bloom's target-distribution-by-exam-type (skill doc table) and the P6 question-quality gate's actual insert-time oracle (REG-54) both live in ai-engineer-owned Edge Function code (`supabase/functions/quiz-generator/`) that was not re-read line-by-line in this assessment-focused pass. A joint assessment+ai-engineer follow-up would be needed to confirm the served-distribution matches the documented targets.

10. **v1 RPC (`submit_quiz_results`) still live**: per the architectural-contract comment in `src/lib/supabase.ts:498-499`, the legacy v1 RPC "MUST remain callable until mobile cuts over to v2," enforced by a canary in `adaptive-pipeline.test.ts`. This means P1/P2/P3 currently have **two independently-maintained SQL implementations** (v1 and v2) that must both stay in lock-step with `xp-config.ts` — a second drift-risk pair beyond the ones listed in item 2, not yet located/read in this pass (the v1 function body was not opened). Recommend a targeted read of the v1 RPC definition to confirm its P1/P2/P3 literals still match v2's before any future XP/anti-cheat change ships.

---

## Appendix: File Map Referenced in This Document

| Area | Path |
|---|---|
| XP constants (live) | `src/lib/xp-config.ts` |
| XP constants (deprecated shim) | `src/lib/xp-rules.ts` |
| Quiz submission dispatch | `src/lib/supabase.ts:488-680` |
| Quiz page (client anti-cheat, timer, question guards) | `src/app/quiz/page.tsx` |
| Quiz results display | `src/components/quiz/QuizResults.tsx` |
| Exam timing/presets | `src/lib/exam-engine.ts` |
| Cognitive engine (Bloom's, SM-2, ZPD types) | `src/lib/cognitive-engine.ts` |
| Feedback engine (streak voice lines) | `src/lib/feedback-engine.ts` |
| Progress page (Bloom heatmap, knowledge gaps) | `src/app/progress/page.tsx` |
| Dashboard snapshot | `src/components/dashboard/ProgressSnapshot.tsx` |
| Subject progress | `src/components/dashboard/SubjectProgress.tsx` |
| Goal-aware mastery display | `src/lib/goals/mastery-display.ts` |
| Daily rhythm orchestrator | `src/lib/learn/daily-rhythm-orchestrator.ts` |
| Weekly dive orchestrator | `src/lib/learn/weekly-dive-orchestrator.ts` |
| Monthly synthesis orchestrator | `src/lib/learn/monthly-synthesis-orchestrator.ts` |
| Wrong-answer remediation | `src/lib/learn/wrong-answer-remediation.ts` |
| Plan identity/pricing | `src/lib/plans.ts` |
| Plan gate enforcement | `src/lib/plan-gate.ts` |
| RBAC / canAccessStudent | `src/lib/rbac.ts` |
| Pulse server (reuses canAccessStudent) | `src/lib/pulse/pulse-server.ts` |
| Parent approve-link | `src/app/api/parent/approve-link/route.ts` |
| Atomic quiz/profile RPC (latest) | `supabase/migrations/20260623000600_fix_atomic_quiz_reference_id_on_conflict_42p10.sql` |
| submit_quiz_results_v2 RPC (latest) | `supabase/migrations/20260622030000_submit_quiz_v2_resilient_mastery_perform.sql` |
| XP-writer de-duplication (2026-07-02) | `supabase/migrations/20260702020000_slc1_dedupe_quiz_session_xp_trigger.sql` |
| E2E specs | `e2e/*.spec.ts` (29 files, enumerated in §4 item 7) |
