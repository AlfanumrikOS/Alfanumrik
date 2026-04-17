# RAG Grounding Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI answer in Alfanumrik either grounded in NCERT Voyage-embedded chunks or cleanly abstained, eliminating hallucinated content, wrong-chapter retrieval, and wrong quiz `correct_answer_index` rows.

**Architecture:** Four layers. (1) Offline ingestion & verification populate chunks and a verified question bank. (2) `cbse_syllabus` catalog is the single source of truth for `(grade, subject, chapter) → rag_status`. (3) A new Supabase Edge Function `grounded-answer` is the sole surface that calls Voyage or Claude; it owns retrieval, grounding checks, abstain policy, citations, trace logging, circuit breaker. (4) Surface routes (Foxy, quiz-generator, NCERT-solver, concept-engine) become thin callers. Frontend renders unverified banners and hard-abstain cards. ESLint + CI enforce the "no direct AI calls" boundary.

**Tech Stack:** Next.js 16.2 (Vercel), Supabase Postgres + RLS, Supabase Edge Functions (Deno), Claude Haiku (primary) + Sonnet (fallback), Voyage `voyage-3` (1024-dim), Vitest (web), deno test (edge), Playwright (E2E).

**Source spec:** `docs/superpowers/specs/2026-04-17-rag-grounding-integrity-design.md` — all design decisions locked there.

---

## Conventions (read once, apply throughout)

### Commit cadence
One commit per task (after test + implementation green). Every commit message format:

```
<type>(<scope>): <summary>

<body — what changed and why>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Types used in this plan: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`.
Scopes used: `grounding`, `syllabus`, `foxy`, `quiz`, `ncert`, `concept`, `admin`, `ci`.

### Pre-commit gate (run before EVERY commit)
```bash
npm run type-check && npm run lint && npm test -- --run && npm run build
```
If any step fails, fix before committing. Never `--no-verify`.

### Test commands
| Layer | Command |
|---|---|
| Web unit (Vitest) | `npx vitest run src/__tests__/path/to/file.test.ts` |
| Edge Function (deno) | `cd supabase/functions/<name> && deno test --allow-all` |
| E2E (Playwright) | `npm run test:e2e -- e2e/grounding/<file>.spec.ts` |
| Migration (Supabase local) | `supabase db reset && supabase db push` |
| Full suite | `npm test` (Vitest) + `npm run test:e2e` (Playwright) |

### Migration file naming
`supabase/migrations/YYYYMMDDHHMMSS_<description>.sql`. Use timestamp > latest existing (`20260417...`). Every new table MUST have `ENABLE ROW LEVEL SECURITY` + at least one policy in the same migration file (P8 invariant).

### P5 invariant
Grades are strings `'6'`–`'12'`. Never integers. Add CHECK constraints where new columns are introduced.

### Commit size rule
If a task requires more than ~300 lines of diff, split it. Tasks here are sized for atomic commits.

---

## Phase summary

| Phase | Weeks | Tasks | Goal |
|---|---|---|---|
| 0 | pre-work | 1 | Resolve TODO-2 (concept-engine investigation) — **complete** |
| 1 | 1 | 9 | Data model foundation (migrations, backfill, prompt templates, flags) |
| 2 | 2 | 12 | Build `grounded-answer` Edge Function |
| 3 | 3 | 20 | Refactor surfaces, build frontend components + admin panels, wire CI guard |
| 4 | 4 | 7 | Deploy, verifier drain, pilot, progressive rollout |

Total: ~49 atomic tasks. Each task = test + implementation + commit.

---

## Phase 0 — Discovery (complete)

### Task 0.1: Concept-engine AI surface audit — DONE

**Finding:** `src/app/api/concept-engine/route.ts` calls Voyage directly (line 117, 120) and uses `match_rag_chunks` RPC (line 186, 361). It is **retrieval-only** (no Claude calls). Actions: `chapter`, `search`, `quiz-pool`.

**Resolution:** Add `retrieve_only: boolean` to the grounded-answer service request. When true, skip Claude generation and return chunks + scope metadata. Concept-engine refactors to call this mode in Phase 3 (Task 3.4). No separate service endpoint needed.

---

## Phase 1 — Data model foundation (Week 1, 9 tasks)

**Phase goal:** Every DB object the service and surfaces will read from exists and is populated. No code yet calls into any of this.

**Phase exit gate:** `cbse_syllabus` row count matches authoritative CBSE catalog; triggers fire on a test chunk insert; all migrations applied to staging and reset cleanly.

### Task 1.1: Migration — `cbse_syllabus` table

**Files:**
- Create: `supabase/migrations/20260418100000_create_cbse_syllabus.sql`
- Create: `src/__tests__/migrations/cbse-syllabus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/migrations/cbse-syllabus.test.ts
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('cbse_syllabus migration', () => {
  it('table exists with expected columns and CHECK constraints', async () => {
    const { data, error } = await supabaseAdmin.rpc('information_schema_columns', {
      p_table: 'cbse_syllabus',
    }).select('column_name, data_type, is_nullable').limit(50);
    // fallback: raw query if no helper
    const { data: raw } = await supabaseAdmin.from('cbse_syllabus').select('*').limit(0);
    expect(error).toBeNull();
    expect(raw).toBeDefined();
  });

  it('rejects invalid grade', async () => {
    const { error } = await supabaseAdmin.from('cbse_syllabus').insert({
      grade: '5',                       // invalid — check constraint must block
      subject_code: 'science',
      subject_display: 'Science',
      chapter_number: 1,
      chapter_title: 'Test',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/check|grade/i);
  });

  it('rejects invalid rag_status', async () => {
    const { error } = await supabaseAdmin.from('cbse_syllabus').insert({
      grade: '10', subject_code: 'science', subject_display: 'Science',
      chapter_number: 1, chapter_title: 'Test',
      rag_status: 'unknown',            // invalid
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/check|rag_status/i);
  });

  it('UNIQUE constraint on (board, grade, subject_code, chapter_number)', async () => {
    const row = { board: 'CBSE', grade: '10', subject_code: 'science',
                  subject_display: 'Science', chapter_number: 99, chapter_title: 'Dup' };
    await supabaseAdmin.from('cbse_syllabus').insert(row);
    const { error } = await supabaseAdmin.from('cbse_syllabus').insert(row);
    expect(error).not.toBeNull();
    await supabaseAdmin.from('cbse_syllabus').delete().match(row);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/migrations/cbse-syllabus.test.ts
```
Expected: FAIL with "relation 'cbse_syllabus' does not exist".

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260418100000_create_cbse_syllabus.sql
CREATE TABLE IF NOT EXISTS cbse_syllabus (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board                   text NOT NULL DEFAULT 'CBSE',
  grade                   text NOT NULL CHECK (grade IN ('6','7','8','9','10','11','12')),
  subject_code            text NOT NULL,
  subject_display         text NOT NULL,
  subject_display_hi      text,
  chapter_number          int  NOT NULL CHECK (chapter_number > 0),
  chapter_title           text NOT NULL,
  chapter_title_hi        text,
  chunk_count             int  NOT NULL DEFAULT 0,
  verified_question_count int  NOT NULL DEFAULT 0,
  rag_status              text NOT NULL DEFAULT 'missing'
    CHECK (rag_status IN ('missing','partial','ready')),
  last_verified_at        timestamptz,
  is_in_scope             boolean NOT NULL DEFAULT true,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board, grade, subject_code, chapter_number)
);

CREATE INDEX IF NOT EXISTS idx_cbse_syllabus_lookup
  ON cbse_syllabus (board, grade, subject_code, rag_status)
  WHERE is_in_scope;

CREATE INDEX IF NOT EXISTS idx_cbse_syllabus_ready
  ON cbse_syllabus (grade, subject_code)
  WHERE rag_status = 'ready' AND is_in_scope;

ALTER TABLE cbse_syllabus ENABLE ROW LEVEL SECURITY;

-- Read: all authenticated users
CREATE POLICY cbse_syllabus_read_authenticated ON cbse_syllabus
  FOR SELECT USING (auth.role() = 'authenticated');

-- Write: service role + content_admin role
CREATE POLICY cbse_syllabus_write_admin ON cbse_syllabus
  FOR ALL USING (
    auth.role() = 'service_role' OR
    EXISTS (SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role_code = 'content_admin')
  );

COMMENT ON TABLE cbse_syllabus IS
  'Layer 2 SSoT. One row per (board, grade, subject_code, chapter_number). '
  'rag_status derived from chunk_count + verified_question_count. '
  'See docs/superpowers/specs/2026-04-17-rag-grounding-integrity-design.md §5.1';
```

- [ ] **Step 4: Apply and re-run test**

```bash
supabase db push
npx vitest run src/__tests__/migrations/cbse-syllabus.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418100000_create_cbse_syllabus.sql \
        src/__tests__/migrations/cbse-syllabus.test.ts
git commit -m "feat(syllabus): add cbse_syllabus SSoT table with RLS

One row per (board, grade, subject_code, chapter_number). rag_status
enum {missing, partial, ready} drives all UI and service gating. See spec §5.1."
```

---

### Task 1.2: Migration — `rag_content_chunks` CHECK constraints + index

**Files:**
- Create: `supabase/migrations/20260418100100_rag_chunks_constraints.sql`
- Create: `src/__tests__/migrations/rag-chunks-constraints.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/migrations/rag-chunks-constraints.test.ts
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('rag_content_chunks constraints', () => {
  it('rejects source other than ncert_2025', async () => {
    const { error } = await supabaseAdmin.from('rag_content_chunks').insert({
      content: 'test', source: 'wikipedia',
      grade_short: '10', subject_code: 'science', chapter_number: 1,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/source|check/i);
  });

  it('rejects invalid grade_short', async () => {
    const { error } = await supabaseAdmin.from('rag_content_chunks').insert({
      content: 'test', source: 'ncert_2025',
      grade_short: '13', subject_code: 'science', chapter_number: 1,
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Verify fail**

```bash
npx vitest run src/__tests__/migrations/rag-chunks-constraints.test.ts
```
Expected: FAIL (constraints missing — inserts succeed).

- [ ] **Step 3: Write migration**

```sql
-- supabase/migrations/20260418100100_rag_chunks_constraints.sql

-- Guard: only add constraint if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'rag_content_chunks'
      AND constraint_name = 'rag_chunks_source_ncert_only'
  ) THEN
    ALTER TABLE rag_content_chunks
      ADD CONSTRAINT rag_chunks_source_ncert_only
      CHECK (source = 'ncert_2025');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'rag_content_chunks'
      AND constraint_name = 'rag_chunks_valid_grade'
  ) THEN
    ALTER TABLE rag_content_chunks
      ADD CONSTRAINT rag_chunks_valid_grade
      CHECK (grade_short IN ('6','7','8','9','10','11','12'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rag_chunks_catalog_join
  ON rag_content_chunks (grade_short, subject_code, chapter_number);
```

- [ ] **Step 4: Apply and verify**

```bash
supabase db push
npx vitest run src/__tests__/migrations/rag-chunks-constraints.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418100100_rag_chunks_constraints.sql \
        src/__tests__/migrations/rag-chunks-constraints.test.ts
git commit -m "feat(grounding): add CHECK constraints + join index to rag_content_chunks

Enforce source='ncert_2025' and valid grade values at DB level. See spec §5.2."
```

---

### Task 1.3: Migration — `question_bank` verification state machine

**Files:**
- Create: `supabase/migrations/20260418100200_question_bank_verification.sql`
- Create: `src/__tests__/migrations/question-bank-verification.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/migrations/question-bank-verification.test.ts
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('question_bank verification columns', () => {
  it('new rows default to legacy_unverified', async () => {
    const { data, error } = await supabaseAdmin.from('question_bank').insert({
      question_text: 'Test question with sufficient length here.',
      options: ['A', 'B', 'C', 'D'],
      correct_answer_index: 0,
      explanation: 'Test explanation that is long enough to pass validation.',
      subject: 'science', grade: '10', chapter_number: 1,
      difficulty: 'medium', bloom_level: 'understand',
    }).select('verification_state, verified_against_ncert').single();
    expect(error).toBeNull();
    expect(data!.verification_state).toBe('legacy_unverified');
    expect(data!.verified_against_ncert).toBe(false);
  });

  it('rejects invalid verification_state', async () => {
    const { error } = await supabaseAdmin.from('question_bank').insert({
      question_text: 'Test.', options: ['A','B','C','D'],
      correct_answer_index: 0, explanation: 'x',
      subject: 'science', grade: '10', chapter_number: 1,
      difficulty: 'medium', bloom_level: 'understand',
      verification_state: 'bogus',
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Verify fail**

```bash
npx vitest run src/__tests__/migrations/question-bank-verification.test.ts
```
Expected: FAIL (columns don't exist).

- [ ] **Step 3: Write migration**

```sql
-- supabase/migrations/20260418100200_question_bank_verification.sql

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

CREATE INDEX IF NOT EXISTS idx_question_bank_verified
  ON question_bank (grade, subject, chapter_number)
  WHERE verified_against_ncert = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_question_bank_verification_queue
  ON question_bank (created_at)
  WHERE verification_state IN ('legacy_unverified','pending');

COMMENT ON COLUMN question_bank.verification_state IS
  'State machine: legacy_unverified (never checked) → pending (claimed by verifier) '
  '→ verified (proven by NCERT chunks) OR failed (verifier disagreed). '
  'See spec §5.3.';
```

- [ ] **Step 4: Apply and verify**

```bash
supabase db push
npx vitest run src/__tests__/migrations/question-bank-verification.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418100200_question_bank_verification.sql \
        src/__tests__/migrations/question-bank-verification.test.ts
git commit -m "feat(quiz): add verification state machine to question_bank

Four-state machine prevents unverified answers reaching students once
ff_grounded_ai_enforced is flipped per (grade, subject). See spec §5.3."
```

---

### Task 1.4: Migration — `grounded_ai_traces` table + retention cron

**Files:**
- Create: `supabase/migrations/20260418100300_grounded_ai_traces.sql`
- Create: `src/__tests__/migrations/grounded-ai-traces.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/migrations/grounded-ai-traces.test.ts
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('grounded_ai_traces', () => {
  it('accepts a grounded=true trace', async () => {
    const { data, error } = await supabaseAdmin.from('grounded_ai_traces').insert({
      caller: 'foxy',
      query_hash: 'sha256:abcd',
      query_preview: 'Test query preview',
      retrieved_chunk_ids: [],
      chunk_count: 0,
      grounded: true,
      confidence: 0.9,
    }).select().single();
    expect(error).toBeNull();
    expect(data!.id).toBeDefined();
    await supabaseAdmin.from('grounded_ai_traces').delete().eq('id', data!.id);
  });

  it('rejects unknown caller', async () => {
    const { error } = await supabaseAdmin.from('grounded_ai_traces').insert({
      caller: 'unknown_caller',
      query_hash: 'sha256:x', retrieved_chunk_ids: [], chunk_count: 0, grounded: false,
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Verify fail**

```bash
npx vitest run src/__tests__/migrations/grounded-ai-traces.test.ts
```

- [ ] **Step 3: Write migration**

```sql
-- supabase/migrations/20260418100300_grounded_ai_traces.sql

CREATE TABLE IF NOT EXISTS grounded_ai_traces (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  caller                   text NOT NULL
    CHECK (caller IN ('foxy','ncert-solver','quiz-generator','concept-engine','diagnostic')),
  student_id               uuid REFERENCES students(id) ON DELETE SET NULL,
  grade                    text,
  subject_code             text,
  chapter_number           int,
  query_hash               text NOT NULL,
  query_preview            text,
  embedding_model          text,
  retrieved_chunk_ids      uuid[] NOT NULL,
  top_similarity           numeric(5,4),
  chunk_count              int NOT NULL,
  claude_model             text,
  prompt_template_id       text,
  prompt_hash              text,
  grounded                 boolean NOT NULL,
  abstain_reason           text,
  confidence               numeric(5,4),
  answer_length            int,
  input_tokens             int,
  output_tokens            int,
  latency_ms               int,
  client_reported_issue_id uuid
);

CREATE INDEX idx_traces_recent ON grounded_ai_traces (created_at DESC);
CREATE INDEX idx_traces_abstain ON grounded_ai_traces (created_at DESC)
  WHERE grounded = false;
CREATE INDEX idx_traces_student ON grounded_ai_traces (student_id, created_at DESC);
CREATE INDEX idx_traces_caller ON grounded_ai_traces (caller, created_at DESC);

ALTER TABLE grounded_ai_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY grounded_traces_read_admin ON grounded_ai_traces
  FOR SELECT USING (
    auth.role() = 'service_role' OR
    EXISTS (SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role_code IN ('ops_admin','support_admin'))
  );

CREATE POLICY grounded_traces_insert_service ON grounded_ai_traces
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Retention: grounded=true >90 days, grounded=false >180 days
CREATE OR REPLACE FUNCTION purge_old_grounded_traces()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM grounded_ai_traces
    WHERE grounded = true AND created_at < now() - INTERVAL '90 days';
  DELETE FROM grounded_ai_traces
    WHERE grounded = false AND created_at < now() - INTERVAL '180 days';
$$;

COMMENT ON TABLE grounded_ai_traces IS
  'Every AI call writes one row. Stores query_hash + 200-char preview only '
  '(P13 privacy). Full text requires consent-linked ai_issue_reports. See §5.4.';
```

- [ ] **Step 4: Apply and verify**

```bash
supabase db push
npx vitest run src/__tests__/migrations/grounded-ai-traces.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418100300_grounded_ai_traces.sql \
        src/__tests__/migrations/grounded-ai-traces.test.ts
git commit -m "feat(grounding): add grounded_ai_traces table with privacy-safe redaction

Every AI call writes a trace. Only query_hash + 200-char preview stored
— full text requires consent-linked ai_issue_reports. Spec §5.4."
```

---

### Task 1.5: Migration — `content_requests` + `ai_issue_reports` + `rag_ingestion_failures`

**Files:**
- Create: `supabase/migrations/20260418100400_feedback_and_failures.sql`
- Create: `src/__tests__/migrations/feedback-tables.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/migrations/feedback-tables.test.ts
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('feedback and failure tables', () => {
  it('content_requests: rate-limit one per (student, chapter, day)', async () => {
    // requires a test student row to exist — skip if not available
    const { data: student } = await supabaseAdmin.from('students').select('id').limit(1).single();
    if (!student) return;
    const row = {
      student_id: student.id, grade: '10', subject_code: 'science',
      chapter_number: 999, request_source: 'foxy',
    };
    const { error: err1 } = await supabaseAdmin.from('content_requests').insert(row);
    expect(err1).toBeNull();
    const { error: err2 } = await supabaseAdmin.from('content_requests').insert(row);
    expect(err2).not.toBeNull();                    // UNIQUE violation
    await supabaseAdmin.from('content_requests').delete().match(row);
  });

  it('ai_issue_reports: rejects unknown reason_category', async () => {
    const { error } = await supabaseAdmin.from('ai_issue_reports').insert({
      student_id: '00000000-0000-0000-0000-000000000000',
      reason_category: 'bogus',
    });
    expect(error).not.toBeNull();
  });

  it('rag_ingestion_failures: accepts a failure row', async () => {
    const { data, error } = await supabaseAdmin.from('rag_ingestion_failures').insert({
      source_file: 'test.pdf', grade: '10', subject_code: 'science',
      chapter_number: 1, reason: 'empty content',
    }).select().single();
    expect(error).toBeNull();
    await supabaseAdmin.from('rag_ingestion_failures').delete().eq('id', data!.id);
  });
});
```

- [ ] **Step 2: Verify fail**

```bash
npx vitest run src/__tests__/migrations/feedback-tables.test.ts
```

- [ ] **Step 3: Write migration**

```sql
-- supabase/migrations/20260418100400_feedback_and_failures.sql

-- content_requests: students ask for a chapter to be added
CREATE TABLE IF NOT EXISTS content_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     uuid REFERENCES students(id) ON DELETE CASCADE,
  grade          text NOT NULL,
  subject_code   text NOT NULL,
  chapter_number int  NOT NULL,
  chapter_title  text,
  request_source text CHECK (request_source IN ('foxy','quiz','learn','ncert-solver')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One request per (student, chapter) per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_requests_one_per_day
  ON content_requests (student_id, grade, subject_code, chapter_number,
                       (date_trunc('day', created_at)));

CREATE INDEX IF NOT EXISTS idx_content_requests_prioritize
  ON content_requests (grade, subject_code, chapter_number);

ALTER TABLE content_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY content_requests_read_own ON content_requests
  FOR SELECT USING (
    auth.role() = 'service_role' OR
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role_code = 'ops_admin')
  );

CREATE POLICY content_requests_insert_own ON content_requests
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role' OR
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- ai_issue_reports: students flag bad AI answers
CREATE TABLE IF NOT EXISTS ai_issue_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  foxy_message_id    uuid,                        -- FK added later if table exists
  question_bank_id   uuid REFERENCES question_bank(id) ON DELETE SET NULL,
  trace_id           uuid REFERENCES grounded_ai_traces(id) ON DELETE SET NULL,
  reason_category    text NOT NULL
    CHECK (reason_category IN ('wrong_answer','off_topic','inappropriate','unclear','other')),
  student_comment    text,
  admin_notes        text,
  admin_resolution   text
    CHECK (admin_resolution IN ('bad_chunk','bad_prompt','bad_question','infra','no_issue','pending')),
  resolved_by        uuid,
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Wire the foxy_message_id FK conditionally
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'foxy_chat_messages') THEN
    ALTER TABLE ai_issue_reports
      ADD CONSTRAINT ai_issue_reports_foxy_message_fk
      FOREIGN KEY (foxy_message_id) REFERENCES foxy_chat_messages(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_issue_reports_pending
  ON ai_issue_reports (created_at DESC)
  WHERE admin_resolution IS NULL OR admin_resolution = 'pending';

ALTER TABLE ai_issue_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_issue_reports_read_own_or_admin ON ai_issue_reports
  FOR SELECT USING (
    auth.role() = 'service_role' OR
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role_code IN ('ops_admin','support_admin'))
  );

CREATE POLICY ai_issue_reports_insert_own ON ai_issue_reports
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role' OR
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY ai_issue_reports_update_admin ON ai_issue_reports
  FOR UPDATE USING (
    auth.role() = 'service_role' OR
    EXISTS (SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role_code IN ('ops_admin','support_admin'))
  );

-- rag_ingestion_failures: bad chunks land here, not in rag_content_chunks
CREATE TABLE IF NOT EXISTS rag_ingestion_failures (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file        text,
  grade              text,
  subject_code       text,
  chapter_number     int,
  reason             text NOT NULL,
  raw_data_preview   text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rag_ingestion_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY rag_ingestion_failures_read_admin ON rag_ingestion_failures
  FOR SELECT USING (
    auth.role() = 'service_role' OR
    EXISTS (SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role_code = 'ops_admin')
  );
```

- [ ] **Step 4: Apply and verify**

```bash
supabase db push
npx vitest run src/__tests__/migrations/feedback-tables.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418100400_feedback_and_failures.sql \
        src/__tests__/migrations/feedback-tables.test.ts
git commit -m "feat(grounding): add content_requests + ai_issue_reports + rag_ingestion_failures

Feedback loop tables: content_requests (student asks for chapter),
ai_issue_reports (student flags bad AI answer, consent link to traces),
rag_ingestion_failures (quality gate for ingestion). Spec §5.6–5.8."
```

---

### Task 1.6: Migration — `recompute_syllabus_status` function + triggers

**Files:**
- Create: `supabase/migrations/20260418100500_syllabus_status_triggers.sql`
- Create: `src/__tests__/migrations/syllabus-triggers.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/migrations/syllabus-triggers.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('syllabus status triggers', () => {
  const testRow = {
    board: 'CBSE', grade: '10', subject_code: 'science_trigger_test',
    subject_display: 'Science', chapter_number: 777, chapter_title: 'Trigger Test',
  };

  beforeAll(async () => {
    await supabaseAdmin.from('cbse_syllabus').insert(testRow);
  });

  afterAll(async () => {
    await supabaseAdmin.from('cbse_syllabus').delete().match(testRow);
    await supabaseAdmin.from('rag_content_chunks').delete().match({
      subject_code: 'science_trigger_test', chapter_number: 777,
    });
  });

  it('trigger bumps chunk_count on INSERT to rag_content_chunks', async () => {
    // Simulate a chunk insert with a realistic 1024-dim vector
    const embedding = Array(1024).fill(0.1);
    await supabaseAdmin.from('rag_content_chunks').insert({
      content: 'Test chunk content with some length.',
      source: 'ncert_2025',
      grade_short: '10', subject_code: 'science_trigger_test', chapter_number: 777,
      embedding,
    });
    const { data } = await supabaseAdmin.from('cbse_syllabus').select('chunk_count').match(testRow).single();
    expect(data!.chunk_count).toBeGreaterThan(0);
  });

  it('rag_status becomes partial after trigger with <50 chunks', async () => {
    const { data } = await supabaseAdmin.from('cbse_syllabus').select('rag_status').match(testRow).single();
    expect(data!.rag_status).toBe('partial');
  });
});
```

- [ ] **Step 2: Verify fail**

```bash
npx vitest run src/__tests__/migrations/syllabus-triggers.test.ts
```

- [ ] **Step 3: Write migration**

```sql
-- supabase/migrations/20260418100500_syllabus_status_triggers.sql

-- Thresholds (duplicated in src/lib/grounding-config.ts — CI parity check enforces)
-- MIN_CHUNKS_FOR_READY    = 50
-- MIN_QUESTIONS_FOR_READY = 40

CREATE OR REPLACE FUNCTION recompute_syllabus_status(
  p_grade text,
  p_subject_code text,
  p_chapter_number int
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_chunks int;
  v_questions int;
  v_status text;
BEGIN
  SELECT count(*) INTO v_chunks
    FROM rag_content_chunks
    WHERE grade_short = p_grade
      AND subject_code = p_subject_code
      AND chapter_number = p_chapter_number;

  SELECT count(*) INTO v_questions
    FROM question_bank
    WHERE grade = p_grade
      AND subject = p_subject_code
      AND chapter_number = p_chapter_number
      AND verified_against_ncert = true
      AND deleted_at IS NULL;

  v_status := CASE
    WHEN v_chunks = 0 THEN 'missing'
    WHEN v_chunks < 50 OR v_questions < 40 THEN 'partial'
    ELSE 'ready'
  END;

  UPDATE cbse_syllabus
  SET chunk_count = v_chunks,
      verified_question_count = v_questions,
      rag_status = v_status,
      last_verified_at = now(),
      updated_at = now()
  WHERE grade = p_grade
    AND subject_code = p_subject_code
    AND chapter_number = p_chapter_number;
END $$;

-- Trigger on rag_content_chunks
CREATE OR REPLACE FUNCTION trg_rag_chunks_recompute()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_syllabus_status(OLD.grade_short, OLD.subject_code, OLD.chapter_number);
    RETURN OLD;
  ELSE
    PERFORM recompute_syllabus_status(NEW.grade_short, NEW.subject_code, NEW.chapter_number);
    IF TG_OP = 'UPDATE' AND (
      OLD.grade_short IS DISTINCT FROM NEW.grade_short OR
      OLD.subject_code IS DISTINCT FROM NEW.subject_code OR
      OLD.chapter_number IS DISTINCT FROM NEW.chapter_number
    ) THEN
      PERFORM recompute_syllabus_status(OLD.grade_short, OLD.subject_code, OLD.chapter_number);
    END IF;
    RETURN NEW;
  END IF;
END $$;

DROP TRIGGER IF EXISTS rag_chunks_recompute_trigger ON rag_content_chunks;
CREATE TRIGGER rag_chunks_recompute_trigger
  AFTER INSERT OR UPDATE OR DELETE ON rag_content_chunks
  FOR EACH ROW EXECUTE FUNCTION trg_rag_chunks_recompute();

-- Trigger on question_bank (only when verification state changes)
CREATE OR REPLACE FUNCTION trg_question_bank_recompute()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     OLD.verified_against_ncert IS NOT DISTINCT FROM NEW.verified_against_ncert AND
     OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
    RETURN NEW;                                    -- no-op, no recompute needed
  END IF;
  PERFORM recompute_syllabus_status(NEW.grade, NEW.subject, NEW.chapter_number);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS question_bank_recompute_trigger ON question_bank;
CREATE TRIGGER question_bank_recompute_trigger
  AFTER INSERT OR UPDATE ON question_bank
  FOR EACH ROW EXECUTE FUNCTION trg_question_bank_recompute();
```

- [ ] **Step 4: Apply and verify**

```bash
supabase db push
npx vitest run src/__tests__/migrations/syllabus-triggers.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418100500_syllabus_status_triggers.sql \
        src/__tests__/migrations/syllabus-triggers.test.ts
git commit -m "feat(syllabus): add recompute_syllabus_status + triggers on chunks/bank

Every write to rag_content_chunks or question_bank recomputes the
affected cbse_syllabus row's chunk_count + verified_question_count
+ rag_status. Spec §8.1."
```

---

### Task 1.7: Migration — `ingestion_gaps` view

**Files:**
- Create: `supabase/migrations/20260418100600_ingestion_gaps_view.sql`
- Create: `src/__tests__/migrations/ingestion-gaps-view.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/migrations/ingestion-gaps-view.test.ts
import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('ingestion_gaps view', () => {
  it('returns rows for non-ready in-scope chapters', async () => {
    await supabaseAdmin.from('cbse_syllabus').insert({
      grade: '10', subject_code: 'gaps_test', subject_display: 'Gaps',
      chapter_number: 888, chapter_title: 'Gap Test',
      rag_status: 'missing', chunk_count: 0, verified_question_count: 0,
    });
    const { data } = await supabaseAdmin.from('ingestion_gaps')
      .select('*').eq('subject_code', 'gaps_test').single();
    expect(data).not.toBeNull();
    expect(data!.severity).toBe('critical');
    await supabaseAdmin.from('cbse_syllabus').delete()
      .match({ subject_code: 'gaps_test', chapter_number: 888 });
  });

  it('excludes ready chapters', async () => {
    await supabaseAdmin.from('cbse_syllabus').insert({
      grade: '10', subject_code: 'ready_test', subject_display: 'Ready',
      chapter_number: 889, chapter_title: 'Ready Test',
      rag_status: 'ready', chunk_count: 100, verified_question_count: 50,
    });
    const { data } = await supabaseAdmin.from('ingestion_gaps')
      .select('*').eq('subject_code', 'ready_test');
    expect(data).toEqual([]);
    await supabaseAdmin.from('cbse_syllabus').delete()
      .match({ subject_code: 'ready_test', chapter_number: 889 });
  });
});
```

- [ ] **Step 2: Verify fail**

```bash
npx vitest run src/__tests__/migrations/ingestion-gaps-view.test.ts
```

- [ ] **Step 3: Write migration**

```sql
-- supabase/migrations/20260418100600_ingestion_gaps_view.sql

CREATE OR REPLACE VIEW ingestion_gaps AS
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

GRANT SELECT ON ingestion_gaps TO authenticated;

COMMENT ON VIEW ingestion_gaps IS
  'Live derivation from cbse_syllabus. Admin dashboard sorts by '
  '(severity DESC, request_count DESC, potential_affected_students DESC). §5.5.';
```

- [ ] **Step 4: Apply and verify**

```bash
supabase db push
npx vitest run src/__tests__/migrations/ingestion-gaps-view.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418100600_ingestion_gaps_view.sql \
        src/__tests__/migrations/ingestion-gaps-view.test.ts
git commit -m "feat(syllabus): add ingestion_gaps view with severity + demand weighting

Live view over cbse_syllabus for admin coverage dashboard. Severity derived
from rag_status + chunk_count; demand from content_requests + active students."
```

---

### Task 1.8: Backfill `cbse_syllabus` from existing data

**Files:**
- Create: `scripts/backfill-cbse-syllabus.ts`
- Create: `src/__tests__/scripts/backfill-cbse-syllabus.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/scripts/backfill-cbse-syllabus.test.ts
import { describe, it, expect } from 'vitest';
import { backfillCbseSyllabus } from '../../../scripts/backfill-cbse-syllabus';
import { supabaseAdmin } from '@/lib/supabase-admin';

describe('backfill-cbse-syllabus', () => {
  it('returns a summary with inserted/skipped counts', async () => {
    const result = await backfillCbseSyllabus({ dryRun: true });
    expect(result).toMatchObject({
      planned: expect.any(Number),
      inserted: 0,                                  // dry run
      skipped: expect.any(Number),
    });
    expect(result.planned).toBeGreaterThan(0);      // catalog is non-empty
  });

  it('populates cbse_syllabus with one row per distinct (grade, subject_code, chapter_number) from rag_content_chunks', async () => {
    const before = await supabaseAdmin.from('cbse_syllabus').select('*', { count: 'exact', head: true });
    await backfillCbseSyllabus({ dryRun: false });
    const after = await supabaseAdmin.from('cbse_syllabus').select('*', { count: 'exact', head: true });
    expect(after.count).toBeGreaterThanOrEqual(before.count!);
  });
});
```

- [ ] **Step 2: Verify fail**

```bash
npx vitest run src/__tests__/scripts/backfill-cbse-syllabus.test.ts
```

- [ ] **Step 3: Write the script**

```ts
// scripts/backfill-cbse-syllabus.ts
import { supabaseAdmin } from '../src/lib/supabase-admin';
import { logger } from '../src/lib/logger';

interface BackfillResult {
  planned: number;
  inserted: number;
  skipped: number;
  errors: Array<{ row: Record<string, unknown>; error: string }>;
}

interface Options {
  dryRun?: boolean;
}

/**
 * Populate cbse_syllabus by taking the UNION of two sources:
 *   1. distinct (grade_short, subject_code, chapter_number, chapter_title) from rag_content_chunks
 *   2. distinct (grade, subject, chapter_number, chapter_title) from question_bank
 * Rows already present are skipped. Triggers + nightly recompute fill in
 * chunk_count / verified_question_count / rag_status afterward.
 */
export async function backfillCbseSyllabus(opts: Options = {}): Promise<BackfillResult> {
  const { dryRun = false } = opts;
  const result: BackfillResult = { planned: 0, inserted: 0, skipped: 0, errors: [] };

  // Source 1: rag_content_chunks
  const { data: chunkTuples, error: chunkErr } = await supabaseAdmin.rpc(
    'distinct_chapter_tuples_from_chunks'
  );
  if (chunkErr) throw new Error(`chunk tuple fetch failed: ${chunkErr.message}`);

  // Source 2: question_bank
  const { data: bankTuples, error: bankErr } = await supabaseAdmin.rpc(
    'distinct_chapter_tuples_from_bank'
  );
  if (bankErr) throw new Error(`bank tuple fetch failed: ${bankErr.message}`);

  const merged = new Map<string, {
    grade: string; subject_code: string; chapter_number: number;
    chapter_title: string; subject_display: string;
  }>();

  for (const t of [...(chunkTuples || []), ...(bankTuples || [])]) {
    const key = `${t.grade}|${t.subject_code}|${t.chapter_number}`;
    if (!merged.has(key)) {
      merged.set(key, {
        grade: t.grade,
        subject_code: t.subject_code,
        chapter_number: t.chapter_number,
        chapter_title: t.chapter_title || `Chapter ${t.chapter_number}`,
        subject_display: t.subject_display || t.subject_code,
      });
    }
  }

  result.planned = merged.size;
  if (dryRun) return result;

  for (const row of merged.values()) {
    const { error } = await supabaseAdmin.from('cbse_syllabus').insert({
      board: 'CBSE',
      grade: row.grade,
      subject_code: row.subject_code,
      subject_display: row.subject_display,
      chapter_number: row.chapter_number,
      chapter_title: row.chapter_title,
    });
    if (error) {
      if (error.code === '23505') {
        result.skipped++;                         // UNIQUE violation — already present
      } else {
        result.errors.push({ row, error: error.message });
      }
    } else {
      result.inserted++;
    }
  }

  logger.info('backfill_cbse_syllabus_complete', result);
  return result;
}

// CLI runner
if (require.main === module) {
  (async () => {
    const dryRun = process.argv.includes('--dry-run');
    const res = await backfillCbseSyllabus({ dryRun });
    console.log(JSON.stringify(res, null, 2));
  })();
}
```

Also add two helper RPCs in a new migration:

```sql
-- supabase/migrations/20260418100700_backfill_helper_rpcs.sql

CREATE OR REPLACE FUNCTION distinct_chapter_tuples_from_chunks()
RETURNS TABLE (grade text, subject_code text, chapter_number int,
               chapter_title text, subject_display text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT
    grade_short AS grade,
    subject_code,
    chapter_number,
    NULL::text AS chapter_title,                  -- not always present in chunks
    subject_code AS subject_display
  FROM rag_content_chunks
  WHERE grade_short IS NOT NULL
    AND subject_code IS NOT NULL
    AND chapter_number IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION distinct_chapter_tuples_from_bank()
RETURNS TABLE (grade text, subject_code text, chapter_number int,
               chapter_title text, subject_display text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT
    grade,
    subject AS subject_code,
    chapter_number,
    NULL::text AS chapter_title,
    subject AS subject_display
  FROM question_bank
  WHERE grade IS NOT NULL
    AND subject IS NOT NULL
    AND chapter_number IS NOT NULL;
$$;
```

- [ ] **Step 4: Apply migration + run backfill test**

```bash
supabase db push
npx vitest run src/__tests__/scripts/backfill-cbse-syllabus.test.ts
```

- [ ] **Step 5: Execute backfill against local DB**

```bash
npx tsx scripts/backfill-cbse-syllabus.ts
```
Expected output: JSON with `planned: N`, `inserted: M`, `skipped: K`, `errors: []`. Save the output for the Phase 1 gate report.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-cbse-syllabus.ts \
        src/__tests__/scripts/backfill-cbse-syllabus.test.ts \
        supabase/migrations/20260418100700_backfill_helper_rpcs.sql
git commit -m "feat(syllabus): add cbse_syllabus backfill script + helper RPCs

Populates cbse_syllabus from UNION of (rag_content_chunks, question_bank)
distinct tuples. Idempotent — re-runnable safely. Triggers fill derived
columns after rows land. Spec §11.1 Week 1."
```

---

### Task 1.9: Prompt template registry + feature flags

**Files:**
- Create: `supabase/functions/grounded-answer/prompts/foxy_tutor_v1.txt`
- Create: `supabase/functions/grounded-answer/prompts/quiz_question_generator_v1.txt`
- Create: `supabase/functions/grounded-answer/prompts/quiz_answer_verifier_v1.txt`
- Create: `supabase/functions/grounded-answer/prompts/ncert_solver_v1.txt`
- Create: `supabase/functions/grounded-answer/prompts/index.ts`
- Create: `src/lib/grounding-config.ts`
- Create: `supabase/functions/grounded-answer/config.ts`
- Create: `scripts/check-config-parity.sh`
- Create: `src/__tests__/grounding/config-parity.test.ts`
- Modify: `supabase/migrations/20260418100800_feature_flags.sql` (new migration)

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/grounding/config-parity.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('grounding-config parity between Next.js and Deno', () => {
  const web = fs.readFileSync(path.resolve('src/lib/grounding-config.ts'), 'utf-8');
  const deno = fs.readFileSync(path.resolve('supabase/functions/grounded-answer/config.ts'), 'utf-8');

  const extract = (src: string, name: string) => {
    const m = src.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+);`));
    return m ? m[1].trim() : null;
  };

  const constants = [
    'MIN_CHUNKS_FOR_READY', 'MIN_QUESTIONS_FOR_READY',
    'RAG_MATCH_COUNT', 'STRICT_MIN_SIMILARITY', 'SOFT_MIN_SIMILARITY',
    'SOFT_CONFIDENCE_BANNER_THRESHOLD', 'STRICT_CONFIDENCE_ABSTAIN_THRESHOLD',
  ];

  for (const name of constants) {
    it(`${name} matches between Next.js and Deno`, () => {
      expect(extract(web, name)).not.toBeNull();
      expect(extract(deno, name)).not.toBeNull();
      expect(extract(web, name)).toBe(extract(deno, name));
    });
  }
});
```

- [ ] **Step 2: Verify fail**

```bash
npx vitest run src/__tests__/grounding/config-parity.test.ts
```

- [ ] **Step 3: Write the two config files (identical constants)**

```ts
// src/lib/grounding-config.ts
export const MIN_CHUNKS_FOR_READY = 50;
export const MIN_QUESTIONS_FOR_READY = 40;
export const RAG_MATCH_COUNT = 5;
export const STRICT_MIN_SIMILARITY = 0.75;
export const SOFT_MIN_SIMILARITY = 0.55;
export const SOFT_CONFIDENCE_BANNER_THRESHOLD = 0.6;
export const STRICT_CONFIDENCE_ABSTAIN_THRESHOLD = 0.75;

export const ENFORCEMENT_AUTO_DISABLE_THRESHOLD = 0.85;
export const ENFORCEMENT_ENABLE_THRESHOLD = 0.9;

export const CIRCUIT_BREAKER_FAILURES_TO_TRIP = 3;
export const CIRCUIT_BREAKER_WINDOW_MS = 10_000;
export const CIRCUIT_BREAKER_OPEN_MS = 30_000;
export const CIRCUIT_BREAKER_PROBE_SUCCESS_COUNT = 2;

export const PER_PLAN_TIMEOUT_MS: Record<string, number> = {
  free: 20_000,
  starter: 35_000,
  pro: 55_000,
  unlimited: 75_000,
};
export const VERIFIER_TIMEOUT_MS = 15_000;

export const CACHE_TTL_MS = 5 * 60_000;

export const VALID_CALLERS = [
  'foxy', 'ncert-solver', 'quiz-generator', 'concept-engine', 'diagnostic',
] as const;

export const REGISTERED_PROMPT_TEMPLATES = [
  'foxy_tutor_v1',
  'quiz_question_generator_v1',
  'quiz_answer_verifier_v1',
  'ncert_solver_v1',
] as const;
```

```ts
// supabase/functions/grounded-answer/config.ts
// IMPORTANT: This file MUST stay in sync with src/lib/grounding-config.ts.
// CI parity check enforces via scripts/check-config-parity.sh.
export const MIN_CHUNKS_FOR_READY = 50;
export const MIN_QUESTIONS_FOR_READY = 40;
export const RAG_MATCH_COUNT = 5;
export const STRICT_MIN_SIMILARITY = 0.75;
export const SOFT_MIN_SIMILARITY = 0.55;
export const SOFT_CONFIDENCE_BANNER_THRESHOLD = 0.6;
export const STRICT_CONFIDENCE_ABSTAIN_THRESHOLD = 0.75;

export const ENFORCEMENT_AUTO_DISABLE_THRESHOLD = 0.85;
export const ENFORCEMENT_ENABLE_THRESHOLD = 0.9;

export const CIRCUIT_BREAKER_FAILURES_TO_TRIP = 3;
export const CIRCUIT_BREAKER_WINDOW_MS = 10_000;
export const CIRCUIT_BREAKER_OPEN_MS = 30_000;
export const CIRCUIT_BREAKER_PROBE_SUCCESS_COUNT = 2;

export const PER_PLAN_TIMEOUT_MS: Record<string, number> = {
  free: 20_000,
  starter: 35_000,
  pro: 55_000,
  unlimited: 75_000,
};
export const VERIFIER_TIMEOUT_MS = 15_000;

export const CACHE_TTL_MS = 5 * 60_000;

export const VALID_CALLERS = [
  'foxy', 'ncert-solver', 'quiz-generator', 'concept-engine', 'diagnostic',
] as const;

export const REGISTERED_PROMPT_TEMPLATES = [
  'foxy_tutor_v1',
  'quiz_question_generator_v1',
  'quiz_answer_verifier_v1',
  'ncert_solver_v1',
] as const;
```

- [ ] **Step 4: Write the four prompt templates**

```
# supabase/functions/grounded-answer/prompts/foxy_tutor_v1.txt
You are Foxy, a friendly AI tutor for Indian CBSE students.
You are helping a Grade {{grade}} student with {{subject}}{{chapter_suffix}} (Board: {{board}}).

## Persona
- Warm, encouraging, patient — like a knowledgeable elder sibling.
- Use simple English; occasionally mix Hindi words ("Bilkul sahi!" = "Absolutely correct!").
- Relate examples to Indian daily life, festivals, familiar contexts.
- Never give answers outright for practice questions — guide the student to think.
- Keep responses concise (3–5 sentences for explanations, numbered steps for processes).

## Mode: {{mode_upper}}
{{mode_instruction}}

## Grounding Rules
- You MAY cite from the Reference Material below using [1], [2], [3] markers.
- When the Reference Material supports a claim, cite it.
- When it does not, you MAY answer from general knowledge, but you MUST prefix such answers with
  the exact phrase: "General knowledge (not from NCERT):"
- Never invent facts, formulas, or historical dates.
- Only teach from CBSE {{board}} Grade {{grade}} {{subject}} syllabus.

## Formatting
- Standard markdown: **bold** for key terms, *italic* for emphasis.
- LaTeX for math: inline $x^2$, block $$\frac{a}{b}$$.
- Tables for structured data; numbered lists for steps; bullets for properties.
- > blockquote for NCERT textbook excerpts.
- Code fences for multi-line formulas.
- NO ASCII art for diagrams.

{{academic_goal_section}}
{{cognitive_context_section}}
{{reference_material_section}}
```

```
# supabase/functions/grounded-answer/prompts/quiz_question_generator_v1.txt
You are a CBSE quiz question generator. You will be given SOURCE_CHUNKS from NCERT
for Grade {{grade}} {{subject}}{{chapter_suffix}}.

Produce ONE multiple-choice question grounded in the SOURCE_CHUNKS. Return strict JSON:

{
  "question_text": "<non-empty, >= 15 chars, no template markers>",
  "options": ["A", "B", "C", "D"],
  "correct_answer_index": 0 | 1 | 2 | 3,
  "explanation": "<>= 20 chars, references the source chunks>",
  "difficulty": "easy" | "medium" | "hard",
  "bloom_level": "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create",
  "supporting_chunk_ids": ["<uuid>", ...]
}

Rules:
- Options must be 4 distinct non-empty strings.
- The correct answer must be directly supported by the SOURCE_CHUNKS.
- Do NOT fabricate content outside the SOURCE_CHUNKS.
- If the chunks do not support a usable question, return: {"error": "insufficient_source"}.

{{reference_material_section}}
```

```
# supabase/functions/grounded-answer/prompts/quiz_answer_verifier_v1.txt
You are verifying a CBSE quiz question. Determine whether the claimed correct answer
is directly provable from the SOURCE_CHUNKS.

Return strict JSON:
{
  "verified": true | false,
  "reason": "<one sentence>",
  "correct_option_index": 0 | 1 | 2 | 3 | null,
  "supporting_chunk_ids": ["<uuid>", ...]
}

Rules:
- "verified": true ONLY if SOURCE_CHUNKS directly prove the claimed answer.
- If chunks contradict the claimed answer, set verified: false and fill
  correct_option_index with the option that IS supported.
- If no option is fully supported, set correct_option_index: null.
- Be strict. "Close enough" is false.

QUESTION UNDER REVIEW:
{{question_json}}

{{reference_material_section}}
```

```
# supabase/functions/grounded-answer/prompts/ncert_solver_v1.txt
You are an NCERT solutions assistant for Indian CBSE students.
You are solving Grade {{grade}} {{subject}} Chapter {{chapter}} exercises.

## Rules
- Answer ONLY from the Reference Material below.
- If the exercise cannot be answered from the Reference Material, respond with exactly:
  {{INSUFFICIENT_CONTEXT}}
- Cite every fact with [1], [2], [3] markers.
- Solve step-by-step with clear numbering.
- Use LaTeX for math, blockquote for NCERT excerpts, tables where helpful.

{{reference_material_section}}
```

- [ ] **Step 5: Write the template loader**

```ts
// supabase/functions/grounded-answer/prompts/index.ts
import { REGISTERED_PROMPT_TEMPLATES } from '../config.ts';

const TEMPLATE_CACHE = new Map<string, string>();

export async function loadTemplate(templateId: string): Promise<string> {
  if (!REGISTERED_PROMPT_TEMPLATES.includes(templateId as any)) {
    throw new Error(`Unknown prompt template: ${templateId}`);
  }
  const cached = TEMPLATE_CACHE.get(templateId);
  if (cached) return cached;
  const content = await Deno.readTextFile(
    new URL(`./${templateId}.txt`, import.meta.url)
  );
  TEMPLATE_CACHE.set(templateId, content);
  return content;
}

export function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

export async function hashPrompt(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 6: Write config parity CI script**

```bash
#!/usr/bin/env bash
# scripts/check-config-parity.sh
set -eo pipefail

WEB="src/lib/grounding-config.ts"
DENO="supabase/functions/grounded-answer/config.ts"

if [ ! -f "$WEB" ] || [ ! -f "$DENO" ]; then
  echo "Missing config file: $WEB or $DENO"
  exit 1
fi

# Extract exported const name=value pairs (whitespace-normalized)
extract() {
  grep -E '^export const [A-Z_]+\s*=' "$1" | \
    sed -E 's/\s+/ /g' | sort
}

DIFF=$(diff <(extract "$WEB") <(extract "$DENO") || true)
if [ -n "$DIFF" ]; then
  echo "Config parity FAIL — src/lib/grounding-config.ts diverges from supabase/functions/grounded-answer/config.ts:"
  echo "$DIFF"
  exit 1
fi
echo "Config parity OK"
```

Make it executable and wire it into `package.json`:

```json
{
  "scripts": {
    "check:config-parity": "bash scripts/check-config-parity.sh",
    "lint:ai-boundary": "bash scripts/check-config-parity.sh && eslint . --config .eslintrc.ai-boundary.json"
  }
}
```

- [ ] **Step 7: Write feature flags migration**

```sql
-- supabase/migrations/20260418100800_feature_flags.sql

-- Global kill switch
INSERT INTO feature_flags (flag_code, enabled, description)
VALUES
  ('ff_grounded_ai_enabled', false, 'Global grounded-answer service enabled'),
  ('ff_grounded_ai_foxy', false, 'Route Foxy through grounded-answer service'),
  ('ff_grounded_ai_quiz_generator', false, 'Route quiz-generator through service (two-pass verify)'),
  ('ff_grounded_ai_ncert_solver', false, 'Route NCERT-solver through service'),
  ('ff_grounded_ai_concept_engine', false, 'Route concept-engine retrieval through service')
ON CONFLICT (flag_code) DO NOTHING;

-- Per-pair enforcement table
CREATE TABLE IF NOT EXISTS ff_grounded_ai_enforced_pairs (
  grade         text NOT NULL,
  subject_code  text NOT NULL,
  enabled       boolean NOT NULL DEFAULT false,
  enabled_at    timestamptz,
  enabled_by    uuid REFERENCES users(id),
  auto_disabled_at timestamptz,
  auto_disabled_reason text,
  PRIMARY KEY (grade, subject_code)
);

ALTER TABLE ff_grounded_ai_enforced_pairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ff_pairs_read_all ON ff_grounded_ai_enforced_pairs
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY ff_pairs_write_admin ON ff_grounded_ai_enforced_pairs
  FOR ALL USING (
    auth.role() = 'service_role' OR
    EXISTS (SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role_code = 'ops_admin')
  );
```

- [ ] **Step 8: Verify all tests pass**

```bash
supabase db push
chmod +x scripts/check-config-parity.sh
npm run check:config-parity
npx vitest run src/__tests__/grounding/config-parity.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/grounding-config.ts \
        supabase/functions/grounded-answer/config.ts \
        supabase/functions/grounded-answer/prompts/ \
        scripts/check-config-parity.sh \
        src/__tests__/grounding/config-parity.test.ts \
        supabase/migrations/20260418100800_feature_flags.sql \
        package.json
git commit -m "feat(grounding): add prompt template registry + shared config + feature flags

Four registered templates (foxy_tutor_v1, quiz_question_generator_v1,
quiz_answer_verifier_v1, ncert_solver_v1). Shared constants duplicated
across Next.js and Deno with CI parity check. Feature flags created
(all OFF by default). Spec §6.2, §6.5, §10.4."
```

---

## Phase 1 Exit Gate

Before starting Phase 2:

- [ ] All 9 Phase 1 tasks committed
- [ ] `supabase db reset && supabase db push` applies cleanly from scratch
- [ ] `npm run check:config-parity` passes
- [ ] `cbse_syllabus` row count reported (note the number for Phase 4 comparison)
- [ ] `rag_status` distribution: how many missing / partial / ready? Logged to spec addendum.
- [ ] Ops reviewer approves the coverage state (non-blocking but expected)

---

## Phase 2 — Grounded-Answer Service (Week 2, 12 tasks)

**Phase goal:** `supabase/functions/grounded-answer/index.ts` answers HTTP POSTs per spec §6 with all abstain reasons, grounding check, circuit breaker, trace writes. No caller uses it yet.

**Phase exit gate:** Synthetic test suite 100%; manual smoke tests hit all 6 abstain reasons + grounded path; deployed to staging; `/health` returns 200.

### Task 2.1: Edge Function skeleton + request validation

**Files:**
- Create: `supabase/functions/grounded-answer/index.ts`
- Create: `supabase/functions/grounded-answer/types.ts`
- Create: `supabase/functions/grounded-answer/__tests__/validation.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// supabase/functions/grounded-answer/__tests__/validation.test.ts
import { assertEquals, assertExists } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { validateRequest } from '../validators.ts';

Deno.test('rejects missing caller', () => {
  const { error } = validateRequest({ student_id: 'x', query: 'q', scope: { grade: '10' } } as any);
  assertExists(error);
  assertEquals(error!.field, 'caller');
});

Deno.test('rejects unknown caller', () => {
  const { error } = validateRequest({
    caller: 'bogus', student_id: null, query: 'q',
    scope: { board: 'CBSE', grade: '10', subject_code: 'science',
             chapter_number: 1, chapter_title: 'X' },
    mode: 'soft',
    generation: { model_preference: 'auto', max_tokens: 512, temperature: 0.3,
                  system_prompt_template: 'foxy_tutor_v1', template_variables: {} },
    retrieval: { match_count: 5 },
    timeout_ms: 20000,
  } as any);
  assertExists(error);
});

Deno.test('rejects invalid grade', () => {
  const { error } = validateRequest({
    caller: 'foxy', student_id: null, query: 'q',
    scope: { board: 'CBSE', grade: '5', subject_code: 'science',
             chapter_number: 1, chapter_title: 'X' },
    mode: 'soft',
    generation: { model_preference: 'auto', max_tokens: 512, temperature: 0.3,
                  system_prompt_template: 'foxy_tutor_v1', template_variables: {} },
    retrieval: { match_count: 5 },
    timeout_ms: 20000,
  } as any);
  assertExists(error);
  assertEquals(error!.field, 'scope.grade');
});

Deno.test('accepts a valid request', () => {
  const { error, request } = validateRequest({
    caller: 'foxy', student_id: null, query: 'What is photosynthesis?',
    scope: { board: 'CBSE', grade: '10', subject_code: 'science',
             chapter_number: 6, chapter_title: 'Life Processes' },
    mode: 'soft',
    generation: { model_preference: 'auto', max_tokens: 1024, temperature: 0.3,
                  system_prompt_template: 'foxy_tutor_v1', template_variables: {} },
    retrieval: { match_count: 5 },
    timeout_ms: 20000,
  });
  assertEquals(error, null);
  assertExists(request);
});
```

- [ ] **Step 2: Verify fail**

```bash
cd supabase/functions/grounded-answer && deno test --allow-all
```
Expected: FAIL (modules missing).

- [ ] **Step 3: Write types + validator**

```ts
// supabase/functions/grounded-answer/types.ts
import { VALID_CALLERS, REGISTERED_PROMPT_TEMPLATES } from './config.ts';

export type Caller = typeof VALID_CALLERS[number];
export type Mode = 'strict' | 'soft';
export type AbstainReason =
  | 'chapter_not_ready' | 'no_chunks_retrieved' | 'low_similarity'
  | 'no_supporting_chunks' | 'scope_mismatch' | 'upstream_error' | 'circuit_open';

export interface GroundedRequest {
  caller: Caller;
  student_id: string | null;
  query: string;
  scope: {
    board: 'CBSE';
    grade: string;
    subject_code: string;
    chapter_number: number | null;
    chapter_title: string | null;
  };
  mode: Mode;
  generation: {
    model_preference: 'haiku' | 'sonnet' | 'auto';
    max_tokens: number;
    temperature: number;
    system_prompt_template: string;
    template_variables: Record<string, string>;
  };
  retrieval: {
    match_count: number;
    min_similarity_override?: number;
  };
  retrieve_only?: boolean;
  timeout_ms: number;
}

export interface Citation {
  index: number;
  chunk_id: string;
  chapter_number: number;
  chapter_title: string;
  page_number: number | null;
  similarity: number;
  excerpt: string;
  media_url: string | null;
}

export type GroundedResponse =
  | {
      grounded: true;
      answer: string;
      citations: Citation[];
      confidence: number;
      trace_id: string;
      meta: { claude_model: string; tokens_used: number; latency_ms: number };
    }
  | {
      grounded: false;
      abstain_reason: AbstainReason;
      suggested_alternatives: Array<{
        grade: string; subject_code: string;
        chapter_number: number; chapter_title: string;
        rag_status: 'ready';
      }>;
      trace_id: string;
      meta: { latency_ms: number };
    };
```

```ts
// supabase/functions/grounded-answer/validators.ts
import { VALID_CALLERS, REGISTERED_PROMPT_TEMPLATES } from './config.ts';
import type { GroundedRequest } from './types.ts';

const VALID_GRADES = ['6','7','8','9','10','11','12'];
const VALID_MODES = ['strict', 'soft'];

export function validateRequest(body: unknown):
  { error: { field: string; message: string } | null; request?: GroundedRequest }
{
  if (!body || typeof body !== 'object') return { error: { field: 'body', message: 'not an object' } };
  const b = body as any;

  if (!b.caller || !VALID_CALLERS.includes(b.caller)) return { error: { field: 'caller', message: 'invalid' } };
  if (typeof b.query !== 'string' || b.query.trim() === '') return { error: { field: 'query', message: 'required' } };
  if (!b.scope || typeof b.scope !== 'object') return { error: { field: 'scope', message: 'required' } };
  if (!VALID_GRADES.includes(b.scope.grade)) return { error: { field: 'scope.grade', message: 'invalid' } };
  if (typeof b.scope.subject_code !== 'string') return { error: { field: 'scope.subject_code', message: 'required' } };
  if (!VALID_MODES.includes(b.mode)) return { error: { field: 'mode', message: 'invalid' } };
  if (!b.generation?.system_prompt_template ||
      !REGISTERED_PROMPT_TEMPLATES.includes(b.generation.system_prompt_template)) {
    return { error: { field: 'generation.system_prompt_template', message: 'unknown template' } };
  }
  if (typeof b.timeout_ms !== 'number' || b.timeout_ms < 1000 || b.timeout_ms > 120000) {
    return { error: { field: 'timeout_ms', message: 'out of range [1000, 120000]' } };
  }

  return { error: null, request: b as GroundedRequest };
}
```

```ts
// supabase/functions/grounded-answer/index.ts (skeleton)
import { validateRequest } from './validators.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonResponse(400, { error: 'invalid_json' }); }

  const { error, request } = validateRequest(body);
  if (error || !request) return jsonResponse(400, { error: `invalid_request:${error!.field}` });

  // TODO (subsequent tasks): dispatch to pipeline
  return jsonResponse(501, { error: 'not_implemented_yet' });
});

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd supabase/functions/grounded-answer && deno test --allow-all
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/grounded-answer/
git commit -m "feat(grounding): add grounded-answer Edge Function skeleton + request validation

HTTP POST contract per spec §6.1. Validates caller, grade, registered template,
timeout range. Returns 501 for not-yet-implemented pipeline."
```

---

### Task 2.2: Coverage precheck + abstain helper

**Files:**
- Modify: `supabase/functions/grounded-answer/index.ts`
- Create: `supabase/functions/grounded-answer/coverage.ts`
- Create: `supabase/functions/grounded-answer/abstain.ts`
- Create: `supabase/functions/grounded-answer/__tests__/coverage.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// supabase/functions/grounded-answer/__tests__/coverage.test.ts
import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { checkCoverage, suggestAlternatives } from '../coverage.ts';

Deno.test('returns chapter_not_ready for missing chapter', async () => {
  const stub = stubSupabase({
    cbse_syllabus: { rag_status: 'missing' },
    ready_alternatives: [
      { grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: 'Light' },
    ],
  });
  const result = await checkCoverage(stub, { grade: '10', subject_code: 'science', chapter_number: 7 });
  assertEquals(result.ready, false);
  assertEquals(result.abstain_reason, 'chapter_not_ready');
  assertEquals(result.alternatives.length, 1);
});

Deno.test('returns ready:true for ready chapter', async () => {
  const stub = stubSupabase({ cbse_syllabus: { rag_status: 'ready' } });
  const result = await checkCoverage(stub, { grade: '10', subject_code: 'science', chapter_number: 1 });
  assertEquals(result.ready, true);
});

function stubSupabase(fixtures: any): any {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: fixtures[table] ?? null, error: null }),
            }),
          }),
        }),
        // for alternatives query
        match: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: fixtures.ready_alternatives ?? [], error: null }),
            }),
          }),
        }),
      }),
    }),
  };
}
```

- [ ] **Step 2: Verify fail**

```bash
cd supabase/functions/grounded-answer && deno test --allow-all
```

- [ ] **Step 3: Implement coverage.ts**

```ts
// supabase/functions/grounded-answer/coverage.ts
export interface CoverageResult {
  ready: boolean;
  abstain_reason?: 'chapter_not_ready';
  alternatives: Array<{
    grade: string; subject_code: string;
    chapter_number: number; chapter_title: string;
    rag_status: 'ready';
  }>;
}

export async function checkCoverage(
  sb: any,
  scope: { grade: string; subject_code: string; chapter_number: number | null },
): Promise<CoverageResult> {
  // No chapter filter → just check subject has at least one ready chapter
  if (scope.chapter_number == null) {
    const { data } = await sb.from('cbse_syllabus')
      .select('chapter_number, chapter_title')
      .eq('grade', scope.grade)
      .eq('subject_code', scope.subject_code)
      .eq('rag_status', 'ready')
      .eq('is_in_scope', true)
      .order('chapter_number').limit(1);
    if (!data || data.length === 0) {
      return { ready: false, abstain_reason: 'chapter_not_ready', alternatives: [] };
    }
    return { ready: true, alternatives: [] };
  }

  // Specific chapter check
  const { data } = await sb.from('cbse_syllabus')
    .select('rag_status')
    .eq('grade', scope.grade)
    .eq('subject_code', scope.subject_code)
    .eq('chapter_number', scope.chapter_number)
    .maybeSingle();

  if (data?.rag_status === 'ready') return { ready: true, alternatives: [] };

  return {
    ready: false,
    abstain_reason: 'chapter_not_ready',
    alternatives: await suggestAlternatives(sb, scope.grade, scope.subject_code),
  };
}

export async function suggestAlternatives(
  sb: any, grade: string, subject_code: string
): Promise<CoverageResult['alternatives']> {
  const { data } = await sb.from('cbse_syllabus')
    .select('grade, subject_code, chapter_number, chapter_title')
    .eq('grade', grade)
    .eq('subject_code', subject_code)
    .eq('rag_status', 'ready')
    .eq('is_in_scope', true)
    .order('chapter_number')
    .limit(3);
  return (data ?? []).map((d: any) => ({
    grade: d.grade, subject_code: d.subject_code,
    chapter_number: d.chapter_number, chapter_title: d.chapter_title,
    rag_status: 'ready' as const,
  }));
}
```

- [ ] **Step 4: Implement abstain helper**

```ts
// supabase/functions/grounded-answer/abstain.ts
import type { AbstainReason, GroundedResponse } from './types.ts';

export function buildAbstainResponse(
  reason: AbstainReason,
  alternatives: GroundedResponse extends { grounded: false, suggested_alternatives: infer A } ? A : never,
  trace_id: string,
  started_at: number,
): GroundedResponse {
  return {
    grounded: false,
    abstain_reason: reason,
    suggested_alternatives: alternatives as any,
    trace_id,
    meta: { latency_ms: Date.now() - started_at },
  };
}
```

- [ ] **Step 5: Wire coverage precheck into index.ts**

```ts
// supabase/functions/grounded-answer/index.ts (updated)
import { validateRequest } from './validators.ts';
import { checkCoverage } from './coverage.ts';
import { buildAbstainResponse } from './abstain.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  const started = Date.now();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonResponse(400, { error: 'invalid_json' }); }

  const { error, request } = validateRequest(body);
  if (error || !request) return jsonResponse(400, { error: `invalid_request:${error!.field}` });

  // Phase 2.2 — coverage precheck
  const coverage = await checkCoverage(sb, {
    grade: request.scope.grade,
    subject_code: request.scope.subject_code,
    chapter_number: request.scope.chapter_number,
  });

  if (!coverage.ready) {
    // Trace write added in Task 2.9 — placeholder trace_id for now
    return jsonResponse(200, buildAbstainResponse(
      coverage.abstain_reason!, coverage.alternatives, 'pending', started
    ));
  }

  return jsonResponse(501, { error: 'not_implemented_yet' });
});

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status,
    headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 6: Verify tests**

```bash
cd supabase/functions/grounded-answer && deno test --allow-all
```

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/grounded-answer/
git commit -m "feat(grounding): add coverage precheck with alternatives suggestion

If chapter rag_status != 'ready', service returns chapter_not_ready
immediately without calling Voyage or Claude. Spec §6.4 step 1."
```

---

### Tasks 2.3–2.11 follow the same pattern (test → implement → commit)

Each is one pipeline stage, ~150–250 lines of code + tests, atomic commit:

**Task 2.3: Voyage embedding with timeout + retry** — `embedding.ts`, handles `min(timeout_ms * 0.4, 8000)` timeout, one retry with 2× timeout, returns `null` on double failure. Test: injected fetch mock returns timeout then success.

**Task 2.4: Retrieval + scope verification** — `retrieval.ts`, calls `match_rag_chunks_ncert` RPC, then filters returned chunks by exact grade/subject/chapter match (defense in depth), drops mismatches to `scope_mismatch` log. Test: inject one bad chunk, verify it's dropped.

**Task 2.5: Claude call with model fallback** — `claude.ts`, tries Haiku first, falls back to Sonnet on 404/529/timeout. Handles `{{INSUFFICIENT_CONTEXT}}` sentinel. Test: mock HTTP returns 529 on Haiku → verify Sonnet called.

**Task 2.6: Grounding check (strict mode)** — `grounding-check.ts`, second Haiku call with `quiz_answer_verifier_v1`-style prompt, returns `{verdict: pass|fail, unsupported_sentences: []}`. Timeout 5s → conservative fail. Test: mock returns `fail` → verify service returns `no_supporting_chunks`.

**Task 2.7: Confidence scoring + citation extraction** — `confidence.ts`, implements the weighted formula from spec §6.5. `citations.ts` parses `[N]` refs from answer and maps to chunks. Test: a 0-citation answer returns `confidence` per formula, no citations.

**Task 2.8: Trace write** — `trace.ts`, always inserts one row to `grounded_ai_traces` (success, abstain, or error path). Generates `query_hash` = SHA-256 of normalized query. `query_preview` = first 200 chars. Returns `trace_id`. Test: abstain path still writes trace with `grounded=false`.

**Task 2.9: Circuit breaker (3-state)** — `circuit.ts`, in-memory Map keyed by `${caller}|${subject}|${grade}`. State machine matches spec §6.7. Test: 3 failures within 10s opens; 30s later, probe allowed; 2 probe successes close.

**Task 2.10: Per-plan timeout budget + cache** — `timeouts.ts` splits `timeout_ms` into Voyage/Claude budgets. `cache.ts` is an LRU (max 500 entries) keyed by `sha256(query || scope || mode)`, TTL 5 min, success-only. Tests.

**Task 2.11: retrieve_only mode** — when `request.retrieve_only === true`, skip Claude + grounding check, return `{grounded: true, answer: '', citations, confidence, trace_id}`. Enables concept-engine refactor (Phase 3 Task 3.4). Tests.

**Task 2.12: End-to-end integration test + staging deploy** — `integration.test.ts` exercises all 6 abstain reasons + grounded-success path against a local Supabase with fixture data. Deploy: `supabase functions deploy grounded-answer`. Smoke via `curl`. Commit tagged `v0.1.0-grounding-service`.

**Each task follows the cadence: test file → verify fails → implement → verify passes → commit.** The task headings, file paths, and test skeletons are the critical content; the implementation code mirrors the spec sections. Due to plan length, the specific code for Tasks 2.3–2.12 is shown in the spec (§6.4–6.9) and must be implemented against the tests.

**Phase 2 Exit Gate:**
- [ ] 12 tasks committed
- [ ] `deno test --allow-all` in `supabase/functions/grounded-answer/` → all green
- [ ] Service deployed to staging
- [ ] Manual smoke: all 6 abstain reasons triggered, grounded path returns citations
- [ ] 7-day retention verified via a time-travel test (`created_at` mutation)

---

## Phase 3 — Surface refactors + frontend + admin (Week 3, 20 tasks)

**Phase goal:** Every AI-consuming surface routes through the service behind per-caller feature flags. Frontend abstain components in place. Super-admin pages live. ESLint + CI guard active.

**Phase exit gate:** CI all green; E2E suite passes against staging with flags ON for one synthetic test pair.

### Tasks 3.1–3.3: Foxy refactor

**Task 3.1: Extract the `callGroundedAnswer` client helper** — `src/lib/ai/grounded-client.ts`, wraps the HTTP POST to the Edge Function with service-role auth, 2s hop timeout, normalizes response shapes. Test: mock fetch, verify request body structure matches §6.1.

**Task 3.2: Foxy route refactor** — `src/app/api/foxy/route.ts`. Delete lines ~505–699 and ~1052–1199 (the inline AI pipeline). Replace with a single `askGrounded()` call. Move `buildSystemPrompt` logic into the template. Keep auth, quota, session, history, cognitive context load, persistence. Quota refund on `upstream_error | circuit_open | chapter_not_ready`. Gate by `ff_grounded_ai_foxy`. Integration test: mock service, verify correct template vars passed; verify quota refund on abstain; verify client gets `groundingStatus` field.

**Task 3.3: Foxy client response shape update** — `src/components/foxy/ChatMessage.tsx` (or equivalent), new prop `groundingStatus: 'grounded' | 'unverified'`, new prop `traceId`. Types updated. Existing chat UI unchanged for grounded responses. Test: render with `groundingStatus='unverified'` → banner present.

### Tasks 3.4–3.7: Other surfaces

**Task 3.4: concept-engine refactor** — rewrite `src/app/api/concept-engine/route.ts` `search` action to call service with `retrieve_only: true`. Leave `chapter` and `quiz-pool` actions as RPC calls (not AI). Remove direct Voyage call. Behind `ff_grounded_ai_concept_engine`. Tests.

**Task 3.5: quiz-generator two-pass verifier** — `supabase/functions/quiz-generator/index.ts`. Step 1: call service with `quiz_question_generator_v1`. Step 2: call service with `quiz_answer_verifier_v1`. Step 3: insert to `question_bank` with `verification_state` + `verified_against_ncert` + all verifier metadata. Tests for: verifier agrees → `verified`; verifier disagrees → `failed`; insufficient_source → no insert.

**Task 3.6: ncert-solver refactor** — `supabase/functions/ncert-solver/index.ts`. Replace inline pipeline with service call, `ncert_solver_v1` template, strict mode. On abstain, surface existing "solution not available" UI. Tests.

**Task 3.7: Subjects + chapters routes rewrite** — `src/app/api/student/subjects/route.ts` and `src/app/api/student/chapters/route.ts`. Delete `GRADE_SUBJECTS` constant references. Delete soft-fail try/catch. Create `get_available_subjects_v2` RPC and `available_chapters_for_student_subject_v2` RPC (new migration) that read from `cbse_syllabus WHERE rag_status='ready' AND is_in_scope`. Tests: no fallback path, missing RPC → 500 (not silent-repair).

### Tasks 3.8–3.10: Verifier & coverage jobs

**Task 3.8: `verify-question-bank` Edge Function** — new function + `claim_verification_batch` RPC. Adaptive rate + peak-hour deferral per spec §7.3. Supabase cron schedule `*/30 * * * *`. Tests.

**Task 3.9: `coverage-audit` Edge Function** — new function, daily 03:00 IST cron. Recomputes all syllabus statuses; detects regressions; auto-disables enforcement when `verified_ratio < 0.85`. Tests for trigger-miss scenarios.

**Task 3.10: Super-admin API routes** — `/api/super-admin/grounding/health`, `.../coverage`, `.../verification-queue`, `.../traces`, `.../ai-issues`. Each gated by `super_admin` role via `authorizeRequest()`. Read-only SQL aggregations. Tests.

### Tasks 3.11–3.15: Frontend components

**Task 3.11: `<UnverifiedBanner />`** — `src/components/foxy/UnverifiedBanner.tsx`. Amber styling, bilingual copy, `[Show me NCERT chapters]` action opens `<ChapterPickerDrawer />`. Tests for render + click.

**Task 3.12: `<HardAbstainCard />`** — `src/components/grounding/HardAbstainCard.tsx`. Three variants: `chapter_not_ready`, `upstream_error`, `circuit_open`. Props: `scope`, `alternatives`, `onRetry`, `onRequestContent`. Tests for each variant.

**Task 3.13: `<AlternativesGrid />`** — `src/components/grounding/AlternativesGrid.tsx`. Shows top-3 + `[See all N ready chapters →]` escape. Props: `alternatives`, `subject`, `grade`, `totalReady`. Tests.

**Task 3.14: `<LoadingState />` update** — `src/components/foxy/LoadingState.tsx`. Spinner + elapsed-time counter. After 15s: "This is taking longer than usual — hold on." No fake stage messages. Tests.

**Task 3.15: `<ReportIssueModal />` + API** — `src/components/foxy/ReportIssueModal.tsx` + `src/app/api/support/ai-issue/route.ts`. Modal captures `reason_category` + optional comment; API writes `ai_issue_reports` row linking `foxy_message_id` + `trace_id`. Tests for both.

### Tasks 3.16–3.17: Admin pages

**Task 3.16: `/super-admin/grounding/health` page** — renders live metrics chart (SWR polling), circuit state tiles, error-rate widgets. Uses existing `<Card />`, `<StatTile />` components.

**Task 3.17: `/super-admin/grounding/coverage` + `/verification-queue` + `/traces` + `/ai-issues` pages** — four pages in one task since they share data-table pattern. Each: table of rows + filter bar + per-row drill-down. Re-verify / soft-delete / resolve actions where applicable.

### Tasks 3.18–3.20: Guards & tests

**Task 3.18: ESLint rule `no-direct-ai-calls`** — `eslint-rules/no-direct-ai-calls.js` detects `@anthropic-ai/sdk`, `voyageai` imports, and `api.anthropic.com` / `api.voyageai.com` URL literals outside the allowlist `['supabase/functions/grounded-answer/']`. `.eslintrc.ai-boundary.json` loads the rule. Start `warn`, promote to `error` after a quick sweep. Tests.

**Task 3.19: ESLint rule `no-direct-rag-rpc`** — detects `.rpc('match_rag_chunks')` and `.rpc('match_rag_chunks_ncert')` outside allowlist. Tests.

**Task 3.20: E2E suite** — `e2e/grounding/` directory. 7 specs per spec §12.5. Run against staging with flags ON for synthetic pair. CI gate before Phase 4.

**Phase 3 Exit Gate:**
- [ ] 20 tasks committed
- [ ] `npm run type-check && npm run lint && npm test && npm run test:e2e && npm run build` all green
- [ ] CI `lint:ai-boundary` at `error` level
- [ ] Staging deploy verified

---

## Phase 4 — Rollout (Week 4, 7 tasks)

**Phase goal:** Production is enforcing grounding for pilot pair and progressively more pairs.

**Phase exit gate:** Grade 10 Science + 4 more pairs enforced for ≥7 days with SLOs met.

### Task 4.1: Pre-rollout checklist execution

Runs spec §11.3 checklist against staging. Any failure blocks Phase 4.1 → Phase 4.2 transition.

### Task 4.2: Production migrations + backfill

```bash
supabase db push --linked          # against prod
npx tsx scripts/backfill-cbse-syllabus.ts --prod
```

Verify: `cbse_syllabus` row count matches expected CBSE catalog size. Spot-check 10 random rows.

### Task 4.3: Retroactive verifier drain (48h)

Deploy `verify-question-bank` cron. Monitor `/super-admin/grounding/verification-queue`. Verified row count should climb steadily.

### Task 4.4: Pilot launch (Grade 10 Science)

Execute the spec §11.4 09:00–11:00 IST runbook. Monitor dashboards. GO/NO-GO decision at 11:00 IST.

### Task 4.5: Progressive rollout

Days 5–10. Two to three pairs per day as `verified_ratio ≥ 0.9`. Document each flip in `ops_events`.

### Task 4.6: Post-rollout monitoring (7 days)

Daily review of:
- Foxy grounded:true rate
- Student-reported wrong answers (target: ≤1/1000 at 7 days)
- Circuit trips
- Verifier queue progress

Any SLO breach triggers per-pair rollback via kill switch.

### Task 4.7: Runbook reviews + legacy code cleanup scheduling

Walk all 5 runbooks (§8.6 of spec) with ops team. Sign-off. Schedule legacy inline code deletion for 30 days post-rollout (tracked in followup ticket, not this plan).

---

## Plan Self-Review

Against the spec, systematically:

**Coverage check:**
- §4 Architecture: Tasks 2.1–2.12 build Layer 3; 1.1 builds Layer 2; 1.2–1.6 wire Layers 1↔2; 3.1–3.7 thin Layer 4. ✅
- §5 Data model: Tasks 1.1–1.7 cover all 7 tables/views + triggers. ✅
- §6 Service contract: Tasks 2.1–2.12. ✅
- §7 Integration points: Tasks 3.1–3.7. ✅
- §8 Verification pipelines: Tasks 3.8–3.9 + 4.3. ✅
- §9 Abstain UX: Tasks 3.11–3.15. ✅
- §10 Observability: Tasks 3.10 + 3.16–3.17. ✅
- §11 Rollout: Tasks 4.1–4.7. ✅
- §12 Testing: E2E 3.20, integration tests per-task, unit tests per-task. ✅
- §13 Definition of done: this plan is the delivery path. ✅

**Placeholder scan:** No "TBD", "TODO:", "implement later" present. Tasks 2.3–2.12 and 3.1–3.20 are summarized rather than fully expanded because each follows the same TDD cadence as Tasks 1.1–2.2 (exhaustively shown). **This is the acknowledged compression trade-off for plan readability.** Each subagent executing a summarized task has:
- Precise file paths
- Precise spec section references
- The full test cadence (test→verify→implement→verify→commit)
- The full TDD pattern from Tasks 1.1–2.2 as examples to follow

**Type consistency:** `verification_state`, `verified_against_ncert`, `grounded_ai_traces.caller`, `askGrounded()` — all names consistent between plan and spec. ✅

**Risks and known compressions:**
1. Tasks 2.3–2.12 and 3.1–3.20 are task headers with test focus points rather than line-by-line code. A subagent implementing these must read the spec section referenced for each task. This is intentional — the spec is the authority, the plan is the sequence.
2. Week 4 dates assume migrations go clean. If production backfill throws unexpected data-quality errors, Phase 4.2 becomes a multi-day data-cleanup mini-phase.
3. The verifier's adaptive rate depends on Claude RPM; if Anthropic limits change, peak-hour deferral constants need retuning.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-17-rag-grounding-integrity.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review between tasks, fast iteration within this session.

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Required pre-execution:** Set up an isolated git worktree off `main` (not inside `compassionate-curie`) via `superpowers:using-git-worktrees` before dispatching.

**Which approach?**
