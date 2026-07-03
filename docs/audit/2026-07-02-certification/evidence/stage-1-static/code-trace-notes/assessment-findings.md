# Assessment Domain — Independent Certification Findings (Stage 1, Static)

**Agent:** assessment
**Scope:** P1-P6 invariants, exam engine, cognitive engine, Pedagogy v2, adaptive loops, CBSE/Bloom's content rules, question bank quality, assessment-adjacent business rules.
**Method:** Direct re-reading of current source (not the constitution's narrative, not `07-business-rules-journeys.md` / `12-business-workflows.md` except as a cross-check pointer). All file:line citations below were read directly in this session.
**Date:** 2026-07-02

Confidence scale: HIGH (read the exact enforcing code/constraint) / MEDIUM (read strong indirect evidence) / LOW / NOT VERIFIED-DEFERRED.
Risk-impact scale: Blocker / Should-Fix-Before-Release / Post-Release-Acceptable / Informational. Tier-0 = touches P1-P6, payments, auth, AI.

---

## Part A — 14 Business-Rule Verdicts

### 1. P1 Score Accuracy

**Verdict: VERIFIED — Verified**

`score_percent = Math.round((correct/total)*100)` is byte-identical across every scoring site I read directly:

- Client pure fn: `src/lib/scoring.ts:17-19` — `calculateScorePercent()`.
- Client fallback path: `src/lib/supabase.ts:534` (`submitQuizResults()` calls `calculateScorePercent`).
- Server RPC v1 (`submit_quiz_results`): `supabase/migrations/20260702150000_p3w1_5_quiz_rpc_ownership_check.sql:261` — `v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);`
- Server RPC v2 (`submit_quiz_results_v2`, current live def): `supabase/migrations/20260623000500_reapply_submit_quiz_v2_column_fix.sql:246` — identical formula, explicitly commented `-- P1: score_percent = ROUND((v_correct / v_total) * 100).`
- Display: `src/components/quiz/QuizResults.tsx:314` — `const pct = results.score_percent;` reads the value from the submission response prop; no local `(correct/total)` recompute found anywhere in the file except unrelated per-question-type breakdown stats (`QuizResults.tsx:623,626,854,945` — these compute MCQ/written sub-score displays and Bloom-band percentages, NOT the headline score; they use the same `Math.round(x/y*100)` shape but are additive breakdowns, not a P1 override).

Confidence: HIGH. Risk-impact: n/a (compliant).

### 2. P2 XP Economy

**Verdict: VERIFIED — Verified**

All XP constants live in `src/lib/xp-config.ts:37-67` (`XP_RULES`), re-exported from the shim `src/lib/xp-rules.ts:26`. `quiz_per_correct=10`, `quiz_high_score_bonus=20`, `quiz_perfect_bonus=50`, `quiz_daily_cap=200` (`xp-config.ts:44-47`). `XP_PER_LEVEL=500` (`xp-config.ts:71`).

Server literal-parity: both live `atomic_quiz_profile_update` overloads and both `submit_quiz_results`/`submit_quiz_results_v2` RPC bodies hardcode `10`/`20`/`50`/`200`/`500` as SQL literals (necessarily — PL/pgSQL cannot import a TS module) with explicit comments tying them back to `XP_RULES` (e.g. `supabase/migrations/20260702150000_...sql:471` `v_daily_cap INT := 200; -- mirrors XP_RULES.quiz_daily_cap`; `...sql:266-268` `v_xp := v_correct * 10; ... +20 ... +50`). This SQL/TS parity is exactly the drift class REG-48 exists to catch (per the constitution) — I did not re-run that test, but the literals I read directly match.

**Grep for hardcoded XP-looking numeric literals outside `xp-config.ts`:** ran `grep -rn "* 10\|+ 20\|+ 50"` equivalents against `src/components/quiz/` and `src/app/quiz/` per the quiz-integrity skill's own prescribed command — none found (QuizResults.tsx only reads `results.xp_earned` from the submission response, never recomputes). The only places `10`/`20`/`50`/`200` appear as XP-shaped literals are the SQL migration bodies, which is expected/necessary and each is commented as mirroring the TS constant.

Confidence: HIGH. Risk-impact: n/a (compliant).

### 3. P3 Anti-Cheat

**Verdict: VERIFIED with a documented behavioral nuance — Verified (server-authoritative; client is advisory-only by design)**

Server (both `submit_quiz_results` v1 and `submit_quiz_results_v2`, current live definitions) implements all three checks identically:
1. Avg time < 3s → flag: `20260702150000_...sql:242-245` (v1), `20260623000500_...sql:224-227` (v2).
2. All-same-answer when >3 questions → flag: `...sql:247-255` (v1), `224-238`→`230-238` (v2).
3. Response count mismatch → flag: `...sql:257-259` (v1), `241-243` (v2).
A flagged submission still records the session with the real score but zeroes XP (`v_xp := 0` — v1 line 264, v2 line 250).

Client (`src/app/quiz/page.tsx:927-970`) computes the identical three thresholds (avg<3s, all-same-index>3 MCQ, count≠count) but — per an explicit "SLC-5" comment block (lines 927-937) — treats them as **advisory-only telemetry (`console.warn`)**, never rejecting or zeroing the submission client-side; it always calls `submitQuizResults()` regardless. This is a documented, deliberate divergence from the constitution's literal wording ("Three checks, client-side and server-side" implying symmetric enforcement) — the client no longer *enforces* (reject/zero), it only *detects and logs*, with the server as sole authority. The regression catalog's own SLC-5 entry (`.claude/regression-catalog.md` — "Remediation — SLC-5: Anti-Cheat Advisory Convergence (P3) — 2026-06-30", line ~6084) documents this exact convergence as intentional, so this is NOT an undocumented regression, but it is a real behavioral shift from the literal P3 wording that should be reflected precisely if P3's text is ever re-audited word-for-word.

Confidence: HIGH. Risk-impact: Informational (intentional, catalogued change; server remains the authority so no P3 defeat).

### 4. P4 Atomic Quiz Submission

**Verdict: VERIFIED — Verified, with 3-layer fallback that is itself atomic and logged**

`submitQuizResults()` (`src/lib/supabase.ts:501-626`) dispatches: L1 `submit_quiz_results_v2` RPC (single transaction, session-shuffle authoritative) → L2 `submit_quiz_results` v1 RPC (single transaction) → L3 client-side fallback that still routes XP/profile writes through the **same** `atomic_quiz_profile_update` 7-arg RPC (`supabase.ts:566-574`), logged via `console.warn` at every fallback boundary (lines 518, 520, 594). The only non-atomic tail is a documented last-resort upsert (`supabase.ts:601-608`) reached ONLY if the RPC call itself throws (not merely returns an error) — explicitly commented as "DEGRADED LAST-RESORT," does not enforce the daily cap, and is scoped to session-counter preservation only. This matches the constitution's "separate operations only as logged fallback" carve-out.

Both `atomic_quiz_profile_update` overloads (`20260702150000_...sql:456-563` [6-arg] and `570-805` [7-arg]) are each single `LANGUAGE plpgsql` functions wrapping their multi-table writes (ledger insert, `students.xp_total`, `student_learning_profiles` upsert, streak, `state_events` insert) inside one function invocation — Postgres executes a function body as one implicit transaction absent explicit sub-transactions, so this is atomic per the invariant's intent.

Confidence: HIGH. Risk-impact: n/a (compliant).

### 5. P5 Grade Format

**Verdict: VERIFIED — Verified at both DB and app layers**

- `students.grade` — `"text" NOT NULL` (`supabase/migrations/00000000000000_baseline_from_prod.sql:11597`).
- `question_bank.grade` — `"text" NOT NULL` with an explicit CHECK: `chk_question_bank_grade_p5 CHECK (grade = ANY (ARRAY['6','7','8','9','10','11','12']))` (`baseline_from_prod.sql:2126,2223`).
- App-level oracle re-validates grade format on any AI-generated candidate that passes one through: `src/lib/ai/validation/quiz-oracle.ts:283-290` (`VALID_GRADE_RE = /^[6-9]$|^1[0-2]$/`).
- Spot-checked dual-key RPCs (`get_available_subjects`, `get_available_subjects_v2`, `available_chapters_for_student_subject_v2`) — all take `p_student_id uuid`, not grade-as-integer.

No integer-typed grade field found in any spot-checked RPC/table. Confidence: HIGH. Risk-impact: n/a (compliant).

### 6. P6 Question Quality

**Verdict: PARTIALLY VERIFIED — DB-level enforcement is narrower than the app-level oracle; both exist but do not fully overlap**

**DB-level (`question_bank` table CHECK constraints, `baseline_from_prod.sql:2123-2230`):**
- `chk_four_options CHECK (jsonb_array_length(options) = 4)` — line 2221 (length only, NOT distinctness or non-empty-string).
- `chk_valid_answer_index CHECK (correct_answer_index BETWEEN 0 AND 3)` — line 2227.
- `chk_question_not_empty CHECK (length(question_text) > 10)` — line 2224.
- `chk_question_bank_grade_p5` — line 2223.
- **Gap found:** `question_bank.difficulty` is `integer DEFAULT 1` with **no CHECK constraint** (line 2139); `question_bank.bloom_level` is `text` with **no CHECK constraint** (line 2140); `question_bank.explanation` is nullable `text` with **no NOT NULL / non-empty CHECK** (line 2136). None of the three P6 fields most central to CBSE pedagogical correctness (valid Bloom level, valid difficulty, non-empty explanation) are enforced by the database schema itself. (Contrast: a *different* table, `school_questions`, DOES carry `bloom_level`/`difficulty` CHECKs — lines 13430-13432 — so the pattern exists elsewhere but was not applied to the primary `question_bank` table.)

**App-level (the actual enforcement mechanism, REG-54):** `src/lib/ai/validation/quiz-oracle.ts` (`runDeterministicChecks()`, lines 187-352) is the real P6 gate for AI-generated content: text-empty/placeholder (191-200), exactly-4-distinct-non-empty options (202-227), index 0-3 (229-241), explanation non-empty (243-247), difficulty enum `easy|medium|hard` when provided (249-264), bloom_level in the canonical 6-value set when provided (266-277), grade format when provided (279-290), CBSE subject allowlist when provided (292-305), plus two extra semantic checks (option-overlap Jaccard, numeric consistency vs. explanation) beyond the constitution's literal P6 text. A Deno mirror exists at `supabase/functions/_shared/quiz-oracle.ts` for Edge Function callers (not independently re-read this session; flagging as NOT VERIFIED-DEFERRED whether it is byte-parity with the TS canonical — the file's own header claims it must be kept in sync).

Caveat: the oracle's difficulty/bloom checks are **conditional ("when provided")** — a candidate that omits those fields entirely is not rejected on that basis. Combined with the DB's total absence of a CHECK on those two columns, a question inserted via any path that bypasses the oracle (e.g., a hypothetical future direct-insert admin tool, or `bulk-question-gen`/`bulk-jee-neet-import` if those don't call the same oracle — NOT independently re-read this session) could theoretically carry an invalid `bloom_level`/`difficulty` with no structural barrier catching it.

Confidence: HIGH (oracle code + DB schema both read directly). Risk-impact: **Should-Fix-Before-Release** (add DB CHECK constraints for `bloom_level` and `difficulty` on `question_bank`, mirroring `school_questions`, as defense-in-depth — the oracle is a good first line but is app-level and conditional, not a structural guarantee) — not a Blocker because the oracle does cover the AI-generation path which is the dominant content-creation path per REG-54's own framing.

### 7. Subscription expiry during an active assessment

**Verdict: VERIFIED (behavior characterized) — Graceful, by omission**

Plan/subscription gating happens at **question-fetch time**, not submission time. `get_available_subjects`/`get_available_subjects_v2` (`baseline_from_prod.sql:8874`, `4182`) return an `is_locked` flag per subject based on grade × stream × plan; `src/app/api/student/subjects/route.ts:172-181` is the enforcement point that decides whether a subject/quiz can be **started**.

I read both live quiz-submission RPC bodies (`submit_quiz_results`, `submit_quiz_results_v2`, full text above) end-to-end and found **no subscription/plan-status check anywhere in the submission path** — only the new (2026-07-02) ownership check (`auth.uid()` = owning student) was added. This means: if a student's subscription lapses *while a quiz is in progress* (between fetch and submit), the submission itself is never blocked — the already-fetched quiz can be completed and scored normally, XP awarded per the normal formula. The quiz is not "cut off mid-session"; it degrades gracefully by simple absence of a gate, not by an explicit designed fallback.

I did not find any explicit design doc or code comment describing this as an intentional decision (unlike, e.g., the SLC-5 anti-cheat convergence, which IS explicitly documented). It reads as accidental-graceful rather than designed-graceful.

Confidence: MEDIUM (read the full submission-path code; did not find a negative — "no such check exists" is proven by absence across two RPC bodies I read completely, but I did not exhaustively trace every conceivable interception point such as middleware-level plan checks on `/api/quiz` specifically for the POST/submit action). Risk-impact: **Informational** (favors availability/UX over strict enforcement; worst case is one already-started quiz completes post-lapse — low business exposure).

### 8. Adaptive progression (IRT/BKT-driven question selection)

**Verdict: BROKEN CLAIM IN DOCUMENTATION — the documented "live, ON @100%" IRT path does not exist; the actual live path is a *different*, separately-flagged, currently-OFF mechanism**

This is a significant finding. Two distinct IRT-adjacent code paths exist and must not be conflated:

**(a) The Edge Function path (`supabase/functions/quiz-generator/index.ts`), gated by `ff_irt_question_selection`:**
- `isIRTSelectionEnabled()` (would read the `ff_irt_question_selection` DB flag) and `selectQuestionsByIRT()` (would call the `select_questions_by_irt_info` SQL RPC) are both defined at `quiz-generator/index.ts:370-414` — **but this entire block is INSIDE an unclosed `/**` JSDoc comment** that opens at line 360 (`/** Select questions using the student's concept_mastery data...`) and does not close until line 416 (`*/`). Both functions are dead — they are comment text, not executable code; `isIRTSelectionEnabled` is never called anywhere in the file (confirmed via grep — zero call sites).
- The actual gating variable at the call site is hardcoded: `quiz-generator/index.ts:1246` — `const useIRT = false` — and the "IRT questions" array it would use is also hardcoded empty: line 1248 `const irtQuestions: any[] = []`. Even if `useIRT` were flipped to `true`, `irtQuestions.length >= adaptiveSlots` (line 1249) would essentially never be satisfied since the array is always `[]`. This is a non-functional stub, not merely a flag-gated-off feature.
- Despite this, `src/lib/flags/registries/pedagogy.ts:168-169` contains a comment asserting `ff_irt_question_selection` "**is ON @100 in prod** and gates the nightly-calibrated SQL-RPC IRT path" — this claim is **not supported by the code** I read; the only application-code call site of the `select_questions_by_irt_info` RPC is inside the dead comment block (grep confirmed: only `src/lib/irt/fisher-info.ts`, test files, and `database.types.ts` reference it elsewhere — none of which are live callers).

**(b) The live TypeScript path (`src/lib/adaptive/select-adaptive-questions.ts`), gated by a DIFFERENT flag `ff_adaptive_live_selection_v1`:**
- This module's own header (lines 1-9) explicitly documents (a) as dead: *"This is the application-TypeScript lift of the (dead, off-path) selectAdaptiveQuestions logic in supabase/functions/quiz-generator/index.ts. The edge-function version is commented-out inside a /* */ block and never runs in production."*
- It IS wired into the live quiz path: `src/lib/supabase.ts:1409-1482` (`getQuizQuestionsV2`), gated behind `flags[ADAPTIVE_LIVE_SELECTION_FLAGS.V1]` (i.e. `ff_adaptive_live_selection_v1`), and internally ranks candidates using an IRT-**proxy** score (`computeSelectionScore` from `src/lib/irt/fisher-info.ts`, not the SQL RPC).
- This flag is seeded **OFF**: `supabase/migrations/20260622090000_seed_ff_adaptive_live_selection_v1.sql:69-80` — `is_enabled: false, rollout_percentage: 0`.

**Net conclusion:** Adaptive/IRT-informed question selection is **NOT currently active in production** by default. The Edge Function IRT path is dead code (not merely disabled), and its `ff_irt_question_selection` flag's "ON @100%" documentation claim in `pedagogy.ts` does not correspond to any live behavior I could find. The genuinely live adaptive mechanism is the separate, correctly-fail-safe-designed `ff_adaptive_live_selection_v1` path, which is seeded OFF and requires an explicit operator flip to activate.

Confidence: HIGH (read both code paths directly, including the exact comment-block boundaries and the flag seed value). Risk-impact: **Should-Fix-Before-Release** (documentation/reality mismatch — `pedagogy.ts:168-169`'s claim should be corrected or the dead code in `quiz-generator/index.ts:360-416` should be removed/un-commented to match intent; this is a Tier-0-adjacent finding because it affects how confidently the platform can claim "adaptive learning" to CBSE stakeholders, though it is not itself a live defect since nothing currently relies on the dead path).

### 9. Quiz attempt limits

**Verdict: VERIFIED (absence confirmed) — No explicit max-attempts-per-quiz-per-day rule exists**

Grepped for attempt-limit patterns across `src/app/api/quiz/` and broader XP/quota vocabulary — found none. The only per-day throttle touching quizzes is the **XP daily cap** (200 XP/day, enforced in `atomic_quiz_profile_update`, both overloads), which is an economic throttle (additional quizzes past the cap earn 0 XP) not an attempt-count block — a student can submit unlimited quiz sessions per day; each is scored and recorded normally, only XP accrual stops.

Confidence: MEDIUM (grep-based absence check across the quiz API surface + broader keyword search; did not exhaustively check every RPC for a hidden per-quiz-id cooldown). Risk-impact: Informational (design choice, not a defect — consistent with a mastery-practice model where repetition is encouraged).

### 10. Leaderboard rules

**Verdict: PARTIALLY VERIFIED — ranking formula confirmed; a scope-param bug found; no privacy opt-out found**

Ranking formula (`get_leaderboard` RPC, `baseline_from_prod.sql:4639-4642`): `total_xp = COALESCE(SUM(daily_activity.xp_earned), 0)` over a period window (`daily`→today, `weekly`→7d, `monthly`→30d, else→all-time), filtered to `students.is_active = true`, `HAVING total_xp > 0`, `ORDER BY total_xp DESC`. **Tie-breaking:** none — `ROW_NUMBER() OVER (ORDER BY ... DESC)` with no secondary sort key, so ties resolve to Postgres's non-deterministic row order. Minor correctness gap (ranks could shuffle between identical requests for tied students).

**Bug found:** `src/app/api/v2/student/leaderboard/route.ts:47-56` accepts a `scope` query param (`school` | `global`) and includes it in the response envelope (line 79 `scope,`), but **never passes it to the RPC** — `get_leaderboard` (line 53-56) is called with only `p_period`/`p_limit`; the underlying RPC itself has no school-scoping parameter at all (confirmed by reading its full definition — it joins `students`/`daily_activity` platform-wide with no `school_id` filter). A caller requesting `scope=school` silently receives the **global** leaderboard while the response claims `scope: 'school'`.

**Opt-out/privacy:** No `leaderboard_opt_out`/`show_on_leaderboard`-style column or check found anywhere in the schema or route code (targeted grep across the full repo returned no real hits). Every active student with positive XP in the period appears, with `name`, `grade`, `school`, `city`, `streak`, `avatar_url` exposed (per the v2 route's own explicit field list, line 64-74) to any authenticated student calling this endpoint — this is a platform-wide (not school-scoped, given the `scope` bug above) roster of PII-adjacent fields with no consent mechanism.

Confidence: HIGH (read RPC body + both API routes in full). Risk-impact: **Should-Fix-Before-Release** for the `scope` param bug (misleading API contract; low severity since it fails toward *more* exposure, not less — a caller expecting school-only privacy gets global instead, which is a privacy regression relative to their intent, but the whole leaderboard is public within the platform already). **Post-Release-Acceptable** for the missing opt-out (common for gamified EdTech, but worth a product decision — flagging as a P13-adjacent open question, not a code defect since P13's own definition is scoped to "no PII in logs/Sentry" and "role-based data access," neither of which strictly requires a leaderboard opt-out).

### 11. Coupon logic / Referral logic

**Verdict: NOT IMPLEMENTED — schema exists, zero live application code**

`public.coupons` table exists (`baseline_from_prod.sql:10842-10854`) with a reasonable schema for abuse limits: `discount_type`, `discount_value`, `max_uses`/`current_uses` (redemption cap), `valid_plans`, `min_amount`, `expires_at`, `is_active`; RLS policy `coupons_read` allows any row where `is_active = true` to be SELECTed (`baseline_from_prod.sql:20855`) — no redemption/write policy found. `public.referral_rewards` table exists (`baseline_from_prod.sql:13128`) with a `UNIQUE(referrer_id, referred_id)` constraint (line 15868, a genuine one-time-reward abuse guard) and `referrals_service_only` RLS restricting all access to `service_role` (line 21789). `students.referral_code` column exists (line 11621).

**I grepped the entire `src/` tree for `coupon_code`, `coupon`, `referral`, `promo_code`, `discount_code` (case-insensitive) and found zero application code (API routes, lib files, Edge Functions) that reads or writes `coupons` or `referral_rewards`** — the only non-schema hit was `supabase/functions/account-purge/index.ts:193`, which nulls a student's `referral_code` field during account deletion (a purge concern, not a redemption/reward concern).

**Conclusion:** neither system is reachable from any user-facing flow. I cannot certify discount-calculation correctness or abuse-limit enforcement (reuse prevention, referral-fraud checks) because there is no code path that applies a coupon or awards a referral to evaluate. The DB-level primitives that WOULD prevent obvious abuse (`max_uses`/`current_uses` counters, the referrer/referred UNIQUE constraint) are present and structurally sound, but inert.

Confidence: HIGH (repo-wide grep, zero application-layer matches). Risk-impact: **Informational** for security (nothing to exploit if nothing is wired), but flagging as a **product/documentation gap** — if any marketing or business material implies live coupon/referral functionality, that claim is false as of this reading.

### 12. Teacher permissions (scope of student-data access)

**Verdict: VERIFIED — class/school-scoped, RLS-enforced**

Spot-checked RLS policies (`baseline_from_prod.sql:19870-20246`): every teacher-facing policy I read scopes through an explicit join back to the teacher's own rows — e.g. `"Teachers can view students in their classes"` (line 20240) filters `class_id IN (SELECT ct.class_id ... teacher_id = <caller's teacher id>)`; `"Teachers can view links for their students"` (line 20228) similarly scopes `guardian_student_links` through the teacher's own `class_students` join; `"School admins can view school teachers"` (line 19911) scopes via `school_id IN (SELECT sa.school_id ...)`. No policy I read grants a teacher unscoped `SELECT` across all students or all schools. This is consistent with the constitution's RBAC/RLS design and I found no counter-evidence.

Confidence: MEDIUM (spot-checked ~10 of many teacher-related policies; did not exhaustively audit all teacher-touching tables/policies in the ~440-policy schema — full RLS audit is architect's domain per the constitution's ownership table, this is a business-rule sanity check only). Risk-impact: n/a for what was checked.

### 13. Parent isolation / School isolation / Multi-tenant safety (business-rule layer)

**Verdict: VERIFIED (business rule matches the RLS mechanism) — no legitimate app flow found that lets a parent see a non-linked child, or a school admin see another school**

`guardian_student_links.status = 'approved'` gates access consistently: e.g. the mastery-overview RPC guard I read directly (`baseline_from_prod.sql:4298`): `IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()) AND NOT EXISTS (SELECT 1 FROM guardian_student_links WHERE student_id = p_student_id AND guardian_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid()) AND status = 'approved') THEN RAISE EXCEPTION 'Access denied';` — this is the canonical "student themself OR an approved-linked guardian" pattern and I found it applied consistently everywhere I sampled. This matches the constitution's REG-117 claim (parent↔child approve-link boundary) at the business-rule level, re-derived independently rather than trusted.

Confidence: MEDIUM (same caveat as #12 — spot-checked, not exhaustive; full RLS/multi-tenant audit belongs to architect). Risk-impact: n/a for what was checked.

### 14. AI usage limits (per-plan Foxy/ncert-solver caps)

**Verdict: VERIFIED — Verified**

Daily quota table: `DAILY_QUOTA` (`src/app/api/foxy/_lib/constants.ts:64-69`) — `free: 10, starter: 30, pro: 100, unlimited: 999999`, with `normalizePlan()` (lines 103-109) collapsing legacy aliases (`basic→starter`, `premium→pro`, `ultimate→unlimited`) and stripping billing-cycle suffixes. Enforcement: `checkAndIncrementQuota()` (`src/app/api/foxy/_lib/quota.ts:22-48`) calls the atomic `check_and_record_usage` RPC (`baseline_from_prod.sql:1893`) which does an atomic check-and-increment (confirmed by reading the RPC signature: `RETURNS TABLE(allowed boolean, used_count integer)`), so there's no TOCTOU race between checking and incrementing. A `refundQuota()` helper (lines 57-82) gives back one count on genuine upstream failures (circuit-open, upstream error, chapter-not-ready) so a student doesn't lose quota to an error that wasn't their fault — this is a fairness feature, not a defeat of the cap. `UPGRADE_PROMPTS` (constants.ts:73-98) gives soft nudges near exhaustion, separate from the hard cap.

Confidence: HIGH. Risk-impact: n/a (compliant).

---

## Part B — Mandatory Re-Verification Worklist

### Worklist Item 1: `rhythm/today` surrogate-id bug (claimed fixed by `0fb51f06`)

**Verdict: CONFIRMED FIXED — all three sites patched, including the two RPC calls the salvage note specifically warned about**

Read the CURRENT `src/app/api/rhythm/today/route.ts` directly (not the diff):

1. **Student-row lookup** (the original bug): `route.ts:209-213` — `.from('students').select('id, grade, academic_goal, preferred_subject').eq('auth_user_id', userId)` — correctly resolves the surrogate `students.id` via `auth_user_id`, not `.eq('id', userId)`. Explicit comment at line 206-208 documents the fix rationale.
2. **`get_due_reviews` RPC call**: `route.ts:279-283` — `p_student_id: studentRow.id` (the resolved surrogate), not the raw `userId`. Comment at line 277-278 explicitly notes this table/RPC "FKs students.id (the surrogate), not the auth uid."
3. **`get_adaptive_questions` RPC call**: `route.ts:350-356` — `p_student_id: studentRow.id`. Comment at line 348-349: "Pass the resolved surrogate students.id, not the auth uid — same dual-key mismatch class as get_due_reviews above."

All three sites the salvage note warned about are fixed in the same file/commit — the warning was heeded, not partially addressed.

**Regression-catalog pinning check:** The commit message (`git show 0fb51f06`) references `src/app/api/rhythm/today-remediation-lane.test.ts` (17 existing + 4 new regression tests, "vitest 21/21"). I read that test file's header (lines 1-35) and confirmed it exercises the Phase A Loop A remediation-lane contract (flag-off byte-identical queue, caps/ordering, frozen item shape, never-500, P8 scoping) — it does NOT appear to be a dedicated `id` vs `auth_user_id` regression test the way `REG-223` is for the sibling `synthesis/state` fix. I searched `.claude/regression-catalog.md` for any entry referencing "rhythm/today," "Phase 3 Wave 1 #1," "surrogate," or the commit's own vocabulary and found **no dedicated catalog entry** for this specific fix (the catalog's most recent entries are REG-223..REG-225 for the sibling synthesis/dive fix, and REG-226 for the unrelated quiz-RPC ownership fix; nothing between them for rhythm/today). This is in contrast to the synthesis/state fix, which DID get a dedicated REG-223 entry with an argument-sensitive mock proving the exact `auth_user_id` vs `id` column used.

**This is a genuine gap, not a false claim of resolution** — the underlying bug IS fixed (confirmed above, HIGH confidence, direct code read), but the regression-catalog promotion that would prevent a future silent regression back to `.eq('id', userId)` on this specific route is missing. The 4 new unit tests in `today-remediation-lane.test.ts` provide some protection but were not written with the explicit argument-sensitive-mock pattern REG-223 uses, so I cannot confirm they would catch a future `auth_user_id`→`id` regression as reliably.

Confidence: HIGH (bug fix itself); MEDIUM (catalog-gap conclusion — based on keyword search of a 7000+ line file, not a line-by-line read). Risk-impact: **Should-Fix-Before-Release** — not a Blocker (the code is correct today), but the missing catalog entry is a process gap that should be closed to match the sibling fix's rigor, given this exact bug class has now recurred twice in one day (rhythm/today + synthesis/state) across the codebase.

### Worklist Item 2: S4 Foxy / S5 Weekly Dive / S6 Monthly Synthesis / S7 Leaderboard surrogate-id spot-check

**Verdict: CONFIRMED — no remaining surrogate-only-vs-raw-auth-uid mismatch found in the routes checked**

Read directly (not trusted from Phase 2's word):
- `src/app/api/dive/state/route.ts:152-168` — resolves `studentDbId` via `.eq('auth_user_id', userId)` before any child-table/RPC read; explicit comment (148-150) documents the surrogate-vs-auth-uid distinction.
- `src/app/api/dive/start/route.ts` (grep-confirmed) — lines 152-168 show the identical `.eq('auth_user_id', userId)` → `studentDbId` pattern feeding `get_due_reviews`.
- `src/app/api/dive/artifact/route.ts` (grep-confirmed) — lines 156-218 show the identical pattern feeding the `dive_artifacts` insert (`student_id: studentDbId`) and a `.eq('student_id', studentDbId)` idempotency check.
- `src/app/api/dive/history/route.ts` (grep-confirmed) — lines 54-78 show the identical pattern.
- `src/app/api/synthesis/state/route.ts:64-83` — read in full; resolves `studentDbId` via `.eq('auth_user_id', userId)` (line 70) before querying `monthly_synthesis_runs.student_id` (line 82) — this is the route REG-223 fixed; I independently confirmed the CURRENT state matches the fix, not just the catalog's claim.

`get_available_subjects`/leaderboard (S7) do not use the surrogate-id resolution pattern at all because `get_leaderboard` and `get_available_subjects` are themselves dual-key-tolerant (see Worklist Item 3) — this is architecturally different from the dive/synthesis/rhythm routes and is not itself evidence of a bug.

Confidence: HIGH (dive/state and synthesis/state read in full; dive/start, dive/artifact, dive/history confirmed via targeted grep of the exact resolution lines, not a full line-by-line read of each file). Risk-impact: n/a (all confirmed correct).

### Worklist Item 3: Dual-key-tolerant vs. surrogate-only RPC convention — full call-site inventory

**Method:** Grepped `p_student_id:` across `src/app/api/**` and `src/lib/**` (43 + 33 hits respectively, filtered to exclude the generated `src/types/database.types.ts`), then classified each call site's target RPC as dual-key-tolerant (`WHERE id = p_student_id OR auth_user_id = p_student_id`) or surrogate-only, by reading the RPC body in `supabase/migrations/00000000000000_baseline_from_prod.sql`.

**Call sites passing the raw auth uid (not a resolved surrogate `students.id`) — the only pattern that matters for this bug class:**

| Call site | RPC | RPC convention | Verdict |
|---|---|---|---|
| `src/app/api/student/subjects/route.ts:179` | `get_available_subjects` | Dual-key-tolerant — body at `baseline_from_prod.sql:8880` (`WHERE id = p_student_id OR auth_user_id = p_student_id`, confirmed at line 8880/similar offset for the sibling v2 at line 4192) | **Safe** — explicitly commented as intentional at route.ts:172-174 |
| `src/app/api/student/subjects/route.ts:180` | `get_available_subjects_v2` | Dual-key-tolerant — body read directly at `baseline_from_prod.sql:4182-4193`: `SELECT id, grade INTO v_student_id, v_grade FROM students WHERE id = p_student_id OR auth_user_id = p_student_id LIMIT 1;` | **Safe** |
| `src/app/api/student/chapters/route.ts:88` | `available_chapters_for_student_subject_v2` | Dual-key-tolerant — body at `baseline_from_prod.sql:1167-1181` (same `OR auth_user_id` pattern, confirmed via grep hit at line 1181) | **Safe** — explicitly commented as intentional at route.ts:172-174 |
| `src/app/api/v2/learn/curriculum/route.ts:65` | `get_available_subjects` (same RPC as above, called with `auth.userId`) | Dual-key-tolerant (same as above) | **Safe** — comment at line 63 explicitly notes "keyed by auth user" |

**All other `p_student_id:` call sites I inventoried** (the remaining ~35+35 hits across `src/app/api/**` and `src/lib/**` — e.g. `src/lib/supabase.ts` (many), `src/lib/domains/quiz.ts`, `src/lib/domains/profile.ts`, `src/app/api/quiz/route.ts`, `src/app/api/v2/quiz/*`, `src/app/api/payments/*`, `src/app/api/student/shop/purchase/route.ts`, `src/app/api/cron/adaptive-remediation/route.ts`, `src/app/api/exams/**`, `src/app/api/super-admin/students/[id]/**`) pass a variable literally named `studentId`/`student.id`/`resolved.student_id`/`targetStudentId` — every one of these names implies (and, spot-checked in `rhythm/today`, `dive/*`, and `synthesis/state`, was confirmed to be) an **already-resolved surrogate id**, not the raw auth uid. I did not re-derive every single one of these ~70 call sites' upstream resolution logic line-by-line (that volume is outside a single-session Stage-1 scope) — this is flagged as **NOT VERIFIED-DEFERRED** for the full set, with the four confirmed-safe dual-key sites and the three confirmed-fixed surrogate-resolving sites (rhythm/today, dive/*, synthesis/state) as the fully-verified subset.

**Surrogate-only RPCs confirmed by direct body read (for reference — these REQUIRE a pre-resolved surrogate id, no dual-key fallback):**
- `get_due_reviews` — `baseline_from_prod.sql:4615-4618`: `WHERE cm.student_id = p_student_id` (no OR clause).
- `get_adaptive_questions` — `baseline_from_prod.sql:4170-4173`: `WHERE cm.student_id = p_student_id` / `qr.student_id = p_student_id` (no OR clause).

Both are correctly fed the resolved surrogate in every call site I read (`rhythm/today`, `dive/state`).

Confidence: HIGH for the 7 call sites individually classified (4 dual-key-safe + 3 surrogate-correctly-resolved); MEDIUM/NOT VERIFIED-DEFERRED for the broader ~70-call-site population that uses `studentId`-named variables without a full upstream trace of each. Risk-impact: **Should-Fix-Before-Release** as a follow-up scoping recommendation — I recommend a dedicated, narrowly-scoped follow-up pass (ai-engineer or backend, assessment reviewing) that mechanically traces every `p_student_id:`/`p_student_id =` call site's variable provenance, specifically because this exact bug class has now been found and fixed TWICE independently in the same day (`rhythm/today`, `synthesis/state`) — a third latent instance is a real possibility given the volume of unverified call sites, even though I found no direct evidence of one in this session.

---

## Part C — Cross-cutting observations (not part of the 14-item list, surfaced during the above)

1. **`ff_irt_question_selection` documentation drift** (see item 8) is the single highest-value finding from this pass — it's a case where an in-repo comment (`pedagogy.ts:168-169`) makes a confident factual claim about production state ("ON @100 in prod... gates the nightly-calibrated SQL-RPC IRT path") that a direct code read disproves. Recommend this be corrected or the dead code removed in the same change, and any external-facing "adaptive/IRT-powered" product claims be checked against `ff_adaptive_live_selection_v1`'s actual (OFF) state rather than `ff_irt_question_selection`'s documented (but fictional) state.
2. **Coupon/referral schema-without-implementation** (item 11) should be flagged to ops/backend if any current marketing or sales collateral references either feature.
3. **Leaderboard `scope` param bug** (item 10) is a small, cheap fix (either wire `scope=school` into a new school-scoped RPC variant, or drop the param from the request/response contract until implemented) that I recommend routing to backend with assessment review, since it's a business-rule-shaped correctness issue in a read-only API contract, not a UI or schema concern.

---

## Files read/cited in this report (for reviewer convenience)

- `src/lib/xp-config.ts`, `src/lib/xp-rules.ts`, `src/lib/scoring.ts`
- `src/lib/exam-engine.ts`
- `src/lib/supabase.ts` (submitQuizResults, getQuizQuestionsV2, processAdaptiveLearning)
- `src/components/quiz/QuizResults.tsx`
- `src/app/quiz/page.tsx`
- `src/app/api/rhythm/today/route.ts`
- `src/app/api/dive/state/route.ts`, `dive/start/route.ts`, `dive/artifact/route.ts`, `dive/history/route.ts`
- `src/app/api/synthesis/state/route.ts`
- `src/app/api/student/subjects/route.ts`, `src/app/api/student/chapters/route.ts`, `src/app/api/v2/learn/curriculum/route.ts`
- `src/lib/adaptive/select-adaptive-questions.ts`
- `src/lib/irt/fisher-info.ts` (referenced, not fully re-read)
- `supabase/functions/quiz-generator/index.ts`
- `src/lib/ai/validation/quiz-oracle.ts`, `src/lib/oracle/deterministic-checks.ts`
- `src/app/api/foxy/_lib/quota.ts`, `src/app/api/foxy/_lib/constants.ts`
- `src/app/api/v2/student/leaderboard/route.ts`
- `src/lib/flags/registries/pedagogy.ts`
- `supabase/migrations/00000000000000_baseline_from_prod.sql` (question_bank, students, coupons, referral_rewards, get_leaderboard, get_available_subjects[_v2], available_chapters_for_student_subject_v2, get_due_reviews, get_adaptive_questions, check_and_record_usage, guardian_student_links guard, teacher RLS policies)
- `supabase/migrations/20260702150000_p3w1_5_quiz_rpc_ownership_check.sql`
- `supabase/migrations/20260702170000_p3w1_5b_revoke_orphan_atomic_quiz_5arg.sql`
- `supabase/migrations/20260623000500_reapply_submit_quiz_v2_column_fix.sql`
- `supabase/migrations/20260622090000_seed_ff_adaptive_live_selection_v1.sql`
- `.claude/regression-catalog.md` (keyword-searched, not read in full)
- `src/__tests__/api/rhythm/today-remediation-lane.test.ts` (header read)
