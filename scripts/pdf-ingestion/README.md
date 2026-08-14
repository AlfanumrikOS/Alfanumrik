# Curated-PDF Learning-Corpus Extractor (Phase 2)

PDF -> **typed learning units** -> `extract.json`. Offline, file-in / file-out.

Instead of blind paragraph chunks, this extracts *concept explanations, worked
examples, Q&A pairs, definitions, MCQs, tables and diagram captions* — because
typed units produce far better teaching quality when fed to Foxy as grounding.

**Phase 2 writes NOTHING to the database.** The output is a JSON file. A later
phase supplies the TypeScript loader.

## Install

```bash
python -m venv .venv-pdf
.venv-pdf/Scripts/pip install -r scripts/pdf-ingestion/requirements.txt   # Windows
# .venv-pdf/bin/pip install -r scripts/pdf-ingestion/requirements.txt     # POSIX
```

Do **not** add these deps to `python/requirements.txt` or `python/pyproject.toml`
— that is the deployed Cloud Run AI service.

## Run

```bash
cd scripts/pdf-ingestion

# dry run (the DEFAULT — writes nothing)
python -m extractor.cli /path/to/book.pdf \
  --grade 10 --subject Science --chapter 6 --chapter-title "Life Processes"

# actually write extract.json + extract.report.json
python -m extractor.cli /path/to/book.pdf \
  --grade 10 --subject Science --chapter 6 --chapter-title "Life Processes" \
  --out out/ch6.json --write
```

`--dry-run` is the default; `--write` is required to persist anything.

| Flag | Default | Notes |
|---|---|---|
| `--grade` | none | String `"6"`..`"12"` only (P5 — grades are never integers) |
| `--token-budget` | 500 | Applies to `concept_explanation` **only** |
| `--min-page-chars` | 200 | Per-**page** scanned-page floor |
| `--max-pages` | all | Read only the first N pages |
| `--json` | off | Print the run report as JSON |

## Unit types and their DB mapping

| `unit_type` | Trigger | `content_type` | `question_type` |
|---|---|---|---|
| `concept_explanation` | prose under a font-size heading | `content` | NULL |
| `definition` | `HEADING_RE` match | `content` | NULL |
| `worked_example` | `EXAMPLE_RE` + following solution | `content` | `example` |
| `qa_pair` | `QUESTION_RE` paired to `ANSWER_RE` | `qa` | `exercise` or `intext` |
| `mcq` | `QUIZ_RE` or >= 4 `OPTION_RE` hits | `qa` | `mcq` |
| `diagram_caption` | image + caption-shaped block | `diagram` | NULL |
| `table` | `extract_tables()` region | `content` | NULL |

Both columns are CHECK-constrained on `public.rag_content_chunks`
(`chk_rag_content_type`, `chk_rag_question_type`). `emit.py` holds explicit
allowlists and **validates before writing**, so a bad run fails offline instead
of half-loading a corpus.

`qa_pair` resolves to `exercise` when its `heading_path` matches
`EXERCISE_MARKER` (`exercis`, `अभ्यास`, `प्रश्नावली`, ...), otherwise `intext`.

## Chunking rules

1. **`worked_example` and `qa_pair` are ATOMIC.** Never split by token budget at
   any size. Splitting a solution from its problem is the single biggest defect
   in the current corpus. (`definition`, `mcq`, `table`, `diagram_caption` are
   atomic too.)
2. Only `concept_explanation` is budget-split, at ~500 tokens, with **one
   sentence of overlap** (the existing pipeline has zero overlap) and the owning
   heading prefixed onto every sub-chunk.
3. `heading_path` is carried as real metadata
   (`Chapter 6 > 6.2 Respiration > Anaerobic`), feeding `topic`/`concept` —
   NULL for the entire current corpus.
4. Headings are detected by **font-size percentile + bold flag**, never by an
   ALL-CAPS regex.

## `embedding_text` — deliberately terse

Each unit carries both `content` (shown to the model) and `embedding_text` (what
gets vectorized):

```
Grade 10 Science — Chapter 6: Life Processes
Anaerobic respiration — worked example
<content>
Answer: <answer>
```

There is **no** `Board: / Grade: / Subject: / Chapter: / Type: / Title:` label
prefix. The downstream retrieval floor is an **absolute** cosine (0.22), not a
relative one — every token of shared boilerplate drags all new vectors toward a
common direction and inflates their cosine uniformly, letting weak chunks clear
a floor that existing rows meet honestly. `Board` is dropped entirely (always
CBSE). Grade/subject/chapter/title/type stay because they discriminate.

## Quality gates

- **Boilerplate stripping** — running headers, page numbers, `Reprint 2025-26`
  footers. Two mechanisms: regex (catches the known `202 BIOLOGY` / `126` /
  `114 MATHEMATICS` pollution) **and** frequency (a digit-masked line recurring
  near a page edge on >= 60% of pages), which catches book-specific headers no
  regex could know about.
- **`content_sha256` per unit** for dedupe, over `unit_type + content + answer`.
- **NFC first.** `unicodedata.normalize('NFC', ...)` before anything else. PDF
  text layers emit precomposed forms such as U+0958 that NFC maps to
  `U+0915 U+093C`; unnormalized, two visually identical Hindi strings hash and
  embed differently. ZWNJ/ZWJ are preserved (they are meaningful in Devanagari).
- **Dehyphenation** across line breaks + ligature repair.
- **Scanned-page guard applied PER PAGE**, not per document. A 40-page PDF with
  3 scanned plates reports 3 skipped pages instead of silently losing them.
  Every skipped page is recorded in the run report with a reason.

## Deliberate non-goals

- **No OCR.** Tesseract on Devanagari and on math/science equations produces
  confidently-wrong text, and confidently-wrong text in a *grounding* corpus is
  worse than absent text because the abstain path never fires. Scanned pages go
  to the manual-review list.
- **No mojibake detection.** The TypeScript loader in a later phase reuses
  `scripts/ncert-ingestion/mojibake.ts`; a second implementation would drift.
- **No LLM calls.** Heuristics only. `units.classify_unit(fallback=...)` is a
  clean seam for a later narrow, flagged, default-off classify-only fallback —
  it is not implemented and not wired.
- **No DB, no Supabase client, no network.** Statically enforced by
  `tests/test_no_network_or_db.py`.

## PDF backend

`pdfplumber` (**MIT**), behind the thin `reader.py` adapter. Everything else in
the package depends only on the plain dataclasses `reader.py` exports.

**Do not swap in PyMuPDF/fitz** — it is AGPL-3.0-or-commercial and the licensing
call has not been made. If legal signs off, add a `PyMuPdfReader` in `reader.py`
and change `default_reader()`. Nothing else moves. `tests/test_no_network_or_db.py`
fails if `fitz`/`pymupdf` is imported anywhere.

## Tests

```bash
cd scripts/pdf-ingestion
python -m pytest tests/ -v
```

Tests are **fixture-based on synthetic text blocks** — there are no source PDFs
on disk in this repo (only previously-extracted images under
`tools/pdf-content-ingestor/data/assets/`). The suite therefore runs without
`pdfplumber` installed, which also pins `reader.py` as the only
PDF-library-aware surface.

Builders live in `_testsupport.py` at the tool root, not in `tests/`: making
`tests/` a package would create a third top-level module named `tests` in this
repo (alongside `python/tests` and the repo-root `tests/`, both of which have
`__init__.py`) and collide under any pytest run spanning them.

## Output contract

`extract.json`, versioned `extraction_version: "pdf_ingest/1.0.0"`:

```jsonc
{
  "extraction_version": "pdf_ingest/1.0.0",
  "report": { /* units by type, pages skipped + why, dedupe hits, ... */ },
  "units": [
    {
      "unit_type": "worked_example",
      "content": "...",
      "embedding_text": "...",
      "answer": "...",
      "title": "Anaerobic respiration",
      "heading_path": "Chapter 6 > 6.2 Respiration > Anaerobic",
      "page_start": 101, "page_end": 101,
      "content_sha256": "...",
      "source_document": "ncert-x-science.pdf",
      "source_hash": "...",
      "language": "en",
      "content_type": "content",
      "question_type": "example",
      "needs_review": false,
      "quality_score": 0.8
    }
  ]
}
```

### `quality_score`

Deterministic and honest, because the column is inert in production today (68%
NULL, every non-null value exactly `0.7`) — populating it properly turns the
existing 0.4 retrieval gate into a working lever.

| Score | Condition |
|---|---|
| 0.8 | heuristic-classified + resolved heading + >= 40 words |
| 0.6 | heuristic with a weak signal |
| 0.3 | unreviewed diagram caption |

Prose whose owning heading was resolved by the font-size detector counts as
heuristic-classified — otherwise `concept_explanation` (the bulk of any
textbook) could never reach 0.8 and the column would stay near-constant.

## Loader phase: `source = 'curated'` is already permitted

There is no schema blocker. `rag_content_chunks.rag_chunks_source_ncert_only`
**already allows `source = 'curated'`**: migration
`20260520000004_jee_neet_schema_unblock.sql:146-178` dropped the baseline's
narrow `CHECK (source = 'ncert_2025')` and re-added it wide over
`ncert_2025, jee_archive, neet_archive, olympiad, board_paper, pyq, curated`.
The old constraint *name* was kept on purpose, so the name no longer describes
what it checks. Curated non-NCERT chunks insert as-is and **no migration is
needed before the loader phase.**

`20260816000002_curated_learning_corpus.sql` does not alter this constraint; it
asserts it, raising a NOTICE when `'curated'` is allowed and a WARNING pointing
at `20260520000004` when it is not — so an environment missing that migration
fails loudly at migrate time rather than at first INSERT.

> ⚠️ **Never read a CHECK constraint's state off
> `00000000000000_baseline_from_prod.sql` alone.** Five migrations touch this one
> constraint, and last-write-wins by timestamp. This README previously quoted the
> baseline form and called it a blocker; it was not. Follow the chain:
> `grep -rn '<constraint_name>' supabase/migrations/*.sql`, then read the
> latest migration that ALTERs it.
>
> The `chk_rag_content_type` / `chk_rag_question_type` statement earlier in this
> file was re-verified the same way and is correct — those two are still at
> their baseline values, and `emit.py`'s allowlists must keep matching them.
