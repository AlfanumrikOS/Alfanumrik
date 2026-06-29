# Student Learning Core — Gap Analysis

**Workflow:** Quiz / Scoring / XP / Mastery
**Audit cycle:** Cycle 3 — GAP
**Owner:** Assessment engineer
**Date:** 2026-06-29
**Method:** Evidence-driven. Every claim cites file:line. Compliant areas stated explicitly.

Per-gap schema: **ID | Title | Evidence | Business impact | Technical impact | Severity | Likelihood | Recommendation | Est. effort.**

---

## Compliance summary (what is CORRECT — verified)

| Invariant | Verdict | Evidence |
|---|---|---|
| **P1 score formula** | MATCHES — byte-identical at all 3 computing sites | `scoring.ts:18`, baseline `:7399` (v1), `:7730` (v2); `QuizResults.tsx:313` consumes, never recomputes |
| **P2 XP formula** | MATCHES (values correct everywhere) | `scoring.ts:25-31`; baseline `:7404-7406`, `:7736-7738`; constants `xp-config.ts:44-47`. **But duplicated as SQL literals — see SLC-2** |
| **P2 daily cap** | ENFORCED server-side (200) | `atomic_quiz_profile_update` 7-arg `:821`; ledger-sourced `:812-817` |
| **P3 anti-cheat (client)** | ALL 3 PRESENT | `quiz/page.tsx:896` (speed), `:916` (pattern), `:921` (count) |
| **P3 anti-cheat (server)** | ALL 3 PRESENT in BOTH v1 and v2 | v1 `:7381,7385-7393,7395`; v2 `:7709,7714-7722,7725` |
| **P4 atomic submission** | INTACT — single `PERFORM atomic_quiz_profile_update` in-txn | v1 `:7549`; v2 `:7850`; fallback logged `supabase.ts:515,568` |
| **P5 grade format** | CORRECT — string passed verbatim | `quiz/page.tsx:472,939`; RPC params typed `"text"` |
| **P6 question quality (client gate exists)** | PARTIAL — gate defined but not wired in startQuiz; see SLC-7 | `quiz/page.tsx:419-433` |
| **P6 snapshot scoring** | CORRECT — v2 reads snapshot, not live question_bank | v2 `:7664-7689`, COMMENT `:7886` |
| **Score display source** | CORRECT — consumes `results.score_percent`/`results.xp_earned` | `QuizResults.tsx:313,445` |
| **Level name source** | CORRECT — `getLevelName`/`LEVEL_NAMES` constant | `QuizResults.tsx:347-348`; `xp-config.ts:88-121` |
| **Streak source** | CORRECT — server-computed `students.streak_days` | `atomic_quiz_profile_update:946-953` |
| **Timer integrity** | CORRECT — `useRef` interval, no re-render drift | `quiz/page.tsx:255-256,348` |
| **Bloom levels** | CORRECT spelling + order | `cognitive-engine` `BLOOM_LEVELS`; remember→understand→apply→analyze→evaluate→create |

---

## Gaps

### SLC-1 | Second uncapped XP-award path: `quiz_sessions` AFTER-completion trigger
- **Evidence:** baseline `:3838-3882` — a trigger fires when `quiz_sessions.is_completed` flips TRUE and recomputes XP (`v_xp := correct_answers*10; +20 if >=80; +50 if =100`, `:3862-3864`) then upserts `student_learning_profiles.xp` **with NO daily-cap clamp**. Its only guard against double-counting with the RPC is a 5-second timing heuristic: `last_session_at > NOW() - INTERVAL '5 seconds'` (`:3849-3859`).
- **Business impact:** XP economy inflation — a student could exceed the 200/day cap on subject XP via the trigger path; undermines the mastery-not-grind design mandate (`xp-config.ts:25-35`).
- **Technical impact:** Two writers to `student_learning_profiles.xp` (trigger + `atomic_quiz_profile_update`) reconciled only by a wall-clock window. The v2 RPC INSERTs `quiz_sessions` (firing this trigger) *before* it calls `atomic_quiz_profile_update` (`:7742` then `:7850`), so at trigger time `last_session_at` for this submission is not yet set — the 5s guard relies on a *prior* session within 5s, which is fragile and order-dependent.
- **Severity:** High
- **Likelihood:** Medium (depends on whether the trigger is still attached in prod; baseline is a pg_dump so it is)
- **Recommendation:** Assessment to confirm whether this trigger is still active. If the RPC is the sole intended writer, the trigger should be a no-op for RPC-sourced rows (e.g. gate on a `source`/`scored_by` column rather than a 5s window). **Hand to architect** for the schema/trigger change; assessment defines expected behavior (RPC is authoritative, cap always applies). Do NOT change the cap value.
- **Est. effort:** M (1-2 days incl. parity test)

### SLC-2 | P2 XP formula duplicated as raw SQL literals across ~9 sites (drift risk)
- **Evidence:** `10/20/50` literals at baseline `:7404-7406` (v1), `:7736-7738` (v2), `:3862-3864` (trigger); and re-declared in migrations `20260504100100:221-223`, `20260504100200:318-320`, `20260621000600:255-257`, `20260622030000:257-259`, `20260623000300:342-344`, `20260623000500:252-254`. TS source single: `scoring.ts:27-29` reading `xp-config.ts:44-46`.
- **Business impact:** A future XP-economy change touched in TS but missed in one SQL body silently mis-awards XP for whichever RPC path that body serves (v1 mobile vs v2 web) — a silent economy bug invisible until a player-facing discrepancy.
- **Technical impact:** No mechanical guard asserts the SQL literals equal `XP_RULES`. REG-48 is documented as covering "SQL/TS literal parity" but `xp-ledger-parity.test.ts` only mirrors the **cap arithmetic** (`computeXpToAward`, lines 44-47) and the `XP_RULES.quiz_daily_cap === 200` anchor (`:164-167`) — it does **not** assert `10/20/50` appear in the SQL function bodies.
- **Severity:** High
- **Likelihood:** Medium
- **Recommendation:** Add a parity guard test that reads the live RPC source (or a single SQL constants table) and asserts the per-correct/high-score/perfect literals equal `XP_RULES`. AUTO-FIX-SAFE (test only — no value change). Longer-term: hand architect a single SQL `xp_constants()` SQL function so the literals exist once. Do NOT change the values.
- **Est. effort:** S (test); M (SQL constant refactor)

### SLC-3 | No mechanical P1 three-way score-formula parity guard
- **Evidence:** Formula present at `scoring.ts:18`, baseline `:7399`, `:7730`. REG-45/REG-51/REG-52 cover happy-path + shuffle authority + a production canary, but no test asserts the SQL `ROUND((correct/total)*100)` byte-pattern matches the TS `Math.round((correct/total)*100)` across all three.
- **Business impact:** A divergence (e.g. a future `ROUND(x, 2)` or floor change in one body) would make the displayed score disagree with the recorded score — directly erodes trust and is a P1 violation.
- **Technical impact:** `Math.round` (half-up) vs PG `ROUND` (half-away-from-zero) are equivalent only for non-negative inputs; this equivalence is currently undocumented and untested. A negative or pre-scaled intermediate in a future edit would silently diverge.
- **Severity:** Medium
- **Likelihood:** Low
- **Recommendation:** Add a source-inspection parity test (grep the RPC bodies for the canonical expression) + a property test asserting `Math.round` and a PG-`ROUND` model agree on 0..100 inputs. AUTO-FIX-SAFE (test only).
- **Est. effort:** S

### SLC-4 | Two different daily-cap implementations (table + date-boundary mismatch)
- **Evidence:** Production 7-arg `atomic_quiz_profile_update` caps off `xp_transactions` (ledger) at **IST** midnight (`:812-817`). The JSONB 6-arg overload (used only by the client-side fallback `supabase.ts:552`) caps off `quiz_sessions.SUM(xp_earned)` at server **CURRENT_DATE** (`:731-737`, `:723`). Different source table AND different date boundary.
- **Business impact:** On the fallback path, the cap can compute a different "today's earned" than the primary path — a student who hit the cap via the ledger could receive extra XP through the fallback near the IST/UTC boundary.
- **Technical impact:** The JSONB version reads `quiz_sessions.xp_earned`, but `submitQuizResults`' fallback inserts the session with column `score` (`supabase.ts:538`), not `xp_earned` — so the JSONB cap may under-count today's earned XP, weakening the cap on the fallback path.
- **Severity:** Medium
- **Likelihood:** Low (fallback path only; primary path is v2)
- **Recommendation:** Confirm whether `quiz_sessions.xp_earned` and `score` are the same column/aliased; if not, the JSONB cap source is wrong. Align both overloads to the ledger + IST boundary. Hand to architect; assessment confirms expected cap semantics. Do NOT change the cap value (200).
- **Est. effort:** M

### SLC-5 | Server-side anti-cheat "rejection" still records the session (XP=0 only)
- **Evidence:** Client REJECT short-circuits before any server call (`quiz/page.tsx:896-908,920-933`). But server-side, a flagged submission only zeroes XP (`v_xp := 0`, v1 `:7402`, v2 `:7733-7734`) and **still INSERTs the `quiz_sessions` row + `quiz_responses` + counters** (v2 `:7742`, `:7797`). The constitution's P3 table says speed/count = "Reject"; the server interpretation is "record with 0 XP".
- **Business impact:** Flagged/bot sessions still inflate `total_sessions`, `total_questions_asked`, and mastery counters — polluting progress analytics and learner-state even though no XP is granted.
- **Technical impact:** "Reject" vs "record-but-zero-XP" is an undocumented semantic split between client and server. A direct RPC caller (mobile, or any client bypassing the page-level checks) gets the row written.
- **Severity:** Medium
- **Likelihood:** Medium (mobile + any non-web caller)
- **Recommendation:** Assessment to define the canonical server behavior for each P3 check (true reject = no row, vs flag = row with 0 XP + excluded from mastery counters). Hand the spec to architect/backend for the RPC change. This is a behavior definition, not a threshold change — the 3s / >3 / count thresholds stay. AUTO-FIX-SAFE only as a *documentation + test* of current behavior; the behavior change itself needs backend.
- **Est. effort:** M

### SLC-6 | Pattern check (P3 #2) is FLAG-only on both client and server (by design, but asymmetric framing)
- **Evidence:** Client logs a warning, still submits (`quiz/page.tsx:916-918`). Server flags → XP 0 (`:7719-7721`/`:7385-7393`). The skill table labels Pattern as "Flag" while Speed/Count are "Reject" — so this is intended. Confirmed COMPLIANT, recorded here only to note the asymmetry is deliberate and matches the constitution.
- **Business impact:** None (intended).
- **Technical impact:** None.
- **Severity:** Low (informational)
- **Likelihood:** n/a
- **Recommendation:** Keep. Add an explicit test asserting "pattern→flag→XP 0 but row recorded" so the asymmetry can't regress silently. AUTO-FIX-SAFE (test only).
- **Est. effort:** S

### SLC-7 | `isValidQuestion` P6 gate is defined but not invoked in the serve path
- **Evidence:** `isValidQuestion(q)` (`quiz/page.tsx:419-433`) implements the P6 client gate (text/length/`{{`/`[BLANK]`/4-option/index 0-3) but is **not called** within `startQuiz` (`:435-600`); `displayQuestions` is set straight from `assembleQuiz` output + server-shuffle merge with no `.filter(isValidQuestion)`.
- **Business impact:** If `assembleQuiz`/`quiz-generator` ever serves a malformed question (missing option, template marker), the student sees it — a P6 surface that relies entirely on upstream filtering.
- **Technical impact:** Dead defense-in-depth: the gate exists but provides no protection at the render boundary. P6 enforcement is solely upstream (quiz-generator validation oracle REG-54 + DB constraints).
- **Severity:** Medium
- **Likelihood:** Low (upstream oracle + constraints usually catch it)
- **Recommendation:** Wire `displayQuestions = displayQuestions.filter(isValidQuestion)` (or assert in dev) as a last-line P6 gate. AUTO-FIX-SAFE (additive hardening — only removes malformed items, never alters scoring). Coordinate with ai-engineer so the upstream contract and this gate agree.
- **Est. effort:** S

### SLC-8 | Live web client bypasses the idempotency-keyed `/api/quiz/submit` route
- **Evidence:** `submitQuizResults` calls `supabase.rpc('submit_quiz_results_v2', …)` directly from the browser (`supabase.ts:505`), with no `Idempotency-Key`. The hardened server-only route (`api/quiz/submit/route.ts`) — which enforces RBAC `quiz.attempt` (`:109`), studentId↔JWT cross-check (`:160-170`), idempotency replay (`:251-273`) — only runs as passthrough until `ff_server_only_quiz_submit` flips ON (`:172-188`). Client dedup is in-memory only (`supabase.ts:477,499-501`), lost on reload.
- **Business impact:** Network-retry / double-submit can produce a duplicate session on the direct path (the RPC's own `idempotency_key` short-circuit is only exercised when the route supplies the key — the direct browser call passes none).
- **Technical impact:** The strongest dedup + auth guarantees live in a route the production client does not use yet. Mitigated by the 7-arg RPC's `reference_id = quiz_<session_id>` `ON CONFLICT DO NOTHING` (`:824-854`) which prevents double XP, but a duplicate `quiz_sessions` row can still be inserted by v2 before the cap step.
- **Severity:** Medium
- **Likelihood:** Medium (mobile networks, Indian 4G retries)
- **Recommendation:** Track/complete the `ff_server_only_quiz_submit` cutover so the idempotency-keyed route is the only path. Until then, add a regression pin asserting the v2 RPC + `reference_id` dedup prevents double XP on replay. Behavior/rollout owned by backend+architect; assessment signs off on XP-non-duplication. AUTO-FIX-SAFE for the test pin.
- **Est. effort:** M (cutover); S (pin)

### SLC-9 | Coverage thresholds for cognitive-engine / xp-rules branches below aspirational target
- **Evidence:** `vitest.config.ts` (per CLAUDE.md): `xp-rules.ts` 90/**75**/90/90 (branches relaxed — needs daily-cap clamp, perfect-score combo, streak-bonus edges); `cognitive-engine.ts` **65** all (needs IRT 3PL Newton-Raphson, SM-2 decay, error-classification branches; file 1412 LOC). Tests exist (`xp-rules-branch-coverage.test.ts`, `cognitive-engine-coverage.test.ts`) but documented TODO(assessment) gaps remain.
- **Business impact:** Under-tested adaptive math (ZPD, fatigue, SM-2) can mis-target difficulty/scheduling without a failing test.
- **Technical impact:** Branch gaps on the exact paths that drive learner-state correctness.
- **Severity:** Low-Medium
- **Likelihood:** Medium
- **Recommendation:** Hand to testing: add branch tests for XP daily-cap clamp + perfect-score combo + streak-bonus edges, and cognitive-engine IRT convergence + SM-2 decay + error-classification. AUTO-FIX-SAFE (tests only).
- **Est. effort:** M

### SLC-10 | `submit_quiz_results_v2` redefined across 6 post-baseline migrations — confirm latest is canonical
- **Evidence:** v2 redefined in `20260621000600`, `20260622030000`, `20260623000300`, `20260623000500` (+ `_v2_quiz_raise_on_missing_snapshot`, `_quiz_idempotency_key`). All keep `10/20/50` + `ROUND(...*100)` (grep confirms identical formula). Baseline 7594 is the snapshot; the latest migration is what's live.
- **Business impact:** None observed — formula stable across all redefinitions.
- **Technical impact:** Many redefinitions raise the chance a future edit lands in only one. Confirms SLC-2's drift surface is real and active.
- **Severity:** Low (informational; reinforces SLC-2/SLC-3)
- **Likelihood:** Low
- **Recommendation:** When adding the SLC-2/SLC-3 parity guards, target the **latest** migration body, not the baseline. AUTO-FIX-SAFE.
- **Est. effort:** S

---

## Verdict roll-up

| Severity | Gaps |
|---|---|
| High | SLC-1 (uncapped trigger XP path), SLC-2 (XP literal drift surface) |
| Medium | SLC-3 (no P1 parity guard), SLC-4 (dual cap impl), SLC-5 (server records flagged), SLC-7 (P6 gate unwired), SLC-8 (idempotency route bypass), SLC-9 (coverage) |
| Low | SLC-6 (pattern-flag asymmetry, intended), SLC-10 (v2 redefinition churn) |

No gap found where the P1 score formula, P2 XP values, or P3 thresholds are *wrong* — they
are correct everywhere verified. The gaps are about **drift surface, parity guards,
duplicate writers, and rollout completeness**, not incorrect values.
