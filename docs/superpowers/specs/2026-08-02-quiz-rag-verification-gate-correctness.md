# Quiz RAG Verification Gate — Assessment Spec

**Status**: DEFINED (assessment). Not implemented. Specification-only — no migration, RPC, or flag touched by this document.
**Owner**: assessment (source of truth for correct behavior).
**Implementers**: architect (the migration itself — `select_quiz_questions_rag`), ai-engineer (only if `bulk-question-gen` / quiz-generator coordination is needed — see §8), testing (oracles in §6), backend (the caller-side gap in §3.6).
**Date**: 2026-08-02
**Authorization**: CEO-authorized fix; this document is step 1 of the review chain (assessment → architect → ai-engineer if needed → testing → quality).
**Touches invariants**: P6 (question quality — strengthens), P12 (AI safety — strengthens). **Does NOT touch P1, P2, P3, or P4** — score formula, XP formula, anti-cheat, and the atomic-submission RPC are untouched; this fix operates entirely upstream of scoring, in the question-*selection* stage.

---

## 0. Why this exists

`select_quiz_questions_rag` — the RPC that serves quiz questions to every student on `/api/quiz`, `/api/v2/quiz/questions`, and the WhatsApp Daily-6 top-up path — has never, across 7 historical versions since 2026-04-03, filtered on `question_bank.verified_against_ncert` or `verification_state`. I independently re-read the live function body (migration `20260801100700_select_quiz_questions_rag_service_role_skip.sql`, which changes only the ownership-guard condition and is byte-identical otherwise to `20260625000200`) and confirmed this directly — the function's four repeated predicate blocks (pool-count query, seen-count query, 80%-reset query, `candidate_pool` CTE) all filter only on `subject`, `grade`, `is_active = true`, optional `chapter_number`, and `question_type_v2`/`is_ncert`. None filters on any verification-state column, `deleted_at`, or `content_status`.

This matters because `question_bank` has a real, populated, four-state verification machine (`legacy_unverified → pending → verified | failed`) built specifically to stop wrong-`correct_answer_index` and hallucinated-content questions from reaching students (2026-04-17 design spec, `docs/superpowers/specs/2026-04-17-rag-grounding-integrity-design.md`). A row the automated NCERT verifier has explicitly **disproved** (`verification_state = 'failed'`) can be served to a student today with no gate at all.

## 1. Independently verified current state

### 1.1 `select_quiz_questions_rag` — live body, confirmed

Read directly from `supabase/migrations/20260801100700_select_quiz_questions_rag_service_role_skip.sql`. Current filter set, repeated identically across all four query blocks:

```sql
WHERE qb.subject = p_subject
  AND qb.grade = p_grade
  AND qb.is_active = true
  AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
  AND (qb.question_type_v2 = ANY(p_question_types) OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE))
```

Confirmed absent from every block: `deleted_at IS NULL`, `content_status = 'published'`, any `verified_against_ncert`/`verification_state` predicate. Empty-pool behavior already exists and is unrelated to my change: `IF v_total_pool = 0 THEN RETURN '[]'::jsonb; END IF;` — the function already tolerates and gracefully returns a thin/empty pool; my ladder does not need to invent this behavior, only feed the same existing mechanism a different candidate set.

**Precision on exactly which `failed` rows are exposed today**, confirmed by reading the two processes that can produce `verification_state = 'failed'`:

- **The retroactive verifier** (`supabase/functions/verify-question-bank/index.ts`, lines 237-248 — drains the `legacy_unverified` backlog per the 2026-04-17 spec's §8.3) sets, on an existing legacy row: `verification_state: newState /* 'failed' */, verified_against_ncert: isVerified /* false */` — **and does not touch `is_active` at all** in that UPDATE payload. Since those legacy rows originated with `is_active = true` (their pre-verification-system insert), a row the retroactive verifier disproves stays `is_active = true` and remains fully servable today by `select_quiz_questions_rag`'s existing `is_active = true` filter. This is the exact population this spec closes.
- **`bulk-question-gen`'s fresh-generation grounded-insert path** (lines 940-963, read directly) is more defensive on its own: it sets `is_active: verificationState === 'verified'` at INSERT time, so a freshly-generated row that fails verification at birth is already `is_active = false` and already excluded by the existing filter — this population is not at risk.

Net effect: the exposure this spec closes is concentrated in, and fully covers, the retroactively-verified legacy backlog — almost certainly the larger population, since it predates the verification system entirely. The V-predicate in §2.1 (`verification_state != 'failed'`) closes it regardless of which path produced the row, so this distinction does not change the fix, only sharpens why it matters.

### 1.2 Three call sites — confirmed behavior

| Caller | File | Verification-aware today? | Insufficient-count handling |
|---|---|---|---|
| `/api/quiz` GET `?action=questions` | `apps/host/src/app/api/quiz/route.ts` (`handleGetQuestions`) | No | Only when `chapter` is specified: filters returned rows to the requested chapter and returns 422 `insufficient_questions_in_scope` if short. **When `chapter` is omitted (whole-subject mode), there is no insufficient-count guard at all** — a shrunk RPC result is returned as `{success:true, questions}` with fewer rows than requested, silently. |
| `/api/v2/quiz/questions` GET | `apps/host/src/app/api/v2/quiz/questions/route.ts` | No | Same pattern as above, same gap: chapter-scoped path 422s on shortfall; whole-subject path does not check length before returning success. |
| WhatsApp Daily-6 top-up | `apps/host/src/app/api/whatsapp/_lib/daily6.ts` (`composeDaily6Set`) | No | Uses `select_quiz_questions_rag` only as a deficit top-up after `get_practice_queue`/`get_questions_for_node`. Applies its own local `passesP6Gate()` (P6 shape only, not verification) to every candidate including top-up rows. Degrades gracefully to `MIN_SET_SIZE = 3` with a bilingual "not enough practice" message if the whole set can't be filled. **This caller already has a comment (line ~632) explicitly flagging that the RPC's ownership guard used to reject its service-role calls** — i.e., this call site's own code comments show its author was already tracking `select_quiz_questions_rag`'s behavior closely; it says nothing about verification because there is nothing to say yet. |

None of the three callers reads `ff_grounded_ai_enforced_pairs`. Confirmed by grep: zero matches for `ff_grounded_ai_enforced_pairs` anywhere under `apps/host/src/app/api/quiz`, `apps/host/src/app/api/v2`, or `apps/host/src/app/api/whatsapp`.

### 1.3 Column semantics — resolved with HIGH confidence (this was an open question in the diagnostic-cold-start spec; I resolved it here by reading the trigger and generator code directly)

Three verification-ish columns exist on `question_bank`. Their actual relationship, confirmed from source (not inferred):

| Column | Type / default | What sets it | Evidence |
|---|---|---|---|
| `verification_state` | `text DEFAULT 'legacy_unverified' NOT NULL`, `CHECK IN ('legacy_unverified','pending','verified','failed')` | The automated NCERT-grounding verifier state machine. | Baseline line 2207/2229. **Only this column has a `COMMENT ON COLUMN`**: *"State machine: legacy_unverified (never checked) -> pending (claimed by verifier) -> verified (proven by NCERT chunks) OR failed (verifier disagreed)."* (baseline line 2233). |
| `verified_against_ncert` | `boolean DEFAULT false NOT NULL` | Set **in lockstep** with `verification_state` by the two-pass verifier. | `supabase/functions/bulk-question-gen/index.ts` lines 956-957, same object literal: `verification_state: verificationState, verified_against_ncert: verificationState === 'verified'`. There is no code path that sets one without the other. |
| `is_verified` | `boolean DEFAULT false`, no CHECK, no comment | Human/SME manual review flag — a **different mechanism** from the automated verifier. | Set only by `apps/host/src/app/api/internal/admin/content/route.ts`, `apps/host/src/app/api/super-admin/cms/route.ts`, `apps/host/src/app/api/super-admin/demo-accounts/route.ts` — CMS/admin content routes, never by the verifier pipeline. |

Further confirmation that `verified_against_ncert` (not `verification_state`, not `is_verified`) is the column the *rest of the schema already treats as the serve-path source of truth*:

- **Partial index built for exactly this predicate**: `idx_question_bank_verified ON question_bank(grade, subject, chapter_number) WHERE verified_against_ncert = true AND deleted_at IS NULL` (baseline line 17606). This index only makes sense as an optimization for a query that filters on precisely this combination — it is unused today because no query does.
- **The recompute trigger watches it**: `trg_question_bank_recompute()` fires `recompute_syllabus_status()` only when `verified_against_ncert` or `deleted_at` changes (baseline lines 8123-8134).
- **It is the column that feeds `cbse_syllabus.verified_question_count`** (which gates `rag_status='ready'` at `>= 40`): `recompute_syllabus_status()` counts `WHERE ... AND verified_against_ncert = true AND deleted_at IS NULL` (baseline lines 6395-6401). This resolves the diagnostic-cold-start spec's own §9 row 3 open question ("I could not determine which predicate feeds this counter") — it is `verified_against_ncert = true`, confirmed directly from the function body.

**Decision**: primary filter predicate is **`verified_against_ncert = true AND verification_state = 'verified'`** — both, ANDed, belt-and-suspenders. They are supposed to always agree (per the generator code above); requiring both costs nothing (both are plain boolean/text equality on an already-fetched row, and Postgres will use the existing partial index on `verified_against_ncert` with `verification_state` as a cheap residual filter) and defends against a future write path that could desync them. The pre-rollout census (§7) includes an explicit check for existing disagreement between the two columns.

### 1.4 `ff_grounded_ai_enforced_pairs` — real, tested, hysteresis-protected, and currently a pure no-op with respect to serving

Confirmed live table (baseline lines 11242-11250):

```sql
CREATE TABLE ff_grounded_ai_enforced_pairs (
  grade text NOT NULL,
  subject_code text NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  enabled_at timestamptz,
  enabled_by uuid,
  auto_disabled_at timestamptz,
  auto_disabled_reason text,
  PRIMARY KEY (grade, subject_code)
);
```

This is not a dormant stub — it is an actively maintained, two-sided control loop:

1. **Enable side** (`apps/host/src/app/api/super-admin/grounding/verification-queue/route.ts`, `enable-enforcement` action): admin-triggered, but the server recomputes `verified_ratio` itself (never trusts a client-supplied number) and **hard-denies** the UPSERT unless `verified_ratio >= 0.9` for that (grade, subject) pair, computed as `count(verification_state='verified') / count(*, deleted_at IS NULL)`.
2. **Disable side** (`supabase/functions/coverage-audit/index.ts`, run nightly 03:00 IST): recomputes per-pair `verified_ratio` from per-chapter stats (`computeVerifiedRatios` in `shared.ts`, summing `cbse_syllabus.verified_question_count`/`total_questions_in_chapter()` across chapters) and **auto-disables** any enabled pair whose ratio drops below `AUTO_DISABLE_RATIO_THRESHOLD = 0.85`.

The 0.90 enable-floor vs. 0.85 disable-floor is a deliberate hysteresis band (confirmed by reading both thresholds directly) that prevents flapping. Both sides have existing test coverage (`apps/host/src/__tests__/coverage-audit-logic.test.ts`, `apps/host/src/__tests__/api/super-admin/verification-queue-actions.test.ts`).

**Nothing reads `.enabled` in the serving path.** Confirmed by grep across all three call sites (§1.2): zero matches. The rollout runbook (`docs/runbooks/grounding/rollout-sequence.md`) already assumes this wiring exists — its rollback instructions read *"students for that pair fall back to the non-enforced service path (still grounded but lenient)"* and its Day-4 pilot preconditions gate on `verified_ratio >= 0.9 AND total_questions > 100` before flipping the pair. The runbook's authors built the control plane assuming the serve-path read it. It never did.

### 1.5 Two pre-existing filter gaps found incidentally while reading the live WHERE clause

Independent of verification, I found the RPC also does not filter:

- **`deleted_at IS NULL`** — a super-admin who uses the verification-queue's `soft-delete` action (sets `deleted_at = now()`, leaves `is_active` untouched) believes the question is pulled from serving. It is not: `select_quiz_questions_rag` never checks `deleted_at`. `total_questions_in_chapter()` (used by coverage-audit for ratio math) filters `deleted_at IS NULL` but nothing else in the serving path does — a real, live inconsistency between "what admins believe soft-delete does" and what actually happens.
- **`content_status = 'published'`** — `question_bank.content_status` defaults to `'published'` but has a real `draft`/`review`/`archived` lifecycle (`question_bank_content_status_check`, `transition_content_status()` RPC). The diagnostic-cold-start-correctness spec independently flagged the identical gap on `/api/diagnostic/start` (§9 row 7: *"today a draft question can reach a student. That is a live P6-adjacent defect independent of everything else here."*) — my own read of `select_quiz_questions_rag` confirms the same defect exists here too.

Since I am already touching this exact WHERE clause for the verification fix, I fold both closures into this spec as Tier-0 predicates (§2) rather than leaving them for a separate pass — same clause, same migration, no additional review-chain surface.

## 2. Design decision

### 2.1 Tier-0 hard predicates — apply always, to every pair, enforced or not, never relaxed

| # | Predicate | Status today | Rationale |
|---|---|---|---|
| existing | `subject`, `grade`, `is_active = true`, chapter/type match | unchanged | Pre-existing, correct, not touched. |
| **new** | `deleted_at IS NULL` | **gap, closing now** | Closes §1.5 gap 1 — soft-delete must mean soft-delete. |
| **new** | `content_status = 'published'` | **gap, closing now** | Closes §1.5 gap 2 — matches the diagnostic-cold-start spec's identical finding for a sibling serving path. |
| **new** | `verification_state != 'failed'` | **gap, closing now** | A row the automated verifier explicitly disproved must never be served, enforced pair or not. **This is the one part of this design with no fallback rung** — see §3.4. |

All four are ANDed into the same WHERE clause, applied consistently across all four repeated predicate blocks in the function body (pool-count, seen-count, reset/delete, `candidate_pool` CTE) — the same way `is_active` and the chapter/type filters are already repeated identically in all four places today. Inconsistent application across the four blocks would desync the pool-count math from the actual candidate set and could mis-trigger the existing 80%-reset logic (REG-172); this is a correctness requirement for the implementer, not a stylistic preference.

### 2.2 Gating mechanism — WIRE `ff_grounded_ai_enforced_pairs`, do not hard-code a global filter

**Recommendation: wire the existing, tested, hysteresis-protected mechanism. Do not ship a global `verified_against_ncert = true` filter.**

Reasoning:

1. **A global filter is a real P0 risk the task explicitly warned about.** If every (grade, subject) pair suddenly required `verified_against_ncert = true` overnight, every pair that has not been through the enable-workflow (which requires `verified_ratio >= 0.9`, a bar the corpus may not clear anywhere yet — §7 census will confirm) would have its candidate pool shrink to whatever fraction is currently verified, which could be zero for entire subjects. That is a materially worse regression than the current gap: today a wrong-but-served question is bad; an empty quiz for every student in a subject is catastrophic and immediately visible.
2. **The mechanism already exists, is tested, and is already correctly gated.** The enable side requires server-recomputed `verified_ratio >= 0.9`; the disable side auto-reverts at `< 0.85`; both have unit tests. Building a second, parallel enforcement concept would duplicate logic that already works.
3. **This is what the original architecture already decided.** The 2026-04-17 design spec's own §4 ("Four unbreakable invariants") states: *"No quiz question reaches a student without `verified_against_ncert = true` (once `ff_grounded_ai_enforced` is ON for that pair)"* and §5.3 states the RPC should filter `verified_against_ncert = true` **when the pair is enforced**, otherwise serve `legacy_unverified` + `verified` (never `failed`). My design is not a new plan — it is the original, approved plan (approved by the user during the 2026-04-17 brainstorm, per that spec's own header), simply finally implemented, with one refinement (§2.3) the original spec didn't specify.
4. **This makes the fix additive and safe-by-default for the ~100% of pairs not yet enabled.** For any pair without `enabled = true`, the only observable behavior change from this fix is the three Tier-0 closures in §2.1 (soft-delete respected, draft/archived excluded, verifier-disproved rows excluded) — all three are small, and none can plausibly empty a pool that isn't already pathologically thin, because they only ever *remove* rows a well-formed, currently-served bank wouldn't have had much of anyway. Enabled pairs get the strict filter, which is exactly what the enable-workflow already promised the admin who flipped it.

### 2.3 The refinement the original spec didn't specify: local thinness under an enforced pair

The enable-workflow's `verified_ratio >= 0.9` check is computed **at the (grade, subject) pair level**, aggregated across every chapter (confirmed: `enable-enforcement`'s query has no chapter filter; `coverage-audit`'s `computeVerifiedRatios` sums across chapters before dividing). A pair can clear 90% in aggregate while a specific chapter, or a specific (chapter × difficulty) slice within it, is far thinner — the same "aggregate coverage hides local gaps" pattern the diagnostic-cold-start-correctness spec's own §2.3/§9 row 8 already documented for a sibling serving path. A binary "filter if enforced, else don't" (the original §5.3 wording, taken completely literally) would let a single popular hard-difficulty request on a thin chapter return far fewer than `p_count` rows, or none, even though the pair overall is healthy. This is the ladder in §3.

## 3. The fallback ladder

### 3.1 Rungs

| Rung | Applies when | Predicate (in addition to Tier-0, §2.1) | `verification_tier` in response (recommended addition — see §3.3) |
|---|---|---|---|
| **E0 — strict** | Pair has `ff_grounded_ai_enforced_pairs.enabled = true` for `(p_grade, p_subject)`, AND the Tier-0-filtered candidate count for the exact requested slice (chapter/type/difficulty as already scoped by the existing WHERE clause) with `verified_against_ncert = true AND verification_state = 'verified'` is `>= p_count` | `verified_against_ncert = true AND verification_state = 'verified'` | `verified` |
| **E1 — relaxed** | Pair is enforced but the E0 pool for this exact slice is `< p_count` | Tier-0 only (no additional requirement beyond excluding `failed`) | `standard` |
| **default — unenforced** | Pair does not have `enabled = true` (no row, or `enabled = false`) | Tier-0 only — behaviorally identical to E1 | `standard` |
| **floor** | Not a new rung — the function's existing "return fewer than `p_count`, or `[]` if the Tier-0 pool is itself zero" behavior, unchanged | n/a | n/a |

**Key safety property**: the worst case this change can ever reach for any pair, enforced or not, is Rung E1/default — which is defined to be exactly today's live behavior minus the three Tier-0 closures in §2.1. **This fix cannot make quiz availability worse than it is today**, for any (grade, subject, chapter) combination, under any condition. The only way a pool shrinks below what it would return today is if a request would have included a `deleted_at`-set, non-`published`, or verifier-`failed` row — and none of those should be counted as legitimate availability in the first place.

### 3.2 Implementation shape (illustrative only — architect owns the actual migration SQL)

Conceptually, one additional lookup plus a two-step size check, not a full second query pass:

```
-- 1. one indexed lookup, composite PK, cheap:
v_pair_enforced := EXISTS (
  SELECT 1 FROM ff_grounded_ai_enforced_pairs
  WHERE grade = p_grade AND subject_code = p_subject AND enabled = true
);

-- 2. count candidates under Tier-0 + the E0 predicate, for the EXACT
--    requested slice (same chapter/type/difficulty scoping the existing
--    candidate_pool CTE already applies):
v_verified_pool := <count with verified_against_ncert=true AND verification_state='verified'>;

-- 3. choose the tier for the actual selection:
v_use_strict := v_pair_enforced AND v_verified_pool >= p_count;

-- 4. candidate_pool CTE's WHERE clause gets, in addition to existing predicates:
  AND qb.deleted_at IS NULL
  AND qb.content_status = 'published'
  AND qb.verification_state != 'failed'
  AND (NOT v_use_strict OR (qb.verified_against_ncert = true AND qb.verification_state = 'verified'))
```

Step 4's `AND (NOT v_use_strict OR (...))` is a single shared code path for both E1 and the unenforced default — they are the same filter, so there is no need for the migration to branch into two separate query bodies.

### 3.3 Ranking preference — recommended, not required

Independent of the WHERE-clause change, I recommend adding a `verified_rank` computed column to the existing `ORDER BY seen_rank, ncert_rank, relevance_score DESC, last_shown_at` — `CASE WHEN verification_state = 'verified' THEN 0 ELSE 1 END`, ordered immediately after `ncert_rank`. This is architecturally identical in style to the existing `ncert_rank` preference (prefer `is_ncert = true` without making it a filter) and carries zero availability risk since it only reorders an already-passing pool. It improves quality even for unenforced pairs at no cost. This is a SHOULD, not a MUST — architect may defer it to keep the diff minimal, since the WHERE-clause change is the load-bearing part of this fix.

### 3.4 Why `verification_state != 'failed'` has no fallback rung

This is the one Tier-0 predicate in §2.1 that is genuinely non-negotiable at every rung, mirroring the diagnostic-cold-start spec's own precedent for its equivalent predicate (that spec's V15/AC-7: *"A row with verification_state='failed'... is excluded even when it is the only item that would let the blueprint fill. The correct outcome is degradation, never inclusion."*). A `failed` row is not merely unverified — the automated verifier actively compared it against NCERT source chunks and determined the claimed answer is wrong. There is no rung at which serving it is an acceptable trade for pool size; the existing "return fewer than requested" floor (§3.1) is the correct outcome if excluding `failed` rows shrinks a pool, exactly as it already is for every other Tier-0 predicate.

### 3.5 Telemetry

When Rung E1 is used **because of thinness** (i.e., `v_pair_enforced = true` but `v_verified_pool < p_count`) — not the unenforced-default case, which is expected and not a gap — emit an `ops_events` row: `category = 'grounding.quiz_serving'`, `message = 'quiz_verification_gap'`, `context = {grade, subject, chapter_number, difficulty_mode, question_types, verified_pool_count, requested_count}`. No student identifiers (P13). This is the signal that an enabled pair's pair-level 90% aggregate is masking a locally-thin chapter/difficulty slice — exactly the blind spot §2.3 identifies — surfaced to ops without ever degrading the student experience, since E1 already filled the gap by the time this fires.

### 3.6 Caller-side gap flagged for backend (not mine to redesign, but newly exposed by this fix)

`/api/quiz` GET and `/api/v2/quiz/questions` GET have **no insufficient-count guard when `chapter` is omitted** (§1.2). Today this is invisible because there is no filter that can shrink the whole-subject pool meaningfully. After this fix, an enabled pair with a thin verified pool in some difficulty/type slice could, for the first time, silently return fewer questions than requested with no warning to the student and no telemetry to ops (the RPC-level telemetry in §3.5 only fires for the enforced-and-thin case, which is exactly this scenario). **Recommend to backend**: add a length-check + `ops_events` emission (not a hard reject — a smaller-than-requested whole-subject quiz can be legitimate for reasons unrelated to verification) on the whole-subject path. This is additive, does not change my RPC's contract, and is flagged here per P14 rather than designed in full — it is backend's call how to shape the response.

## 4. Documentation corrections required

### 4.1 Two false "done" claims in the 2026-04-18 completion report — confirmed by direct grep, exact quotes

`docs/superpowers/completion/2026-04-18-rag-grounding-integrity-complete.md`:

1. **Line 87** (§6, "Post-deploy hotfix" — used as the safety justification for widening the subjects/chapters v2 RPC filter): *"Architecture self-gates at lower layers: grounded-answer coverage precheck and quiz `verified_against_ncert` filter both still enforce strictness. No end-user safety regression."* — **False.** No such filter exists in `select_quiz_questions_rag`, confirmed by direct read (§1.1). This is the more consequential of the two: it was load-bearing justification for a real production decision (the hotfix), and that decision's safety argument was partly unfounded — though the hotfix itself (widening `rag_status IN ('partial','ready')` for subject/chapter visibility) is a separate mechanism from question serving and is not itself invalidated by this finding.
2. **Line 104** ("Product-invariant compliance" table): *"P6 (question quality) | **Strengthened** | `verified_against_ncert` gate prevents unverified rows reaching students."* — **False**, same root cause.

Both lines must be corrected once this spec ships, to read as historical record (what was actually true as of 2026-04-18) rather than be silently left to mislead the next person who reads it as confirmation the gate exists. I flag the exact edits needed but do not make them in this pass (out of scope — specification only); whoever implements this fix should append a dated correction note to that file rather than rewrite history, consistent with how this repository's other completion reports handle post-hoc corrections (see the addendum pattern already used later in the same file, "Addendum 2026-04-18 evening — post-deploy hotfixes").

Note for completeness: I found exactly two literal occurrences of `verified_against_ncert` in that file. A third mention (line 56, describing `bulk-question-gen`'s ingestion-time verifier setting the column) is **accurate as written** — it describes ingestion, not serving, and does not claim a serve-path gate. I am not fabricating a third false claim; the task's "twice" matches what I found exactly.

### 4.2 Does the 2026-04-17 design spec's §5.3 need revision?

**No — the core design is confirmed correct, not superseded.** Reality (my independent read of the actual column semantics, the actual `ff_grounded_ai_enforced_pairs` mechanism, and the actual generator code) matches what §5.3 already specified: gate by the enforced-pairs mechanism; primary predicate is `verified_against_ncert = true`; the fallback (when not enforced) serves `legacy_unverified` + `verified`, never `failed`. This spec's contribution is **additive refinement**, not redesign:

- The local-thinness fallback ladder (§2.3/§3) — §5.3 only described a binary enforced/not-enforced switch, not a per-request rung for a locally-thin chapter inside an aggregately-healthy pair.
- The defensive double-predicate (`verified_against_ncert = true AND verification_state = 'verified'`) — §5.3 named only the boolean column.
- The two adjacent Tier-0 closures (`deleted_at`, `content_status`) — outside §5.3's original scope, folded in here because this spec touches the same clause.
- Telemetry (§3.5) — not specified in §5.3.

Nothing here contradicts the approved architecture. Implementers should treat this spec as "finish what was already approved," which is also why no *new* user approval is required beyond the CEO authorization already granted for this fix (see §8).

## 5. Non-goals — explicitly out of scope for this fix

- **`select_quiz_questions_v2`** — a sibling RPC, deliberately not touched by the 2026-08-01 ownership-guard migration either ("no service-role caller needs it today; widen it only when a concrete caller exists"). Not in scope here; widen only if a concrete caller needs verification-awareness later.
- **`supabase/functions/grounded-answer/coverage.ts`** — already fixed this session, unrelated mechanism (readiness gate for Foxy/NCERT-solver grounding, not question-bank serving). Not touched.
- **`chk_source_type` / competition-tier exclusion** (`jee_archive`, `neet_archive`, `olympiad`, `pyq`) — a different quality dimension (content provenance, not verification). The diagnostic-cold-start spec excludes these for its own cold-start blueprint; this spec does not extend that exclusion to general quiz serving, since there is no evidence today that competition-tier rows are cross-contaminating CBSE-subject quiz pools, and adding an unrelated filter would expand this fix's blast radius without a demonstrated problem. Flagging only, not acting.
- **`packages/lib/src/quiz/question-validation.ts::validateQuestion()`** — the canonical P6 gate. Entirely unaffected by this fix. This spec adds a verification-state layer *in addition to*, not *instead of*, P6's structural checks, which are enforced elsewhere in the pipeline (ingestion/authoring) and are not part of `select_quiz_questions_rag`'s own responsibility today (confirmed: none of the three call sites runs `validateQuestion()` against `select_quiz_questions_rag`'s output before serving — that is a separate, pre-existing gap outside this spec's scope, not introduced or worsened by it).
- **`is_verified` (human/SME flag)** — remains ranking/administrative metadata only, not a filter, consistent with the diagnostic-cold-start spec's own position on the equivalent column. If ops/architect later determines `is_verified` should be a hard gate, that is a separate decision requiring its own review chain (this spec's §2.1 predicate list does not include it).

## 6. Required test coverage

The originally-planned tests (2026-04-17 spec §12.2: `quiz_route_serves_only_verified_when_enforced`, `quiz_route_serves_legacy_when_not_enforced`) were scoped at the **route** layer. That is the wrong layer for this design: the enforcement decision lives entirely inside the RPC (§2.2's rationale — one place, not duplicated per caller), so none of the three route handlers has any code path that differs between an enforced and unenforced pair. A route-level mock of `select_quiz_questions_rag`'s return value cannot exercise the actual filtering logic — it can only prove the route passes rows through unchanged, which is a real but much narrower thing to test. Retargeting:

### 6.1 PR-gating structure test (runs on every PR, no DB) — mirrors `apps/host/src/__tests__/contract/v3-school-rpc-predeploy.test.ts`

New file, e.g. `apps/host/src/__tests__/contract/select-quiz-questions-rag-verification-gate.test.ts`. Reads the new migration's SQL text via `readFileSync` (same pattern as the referenced file — extract each of the four repeated predicate blocks via marker strings) and asserts, textually, structurally, without executing SQL:
- Every one of the four blocks contains `deleted_at IS NULL`, `content_status = 'published'`, and `verification_state != 'failed'` (or equivalent, e.g. `NOT IN ('failed')`).
- The `candidate_pool` CTE contains the conditional `verified_against_ncert = true AND verification_state = 'verified'` predicate wired to the enforcement check.
- A lookup against `ff_grounded_ai_enforced_pairs` exists in the function body.
- This is the test that actually gates every PR — per this repo's established "honest coverage statement" convention (see `v3-school-rpc-predeploy.test.ts`'s own header comment), the live-DB test below does **not** run on a normal PR, so this structure test is what must catch source drift.

### 6.2 Live-DB integration test (gated, `RUN_INTEGRATION_TESTS=1`) — mirrors `apps/host/src/__tests__/migrations/get-plan-limit-school-coverage.test.ts`

New file, e.g. `apps/host/src/__tests__/migrations/select-quiz-questions-rag-verification-gate.test.ts`, using `hasSupabaseIntegrationEnv()`/`skipIfNoSubstrate()` from `../helpers/integration`, seeding synthetic `question_bank` rows (mix of `verified`/`legacy_unverified`/`pending`/`failed`) and a synthetic `ff_grounded_ai_enforced_pairs` row, calling the **real** RPC via `supabaseAdmin.rpc('select_quiz_questions_rag', ...)`, tearing down after. Required assertions (renamed from the originals to reflect the correct layer):
- **`rpc_serves_only_verified_when_pair_enforced_and_pool_sufficient`** — pair enabled, verified pool `>= p_count` → every returned row has `verification_state = 'verified'`.
- **`rpc_falls_back_to_relaxed_tier_when_pair_enforced_but_locally_thin`** — pair enabled, verified pool `< p_count` for the requested slice, but `legacy_unverified`/`pending` rows exist → returned count reaches `p_count` (or the true ceiling), and the returned set is not restricted to `verified` only. Also assert the `quiz_verification_gap` telemetry event fires (§3.5).
- **`rpc_serves_legacy_and_verified_when_pair_not_enforced`** — no `ff_grounded_ai_enforced_pairs` row (or `enabled = false`) → both `verified` and `legacy_unverified`/`pending` rows appear; behaviorally unchanged from pre-fix except for the exclusions below.
- **`rpc_never_serves_failed_rows_enforced_or_not`** — seed a pool where `failed` rows are the *only* way to reach `p_count` → returned count is less than `p_count` (or zero), never includes a `failed` row, in both enforced and unenforced configurations.
- **`rpc_never_serves_soft_deleted_or_unpublished_rows`** — seed rows with `deleted_at` set and rows with `content_status IN ('draft','review','archived')` → never returned, regardless of `is_active`/verification state.
- Honest-coverage-statement comment required at the top of this file, matching the referenced precedent exactly (does not run on normal PRs; §6.1 is what gates).

### 6.3 Pure-function ladder-decision unit test — mirrors `apps/host/src/__tests__/regressions/reg-172-pool-reset-tiny-chapter.test.ts`

Recommend (not mandatory) extracting the Rung E0/E1 decision as a small, DB-free pure function analogous to `shouldResetPool()` — e.g. `selectVerificationTier(pairEnforced: boolean, verifiedPoolCount: number, requestedCount: number): 'strict' | 'relaxed'` — living wherever architect judges appropriate for reuse between the migration's own logic-mirroring test and any future TS caller. Table-driven cases: pair not enforced (always `'relaxed'`); pair enforced, pool `>= p_count` (`'strict'`); pair enforced, pool `< p_count` (`'relaxed'`); boundary at `pool === p_count` (`'strict'`, inclusive per §3.1's `>=`).

### 6.4 E2E replacement for `e2e/grounding/quiz-enforced-pair.spec.ts`

The current spec (`e2e/grounding/quiz-enforced-pair.spec.ts`) fully intercepts `**/api/quiz**` via `page.route()` and asserts against its own mocked response — it proves the UI can render a question, nothing about actual filtering. Two additional problems found while reading it, both must be fixed in the replacement, not just the mocking:
- Its own header comment claims *"in Alfanumrik /quiz redirects to /foxy"* — this contradicts the current, dated statement in root `CLAUDE.md`: *"`/quiz` is a live, heavily-linked page (quiz orchestrator) — it does NOT redirect."* The replacement must navigate whatever the actual current live quiz flow is, not this stale assumption.
- It never exercises verification filtering at all — the "unverified" vs "verified" distinction in its mock is asserted only against a hand-authored fixture, not against real server behavior.

Replacement requires **real seeded data** (a synthetic (grade, subject) pair with `ff_grounded_ai_enforced_pairs.enabled = true` and a known mix of `verified`/`legacy_unverified` question rows) and no `page.route()` interception of the quiz API — the student-facing flow must actually call the real RPC. This has an infrastructure dependency this spec does not resolve: there is no existing E2E seeding pattern for `question_bank` content specifically (checked; found none). Testing/architect must decide the seeding mechanism (a migration-time fixture, a `beforeAll` seed via `supabaseAdmin`, or a dedicated test-only pair reserved for this purpose) — flagged here as a real dependency, not silently assumed away.

### 6.5 Acceptance-criteria summary (table form, mirrors the diagnostic-cold-start spec's §8 style)

| ID | Oracle |
|---|---|
| AC-1 | Pair enabled, verified pool ≥ requested count → 100% of returned rows have `verification_state='verified' AND verified_against_ncert=true`. |
| AC-2 | Pair enabled, verified pool < requested count, non-failed pool ≥ requested count → returned count reaches the requested count; set includes non-`verified` rows; `quiz_verification_gap` telemetry fires exactly once per such call. |
| AC-3 | Pair not enabled (absent or `enabled=false`) → behavior identical to AC-2's relaxed set (no telemetry fires — this is not a gap, it's the expected default). |
| AC-4 | `failed` rows are never returned, in any of AC-1/AC-2/AC-3's configurations, even when they are the only rows that would reach the requested count. |
| AC-5 | `deleted_at IS NOT NULL` rows never returned regardless of `is_active`. |
| AC-6 | `content_status IN ('draft','review','archived')` rows never returned regardless of `is_active`. |
| AC-7 | The four repeated predicate blocks in the migration apply identically (structure test, §6.1) — prevents a pool-count/candidate-set mismatch that could mis-trigger the unrelated REG-172 80%-reset logic. |
| AC-8 | P1 unaffected: `score_percent` formula and its inputs (`selectedIndex === correct_answer_index`) are untouched by this change — this fix only narrows which rows are eligible for selection, never how a served row is graded. |
| AC-9 | P3 unaffected: anti-cheat thresholds (timing, all-same-answer, response-count) are untouched — this fix runs entirely upstream of a quiz attempt. |
| AC-10 | P6 unaffected: `validateQuestion()` behavior and its call sites are untouched. |

## 7. Production data required before rollout — I do not have DB access; these queries must be run by someone who does

### 7.1 Per-(grade, subject, chapter, difficulty) verified-pool census — finer-grained than any existing dashboard

Neither the verification-queue GET route nor coverage-audit's ratio computation breaks down below the (grade, subject) pair level (confirmed by reading both — `byPair` aggregation has no chapter dimension). This is exactly the blind spot §2.3 exists to cover, so the following must be run and reviewed before any pair is armed under this new gate:

```sql
SELECT grade, subject, chapter_number, difficulty,
       count(*) FILTER (WHERE verified_against_ncert = true AND verification_state = 'verified') AS verified,
       count(*) FILTER (WHERE verification_state = 'legacy_unverified') AS legacy,
       count(*) FILTER (WHERE verification_state = 'pending')          AS pending,
       count(*) FILTER (WHERE verification_state = 'failed')           AS failed,
       count(*)                                                        AS total
  FROM question_bank
 WHERE is_active = true AND deleted_at IS NULL AND content_status = 'published'
 GROUP BY grade, subject, chapter_number, difficulty
 ORDER BY grade, subject, chapter_number, difficulty;
```

Attach the output to the implementation PR. Any (grade, subject, chapter, difficulty) cell where `verified < 10` (a reasonable single-quiz `p_count` floor) for a pair that is a candidate for near-term enforcement is expected to hit Rung E1 routinely — not a blocker, but ops should know before enabling, not discover it via the §3.5 telemetry after the fact.

### 7.2 Column-agreement check — confirms or refutes the §1.3/§2.1 lockstep assumption

```sql
SELECT count(*) AS disagreeing_rows
  FROM question_bank
 WHERE (verified_against_ncert = true) != (verification_state = 'verified');
```

Expected result: `0`. If non-zero, the defensive double-predicate in §2.1 (`verified_against_ncert = true AND verification_state = 'verified'`) will exclude some rows one column alone would call verified — investigate those specific rows before rollout rather than silently accepting whichever column "wins."

### 7.3 `failed`-exclusion impact — confirms §3.4's floor doesn't silently empty an existing chapter

```sql
SELECT grade, subject, chapter_number,
       count(*) FILTER (WHERE verification_state != 'failed') AS pool_after_exclusion,
       count(*) FILTER (WHERE verification_state = 'failed')  AS would_be_excluded
  FROM question_bank
 WHERE is_active = true AND deleted_at IS NULL AND content_status = 'published'
 GROUP BY grade, subject, chapter_number
HAVING count(*) FILTER (WHERE verification_state = 'failed') > 0
 ORDER BY pool_after_exclusion ASC;
```

Any row where `pool_after_exclusion` is small (single digits) and `would_be_excluded` is a meaningful fraction of the chapter's total needs a content-remediation follow-up (re-verify or regenerate replacements) queued **before** this ships — per §3.4, the correct response to a thin post-exclusion pool is content remediation, never re-admitting a disproved row.

### 7.4 Existing enforcement state — is anything already armed?

```sql
SELECT grade, subject_code, enabled, enabled_at, auto_disabled_at, auto_disabled_reason
  FROM ff_grounded_ai_enforced_pairs
 ORDER BY grade, subject_code;
```

If any pair already shows `enabled = true` (set by an admin at some point, inert until this fix ships), that pair will experience the strict Rung E0 filter the instant this migration deploys — confirm those specific pairs' §7.1 census cells look healthy before deploying, since deployment itself is the "flip" for any already-enabled pair, not a separate rollout step.

## 8. Review chain (P14)

Per `.claude/CLAUDE.md`, this is both a **grading/XP-adjacent question-quality rule** (P6-touching) and a **learner-state-adjacent selection rule**, authored by assessment. Mandatory downstream reviewers:

| Agent | What they must review |
|---|---|
| **architect** | The actual migration implementing §2-§3 (predicates, the enforcement lookup, the ladder's SQL shape); confirms the illustrative shape in §3.2 translates correctly into real, idempotent `CREATE OR REPLACE FUNCTION` SQL; confirms the four repeated blocks stay in sync (AC-7). |
| **ai-engineer** | Only if `bulk-question-gen`/quiz-generator's own insert logic needs to change — it should not (this fix is entirely serve-side; §1.3 already confirmed the generator's insert behavior is correct and unaffected). Review is a confirmation, not an implementation task, unless the §7.2/§7.3 census surfaces a generator-side defect. |
| **testing** | §6 in full — the retargeted layer split (§6.1 structure / §6.2 live-DB / §6.3 pure-function / §6.4 E2E), and the AC table (§6.5). |
| **backend** | §3.6 — the caller-side insufficient-count gap this fix newly exposes on the whole-subject path. Not required to implement in the same PR, but must acknowledge the gap. |
| **ops** | §7 — must run all four census queries before any pair is newly enabled under this gate, and should audit whether any pair is already `enabled=true` today (§7.4) before the migration deploys. |
| **quality** | Final gate — confirms this spec's non-goals (§5) were respected and no scope crept into `select_quiz_questions_v2`, `coverage.ts`, `question-validation.ts`, or `chk_source_type`. |

**No new user approval required beyond the CEO authorization already granted for this fix** (per the task framing) — this spec does not introduce a new product invariant, does not weaken P1/P3/P4, and its core design (§2.2, §4.2) is the original 2026-04-17 architecture, already user-approved, finally being implemented rather than redesigned. If architect's implementation diverges materially from §2-§3 (e.g., chooses a different gating mechanism than `ff_grounded_ai_enforced_pairs`), that divergence must come back to assessment before merge, per the standard "hand the new expected behavior back to assessment" rule for AI/selection-behavior changes.
