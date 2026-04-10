# Quiz + Q&A System Redesign — Architecture Document

## 1. System Overview

The redesigned quiz and NCERT Q&A engine replaces the flat random-selection system with a structured, non-repeating, concept-balanced, NCERT-complete question delivery system.

### Key Changes
| Before | After |
|--------|-------|
| Random question selection | Non-repeating, concept-balanced, difficulty-progressive |
| MCQ only | MCQ, assertion-reason, case-based, short answer, long answer |
| Flat subject→chapter | class → subject → chapter → topic → question |
| No history tracking | Per-student question history with 80% pool reset |
| No chapter completion | 3-rule completion with test mode unlock |
| Basic exam mode | CBSE-style section-based paper generation |
| No NCERT tracking | is_ncert flag, ncert_exercise, ncert_page per question |

---

## 2. Database Schema

### New Tables

#### `chapters` — NCERT chapter catalog
```
class → subject → chapter (this table)
```
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| subject_id | UUID FK → subjects | |
| grade | TEXT | "6"-"12" (P5) |
| chapter_number | INTEGER | NCERT chapter number |
| title | TEXT | English title |
| title_hi | TEXT | Hindi title |
| ncert_page_start | INTEGER | First page in textbook |
| ncert_page_end | INTEGER | Last page in textbook |
| total_questions | INTEGER | Denormalized count |
| UNIQUE | (subject_id, grade, chapter_number) | |

#### `chapter_topics` — Concepts within chapters
```
chapter → topic/concept (this table)
```
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| chapter_id | UUID FK → chapters | |
| title | TEXT | Concept name |
| concept_tag | TEXT | Machine-readable tag (e.g. "photosynthesis") |
| UNIQUE | (chapter_id, concept_tag) | |

#### `user_question_history` — Non-repetition tracking
| Column | Type | Description |
|--------|------|-------------|
| student_id | UUID FK → students | |
| question_id | UUID FK → question_bank | |
| subject | TEXT | For scoped queries |
| grade | TEXT | For scoped queries |
| chapter_number | INTEGER | For scoped queries |
| times_shown | INTEGER | How many times shown |
| last_result | BOOLEAN | Last answer correctness |
| UNIQUE | (student_id, question_id) | |

#### `chapter_progress` — Per-chapter completion
| Column | Type | Description |
|--------|------|-------------|
| student_id | UUID FK → students | |
| chapter_id | UUID FK → chapters | |
| pool_coverage_percent | REAL | % of questions seen |
| accuracy_percent | REAL | % correct |
| concepts_mastered | INTEGER | Concepts with mastery >= 0.7 |
| is_completed | BOOLEAN | All 3 completion rules met |
| test_mode_unlocked | BOOLEAN | Ready for exam mode |
| UNIQUE | (student_id, chapter_id) | |

#### `exam_paper_templates` — CBSE exam structures
| Column | Type | Description |
|--------|------|-------------|
| grade | TEXT | |
| total_marks | INTEGER | 50 (6-8), 80 (9-10), 70 (11-12) |
| duration_minutes | INTEGER | |
| sections | JSONB | Array of section definitions |

### Modified: `question_bank` — 12 new columns
| Column | Type | Purpose |
|--------|------|---------|
| concept_tag | TEXT | Links to chapter_topics |
| chapter_id | UUID FK | Links to chapters table |
| question_type_v2 | TEXT | 'mcq'\|'assertion_reason'\|'case_based'\|'short_answer'\|'long_answer' |
| case_passage | TEXT | Passage for case-based questions |
| case_passage_hi | TEXT | Hindi passage |
| expected_answer | TEXT | Model answer for short/long |
| expected_answer_hi | TEXT | Hindi model answer |
| answer_rubric | JSONB | Marking criteria |
| max_marks | INTEGER | Marks for this question |
| ncert_exercise | TEXT | e.g. "Ex 1.1 Q3" |
| ncert_page | INTEGER | Page number in textbook |
| is_ncert | BOOLEAN | True = directly from NCERT |

---

## 3. Quiz Selection Algorithm

### `select_quiz_questions_v2` RPC

```
INPUT: student_id, subject, grade, chapter, count, difficulty_mode, question_types

1. AUTH CHECK: Verify auth.uid() owns student_id

2. POOL COUNT: Count active questions matching filters
   → If 0, return empty array

3. SEEN COUNT: Count questions in user_question_history for this scope

4. RESET CHECK: If seen/total >= 80%
   → DELETE history for this scope
   → Reset seen count to 0

5. SELECT with priority scoring:
   ┌─────────────────────────────────┐
   │ Priority 1: Unseen questions    │
   │ Priority 2: NCERT questions     │
   │ Priority 3: Least recently seen │
   │ Priority 4: Random              │
   └─────────────────────────────────┘

6. DIFFICULTY FILTER:
   - easy/medium/hard → filter to that level
   - mixed → all difficulties
   - progressive → select all, ORDER BY difficulty ASC

7. RECORD: Insert/update user_question_history

8. RETURN: JSONB array with all question fields
```

### Concept Balancing (TypeScript layer)
```
For each concept in the chapter:
  weight = mastery < 0.3 → 1.0 (weak, get more questions)
           0.3-0.7       → 0.6 (learning)
           > 0.7         → 0.3 (mastered, fewer questions)

Normalize weights, allocate question slots proportionally.
Each concept gets minimum 1 slot if available.
```

### Difficulty Progression
```
progressive mode (e.g., 10 questions):
  Questions 1-3: Easy (difficulty 1)
  Questions 4-7: Medium (difficulty 2)
  Questions 8-10: Hard (difficulty 3)
```

---

## 4. Non-Repetition Logic

```
┌──────────────────────────────────────┐
│ Student starts quiz                  │
│                                      │
│ Pool: 100 questions for Chapter 3    │
│ Seen: 75 (75% coverage)             │
│                                      │
│ → Select from 25 unseen questions    │
│ → Record selections in history       │
│                                      │
│ After quiz: Seen = 85 (85% >= 80%)  │
│ → RESET: Delete all history          │
│ → Next quiz starts fresh from 0%    │
└──────────────────────────────────────┘
```

**Fallback**: If unseen < requested count, supplement with least-recently-seen questions (oldest `last_shown_at` first).

---

## 5. Chapter Completion Logic

A chapter is **completed** when ALL three conditions are met:

| Rule | Threshold | What it means |
|------|-----------|---------------|
| Pool Coverage | >= 80% | Student has seen 80% of chapter questions |
| Accuracy | >= 60% | Student answers 60% correctly |
| Concept Coverage | >= 70% | Student has attempted 70% of chapter concepts |

### Test Mode Unlock
Test mode (exam-style timed assessment) unlocks when:
- Chapter is completed (all 3 rules above), **OR**
- 70% of concepts have mastery >= 0.7 (even without full pool coverage)

---

## 6. Exam Mode — CBSE Paper Generation

### Template Structure (Grades 9-10, 80 marks)
| Section | Type | Marks/Q | Total Qs | Attempt |
|---------|------|---------|----------|---------|
| A | MCQ | 1 | 20 | 16 |
| B | Assertion-Reason | 1 | 5 | 4 |
| C | Short Answer (2m) | 2 | 6 | 5 |
| D | Short Answer (3m) | 3 | 7 | 6 |
| E | Long Answer | 5 | 3 | 2 |
| F | Case-Based | 4 | 3 | 2 |

### Generation Algorithm
```
For each section:
  1. Filter question_bank by question_type_v2 matching section type
  2. Filter by subject, grade, chapters (if specified)
  3. Exclude seen questions (user_question_history)
  4. Prioritize NCERT questions
  5. Randomize, limit to section.total_questions
  6. Record in user_question_history
```

---

## 7. API Structure

### `GET /api/quiz`

| Action | Params | Returns |
|--------|--------|---------|
| `?action=questions` | subject, grade, count, difficulty, chapter, types | Question array |
| `?action=chapter-progress` | subject, grade | Chapter progress array |
| `?action=history-stats` | subject, grade, chapter | Pool coverage stats |
| `?action=ncert-coverage` | grade, subject | NCERT completeness report |

### `POST /api/quiz`

| Action | Body | Returns |
|--------|------|---------|
| `generate-exam` | subject, grade, chapters[], templateId | Exam paper with sections |

### Client Functions (`supabase.ts`)
```typescript
getQuizQuestionsV2(subject, grade, count, difficultyMode, chapter, types)
getChapterProgress(subject, grade)
updateChapterProgress(subject, grade, chapterNumber)  // fire-and-forget
generateExamPaper(subject, grade, chapters, templateId)
getNCERTCoverageReport(grade, subject)
getQuestionHistoryStats(subject, grade, chapter)
```

---

## 8. Foxy Integration Points

The redesign enables Foxy (AI tutor) to:

1. **Detect weak concepts**: Query `chapter_progress.concepts_mastered` and `concept_mastery` to find concepts with low mastery
2. **Push targeted questions**: Call `select_quiz_questions_v2` with specific `chapter_number` and `difficulty_mode='progressive'` to generate remediation quizzes
3. **Track knowledge gaps**: Use `knowledge_gaps` table (already exists) fed by the updated `update_chapter_progress` RPC
4. **Recommend next steps**: If chapter completion is close (e.g., 75% pool coverage), nudge student to finish

---

## 9. Question Types

| Type | Format | Scoring | CBSE Section |
|------|--------|---------|--------------|
| `mcq` | 4 options, 1 correct | Auto (correct_answer_index) | A |
| `assertion_reason` | 2 statements + 4 AR options | Auto | B |
| `case_based` | Passage + 4 MCQ sub-questions | Auto | F |
| `short_answer` | Free text, 2-3 sentences | AI-assisted (expected_answer) | C, D |
| `long_answer` | Free text, detailed | AI-assisted (answer_rubric) | E |

---

## 10. Test Plan

### Unit Tests (quiz-engine.ts)
- [ ] calculateDifficultySlots: progressive produces 30/40/30 split
- [ ] calculateDifficultySlots: easy/medium/hard produce uniform arrays
- [ ] calculateConceptSlots: weak concepts get more slots
- [ ] calculateConceptSlots: total slots equals requested count
- [ ] isChapterCompleted: returns true only when all 3 rules met
- [ ] isTestModeUnlocked: returns true on completion OR 70% mastery
- [ ] calculatePoolCoverage: shouldReset true at 80%
- [ ] validateQuestionForQuiz: rejects garbage, accepts valid MCQ
- [ ] validateQuestionForQuiz: validates case_passage for case_based
- [ ] validateQuestionForQuiz: validates expected_answer for short/long
- [ ] parseQuestionOptions: handles string, array, invalid input
- [ ] getDefaultExamTemplate: correct marks for each grade band
- [ ] distributeQuestionsToSections: assigns by type

### Integration Tests (RPCs)
- [ ] select_quiz_questions_v2: returns correct count
- [ ] select_quiz_questions_v2: never returns same question twice (until 80% reset)
- [ ] select_quiz_questions_v2: resets history at 80% coverage
- [ ] select_quiz_questions_v2: rejects unauthorized student_id
- [ ] select_quiz_questions_v2: filters by question_type_v2
- [ ] select_quiz_questions_v2: progressive mode orders by difficulty
- [ ] get_chapter_progress: returns all chapters with stats
- [ ] update_chapter_progress: correctly calculates completion
- [ ] generate_exam_paper: produces all sections with questions
- [ ] get_ncert_coverage_report: identifies missing chapters

### E2E Tests
- [ ] Full quiz flow: setup → questions → submit → results
- [ ] Chapter progress updates after quiz completion
- [ ] Exam mode: generates paper, enforces timer, submits
- [ ] Non-repetition: run 2 quizzes, verify no overlap

---

## 11. Files Changed

| File | Lines | What |
|------|-------|------|
| `supabase/migrations/20260402130000_quiz_qa_redesign.sql` | 439 | Tables, columns, indexes, RLS, seed data |
| `supabase/migrations/20260402130001_quiz_qa_rpcs.sql` | 840 | 5 RPCs with auth verification |
| `src/lib/quiz-engine.ts` | 453 | Pure logic: types, constants, algorithms |
| `src/app/api/quiz/route.ts` | 562 | API route with GET/POST handlers |
| `src/lib/supabase.ts` | +182 | 6 new client functions |
| **Total** | **2,476** | |

---

## 12. NCERT Completeness Strategy

> "If your Q&A is not 100% NCERT complete, students will NOT trust your platform."

### Tracking
- Every question has `is_ncert BOOLEAN` and `ncert_exercise TEXT`
- `get_ncert_coverage_report` RPC gives per-chapter NCERT status
- Super admin can see: which chapters are MISSING, PARTIAL, or COMPLETE

### Population Priority
1. **Phase 1**: All NCERT exercise questions (textbook-exact)
2. **Phase 2**: CBSE board exam PYQs (2019-2025)
3. **Phase 3**: Additional practice by concept

### Audit Query
```sql
SELECT grade, subject, chapter_number, chapter_title,
  ncert_count, total_count,
  CASE WHEN ncert_count = 0 THEN 'MISSING'
       WHEN ncert_count < 5 THEN 'PARTIAL'
       ELSE 'COMPLETE' END AS status
FROM get_ncert_coverage_report('10', 'science');
```
