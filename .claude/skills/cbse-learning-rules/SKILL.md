# Skill: CBSE Learning Rules

Concrete rules for curriculum content, question banks, subject codes, grade-level logic, and Bloom's taxonomy. Reference when adding questions, changing subject lists, or modifying grade-dependent behavior.

**Owning agent**: assessment.

## Grade → Subject Mapping

### Grades 6-8 (Junior)
| Code | Subject | Category |
|---|---|---|
| `math` | Mathematics | stem_calc |
| `science` | Science (Physics+Chemistry+Biology combined) | stem_concept |
| `english` | English | language |
| `hindi` | Hindi | language |
| `social_studies` | Social Studies (History+Geography+Civics+Economics combined) | humanities |

### Grades 9-10 (Secondary)
Same codes as 6-8. Science has distinct Physics/Chemistry/Biology chapters but uses single `science` code. Board exams at Grade 10 (CBSE Class X).

### Grades 11-12 (Senior Secondary)
| Code | Subject | Category | Stream |
|---|---|---|---|
| `physics` | Physics | stem_calc | Science |
| `chemistry` | Chemistry | stem_concept | Science |
| `biology` | Biology | stem_concept | Science |
| `math` | Mathematics | stem_calc | Science/Commerce |
| `english` | English | language | All |
| `economics` | Economics | stem_concept | Commerce/Humanities |
| `accountancy` | Accountancy | stem_calc | Commerce |
| `business_studies` | Business Studies | humanities | Commerce |
| `political_science` | Political Science | humanities | Humanities |
| `history_sr` | History | humanities | Humanities |
| `geography` | Geography | humanities | Humanities |
| `computer_science` | Computer Science | stem_calc | Any |
| `coding` | Coding | stem_calc | Any |

Board exams at Grade 12 (CBSE Class XII).

## Grade Format Checklist
- [ ] Stored as string: `"6"`, `"7"`, ..., `"12"`
- [ ] Never integer in DB columns, RPCs, API params, or TypeScript types
- [ ] Display: `"Class 6"` (en) / `"कक्षा 6"` (hi)
- [ ] DB column type: `TEXT` or `VARCHAR`, never `INTEGER`
- [ ] Validation: reject values outside `"6"`-`"12"` range

## Bloom's Taxonomy Levels
| Level | Code | Meaning | Typical Question Stem |
|---|---|---|---|
| 1 | `remember` | Recall facts | "What is...", "Name the...", "Define..." |
| 2 | `understand` | Explain concepts | "Explain why...", "Describe...", "What happens when..." |
| 3 | `apply` | Use in new situations | "Calculate...", "Solve...", "Apply the formula..." |
| 4 | `analyze` | Break down, compare | "Compare and contrast...", "What is the relationship..." |
| 5 | `evaluate` | Judge, justify | "Which approach is better and why...", "Evaluate..." |
| 6 | `create` | Design, construct | "Design an experiment...", "Propose a solution..." |

### Target Distribution by Exam Type
| Exam Type | remember | understand | apply | analyze | evaluate | create |
|---|---|---|---|---|---|---|
| Quick Check | 50% | 40% | 10% | 0% | 0% | 0% |
| Standard Test | 20% | 30% | 30% | 15% | 5% | 0% |
| Challenge | 10% | 15% | 25% | 30% | 15% | 5% |
| Full Exam | 15% | 20% | 25% | 20% | 15% | 5% |

These are targets. If the question bank lacks coverage at a level, serve what's available.

## Question Bank Entry Checklist
Before inserting any question:
- [ ] `question_text`: non-empty, no `{{`, `[BLANK]`, `TODO`, `FIXME`
- [ ] `options`: JSON array, exactly 4 elements, all non-empty strings, all distinct
- [ ] `correct_answer_index`: integer, 0 ≤ value ≤ 3
- [ ] `explanation`: non-empty, ≥ 20 characters, educationally useful (not just "Option B is correct")
- [ ] `difficulty`: one of `easy`, `medium`, `hard`
- [ ] `bloom_level`: one of `remember`, `understand`, `apply`, `analyze`, `evaluate`, `create`
- [ ] `grade`: string, `"6"` through `"12"`
- [ ] `subject`: valid code from the tables above, appropriate for the grade

### Optional Fields
- [ ] `chapter_number`: matches NCERT textbook chapter number for that grade+subject
- [ ] `topic_id`: UUID referencing `curriculum_topics`
- [ ] `board_year`: integer year if from board paper (e.g., 2024)
- [ ] `paper_section`: `"A"`, `"B"`, or `"C"` if from board paper
- [ ] `set_code`: board paper set identifier
- [ ] `source`: `"ncert"`, `"board_paper"`, `"generated"`, or `"curated"`

### Difficulty Distribution Target
- 30% easy
- 50% medium
- 20% hard

## Exam Timing Reference
| Category | Subjects | Easy | Medium | Hard |
|---|---|---|---|---|
| stem_calc | math, physics, CS, accountancy, coding | 90s | 150s | 210s |
| stem_concept | chemistry, biology, science, economics | 75s | 120s | 180s |
| language | english, hindi | 60s | 90s | 150s |
| humanities | social_studies, business, polisci, history_sr, geography | 60s | 105s | 165s |

Grade multiplier: 6→1.3, 7→1.25, 8→1.2, 9→1.1, 10→1.05, 11-12→1.0. Then +10% buffer, round up to 5 minutes.

## Content Gap Detection
Run `npx tsx scripts/check-content-gaps.ts` to audit:
- Missing subjects/grades in question bank
- Chapters with fewer than minimum questions
- RAG content chunk coverage
Requires env vars: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
