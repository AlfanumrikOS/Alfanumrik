# Student Learning Core — End-to-End Quiz Lifecycle Map

**Workflow:** Quiz / Scoring / XP / Mastery
**Audit cycle:** Cycle 3 — DISCOVER → MAP
**Owner:** Assessment engineer
**Date:** 2026-06-29
**Scope:** Analysis only. No application code modified.

This document traces the quiz lifecycle exactly as a student experiences it, from
setup to results, naming every component/function, every check, every RPC/DB write,
and the three-way P1 score-formula parity points + the P2 XP literal-parity points.

---

## Authoritative source files (verified on disk)

| Concern | File | Notes |
|---|---|---|
| Quiz orchestrator | `src/app/quiz/page.tsx` (1826 LOC) | Assembly, timing, client anti-cheat, submit dispatch |
| Setup UI | `src/components/quiz/QuizSetup.tsx` | Subject/difficulty/count/chapter/type picker |
| Results UI | `src/components/quiz/QuizResults.tsx` (1284 LOC) | Display-only; consumes submission response |
| Feedback overlay | `src/components/quiz/FeedbackOverlay.tsx` | Per-answer emotional feedback |
| Score/XP pure fns | `src/lib/scoring.ts` | `calculateScorePercent`, `calculateQuizXP` — single TS source |
| XP constants | `src/lib/xp-config.ts` | `XP_RULES`, `XP_PER_LEVEL`, `calculateLevel`, `LEVEL_NAMES` |
| XP shim (legacy path) | `src/lib/xp-rules.ts` | `export * from './xp-config'` — NOT a second source |
| Submit dispatcher | `src/lib/supabase.ts` → `submitQuizResults()` (line 498) | L1 v2 → L2 v1 → fallback |
| Server-only route | `src/app/api/quiz/submit/route.ts` | Idempotency-keyed wrapper for v2 RPC (flag-gated cutover) |
| v2 RPC | `submit_quiz_results_v2` — baseline line 7594 | Snapshot-backed scoring (primary) |
| v1 RPC | `submit_quiz_results` — baseline line 7274 | Legacy + mobile path |
| Atomic XP/profile | `atomic_quiz_profile_update` 7-arg void — baseline line 794 | P4 atomic + P2 cap + ledger |
| Atomic XP (JSONB 6-arg) | baseline line 717 | Used ONLY by the client-side fallback |
| Shuffle snapshot | `start_quiz_session` + `quiz_session_shuffles` | Server-owned shuffle authority |
| Baseline schema | `supabase/migrations/00000000000000_baseline_from_prod.sql` (22,629 LOC) | pg_dump of prod; later migrations refine v2 (20260621–20260623) |

> **XP_RULES note:** `src/lib/xp-rules.ts` is a one-line re-export shim
> (`export * from './xp-config'`, lines 1-27). The live constants live in
> `src/lib/xp-config.ts` (lines 37-67). P2 is therefore anchored in **xp-config.ts**.
> All on-disk imports resolve to the same object; there is no second TS source.

---

## Step-by-step lifecycle

### Step 1 — Setup (student picks subject / difficulty / count / chapter / types)
- **Component:** `QuizSetup.tsx` → `startQuiz(opts)` in `quiz/page.tsx:435`.
- **Grade source:** `student.grade` (string `"6"`..`"12"`) flows into `assembleQuiz` — P5 string contract held (`quiz/page.tsx:472`, `student.grade` passed verbatim).
- **Valid counts:** `VALID_QUIZ_COUNTS = [5,10,15,20]` (`quiz/page.tsx:144`).
- **DB write:** none yet.

### Step 2 — Assembly + server shuffle authority
- **Fn:** `assembleQuiz({subject, grade, requestedCount, difficulty, chapter, questionTypes, mode})` (`quiz/page.tsx:471`). Guaranteed-count assembler — exact count or explicit failure with auto-reduce to nearest valid count (`quiz/page.tsx:498-507`).
- **P6 question-quality gate (client):** `isValidQuestion(q)` (`quiz/page.tsx:419-433`): rejects text < 5 chars, `{{`, `[BLANK]`; for MCQ requires exactly 4 non-empty options + `correct_answer_index` in 0..3. (Note: `isValidQuestion` is **defined** but is not called inside `startQuiz`; the assembler is expected to pre-filter — see Gap analysis SLC-7.)
- **Server shuffle:** `startQuizSession(student.id, mcqIds)` (`quiz/page.tsx:545`, impl `supabase.ts:436`) calls `start_quiz_session` RPC → server generates per-question shuffle, snapshots `options` + `correct_answer_index` into `quiz_session_shuffles`, returns options **in display order WITHOUT** `correct_answer_index`.
- **Client hardening:** for shuffled questions the client sets `correct_answer_index = -1` (`quiz/page.tsx:567`) so any accidental client-side comparison fails loudly instead of silently mis-scoring.
- **Fallback:** if `start_quiz_session` returns null → `serverSessionId = null`, questions rendered in original order, legacy v1 scoring (selected_option == original index) (`quiz/page.tsx:571-576`).
- **DB write:** `quiz_session_shuffles` rows (server-side, inside `start_quiz_session`).

### Step 3 — Answering + timing capture
- **Global timer:** `useEffect` with `timerRef` (`useRef`, not `useState`) — counts UP for practice/cognitive, DOWN from limit for exam (`quiz/page.tsx:341-365`). Interval stored in `timerRef.current` — Timer Integrity invariant held (no re-render drift).
- **Per-question timer:** `qTimerRef` (`quiz/page.tsx:409-416`), `questionTimer` seconds.
- **Answer select:** `selectAnswer` (`quiz/page.tsx:604`) tracks `changedAnswersCount`.
- **Confirm:** `confirmAnswer` (`quiz/page.tsx:612`). In v2 mode `is_correct` is recorded provisionally `false` (client does not know the answer — server is source of truth, `quiz/page.tsx:629`). In legacy mode `is_correct = (selected_option === correct_answer_index)`.
- **Response shape:** pushed to `responses[]` with `question_id, selected_option, is_correct, time_spent, error_type, shuffle_map: null, telemetry` (`quiz/page.tsx:665-680`).
- **Written answers (SA/MA/LA):** `handleWrittenSubmit` calls `ncert-question-engine` Edge Function; "correct" if `marks_awarded >= 50% of marks_possible` (`quiz/page.tsx:765`). On eval failure, student is NOT punished — retry/skip offered (`quiz/page.tsx:750-758`).

### Step 4 — Anti-cheat checks (client, P3) — `nextQuestion()` on last question
Enforced in `quiz/page.tsx:886-933`:
1. **Speed (REJECT):** `avgTimePerQ = timer / totalResponses; if (totalResponses > 0 && avgTimePerQ < 3)` → set score 0 / XP 0, go to results, **do NOT call server** (`quiz/page.tsx:893-908`). Applies to ALL response types (the previous `mcqResponses.length>0` bypass was removed — see comment 887-892).
2. **Pattern (FLAG, still submit):** all MCQ answers same index AND `mcqResponses.length > 3` → `console.warn` only (`quiz/page.tsx:913-918`).
3. **Count (REJECT):** `if (allResponses.length !== questions.length)` → score 0 / XP 0 / results, no server call (`quiz/page.tsx:920-933`).

### Step 5 — Submit dispatch
- **Caller:** `submitQuizResults(student.id, subject, grade, name, chapter, allResponses, timer, serverSessionId)` (`quiz/page.tsx:936-945`).
- **Dispatcher:** `supabase.ts:498`. Dedup guard (`_quizDedup`, 5-min window, `supabase.ts:499-501`).
  - **L1 (primary):** if `sessionId` present → `submit_quiz_results_v2` RPC (`supabase.ts:503-508`), payload mapped via `_mapV2` to `{question_id, selected_displayed_index, time_spent}` — strips client `is_correct`/`shuffle_map` (`supabase.ts:481-483`).
  - **L2 (legacy):** `submit_quiz_results` v1 RPC (`supabase.ts:509-518`).
  - **Fallback:** direct `quiz_sessions` insert + `atomic_quiz_profile_update` JSONB 6-arg (`supabase.ts:534-589`). Logged via `console.warn` (P4 fallback-must-not-be-silent held).
- **Note:** the live web client calls the RPC **directly** through `submitQuizResults`. The `/api/quiz/submit` server-only route (idempotency-keyed) exists and runs as passthrough until `ff_server_only_quiz_submit` flips ON (`api/quiz/submit/route.ts:1-10, 172-188`).

### Step 6 — Server scoring + atomic write (P1 + P2 + P3 + P4)
Inside **`submit_quiz_results_v2`** (baseline 7594-7886), the authoritative path:
- **Ownership:** `auth.uid()` must own `p_student_id` (7629-7634); session shuffle rows must belong to caller (7641-7647). P8/P9.
- **Pass 1 — re-derive correctness from SNAPSHOT, not live `question_bank`:** maps `selected_displayed_index` → original via `quiz_session_shuffles.shuffle_map`, compares to `correct_answer_index_snapshot` (7664-7689). This closes the P1+P6 content-edit drift bug class.
- **P3 server checks (all 3):** avg time < 3 → flag (7707-7711); all-same-answer if >3 → flag (7713-7722); response-count mismatch → flag (7724-7727).
- **P1 score:** `v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100)` (**7730**).
- **P2 XP:** flagged → 0; else `v_correct * 10` + (>=80 ? +20) + (=100 ? +50) (**7733-7739**).
- **DB writes:** `quiz_sessions` insert (7742-7750); per-question `quiz_responses`, `user_question_history`, `update_learner_state_post_quiz` (7797-7831).
- **P4 atomic XP/profile:** `PERFORM atomic_quiz_profile_update(p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_quiz_session_id)` (**7850-7852**) — single in-transaction call.
- **Mastery/CME:** `compute_post_quiz_action` (error-isolated, 7855-7867).
- **Returns** `{total, correct, score_percent, xp_earned, session_id, flagged, cme_*, questions[]}` — `questions[]` is the per-question review payload (canonical `correct_option_text`, 7836-7846, 7869-7883).

Inside **`atomic_quiz_profile_update` 7-arg void** (baseline 794-957) — the P2 daily-cap + ledger + streak step:
- **Daily cap source:** `SUM(amount) FROM xp_transactions WHERE daily_category='quiz' AND created_at >= IST midnight` (812-817).
- **Cap math:** `v_xp_to_award := GREATEST(0, LEAST(p_xp, 200 - v_today_quiz_xp))` (**821**). `200` hardcoded.
- **Idempotency:** `reference_id = 'quiz_' || p_session_id`, `ON CONFLICT (reference_id) DO NOTHING`, students.xp_total incremented only if a new ledger row inserted (824-873).
- **Profile counters + level:** upsert `student_learning_profiles`, `level = GREATEST(1, FLOOR(xp/500.0)+1)` (907-940).
- **Streak:** `students.streak_days` server-computed via `last_active::date` CASE (946-953) — never client-calculated.

### Step 7 — Results display (display-only, P1/P2 consistency)
`QuizResults.tsx`:
- **Score:** `const pct = results.score_percent` (**313**) — consumed from submission, NOT recomputed.
- **XP:** `results.xp_earned` rendered directly (StatCard line 445; share line 1238).
- **Daily-cap banner:** reads `results.xp_capped` + `results.xp_uncapped` (406-425) — numbers from server, P2 held.
- **Idempotent replay:** `results.idempotent_replay` suppresses celebration/XP animation (327, 333, 387-401).
- **Level name:** `getLevelName(calculateLevel(student.xp_total), isHi)` (347-348) — from `LEVEL_NAMES`/`LEVEL_NAMES_HI` constant, never hardcoded.
- **Server review authority:** correct-answer highlighting + correct-answer text come from `serverReview` (`correct_option_text`), never from local `options[correct_answer_index]` when the server payload is present (966-984, 1106-1117).
- **Sub-breakdowns (informational):** MCQ-vs-written subscore `Math.round((mcqCorrect/mcqResponses.length)*100)` (605) and per-Bloom percentages (919-942) are independent breakdown displays, NOT the headline score.

### Step 8 — Post-quiz progress propagation (client-orchestrated, fire-and-forget)
From `quiz/page.tsx` after submit:
- `refreshSnapshot()` (960), `invalidateDashboard` (962), bust rhythm cache (964).
- `updateChapterProgress` (969).
- `saveQuestionResponses` for all modes → `question_responses` table (977-990).
- `saveCognitiveMetrics` for cognitive mode (1000-1014).
- `exam_simulations` insert for exam mode (1021-1033).
- `track('quiz_completed', …)` analytics (1036-1042).
- Mastery (`bloom_progression`, `concept_mastery`/CME state) updated **server-side** inside the RPC via `update_learner_state_post_quiz` + `compute_post_quiz_action`.

---

## P1 — three-way score-formula parity points

| Site | File:line | Expression |
|---|---|---|
| TS pure fn | `src/lib/scoring.ts:18` | `total > 0 ? Math.round((correct / total) * 100) : 0` |
| v1 RPC | baseline `:7399` | `v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100)` |
| v2 RPC (primary) | baseline `:7730` | `v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100)` |
| QuizResults display | `QuizResults.tsx:313` | `const pct = results.score_percent` (consumes, no recompute) |

All three computing sites are arithmetically equivalent. `Math.round` (half-up toward
+∞) and Postgres `ROUND` (half-away-from-zero) **agree for all non-negative inputs**, and
score % is always ≥ 0 — so no divergence. (See Gap analysis SLC-3 for the parity-guard
recommendation.)

## P2 — XP literal-parity points (TS constant vs SQL literal)

| Constant | TS source (`xp-config.ts`) | SQL literal sites (current, non-legacy) |
|---|---|---|
| `quiz_per_correct = 10` | line 44 | baseline 7404, 7736; migrations 20260621/22/23 (`*10`) |
| `quiz_high_score_bonus = 20` | line 45 | baseline 7405, 7737, 3863; same migrations (`+20`) |
| `quiz_perfect_bonus = 50` | line 46 | baseline 7406, 7738, 3864; same migrations (`+50`) |
| `quiz_daily_cap = 200` | line 47 | baseline 821 (7-arg) + 723 (JSONB 6-arg); migrations 20260610, 20260623000600 |

The TS formula lives once in `calculateQuizXP` (`scoring.ts:25-31`). The SQL formula is
**duplicated as raw literals across ~8 live function bodies + 1 trigger** (baseline 3862-3864).
This is the primary P2 drift surface — see SLC-2.
