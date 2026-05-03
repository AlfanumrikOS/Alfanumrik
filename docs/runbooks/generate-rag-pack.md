# Operator Runbook: Generate a RAG Content Pack with Claude (Track A)

Phase 4.6 Track A of Goal-Adaptive Learning Layers. Use this runbook
when you need to ship a new content pack quickly without licensing or
manually curating from PDFs. **Quality oracle gate**: every Claude-
generated chunk is scored on a 9-point rubric (factual accuracy +
CBSE scope + age-appropriateness) and rejected if it scores below 7.
This is the P12 (AI safety) compliance step - no unfiltered LLM
output reaches students.

## When to use this vs Track B

- **Track A (this)**: rapid iteration, no curator team yet, useful for
  filling gaps where neither NCERT nor licensed content exists. Marks
  pack as `provenance: 'generated'` for legal audit.
- **Track B**: highest-quality public-domain PYQ ingestion. Use this
  when the source content actually exists (CBSE board past papers,
  NCERT supplements). See `docs/runbooks/curate-public-domain-pyq.md`.

## Workflow

### 1. Author the outline JSON

Open `data/rag-packs/sample-generation-outline-class10-math.json` as a
template. Copy + edit:

```json
{
  "pack_id": "generated-class10-math-v0",
  "pack_version": "v0",
  "notes": "Optional curator note",
  "items": [
    {
      "subject": "math",
      "grade": "10",
      "chapter_number": 4,
      "chapter_title": "Quadratic Equations",
      "topic": "discriminant",
      "concept": "nature of roots from b^2 - 4ac",
      "count": 3
    }
  ]
}
```

Per-item:
- `count`: how many chunks Claude should generate for this (chapter,
  topic, concept) tuple. Typical: 3-5. Lower counts = higher per-chunk
  quality from the same total budget.
- `topic` / `concept`: optional but strongly recommended - they steer
  Claude towards the specific aspect you care about.

### 2. Validate the outline with --dry-run

```bash
npx tsx scripts/generate-rag-pack.ts \
  --outline data/rag-packs/your-outline.json \
  --out data/rag-packs/your-pack-v0.jsonl \
  --dry-run
```

Dry-run prints what WOULD be generated without calling Claude. Confirms
header validity + item counts.

### 3. Generate (real Claude calls)

Set the API key, drop `--dry-run`:

```bash
export ANTHROPIC_API_KEY="<your-key>"

npx tsx scripts/generate-rag-pack.ts \
  --outline data/rag-packs/your-outline.json \
  --out data/rag-packs/your-pack-v0.jsonl \
  --model haiku
```

For each item:
1. Claude generates `count` content chunks (200-700 chars each, no
   Markdown, no LaTeX).
2. Each chunk runs through `validatePackEntry` (manifest schema check).
3. Each schema-valid chunk is graded by a separate Claude call:
   - factual_accuracy: 0-3
   - cbse_scope: 0-3
   - age_appropriate: 0-3
   - total >= 7 to be accepted
4. Accepted chunks are written to the output JSONL with
   `provenance: "generated"`, `source: "curated"`,
   `exam_relevance: ["CBSE"]`.

Expected output:
```
Pack: generated-class10-math-v0 v0
Outline items: 2
Wrote 5 accepted chunks to data/rag-packs/your-pack-v0.jsonl
Items requested: 2
Items generated: 2
Chunks accepted: 5
Chunks rejected: 1
Rejection details:
  - math/grade10/ch4/discriminant: oracle_rejected total=6: missing example values
```

The script exits with code 0 if AT LEAST ONE chunk was accepted, or
code 1 if everything was rejected (treat as a generation failure;
revise the outline and retry).

### 4. Cost guidance

Each item produces ~`count` generation calls + `count` grader calls.
With Claude Haiku and avg 500 tokens output per call:
- 1 item, count=3 = ~6 Claude calls, ~3000 output tokens
- A 20-item outline = ~120 Claude calls

At Haiku pricing this is single-digit dollars for a meaningful pack.
Use `--model claude-sonnet-...` for higher-quality generation at
~10-12x the cost.

### 5. Manual review (REQUIRED)

Even after the oracle, a curator MUST eyeball the JSONL output before
ingestion. Open `data/rag-packs/your-pack-v0.jsonl` and read every
chunk_text. Look for:
- Factual errors the oracle missed (especially numerical/formula errors)
- Off-topic drift
- Repetitive phrasing across chunks
- Missing key concepts the outline asked for

Revise the outline and re-run if needed. Bump `pack_version` (e.g.
`v0` -> `v1`) on any post-review change.

### 6. Ingest via the Phase 4.5 pipeline

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://<staging-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<staging-service-role>"
export VOYAGE_API_KEY="<voyage-key>"

npx tsx scripts/ingest-rag-pack.ts --pack data/rag-packs/your-pack-v0.jsonl --dry-run
npx tsx scripts/ingest-rag-pack.ts --pack data/rag-packs/your-pack-v0.jsonl
```

### 7. Smoke-test on staging

1. Flip `ff_goal_aware_rag=true` on staging.
2. Open Foxy as any student (generated content is exam-neutral - it is
   tagged `exam_relevance: ["CBSE"]`, not specifically board / JEE /
   NEET / olympiad).
3. Ask a question that the new chunks should answer.
4. Verify the response cites a chunk with
   `pack_id = "generated-class10-math-v0"`.

## P12 compliance reminder

All generated content is marked `provenance: 'generated'` in the
database. To exclude generated content for sensitive cohorts:

```sql
SELECT * FROM public.rag_content_chunks
 WHERE provenance != 'generated'
    OR provenance IS NULL  -- legacy NCERT
;
```

The Phase 4 rerank treats `provenance` orthogonally to `source` - it
weights by `source` + `exam_relevance` only. A future Phase 4.7 could
add a per-plan provenance filter.

## Versioning + retraction

Same as Track B: bump `pack_version` on any change; retract by
`DELETE WHERE pack_id = ... AND pack_version = ...`.
