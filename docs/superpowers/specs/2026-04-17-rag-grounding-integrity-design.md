# RAG Grounding Integrity — Design Spec

**Date:** 2026-04-17
**Status:** Approved (decisions locked by user during brainstorm 2026-04-17)
**Owner (design):** orchestrator + ai-engineer + architect + assessment + backend + frontend + ops
**Strategy chosen:** C (Grounded-Answer Service as a separate Supabase Edge Function, 3–4 week build)
**Invariants at risk:** P1 (score accuracy — quiz route changes), P6 (question quality — bank verification), P7 (bilingual UI), P8 (RLS — new tables), P9 (RBAC — admin pages), P12 (AI safety — the core protection this project adds), P13 (privacy — trace redaction). None violated by this change; P12 is strengthened materially.

---

## 1. Problem

Foxy (AI tutor), quiz questions, and NCERT solutions are rendering answers that are wrong in three specific ways:

- **A — Hallucinated content.** AI surfaces produce facts, formulas, or dates that are not in NCERT at all.
- **B — Wrong-chapter retrieval.** Answers come from NCERT but from the wrong grade or chapter.
- **D — Wrong `correct_answer_index` in quizzes.** A generated quiz row has options {A, B, C, D}, marked C as correct, but NCERT supports B.

The fourth classical failure (**C — no-retrieval fallback**) is not the active symptom; retrieval usually returns *something*, but either the LLM ignores it, the filters let wrong-chapter chunks through, or generated content is trusted without verification.

Yesterday (2026-04-16/17) we added subject-governance RPCs as a hard gate across `/api/student/subjects`, `/api/student/chapters`, `/api/foxy`, `/api/quiz`, then immediately added soft-fail fallbacks (`e4fb371`) because migrations weren't yet deployed; then fixed a Bearer-token/cookie mismatch (`4e43f4c`) that was 401-ing subject/chapter fetches. That work protected *who can ask about what*. It does not verify *that the answer is actually from NCERT*.

## 2. Root cause (from audit)

1. **RAG failure is non-fatal in Foxy.** [src/app/api/foxy/route.ts:1085-1137](src/app/api/foxy/route.ts) — if Voyage times out, the RPC errors, or 0 chunks return, Foxy still calls Claude with an empty "Reference Material" block. Claude answers from parametric memory.
2. **Two parallel Voyage implementations.** [src/app/api/foxy/route.ts:507](src/app/api/foxy/route.ts) and [src/lib/ai/retrieval/ncert-retriever.ts:22](src/lib/ai/retrieval/ncert-retriever.ts) each implement embedding generation separately — drift risk.
3. **`RAG_MIN_QUALITY = 0.4`** ([src/app/api/foxy/route.ts:34](src/app/api/foxy/route.ts)) is too low — weak-similarity chunks pollute context.
4. **Governance soft-fail lets empty-corpus subjects reach students.** A student can pick a subject/chapter that has zero chunks in `rag_content_chunks`; governance doesn't verify against RAG coverage.
5. **Quiz serves from a pre-generated `question_bank` with no RAG verification at generation time.** Wrong `correct_answer_index` rows are permanent until manually fixed. [src/app/api/quiz/route.ts:496-554](src/app/api/quiz/route.ts) calls `select_quiz_questions_rag` with `p_query_embedding: null` — no semantic similarity in the serve path.
6. **Four disagreeing sources of truth** for "what subjects/chapters exist for grade X": `subjects`+`chapters` tables, `GRADE_SUBJECTS` constant, governance RPCs, and `rag_content_chunks` itself.
7. **Corpus coverage is unknown.** No audit has been run mapping `(grade, subject, chapter)` tuples to chunk counts. We cannot design a grounding gate without this baseline.
8. **No answer-to-chunk binding.** Even when retrieval succeeds, there is no mechanism that forces the LLM output to cite its sources and be verified against them.
9. **No trace of what chunks produced which answer.** When a student reports a wrong answer, admins cannot reconstruct the retrieval set, prompt, or Claude response. Debuggability is near-zero.
10. **`question_bank` has no `verified_against_ncert` concept.** Every row is trusted on creation.

## 3. Decisions (approved 2026-04-17)

| # | Decision | Choice |
|---|---|---|
| 1 | Primary symptoms to address | A (hallucinated), B (wrong-chapter), D (wrong answer index) — all three |
| 2 | Corpus coverage baseline | Unknown today → **build audit as Phase 0** |
| 3 | Single source of truth for syllabus | **Carry all 3 options into spec; user chose (B) `cbse_syllabus` master table** after seeing tradeoffs |
| 4 | Quiz pipeline understanding | Pre-generated `question_bank` served via RPC; no generator-time verification today |
| 5 | Abstain policy | **C + D** — hard abstain for Quiz, soft abstain for Foxy, `ingestion_gaps` view + admin notification |
| 6 | Overall strategy | **Strategy C** — Grounded-Answer Service as separate Supabase Edge Function (3–4 weeks) |
| 7 | Enforcement of "no direct AI calls outside service" | Lint rule + CI check (hard gate) |
| 8 | Service deployment model | Separate Supabase Edge Function (`grounded-answer`), same bom1 region |
| 9 | Ready thresholds | `MIN_CHUNKS_FOR_READY = 50`, `MIN_QUESTIONS_FOR_READY = 40` |
| 10 | Retroactive verification strategy | Hybrid — `verification_state` column, feature-flagged rollout per (grade, subject), no student outage |
| 11 | `subjects` / `chapters` table deletion | Follow-up cleanup after `cbse_syllabus` is proven (TODO-1) |
| 12 | Trace privacy | `query_hash` + 200-char preview only; full text never stored |
| 13 | Grounding check (second LLM pass) | **Included in strict mode** — accept 500ms latency + ~$1/day cost |
| 14 | Registered prompt templates | **Required** — no free-text system prompts from callers |
| 15 | Soft-mode "General knowledge" prefix | **Keep** — students benefit from clarifying answers with explicit provenance label |
| 16 | Circuit breaker | 3-state (closed → open → half-open); trip at 3 failures / 10s window; 30s open; half-open closes on 2 consecutive probe successes |
| 17 | Quiz generator two-pass verifier | **Include** — 2× Claude calls per generated question, ~$5/1000 questions |
| 18 | Retroactive audit rate | 1000 rows/30min baseline, bounded by 4000 RPM Haiku tier 4, adaptive throttle + peak-hour deferral |
| 19 | Concept-engine + NCERT-solver investigation | **TODO-2** — confirm during spec validation |
| 20 | Soft-abstain banner copy | "This answer isn't from your NCERT textbook — please verify with your book…" |
| 21 | Banner repetition | **Per-message banners** — each answer independently graded |
| 22 | Alternatives grid | **Semantic top-3 + "see all ready chapters" escape hatch** |
| 23 | Content request feature | **In scope** — new table, new button, new admin queue |
| 24 | Progress signals | **Only real and accurate** — spinner + elapsed time; "taking longer than usual" after 15s |
| 25 | `ai_issue_reports` table + `/report-issue` UI | **In scope** — load-bearing for P13 privacy story |
| 26 | Quiz availability SLO | **99.99%** for enforced pairs (stretch commitment) |
| 27 | Kill switches | **Three** — per-caller, global, per-(grade, subject) enforcement |
| 28 | Cost anomaly threshold | **+25% over 7-day rolling average** (warning, not page) |
| 29 | Verification flag auto-disable | **Auto** — `verified_ratio < 0.85` flips enforcement OFF for that pair |
| 30 | Streaming responses | Not in v1 (TODO-3) |

## 4. Architecture

Four layers. Each has one job, owns one set of tables, communicates with adjacent layers only through named contracts.

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 4 — SURFACE ROUTES (thin; never call AI directly)         │
│   /api/foxy  •  /api/ncert-solver  •  /api/concept-engine       │
│   quiz-generator Edge Fn  •  diagnostic  •  worksheet-gen       │
│   Responsibility: auth, quota, format response for client       │
└─────────────────────────────────────────────────────────────────┘
                              │  POST to grounded-answer
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3 — GROUNDED-ANSWER SERVICE                               │
│   supabase/functions/grounded-answer/                           │
│   Owns: embedding, retrieval, reranking, confidence scoring,    │
│   abstain decision, citation binding, trace logging, circuit    │
│   breaker, per-plan timeouts, cache.                            │
└─────────────────────────────────────────────────────────────────┘
                              │  reads canonical truth from:
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2 — CANONICAL CATALOG (cbse_syllabus = SSoT)              │
│   One row per (board, grade, subject_code, chapter_number).     │
│   rag_status ∈ {missing, partial, ready}.                       │
│   Governance RPCs are thin reads over this table.               │
│   UI shows only rag_status='ready' chapters to students.        │
└─────────────────────────────────────────────────────────────────┘
                              │  populated + reconciled by:
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — INGESTION & VERIFICATION (offline pipelines)          │
│   • NCERT → chunk → Voyage embed → rag_content_chunks           │
│   • quiz-generator → Claude → verifier pass → question_bank     │
│     (only verified_against_ncert=true rows reach students)      │
│   • Nightly coverage audit recomputes cbse_syllabus.rag_status  │
│   • Retroactive verifier drains legacy_unverified backlog       │
└─────────────────────────────────────────────────────────────────┘
```

### Four unbreakable invariants this architecture creates

1. **No route outside the grounded-answer Edge Function may call Voyage or Claude directly.** Enforced by ESLint `no-direct-ai-calls` rule + CI check.
2. **No student ever sees a `(subject, chapter)` combination that isn't `cbse_syllabus.rag_status = 'ready'`.** The UI cannot render it because the API won't return it.
3. **No quiz question reaches a student without `verified_against_ncert = true`** (once `ff_grounded_ai_enforced` is ON for that pair). Enforced by the serve-path RPC filter.
4. **Every AI answer has a `trace_id`.** Any student complaint is reconstructible via `ai_issue_reports` × `foxy_chat_messages` × `grounded_ai_traces`.

### Why a separate Edge Function, not a library

Both Vercel routes (Foxy, NCERT-solver) and Supabase Edge Functions (quiz-generator) must call the service. A library targeting both runtimes duplicates code; a separate service keeps policy in one place. Latency cost: one extra hop within bom1/Mumbai region, empirically 30–80ms. Negligible vs. the 15–30s Claude budget. Timeouts structured so the *hop* has a short budget (2s) and the service internally owns the long upstream timeouts.

## 5. Data model

Five table changes, two new tables, one new view.

### 5.1 New table — `cbse_syllabus` (Layer 2 SSoT)

```sql
CREATE TABLE cbse_syllabus (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board                   text NOT NULL DEFAULT 'CBSE',
  grade                   text NOT NULL CHECK (grade IN ('6','7','8','9','10','11','12')),
  subject_code            text NOT NULL,
  subject_display         text NOT NULL,
  subject_display_hi      text,
  chapter_number          int  NOT NULL CHECK (chapter_number > 0),
  chapter_title           text NOT NULL,
  chapter_title_hi        text,
  -- derived, maintained by triggers + nightly reconcile:
  chunk_count             int  NOT NULL DEFAULT 0,
  verified_question_count int  NOT NULL DEFAULT 0,
  rag_status              text NOT NULL DEFAULT 'missing'
    CHECK (rag_status IN ('missing','partial','ready')),
  last_verified_at        timestamptz,
  -- admin overrides:
  is_in_scope             boolean NOT NULL DEFAULT true,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board, grade, subject_code, chapter_number)
);

CREATE INDEX idx_cbse_syllabus_lookup
  ON cbse_syllabus (board, grade, subject_code, rag_status)
  WHERE is_in_scope;

CREATE INDEX idx_cbse_syllabus_ready
  ON cbse_syllabus (grade, subject_code)
  WHERE rag_status = 'ready' AND is_in_scope;

ALTER TABLE cbse_syllabus ENABLE ROW LEVEL SECURITY;
-- Read: all authenticated users (students need the picker)
-- Write: service role + content_admin role only
```

`rag_status` derivation (cached, recomputed on write + nightly):

- `missing` → `chunk_count = 0`
- `partial` → `chunk_count > 0` AND (`chunk_count < 50` OR `verified_question_count < 40`)
- `ready` → `chunk_count >= 50` AND `verified_question_count >= 40`

Constants live in `src/lib/grounding-config.ts` and are duplicated at `supabase/functions/grounded-answer/config.ts` (Deno cannot import from Next.js tree; see §6.6 for the sync rule).

### 5.2 Changes to `rag_content_chunks`

```sql
ALTER TABLE rag_content_chunks
  ADD CONSTRAINT rag_chunks_source_ncert_only
  CHECK (source = 'ncert_2025');

ALTER TABLE rag_content_chunks
  ADD CONSTRAINT rag_chunks_valid_grade
  CHECK (grade_short IN ('6','7','8','9','10','11','12'));

CREATE INDEX IF NOT EXISTS idx_rag_chunks_catalog_join
  ON rag_content_chunks (grade_short, subject_code, chapter_number);
```

Trigger on INSERT/UPDATE/DELETE calls `recompute_syllabus_status(grade, subject_code, chapter_number)`.

### 5.3 Changes to `question_bank`

```sql
ALTER TABLE question_bank
  ADD COLUMN IF NOT EXISTS verified_against_ncert boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_state text NOT NULL DEFAULT 'legacy_unverified'
    CHECK (verification_state IN ('legacy_unverified','pending','verified','failed')),
  ADD COLUMN IF NOT EXISTS verification_claimed_by text,
  ADD COLUMN IF NOT EXISTS verification_claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS verifier_chunk_ids uuid[],
  ADD COLUMN IF NOT EXISTS verifier_model text,
  ADD COLUMN IF NOT EXISTS verifier_trace_id uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verifier_failure_reason text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX idx_question_bank_verified
  ON question_bank (grade, subject, chapter_number)
  WHERE verified_against_ncert = true AND deleted_at IS NULL;

CREATE INDEX idx_question_bank_verification_queue
  ON question_bank (created_at)
  WHERE verification_state IN ('legacy_unverified','pending');
```

`select_quiz_questions_rag` RPC updated: when the (grade, subject) pair has `ff_grounded_ai_enforced = true`, filter `verified_against_ncert = true`; otherwise serve both `legacy_unverified` and `verified`. Never serves `failed` rows.

Trigger on UPDATE of `verified_against_ncert` recomputes `cbse_syllabus.verified_question_count`.

### 5.4 New table — `grounded_ai_traces`

```sql
CREATE TABLE grounded_ai_traces (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  caller                text NOT NULL
    CHECK (caller IN ('foxy','ncert-solver','quiz-generator','concept-engine','diagnostic')),
  student_id            uuid REFERENCES students(id) ON DELETE SET NULL,
  grade                 text,
  subject_code          text,
  chapter_number        int,
  query_hash            text NOT NULL,       -- sha256 of normalized query
  query_preview         text,                 -- first 200 chars, logger-redacted
  embedding_model       text,
  retrieved_chunk_ids   uuid[] NOT NULL,
  top_similarity        numeric(5,4),
  chunk_count           int NOT NULL,
  claude_model          text,
  prompt_template_id    text,
  prompt_hash           text,                 -- sha256 of resolved system prompt
  grounded              boolean NOT NULL,
  abstain_reason        text,
  confidence            numeric(5,4),
  answer_length         int,
  input_tokens          int,
  output_tokens         int,
  latency_ms            int,
  client_reported_issue_id uuid
);

CREATE INDEX idx_traces_recent ON grounded_ai_traces (created_at DESC);
CREATE INDEX idx_traces_abstain ON grounded_ai_traces (created_at DESC)
  WHERE grounded = false;
CREATE INDEX idx_traces_student ON grounded_ai_traces (student_id, created_at DESC);
CREATE INDEX idx_traces_caller ON grounded_ai_traces (caller, created_at DESC);

ALTER TABLE grounded_ai_traces ENABLE ROW LEVEL SECURITY;
-- Read: service role + ops_admin + support_admin roles only
-- Retention: rows >90 days auto-deleted (grounded=true); >180 days (grounded=false)
```

P13 guarantee: full query/answer text never lives in this table. Reconstruction requires an `ai_issue_reports` row linking `foxy_chat_messages` (where full text does live under existing student RLS) to the trace.

### 5.5 New view — `ingestion_gaps`

```sql
CREATE VIEW ingestion_gaps AS
SELECT
  s.board, s.grade, s.subject_code, s.subject_display,
  s.chapter_number, s.chapter_title,
  s.rag_status, s.chunk_count, s.verified_question_count,
  s.last_verified_at,
  CASE
    WHEN s.rag_status = 'missing' THEN 'critical'
    WHEN s.rag_status = 'partial' AND s.chunk_count < 10 THEN 'high'
    WHEN s.rag_status = 'partial' THEN 'medium'
  END AS severity,
  (SELECT count(*) FROM students
    WHERE grade = s.grade AND account_status = 'active') AS potential_affected_students,
  (SELECT count(*) FROM content_requests cr
    WHERE cr.grade = s.grade
      AND cr.subject_code = s.subject_code
      AND cr.chapter_number = s.chapter_number) AS request_count
FROM cbse_syllabus s
WHERE s.is_in_scope = true AND s.rag_status != 'ready';
```

### 5.6 New table — `content_requests`

```sql
CREATE TABLE content_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     uuid REFERENCES students(id) ON DELETE CASCADE,
  grade          text NOT NULL,
  subject_code   text NOT NULL,
  chapter_number int  NOT NULL,
  chapter_title  text,
  request_source text CHECK (request_source IN ('foxy','quiz','learn','ncert-solver')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- one request per (student, chapter) per day
  UNIQUE (student_id, grade, subject_code, chapter_number, (date_trunc('day', created_at)))
);

CREATE INDEX idx_content_requests_prioritize
  ON content_requests (grade, subject_code, chapter_number);

ALTER TABLE content_requests ENABLE ROW LEVEL SECURITY;
-- Read: owner (own rows) + ops_admin; Write: owner only
```

### 5.7 New table — `ai_issue_reports`

```sql
CREATE TABLE ai_issue_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  foxy_message_id    uuid REFERENCES foxy_chat_messages(id) ON DELETE SET NULL,
  question_bank_id   uuid REFERENCES question_bank(id) ON DELETE SET NULL,
  trace_id           uuid REFERENCES grounded_ai_traces(id) ON DELETE SET NULL,
  reason_category    text NOT NULL
    CHECK (reason_category IN ('wrong_answer','off_topic','inappropriate','unclear','other')),
  student_comment    text,
  admin_notes        text,
  admin_resolution   text
    CHECK (admin_resolution IN ('bad_chunk','bad_prompt','bad_question','infra','no_issue','pending')),
  resolved_by        uuid REFERENCES users(id),
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_issue_reports_pending
  ON ai_issue_reports (created_at DESC)
  WHERE admin_resolution IS NULL OR admin_resolution = 'pending';

ALTER TABLE ai_issue_reports ENABLE ROW LEVEL SECURITY;
-- Read: owner (own) + ops_admin + support_admin;
-- Write: owner (create) + ops_admin (update resolution)
```

### 5.8 New table — `rag_ingestion_failures`

```sql
CREATE TABLE rag_ingestion_failures (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file        text,
  grade              text,
  subject_code       text,
  chapter_number     int,
  reason             text NOT NULL,
  raw_data_preview   text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
```

Quality gate for ingestion: chunks that fail validation land here, not in `rag_content_chunks`.

### 5.9 Deprecations

After migration verified and feature-flag rollout complete, the following become candidates for deletion (NOT auto-deleted; tracked as TODO-1):

- `GRADE_SUBJECTS` constant in `src/app/api/student/subjects/route.ts` and all fallback paths
- Soft-fail try/catch blocks in `/api/foxy`, `/api/quiz`, `/api/student/subjects`, `/api/student/chapters`
- Possibly `subjects` and `chapters` tables (requires audit of all references)

## 6. Grounded-Answer Service contract

### 6.1 Endpoint

`POST /functions/v1/grounded-answer`

Request:

```ts
{
  caller: 'foxy' | 'ncert-solver' | 'quiz-generator' | 'concept-engine' | 'diagnostic';
  student_id: string | null;            // null for system-initiated (verifier)
  query: string;
  scope: {
    board: 'CBSE';
    grade: string;                      // '6'-'12'
    subject_code: string;
    chapter_number: number | null;
    chapter_title: string | null;
  };
  mode: 'strict' | 'soft';
  generation: {
    model_preference: 'haiku' | 'sonnet' | 'auto';
    max_tokens: number;
    temperature: number;
    system_prompt_template: string;     // ID of registered template
    template_variables: Record<string, string>;
  };
  retrieval: {
    match_count: number;                 // default 5
    min_similarity_override?: number;
  };
  timeout_ms: number;
}
```

Response (always HTTP 200):

```ts
// Grounded success
{
  grounded: true;
  answer: string;                        // citations inlined as [1], [2]
  citations: Array<{
    index: number;
    chunk_id: string;
    chapter_number: number;
    chapter_title: string;
    page_number: number | null;
    similarity: number;
    excerpt: string;                     // 200 chars
    media_url: string | null;
  }>;
  confidence: number;                    // 0.0-1.0
  trace_id: string;
  meta: { claude_model: string; tokens_used: number; latency_ms: number };
}
// Controlled abstain
{
  grounded: false;
  abstain_reason:
    | 'chapter_not_ready'
    | 'no_chunks_retrieved'
    | 'low_similarity'
    | 'no_supporting_chunks'
    | 'scope_mismatch'
    | 'upstream_error'
    | 'circuit_open';
  suggested_alternatives: Array<{
    grade: string; subject_code: string;
    chapter_number: number; chapter_title: string;
    rag_status: 'ready';
  }>;
  trace_id: string;
  meta: { latency_ms: number };
}
// Service-level internal error
{ error: 'internal'; trace_id: string | null; }   // HTTP 500 reserved
```

### 6.2 Prompt template registry

Templates live at `supabase/functions/grounded-answer/prompts/*.txt`, each a versioned file. Callers pass a template ID (`foxy_tutor_v1`, `quiz_question_generator_v1`, `quiz_answer_verifier_v1`, `ncert_solver_v1`); the service resolves it with `template_variables` substitution. **Free-text system prompts from callers are not permitted.** Template hash is logged to each trace.

### 6.3 Mode semantics

| Aspect | `strict` (Quiz, NCERT solver, diagnostic) | `soft` (Foxy only) |
|---|---|---|
| Min top similarity | 0.75 | 0.55 |
| Min chunks required | 3 | 1 |
| Abstain on grounding fail | Return `grounded: false` | Return `grounded: true`, `confidence < 0.6` |
| System prompt citation rule | "MUST cite every claim; otherwise respond `{{INSUFFICIENT_CONTEXT}}`" | "Prefer citations; on general-knowledge fallback prefix 'General knowledge (not from NCERT):'" |
| Post-response grounding check | Yes (second LLM pass) | No |

### 6.4 Retrieval pipeline

1. **Coverage precheck** — query `cbse_syllabus` for scope. If `rag_status != 'ready'` → immediate `chapter_not_ready` abstain. No Voyage/Claude call.
2. **Embedding generation** — Voyage `voyage-3` 1024-dim. Per-call timeout = `min(timeout_ms * 0.4, 8000)`. One retry on timeout with 2× timeout. Second failure → `upstream_error`.
3. **Retrieval** — `match_rag_chunks_ncert` RPC with embedding + scope filters. Strict requires `p_min_quality ≥ 0.75`; soft `≥ 0.55`.
4. **Scope verification (defense in depth)** — for each returned chunk verify `chunk.grade_short == scope.grade AND chunk.subject_code == scope.subject_code AND (scope.chapter_number IS NULL OR chunk.chapter_number == scope.chapter_number)`. Failures dropped, logged as `scope_mismatch`.
5. **Minimum-chunk gate** — strict with <3 surviving chunks → `no_chunks_retrieved`. Soft with 0 → proceed without context, downgrade confidence.
6. **Generation** — Claude call with registered prompt + retrieved chunks. Model preference: Haiku first, Sonnet fallback on 529/timeout/404. Per-call timeout = `min(timeout_ms * 0.6, 45000)`.
7. **Grounding check (strict only)** — second Haiku call with fact-checker prompt. Verdict `pass`/`fail`. Fail → `no_supporting_chunks`.
8. **Citation extraction** — parse `[N]` refs, resolve each to chunk metadata.
9. **Trace write** — always insert `grounded_ai_traces` row (success, abstain, or error).

### 6.5 Confidence scoring

```
confidence = 0.4 * min(top_similarity, 1.0)
           + 0.3 * min(avg(top_3_similarities), 1.0)
           + 0.2 * min(chunks_returned / match_count_target, 1.0)
           + 0.1 * grounding_check_pass_ratio
```

In soft mode, `grounding_check_pass_ratio` is always 1.0 (not enforced). In strict mode it's 0 or 1.

Thresholds in `grounding-config.ts`:

- Soft mode: `confidence < 0.6` → UI renders "Unverified" banner.
- Strict mode: `confidence < 0.75` → abstain (return `grounded: false`).

### 6.6 Config sync between Next.js and Deno

`grounding-config.ts` exists in two places — `src/lib/grounding-config.ts` (Next.js) and `supabase/functions/grounded-answer/config.ts` (Deno). These must stay in sync. A CI check (`scripts/check-config-parity.sh`) compares exported constants; mismatch fails the build.

### 6.7 Circuit breaker (3-state)

- **Closed (normal)** — count failures (timeout or upstream_error) in rolling 10s window.
- **Trip** — 3 failures in any 10s window → **Open**.
- **Open (30s)** — return `circuit_open` immediately, no upstream calls.
- **Half-open (after 30s)** — allow one probe. Success counts 1/2. Two consecutive probe successes → **Closed**. Any probe fail → back to **Open** for another 30s.

Circuit state per (caller × subject × grade). Stored in service instance memory; lost on cold start (acceptable — fresh breaker is the safer state).

### 6.8 Per-plan timeouts

| Plan | Total `timeout_ms` | Voyage (≈40%) | Claude (≈60%) |
|---|---|---|---|
| free | 20000 | 8000 | 12000 |
| starter | 35000 | 14000 | 21000 |
| pro | 55000 | 22000 | 33000 |
| unlimited | 75000 | 30000 | 45000 |

Callers look up the student's plan and pass the matching `timeout_ms`. Verifier (system-initiated) uses `timeout_ms = 15000` regardless.

### 6.9 Cache

In-memory LRU per Edge Function instance. Key: `sha256(query || scope || mode)`. TTL: 5 min. Only caches `grounded: true` responses. Abstains are not cached.

## 7. Integration points

### 7.1 Foxy (`src/app/api/foxy/route.ts`)

**Keeps** (~40% of file): auth, quota, session resolve, history load, cognitive context load, response persist, audit log, upgrade prompts, safety-net try/catch.

**Deletes** (~60% of file, lines ~505–699 and ~1052–1199): `generateEmbedding`, `callClaude` with model fallback, direct `match_rag_chunks_ncert` RPC, `buildSystemPrompt` (moves to template file), `CLAUDE_MODELS`, `VOYAGE_TIMEOUT` + `CLAUDE_TIMEOUT` tables, intent-router fallback code.

**Replaces** the deleted block with one `askGrounded()` call. Template: `foxy_tutor_v1`. Mode: `soft`. Cognitive context passed in as `template_variables.cognitive_context`. History passed in as `template_variables.history_messages` (JSON-encoded).

**Client response shape** adds `groundingStatus: 'grounded' | 'unverified'` and `traceId`. Frontend renders `<UnverifiedBanner />` when `groundingStatus === 'unverified'`.

**Quota refund**: on `upstream_error | circuit_open | chapter_not_ready`, decrement-back the quota counter. Not refunded for `no_supporting_chunks | low_similarity` (compute was consumed).

Target file size: ~600 lines (down from ~1360).

### 7.2 Quiz generator (`supabase/functions/quiz-generator/`, `quiz-generator-v2/`)

**Two-pass flow:**

1. **Generate draft** via `askGrounded({template: 'quiz_question_generator_v1', mode: 'strict'})` → returns `{question, options[4], correct_answer_index, explanation}` as JSON (schema-validated).
2. **Verify draft** via `askGrounded({template: 'quiz_answer_verifier_v1', mode: 'strict', query: formatForVerification(draft)})` → returns `{verified: boolean, correct_option_index: 0|1|2|3|null, supporting_chunk_ids: uuid[]}`.
3. **Insert to `question_bank`** with:
   - `verification_state = 'verified'` if `verified && correct_option_index === draft.correct_answer_index`
   - `verification_state = 'failed'` otherwise (stays for admin review)
   - `verified_against_ncert = (state === 'verified')`
   - `verifier_chunk_ids`, `verifier_trace_id`, `verifier_model`, `verified_at` populated

Verifier template:

```
You are verifying a CBSE quiz question. You MUST determine whether the
claimed correct answer is directly provable from the SOURCE_CHUNKS.

Return strict JSON:
{
  "verified": true | false,
  "reason": "<one sentence>",
  "correct_option_index": 0 | 1 | 2 | 3 | null,
  "supporting_chunk_ids": [chunk_id, ...]
}

Rules:
- "verified": true ONLY if SOURCE_CHUNKS directly prove the claimed answer.
- If chunks contradict the claimed answer, set verified: false and fill
  correct_option_index with the option that IS supported.
- If no option is fully supported, set correct_option_index: null.
- Be strict. "Close enough" is false.
```

### 7.3 Retroactive bank audit (`supabase/functions/verify-question-bank/`)

Scheduled cron, every 30 min. Adaptive rate + peak-hour deferral.

- **Off-peak (22:00–14:00 IST):** batch size 1000 rows.
- **Peak (14:00–22:00 IST):** batch size 250 rows.
- **Adaptive throttle:** sample rolling 1-min RPM from `grounded_ai_traces`. Target ≤ 60% of 4000 RPM Haiku tier 4 ceiling. If current RPM > 2400, reduce batch size by half.
- **Atomic claim** via `claim_verification_batch` RPC using `FOR UPDATE SKIP LOCKED`.
- **Claim TTL = 1800s** (30 min). Expired claims are re-claimable — crashed runs retry for free.
- **Rate-limit handling:** Claude 429 → exponential backoff (5, 10, 20, 40s). After 4 retries, release batch (stays `pending`, expired claim makes it re-claimable).

### 7.4 NCERT solver (`supabase/functions/ncert-solver/`)

Refactor identical in shape to Foxy but strict mode and simpler (one-shot, no session/quota). Template: `ncert_solver_v1`. If `grounded: false` → render the existing "solution not available" response with service-returned alternatives.

### 7.5 Concept engine (`src/app/api/concept-engine/route.ts`)

**TODO-2** — investigate during spec validation. If it does AI answering, route through service. If it's pure BKT/IRT math, leave alone.

### 7.6 Diagnostic (`src/app/api/diagnostic/start/route.ts`)

Pulls from `question_bank`. RPC must filter on the same `ff_grounded_ai_enforced` + `verified_against_ncert` logic as the main quiz RPC. No service call needed (doesn't generate).

### 7.7 Subjects & chapters routes

**Complete rewrite, simpler.** Today: RPC with soft-fail fallback to `GRADE_SUBJECTS` constant. New: RPC with no fallback — calls `get_available_subjects_v2(p_student_id)` and `available_chapters_for_student_subject_v2(p_student_id, p_subject_code)`, both thin reads over `cbse_syllabus WHERE rag_status = 'ready' AND is_in_scope = true`.

Delete: `GRADE_SUBJECTS` constant, soft-fail try/catch. Bearer-token handling from `4e43f4c` stays.

### 7.8 Frontend changes

Additive, no page restructure.

- **Foxy chat UI** — new `<UnverifiedBanner />` component attached to messages where `groundingStatus === 'unverified'`. Per-message (not persistent header). Amber (`bg-amber-50 border-amber-400`), icon + text, bilingual.
  - EN: "⚠ This answer isn't from your NCERT textbook — please verify with your book, or ask a specific NCERT question."
  - HI: "⚠ Yeh jawab aapki NCERT kitaab se nahi hai — apni kitaab se check karein, ya NCERT se koi specific sawaal poochein."
- **Hard-abstain card** (Foxy + Quiz + NCERT solver) — replaces the assistant bubble. Copy per 9.1/9.2 below.
- **Alternatives grid** — semantic top-3 (reuses the already-generated Voyage embedding) + `[See all N ready chapters]` link to expand to full list.
- **Subject/chapter picker** — no UI change; list is now filtered server-side.
- **Loading state** — spinner + elapsed-time counter. After 15s: "This is taking longer than usual — hold on."
- **`/report-issue` trigger** — small link below every Foxy assistant message: `Report an issue`. Opens a modal with a `reason_category` picker + optional comment. Submits to `POST /api/support/ai-issue` creating an `ai_issue_reports` row with the current `trace_id`.
- **"Let us know you need this chapter" button** on hard-abstain cards → writes `content_requests` row, shows confirmation.

### 7.9 Lint rule + CI check

New ESLint rules in `eslint-rules/`:

- `no-direct-ai-calls.js` — detects imports from `@anthropic-ai/sdk` or `voyageai`, and hardcoded URLs `api.anthropic.com` / `api.voyageai.com`. Allowlist: `supabase/functions/grounded-answer/`, `supabase/functions/_shared/retrieval.ts`.
- `no-direct-rag-rpc.js` — detects `.rpc('match_rag_chunks_ncert'` outside allowlist.

CI step between `lint` and `test` in `.github/workflows/ci.yml`:

```yaml
- name: AI surface boundary check
  run: npm run lint:ai-boundary
```

Violations fail the build. Emergency escape: `// eslint-disable-next-line no-direct-ai-calls -- REASON: ticket #N` flagged in PR review.

## 8. Verification pipelines

### 8.1 Ingestion hook

Existing Edge Functions (`extract-ncert-questions`, `embed-ncert-qa`, `embed-questions`, `embed-diagrams`, etc.) unchanged. One addition: after writes to `rag_content_chunks`, call `recompute_syllabus_status(grade, subject_code, chapter_number)`. Also installed as a trigger on `rag_content_chunks` INSERT/UPDATE/DELETE for automatic recompute.

### 8.2 Nightly coverage audit (`supabase/functions/coverage-audit/`)

- Schedule: daily 03:00 IST.
- Re-runs `recompute_syllabus_status` for every row to correct drift.
- Writes daily stats `ops_events` row.
- If any (grade, subject) dropped from `ready` → `partial`/`missing` since yesterday → `severity: high` event, alert.
- If `verified_ratio < 0.85` for any enforced pair → auto-flip `ff_grounded_ai_enforced` OFF for that pair + alert.
- Idempotent. Retries 3× on failure via Supabase cron retry.

### 8.3 Retroactive verifier — schedule and behavior

See §7.3 for mechanics. Atomic claim RPC:

```sql
CREATE FUNCTION claim_verification_batch(
  p_batch_size int, p_claimed_by text, p_claim_ttl_seconds int
) RETURNS SETOF question_bank AS $$
  UPDATE question_bank
  SET verification_state = 'pending',
      verification_claimed_by = p_claimed_by,
      verification_claim_expires_at = now() + (p_claim_ttl_seconds || ' seconds')::interval
  WHERE id IN (
    SELECT id FROM question_bank
    WHERE verification_state = 'legacy_unverified'
       OR (verification_state = 'pending'
           AND verification_claim_expires_at < now())
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$ LANGUAGE sql;
```

### 8.4 Failure escalation matrix

| Failure | Detected by | Severity | Auto-action | Admin action |
|---|---|---|---|---|
| Voyage outage >5 min | service traces | high | Circuit opens; Foxy soft-abstains | Verify Voyage status; force-close after fix |
| Claude outage >5 min | service traces | high | Circuit opens; Quiz serves bank (unaffected) | Verify Anthropic status |
| `verified_ratio < 0.85` on enforced pair | nightly audit | high | Flag auto-disables | Investigate cause |
| Trigger miss (chunk write, stale status) | nightly audit reconciles | medium | Updated at next 03:00 | None unless recurring |
| Verifier stuck >2h | health check on claim timestamps | medium | None (cron re-runs) | Check logs |
| Wrong-`subject_code` chunk insert | `rag_chunks_source_ncert_only` CHECK | low | INSERT blocked | Fix ingestion script |
| Service panic before trace write | Sentry capture | critical | Caller falls back to legacy path | Investigate via Sentry |

### 8.5 Observability additions (super-admin)

New pages under `/super-admin/grounding/`:

- **`/health`** — live calls/min per caller (grounded vs abstain), P50/P95/P99 latency, circuit states, Voyage/Claude error rates.
- **`/coverage`** — `ingestion_gaps` grid (rows = chapters, cols = grade×subject), severity sort, per-chapter drill-down, top-requested missing chapters.
- **`/verification-queue`** — pending/verified/failed counts per (grade, subject); re-verify + soft-delete; per-pair enforcement toggle (enabled only when `verified_ratio ≥ 0.9`).
- **`/traces`** — search by trace_id, (student_id + date), or (abstain_reason + date). Single-trace view shows trace row + joined chunks + resolved template. No full query/answer unless linked via `ai_issue_reports`.
- **`/ai-issues`** — the student-report triage queue (§10.2).

### 8.6 SLOs

| SLO | Target | Window | Alert if |
|---|---|---|---|
| Foxy response success (grounded OR soft-abstain-with-content) | ≥ 95% | 1 hour | < 90% for 15 min |
| **Quiz question availability (enforced pairs)** | **≥ 99.99%** | 1 hour | < 99.99% for 1 hour |
| Service P95 latency | ≤ 25s | 5 min | > 35s for 10 min |
| Voyage error rate | ≤ 2% | 5 min | > 10% for 5 min |
| Claude (Haiku) error rate | ≤ 2% | 5 min | > 10% for 5 min |
| Circuit trips per caller | ≤ 5/day | daily | > 20/day |
| Verifier throughput off-peak | ≥ 800 rows/30min | hourly | < 400 for 2 hours |
| `ready` chapter regressions | 0 ready → partial | daily | ≥ 1 |

## 9. Abstain UX

### 9.1 Foxy soft-abstain (grounded: true, confidence < 0.6)

Assistant bubble renders normally, with banner immediately above:

```
┌────────────────────────────────────────────────────────────┐
│  ⚠  This answer isn't from your NCERT textbook             │
│     Please verify with your book, or ask a specific NCERT  │
│     question for a grounded answer.                         │
│     [Show me NCERT chapters I can ask about]                │
└────────────────────────────────────────────────────────────┘
```

Amber styling. Per-message. Action button opens a side drawer listing ready chapters for current subject.

### 9.2 Foxy hard-abstain (grounded: false)

**`chapter_not_ready`:**

```
📚 This chapter isn't loaded yet

We're still adding NCERT content for:
[Grade] [Subject], Chapter [N] ([Title])

Here's what IS ready for you to ask about:
[3 semantic top-3 chapter cards]
[See all N ready chapters →]

[Let us know you need this chapter]
```

**`upstream_error` / `circuit_open`:**

```
🔄 Foxy is catching its breath

We couldn't reach our AI right now. Your message is saved.
[Try again]    (auto-retry in 30s)
```

Quota refunded (§7.1). HI translations for every string.

### 9.3 Quiz hard-abstain

```
📝 This chapter's quiz isn't ready yet

Ch [N] ([Title]) doesn't have enough verified NCERT
questions yet. We're working on it.

Ready chapters in [Grade] [Subject]:
  Ch X: [Title] — N questions ready  [Start quiz]
  Ch Y: [Title] — M questions ready  [Start quiz]
  Ch Z: [Title] — K questions ready  [Start quiz]

Or pick a different subject:
[Math] [SST] [English]

[Let us know you need this chapter]
```

### 9.4 Subject/chapter picker

- **Student view:** only `rag_status = 'ready' AND is_in_scope = true` chapters. No grayed-out or coming-soon entries.
- **Admin view:** all chapters with status badges (🟢 Ready / 🟡 Partial / 🔴 Missing).

### 9.5 Content requests

Click `[Let us know you need this chapter]` → writes `content_requests` row (rate-limited to 1/student/chapter/day) → shows:

```
✓ Got it — we'll prioritize this chapter
  You'll be one of N students waiting for it.
```

### 9.6 Loading state

- Spinner with elapsed-time counter: "Foxy is thinking... 12s"
- After 15s: "This is taking longer than usual — hold on"
- No fake stage messages.

## 10. Error handling, observability, and admin tooling

### 10.1 Error propagation contract

Service always returns HTTP 200 with one of three payload shapes. HTTP 500 reserved for service panics (service unavailable → caller falls back to legacy path during migration window only).

### 10.2 Trace-driven debugging (privacy-preserving)

```
Student reports → ai_issue_reports row (links foxy_chat_messages + trace_id)
  → Admin opens /super-admin/ai-issues/[id]
  → UI joins ai_issue_reports × foxy_chat_messages × grounded_ai_traces
  → Admin sees: full query, full answer, retrieved chunks, resolved prompt,
    confidence, grounding-check result, Claude model
  → Admin actions: flag chunk / flag template / re-verify chapter /
    respond to student / set admin_resolution
```

Full text lives only in `foxy_chat_messages` (student-RLS scoped). Traces only have `query_hash` + 200-char preview. Link requires explicit student report.

### 10.3 Sentry + ops_events

- Sentry captures service panics tagged `error.type = 'grounded_answer_internal'`.
- `ops_events` captures: every abstain, circuit trips/recovers, flag toggles (including auto-disable), coverage regressions.
- Alerts route via existing `alert-deliverer` Edge Function.

### 10.4 Kill switches

Three, all writing `ops_events` on flip (actor + reason required):

1. **Per-caller** — `ff_grounded_ai_foxy`, `ff_grounded_ai_quiz_generator`, `ff_grounded_ai_ncert_solver`, etc.
2. **Global** — `ff_grounded_ai_enabled` = false → service returns 503 → callers fall back to legacy paths.
3. **Per-(grade, subject)** — `ff_grounded_ai_enforced` table lookup; surgical disable without affecting others.

### 10.5 Cost observability

- Daily cost estimate per caller from `grounded_ai_traces` × token averages × Anthropic pricing.
- Rolling 7-day chart on `/health`.
- Warning (not page) if daily cost > 7-day average + 25%.

### 10.6 What we are NOT building in v1

- Streaming service responses (TODO-3).
- Multi-board support (CBSE only; schema supports extension).
- Ingestion-pipeline rebuild.
- New embedding models.

## 11. Rollout plan

### 11.1 Week-by-week

**Week 1 — Foundation.** Migrations applied (cbse_syllabus, question_bank cols, traces, gaps view, content_requests, ai_issue_reports, rag_ingestion_failures). Backfill populates cbse_syllabus. Initial status computed. Triggers installed. Prompt templates registered. Feature flags created (all OFF). **Gate 1:** cbse_syllabus row count matches CBSE catalog; rag_status distribution reviewed.

**Week 2 — Service.** Build `grounded-answer` Edge Function (precheck, Voyage, retrieval+scope verify, Claude+fallback, grounding check, citation extract, trace, circuit breaker, cache, per-plan timeouts). Lint rules written (warn first, error at week-end). Unit tests. Deploy to staging; no callers. **Gate 2:** synthetic test suite 100%; manual smoke all 6 abstain reasons; 7-day retention verified.

**Week 3 — Surface refactors + retroactive verifier.** Foxy, quiz-generator, NCERT-solver refactored behind per-caller flags. Subjects/chapters routes rewritten. Frontend components: banner, hard-abstain card, alternatives grid, spinner+timer, report-issue flow. `verify-question-bank` Edge Function deployed. **Gate 3:** all CI passes, E2E suite green on staging with flags ON for a synthetic test pair.

**Week 4 — Pilot + rollout.** Day 1 migrations → prod. Days 1–2 verifier runs on legacy rows. Day 3 dashboards deployed. Day 4 pilot pair = **Grade 10 Science**; flip flags; 5-account internal smoke; 30-min observation. Day 5 expand to 2 more pairs if clean. Days 6–10 progressive rollout. **Gate 4:** all pairs with `verified_ratio ≥ 0.9` enforced; remaining listed in ingestion-priority followup.

### 11.2 Feature flag sequence

```
Week 1–2: All OFF.
Week 3: staging-only test flag ON for synthetic test pair.
Week 4 Day 4:
  1. ff_grounded_ai_enabled = true
  2. ff_grounded_ai_foxy = true
  3. ff_grounded_ai_quiz_generator = true
  4. ff_grounded_ai_ncert_solver = true
  5. ff_grounded_ai_enforced: (10, science) only
Week 4 Day 5: 2 more pairs if pilot clean
Week 4 Day 6–10: progressive, 2–3 pairs/day
Post-Week 4: remaining pairs as coverage reaches threshold
After 30 days stable: delete legacy inline code paths
```

### 11.3 Pre-rollout checklist

- [ ] All migrations applied to prod, idempotency verified
- [ ] `cbse_syllabus` spot-check (10 random rows vs CBSE catalog)
- [ ] Triggers firing on test inserts
- [ ] `grounded-answer` service `/health` returns 200
- [ ] Prompt templates loaded and versioned (git hash at startup)
- [ ] All feature flags exist in prod, readable as OFF
- [ ] CI lint rule `no-direct-ai-calls` at error level
- [ ] 5 runbooks reviewed by ops
- [ ] Super-admin dashboards render against prod data
- [ ] `ai_issue_reports` end-to-end submission tested
- [ ] Rollback drill executed once in staging (simulated Voyage outage)

### 11.4 Pilot launch steps (Week 4 Day 4)

```
09:00 IST  Verify Grade 10 Science: verified_ratio ≥ 0.9, majority ready
09:15 IST  Flip flags (5 flag flips documented in §11.2)
09:30 IST  5-account smoke: grounded Q / ungrounded Q / ready quiz /
             partial quiz / NCERT exercise / out-of-scope pick
10:30 IST  Observe 30 min on /health dashboard
11:00 IST  GO/NO-GO decision
```

### 11.5 Success metrics (7-day / 30-day)

| Metric | Baseline | 7-day | 30-day |
|---|---|---|---|
| Foxy grounded:true rate | unknown | ≥ 75% | ≥ 85% |
| Student-reported wrong answers | unknown | ≤ 1/1000 turns | ≤ 1/5000 turns |
| Quiz `correct_answer_index` disputes on verified rows | unknown | 0 | 0 |
| `ready` chapter count | Week-1 measured | +10% | +30% |
| Verifier queue drain | N/A | 500K processed | 100% of bank |
| Foxy P95 latency | ~18s | ≤ 22s | ≤ 20s |
| Circuit trips/day/caller | N/A | ≤ 5 | ≤ 2 |

**Anchor metric:** student-reported wrong answers. If 30-day rate isn't ≥10× lower than today, declare design failure and revisit.

### 11.6 Rollback paths

- **Per-pair:** flip `ff_grounded_ai_enforced = false` for that pair.
- **Service-wide:** `ff_grounded_ai_enabled = false` OR delete `grounded-answer` Edge Function.
- **Full:** `git revert` refactor commits. Legacy paths return. Data additions harmless.

## 12. Testing strategy

### 12.1 Layer 3 service unit tests (`supabase/functions/grounded-answer/__tests__/`)

Target ≥90% branch coverage. Key tests:

- `coverage_precheck_blocks_missing_chapter`
- `scope_verification_drops_wrong_chapter`
- `strict_mode_min_chunks_enforced`
- `soft_mode_low_similarity_downgrades_confidence`
- `grounding_check_fail_abstains_in_strict`
- `grounding_check_pass_allows_response`
- `circuit_trips_at_3_failures`
- `circuit_half_open_after_30s`
- `per_plan_timeout_applied`
- `trace_row_written_for_every_call`
- `insufficient_context_sentinel_respected`
- `prompt_template_registry_rejects_unknown`

### 12.2 Layer 4 integration tests (`src/__tests__/`)

- `foxy_route_never_imports_anthropic_directly` (runs the lint rule)
- `foxy_soft_abstain_renders_banner`
- `foxy_hard_abstain_returns_alternatives`
- `foxy_quota_refunded_on_upstream_error`
- `quiz_route_serves_only_verified_when_enforced`
- `quiz_route_serves_legacy_when_not_enforced`
- `subjects_route_no_soft_fail_fallback`
- `subjects_route_only_ready_chapters_shown`

### 12.3 Generator tests (`supabase/functions/quiz-generator/__tests__/`)

- `generator_rejects_when_verifier_disagrees`
- `generator_accepts_when_verifier_agrees`
- `generator_sets_trace_id_on_bank_insert`
- `generator_skips_when_chapter_not_ready`

### 12.4 Verifier tests (`supabase/functions/verify-question-bank/__tests__/`)

- `claim_batch_skips_locked_rows`
- `claim_ttl_returns_orphaned_rows_to_queue`
- `peak_hour_detection_drops_batch_size`
- `adaptive_rate_respects_trace_rpm`
- `failed_rows_not_reclaimed`

### 12.5 E2E (Playwright, `e2e/grounding/`)

- `foxy_chat_grounded_shows_citations`
- `foxy_chat_ungrounded_shows_banner`
- `foxy_chapter_not_ready_shows_alternatives`
- `quiz_chapter_not_ready_refuses`
- `quiz_enforced_pair_serves_only_verified`
- `subjects_picker_hides_missing_chapters`
- `student_reports_ai_issue_creates_row`

### 12.6 Load tests (staging)

- 100 concurrent Foxy calls × 5 min → P95 ≤ 25s, no circuit trips, no DB connection exhaustion
- 1000 concurrent quiz starts → question_bank RPC P95 ≤ 500ms
- Voyage chaos (50% failure injection) → circuit trips as expected, recovers in 30s

## 13. Definition of done

- [ ] All 13 sections of this spec approved
- [ ] Spec committed to `docs/superpowers/specs/2026-04-17-rag-grounding-integrity-design.md`
- [ ] Implementation plan written via `writing-plans` skill
- [ ] All Week 1–3 work committed with passing CI
- [ ] All tests in §12 written and passing
- [ ] Pilot executed successfully (GO at Week 4 Day 4, 11:00 IST)
- [ ] First 5 (grade, subject) pairs enforced ≥7 days with all SLOs met
- [ ] Runbooks reviewed by ops team
- [ ] Legacy inline code paths deleted (30 days post-rollout)

## 14. Follow-ups (explicit TODOs)

- **TODO-1** — delete `subjects`/`chapters` tables and `GRADE_SUBJECTS` constant after `cbse_syllabus` is proven (≥30 days stable). Requires audit of all references (analytics, enrollment, reports).
- **TODO-2** — investigate `concept-engine` and confirm NCERT-solver refactor shape during spec validation; update this spec if either has AI-answering paths not covered. **Resolved 2026-04-17**: concept-engine uses direct Voyage + `match_rag_chunks` RPC for retrieval only (no Claude). Refactor plan: add `retrieve_only: true` mode to service in Phase 2 Task 2.11; concept-engine calls it in Phase 3 Task 3.4.
- **TODO-3** — add streaming response support to the service. Requires reworking trace-log timing (trace written post-completion vs per-chunk) and client handling. Priority: only if P95 latency becomes a UX problem post-rollout.
- **TODO-4** — introduce finer-grained admin roles (`content_admin`, `ops_admin`, `support_admin`) in a follow-up migration. All RLS policies in this project's migrations use the established `admin_users` pattern (active admin gets all rights) because the finer-grained roles don't exist in the `roles` seed today. If ops wants sub-role restrictions later, add the roles + update the four affected policies (`cbse_syllabus_write_admin`, `grounded_traces_read_admin`, `ai_issue_reports_update_admin`, `ff_pairs_write_admin`, etc.). Service-role bypass for Edge Function writes is preserved regardless.

## 15. Invariant impact

| Invariant | Impact | Status |
|---|---|---|
| P1 (score accuracy) | Quiz route changes filter on `verified_against_ncert`, formula unchanged | Preserved |
| P2 (XP economy) | No change | Preserved |
| P3 (anti-cheat) | No change | Preserved |
| P4 (atomic submission) | No change | Preserved |
| P5 (grade format) | `cbse_syllabus.grade` is text with CHECK — reinforces P5 | Strengthened |
| P6 (question quality) | `verified_against_ncert` is a stronger gate than `validateQuestion()` alone | Strengthened |
| P7 (bilingual UI) | All new strings have HI translations | Preserved |
| P8 (RLS) | 5 new tables all have RLS policies in their migrations | Preserved |
| P9 (RBAC) | Admin pages gated by `ops_admin` / `support_admin` / `content_admin` | Preserved |
| P10 (bundle budget) | Frontend additions: ~8 KB banner + card + modal components, well within limits | Preserved |
| P11 (payment integrity) | No change | Preserved |
| **P12 (AI safety)** | **Core strengthening: every AI output now has a grounding gate, citation binding, trace, and abstain policy. No unfiltered LLM output to students.** | **Strengthened materially** |
| P13 (data privacy) | Traces store query_hash only; full text requires consent-linked report | Preserved (with care) |
| P14 (review chain completeness) | Review chain table in §16 defines required reviewers per file area | Preserved |
| P15 (onboarding integrity) | No change to signup/verification/profile flow | Preserved |

## 16. Review chain requirements

Per P14, any implementation PR for this spec must invoke the following reviewers based on files touched:

| Change | Required reviewers |
|---|---|
| `supabase/migrations/*` | architect, testing |
| `supabase/functions/grounded-answer/*` | ai-engineer, assessment (prompt correctness), testing |
| `supabase/functions/quiz-generator*/*` | ai-engineer, assessment, testing |
| `supabase/functions/verify-question-bank/*` | ai-engineer, assessment, testing |
| `src/app/api/foxy/*` | ai-engineer, assessment, frontend, testing |
| `src/app/api/quiz/*` | assessment, backend, testing |
| `src/app/api/student/subjects/*`, `src/app/api/student/chapters/*` | backend, architect (RLS), testing |
| `src/app/super-admin/grounding/*` | ops, frontend, testing |
| `src/lib/grounding-config.ts`, `supabase/functions/grounded-answer/config.ts` | ai-engineer, testing |
| Frontend components (banner, card, alternatives grid) | frontend, assessment (quiz UX), testing |
| ESLint rules + CI check | architect, quality, testing |
| Runbooks | ops, architect |
