# Foxy Moat Plan — Phase 5: Reproducible CBSE Content Seed

> Status: documented (this file). Operational runbook so a fresh DB can
> rebuild the content corpus without tribal knowledge.

## Why this exists

Production currently holds **15,411 NCERT chunks** (Voyage v3 embedded,
distributed across grades 6–12 and all CBSE subjects) plus their parent
`cbse_syllabus` rows (683 chapters in scope). Re-creating that corpus in
a fresh environment (dev clone, DR drill, new region) was undocumented —
implicit knowledge spread across 6 Edge Functions and 30+ migrations.

Phase 5 captures the **exact sequence** so a new env reaches parity by
running scripts, not Slack archaeology.

## Inventory

| Artifact | Type | Where it lives |
|---|---|---|
| `cbse_syllabus` | DB rows | seeded by `supabase/migrations/202603*_cbse_syllabus_*.sql` |
| `chapters` | DB rows | seeded by `supabase/migrations/202603*_chapters_*.sql` |
| `rag_content_chunks` (text + embeddings) | DB rows + pgvector | populated by ingestion pipeline |
| `question_bank` (with embeddings) | DB rows + pgvector | populated by ingestion pipeline |
| `learning_objectives` | DB rows | seeded by editorial export (Phase 3) |
| `question_misconceptions` | DB rows | seeded by editorial export (Phase 3) |

## Pipeline order (dependency DAG)

```
1. supabase db push                      (all migrations, schema + RLS)
   ├─> cbse_syllabus rows seeded
   └─> chapters rows seeded

2. supabase functions deploy (29 functions)
   └─> ANTHROPIC_API_KEY, VOYAGE_API_KEY set as project secrets

3. extract-ncert-questions   (NCERT PDF -> question_bank rows)
   └─> writes question_bank.{question_text, options, correct_answer_index,
       difficulty, bloom_level, chapter_number, grade, subject_code}

4. extract-diagrams          (NCERT PDF -> rag_content_chunks media rows)
   └─> writes rag_content_chunks.{media_url, media_description}

5. generate-concepts         (chapter_concepts table populated)
   └─> chapter -> concept tree built

6. embed-questions           (question_bank.embedding via Voyage v3)
   └─> writes question_bank.embedding (1024-dim float vector)

7. embed-ncert-qa            (rag_content_chunks.embedding via Voyage v3)
   └─> writes rag_content_chunks.{chunk_text, embedding, chapter_title,
       topic, concept, page_number, syllabus_version}

8. embed-diagrams            (diagram-media chunk embeddings)
   └─> writes rag_content_chunks.embedding for media-only rows

9. generate-answers          (NCERT solution chunks for ncert-solver)
   └─> writes rag_content_chunks rows tagged content_type='solution'

10. generate-embeddings      (catch-up pass — re-embeds any missing rows)
    └─> idempotent; safe to rerun

11. SQL: UPDATE cbse_syllabus SET rag_status = 'ready' WHERE EXISTS (...)
    └─> see migration 20260428000200 for the canonical promotion query.
```

## One-shot reproducibility script

```bash
#!/usr/bin/env bash
# scripts/seed-content.sh — reproduce the CBSE content corpus end-to-end.
# Run only against a fresh / dev DB. Idempotent but slow (~3-5 hours full).

set -euo pipefail
PROJECT_REF="${SUPABASE_PROJECT_REF:?required}"

echo "1) Apply all migrations"
supabase db push --linked --include-all

echo "2) Deploy edge functions"
for fn in extract-ncert-questions extract-diagrams generate-concepts \
          embed-questions embed-ncert-qa embed-diagrams \
          generate-answers generate-embeddings grounded-answer; do
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF" --no-verify-jwt
done

echo "3) Run ingestion pipeline (idempotent — safe to re-run)"
for fn in extract-ncert-questions extract-diagrams generate-concepts \
          embed-questions embed-ncert-qa embed-diagrams \
          generate-answers generate-embeddings; do
  curl -X POST \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    "https://${PROJECT_REF}.supabase.co/functions/v1/${fn}" \
    -d '{"mode": "batch"}'
done

echo "4) Promote chapters with >=5 chunks to rag_status='ready'"
psql "${SUPABASE_DB_URL}" -f supabase/migrations/20260428000200_*.sql

echo "Done. Verify with:"
echo "  SELECT COUNT(*) FROM rag_content_chunks WHERE embedding IS NOT NULL;"
echo "  SELECT COUNT(*) FROM cbse_syllabus WHERE rag_status='ready';"
```

## Verification queries

After a full seed, these counts should match production-class numbers:

```sql
-- Embedded chunk count by subject (production: 15,411 total)
SELECT subject, COUNT(*) AS chunks
  FROM rag_content_chunks
 WHERE embedding IS NOT NULL AND is_active = true
 GROUP BY subject
 ORDER BY chunks DESC;

-- Ready-chapter count by grade
SELECT grade, COUNT(*) AS ready_chapters
  FROM cbse_syllabus
 WHERE rag_status = 'ready' AND is_in_scope = true
 GROUP BY grade
 ORDER BY grade;

-- Question bank embedded coverage
SELECT grade, subject_code,
       COUNT(*)                                              AS total_q,
       COUNT(*) FILTER (WHERE embedding IS NOT NULL)         AS embedded_q,
       COUNT(*) FILTER (WHERE irt_calibration_n >= 30)       AS irt_calibrated_q
  FROM question_bank
 WHERE is_active = true
 GROUP BY grade, subject_code
 ORDER BY grade, subject_code;
```

## Cost envelope (one full rebuild)

Assumes the full Grade 6-12 NCERT corpus.

| Pipeline step | Provider | Approx cost |
|---|---|---|
| `extract-ncert-questions` (Claude Haiku, ~6,000 questions) | Anthropic | ~$8 |
| `embed-questions` (Voyage v3, ~6,000 × 1024-dim) | Voyage AI | ~$0.20 |
| `embed-ncert-qa` (~15,000 chunks × 1024-dim) | Voyage AI | ~$0.50 |
| `generate-concepts` (Claude Haiku) | Anthropic | ~$5 |
| `generate-answers` (Claude Haiku) | Anthropic | ~$10 |
| **Total** | | **~$25 per full rebuild** |

(Estimates as of April 2026 pricing. Re-runs against an unchanged corpus
hit the cache and cost effectively zero.)

## Failure modes & recovery

| Symptom | Likely cause | Recovery |
|---|---|---|
| `ff_grounded_ai_foxy=true` but Foxy returns `chapter_not_ready` | `cbse_syllabus.rag_status` not promoted | re-run step 4 of seed script |
| Embedding count low for a subject | extract step crashed mid-batch | re-run that subject's `extract-*` Edge Function |
| `irt_a / irt_b` all NULL after weeks of traffic | `recalibrate_question_irt_2pl` cron not wired | check `vercel.json` crons + `CRON_SECRET` |
| 503 from `/api/foxy` with `upstream_error` | grounded-answer Edge Function missing `prompts/inline.ts` | redeploy via `supabase functions deploy grounded-answer` |
| Newly indexed chapter still shows `partial` | promotion query needs ≥5 chunks | bulk-import more chunks for that chapter, then re-run promote |

## Open follow-ups (not blocking Phase 5 completion)

- Migrate `extract-ncert-questions` to take `(grade, subject)` filters as
  function args so subject-by-subject reseeding is parallelisable.
- Add a `seed_runs` table that records each rebuild's start/end + counts
  so DR drills can produce diff reports.
- Pin Voyage and NCERT-PDF source SHAs in `seed_runs` so reproducibility
  is byte-deterministic (currently best-effort).
