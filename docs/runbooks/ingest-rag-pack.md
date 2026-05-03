# Operator Runbook: Ingest a RAG Content Pack

Phase 4.5 of Goal-Adaptive Learning Layers. Use this runbook to upload a
content pack (PYQ board questions, JEE/NEET archive items, Olympiad
problems, curated NCERT supplements) into `rag_content_chunks` so it
becomes available to Foxy's retrieval pipeline.

## Prerequisites

- A pack file in JSONL format. Schema is enforced by
  `src/lib/rag/pack-manifest.ts`. See `data/rag-packs/sample-pyq-board-pack-v0.jsonl`
  for the reference shape.
- Environment variables set in your shell:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `VOYAGE_API_KEY`
- Migration `20260503200000_add_rag_pack_provenance.sql` applied to the
  target environment (Supabase staging or production).

## Pack file format

JSONL: first line is the **PackHeader**, remaining lines are **PackEntry**
records. One JSON object per line, no trailing comma.

### Header (line 1)

```json
{"pack_id":"cbse-board-pyq-math-grade10","pack_version":"v1","pack_source":"pyq","default_provenance":"public_domain","notes":"Optional operator note"}
```

| Field | Required | Notes |
|---|---|---|
| `pack_id` | yes | `^[a-z0-9_-]{4,80}$` (lowercase + digits + hyphen + underscore) |
| `pack_version` | yes | semver-style: `v1`, `1.0`, `v1.2.3` |
| `pack_source` | yes | `pyq` / `board_paper` / `jee_archive` / `neet_archive` / `olympiad` / `ncert_supplement` / `curated` |
| `default_provenance` | yes | `licensed` / `public_domain` / `generated` / `curated` |
| `notes` | no | free-form text shown in audit logs |

### Entry (lines 2..N)

```json
{"chunk_text":"...","grade":"10","subject":"math","chapter_number":4,"source":"pyq","exam_relevance":["CBSE_BOARD"],"provenance":"public_domain","board_year":2024,"difficulty_level":3}
```

Required: `chunk_text` (50-4000 chars), `grade` (string `"6"`-`"12"` per
P5), `subject`, `chapter_number` (integer ≥1), `source`, `exam_relevance`
(non-empty array), `provenance`.

Optional: `chapter_title`, `topic`, `concept`, `board_year` (2000-2100),
`difficulty_level` (1-5), `language` (`en` / `hi`).

## Steps

### 1. Validate locally with `--dry-run`

```bash
npx tsx scripts/ingest-rag-pack.ts --pack data/rag-packs/your-pack.jsonl --dry-run
```

Dry-run validates every entry and runs the manifest checks but does NOT
generate Voyage embeddings or insert into the database. Use this to catch
schema errors before spending Voyage credits.

Expected output on success:

```
Pack: your-pack-id v1 (DRY RUN)
Total entries: 50
Valid:           50
Already present: 0
Inserted:        50
Failed:          0
```

### 2. Ingest to **staging** first

Set staging env vars, then run without `--dry-run`:

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://<staging-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<staging-service-role>"
export VOYAGE_API_KEY="<voyage-key>"

npx tsx scripts/ingest-rag-pack.ts --pack data/rag-packs/your-pack.jsonl
```

The script is idempotent on `(pack_id, pack_version, chunk_text)` -
re-runs report `Already present: N` for chunks already inserted.

### 3. Smoke-test on staging

1. Flip `ff_goal_aware_rag=true` on staging (super-admin Flags).
2. Open Foxy as a student with `academic_goal='board_topper'` (matching
   the pack's intended goal).
3. Ask a question covering one of the chapters in the pack.
4. Inspect the structured response - verify the new chunks appear in the
   `chunks` array (look for `pack_id` matching your pack).

### 4. Promote to production

When staging looks good, repeat step 2 against production env vars.

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://<prod-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<prod-service-role>"
npx tsx scripts/ingest-rag-pack.ts --pack data/rag-packs/your-pack.jsonl
```

## Selective retraction

If a pack version needs to be removed (e.g. licensing change, content error):

```sql
DELETE FROM public.rag_content_chunks
 WHERE pack_id = 'your-pack-id'
   AND pack_version = 'v1';
```

Index `idx_rag_chunks_pack` keeps the delete fast even at scale. Legacy
NCERT chunks (with `pack_id IS NULL`) are unaffected.

## Provenance filtering

Free-tier or jurisdiction-restricted students can be served only
public-domain or curated content:

```sql
SELECT * FROM public.rag_content_chunks
 WHERE provenance IN ('public_domain','curated')
    OR provenance IS NULL  -- legacy NCERT
;
```

## Rollback

The migration is additive. If you need to drop the new columns (requires
user approval per CLAUDE.md):

```sql
ALTER TABLE public.rag_content_chunks
  DROP CONSTRAINT IF EXISTS rag_content_chunks_provenance_chk,
  DROP COLUMN IF EXISTS provenance,
  DROP COLUMN IF EXISTS pack_version,
  DROP COLUMN IF EXISTS pack_id;
```

The Phase 4 rerank degrades gracefully (chunks without `source` or
`exam_relevance` get neutral 1.0 weights) - dropping these columns
returns the system to legacy NCERT-only behavior.
