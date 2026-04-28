# Cognitive Model — Technical Specification for IP Filing

**Status**: Filed for IP examination, 2026-04-28
**Authoring scope**: Branch `docs/ip-filing-architecture`
**Source-of-truth**: This document cites only files committed to the Alfanumrik repository as of the filing date. Every concrete claim is annotated with `path:line`.

---

## 1. Abstract

The Alfanumrik cognitive engine is a layered, calibrated assessment system that estimates a CBSE (Central Board of Secondary Education) student's mastery, ability, and review schedule from raw quiz responses. Three classical models are composed: (i) **Bayesian Knowledge Tracing (BKT)** — a hidden-Markov model of skill acquisition with four parameters per learning objective, (ii) **Item Response Theory** in the **2-parameter logistic** form (IRT 2PL) — a psychometric model of item difficulty and discrimination, fit nightly via Iteratively Reweighted Least Squares (IRLS) from real student responses, and (iii) **SuperMemo SM-2** — a spaced-repetition algorithm that schedules review of mastered concepts to combat the Ebbinghaus forgetting curve. The composition is the novelty: BKT tracks per-LO mastery, IRT 2PL parameters are learned from production response data with a `n >= 30` calibration trust threshold, and a Fisher-information SQL RPC selects the next question maximally informative at the student's current ability θ. Three product invariants — score accuracy (P1), XP economy (P2), and anti-cheat (P3) — are mechanically locked across client (`src/lib/scoring.ts`), the quiz-results client function (`src/lib/supabase.ts`), the React results component (`src/components/quiz/QuizResults.tsx`), and the atomic SQL RPC (`atomic_quiz_profile_update()`). Every score change is written in a single transaction, with the daily XP cap enforced at the database layer (200 XP/day) and three anti-cheat checks duplicated client- and server-side.

## 2. Three-tier cognitive state

The cognitive engine maintains three tiers of state for each student. Each tier is a separate database surface with a separate update path, but the three are joined together at query time when Foxy or the quiz engine needs a unified view.

| Tier | Table | Granularity | Primary signal | Update path | Citation |
|------|-------|------------|----------------|-------------|---------|
| 1 | `concept_mastery` | per-(student, topic) | `mastery_probability ∈ [0,1]`, plus `next_review_date`, `ease_factor`, `sm2_interval`, `sm2_repetitions` for SM-2 scheduling | `update_learner_state_post_quiz()` per question, called from `submit_quiz_results()` | `supabase/migrations/_legacy/000_core_schema.sql:270-298` (schema); `supabase/migrations/20260408000001_add_p3_anticheat_checks_2_3.sql:168-178` (call site) |
| 2 | `student_skill_state` | per-(student, learning_objective) | `p_know ∈ [0,1]` BKT posterior, `p_learn`, `p_slip`, `p_guess`, plus IRT `theta` ∈ [-4, 4] and `theta_se` ≥ 0 | service-role write; ring buffer of last 20 responses | `supabase/migrations/20260427000100_misconception_ontology.sql:138-169` |
| 3 | `student_learning_profiles.irt_theta` | per-(student, subject) | overall ability θ on N(0,1) scale | `update_irt_theta()` trigger after each quiz | `supabase/migrations/20260408000012_irt_theta_estimation_rpc_and_trigger.sql:7-158` |

The three tiers separate three time-scales of inference:

- **Tier 1 (concept_mastery)** is the legacy topic-level granularity. It is updated synchronously inside the quiz-submission RPC and drives the spaced-repetition CTA and the `weakTopics`/`strongTopics`/`revisionDue` UI surfaces. Topic mastery is the smallest unit a typical CBSE chapter is decomposed into for the student-facing dashboard.
- **Tier 2 (student_skill_state)** is the new fine-grained per-learning-objective state. A "learning objective" (LO) is a single examinable skill within a chapter (e.g., `PHY-7-MOTION-LO-01`, `learning_objectives.code` at `migration:44-46`). One topic typically contains 3-7 LOs. The BKT parameters are stored *per LO* so the model can be calibrated per-LO from real response data when sample size accumulates (`bkt_calibrated_at`, `bkt_sample_n` at `migration:35-36`). The IRT theta on this row is per-LO ability.
- **Tier 3 (student_learning_profiles.irt_theta)** is the per-subject overall ability that the IRT 2PL calibration cron uses as the "student theta" input when fitting question parameters (see Section 4).

The three tiers are updated atomically per quiz via the `submit_quiz_results()` RPC at `supabase/migrations/20260408000001_add_p3_anticheat_checks_2_3.sql:22-238`. The RPC iterates the response array twice: once to count and run anti-cheat (`migration:60-111`), once to insert audit rows and call `update_learner_state_post_quiz()` per question (`migration:140-191`). The final `atomic_quiz_profile_update()` call (`migration:193-196`) updates students.xp_total in one transaction with the daily-cap clamp.

## 3. BKT model

Bayesian Knowledge Tracing represents a student's knowledge of a skill as a single binary hidden state ("knows the skill" / "does not know the skill"), updated after each observed response.

### 3.1 Parameters

Four parameters per learning objective, stored on `learning_objectives` (`supabase/migrations/20260427000100_misconception_ontology.sql:32-36`):

| Param | Default | Meaning | Citation |
|-------|---------|--------|---------|
| `bkt_p_learn` (P(T)) | 0.20 | Probability of transitioning from unknown to known on a practice opportunity | `migration:32`, prior justification `migration:50-51` (Pardos & Heffernan 2010 high-guess MCQ band) |
| `bkt_p_slip` | 0.10 | Probability the student knows the skill but answers wrong | `migration:33`, prior justification `migration:52-53` (Corbett & Anderson 1995) |
| `bkt_p_guess` | 0.25 | Probability the student does not know but answers right | `migration:34`, prior justification `migration:54-55` (4-option MCQ chance floor) |
| `bkt_p_learn` (initial) `student_skill_state.p_know` (P(L0)) | 0.10 | Prior probability student knows the skill before any practice | `migration:142, 163-164` (Corbett & Anderson 1995 cold-start) |

### 3.2 Update equation

After observing a response (correct or incorrect), the posterior `p_know` is updated and then the next-step prior is computed:

```
predicted = pKnow * (1 - pSlip) + (1 - pKnow) * pGuess
posterior =  isCorrect ? (pKnow * (1 - pSlip)) / predicted
                       : (pKnow * pSlip)       / (1 - predicted)
newPKnow  = posterior + (1 - posterior) * pLearn
```

Implementation at `src/lib/cognitive-engine.ts:883-898`. The function `bktUpdate()` returns the new `p_know`, the `predicted` probability of correctness (used downstream for ZPD calibration), and an *adapted* parameter set for the next observation:

- If correct AND `pKnow > 0.7`, `pLearn` is incremented by 0.01 (capped at 0.4) — speeds up the model when the student is fluent (`cognitive-engine.ts:892`).
- If incorrect AND `pKnow < 0.3`, `pLearn` is decremented by 0.01 (floor 0.05) — slows the model when the student is struggling (`cognitive-engine.ts:893`).
- If incorrect AND `pKnow > 0.8`, `pSlip` is incremented by 0.02 (capped at 0.3) — increases the slip probability when a fluent student errs (`cognitive-engine.ts:894`).
- If correct, `pSlip` is decremented by 0.005 (floor 0.02) (`cognitive-engine.ts:895`).

### 3.3 Calibration trust threshold

Per-LO BKT priors are recalibrated nightly when `bkt_sample_n >= 30` accumulated student responses are tied to the LO (specified at `migration:48-49` and `migration:55`). Below the threshold, the literature priors above are used. The threshold of 30 is the conventional minimum sample size for reliable per-LO MLE in the BKT calibration literature (Corbett & Anderson 1995; the threshold is documented inline at `migration:48`).

Calibration scope (`bkt_calibrated_at`) records the timestamp of the most recent successful fit. `bkt_sample_n` is the count of responses included in that fit. Selectors should never trust calibrated parameters when `bkt_sample_n < 30`; fallback to literature priors is automatic.

## 4. IRT 2PL model

Item Response Theory in the 2-parameter logistic form models the probability that a student with ability θ answers a question correctly.

### 4.1 Equations

```
P(y = 1 | θ) = sigmoid(a · (θ − b))
            = 1 / (1 + exp(−a · (θ − b)))

I(θ)         = a² · P · (1 − P)        ← Fisher information
```

where `a` (discrimination) is bounded `[0.3, 3.0]` and `b` (difficulty on the θ scale) is bounded `[-4.0, 4.0]`. Implementation in TypeScript at `src/lib/irt/fisher-info.ts:20-40` (twins of the SQL implementation for unit testing and client-side use). The Fisher information formula is standard (Lord 1980, ch. 9) and clipped away from 0/1 by 0.001 to avoid information collapse on floor/ceiling items relative to θ — see `fisher-info.ts:36-40` and the matching SQL clip at `supabase/migrations/20260428000600_select_questions_by_irt_info.sql:114-115`.

### 4.2 Calibration algorithm

The IRT 2PL parameters `(irt_a, irt_b, irt_calibration_n, irt_calibrated_at)` are fit nightly per question via the `recalibrate_question_irt_2pl()` PL/pgSQL function at `supabase/migrations/20260428000400_irt_2pl_calibration_impl.sql:29-225`. The algorithm is **Iteratively Reweighted Least Squares (IRLS / Fisher scoring)**, the standard numerical method for maximum-likelihood estimation in logistic regression.

The reparameterization is canonical: with `z = a·θ + (−a·b)`, let `α = a` and `β = −a·b`, then 2PL becomes ordinary logistic regression. IRLS solves it via WLS with weights `W_i = p_i · (1 − p_i)`:

```
z_i_working = (α · θ_i + β) + (y_i − p_i) / W_i
[α, β]      = WLS regression of z_i_working on (θ_i, 1)
a           = α
b           = −β / α
```

Specified at `migration:8-22`. Convergence: stop when `max(|Δα|, |Δβ|) < 1e-4` or 50 iterations (`migration:26, 154-156`). Items that fail to converge or have degenerate input (`v_correct_rate <= 0.02` or `>= 0.98`, or `v_theta_var < 1e-6`) leave `irt_a` / `irt_b` NULL so the selector falls back to the proxy (`migration:106-117, 160-170`).

### 4.3 Calibration trust threshold

The calibration cron processes only questions with `is_active = true` AND (`irt_calibrated_at IS NULL` OR `irt_calibrated_at < now() - interval '7 days'`) AND that have at least one `quiz_responses` row (`migration:71-81`). The default minimum-sample threshold is `p_min_attempts = 30` (`migration:31`). Below 30 responses, the function increments `v_questions_skipped` and leaves the row unchanged.

The trust threshold of 30 carries through to selection: selectors only consult `(irt_a, irt_b)` when `irt_calibration_n >= 30` (`migration 20260428000600:108-115`). Below 30, the proxy difficulty distance (Section 5) is used.

### 4.4 Calibration cron

The nightly job is wired in `vercel.json:33-36`:

```
{ "path": "/api/cron/irt-calibrate", "schedule": "50 2 * * *" }
```

The cron runs at 02:50 UTC (08:20 IST), 20 minutes after `daily-cron` so the day's `quiz_responses` are settled. The route is at `src/app/api/cron/irt-calibrate/route.ts:1-85`. Auth is via constant-time-compare against `CRON_SECRET` (`route.ts:24-42`); the route calls `recalibrate_question_irt_2pl(NULL, 30)` under the service role (`route.ts:51-54`).

## 5. Adaptive question selection

The `select_questions_by_irt_info()` SQL RPC at `supabase/migrations/20260428000600_select_questions_by_irt_info.sql:44-153` implements two-stage maximally-informative item selection.

### 5.1 Two-stage ranking

For a candidate question pool (filtered by subject/grade/optional chapter), each candidate is scored via:

| Stage | Condition | Score formula | Selection path |
|------|-----------|--------------|----------------|
| A — Fisher information | `irt_calibration_n >= 30 AND irt_a IS NOT NULL AND irt_b IS NOT NULL` | `a² · P · (1 − P) + 0.5` (the `+0.5` is the calibrated-item bonus) | `fisher_info` (`migration:127`) |
| B — Proxy distance | `irt_difficulty IS NOT NULL` | `1.0 / (1.0 + |θ − irt_difficulty|)` | `proxy_distance` (`migration:129`) |
| C — Last resort | neither calibrated nor proxy | `0.1` | `uncalibrated` (`migration:130`) |

Stages are unioned and sorted by `selection_score DESC, random()` and limited to `p_match_count`. The `+0.5` calibrated-item bonus (`migration:116`) ensures that when both paths return comparable numeric scores, the calibrated path wins ties, but a much better proxy match still beats a marginal calibrated fit.

### 5.2 Student theta input

The student's mean θ is computed on the fly: `SELECT COALESCE(AVG(theta), 0) FROM student_skill_state WHERE student_id = p_student_id` (`migration:78-81`). A student with no skill_state rows gets the N(0,1) prior mean of 0 (cold-start neutral).

### 5.3 Audit trail

The RPC returns both the score and the `selection_path` for every row (`migration:133-148`) so callers can audit how each item was selected. The expected operational query is `SELECT selection_path, COUNT(*) FROM (SELECT * FROM select_questions_by_irt_info(...) ) GROUP BY selection_path` to verify that `fisher_info` rows are dominant and the proxy fallback is exercised only at corpus edges (`migration:171-177`). The feature flag `ff_irt_question_selection` is shipped in the same migration (`migration:179-196`) and defaults OFF until ops confirms calibration data has accumulated.

### 5.4 TypeScript twin

The same Fisher-info computation is implemented as a TypeScript pure function at `src/lib/irt/fisher-info.ts:1-85`. The TS implementation lets unit tests assert the math (the SQL version is harder to test) and lets the super-admin diagnostics page render per-item "selection signal" badges client-side. The TS-↔-SQL parity is enforced by a reference test that calls both with the same `(theta, a, b)` inputs (`fisher-info.ts:8-11`).

## 6. SM-2 spaced repetition

The SuperMemo SM-2 algorithm schedules review of mastered concepts to combat the Ebbinghaus forgetting curve.

### 6.1 Schema

`concept_mastery` carries the SM-2 fields (`supabase/migrations/_legacy/000_core_schema.sql:284-296`):

| Column | Default | Meaning |
|-------|---------|--------|
| `next_review_at` (and `next_review_date`) | NULL / NULL | Date the next review is due |
| `review_interval_days` | NULL | Current interval in days |
| `ease_factor` | 2.5 | EF, governs interval growth on success |
| `consecutive_correct` | 0 | Repetitions counter |
| `sm2_interval` | 1 | SM-2 interval in days |
| `sm2_repetitions` | 0 | SM-2 repetitions counter |
| `quality_responses` | `'{}'` | History of recent quality scores 0-5 |
| `avg_quality` | NULL | Rolling average quality |

### 6.2 Update equations

Implementation at `src/lib/cognitive-engine.ts:162-188`:

- Quality `q ∈ {0,1,2,3,4,5}` is computed from (isCorrect, timeSpent, avgTime) at `cognitive-engine.ts:193-202`. Wrong answers map to 0 (complete blackout) or 1 (near miss). Correct answers map to 5/4/3 by speed.
- Repetition rule: if `q >= 3` (correct), the interval grows: `repetitions = 0 → 1d`, `repetitions = 1 → 6d`, `repetitions >= 2 → round(interval × easeFactor)`. If `q < 3` (incorrect), `repetitions` resets to 0 and `interval = 1d`.
- Ease-factor update: `EF' = EF + (0.1 - (5-q) · (0.08 + (5-q) · 0.02))`, floored at 1.3 (`cognitive-engine.ts:184-185`).
- Next-review computation: `nextReviewDate(interval)` adds `interval` days to today (`cognitive-engine.ts:207-211`).

### 6.3 Spaced-repetition CTA

The `revisionDue` dimension of the cognitive context (Doc 1 §3, dim 4) is populated by querying `concept_mastery` rows where `next_review_date <= now()`. When non-empty, Foxy receives a `CONCEPTS DUE FOR REVISION` prompt section (`src/app/api/foxy/route.ts:730-735`) that instructs the model to ask a quick recall question before teaching new content.

## 7. Misconception ontology

The misconception ontology is a three-table substrate that connects educational objectives to assessment items to per-student state. All three tables are defined in a single migration: `supabase/migrations/20260427000100_misconception_ontology.sql`.

### 7.1 Tables

| Table | Purpose | Citation |
|------|---------|---------|
| `learning_objectives` | Fine-grained CBSE skill per chapter; carries BKT priors and prerequisite-LO graph | `migration:23-39` |
| `question_misconceptions` | Maps each MCQ distractor to a named misconception code and an optional remediation pointer (chunk_id or concept_id) | `migration:96-108` |
| `student_skill_state` | Per-(student, LO) BKT/IRT state with last-20-response ring buffer | `migration:138-153` |

### 7.2 Editorial pipeline

The editorial substrate is the read-only view `misconception_candidates` at `supabase/migrations/20260428000500_misconception_candidate_view.sql:27-77`. It surfaces `(question_id, distractor_index)` pairs where:

- The pair is a distractor (`pq.distractor_index <> qb.correct_answer_index`)
- Total response count `>= 10` (noise floor at `migration:67`)
- Wrong picks `>= 3` (`migration:68`)
- Wrong-rate `>= 10%` (`migration:69`)

Editors sort by `wrong_rate DESC` and write a `misconception_code` + `label` into `question_misconceptions`. The view's `has_curated_misconception` boolean (`migration:57-61`) flags pairs already done so editors can skip them. The curator surface is at `src/app/super-admin/misconceptions/page.tsx`.

### 7.3 Runtime use

At quiz-submission time, the wrong-pick is joined to `question_misconceptions` to identify which misconception the student exhibited; the misconception is aggregated per-(student, code) into the `recentMisconceptions` cognitive-context dimension that drives Foxy's `MISCONCEPTION_REPAIR` mode (Doc 1 §3, dim 7).

### 7.4 RLS and write authority

All three tables have RLS enabled in the same migration (P8 invariant). `learning_objectives` and `question_misconceptions` allow authenticated read; writes are reserved for `service_role` (i.e., super-admin curators via service-role context). `student_skill_state` has three SELECT policies — student-self (`migration:189-199`), parent-of-linked-child (`migration:202-216`), teacher-of-assigned-student (`migration:219-234`) — and writes are reserved for service-role (the BKT update RPC runs in service-role context).

## 8. XP economy (P2)

The XP rules are defined at `src/lib/xp-rules.ts:49-79` (the file's exports are deprecated in favor of `score-config.ts` + `coin-rules.ts`, but the legacy values remain in force during migration as the `submitQuizResults` and `atomic_quiz_profile_update()` paths still reference them — see `xp-rules.ts:14-21`).

| Rule | Constant | Value |
|------|---------|------|
| Per-correct quiz XP | `XP_RULES.quiz_per_correct` | 10 |
| High-score bonus (≥ 80%) | `XP_RULES.quiz_high_score_bonus` | 20 |
| Perfect-score bonus (= 100%) | `XP_RULES.quiz_perfect_bonus` | 50 |
| Daily quiz XP cap | `XP_RULES.quiz_daily_cap` | 200 |

Citation: `xp-rules.ts:57-59`.

The XP formula is:

```
xp_earned = (correct * XP_RULES.quiz_per_correct)
          + (score_percent >= 80 ? XP_RULES.quiz_high_score_bonus : 0)
          + (score_percent === 100 ? XP_RULES.quiz_perfect_bonus : 0)
```

Implementation at `src/lib/scoring.ts:25-31`. The same formula is duplicated server-side in the `submit_quiz_results()` PL/pgSQL RPC at `supabase/migrations/20260408000001_add_p3_anticheat_checks_2_3.sql:117-123`. The two implementations are tested for parity; if they ever drift, P2 is violated and the regression catalog flags the change.

The 200 XP daily cap is enforced **at the database layer**, not at the application layer, by the `atomic_quiz_profile_update()` RPC at `supabase/migrations/20260427000003_enforce_daily_xp_cap.sql:60-130`. The RPC computes `today_earned = sum(quiz_sessions.xp_earned) where completed_at >= CURRENT_DATE` (`migration:23-29`) and clamps `effective_xp = LEAST(p_xp, GREATEST(0, 200 - today_earned))` (`migration:34-35`). Excess XP is reported via the new JSONB return shape's `xp_capped` and `xp_excess` fields. Database-layer enforcement is required because a malicious or buggy client could otherwise spam quiz submissions.

## 9. Score formula (P1)

```
score_percent = Math.round((correct_answers / total_questions) * 100)
```

This formula is the **first product invariant (P1)** at `.claude/CLAUDE.md` and is identical across three implementations:

| Surface | File | Line |
|---------|------|------|
| Pure function (single source of truth) | `src/lib/scoring.ts` | 17-19 |
| Client `submitQuizResults()` (consumes the RPC return shape but recomputes for the fallback path) | `src/lib/supabase.ts` | 348 |
| React results component (reads `results.score_percent` from server) | `src/components/quiz/QuizResults.tsx` | 54, 208 |
| SQL RPC `submit_quiz_results()` | `supabase/migrations/20260408000001_add_p3_anticheat_checks_2_3.sql` | 113-114 |

`src/lib/scoring.ts:17-19` is the **single source of truth** in TypeScript:

```
return total > 0 ? Math.round((correct / total) * 100) : 0;
```

The SQL RPC uses the same expression: `v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100)` (`migration:114`). The two are kept in lock-step by review-chain enforcement — any change to scoring requires `assessment` agent review, which validates parity with `.claude/skills/review-chains/SKILL.md`. The React component never recomputes the score; it consumes `results.score_percent` directly from the server response (`QuizResults.tsx:54, 208`), so client-side drift cannot occur.

The `total > 0 ? ... : 0` guard prevents division-by-zero when a quiz session has zero responses (the SQL RPC has the equivalent guard at `migration:82-87`).

## 10. Anti-cheat (P3)

Three checks, enforced both client-side and server-side. The product invariant is at `.claude/CLAUDE.md` P3.

### 10.1 Client implementation

`src/lib/anti-cheat.ts:13-49`:

| # | Check | Predicate | File:Line |
|---|------|----------|-----------|
| 1 | Minimum 3s average per question | `(totalSeconds / questionCount) >= 3` | `anti-cheat.ts:13-17` |
| 2 | Not all-same-answer if more than 3 questions | `Math.max(...counts) < responses.length` (small quizzes ≤ 3 are exempt) | `anti-cheat.ts:19-27` |
| 3 | Response count equals question count | `responseCount === questionCount` | `anti-cheat.ts:29-32` |

The combined `validateAntiCheat()` at `anti-cheat.ts:35-50` returns `{ valid: false, reason: 'speed_hack' | 'same_answer_pattern' | 'count_mismatch' }` so the caller can surface a specific reason.

### 10.2 Server implementation

The same three checks live in PL/pgSQL inside `submit_quiz_results()` at `supabase/migrations/20260408000001_add_p3_anticheat_checks_2_3.sql:89-111`:

| # | Check | PL/pgSQL location |
|---|------|-------------------|
| 1 | Minimum 3s average | `migration:89-93` (`v_avg_time := p_time::NUMERIC / v_total; IF v_avg_time < 3.0 ...`) |
| 2 | Not all-same-answer if `v_total > 3` | `migration:96-104` (tracked via `v_answer_counts INT[]`, `v_max_same_answer INT`, sets `v_flagged := true` when `v_max_same_answer = v_total`) |
| 3 | Response count equals submitted count | `migration:106-111` (`IF jsonb_array_length(p_responses) != v_total THEN v_flagged := true`) |

### 10.3 Consequence of flagging

When the server flags a submission, XP is set to 0 (`migration:117-118`: `IF v_flagged THEN v_xp := 0`). The submission still records a `quiz_sessions` row and `quiz_responses` audit trail (so the student can still see their wrong answers in the post-quiz review), but no XP is awarded and no level-up occurs.

### 10.4 Client-server duplication rationale

All three checks run client-side first as a UX optimization (a fast-fail prevents a wasted round-trip). They also run server-side as the *enforcement* boundary — the server is the only authoritative path because the client could be modified by a determined cheater. The duplication is required by P3.

The `migration 20260408000001` was specifically authored to close a gap where only check 1 was enforced server-side; checks 2 and 3 were previously client-only (specified at `migration:1-19`). Today all three are enforced at both layers.

---

## Appendix A — Map of files referenced in this document

| Concept | File | Lines |
|---------|------|------|
| BKT pure functions | `src/lib/cognitive-engine.ts` | 873-898 |
| SM-2 algorithm | `src/lib/cognitive-engine.ts` | 162-211 |
| IRT 3PL θ MLE (Newton-Raphson) | `src/lib/cognitive-engine.ts` | 845-872 |
| IRT 2PL Fisher info pure functions | `src/lib/irt/fisher-info.ts` | 1-85 |
| IRT 2PL calibration RPC (IRLS) | `supabase/migrations/20260428000400_irt_2pl_calibration_impl.sql` | 29-225 |
| IRT calibration columns on question_bank | `supabase/migrations/20260427000200_irt_calibration_columns.sql` | 14-46 |
| Adaptive selection RPC | `supabase/migrations/20260428000600_select_questions_by_irt_info.sql` | 44-153 |
| Misconception ontology schema | `supabase/migrations/20260427000100_misconception_ontology.sql` | 23-236 |
| Misconception candidate view | `supabase/migrations/20260428000500_misconception_candidate_view.sql` | 27-77 |
| `concept_mastery` legacy schema | `supabase/migrations/_legacy/000_core_schema.sql` | 270-298 |
| IRT theta per-subject trigger | `supabase/migrations/20260408000012_irt_theta_estimation_rpc_and_trigger.sql` | 7-158 |
| Quiz submission RPC (P1, P2, P3) | `supabase/migrations/20260408000001_add_p3_anticheat_checks_2_3.sql` | 22-238 |
| Daily XP cap RPC | `supabase/migrations/20260427000003_enforce_daily_xp_cap.sql` | 60-130 |
| Score formula pure function | `src/lib/scoring.ts` | 17-31 |
| Anti-cheat client | `src/lib/anti-cheat.ts` | 13-50 |
| XP rules constants | `src/lib/xp-rules.ts` | 49-79 |
| IRT calibration cron route | `src/app/api/cron/irt-calibrate/route.ts` | 1-85 |
| Vercel cron schedule | `vercel.json` | 33-36 |

## Appendix B — Constants

| Constant | Value | File:Line |
|---------|------|-----------|
| BKT cold-start `p_know` (P(L0)) | 0.10 | `migration 20260427000100:142, 163-164` |
| BKT default `p_learn` (P(T)) | 0.20 | `migration 20260427000100:32` |
| BKT default `p_slip` | 0.10 | `migration 20260427000100:33` |
| BKT default `p_guess` | 0.25 | `migration 20260427000100:34` |
| BKT calibration trust threshold | sample_n ≥ 30 | `migration 20260427000100:48-49` |
| IRT 2PL `a` bounds | [0.3, 3.0] | `migration 20260428000400:24, 180` |
| IRT 2PL `b` bounds | [-4.0, 4.0] | `migration 20260428000400:24, 181` |
| IRT 2PL θ bounds | [-4, 4] | `cognitive-engine.ts:861`; `migration 20260427000100:160` |
| IRT 2PL `theta_se` cold-start | 1.5 | `migration 20260427000100:147, 161-162` |
| IRT calibration trust threshold | calibration_n ≥ 30 | `migration 20260428000600:108`; `migration 20260428000400:31` |
| IRT calibrated-item bonus | +0.5 | `migration 20260428000600:116` |
| IRT calibration convergence tolerance | 1e-4 | `migration 20260428000400:26, 154` |
| IRT calibration max iterations | 50 | `migration 20260428000400:26, 123` |
| IRT calibration cron schedule | `50 2 * * *` (02:50 UTC daily) | `vercel.json:35` |
| SM-2 ease factor floor | 1.3 | `cognitive-engine.ts:185` |
| SM-2 ease factor default | 2.5 | `migration _legacy/000_core_schema.sql:286` |
| `XP_RULES.quiz_per_correct` | 10 | `xp-rules.ts:57` |
| `XP_RULES.quiz_high_score_bonus` | 20 | `xp-rules.ts:58` |
| `XP_RULES.quiz_perfect_bonus` | 50 | `xp-rules.ts:59` |
| `XP_RULES.quiz_daily_cap` | 200 | `xp-rules.ts:59` (legacy literal); enforced `migration 20260427000003:75` |
| Anti-cheat min avg time | 3.0s | `anti-cheat.ts:16`; `migration 20260408000001:91` |
| Misconception candidate noise floor | total ≥ 10, wrong ≥ 3, wrong-rate ≥ 0.10 | `migration 20260428000500:67-69` |

## Appendix C — Glossary

- **BKT**: Bayesian Knowledge Tracing (Corbett & Anderson 1995). Hidden Markov model with parameters P(L0), P(T), P(slip), P(guess).
- **IRT**: Item Response Theory. The 2-parameter logistic (2PL) model uses parameters `(a, b)` for discrimination and difficulty respectively.
- **IRLS**: Iteratively Reweighted Least Squares. Standard numerical method for MLE of generalized linear models, used here to fit IRT 2PL.
- **Fisher information**: I(θ) = a²·P·(1−P) for 2PL. Higher = item is more discriminating at the given ability.
- **SM-2**: SuperMemo-2 spaced repetition algorithm (Wozniak 1990). Schedules reviews based on quality of last response.
- **Learning objective (LO)**: A fine-grained, examinable CBSE skill within a chapter, identified by stable code (e.g., `PHY-7-MOTION-LO-01`).
- **θ (theta)**: Student ability on the N(0,1) IRT scale, bounded [-4, 4].
- **NCERT**: National Council of Educational Research and Training. Publishes the textbooks that define the CBSE curriculum.
