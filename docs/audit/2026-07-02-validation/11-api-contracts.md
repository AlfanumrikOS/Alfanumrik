# API-Contract Validation — Two-Source-of-Truth Reconciliation

**Phase 2 Validation · Chapter 11 · 2026-07-02**
**Auditor theme:** every contract with TWO sources of truth must be mechanically reconciled. Each check is reported as MATCH / MISMATCH / UNPROVEN with file:line evidence on both sides.
**Method:** read-only. Six independent sub-audits (C-1..C-6), each an exhaustive or sampled diff of a paired-source contract. Inputs: `docs/audit/2026-07-02-discovery/05-mobile.md` + `02-api-surface.md`.

---

## 0. Summary table

| Check | Contract pair | Result | MATCH | MISMATCH | UNPROVEN | Coverage |
|---|---|---|---|---|---|---|
| C-1 | DB flag seeds ↔ code flag reads | **MISMATCH cluster** | ~110 flags | ~8 notable (4 seed-gap, 3 never-seeded, 1 orphan) | 0 | Exhaustive |
| C-2 | Mobile Dart constants ↔ web TS constants | **MATCH** (1 asymmetry) | 45+ constants | 0 value drift | — | Exhaustive |
| C-3 | `openapi/v2.json` ↔ live `/v2/**` routes | **MISMATCH (systemic)** | 1 route clean | 11 routes (10 envelope + 1 payload drift) | 0 | Exhaustive (12/12) |
| C-4 | TS XP/anti-cheat literals ↔ SQL RPC literals | **MATCH** | 11 literals | 0 | 0 | Exhaustive (latest RPCs) |
| C-5 | Student pages ↔ backing route response shapes | **MATCH** | 9 pages | 0 | 1 (N/A) | Mixed (5 exhaustive / 4 sampled / 1 N/A) |
| C-6 | Client anti-cheat ↔ server anti-cheat | **MISMATCH** | Check 1 | Check 2 (blind spot), Check 3 (dead no-op) | 0 | Exhaustive |

**Headline:** two contracts are clean end-to-end (C-2 mobile constants, C-4 TS↔SQL literals) and one has no page-level breakage (C-5). The three real problem areas for Phase 3 are: (C-3) the `{success,data}` success envelope is un-modelled in the OpenAPI spec for 10/12 `/v2` routes plus stale `/v2/today` drift; (C-6) server anti-cheat Check 3 is a tautological dead no-op and Check 2 has an unanswered-question blind spot; (C-1) four live-read feature flags are seeded only under `_legacy/` and would start OFF in any fresh environment — most notably P11's `ff_atomic_subscription_activation`.

---

## 1. Severity-ranked mismatch list (for Phase 3)

| # | Sev | Check | Finding | Evidence |
|---|---|---|---|---|
| 1 | **HIGH** | C-6 | **Server anti-cheat Check 3 (response-count == question-count) is a dead no-op.** `v_total` is incremented once per element of `p_responses`, so `jsonb_array_length(p_responses) <> v_total` can never be true. The server never receives the count of questions *served*, so it structurally cannot reproduce the client check. Enforced nowhere server-side (client is advisory-only). Applies to both v1 & v2 RPC. | `00000000000000_baseline_from_prod.sql:7395` (v1), `:7725` (v2); loop increment `:7652` |
| 2 | **HIGH** | C-3 | **`{success,data}` success envelope un-modelled in spec for 10/12 `/v2` routes.** `v2Success()` wraps payloads as `{success:true,data:{...}}` but the spec's 200 responses reference the bare payload schema. Error envelope IS modelled — asymmetric. A Dart model generated from the spec cannot deserialize the real body without hand-unwrapping `data`. | `src/lib/api/v2/envelope.ts:21-29`; e.g. spec `QuizQuestionsResponse` bare at `openapi/v2.json:1976-1984` |
| 3 | **MED** | C-6 | **Server anti-cheat Check 2 (not-all-same-answer) blind spot.** Server denominator `v_total` includes unanswered `-1` responses but numerator `v_max_same_answer` counts only indices 0..3. A 5-Q quiz answered all-"A" with 1 blank: client warns, server does NOT flag. Three implementations, two denominators (page.tsx inline, anti-cheat.ts helper, SQL). | `00000000000000_baseline_from_prod.sql:7713-7722` (v2); client `src/app/quiz/page.tsx:957-960` |
| 4 | **MED** | C-1 | **4 live-read flags seeded only in `_legacy/` (fresh envs start OFF).** `ff_atomic_subscription_activation` (P11 payment fallback), `ff_irt_question_selection`, `ff_foxy_streaming`, `ff_rag_mmr_diversity`. `supabase db push` does not apply `_legacy/`; prod likely carries rows (pg_dump baseline), but CI live-DB / new staging / DR would start these disabled. `ff_atomic_subscription_activation` is the one to confirm against prod. | seed `_legacy/…/20260425140500_ff_atomic_subscription_activation.sql`; read in `src/app/api/payments/**` |
| 5 | **MED** | C-3 | **`/v2/today` payload drift vs spec.** Route typed by `src/lib/today/types.ts`, spec generated from stale `contract.ts` Zod. Extra fields `meta.practicedToday`, `chapterTitle`/`chapterTitleHi`; `TodayItemType` enum in spec omits `teacher_remediation` + `new_topic` (both emitted by route). CI drift-check only verifies spec↔contract.ts, NOT contract.ts↔route output — the gap slips through. | route `src/app/api/v2/today/route.ts:163` + `types.ts:118,92-96,46,51`; spec enum `openapi/v2.json:1376-1389` |
| 6 | **LOW** | C-1 | **3 never-seeded flags read in code (permanently OFF).** `ff_goal_aware_scoring`, `ff_grounded_answer_mol_telemetry_v1` (sibling `_shadow_v1` is seeded+read), plus documented-intentional `ff_subjects_os_v1`/`ff_revision_os_v1`/`ff_practice_os_v1`/`ff_test_os_v1` (registry-commented as "not yet seeded, resolves OFF"). | `src/lib/flags/registries/consumer.ts:122-185` |
| 7 | **LOW** | C-3 | **Minor per-route spec drifts.** `quiz/questions` `count` domain narrower in route (`[5,10,15,20]`) than spec (int 5–20); `leaderboard` `scope` param accepted but never applied (RPC gets only period+limit); `parent/children` spec advertises `board`/`last_active_at` the route never returns; several response schemas forwarded from RPC/helper unvalidated (`quiz/start`, `learn/concept` sources). | route/spec citations in §C-3 below |
| 8 | **LOW** | C-1 | **Orphan near-miss flag.** Bare `ff_competitive_exam` seeded but never read; app reads `ff_competitive_exams_v1` (plural+`_v1`, seeded+read=MATCH). Dead seed weight, no functional impact. | seed `20260520000007_competition_sku_substrate.sql`; read grep for bare form = 0 hits |
| 9 | **INFO** | C-6 | **Web client anti-cheat is advisory-only (warn, never blocks) post-SLC-5**, and mobile has NO client-side anti-cheat at all. P3's literal "enforced client-side AND server-side" is not true for web (telemetry only) and N/A for mobile — server is sole authority. Deliberate/documented, but weaker than invariant text. | `src/app/quiz/page.tsx:927-970`; mobile confirmed absent |
| 10 | **INFO** | C-6 | **Drifted duplicate:** `src/lib/anti-cheat.ts` (self-documents "DO NOT duplicate…import from here") is used only by tests; the live quiz page carries an inline copy that does not import it. | `src/lib/anti-cheat.ts:14-32` vs `src/app/quiz/page.tsx:945-970` |
| 11 | **INFO** | C-4 | **TS↔SQL literal duplication (currently in sync).** XP literals `10/20/50`, cap `200`, level `500` are hardcoded in SQL RPC bodies with no mechanical link to `xp-config.ts`. All agree today; a future TS change would silently drift unless SQL is hand-edited in lockstep. | `src/lib/xp-config.ts:44-47,71` vs baseline RPCs `:7404-7406,821,763` |

No HIGH finding requires immediate production hotfix (server anti-cheat Check 3 being dead means the *count* rule is unenforced, but Checks 1+2 still catch the dominant cheating patterns, and the score/XP path itself is correct per C-4). All findings are catalog/hardening candidates.

---

## C-1 — Feature-flag name parity (DB seed ↔ code read) · MISMATCH cluster · **Exhaustive**

Deduplicated `ff_[a-z0-9_]+` grep across all `supabase/migrations/*.sql` (top-level + `_legacy/**`), all `src/**/*.{ts,tsx}`, and all `supabase/functions/**`. Genuine `flag_name` literals separated from false positives (SQL constraint/column/policy names, PL/pgSQL locals like `v_ff_goal_profiles_enabled`, log-key fragments like `ff_insert_failed`).

**Missing-row semantics — both read paths fail safe to OFF, never throw:**
- Next.js `isFeatureEnabled()`: `if (!flag) return false;` — `src/lib/feature-flags.ts:97`.
- Edge functions: `.maybeSingle()` then `Boolean(data && data.is_enabled === true)` — e.g. `supabase/functions/quiz-generator/index.ts:374-379`.

So every "read-but-never-seeded" flag is silently OFF (dormant/dead toggle), not an error.

| Flag | Seeded (file:line) | Read (file:line) | Verdict |
|---|---|---|---|
| `ff_quiz_oracle_enabled` | `20260504100000_enable_quiz_oracle_in_prod.sql:48` | `bulk-question-gen/index.ts:1127,:1357` | **MATCH** — flip effective |
| `ff_school_pulse_v1` / `ff_adaptive_remediation_v1` / `ff_adaptive_loops_bc_v1` / `ff_digital_twin_v1` | `20260619000100/000300/000600`, `20260702000700` | `src/**` + `supabase/functions/**` | **MATCH** |
| `ff_student_os_v1` | `20260620001601_enable_latest_frontend_flags.sql:86` | `consumer.ts:113`, `foxy/page.tsx` | **MATCH** |
| `ff_atomic_subscription_activation` | **legacy-only** `_legacy/…/20260425140500_…sql` | `src/app/api/payments/**` | **MISMATCH (seed gap, P11)** |
| `ff_irt_question_selection` | **legacy-only** `_legacy/…/20260428000600_…sql` | `quiz-generator/index.ts:377,:365,:1242` | **MISMATCH (seed gap)** |
| `ff_foxy_streaming` | **legacy-only** `_legacy/…/20260429000000_…sql` | `src/**` | **MISMATCH (seed gap)** |
| `ff_rag_mmr_diversity` | **legacy-only** `_legacy/…/20260428120000_…sql` | `supabase/functions/**` (RAG) | **MISMATCH (seed gap)** |
| `ff_goal_aware_scoring` | none | `src/**` | **MISMATCH (never seeded)** |
| `ff_grounded_answer_mol_telemetry_v1` | none (sibling `_shadow_v1` seeded) | `supabase/functions/**` | **MISMATCH (never seeded)** |
| `ff_subjects_os_v1` / `ff_revision_os_v1` / `ff_practice_os_v1` / `ff_test_os_v1` | none (registry-documented) | `consumer.ts:127/143/162/185` | **MISMATCH (intentional, page 404s)** |
| `ff_competitive_exam` (bare) | `20260520000007_competition_sku_substrate.sql` | not read (app reads `_exams_v1`) | **MISMATCH (orphan seed)** |

~110 remaining flags reconcile byte-for-byte (omitted).

**`ff_quiz_oracle` adjudication (definitive):** There is NO bare `ff_quiz_oracle` string anywhere in the repo. Every occurrence — seed, read, comment — is the full `ff_quiz_oracle_enabled`. Seeded at `20260504100000_enable_quiz_oracle_in_prod.sql:48` (with a post-condition `RAISE` guard at `:69-79`). Read live in `bulk-question-gen/index.ts:1127` and `:1357` (the LLM-grader oracle gate before `question_bank` insert). **quiz-generator does NOT read it** — the only hit (`quiz-generator/index.ts:1343`) is a comment explaining the hot serving path runs deterministic-only because questions were already oracle-gated at insert. **Verdict: seeded name === read name byte-for-byte; the flip is NOT inert — toggling `is_enabled` directly controls the bulk-question-gen oracle. The hypothesized `ff_quiz_oracle` vs `ff_quiz_oracle_enabled` drift does not exist.**

Other near-misses: `ff_competitive_exam` (singular, orphan) vs `ff_competitive_exams_v1` (plural+v1, MATCH) — harmless. `*_enabled` seed "flags" are PL/pgSQL locals, not flag names (`20260503120000:166-167`) — false positives; real `ff_goal_profiles`/`ff_goal_aware_foxy` MATCH. `ff_editorial_atlas` has a duplicate-basename migration pair (`20260511144221` + `20260511180000`) — housekeeping smell, not a parity defect.

**Limitation:** verdicts are static-source only; no live DB queried. The 4 legacy-only seeds likely exist on prod (pg_dump-derived baseline) but are the fragile set for fresh environments.

---

## C-2 — Mobile Dart ↔ web TS constants (byte-diff) · MATCH · **Exhaustive**

All three source pairs read in full.

**Foxy Coins — `src/lib/coin-rules.ts` ↔ `mobile/lib/core/constants/coin_rules.dart`:** 23 reward constants compared, all MATCH (e.g. `quizComplete=10` `coin-rules.ts:41`/`coin_rules.dart:33`; `scoreCrosses80=100` `:49`/`:43`; `scoreCrosses90=200` `:50`/`:46`; `experimentComplete=20` `:57`/`:59`; `experimentDailyCap=100` `:62`/`:74`). COIN_SHOP 5 items (id/cost) all MATCH (`streak_freeze=80`, `extra_chats_5=40`, `mock_test_unlock=150`, `revision_sprint=120`, `certificate=250`). Mobile Hindi strings are codepoint-equivalent `\uXXXX` escapes of the web Devanagari. **Zero drift.** The discovery doc's "not independently verified" flag is now cleared: fully in sync.

**Performance Score — `src/lib/score-config.ts` ↔ `mobile/lib/core/constants/score_config.dart`:** `PERFORMANCE_WEIGHT=0.80`/`BEHAVIOR_WEIGHT=0.20` MATCH (`:30,33`/`:21,24`); Bloom ceiling map (0.45/0.60/0.75/0.85/0.95/1.00) MATCH (`:44-49`/`:35-40`); **GRADE_RETENTION_FLOOR uses STRING keys "6".."12" on BOTH sides — P5-compliant, no integer-key drift** (`:75-81` `Record<string,number>` / `:66-72` `Map<String,double>`); BEHAVIOR_WEIGHTS (4/3/4/3/3/3 sum 20) MATCH; BEHAVIOR_WINDOWS (14/30/14/30/30/7) MATCH; 10 LEVEL_THRESHOLDS bands MATCH. **Zero drift.**

**Anti-cheat 3-way (web / mobile / SQL):** thresholds MATCH between web-client-inline and SQL (see C-4/C-6). **Mobile has NO client-side anti-cheat gate** — confirmed by full read of `mobile/lib/ui/screens/quiz/quiz_screen.dart` (679 lines) and `mobile/lib/providers/quiz_provider.dart` (417 lines): Rule 1 (min-time) and Rule 2 (same-answer) absent entirely; Rule 3 satisfied structurally (payload array sized to `state.questions.length`, unanswered slots padded `-1` at `quiz_provider.dart:300-307`), not by a deliberate check. Not a value mismatch — a web/mobile *asymmetry* (web emits a pre-submit `console.warn` telemetry signal mobile never produces). SQL v1 (`submit_quiz_results`) and v2 carry byte-identical thresholds.

---

## C-3 — `openapi/v2.json` ↔ live `/v2/**` routes · MISMATCH (systemic) · **Exhaustive (12/12)**

**Spec location:** `openapi/v2.json` (OpenAPI 3.1.0, 2,424 lines). Confirmed mobile-codegen source: `.github/workflows/mobile-ci.yml:24,30` triggers on it; `.github/workflows/openapi-contract.yml:18-21` regenerates it from `src/lib/api/v2/contract.ts` (Zod) via `npm run gen:openapi`. **Critical CI gap:** the drift-check only guarantees `v2.json` matches `contract.ts` — it does NOT verify `contract.ts` matches actual route output (exactly how `/v2/today` drifted).

**Finding #1 (systemic, HIGH):** `v2Success()` wraps every payload as `{success:true,data:<payload>}` (`envelope.ts:21-29`) but the spec's 200 responses reference the bare payload. Affects 10 routes: quiz/questions, quiz/start, quiz/submit, learn/curriculum, learn/concept, student/profile, student/progress, student/leaderboard, parent/children, parent/glance. Error envelope IS modelled (`ErrorResponse` `openapi/v2.json:243-264`) — asymmetric. The 2 exceptions match the spec: `parent/encourage` (bare `{success:true}` `encourage/route.ts:234`) and `today` (bare payload `today/route.ts:167`).

| Route | Mismatches | Worst severity |
|---|---|---|
| GET /v2/today | 5 (extra `meta.practicedToday`; extra `chapterTitle`/`chapterTitleHi`; enum missing `teacher_remediation`+`new_topic`; error shape) | HIGH — payload drift, stale contract.ts |
| GET /v2/quiz/questions | 2 (envelope; `count` domain `[5,10,15,20]` vs spec int 5–20) | HIGH (envelope) |
| POST /v2/quiz/start | 2 (envelope; response forwarded from RPC unvalidated) | HIGH (envelope) |
| POST /v2/quiz/submit | 1 (envelope) | HIGH (envelope) — cleanest payload match |
| GET /v2/learn/curriculum | 1 (envelope) | HIGH (envelope) |
| GET /v2/learn/concept | 1–2 (envelope; `sources` unvalidated) | HIGH (envelope) |
| GET /v2/student/profile | 1 (envelope) | HIGH (envelope) |
| GET /v2/student/progress | 1 (envelope) | HIGH (envelope) |
| GET /v2/student/leaderboard | 2 (envelope; `scope` accepted but never applied) | HIGH (envelope) |
| GET /v2/parent/children | 2 (envelope; spec advertises `board`/`last_active_at` route never emits) | HIGH (envelope) |
| GET /v2/parent/glance | 1 (envelope) | HIGH (envelope) |
| POST /v2/parent/encourage | 0 | **CLEAN** — only fully conformant route |

`/v2/today` root cause: payload typed by `src/lib/today/types.ts` (extra `practicedToday` `:118`, `chapterTitle*` `:92-96`, enum values `:46,51`) while spec generated from a stale `contract.ts` Today Zod; spec `TodayItemType` enum (`openapi/v2.json:1376-1389`) omits `teacher_remediation`+`new_topic`.

---

## C-4 — TS literals ↔ SQL RPC body literals · MATCH · **Exhaustive (latest RPCs)**

**Provenance:** `atomic_quiz_profile_update` and `submit_quiz_results` (v1) latest = baseline `00000000000000_baseline_from_prod.sql`. `submit_quiz_results_v2` latest = `20260623000500_reapply_submit_quiz_v2_column_fix.sql` (post-baseline) — compared both; XP/anti-cheat literals byte-identical. `src/lib/xp-rules.ts` is a re-export shim (`export * from './xp-config'` `:26`); live source `src/lib/xp-config.ts`.

**Part A — XP constants (all MATCH):**

| Constant | TS (file:line) | SQL (file:line, function) |
|---|---|---|
| quiz_per_correct = 10 | `xp-config.ts:44` | `v_xp := v_correct * 10` — baseline:7404 (v1), :7736 (v2), `20260623000500:252` |
| high_score_bonus = 20 (≥80) | `xp-config.ts:45` | `IF v_score_percent >= 80 … + 20` — baseline:7405, :7737 |
| perfect_bonus = 50 (=100) | `xp-config.ts:46` | `IF v_score_percent = 100 … + 50` — baseline:7406, :7738 |
| daily_cap = 200 | `xp-config.ts:47` | `LEAST(p_xp, 200 - v_today_quiz_xp)` — baseline:821 (7-param) |
| XP_PER_LEVEL = 500 | `xp-config.ts:71` | `FLOOR(xp/500)+1` — baseline:763 |
| score formula `ROUND((c/t)*100)` | P1 | `ROUND((v_correct::NUMERIC/v_total)*100)` — baseline:7399, :7730 |

Both v1 & v2 call the 7-param `atomic_quiz_profile_update` (cap literal `200`, baseline:821). Other `XP_RULES` (foxy/streak/chapter/topic constants `xp-config.ts:40-66`) aren't referenced by the submit RPCs (no SQL counterpart to drift).

**Part B — Anti-cheat thresholds (all MATCH, incl. operator direction):**

| Rule | TS (file:line) | SQL (file:line) | Verdict |
|---|---|---|---|
| Min 3s avg/q | flag when `< 3` — `anti-cheat.ts:16` | `v_avg_time < 3.0` — baseline:7381 (v1), :7709 (v2), `20260623000500:225` | MATCH (no boundary disagreement at 3.0s) |
| Not all-same if >3 | gate `> 3`, flag `max === len` — `anti-cheat.ts:21,26` | `v_total > 3` … `v_max_same_answer = v_total` — baseline:7385/7390, :7714/7719 | MATCH (formula-level; see C-6 for the denominator caveat) |
| Count == questions | `responseCount === questionCount` — `anti-cheat.ts:31` | `jsonb_array_length(p_responses) <> v_total` — baseline:7395, :7725 | MATCH (formula-level; see C-6 — the SQL form is tautological) |

No mismatches in value or operator, including the exact 3.0s boundary where `>`/`>=` bugs hide. Structural note: literals are hardcoded in SQL with no mechanical link to `xp-config.ts` (in sync today, drift-prone).

---

## C-5 — Student pages ↔ backing route response shapes · MATCH · **Mixed coverage**

Priority bug class hunted: auth-uid vs surrogate `students.id` mismatch. **None found.** Consistent convention everywhere: auth `user.id` used only to look up `students` via `.eq('auth_user_id', userId)`; all student-scoped child tables/RPCs key on the surrogate `students.id`.

| # | Page | Backing route(s) | Verdict | Coverage |
|---|---|---|---|---|
| 1 | dashboard | none (wrapper → `StudentOSDashboard`, AuthContext + child sections) | UNPROVEN/N/A | sampled |
| 2 | foxy | `/api/student/foxy-interaction` (+ foxy, feedback) | MATCH | sampled |
| 3 | learn/[subject]/[chapter] | none (Supabase-direct, `.eq('id', student.id)` `:466`) | MATCH | sampled |
| 4 | leaderboard | `/api/v1/leaderboard/mastery` | MATCH | exhaustive |
| 5 | progress | none (Supabase helpers + `useMyPulse`) | MATCH | sampled |
| 6 | exams | `/api/exams/sync-mastery` (fire-and-forget) | MATCH | exhaustive |
| 7 | dive | `/api/dive/{state,start,artifact}` | MATCH | exhaustive |
| 8 | synthesis | `/api/synthesis/{state,parent-share}` | MATCH | exhaustive |
| 9 | notifications | none (Supabase-direct RPCs) | MATCH | exhaustive |
| 10 | quiz | `/api/rhythm/today`, `/api/rhythm/remediation/*/resolve` (fire-and-forget) | MATCH | sampled |

**Flagged bug area (synthesis/state) is CLEAN:** resolves surrogate via `.eq('auth_user_id', userId)` (`synthesis/state/route.ts:67-75`) before querying `monthly_synthesis_runs.student_id = studentDbId` (`:82`); page `SynthesisRow` (`page.tsx:29-38`) fields all present in route output (`state/route.ts:156-165`). `parent-share` authorizes via `row.students.auth_user_id !== userId` (`parent-share/route.ts:83`) then keys `guardian_student_links.student_id` on the surrogate (`:94`). Dive routes follow the identical explicitly-commented pattern. `leaderboard/mastery` aggregates on `auth_user_id` on *both* sides of its join (`route.ts:92,123,205`) and still emits the surrogate as `student_id` — internally consistent. 4 of 10 surfaces are Supabase-direct or fire-and-forget, structurally ruling out the C-5 bug class.

**Limitations:** `/api/foxy` chat-streaming contract and `useFoxyChat` internals not deep-read; dashboard child-section routes (`/api/rhythm/today`, `/api/pulse/me`) identified but their field contracts out of scope for the named page files.

---

## C-6 — Client anti-cheat ↔ server anti-cheat · MISMATCH · **Exhaustive**

**Architecture:** Web client (`src/app/quiz/page.tsx:927-970`) is an inline duplicate (does NOT import `src/lib/anti-cheat.ts`), and post-SLC-5 all 3 checks are **advisory-only** (`console.warn`, always proceeds to submit). `src/lib/anti-cheat.ts` is a cleaner second impl used only by tests. Submit routes (`src/app/api/quiz/submit/route.ts`, `v2/quiz/submit/route.ts`) do no anti-cheat math — thin pass-throughs to the SQL RPC. SQL RPCs (`submit_quiz_results` v1 ~7274-7580, `submit_quiz_results_v2` ~7594-7880 in baseline) are the single authority: on any flag set `v_flagged:=true` → `v_xp:=0` but still INSERT the session with the REAL `score_percent`. Mobile: ABSENT (server-only).

| Check | Web client (advisory) | Server SQL (authoritative) | Mobile | Verdict |
|---|---|---|---|---|
| 1. Min 3s avg/q | `avgTimePerQ < 3` warn — page.tsx:947-948 | `v_avg_time < 3.0 AND v_total > 0` — baseline:7380-7383 (v1), :7708-7711 (v2) | ABSENT | **MATCH** (threshold+operator identical; not flagged at exactly 3.0s on either side) |
| 2. Not all-same if >3 | `len>3 && maxSameOption===len`, `mcqResponses` excludes `-1` — page.tsx:957-960 | `v_total>3` then `v_max_same_answer = v_total`, `v_total` includes `-1` but counts only 0..3 — baseline:7385-7393, :7713-7722 | ABSENT | **MISMATCH** (denominator divergence — server misses all-same when any question is blank) |
| 3. Count == questions | `allResponses.length !== questions.length` warn — page.tsx:968 | `jsonb_array_length(p_responses) <> v_total`; `v_total` incremented once per response element (:7652) → tautologically false | ABSENT | **MISMATCH** (server check can never fire; no server backstop) |

**P3 verdict:** Check 1 solid server-side. Check 2 real but blind to unanswered-inflated denominators. **Check 3 enforced nowhere server-side** (dead no-op) — exists only as an advisory client warn. Web client is advisory (telemetry, not enforcement); mobile has none. P3's literal "enforced client-side AND server-side" is weaker than the invariant text for Checks 2/3.

**Recommendations (audit-only, not applied):** (1) Fix server Check 3 — pass an authoritative served-question count (e.g. `quiz_session_shuffles` row count) and compare, replacing the dead `jsonb_array_length <> v_total`. (2) Reconcile Check 2 denominators across page.tsx, anti-cheat.ts, and the RPCs (decide whether `-1` counts). (3) Retire the inline page.tsx duplicate in favor of importing `anti-cheat.ts`.

---

## Appendix — exhaustive vs sampled per check

- **C-1:** Exhaustive — full dedup grep across all migrations (+`_legacy`), all `src/`, all `supabase/functions/`; seed migrations + registries read to filter false positives. Static-source only (no live DB).
- **C-2:** Exhaustive — all 3 file pairs read in full; mobile quiz files read in full to confirm anti-cheat absence.
- **C-3:** Exhaustive — all 12 route.ts files + `envelope.ts` + `today/types.ts` + `map-action.ts` + every relevant spec path read.
- **C-4:** Exhaustive — latest version of each RPC located and compared (baseline + post-baseline v2 override); `xp-config.ts` + `anti-cheat.ts` + inline page copy read.
- **C-5:** Mixed — 5 exhaustive (leaderboard, exams, dive, synthesis, notifications), 4 sampled (foxy, learn, progress, quiz), 1 N/A (dashboard). `/api/foxy` streaming + dashboard child-route contracts out of scope.
- **C-6:** Exhaustive per-file — anti-cheat.ts, page.tsx anti-cheat block, both submit routes, both SQL RPC anti-cheat regions, both mobile quiz files. All web client call sites located (one live inline block + one test-only helper duplicate).
