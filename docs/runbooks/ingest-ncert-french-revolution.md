# Operator Runbook: Ingest NCERT Grade 11 History — Chapter 8 "Confrontation of Cultures"

**Owner:** ops (super-admin or devops only)
**Date created:** 2026-06-24
**Status:** WORKAROUND — manual ingestion until `ingest-ncert-pdf` Edge Function ships (P0 tracked in NCERT coverage RCA)
**Estimated time:** 2-3 hours for a complete chapter ingestion including embedding and verification
**Trigger:** RAG evaluation harness (B1) confirmed via `eval/rag/golden/corpus-coverage-findings.md` that the g11/history_sr corpus is missing Chapter 8. The live `rag_content_chunks` corpus (16,006 rows, `source='ncert_2025'`) contains "Themes in World History Part 1" chapters on medieval feudalism and the Renaissance but NO French Revolution content. The chapter is registered in `cbse_syllabus` with `rag_status='missing'`.

---

## Who should run this

**Super-admin or devops only.** This runbook requires:
- Direct Supabase SQL editor or CLI access with service role credentials
- The ability to invoke Supabase Edge Functions with the admin key
- Access to the NCERT PDF (publicly available from ncert.nic.in)

Do NOT run this as a school admin or teacher account. The inserts require service role access that bypasses RLS.

---

## Background: what is missing and why it matters

The indexed g11/history_sr corpus is "Themes in World History Part 1" — 212 chunks across feudalism, the Renaissance, and early-modern themes (chapters 103-107 in the indexed PDF). Chapter 8 of the NCERT "Themes in World History" (2025 edition), titled "Confrontation of Cultures", covers the European encounter with the Americas and the French Revolution in its world-historical context. This chapter is entirely absent from the RAG corpus.

When a Grade 11 student asks Foxy about the French Revolution, the retrieval pipeline returns at best a tangential mention ("the Estates-General was not summoned again until 1789") from the medieval Three Orders chapter — not a faithful answer. The `cbse_syllabus` table already has a row for this chapter with `rag_status='missing'`, and the grounded-answer pipeline's abstain logic will refuse to answer rather than hallucinate, which is correct behavior but still leaves the student without help.

---

## Prerequisites

Before starting, confirm you have all of the following:

1. **Supabase project credentials** — set in your shell from `.env.local`:
   - `SUPABASE_URL` — the project URL (server-only; do NOT use `SUPABASE_URL` — that variable is browser-exposed and must not be used in operator shell scripts)
   - `SUPABASE_SERVICE_ROLE_KEY` — the service role key (bypasses RLS; never expose to client)

2. **Admin API key** for Edge Function calls:
   - `ADMIN_API_KEY` — the `x-admin-key` header value for Edge Function invocation

3. **NCERT PDF**: "Themes in World History" Grade 11 (2025 edition), Chapter 8 "Confrontation of Cultures". Download from: https://ncert.nic.in/textbook.php?kehs1=0-11 (History, Grade 11, Senior Secondary). The file is named something like `kehs108.pdf` (the `108` suffix indicates chapter 8 of the Grade 11 History Senior book).

4. **PDF text extraction tool**: any of the following:
   - `pdftotext` (poppler-utils, Linux/Mac): `pdftotext kehs108.pdf - > chapter8.txt`
   - Adobe Acrobat Reader: File > Export to > Text
   - Copy-paste from any PDF reader (slower but works for a single chapter)

5. **Access to the Supabase SQL editor** (https://supabase.com/dashboard/project/shktyoxqhundlvkiwguu/editor) or the Supabase CLI with the service role configured.

---

## Chapter identification guidance

The NCERT "Themes in World History" Grade 11 (2025 edition) uses a compound chapter numbering scheme in the PDF filenames (`kehs104.pdf` = chapter 4, etc.). Chapter 8 covers:

- The Aztec and Inca civilisations — the "pre-contact" Americas
- European voyages of exploration (Columbus, Vasco da Gama)
- The encounter and its consequences: disease, conquest, forced labour
- The French Revolution: causes (fiscal crisis, Estates-General, 1789), the Declaration of the Rights of Man, the abolition of feudalism, the role of Rousseau and Enlightenment ideas, the Terror, and Napoleon
- New political ideas: popular sovereignty, rights of citizens, nationalism

If you are uncertain whether a page belongs to Chapter 8, look for the chapter title "Confrontation of Cultures" in the running header, or check that the content is bounded by the preceding chapter on "Changing Cultural Traditions" (Renaissance/humanism) and the following chapter on "The Industrial Revolution".

Note that "The French Revolution" as a standalone topic does NOT have its own NCERT senior-secondary book — it appears as a theme within "Themes in World History". This chapter is the correct and complete source for French Revolution content at Grade 11.

---

## Step A — Obtain and prepare the chapter text

**Time estimate: 20-30 minutes**

1. Download the Grade 11 History senior-secondary PDF from ncert.nic.in. Navigate to: Textbooks > History > Class XI > Themes in World History.

2. Extract the chapter text. Using `pdftotext` (recommended — preserves paragraph structure):
   ```bash
   pdftotext -layout kehs108.pdf - > chapter8_raw.txt
   ```
   Or extract only the relevant page range if you have the full book:
   ```bash
   pdftotext -f <first_page> -l <last_page> -layout kehs1.pdf - > chapter8_raw.txt
   ```

3. Clean the extracted text:
   - Remove page headers and footers (running title, page numbers)
   - Remove figure captions that are image-only (keep captions that describe content)
   - Remove the "Source" citations under primary-source boxes — but DO keep the primary-source text itself (these are high-value for Foxy's RAG context)
   - Normalise whitespace: collapse multiple blank lines to single blank line
   - Ensure Devanagari or special characters are preserved in UTF-8

4. Plan your chunk boundaries. A good chunk is:
   - 300-500 tokens (roughly 200-350 words or 1,200-2,000 characters)
   - Split at paragraph boundaries, NOT mid-sentence
   - Each chunk should be self-contained: a student should be able to read the chunk alone and understand the key point
   - Avoid chunks that are purely transitional ("In the next section, we will see...")
   - Primary-source boxes (e.g. quotes from the Declaration of Rights of Man) should be their own chunk with `content_type = 'quote'`

   Expected chunk count for a standard NCERT chapter: 15-30 chunks.

---

## Step B — Insert base content chunks

**Time estimate: 45-60 minutes**

Open the Supabase SQL editor at: https://supabase.com/dashboard/project/shktyoxqhundlvkiwguu/editor

Run the following INSERT for EACH chunk you prepared in Step A. Replace the `{placeholders}` with real values.

```sql
INSERT INTO rag_content_chunks (
  grade, grade_short, subject, subject_code,
  chapter_number, chapter_title, chapter_text,
  topic, concept, content_type,
  source, board, language, syllabus_version,
  quality_score, is_active,
  text
)
VALUES (
  'Grade 11', '11', 'History', 'history_sr',
  8, 'Confrontation of Cultures',
  'Confrontation of Cultures',
  '{topic_name}',
  '{concept_name}',
  'content',
  'ncert_2025', 'CBSE', 'en', '2025-26',
  0.8, true,
  '{chunk_text_here}'
);
```

Replace the placeholders as follows:

| Placeholder | Guidance |
|---|---|
| `{topic_name}` | Broad topic within the chapter, e.g. `'The French Revolution'`, `'European Encounter with the Americas'`, `'Enlightenment Ideas'`, `'The Terror and Napoleon'` |
| `{concept_name}` | Specific concept, e.g. `'Declaration of Rights of Man'`, `'Estates-General'`, `'Popular Sovereignty'`, `'Aztec Civilisation'` |
| `{chunk_text_here}` | The raw text of this chunk. Single-quote escape any apostrophes inside the text by doubling them (`it''s`, `don''t`). |

For primary-source quote chunks (boxes in the NCERT text), use `content_type = 'quote'` instead of `'content'`.

For sub-headings or chapter-opening concept definitions, use `content_type = 'definition'`.

**Batch insert option** (faster): You can combine multiple values in a single INSERT statement:

```sql
INSERT INTO rag_content_chunks (
  grade, grade_short, subject, subject_code,
  chapter_number, chapter_title, chapter_text,
  topic, concept, content_type,
  source, board, language, syllabus_version,
  quality_score, is_active,
  text
)
VALUES
  ('Grade 11', '11', 'History', 'history_sr', 8, 'Confrontation of Cultures', 'Confrontation of Cultures',
   'The French Revolution', 'Estates-General 1789', 'content',
   'ncert_2025', 'CBSE', 'en', '2025-26', 0.8, true,
   'By the late eighteenth century, France was in a deep financial crisis...'),

  ('Grade 11', '11', 'History', 'history_sr', 8, 'Confrontation of Cultures', 'Confrontation of Cultures',
   'The French Revolution', 'Declaration of Rights of Man', 'content',
   'ncert_2025', 'CBSE', 'en', '2025-26', 0.8, true,
   'The National Assembly adopted the Declaration of the Rights of Man and Citizen in August 1789...')

  -- ... add remaining chunks ...
;
```

After inserting all chunks, verify the count:

```sql
SELECT COUNT(*) AS chunks_inserted
FROM rag_content_chunks
WHERE grade = 'Grade 11'
  AND subject_code = 'history_sr'
  AND chapter_number = 8
  AND source = 'ncert_2025'
  AND embedding IS NULL;
```

The result should be 15-30 rows (depending on how you chunked the chapter). If the count is 0, check that the INSERT executed without error. If the count is unexpectedly low, review whether you committed all chunks.

---

## Step C — Generate embeddings

**Time estimate: 5-10 minutes (depends on chunk count)**

After all chunks are inserted, invoke the `generate-embeddings` Edge Function to compute Voyage embeddings for the new chunks. The function processes chunks where `embedding IS NULL` for the specified grade and subject.

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/generate-embeddings" \
  -H "x-admin-key: ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"grade": "11", "subject": "history_sr"}'
```

Note: grades are strings (`"11"`, not `11`) per P5.

Wait for the function to complete. The response body will include a `processed` count. Confirm it matches the number of chunks you inserted in Step B.

If the function times out (Supabase Edge Functions have a 150-second wall-clock limit), re-invoke with the same payload — the function is idempotent and will skip chunks where `embedding IS NOT NULL`.

Verify embeddings were written:

```sql
SELECT
  chapter_number,
  chapter_title,
  COUNT(*) AS total_chunks,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded_chunks,
  COUNT(*) FILTER (WHERE embedding IS NULL) AS pending_chunks
FROM rag_content_chunks
WHERE grade = 'Grade 11'
  AND subject_code = 'history_sr'
  AND chapter_number = 8
GROUP BY chapter_number, chapter_title;
```

`embedded_chunks` should equal `total_chunks` before proceeding. If `pending_chunks > 0`, re-run the curl command.

---

## Step D — Generate Q&A pairs

**Time estimate: 5-15 minutes**

Generate structured Q&A pairs from the chapter content. These are used by Foxy's RAG pipeline for question-type queries and also feed the question bank seeding pipeline.

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/embed-ncert-qa" \
  -H "x-admin-key: ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"grade": "11", "subject": "history_sr"}'
```

This generates chunks with `content_type = 'qa'` in `rag_content_chunks`. These are distinct from the raw content chunks inserted in Step B. They improve hit-rate for "What is..." and "Why did..." style queries.

Verify Q&A pairs were generated:

```sql
SELECT COUNT(*) AS qa_pairs_generated
FROM rag_content_chunks
WHERE grade = 'Grade 11'
  AND subject_code = 'history_sr'
  AND chapter_number = 8
  AND content_type = 'qa';
```

Expected: at minimum 5-10 Q&A pairs for a standard chapter.

---

## Step E — Extract questions for question bank

**Time estimate: 10-20 minutes**

Extract practice questions from the chapter text for the question bank. The `extract-ncert-questions` function reads the raw content chunks and generates structured multiple-choice questions. These go through the AI quiz-generator validation oracle (REG-54) before being written to `question_bank`.

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/extract-ncert-questions" \
  -H "x-admin-key: ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"grade": "11", "subject": "history_sr", "chapter_number": 8}'
```

Note: `chapter_number` is passed as an integer in the JSON payload (this is the Edge Function API contract — the database stores grades as strings per P5, but `chapter_number` is always an integer).

Verify questions were generated and are pending verification:

```sql
SELECT verification_state, COUNT(*) AS count
FROM question_bank
WHERE grade = '11'
  AND subject = 'history_sr'
  AND chapter_number = 8
GROUP BY verification_state;
```

New questions arrive with `verification_state = 'pending'`. A content reviewer (assessment agent or ops) must promote these to `'verified'` before they appear in the learn picker. See the CMS at `/super-admin/cms` to review and verify questions.

---

## Step F — Generate concept cards

**Time estimate: 5-10 minutes**

Generate concept summary cards for the chapter. These are used in the Foxy "explain" and "revise" modes and in the student learn surface.

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/generate-concepts" \
  -H "x-admin-key: ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"grade": "11", "subject": "history_sr"}'
```

The function processes all chapters for the subject, so it will regenerate or supplement concept cards for the entire `history_sr` Grade 11 subject. This is idempotent.

---

## Step G — Update cbse_syllabus status

**Time estimate: 1 minute**

After ingestion is complete and you have verified chunks are embedded (Step C verification passed), update the chapter's status in `cbse_syllabus` to reflect that RAG content is now available.

```sql
UPDATE public.cbse_syllabus
SET
  rag_status = 'ready',
  last_verified_at = NOW(),
  updated_at = NOW()
WHERE board = 'CBSE'
  AND grade = '11'
  AND subject_code = 'history_sr'
  AND chapter_number = 8;
```

This unblocks the chapter in the `available_chapters_for_student_subject_v2` RPC, which filters on `rag_status IN ('partial', 'ready')`. Until this update runs, the chapter appears in Foxy's retrieval but is invisible in the student learn picker.

If some chunks are embedded but not all, use `rag_status = 'partial'` instead and re-run after completing Step C.

Confirm the update:

```sql
SELECT rag_status, last_verified_at
FROM public.cbse_syllabus
WHERE board = 'CBSE' AND grade = '11' AND subject_code = 'history_sr' AND chapter_number = 8;
```

Also log this operation to the audit trail:

```sql
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'content.ncert_chapter_ingested',
  'rag_content_chunks',
  NULL,
  jsonb_build_object(
    'grade', '11',
    'subject_code', 'history_sr',
    'chapter_number', 8,
    'chapter_title', 'Confrontation of Cultures',
    'source', 'ncert_2025',
    'runbook', 'docs/runbooks/ingest-ncert-french-revolution.md',
    'ingested_at', now()
  ),
  now()
);
```

---

## Step H — Verify with eval harness

**Time estimate: 5-10 minutes**

Run the RAG evaluation harness to confirm the new chunks improve retrieval quality for Grade 11 History queries. See `docs/runbooks/2026-06-14-rag-eval-harness-operation.md` for full harness operation details.

```bash
npm run eval:rag:harness -- --grade=11 --subject=history_sr
```

Note: the harness requires `SUPABASE_URL` (or `SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`, and `VOYAGE_API_KEY` in your environment. Run `vercel env pull .env.local` first if running locally.

Expected outcome: hit-rate@10 >= 0.9 for `history_sr` queries. The current g11/history_sr golden items (026-030) target "Themes in World History Part 1" in-corpus content (medieval feudalism, Renaissance humanism) that was already present — those queries should still resolve cleanly. French Revolution queries are NOT yet in the golden set (they were re-targeted away during the corpus gap discovery; see `eval/rag/golden/corpus-coverage-findings.md` §2a). After ingestion, assessment should add French Revolution seed queries to `eval/rag/golden/seed-queries.json` to close the measurement gap.

If the harness verdict is INCONCLUSIVE (missing Voyage key in the runner environment), check the operational prerequisites in `docs/runbooks/2026-06-14-rag-eval-harness-operation.md` Step A (Prerequisites, item 1).

---

## Verification queries (consolidated)

Run these after completing all steps to confirm the full pipeline executed correctly.

```sql
-- 1. Chunk count and embedding status
SELECT
  chapter_number,
  chapter_title,
  COUNT(*) AS total_chunks,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
  COUNT(*) FILTER (WHERE embedding IS NULL) AS not_embedded
FROM rag_content_chunks
WHERE grade = 'Grade 11'
  AND subject_code = 'history_sr'
  AND chapter_number = 8
GROUP BY chapter_number, chapter_title;

-- 2. Q&A pairs generated
SELECT COUNT(*) AS qa_pairs
FROM rag_content_chunks
WHERE grade = 'Grade 11'
  AND subject_code = 'history_sr'
  AND chapter_number = 8
  AND content_type = 'qa';

-- 3. Question bank entries (by verification state)
SELECT verification_state, COUNT(*) AS count
FROM question_bank
WHERE grade = '11'
  AND subject = 'history_sr'
  AND chapter_number = 8
GROUP BY verification_state;

-- 4. cbse_syllabus status
SELECT chapter_number, chapter_title, rag_status, last_verified_at
FROM cbse_syllabus
WHERE board = 'CBSE' AND grade = '11' AND subject_code = 'history_sr' AND chapter_number = 8;

-- 5. Audit log entry
SELECT action, details, created_at
FROM admin_audit_log
WHERE action = 'content.ncert_chapter_ingested'
  AND details->>'chapter_number' = '8'
ORDER BY created_at DESC
LIMIT 1;
```

### Expected results after successful ingestion

| Check | Expected |
|---|---|
| `total_chunks` | 15-30 |
| `embedded` | equals `total_chunks` |
| `not_embedded` | 0 |
| `qa_pairs` | >= 5 |
| Question bank `pending` | >= 5 (requires manual verification before going live) |
| `rag_status` | `ready` |
| Audit log entry | present with `ingested_at` timestamp |

---

## Rollback

If the ingestion needs to be undone (e.g. incorrect source text was used, wrong chapter):

```sql
-- Remove all chapter 8 chunks (content + qa types)
DELETE FROM rag_content_chunks
WHERE grade = 'Grade 11'
  AND subject_code = 'history_sr'
  AND chapter_number = 8
  AND source = 'ncert_2025';

-- Remove extracted questions (if they have not been verified — verified questions
-- should NOT be deleted without user approval per CLAUDE.md)
DELETE FROM question_bank
WHERE grade = '11'
  AND subject = 'history_sr'
  AND chapter_number = 8
  AND verification_state = 'pending';

-- Revert cbse_syllabus status
UPDATE public.cbse_syllabus
SET rag_status = 'missing', last_verified_at = NULL, updated_at = NOW()
WHERE board = 'CBSE' AND grade = '11' AND subject_code = 'history_sr' AND chapter_number = 8;
```

Do NOT delete verified questions without explicit user (CEO) approval — deleting verified curriculum content is a destructive operation per the CLAUDE.md approval gates.

---

## Long-term note: this is a workaround

This runbook is a **workaround for the absence of an automated PDF-to-chunk ingestion pipeline**. The 16,006 existing NCERT chunks were created by a legacy tool that is no longer present in the codebase. Every new chapter ingestion currently requires this manual operator process.

The permanent solution is the **`ingest-ncert-pdf` Supabase Edge Function**, tracked as a P0 item in the NCERT coverage RCA. Until that function ships, any new chapter (including other missing Grade 11 History chapters, or any future NCERT edition update) requires a full re-run of Steps A through H.

The full list of chapters currently at `rag_status = 'missing'` can be checked with:

```sql
SELECT grade, subject_code, chapter_number, chapter_title
FROM cbse_syllabus
WHERE board = 'CBSE' AND rag_status = 'missing'
ORDER BY grade, subject_code, chapter_number;
```

When the `ingest-ncert-pdf` function ships, retire this runbook and replace it with a reference to the new automated procedure.

---

## Related documents

- `eval/rag/golden/corpus-coverage-findings.md` — the gap discovery that triggered this runbook (B1 golden-set binding, 2026-06-14)
- `docs/runbooks/2026-06-14-rag-eval-harness-operation.md` — how to operate the RAG eval harness (Step H)
- `docs/runbooks/generate-rag-pack.md` — alternative: Claude-generated content for gap-filling when PDF source is unavailable
- `docs/runbooks/ingest-rag-pack.md` — JSONL-based pack ingestion pipeline (for PYQ / board papers)
- `docs/runbooks/curate-public-domain-pyq.md` — highest-quality public-domain PYQ curation (Track B)
- `supabase/migrations/20260624000100_seed_cbse_syllabus_manifest.sql` — complete CBSE curriculum chapter registry showing all `history_sr` chapters and their initial `rag_status`
