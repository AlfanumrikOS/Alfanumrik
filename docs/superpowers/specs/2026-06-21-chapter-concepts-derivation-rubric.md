# Chapter Concepts Derivation Rubric (grades 6-12, NCERT-derived)

**Owner:** assessment. **Status:** gating spec for the grade-7 + grade-9 pilot (ai-engineer builds the content; assessment signs off against this rubric before any bulk generation).
**Date:** 2026-06-21.
**Source corpus:** `rag_content_chunks` -> curated `chapter_concepts`.
**Consumer:** `src/lib/chapter-reader/get-concepts-from-table.ts` (`isUsableChapterDeck`).

This rubric is the QUALITY BAR. `isUsableChapterDeck` (>= 3 active concepts, title >= 3 chars, explanation >= 80 chars) is the FLOOR — necessary, not sufficient. A deck can pass the floor and still REJECT here.

---

## 1. Schema reference (verified on live DB 2026-06-21)

`chapter_concepts` columns relevant to derivation:

| Field | Type | NOT NULL | Rubric role |
|---|---|---|---|
| `grade` | text | yes | P5 string "6".."12" |
| `subject` | text | yes | valid subject code for the grade |
| `chapter_number` | int | yes | NCERT chapter; `0` = non-chapter sentinel (see below) |
| `chapter_id` | uuid | **yes** | FK -> `chapters.id`. Derivation MUST resolve this; rows cannot insert without it |
| `concept_number` | int | yes | 1-based order within chapter; unique with (grade,subject,chapter_number) |
| `title` / `title_hi` | text | title yes | concept name; technical terms not translated (P7) |
| `slug` | text | no | url-friendly |
| `learning_objective` / `_hi` | text | LO yes | one outcome sentence |
| `explanation` / `_hi` | text | expl yes | the concept card body — NOT a raw page dump |
| `key_formula` | text | no | LaTeX/plain, only if applicable |
| `example_title`, `example_content` / `_hi` | text | no | worked example |
| `common_mistakes`, `exam_tips`, `diagram_refs` | jsonb | no | default `[]` |
| `practice_question`, `practice_options`, `practice_correct_index`, `practice_explanation` | text/jsonb/int | no | embedded MCQ — if present, P6 applies in full |
| `difficulty` | int 1-3 | no | CHECK 1..3 (1=easy,2=medium,3=hard) |
| `bloom_level` | text | no | CHECK in remember/understand/apply/analyze/evaluate/create |
| `estimated_minutes` | int >0 | no | reading time |
| `rag_chunk_ids` | uuid[] | no | **provenance — populate it** (which chunks the card was derived from) |
| `is_active` | bool | yes | only active rows render |
| `source` | text | no | use `ncert_2025` (or `ncert_<year>`) |

Unique constraint: `(grade, subject, chapter_number, concept_number)`. Bloom/difficulty/practice-index CHECKs are DB-enforced; a violating row cannot insert.

---

## 2. Acceptance rubric for a derived concept CARD

A single card is ACCEPT only if all hold:

1. **Required fields non-empty:** `title` (>= 3 chars), `learning_objective`, `explanation`. `chapter_id` resolved. `concept_number` set and contiguous within the chapter (1..N, no gaps/dupes).
2. **Explanation is genuine prose, derived not dumped:** 120-700 chars (target ~150-450; the floor of 80 is a hard minimum, but a real concept rarely fits in 80). Must read as an explanation a grade-appropriate student understands — full sentences. REJECT if it is: a topic/term list ("Combination, Decomposition, Displacement..."), a "Key approach: ..." one-liner, verbatim copy of a single `chunk_text`, or starts mid-sentence (raw page slice).
3. **Learning objective** is one outcome sentence ("Understand how... / Identify and balance...").
4. **Bloom + difficulty are set and plausible** for the concept (a recall card is `remember`+1; a "balance the equation" card is `apply`+2). Not all left at the schema defaults (`understand`/2) across a whole chapter.
5. **key_formula** present iff the concept has one (STEM). Absent for language/humanities is correct, not a defect.
6. **Embedded MCQ (if present) passes P6 in full:** exactly 4 distinct non-empty options, `practice_correct_index` in 0..3, non-empty `practice_explanation`, and the question is SPECIFIC to THIS concept (see card-reject #4). Options must NOT carry baked-in "A) / B) /" prefixes — the renderer adds labels; prefixes in the text are a format defect.
7. **Bilingual (P7):** see section 4.
8. **Grade-appropriate + in CBSE scope (P12):** vocabulary and depth match the grade; content stays within the NCERT chapter it claims. No out-of-syllabus tangents, no content above/below the grade band.
9. **Provenance:** `rag_chunk_ids` populated with the source chunk(s). `source` set. `is_active=true`.

### Card REJECT conditions (any one rejects)
- Raw page-dump / verbatim single-chunk text, or a term-list / "Key approach:" stub masquerading as `explanation`.
- Broken encoding (mojibake), stray markup, `{{`, `[BLANK]`, `TODO`, `FIXME`, NCERT figure-caption fragments as the whole body.
- Duplicate `explanation` text across concepts in the same chapter (copy-paste), or duplicate `title`.
- **Recycled practice MCQ:** the same `practice_question`/`practice_options` reused across multiple concepts in a chapter (observed in grade-10 science today — a content defect, not a pass).
- Options with embedded "A)/B)/C)/D)" prefixes, fewer than 4 options, non-distinct options, or `practice_correct_index` out of 0..3 / inconsistent with options.
- `bloom_level` misspelled or outside the 6-level set; `difficulty` outside 1..3 (DB will also reject).
- English-only when a Hindi column is required (section 4).
- `chapter_number=0` sentinel used as a real learning card (sentinels are not part of a renderable deck).

---

## 3. Acceptance rubric for a CHAPTER (the deck)

A chapter PASSES only if:

| Criterion | Threshold |
|---|---|
| Active concepts (excluding chapter_number=0 sentinels) | **>= 3 (floor), recommended 4-7** for a standard NCERT chapter |
| Every card passes section 2 | yes (one rejecting card fails the chapter) |
| `concept_number` | contiguous 1..N, unique, ordered |
| Explanation lengths | every card >= 80 (floor); chapter avg >= 150 (target) |
| Bloom spread | **>= 2 distinct bloom levels** across the chapter (a chapter that is 100% `understand` is too flat). Lean lower for grades 6-8 (remember/understand/apply), allow higher (analyze/evaluate) for grades 11-12 |
| Difficulty spread | **>= 2 distinct difficulty levels** (not every card difficulty 2). Rough mix easy:medium:hard ~ 30:50:20, serve-what-exists |
| Duplicate explanations / titles | 0 |
| Recycled practice MCQs | 0 |

`isUsableChapterDeck` PASS == count>=3 AND every title>=3 AND every explanation>=80. The rubric PASS is stricter (adds spread, no-dup, no-recycle, prose-quality, bilingual). Both must hold to ship a chapter.

---

## 4. Bilingual expectation (P7) — decision for the pilot

**Finding (live DB):** the grade-10 corpus (271 rows, the de-facto "good" set) has ZERO Hindi (`title_hi`/`explanation_hi` empty on every row). The ONLY rows with real Hindi are the 6 grade-7 math ch.1 v2-backfill rows ("What is a Lakh?" etc.), which are the actual gold standard for bilingual prose.

The schema makes `title_hi`/`explanation_hi` **nullable**, so Hindi is not DB-enforced — but P7 requires user-facing text support both languages. Ruling for the derivation program:

- **Pilot (grade 7 + grade 9): Hindi is REQUIRED** on `title_hi` and `explanation_hi` for every card. `learning_objective_hi` and `example_content_hi` required when those fields are present. This is the only way the pilot validates the full bilingual pipeline before bulk. Model the grade-7 "Lakh" rows: natural Hindi prose, technical terms (lakh, NCERT, formula names, English coinages) left in Latin script / untranslated, math notation unchanged.
- **Grade-10 backfill is a known P7 GAP**, not a template to copy. Do NOT treat grade-10's English-only rows as acceptable. Track a follow-up to backfill grade-10 Hindi; until then grade-10 cards are "renders but P7-incomplete".
- A card is bilingual-REJECT if `explanation_hi` is just the English copied into the Hindi column, machine-garbled, or translates technical terms that should stay (P7).

---

## 5. Grade-10 assessment vs this rubric (deliverable #4)

Grade-10 is **partially** a good template — use the language chapters as the prose model, do NOT copy the science chapters or the English-only Hindi posture.

| Aspect | Grade-10 reality | Verdict |
|---|---|---|
| Density | language/most chapters 5-6 concepts; 3 chapter_0 sentinels + a few 1-concept stubs | language chapters PASS density; sentinel/stub chapters FAIL |
| Explanation prose | english/hindi chapters: real prose 234-498 avg (GOOD). science: term-list + "Key approach:" stubs (~150 chars, passes 80-floor but is a dump) | language PASS, **science REJECT (raw-dump/stub)** |
| Bloom/difficulty spread | language chapters 2-4 bloom, 1-3 difficulty (GOOD); science chapters flat (all `apply`/2) | mixed |
| Practice MCQ | present on ~64% of rows; **science recycles the SAME MCQ across concepts in a chapter** | **science REJECT (recycled MCQ)** |
| Option format | options carry baked-in "A)/B)/C)/D)" prefixes table-wide | **format defect (strip prefixes)** |
| Bilingual (P7) | zero Hindi across all 271 rows | **P7 GAP table-wide** |

**Conclusion:** Grade-10 english/hindi chapters are a valid PROSE template for the pilot. Grade-10 science chapters are NOT — they are the exact failure mode (term-list explanations, recycled MCQs) this rubric is built to catch, and would REJECT if generated fresh. The "A)/B)" option prefix and the table-wide Hindi absence are systemic defects to fix, not patterns to replicate.

---

## 6. Validation query

See `scripts/sql/validate-chapter-concepts.sql` (or run inline). Parameterise by grade. Returns per chapter: concept_count, min/avg explanation length, below-floor count, empty/duplicate title count, duplicate-explanation count, recycled-MCQ count, bloom/difficulty spread, Hindi coverage, and an `isUsableChapterDeck` PASS/FAIL plus the stricter RUBRIC PASS/FAIL.
