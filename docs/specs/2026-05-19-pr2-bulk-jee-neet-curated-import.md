# PR-2 — `exam_papers` Table + `bulk-jee-neet-curated-import` Edge Function

**Date:** 2026-05-19
**Status:** In flight (this PR)
**Predecessor:** PR-1 `supabase/migrations/20260520000004_jee_neet_schema_unblock.sql`
**Successor:** PR-3 (content seed of 200 PYQs)
**Authors:** architect (schema), backend (Edge Function), ops (this spec)
**Reviewers required (P14):** assessment (P6 quality), testing, quality

> **Two PR-2 ingestion paths shipped concurrently** — `bulk-jee-neet-import/` (AI-augmented, see #863) and `bulk-jee-neet-curated-import/` (this doc, manually-curated by admin). Both write to `question_bank` with `source_type ∈ {jee_archive, neet_archive, olympiad, board_paper, pyq, curated}` per PR-1's widened CHECK constraint.

---

## 1. Goal

Enable admin curators to import a complete JEE Main / JEE Advanced / NEET / Olympiad paper as a single bundle — paper metadata plus 30 to 90 questions — in one Edge Function call, with per-question P6 validation, partial-success semantics (the paper row is created even if some questions are rejected), and explicit per-rejection diagnostic codes the curator can act on.

In one sentence: PR-2 makes the columns added in PR-1 actually fillable from the outside world, through a controlled, auditable, admin-gated path.

---

## 2. Why now

PR-1 widened `question_bank.chk_source_type` to accept `jee_archive` / `neet_archive` / `olympiad` and added six nullable PYQ-tracking columns. Without PR-2 those columns are inert — there is no API surface that writes them. The existing `bulk-question-gen` Edge Function is AI-generation only and writes `source = 'ai_generated'` (see `supabase/functions/bulk-question-gen/index.ts:122-130`). Curated PYQs need a different code path: no Claude call, strict validation, and a 1-to-N paper-to-question relationship that AI-generation does not have.

The Phase 2 RPC `get_adaptive_questions_v2` already filters on `qb.is_active = true` (see `supabase/migrations/20260503140000_add_phase2_goal_aware_selection.sql:241`) and will surface newly imported rows the moment `ff_goal_aware_selection` is flipped. So PR-2 unblocks PR-3 (content seed), which unblocks PR-4 (flag flip), which unblocks PR-5 (student-visible Mock Test).

---

## 3. Schema delta

The sibling migration `supabase/migrations/20260520000005_exam_papers_and_pyq_import.sql` (shipped in this PR by the architect) adds a new `exam_papers` table.

### Table: `public.exam_papers`

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Primary key |
| `paper_code` | `text` | NOT NULL, UNIQUE | Stable identifier (e.g. `jee_main_jan_2024_shift_1`, `neet_2024`, `nsep_2023`) |
| `exam_family` | `text` | NOT NULL, CHECK | One of `jee_main`, `jee_advanced`, `neet`, `nsep`, `nsec`, `nseb`, `nsejs`, `inpho`, `incho`, `inbo`, `kvpy`, `ntse`, `cbse_board`, `state_board` |
| `exam_session` | `text` | NOT NULL | Free-form session label, e.g. `january_2024_shift_1` |
| `paper_year` | `int` | NOT NULL, CHECK between 2000 and current year + 1 | Year the paper was administered |
| `paper_pattern` | `text` | nullable, CHECK matches `chk_paper_pattern` from PR-1 | Paper-level default pattern; per-question override allowed |
| `language` | `text` | NOT NULL, default `'en'`, CHECK in (`'en'`, `'hi'`) | Language of question text |
| `total_questions` | `int` | NOT NULL, CHECK > 0 and <= 200 | Expected question count (curator-stated; not enforced against actual inserts) |
| `total_marks` | `numeric(6,2)` | nullable | Marks for the full paper (e.g. 300.00 for JEE Main) |
| `duration_minutes` | `int` | nullable, CHECK between 30 and 360 | Paper duration in minutes |
| `marks_correct_default` | `numeric(4,2)` | nullable | Inherited by questions when not specified per-question |
| `marks_wrong_default` | `numeric(4,2)` | nullable | Inherited by questions when not specified per-question |
| `subjects` | `text[]` | NOT NULL | Subjects covered, e.g. `{'physics','chemistry','math'}` |
| `source_url` | `text` | nullable | Public source attribution (NTA, IIT, HBCSE) |
| `created_by` | `uuid` | NOT NULL, FK to `admin_users.auth_user_id` | Curator who imported the paper |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Import time |
| `notes` | `text` | nullable | Curator-supplied notes (e.g. "official paper from NTA website") |

### FK from `question_bank` to `exam_papers`

PR-1 added the `exam_paper_id uuid` column to `question_bank` without an FK constraint (see `supabase/migrations/20260520000004_jee_neet_schema_unblock.sql:194`). PR-2's migration adds the FK now that the target table exists:

```sql
ALTER TABLE public.question_bank
  ADD CONSTRAINT fk_question_bank_exam_paper
  FOREIGN KEY (exam_paper_id)
  REFERENCES public.exam_papers(id)
  ON DELETE SET NULL;
```

`ON DELETE SET NULL` (not CASCADE) preserves the questions if a paper is deleted by mistake — questions stay queryable, just lose their paper attribution. Deletion of a paper still requires user approval per `.claude/CLAUDE.md`.

### RLS

```sql
ALTER TABLE public.exam_papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY exam_papers_admin_read
  ON public.exam_papers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
       WHERE admin_users.auth_user_id = auth.uid()
         AND admin_users.is_active = true
         AND admin_users.admin_level IN ('admin', 'super_admin')
    )
  );

CREATE POLICY exam_papers_admin_write
  ON public.exam_papers
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
       WHERE admin_users.auth_user_id = auth.uid()
         AND admin_users.is_active = true
         AND admin_users.admin_level IN ('admin', 'super_admin')
    )
  );
```

Students and non-admin users have no read access to `exam_papers` directly — they only see questions via the existing `question_bank` RLS path. This matches the pattern used by `cms_assets` and other admin-managed metadata tables.

---

## 4. Edge Function contract

### Location

`supabase/functions/bulk-jee-neet-curated-import/index.ts` (shipped in this PR by the backend agent)

### URL and method

```
POST /functions/v1/bulk-jee-neet-curated-import
Authorization: Bearer <user-jwt>
Content-Type: application/json
```

### Auth

Same pattern as `bulk-question-gen` (`supabase/functions/bulk-question-gen/index.ts:141-185`): caller must supply a user JWT whose `auth_user_id` is present in `admin_users` with `admin_level IN ('admin', 'super_admin')` and `is_active = true`. Service-role keys must NEVER be sent as Bearer tokens over the wire.

### Request shape

```json
{
  "paper": {
    "paper_code": "neet_2024",
    "exam_family": "neet",
    "exam_session": "may_2024",
    "paper_year": 2024,
    "paper_pattern": "mcq_single",
    "language": "en",
    "total_questions": 180,
    "total_marks": 720.00,
    "duration_minutes": 200,
    "marks_correct_default": 4.00,
    "marks_wrong_default": -1.00,
    "subjects": ["physics", "chemistry", "biology"],
    "source_url": "https://nta.ac.in/...",
    "notes": "Official NTA paper, English medium"
  },
  "questions": [
    {
      "question_number": "Q1",
      "subject": "physics",
      "grade": "12",
      "chapter_number": 3,
      "question_text": "A particle moves in a circle of radius 2 m...",
      "options": ["1 m/s", "2 m/s", "4 m/s", "8 m/s"],
      "correct_answer_index": 2,
      "explanation": "Using v = ωr where ω = 2 rad/s...",
      "hint": "Apply the relationship between linear and angular velocity.",
      "difficulty": 3,
      "bloom_level": "apply",
      "paper_pattern": "mcq_single",
      "marks_correct": 4.00,
      "marks_wrong": -1.00,
      "concept_code": "circular_motion_basic"
    }
    // ... up to 200 questions
  ]
}
```

### Response shape

```json
{
  "ok": true,
  "paper_id": "550e8400-e29b-41d4-a716-446655440000",
  "paper_code": "neet_2024",
  "total": 180,
  "inserted": 174,
  "rejected": 6,
  "rejections": [
    {
      "question_number": "Q42",
      "code": "missing_options",
      "message": "options array must have exactly 4 entries (received 3)"
    },
    {
      "question_number": "Q103",
      "code": "invalid_correct_index",
      "message": "correct_answer_index 4 out of range 0-3"
    }
    // ...
  ]
}
```

### Status codes

| Code | Condition |
|---|---|
| 200 | Paper created (regardless of whether some questions were rejected — `rejected` field tells the curator) |
| 400 | Malformed request body, or `questions.length > 200` (batch limit) |
| 401 | Missing or invalid Bearer token |
| 403 | Bearer token belongs to a user not in `admin_users` |
| 409 | `paper_code` already exists — response includes the existing `paper_id` |
| 422 | Paper-level validation failed (e.g. unknown `exam_family`) — no rows inserted |
| 500 | Unexpected server error — paper row not created |

### Batch size limit

`questions.length <= 200`. JEE Advanced is 108 questions (two papers of 54 each); NEET is 180. The 200 cap covers all real-world exam papers plus headroom for mock papers. Larger batches must be split.

### Auto-mapping of `source_type` from `exam_family`

The Edge Function maps the paper's `exam_family` to the question's `source_type`:

| `exam_family` | Auto-assigned `source_type` |
|---|---|
| `jee_main`, `jee_advanced` | `jee_archive` |
| `neet` | `neet_archive` |
| `nsep`, `nsec`, `nseb`, `nsejs`, `inpho`, `incho`, `inbo` | `olympiad` |
| `cbse_board`, `state_board` | `board_paper` |
| `kvpy`, `ntse` | `pyq` |

Curators do not (and must not) specify `source_type` directly. The mapping is the source of truth.

### Idempotency

A second POST with the same `paper_code` returns HTTP 409 with the existing paper's `id`:

```json
{
  "ok": false,
  "code": "paper_code_exists",
  "message": "Paper with paper_code='neet_2024' already exists",
  "existing_paper_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

The Edge Function does NOT dedup individual questions across re-imports. Re-importing the same `question_text` inside a NEW `paper_code` will create a duplicate row in `question_bank`. Question-level dedup is deferred to a follow-up (likely a `cms_quality_audit` cron that flags near-duplicates by trigram similarity).

---

## 5. P6 enforcement — 13 rejection codes

Each question is validated independently. Rejected questions are DROPPED — they are NOT stored. The paper row is still created so partial batches succeed (a 180-question NEET import with 6 bad questions still produces 174 valid rows + 1 paper row).

| # | Code | Condition |
|---|---|---|
| 1 | `missing_text` | `question_text` is empty, whitespace-only, or omitted |
| 2 | `text_too_short` | `question_text.length < 10` characters |
| 3 | `text_has_template_markers` | `question_text` contains `{{` or `[BLANK]` (P6 invariant) |
| 4 | `missing_options` | `options` array length ≠ 4 |
| 5 | `empty_option` | Any entry in `options` is empty or whitespace-only |
| 6 | `duplicate_options` | Two or more `options` entries are equal after trim/normalisation (P6: 4 *distinct* options) |
| 7 | `invalid_correct_index` | `correct_answer_index` is not an integer in 0..3 |
| 8 | `missing_explanation` | `explanation` is empty, whitespace-only, or omitted |
| 9 | `invalid_difficulty` | `difficulty` is not an integer in 1..5 |
| 10 | `invalid_bloom_level` | `bloom_level` not in `['remember','understand','apply','analyze','evaluate','create']` (same set as `bulk-question-gen` per `supabase/functions/bulk-question-gen/index.ts:71`) |
| 11 | `invalid_grade` | `grade` not in `['6','7','8','9','10','11','12']` (P5 — strings only) |
| 12 | `invalid_subject_for_family` | Subject not allowed for this `exam_family` (NEET + math = reject; JEE Advanced + biology = reject) |
| 13 | `invalid_paper_pattern` | `paper_pattern` not in `chk_paper_pattern` allowlist |

Each rejection includes `question_number` (from the curator's input) and a human-readable `message` to make CSV-driven workflows debuggable.

### Subject-allowlist map per `exam_family`

```typescript
const SUBJECT_ALLOWLIST: Record<string, string[]> = {
  jee_main:     ['physics', 'chemistry', 'math'],
  jee_advanced: ['physics', 'chemistry', 'math'],
  neet:         ['physics', 'chemistry', 'biology'],
  nsep:         ['physics'],
  nsec:         ['chemistry'],
  nseb:         ['biology'],
  nsejs:        ['physics', 'chemistry', 'biology', 'math'],
  inpho:        ['physics'],
  incho:        ['chemistry'],
  inbo:         ['biology'],
  kvpy:         ['physics', 'chemistry', 'biology', 'math'],
  ntse:         ['math', 'science', 'social_studies', 'english', 'hindi'],
  cbse_board:   ['math', 'physics', 'chemistry', 'biology', 'english', 'hindi', 'social_studies', 'economics', 'accountancy', 'business_studies', 'history', 'geography', 'political_science'],
  state_board:  ['math', 'physics', 'chemistry', 'biology', 'english', 'hindi', 'social_studies'],
};
```

Assessment must sign off on this map during review — it encodes a pedagogical assertion about which subjects each exam tests.

---

## 6. What this PR does NOT do

Explicit non-goals (call these out so future engineers don't ask "why didn't PR-2 do X?"):

- **No AI generation.** Use the existing `bulk-question-gen` Edge Function for that. The two paths are intentionally separate: one is curator-driven and trusts the input; the other is AI-driven and applies the REG-54 oracle gate.
- **No question-level dedup.** Re-importing the same `question_text` inside a new `paper_code` creates a duplicate row. Dedup is a follow-up — likely a nightly trigram-similarity audit that flags near-duplicates for the curator to merge.
- **No NCERT-grounding verification.** PR-2 sets `verification_state = 'pending'` on every inserted row. The existing verifier cron (see `supabase/functions/coverage-audit/index.ts`) picks up pending rows asynchronously and grounds them against the NCERT corpus.
- **No automatic Hindi translation.** P7 invariant requires bilingual UI, but the imported `question_text` is whatever the curator supplies. Hindi PYQs need a separate import call with `language = 'hi'`. NTA's official Hindi NEET papers are available — they're a Wave 2 import target.
- **No plan-tier gating at import time.** Once `ff_goal_aware_selection` is on, all imported questions become visible to all students. Tier gating (Free vs Pro vs Competition) is PR-7's job, enforced at the API layer in `src/lib/rbac.ts`.
- **No diagram/image support.** Questions with embedded diagrams (NEET Biology, NSEP Physics) come in as text-only for Wave 1. Image-asset infrastructure (`cms_assets`) integration is deferred.
- **No Mock Test runner.** PR-2 only fills the data layer. The student-visible `/exams/mock` route is PR-5.
- **No super-admin Bulk Import UI.** The Edge Function is callable via `curl` only for Wave 1. A super-admin dashboard page for upload + rejection-log review is PR-7.

---

## 7. Test plan

Tests live in `supabase/functions/bulk-jee-neet-curated-import/__tests__/validate.test.ts` (Deno test framework). The backend agent ships these alongside the function.

1. **Happy path.** Import a NEET 2024 paper with 5 valid questions covering Physics, Chemistry, Biology. Assert paper row created, all 5 question rows created, `source_type = 'neet_archive'` on each, `exam_paper_id` FK populated, `verification_state = 'pending'`.
2. **Each of the 13 rejection codes fires on its own malformed input.** Build a fixture per code; assert the response `rejections[].code` equals the expected value and the bad row is NOT in `question_bank`.
3. **Duplicate `paper_code` returns 409.** Import the same paper twice; second call returns 409 with `existing_paper_id` matching the first call's `paper_id`.
4. **Non-admin user returns 403.** Use a non-admin student JWT; assert 403 with `code: 'admin_required'`.
5. **Missing Bearer token returns 401.** No `Authorization` header; assert 401 with `code: 'missing_auth'`.
6. **Batch of 201 questions returns 400.** Submit `questions.length = 201`; assert 400 with `code: 'batch_too_large'` and no paper row created.
7. **Subject mismatch fires `invalid_subject_for_family`.** Submit a NEET paper with one math question; assert that question is rejected with code 12 and the other questions succeed.
8. **Paper-level `paper_pattern` is inherited.** Submit a paper with `paper.paper_pattern = 'mcq_single'` and a question that omits `paper_pattern`. Assert the inserted row has `paper_pattern = 'mcq_single'`.
9. **`source_type` is auto-assigned correctly per `exam_family`.** Submit one JEE Main paper and one NSEP paper in separate calls; assert resulting rows have `source_type = 'jee_archive'` and `source_type = 'olympiad'` respectively.
10. **`verification_state = 'pending'` on all inserts.** Assert every inserted row has `verification_state = 'pending'` so the downstream verifier cron picks them up.
11. **Service-role key as Bearer is rejected.** Submit a request with the service-role JWT as the Bearer; assert 401 or 403 (must not be 200). This guards against the credential-leak path called out in `bulk-question-gen/index.ts:153-154`.
12. **Idempotent re-run of full batch.** Submit the same paper twice consecutively; assert second call returns 409 and no question rows are duplicated even though the question list is identical.

---

## 8. Rollout plan

1. **Migration applies via the staging pipeline.** Per `.claude` memory, migrations go through the staging pipeline (`supabase/migrations/` root → CI → staging → prod), never via direct MCP. Architect's migration `20260520000005_exam_papers_and_pyq_import.sql` lands at the migrations root.
2. **Edge Function deploys via `supabase functions deploy bulk-jee-neet-curated-import`.** Backend agent runs this as part of the merge workflow.
3. **Manual smoke test on staging:** import a 5-question NEET 2024 sample paper via:
   ```bash
   curl -X POST "https://<staging>.supabase.co/functions/v1/bulk-jee-neet-curated-import" \
     -H "Authorization: Bearer <admin-jwt>" \
     -H "Content-Type: application/json" \
     -d @neet_2024_sample.json
   ```
   Verify paper row appears in `exam_papers`; questions appear in `question_bank` with correct `source_type` and `exam_paper_id`; `verification_state = 'pending'` on all rows.
4. **Validate via SQL** (super-admin SQL editor on staging):
   ```sql
   SELECT source_type, paper_pattern, count(*)
     FROM public.question_bank
    WHERE exam_paper_id IS NOT NULL
    GROUP BY source_type, paper_pattern
    ORDER BY count DESC;
   ```
   Expected for the smoke test: one row of `(neet_archive, mcq_single, 5)`.
5. **PR-3 (content seed) follows.** Curator imports 200 PYQs across 4-6 papers using the function.
6. **Flag flip.** Once `question_bank` has ≥500 PYQ rows on staging, flip `ff_goal_aware_selection` to `is_enabled = true, rollout_percentage = 10, target_environments = ['staging']` via the super-admin Flags console. Operator runbook in `supabase/migrations/20260503140000_add_phase2_goal_aware_selection.sql:30-67`.

---

## 9. Rollback

If PR-2 has a bug in production:

### Layer 1 — Function rollback (preferred, instant)

Supabase Edge Functions support version pinning. Roll back to the previous deployed revision:

```bash
supabase functions deploy bulk-jee-neet-curated-import --version <prior-revision>
```

This stops new bad imports immediately. Existing question rows stay in place.

### Layer 2 — Data cleanup (if bad rows were imported)

```sql
-- Delete only rows tied to a specific bad paper:
DELETE FROM public.question_bank WHERE exam_paper_id = '<bad-paper-id>';
DELETE FROM public.exam_papers WHERE id = '<bad-paper-id>';
```

This is reversible (the original payload should still be in the curator's hands).

### Layer 3 — Migration rollback (last resort, requires user approval)

Per `.claude/CLAUDE.md` Section 8, DROP operations require user approval. If we must roll back the schema:

```sql
ALTER TABLE public.question_bank
  DROP CONSTRAINT IF EXISTS fk_question_bank_exam_paper;

DROP TABLE public.exam_papers CASCADE;
```

The 6 PR-1 columns survive — they're additive. The `chk_source_type` widening from PR-1 also survives. Only the new `exam_papers` table and the FK are removed.

### What's NOT rolled back

- Existing `question_bank` rows with `source_type = 'jee_archive'` (etc.) remain. PR-1's CHECK widening accepts them.
- `verification_state = 'pending'` rows continue to be picked up by the existing verifier cron — that's intentional behaviour, not a bug.
- The Phase 2 `get_adaptive_questions_v2` RPC is untouched; it filters on `is_active = true` and surfaces whatever is in `question_bank`.

---

## 10. Review chain (P14)

| Reviewer | Concern | Acceptance criterion |
|---|---|---|
| **architect** (made by, not reviewer) | Schema | Migration is additive, idempotent, RLS-enabled, FK uses `ON DELETE SET NULL`. Self-review only — no separate sign-off needed. |
| **backend** (made by, not reviewer) | Edge Function | Auth pattern matches `bulk-question-gen`, batch size enforced, idempotency on `paper_code`. Self-review only. |
| **ops** (made by, this doc) | Documentation | This file exists, accurately describes the contract, cites real files and line numbers. Self-review only. |
| **assessment** | P6 question quality + subject allowlist | Each of the 13 rejection codes correctly enforces a P6 sub-rule. The `SUBJECT_ALLOWLIST` map matches NCERT / JEE / NEET / Olympiad reality. Bloom's levels and difficulty 1-5 scale match assessment's existing conventions. |
| **testing** | Edge Function tests + regression catalog | All 12 test cases pass on Deno test runner. Catalog gap reported if any P6 rejection path lacks an assertion. |
| **quality** | Build + lint + review chain completeness | `npm run lint` passes, `npm run type-check` passes, Edge Function tests green, all reviewers above have signed off. |

**Acceptance gate:** PR cannot merge until assessment, testing, and quality have each posted approval on the PR.

---

## 11. Open follow-ups (not blockers for this PR)

- Question-level dedup via trigram similarity (deferred — needs `pg_trgm` extension audit first)
- Hindi PYQ ingestion (deferred to Wave 2)
- Diagram/image asset linking from imported questions (deferred — needs `cms_assets` schema audit)
- Super-admin Bulk Import UI page (PR-7)
- Curator audit log — record who imported which paper and when (the `exam_papers.created_by` column captures this; just needs a super-admin view)
- Extend `bulk-question-gen` with an optional `target_source_type` parameter so it can emit `jee_archive`-tagged AI-generated questions for content-coverage gap filling (Wave 2)
