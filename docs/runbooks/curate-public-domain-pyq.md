# Operator Runbook: Curate Public-Domain CBSE Board PYQs (Track B)

Phase 4.6 Track B of Goal-Adaptive Learning Layers. Use this runbook to
turn publicly available CBSE board past papers into a content pack that
boosts retrieval quality for `board_topper` students.

## What "public-domain" means here

CBSE Class 10 and Class 12 board exam papers from prior years are
distributed for free on the official CBSE Academic site
(`https://academic.cbse.nic.in/`) and on widely-used preparation portals.
This runbook treats those *paraphrased* extracts as `provenance:
public_domain` for the purpose of the pack-manifest schema.

**Caveat:** the actual question wording belongs to CBSE. Do NOT
ingest verbatim copies. Curators MUST paraphrase / abstract each
question into a "concept passage" that captures the testable concept
without reproducing the exam text. This is the same standard used by
NCERT-aligned coaching materials.

## Workflow

### 1. Source the PDF
Download the PYQ PDF for the year/subject/grade from CBSE Academic.
Sample: `https://academic.cbse.nic.in/web_material/pyqp/PYQP_Class10_Mathematics_2024.pdf`

### 2. Curator extracts each question into a CSV row

Open `data/rag-packs/sample-board-pyq-class10-math.csv` as a template.
Copy it to a new file named after the pack you are building, e.g.
`data/rag-packs/cbse-board-pyq-math-grade10-v1.csv`.

Required columns (header row already in the template):
`subject,grade,chapter_number,chapter_title,topic,concept,board_year,difficulty_level,language,chunk_text`

Per-row guidelines:
- `chunk_text`: paraphrase the question + the testable concept into a
  flowing 200-700 character passage. Include keywords a student would
  type when searching ("discriminant", "AP sum", "sector area", etc.).
  Do NOT reproduce the original question verbatim.
- `subject`: lowercase code (`math`, `science`, `physics`, `chemistry`,
  `biology`, etc.).
- `grade`: P5 string `"10"` or `"12"` (no quotes needed in the CSV cell;
  the converter casts to string).
- `chapter_number`: integer matching the NCERT chapter number for that
  grade+subject.
- `board_year`: integer year (e.g. `2024`).
- `difficulty_level`: 1 (easiest) - 5 (hardest). Typical board questions
  are 2-3.
- `language`: `en` or `hi`.

### 3. Validate locally with dry-run

```bash
npx tsx scripts/csv-to-rag-pack.ts \
  --csv data/rag-packs/cbse-board-pyq-math-grade10-v1.csv \
  --pack-id cbse-board-pyq-math-grade10 \
  --pack-version v1 \
  --out data/rag-packs/cbse-board-pyq-math-grade10-v1.jsonl \
  --dry-run
```

Expected output:
```
Pack: cbse-board-pyq-math-grade10 v1 (DRY RUN)
CSV rows (excluding header): N
Valid:    N
Rejected: 0
```

If any rows are rejected, the script prints the row number + reason.
Common issues:
- `chunk_text` shorter than 50 chars (paraphrase more)
- `chunk_text` longer than 4000 chars (split into multiple rows)
- `chapter_number` not an integer (typo)
- `language` not `en` or `hi`

### 4. Convert to JSONL (drop --dry-run)

```bash
npx tsx scripts/csv-to-rag-pack.ts \
  --csv data/rag-packs/cbse-board-pyq-math-grade10-v1.csv \
  --pack-id cbse-board-pyq-math-grade10 \
  --pack-version v1 \
  --out data/rag-packs/cbse-board-pyq-math-grade10-v1.jsonl
```

This writes the JSONL pack file. Re-runs OVERWRITE the output, so
re-running after fixing CSV errors is idempotent at the file level.

### 5. Ingest the pack (Phase 4.5 pipeline)

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://<staging-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<staging-service-role>"
export VOYAGE_API_KEY="<voyage-key>"

# First dry-run via the ingestion script
npx tsx scripts/ingest-rag-pack.ts --pack data/rag-packs/cbse-board-pyq-math-grade10-v1.jsonl --dry-run

# Then real ingest
npx tsx scripts/ingest-rag-pack.ts --pack data/rag-packs/cbse-board-pyq-math-grade10-v1.jsonl
```

The ingestion is idempotent on `(pack_id, pack_version, chunk_text)`;
re-runs report `Already present: N` for chunks already inserted.

### 6. Smoke-test on staging

1. Flip `ff_goal_aware_rag=true` on staging via super-admin Flags console.
2. Open Foxy as a student with `academic_goal='board_topper'`,
   `grade='10'`, `preferred_subject='math'`.
3. Ask a question covering one of the chapters in the pack.
4. Inspect the structured response - verify a chunk with
   `pack_id = 'cbse-board-pyq-math-grade10'` appears in the
   `chunks` array AT THE TOP (Phase 4 boost: PYQ chunks get 1.5x for
   `board_topper`).

### 7. Promote to production

Repeat step 5 with prod env vars after staging looks good.

## Selective retraction

If a pack version needs to be removed (content error, licensing concern):

```sql
DELETE FROM public.rag_content_chunks
 WHERE pack_id = 'cbse-board-pyq-math-grade10'
   AND pack_version = 'v1';
```

## Versioning

Bump `pack_version` (e.g. `v1` -> `v2`) when:
- Chunks are revised after curator review
- Additional questions are added to the pack
- Schema/format changes upstream

Pack ingestion is keyed on `(pack_id, pack_version, chunk_text)` so
multiple versions can coexist; retract the old version when promoting
the new one.
