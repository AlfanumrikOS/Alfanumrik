# Curated-PDF Ingestion — agent notes

**Owner: ai-engineer.** Assessment reviews taxonomy/classification correctness
and curriculum scope (P14 chain: AI tutor behaviour / RAG-retrieval changes ->
assessment + testing).

Phase 2 = extraction only. `extractor/` turns a PDF into `extract.json`. It
writes no rows, opens no sockets, and calls no model. See `README.md` for usage.

## Hard constraints — reject any change that breaks these

1. **No DB, no Supabase client, no network, no LLM, no OCR.** Statically
   enforced by `tests/test_no_network_or_db.py`, which AST-scans every module in
   `extractor/` for forbidden import roots and URL literals. If you add a
   capability, that test is the thing that will stop you — do not weaken it to
   make a change pass.
2. **`--dry-run` is the CLI default.** `--write` must stay an explicit opt-in.
3. **`worked_example` and `qa_pair` are ATOMIC** — never budget-split at any
   size. This is the single biggest defect in the current corpus.
4. **`pdfplumber` (MIT) only.** PyMuPDF/`fitz` is AGPL-3.0-or-commercial and the
   licensing call has **not** been made. It must stay in the forbidden-import
   list until legal signs off.
5. **`content_type` / `question_type` allowlists in `emit.py` are DB CHECK
   constraints**, not preferences (`chk_rag_content_type`,
   `chk_rag_question_type` on `public.rag_content_chunks`). If the migration
   changes, `emit.py` changes in the same PR.
6. **P5:** grade is a string `"6"`..`"12"`. `validate_items()` rejects an int.
7. **P13:** no PII in logs or the run report. The report carries counts, page
   numbers, and structural page-furniture samples only.

## Where dependencies go

`scripts/pdf-ingestion/requirements.txt` — **its own file, deliberately**.

Do **not** add PDF libraries to `python/requirements.txt` or
`python/pyproject.toml`. That directory is the deployed Cloud Run AI service
(`.github/workflows/python-ai-deploy.yml`, `license = "Proprietary"`); a
dependency added there ships inside a distributed service image. This tool is
offline and never deployed.

This tool is also **not** registered in `python/pyproject.toml`'s `testpaths`,
so it cannot drag `pdfplumber` into the service's dependency graph or its
`--cov-fail-under=58` gate. Run its tests explicitly:

```bash
cd scripts/pdf-ingestion && python -m pytest tests/ -v
```

## Module map

| File | Responsibility |
|---|---|
| `extractor/reader.py` | pdfplumber adapter -> `PageBlocks`. The ONLY PDF-library-aware file; `import pdfplumber` is lazy and inside `read()`. Swap point for a future backend. |
| `extractor/taxonomy.py` | Compiled regexes. The 6 English patterns are **verbatim** from a prior working run on real CBSE PDFs — do not re-derive them. Devanagari siblings alongside for P7. |
| `extractor/normalize.py` | NFC -> ligatures -> dehyphenation -> boilerplate stripping. Order is load-bearing. |
| `extractor/units.py` | Heading detection, segmentation, classification, answer pairing, budget splitting. |
| `extractor/emit.py` | `ContentItem`, DB allowlists, `embedding_text`, `content_sha256`, `quality_score`, run report. |
| `extractor/cli.py` | argparse; `extract_from_document()` is the reader-independent, directly unit-testable half. |
| `_testsupport.py` | Synthetic block builders. At the tool root, NOT in `tests/` — see below. |

## Gotchas discovered while building this

- **`tests/` must not be a package.** The repo already has two top-level `tests`
  packages (`python/tests` and repo-root `tests/`, both with `__init__.py`).
  Adding a third collides under any pytest run spanning them. Helpers live in
  `_testsupport.py` at the tool root; `conftest.py` puts that dir on `sys.path`.
- **The verbatim `ANSWER_RE` is `^`-anchored**, so it cannot see
  `Q1. ... Ans: ...` set on ONE physical line (segmentation flattens newlines
  into a unit). `taxonomy.ANSWER_INLINE` is **derived** from the verbatim
  constant by stripping the `^` and adding a word-boundary lookbehind — derived,
  not rewritten, so the verbatim patterns stay the single source of truth.
  Applied only to question/example types, so a stray "solution:" in prose is
  never an answer boundary.
- **Table text must bypass `join_lines()`.** That helper flattens newlines for
  prose; on a table it mashes every row into one line and destroys the
  structure. `RawUnit.raw_text` is the escape hatch.
- **Figure captions must be *claimed*.** A caption line lives in the normal line
  stream too, so without claiming it is emitted twice — once as
  `diagram_caption`, once as prose. `_claim_captions()` runs before segmentation
  and removes the line by identity. Only caption-SHAPED lines
  (`Fig. 6.2 ...` / `चित्र 6.2 ...`) qualify; an arbitrary nearest line is
  deliberately not used as a fallback, since that both invents a caption the
  book never wrote and duplicates real prose.
- **`quality_score` must not collapse to one value.** That is the production
  defect being fixed. Prose under a font-size-resolved heading is promoted to a
  `strong` signal, otherwise `concept_explanation` could never reach 0.8 and the
  column would stay near-constant like today's `0.7`.
- **U+0958 (and friends) are Unicode composition *exclusions*.** NFC maps them
  to `U+0915 U+093C`, so the normalization that matters here runs
  precomposed -> decomposed, not the other way round. `test_normalize.py`
  documents this; a naive `NFD`-based test asserts nothing because NFD of a
  nukta sequence is already that sequence.

## `source = 'curated'` is already allowed — the loader is NOT schema-blocked

`rag_content_chunks.rag_chunks_source_ncert_only` **permits `source = 'curated'`
today.** Migration `20260520000004_jee_neet_schema_unblock.sql:146-178` dropped
the baseline's narrow `CHECK (source = 'ncert_2025')` and re-added it wide:
`ncert_2025, jee_archive, neet_archive, olympiad, board_paper, pyq, curated`.
The constraint *name* was deliberately kept (so existing greps still find it),
which makes the name misleading — read its definition, not its name. Curated
non-NCERT chunks insert as-is; **no new migration is needed for Phase 3.**

`20260816000002_curated_learning_corpus.sql:596-649` deliberately does not ALTER
this constraint — it only *asserts* the widened state, raising a NOTICE when
`'curated'` is allowed and a WARNING naming `20260520000004` when it is not. An
environment that somehow missed that migration is therefore caught at migrate
time, not at first INSERT.

> ⚠️ **Determine constraint state by following the whole migration chain, never
> by reading `00000000000000_baseline_from_prod.sql` alone.** Five migrations
> touch this single constraint and last-write-wins by timestamp; the baseline
> shows the *original* narrow form. This file previously documented that stale
> baseline form as a hard blocker — it was never one. Check with
> `grep -rn '<constraint_name>' supabase/migrations/*.sql` and read the
> highest-timestamped migration that actually ALTERs it.
>
> This warning does **not** overturn constraint #5 above:
> `chk_rag_content_type` and `chk_rag_question_type` were re-checked the same
> way and genuinely are still at their baseline values — nothing later widened
> them — so the `emit.py` allowlists stand as written.

## Not in scope here

- `scripts/ncert-ingestion/` — a separate, untouched pipeline. Do not modify it.
- Mojibake detection — the later TS loader reuses
  `scripts/ncert-ingestion/mojibake.ts`; a second implementation would drift.
- Embedding generation — later phase, and it calls a paid API.
