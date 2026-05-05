# Alfanumrik — NCERT Quiz Engine: System Design

**Version:** 1.0  
**Date:** 2026-04-08  
**Author:** Engineering  
**Status:** Production (deployed `0fd8ed7`)

---

## 1. Context & Requirements

### 1.1 Problem Statement

Alfanumrik serves CBSE students across grades 6–12. The existing quiz pipeline
(`/quiz`) covered only **MCQ** format (2,599 questions, `question_bank`). CBSE
board exams allocate **60–70% of marks** to written formats (Short Answer,
Medium Answer, Long Answer). Students had no structured NCERT written-answer
practice, no AI evaluation, and no coverage tracking.

### 1.2 Functional Requirements

| # | Requirement |
|---|---|
| F1 | Serve NCERT questions from actual textbook content (not generated) |
| F2 | Support all CBSE question formats: MCQ (1M), SA (1–2M), MA (3–4M), LA (5–6M), HOTS (4–5M), Numerical |
| F3 | AI-evaluate written answers against NCERT model answer with CBSE marking rubric |
| F4 | Track per-chapter, per-student mastery across all NCERT chapters |
| F5 | Mixed paper mode: auto-balanced CBSE paper (40% MCQ / 30% SA / 20% MA / 10% LA) |
| F6 | Coverage map: visual progress across all chapters in a subject |
| F7 | Deduplicate questions across two source tables |
| F8 | Hindi/English bilingual support |

### 1.3 Non-Functional Requirements

| Category | Target |
|---|---|
| Scale | 100,000+ concurrent students |
| Latency (fetch) | < 500 ms for question load |
| Latency (evaluate) | < 3 s for written answer evaluation |
| Availability | 99.9% (Supabase SLA) |
| Data integrity | Zero duplicate chapter progress records (UNIQUE constraint) |
| Cost | AI evaluation: Claude Haiku (~$0.0004/eval), not GPT-4 |
| Correctness | Only NCERT-sourced answers — no hallucination (model answer from DB, not generated) |

### 1.4 Constraints

- Stack locked: Next.js App Router + Supabase + Edge Functions (Deno) + Voyage RAG
- No new infrastructure — extend existing `rag_content_chunks` (10,372 chunks)
- CBSE marking rules non-negotiable: partial marks, no spelling deductions

---

## 2. Data Inventory (pre-existing)

```
rag_content_chunks         10,372 rows    Voyage embeddings, NCERT content
  └─ with question_text     1,492 rows    NCERT Q&A already embedded
     ├─ short_answer          572          1–4 marks
     ├─ intext                552          1–3 marks (in-chapter questions)
     ├─ long_answer           132          5–6 marks
     ├─ example               104          worked examples
     ├─ exercise               66          exercise questions
     ├─ mcq                    37          objective
     ├─ numerical              15          calculation-based
     └─ hots                   14          higher-order thinking

ncert_exercises             187 rows     Structured NCERT Q&A with solution_steps
ncert_book_catalog          ~44 books    Subject × Grade catalog

question_bank             2,599 rows    MCQ only — irt_calibrated, bloom_level
                                         All is_ncert = true, none written
```

**Coverage:** 44 subject×grade combinations, 542 distinct chapters across RAG.

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Student Browser (Next.js)               │
│                                                         │
│  /quiz/ncert                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │NCERTQuizSetup│  │WrittenAnswer │  │NCERTEvaluation│  │
│  │ (Hick's Law) │→ │  Input       │→ │  (AI marks)   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│         ↓                 ↓                  ↓           │
│  ┌─────────────────────────────────────────────────┐    │
│  │          ncert-question-engine (Edge Fn v1)      │    │
│  │  fetch_questions | evaluate_answer | save_attempt│    │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS (JWT auth)
          ┌────────────▼────────────────────────┐
          │        Supabase (ap-south-1)         │
          │                                      │
          │  ┌─────────────────────────────┐     │
          │  │   PostgreSQL 17 (primary)   │     │
          │  │                             │     │
          │  │  rag_content_chunks         │     │
          │  │  ncert_exercises            │     │
          │  │  ncert_book_catalog         │     │
          │  │  question_bank              │     │
          │  │  student_ncert_attempts ←new│     │
          │  │  student_ncert_chapter_     │     │
          │  │    progress          ←new   │     │
          │  │                             │     │
          │  │  get_ncert_questions() RPC  │     │
          │  │  get_ncert_chapter_stats()  │     │
          │  └─────────────────────────────┘     │
          │                                      │
          │  ┌─────────────────────────────┐     │
          │  │   Anthropic API (Haiku)     │     │
          │  │   CBSE examiner evaluation  │     │
          │  └─────────────────────────────┘     │
          └──────────────────────────────────────┘
```

---

## 4. Data Model

### 4.1 New Tables

```sql
-- Every student attempt on any NCERT question
student_ncert_attempts (
  id              uuid PK,
  student_id      uuid → auth.users
  source_table    text  CHECK IN ('ncert_exercises','rag_content_chunks','question_bank'),
  question_id     uuid  -- FK to whichever source_table row
  subject         text,
  grade           text,  -- normalised to "9" not "Grade 9"
  chapter_number  integer,
  question_type   text,  -- mcq|short_answer|medium_answer|long_answer|hots|numerical
  marks_possible  integer,
  student_answer  text,  -- for written
  selected_option integer, -- for MCQ
  marks_awarded   integer,
  is_correct      boolean,
  ai_feedback     text,
  ai_key_points   jsonb  -- [{point, hit}]
  model_answer    text,
  time_spent      integer, -- seconds
  session_id      uuid,
  created_at      timestamptz
)

-- Chapter-level rollup (maintained by trigger)
student_ncert_chapter_progress (
  id              uuid PK,
  student_id      uuid → auth.users,
  subject         text,
  grade           text,
  chapter_number  integer,
  attempted       integer,
  correct         integer,
  total_marks     integer,
  earned_marks    integer,
  mastery_pct     numeric GENERATED ALWAYS AS  ← computed, never written
    (ROUND((earned_marks/total_marks)*100, 2)) STORED,
  last_attempted  timestamptz,
  UNIQUE (student_id, subject, grade, chapter_number)
)
```

### 4.2 GENERATED Column Design Decision

`mastery_pct` is a `GENERATED ALWAYS AS ... STORED` column. This means:
- **No application code** ever computes or writes mastery percentage
- **Always consistent** — derived from `earned_marks / total_marks`
- **No update needed** — the trigger only updates `earned_marks` / `total_marks`
- **Trade-off:** Can't override without changing the formula. Acceptable — CBSE marks are deterministic.

### 4.3 Trigger: `trg_ncert_chapter_progress`

Fires `AFTER INSERT` on `student_ncert_attempts`. Uses `INSERT ... ON CONFLICT DO UPDATE` (upsert) to atomically increment chapter progress. No race condition — Postgres row-level locking on the UNIQUE constraint.

```
INSERT attempt → trigger fires → UPSERT chapter_progress
                                    ↑
                              mastery_pct auto-recomputes
```

---

## 5. API Design

### 5.1 Edge Function: `ncert-question-engine`

**Base URL:** `{SUPABASE_URL}/functions/v1/ncert-question-engine`  
**Auth:** `Authorization: Bearer {student_jwt}` — validated via `supabase.auth.getUser(jwt)`  
**verify_jwt:** false (manual validation — needed for service-role DB writes after auth)

---

#### Action: `fetch_questions`

```
POST /ncert-question-engine
{
  "action": "fetch_questions",
  "student_id": "uuid",
  "subject": "science",       // case-insensitive ILIKE match
  "grade": "9",               // accepts "9" or "Grade 9"
  "chapter": 3,
  "question_type": "mixed",   // mcq|short_answer|medium_answer|long_answer|mixed|all
  "count": 10                 // 1–30
}

Response 200:
{
  "questions": [
    {
      "question_id": "uuid",
      "source_table": "rag_content_chunks",
      "question_text": "What is photosynthesis?",
      "answer_text": "...",
      "solution_steps": null,
      "question_type": "short_answer",
      "cbse_type": "short_answer",      // normalised CBSE category
      "cbse_label": "Short Answer",
      "marks_possible": 2,
      "bloom_level": "understand",
      "ncert_exercise": "Exercise 3.1",
      "options": null,                  // populated for MCQ
      "topic_tag": "Photosynthesis",
      "time_estimate": 120,             // seconds
      "word_limit": 40
    }
  ],
  "total": 10,
  "chapter": 3,
  "subject": "science",
  "grade": "9"
}
```

**Data flow:**

```
1. Validate JWT → get student_id
2. Call get_ncert_questions() RPC
   ├── UNION of ncert_exercises (LIMIT count/2)
   └── UNION of rag_content_chunks (LIMIT count/2)
3. Deduplicate by question_text[:80].toLowerCase()
4. If mixed: redistribute into CBSE paper balance
5. Enrich with cbse_type, cbse_label, time_estimate, word_limit
6. Return
```

**Why UNION in RPC not application layer:**  
Moving the UNION to PostgreSQL means one round-trip instead of two. The RPC handles grade normalisation ("Grade 9" ↔ "9") inside Postgres, avoiding N+1 lookups.

---

#### Action: `evaluate_answer`

```
POST /ncert-question-engine
{
  "action": "evaluate_answer",
  "student_id": "uuid",
  "question_id": "uuid",
  "source_table": "rag_content_chunks",
  "question_text": "Explain the process of photosynthesis.",
  "student_answer": "Photosynthesis is when plants make food...",
  "marks_possible": 3,
  "question_type": "short_answer"
}

Response 200:
{
  "marks_awarded": 2,
  "marks_possible": 3,
  "percentage": 67,
  "feedback": "You correctly identified the basic concept. Missing: the role of chlorophyll and the light/dark reactions.",
  "key_points": [
    { "point": "plants convert sunlight to glucose", "hit": true },
    { "point": "chlorophyll absorbs light", "hit": false },
    { "point": "CO2 + H2O → glucose + O2", "hit": true }
  ],
  "model_answer_summary": "Photosynthesis is the process by which green plants use sunlight, CO2, and water to produce glucose and oxygen, mediated by chlorophyll in the chloroplasts.",
  "grade": "Satisfactory",
  "is_correct": false
}
```

**Evaluation pipeline:**

```
1. Fetch model answer from source_table by question_id
   ├── ncert_exercises: answer_text + solution_steps
   └── rag_content_chunks: answer_text ?? chunk_text
2. If model_answer empty → RAG text-search fallback (ILIKE on question_text)
3. Build CBSE examiner prompt with:
   - Question type + marks
   - Model answer (ground truth — never hallucinated)
   - Student answer
   - CBSE marking rules (partial marks, no spelling penalty)
4. Call Claude Haiku (claude-haiku-4-5-20251001, max_tokens=600)
5. Parse JSON response → validate marks range [0, marks_possible]
6. Fallback if AI fails: word-match scoring (jaccard on 20 key words)
7. Return evaluation
```

**Why Haiku not Sonnet:**  
Evaluation requires ~200 token context + 600 token response. Haiku handles this accurately at 20× lower cost (~$0.0004/eval vs ~$0.008). At 100K students × 10 evals/day = 1M evals/day = ~$400/day on Haiku vs ~$8,000/day on Sonnet.

**Why model answer from DB, not generated:**  
RAG hallucination risk is eliminated. The model answer is always the NCERT textbook answer. Claude only evaluates — never creates content.

---

#### Action: `save_attempt`

Fire-and-forget POST after every question submission. The client does not await this response for the UI — it's a background write. Trigger `trg_ncert_chapter_progress` fires synchronously inside Postgres.

---

### 5.2 Database RPCs

#### `get_ncert_questions(p_subject, p_grade, p_chapter, p_question_type, p_limit)`

```sql
RETURNS TABLE (
  question_id, source_table, question_text, answer_text,
  solution_steps, question_type, marks_possible,
  bloom_level, ncert_exercise, options, topic_tag
)
```

UNION of two sources, each limited to `p_limit/2` rows. Grade normalised via `REGEXP_REPLACE(grade, '^Grade\s*', '', 'i')`. Filters `question_type` per CBSE category mapping.

**SECURITY DEFINER + `SET search_path = public`** — prevents search_path injection (P4 hardening standard).

#### `get_ncert_chapter_stats(p_subject, p_grade)`

Returns chapter list with MCQ count + written count — used by `NCERTQuizSetup` and `NCERTCoverageMap` without requiring client-side aggregation.

---

## 6. Question Type Resolution

```
raw question_type    marks_possible    → cbse_type
─────────────────────────────────────────────────────
mcq                  1                 → mcq
intext               1–2               → short_answer
short_answer         1–2               → short_answer
short_answer         3–4               → medium_answer
long_answer          any               → long_answer
hots                 any               → hots (CBSE Section E)
numerical            any               → numerical
example              any               → excluded (not served as quiz Q)
```

**Why `intext` maps to `short_answer`:**  
CBSE "intext" questions (questions within chapter body) carry 1–3 marks and require 1–3 sentence answers — functionally identical to Short Answer format. Unifying them reduces student confusion.

---

## 7. Mixed Paper Balancing

```
CBSE Section distribution (Mixed mode):
────────────────────────────────────────
Section A  MCQ          40% of count    1 mark each
Section B  Short Answer 30% of count    1–2 marks each
Section C  Medium Ans   20% of count    3–4 marks each
Section D  Long Answer  10% of count    5–6 marks each
```

For `count=10`: 4 MCQ + 3 SA + 2 MA + 1 LA = 10 questions  
Expected total marks: 4 + 5 + 7 + 6 = **22 marks** (approx CBSE section weight)

Fallback: if a category has fewer questions than allocated, remaining slots fill from next available category.

---

## 8. UI Architecture

### 8.1 Screen State Machine

```
setup ──start──→ loading ──questions──→ quiz
                                          │
                              ┌───────────┤
                              ↓           ↓
                          (MCQ)       (written)
                              │           │
                          submit       submit
                              │           │
                              └─────┬─────┘
                                    ↓
                               evaluating  ← (written only, ~2s)
                                    │
                               evaluation ← AI result shown
                                    │
                              next/last
                             ┌──────┴──────┐
                             ↓             ↓
                           quiz          results
                                    │
                               coverage  ← chapter map
```

### 8.2 Component Responsibilities

| Component | Responsibility | State owned |
|---|---|---|
| `page.tsx` | Screen router, fetch/evaluate/save orchestration | All quiz state |
| `NCERTQuizSetup` | Hick's Law 4-step selector | Local: step, chapters |
| `WrittenAnswerInput` | Answer pad, timer, word count, review step | Local: answer, timeLeft |
| `NCERTEvaluation` | Marks display, key-point checklist, model answer | Pure display (props) |
| `NCERTCoverageMap` | Chapter grid with mastery colour, overall bar | Fetches own data via `supabase` |

**Design principle:** All evaluation state lives in `page.tsx`. Child components are either input collectors or pure display — no evaluation logic runs in components.

### 8.3 Timer Design

`WrittenAnswerInput` runs a `setInterval` countdown from `time_estimate` seconds.
- Timer is purely advisory (no auto-submit on timeout — CBSE examiners don't cut mid-answer)
- Colour: green → amber (< 50%) → red (< 20%)
- `timeSpent` is computed from `startTime.current` (wall clock), not from countdown, to handle browser tab switches accurately

---

## 9. Caching Strategy

| Layer | What's cached | TTL | Mechanism |
|---|---|---|---|
| Client SWR | CME action, due-review count | 10s | `useSWR dedupingInterval` |
| Edge Function | None (stateless) | — | Deno isolate restarts on cold start |
| Postgres | `student_ncert_chapter_progress` | Permanent | Trigger-maintained, no TTL |
| RPC result | Not cached | — | Always fresh — question sets must not be stale |

**No question caching on client** — chapters have limited question pools. Caching would cause the same questions to repeat across sessions. Fresh RPC call every session is correct.

---

## 10. Scale Analysis

### 10.1 Load Estimation (100K MAU target)

```
Assumption: 20% DAU = 20,000 students/day
Average session: 10 questions, 5 written evaluations
Peak hour: 6–9 PM IST (60% of traffic = 12,000 students in 3h = 4,000/hr = ~67/min)

fetch_questions calls:     67/min    → ~1 RPC/second peak
evaluate_answer calls:    167/min    → ~3 Anthropic calls/second peak
save_attempt calls:       670/min    → ~11 DB inserts/second peak
```

### 10.2 Bottleneck Analysis

```
Component              Limit              Action needed at 100K
─────────────────────────────────────────────────────────────────
Supabase Postgres     500 connections    Connection pooling via pgBouncer (already default)
Edge Functions        Unlimited isolates Supabase auto-scales Edge Functions
Anthropic Haiku       1000 RPM default   Upgrade to tier 2 (~10K RPM) at 50K MAU
get_ncert_questions() ~50ms for UNION    Index: (subject, grade, chapter_number) on both tables ← needs review
save_attempt INSERT   ~5ms              Partitioning by month if > 10M rows/year
```

### 10.3 Index Audit

**Existing relevant indexes:**
- `rag_content_chunks`: covering indexes on FKs added in P4-7
- `ncert_exercises`: no explicit indexes confirmed — **needs index on `(textbook_id, chapter_number, question_type)`**
- `student_ncert_attempts`: `idx_sna_student_subject` on `(student_id, subject, grade, chapter_number)` ✅

**Missing index — recommend next sprint:**
```sql
CREATE INDEX idx_ncert_exercises_chapter
  ON ncert_exercises(textbook_id, chapter_number, question_type);

CREATE INDEX idx_rag_chunks_ncert_qa
  ON rag_content_chunks(subject, chapter_number, question_type)
  WHERE question_text IS NOT NULL AND question_text != '' AND is_active = true;
```

---

## 11. Error Handling

| Failure | Behaviour |
|---|---|
| `get_ncert_questions` RPC error | Returns 500 → UI shows "no questions found" + retry prompt |
| No questions for chapter+type | Returns empty array → UI shows "Try All or different chapter" |
| Anthropic API 429/5xx | Falls back to word-match scoring (always returns a result) |
| Anthropic JSON parse failure | Regex-extract JSON from response; if still fails, word-match |
| `save_attempt` DB error | Logged server-side; UI continues (non-blocking) |
| JWT expired mid-session | Next action returns 401 → UI redirects to /login |
| Grade normalisation mismatch | `REGEXP_REPLACE` handles both "9" and "Grade 9" at RPC level |

---

## 12. Security

| Vector | Mitigation |
|---|---|
| Unauthenticated access | Manual JWT validation via `supabase.auth.getUser(jwt)` in every action |
| Cross-student data read | RLS: `student_id = auth.uid()` on both new tables |
| Prompt injection via student answer | Student answer is wrapped in quoted string; examiner prompt uses structured format |
| Model answer leakage before attempt | model_answer only returned in `evaluate_answer` response — after student submits |
| Service role bypass | RLS service_role policies scoped with `USING(true)` — edge function uses service role only server-side |
| search_path injection | All RPCs and functions: `SET search_path = public` (P4 hardening) |

---

## 13. Trade-off Log

| Decision | Alternative considered | Reason chosen |
|---|---|---|
| Claude Haiku for evaluation | GPT-4o, Claude Sonnet | 20× cheaper, 600ms faster; CBSE eval doesn't require long context reasoning |
| Model answer from DB (not RAG retrieval) | Voyage semantic search | Eliminates hallucination; exact NCERT answer is already stored |
| Word-match fallback | Fail open (return 0 marks) | Students always get feedback, even if AI is down |
| GENERATED ALWAYS mastery_pct | Application-computed | Never out of sync; no update query needed |
| UNION RPC vs two client calls | Two separate Supabase queries | Single round-trip; grade normalisation in one place |
| `source_table` as text column | Separate FK tables per source | Flexible; avoids schema migration if third source added later |
| Fire-and-forget save_attempt | Await before showing evaluation | Evaluation result is already computed; save is a side-effect |
| `verify_jwt: false` on edge function | `verify_jwt: true` | Manual auth needed because service role writes must follow auth check — not possible with verify_jwt=true which blocks before function body |

---

## 14. Observability

### 14.1 Existing (from `get_logs`)

Supabase Edge Function logs capture:
- `get_ncert_questions error:` — RPC failures
- `save_attempt:` — DB write failures
- `Anthropic eval error:` — API failures with response text

### 14.2 Recommended additions (next sprint)

```sql
-- Track evaluation quality over time
ALTER TABLE student_ncert_attempts
  ADD COLUMN evaluation_method text DEFAULT 'ai'; -- 'ai' | 'word_match' | 'exact'

-- Monitor chapter coverage gaps
CREATE VIEW ncert_chapter_coverage_gaps AS
SELECT rcc.subject, rcc.grade, rcc.chapter_number,
       COUNT(rcc.id) as questions_available,
       COUNT(sna.id) as total_attempts,
       COUNT(DISTINCT sna.student_id) as unique_students
FROM rag_content_chunks rcc
LEFT JOIN student_ncert_attempts sna
  ON sna.question_id = rcc.id AND sna.source_table = 'rag_content_chunks'
WHERE rcc.question_text IS NOT NULL
GROUP BY rcc.subject, rcc.grade, rcc.chapter_number
ORDER BY unique_students ASC; -- shows least-practiced chapters first
```

---

## 15. Current System Numbers (Production, 2026-04-08)

```
question_bank          2,599   MCQ only, IRT-calibrated
rag_content_chunks    10,372   NCERT textbook content, Voyage-embedded
  └─ with Q&A         1,492   Ready for NCERT quiz serving
ncert_exercises          187   Structured Q with solution_steps
subject×grade combos      44   (Biology 11, Biology 12, … Science 9, Science 10 …)
chapters available       542   Across all subjects and grades
student_ncert_attempts     0   (new table — ready for data)
```

---

## 16. What to Revisit at Scale

| Milestone | Action |
|---|---|
| 1,000 evals/day | Add `evaluation_method` column to measure AI vs fallback ratio |
| 10K MAU | Add index `idx_ncert_exercises_chapter` + `idx_rag_chunks_ncert_qa` |
| 50K MAU | Upgrade Anthropic to tier 2; review Edge Function cold-start latency |
| 100K MAU | Partition `student_ncert_attempts` by `created_at` month |
| 500K MAU | Consider read replica for `get_ncert_questions` RPC (read-heavy) |
| Content gap found | Re-run `embed-ncert-qa` edge function on missing chapters |
| Answer quality complaints | Switch evaluate_answer to Claude Sonnet for that subject only (feature flag) |

---

## 17. Open Questions

1. **Answers coverage:** 1,492 Q&A embedded but 421/572 short_answer and 62/132 long_answer have `answer_text` populated. Who fills the remaining gaps? Re-run `generate-answers` edge function on null-answer rows?

2. **ncert_exercises linkage:** 187 rows in `ncert_exercises` vs 1,492 in `rag_content_chunks`. The two sources partially overlap. Should we deduplicate into a single canonical `ncert_qa` table?

3. **MCQ from rag_content_chunks:** Only 37 MCQ Q&A in `rag_content_chunks` vs 2,599 in `question_bank`. When `question_type = 'mcq'` in `/quiz/ncert`, should we pull from `question_bank` as a third source?

4. **Hindi evaluation:** `evaluate_answer` sends English CBSE prompt. If student writes Hindi answer, evaluation quality degrades. Should the prompt detect language and switch?

5. **Plagiarism / copy-paste:** No check if student pastes model answer verbatim. Word-match would score it 100%. Low priority for now (self-practice), but relevant if NCERT quiz is used for school assessments.
