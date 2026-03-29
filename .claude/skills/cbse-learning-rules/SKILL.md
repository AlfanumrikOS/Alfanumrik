# Skill: CBSE Learning Rules

Use this skill when working with curriculum content, question banks, subject configurations, grade-level logic, or any feature that must align with CBSE/NCERT standards.

## Grade Structure

### Junior (Grades 6-8)
Subjects: `math`, `science`, `english`, `hindi`, `social_studies`
- Single `science` subject (Physics + Chemistry + Biology combined)
- Single `social_studies` subject (History + Geography + Civics + Economics combined)
- NCERT textbook is the primary source

### Secondary (Grades 9-10)
Subjects: `math`, `science`, `english`, `hindi`, `social_studies`
- Science still combined but with distinct Physics/Chemistry/Biology chapters
- Board exam at Grade 10 (CBSE Class X)
- Board paper questions tagged: `board_year`, `paper_section`, `set_code`

### Senior Secondary (Grades 11-12)
Stream-based subject selection:
- **Science**: `physics`, `chemistry`, `math`/`biology`, `english`
- **Commerce**: `accountancy`, `business_studies`, `economics`, `math` (optional), `english`
- **Humanities**: `political_science`, `history_sr`, `geography`, `economics` (optional), `english`
- Additional: `computer_science`, `coding`
- Board exam at Grade 12 (CBSE Class XII)

## Subject Codes (Source of Truth: `src/lib/exam-engine.ts`)
```typescript
const SUBJECT_CATEGORY = {
  math: 'stem_calc',
  physics: 'stem_calc',
  chemistry: 'stem_concept',
  biology: 'stem_concept',
  science: 'stem_concept',
  computer_science: 'stem_calc',
  coding: 'stem_calc',
  english: 'language',
  hindi: 'language',
  social_studies: 'humanities',
  economics: 'stem_concept',
  accountancy: 'stem_calc',
  business_studies: 'humanities',
  political_science: 'humanities',
  history_sr: 'humanities',
  geography: 'humanities',
};
```

## Grade Format
- Always stored and passed as **strings**: `"6"`, `"7"`, ..., `"12"`
- Never use integers in database columns, RPCs, or API parameters
- Grade display: `"Class 6"` (English) / `"कक्षा 6"` (Hindi)
- Database column: `grade VARCHAR` or `grade TEXT`, never `INTEGER`

## Bloom's Taxonomy Integration
Questions are tagged with Bloom's levels. Distribution targets by exam type:

| Exam Type | Remember | Understand | Apply | Analyze | Evaluate | Create |
|---|---|---|---|---|---|---|
| Quick Check | 50% | 40% | 10% | — | — | — |
| Standard Test | 20% | 30% | 30% | 15% | 5% | — |
| Challenge | 10% | 15% | 25% | 30% | 15% | 5% |
| Full Exam | 15% | 20% | 25% | 20% | 15% | 5% |

These are targets, not hard requirements. The question bank may not have enough questions at every level for every topic.

## Question Bank Rules

### Required Fields
```sql
question_text    TEXT NOT NULL,        -- The question stem
options          JSONB NOT NULL,       -- ["option A", "option B", "option C", "option D"]
correct_answer_index INTEGER NOT NULL, -- 0, 1, 2, or 3
explanation      TEXT NOT NULL,        -- Why the correct answer is correct
difficulty       TEXT NOT NULL,        -- 'easy', 'medium', 'hard'
bloom_level      TEXT NOT NULL,        -- 'remember' through 'create'
grade            TEXT NOT NULL,        -- '6' through '12'
subject          TEXT NOT NULL,        -- valid subject code
```

### Optional Fields
```sql
chapter_number   INTEGER,             -- NCERT chapter number
topic_id         UUID,                -- links to curriculum_topics
board_year       INTEGER,             -- if from board paper (2020, 2021, etc.)
paper_section    TEXT,                 -- 'A', 'B', 'C' (board paper section)
set_code         TEXT,                 -- board paper set identifier
source           TEXT,                 -- 'ncert', 'board_paper', 'generated', 'curated'
```

### Quality Validation
Before inserting questions:
1. `question_text` must not contain template markers (`{{`, `[BLANK]`, `TODO`, `FIXME`)
2. All 4 options must be distinct (no duplicate options)
3. Options must be non-empty strings
4. `explanation` must be at least 20 characters
5. `bloom_level` must be one of: `remember`, `understand`, `apply`, `analyze`, `evaluate`, `create`
6. `difficulty` must be one of: `easy`, `medium`, `hard`
7. `correct_answer_index` must be 0, 1, 2, or 3

## Curriculum Topic Structure
```sql
curriculum_topics (
  id UUID PRIMARY KEY,
  subject_id UUID REFERENCES subjects(id),
  grade TEXT NOT NULL,
  title TEXT NOT NULL,           -- "Knowing Our Numbers" (NCERT chapter title)
  description TEXT,
  chapter_number INTEGER,       -- Matches NCERT textbook
  display_order INTEGER
)
```

## NEP 2020 Compliance
The platform tracks competencies aligned with NEP 2020:
- Foundational Literacy and Numeracy (grades 6-8 emphasis)
- Competency-based learning progression
- Formative assessment emphasis (quizzes are formative, not just summative)
- Multi-disciplinary connections (tracked in `concept_mastery`)

## Content Gap Detection
The script `scripts/check-content-gaps.ts` audits question bank coverage:
- Minimum questions per subject per grade
- RAG content chunk coverage
- Identifies missing chapters and topics
- Run with: `npx tsx scripts/check-content-gaps.ts`

## Rules for Adding CBSE Content
1. Verify chapter/topic exists in `curriculum_topics` for the grade
2. Tag questions with correct `chapter_number` matching NCERT textbook
3. Distribute difficulty: roughly 30% easy, 50% medium, 20% hard
4. Include board paper questions where available (tag with year/section)
5. Write explanations that teach, not just state the answer
6. For math/science: include the solution approach, not just "Option B is correct"
