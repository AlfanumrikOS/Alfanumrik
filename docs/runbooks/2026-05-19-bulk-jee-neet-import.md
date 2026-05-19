# Bulk PYQ Ingestion — `bulk-jee-neet-import` Edge Function

**Owner:** ai-engineer (pipeline) + assessment (content QA)
**Status:** PR-2 of the JEE/NEET scaling roadmap. Deploys after PR-1 (schema widen) lands.
**Audience:** Internal operator (CEO / content lead) running one-time PYQ batches.

This runbook walks an operator through ingesting previous-year questions
(JEE Main, JEE Advanced, NEET UG, INMO/RMO Olympiad) into `question_bank`
and `rag_content_chunks`.

The pipeline is intentionally **back-office, manual, and idempotent** — it
is not student-facing and never runs on a cron. Each call is operator-driven,
auditable in `ops_events` under `category='content.pyq_ingestion'`, and safe
to retry on partial failure.

---

## 1. Where to obtain JEE / NEET / Olympiad PYQ data

| Source | Where | License | Format |
|---|---|---|---|
| JEE Main | <https://jeemain.nta.nic.in> → "Previous Year Papers" | NTA public archive (Govt. of India open data) | PDF (per shift, per session) |
| JEE Advanced | <https://jeeadv.ac.in> → "Archive" | IIT consortium public archive | PDF |
| NEET UG | <https://neet.nta.nic.in> → "Previous Year Papers" | NTA public archive | PDF |
| Olympiad (INMO, RMO, INPHO, INChO, INBO) | <https://olympiads.hbcse.tifr.res.in> | HBCSE public archive | PDF |
| Coaching content (Allen, Aakash, Resonance) | Vendor-licensed only | **Requires written license — DO NOT scrape** | Vendor JSON |

The pipeline expects **JSONL** (one paper per line). The runbook ships an
OCR + GPT-extraction helper script under `scripts/jee-neet-pdf-to-jsonl.ts`
(not part of this PR). For PR-2, the operator hand-crafts a JSONL file from
the canonical NTA / HBCSE archives.

---

## 2. JSONL format spec

The Edge Function accepts a **JSON object** (not raw JSONL — one HTTP POST = one batch).
Operators wrap N papers into one batch; the runbook's JSONL is the
intermediate file you `jq`-build into the POST body.

### Per-paper schema

```jsonc
{
  "exam_session": "JEE_MAIN_JAN_2024_SHIFT1",   // ≤ 80 chars, unique-ish label
  "exam_year": 2024,                            // 2000..2100
  "subject": "physics",                         // physics | chemistry | math | biology
  "grade": "12",                                // P5: string "11" or "12" for JEE/NEET
  "questions": [
    {
      "question_number": "Q15",                 // unique within paper, ≤ 32 chars
      "paper_pattern": "mcq_4",                 // see "Paper patterns" below
      "question_text": "A block of mass 2 kg slides down a frictionless incline at 30°. Find the acceleration.",
      "options": ["5 m/s²", "4.9 m/s²", "9.8 m/s²", "2.45 m/s²"],
      "correct_answer_index": 1,                // 0-based; required for mcq_4 / mcq_5
      "marks_correct": 4,
      "marks_wrong": -1,                        // JEE: −1; NEET: −1; Olympiad / NEET-UG2024: 0
      "time_estimate_seconds": 120
    },
    {
      "question_number": "Q22",
      "paper_pattern": "integer",
      "question_text": "How many lattice points are at the corners of a BCC unit cell?",
      "correct_answer_text": "8",               // required for integer / numerical / matrix_match
      "marks_correct": 4,
      "marks_wrong": 0,
      "time_estimate_seconds": 180
    }
  ]
}
```

### Paper patterns

| `paper_pattern` | Description | Required fields |
|---|---|---|
| `mcq_4` | 4-option MCQ (standard JEE Main / NEET) | `options[4]`, `correct_answer_index ∈ 0..3` |
| `mcq_5` | 5-option MCQ (some JEE shifts) | `options[5]`, `correct_answer_index ∈ 0..4` |
| `integer` | Single integer answer (JEE Advanced) | `correct_answer_text` |
| `numerical` | Decimal numerical (NEET 2023+) | `correct_answer_text` |
| `matrix_match` | Multi-row matching (JEE Adv legacy) | `correct_answer_text` (free-form key) |
| `subjective` | Long-form Olympiad question | `correct_answer_text` |

### Batch envelope

The Edge Function POST body wraps N papers:

```json
{
  "source_type": "jee_archive",
  "dry_run": false,
  "papers": [ /* one or more paper objects from above */ ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `source_type` | yes | `jee_archive` \| `neet_archive` \| `olympiad` |
| `dry_run` | yes (no default) | `true` = validate + summarise, no DB writes, no Claude calls. `false` = full ingestion. |
| `papers` | yes, non-empty | Array of paper objects |

**Per-call cap:** 100 questions total across all papers. The Edge Function
returns 413 if exceeded. Split larger batches manually.

---

## 3. Sample input (test payload)

A minimal one-question dry-run smoke test:

```bash
cat > /tmp/pyq-sample.json <<'EOF'
{
  "source_type": "jee_archive",
  "dry_run": true,
  "papers": [
    {
      "exam_session": "JEE_MAIN_JAN_2024_SHIFT1",
      "exam_year": 2024,
      "subject": "physics",
      "grade": "12",
      "questions": [
        {
          "question_number": "Q1",
          "paper_pattern": "mcq_4",
          "question_text": "A block of mass 2 kg slides down a frictionless incline at 30°. Find the acceleration.",
          "options": ["5 m/s²", "4.9 m/s²", "9.8 m/s²", "2.45 m/s²"],
          "correct_answer_index": 1,
          "marks_correct": 4,
          "marks_wrong": -1,
          "time_estimate_seconds": 120
        }
      ]
    }
  ]
}
EOF
```

---

## 4. Invoking the Edge Function

### Prerequisites
- PR-1 has merged and the schema migration is applied (verify with the
  monitoring query in section 5).
- `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_API_KEY` are set
  as Supabase Edge Function secrets (one-time).
- The function is deployed: `supabase functions deploy bulk-jee-neet-import --project-ref shktyoxqhundlvkiwguu`.

### curl invocation

```bash
ADMIN_KEY="$(vercel env pull .env.local && grep ADMIN_API_KEY .env.local | cut -d= -f2-)"

curl -X POST \
  "https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/bulk-jee-neet-import" \
  -H "Authorization: Bearer ${ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/pyq-sample.json | jq .
```

Expected dry-run response shape:
```jsonc
{
  "dry_run": true,
  "source_type": "jee_archive",
  "papers": [
    {
      "exam_session": "JEE_MAIN_JAN_2024_SHIFT1",
      "exam_year": 2024,
      "subject": "physics",
      "grade": "12",
      "total": 1,
      "accepted": 1,         // dry-run always counts schema-valid rows as accepted
      "rejected": 0,
      "duplicates": 0,
      "errors": 0,
      "outcomes": [ { "question_number": "Q1", "status": "accepted", "reason": "dry_run" } ]
    }
  ],
  "llm_calls_total": 0,      // dry-run skips Claude entirely
  "elapsed_ms": 42
}
```

Then re-run with `"dry_run": false` to do the real ingestion.

### Auth alternatives
The function accepts either:
- `Authorization: Bearer <ADMIN_API_KEY>` (preferred — task spec)
- `x-admin-key: <ADMIN_API_KEY>` (sibling parity with `embed-*` / `extract-*`)

Both use **constant-time comparison** (`_shared/auth.ts`). No timing oracle.

---

## 5. Monitoring ingestion progress

### Live counts (operator dashboard)

```sql
-- All PYQ questions ingested, by source
SELECT source_type, COUNT(*) AS rows
FROM question_bank
WHERE source_type IN ('jee_archive', 'neet_archive', 'olympiad')
GROUP BY source_type
ORDER BY source_type;

-- By exam session / year
SELECT source_type, exam_session, exam_year, COUNT(*) AS questions
FROM question_bank
WHERE source_type IN ('jee_archive', 'neet_archive', 'olympiad')
GROUP BY 1, 2, 3
ORDER BY exam_year DESC, exam_session;

-- Verification state (oracle-accepted vs pending review)
SELECT source_type, verification_state, COUNT(*) AS rows
FROM question_bank
WHERE source_type IN ('jee_archive', 'neet_archive', 'olympiad')
GROUP BY 1, 2
ORDER BY 1, 2;
```

### Ops-events (per-batch audit log)

```sql
-- Latest ingestion batches
SELECT occurred_at, severity, message, context
FROM ops_events
WHERE category = 'content.pyq_ingestion'
  AND source   = 'bulk-jee-neet-import'
ORDER BY occurred_at DESC
LIMIT 20;

-- Oracle rejection breakdown
SELECT context ->> 'oracle_category' AS reason,
       COUNT(*)
FROM ops_events
WHERE category = 'content.pyq_ingestion'
  AND message ILIKE '%Oracle rejected%'
  AND occurred_at > now() - interval '7 days'
GROUP BY 1
ORDER BY 2 DESC;
```

### RAG chunks created

```sql
SELECT source, exam_relevance, COUNT(*) AS chunks
FROM rag_content_chunks
WHERE source IN ('jee_archive', 'neet_archive', 'olympiad')
GROUP BY 1, 2
ORDER BY 1;
```

---

## 6. Handling rejections

The function returns three "non-accepted" outcomes per question:

| `status` | Meaning | Operator action |
|---|---|---|
| `duplicate` | Same `(exam_session, exam_year, question_number)` already in DB | None — idempotent re-run is safe |
| `rejected` | Oracle declared the candidate inconsistent (REG-54) | See "Oracle false-negatives" below |
| `error` | Network / parse / DB error during pipeline | Re-run; if persistent, file an issue |

### Oracle false-negatives (REG-54 spirit)

The REG-54 oracle is intentionally conservative — it prefers dropping a
question over serving one with a wrong answer. Common false-negative causes:

1. **`numeric_inconsistency`** — the explanation arrived at the right
   answer but used different intermediate numbers than the option text
   (e.g. `9.8 × 0.5 = 4.9` vs option `"4.9 m/s²"`). Usually fine; reset by
   re-running the batch (Claude variability) or hand-curating the row.
2. **`llm_mismatch`** — the grader believes a different option is correct.
   These are the genuine bugs; investigate the source PDF.
3. **`llm_grader_unavailable`** — transient timeout / network. Re-run.

To re-process a specific rejection:
```bash
# Pull the failed batch from ops_events, fix the source JSONL, re-POST.
# Idempotency means the rest of the batch won't double-insert.
```

### mcq_5 / integer / numerical pass-through

The current oracle (REG-54) only grades **`mcq_4`** candidates. The function
logs `Oracle skipped (paper_pattern=mcq_5 …)` and inserts those rows with
`verification_state = 'pending'`. Admin review (manual sample) is required
before marking them `verified`. PR-3 widens the oracle to grade `mcq_5` and
`integer` patterns; this runbook is updated when PR-3 ships.

---

## 7. Cost estimate

| Per question | Approx tokens | Cost (Haiku @ $0.25 / $1.25 per MTok in/out) |
|---|---|---|
| Concept classification | ~600 in + ~80 out | $0.00025 |
| Difficulty estimation | ~500 in + ~30 out | $0.00017 |
| Explanation (RAG-grounded) | ~1,800 in + ~400 out | $0.00095 |
| Oracle grader (MCQ only) | ~400 in + ~80 out | $0.00020 |
| **Total per accepted MCQ** | **~3,300 in + ~590 out** | **~$0.001** |

**Per-batch cost (100 questions):** ≈ **$0.10**.

**Full JEE Main archive cost ballpark** (≈ 2,400 questions across 12 years
× 2 sessions × 4 shifts × 25 Qs ≈ 9,600 PYQs, of which roughly half map
cleanly to NCERT Class 11/12): **≈ $5** for ingestion + Claude calls.

This excludes:
- The nightly `embed-questions` cron Voyage embedding cost (handled separately,
  ~$0.02 per 1,000 questions).
- Operator labour to extract PDFs into JSONL (one-time, can be partially
  automated with `scripts/jee-neet-pdf-to-jsonl.ts` once it ships).

---

## 8. Bulk import schedule

| Phase | Volume | Cadence | Notes |
|---|---|---|---|
| Pilot | 100 Qs (1 batch) | One-off, dry-run first | Sanity-check the pipeline end-to-end |
| JEE Main backlog | ~5,000 Qs | 100 / batch × 30 batches / hour | Hand-paced; Edge Function timeout is 120 s, so each batch is well under budget |
| NEET UG backlog | ~4,000 Qs | Same cadence | After JEE Main |
| Olympiad backlog | ~1,000 Qs | Single afternoon | Smaller surface; oracle skips for subjective patterns |

**Pacing rule:** at most 30 batches/hour (≈ 3,000 questions/hour) to stay
under Anthropic Haiku rate limits. The Edge Function does NOT self-rate-limit
beyond the circuit breaker (3 failures in 60 s → 60 s open window). Operator
must pace manually.

---

## 9. Post-ingestion: nightly embedding backfill

The function **does NOT** generate vector embeddings inline. Embeddings
land via the existing nightly `embed-questions` Edge Function (runs in
`daily-cron` at 18:30 UTC), which picks up any `question_bank` row where
`embedding IS NULL` and back-fills it with Voyage rerank-2.

To verify embeddings are filling in:
```sql
SELECT source_type,
       COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
       COUNT(*) FILTER (WHERE embedding IS NULL)     AS pending
FROM question_bank
WHERE source_type IN ('jee_archive', 'neet_archive', 'olympiad')
GROUP BY 1;
```

To force an immediate backfill (after a large bulk ingest):
```bash
curl -X POST \
  "https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/embed-questions?limit=500" \
  -H "x-admin-key: ${ADMIN_KEY}" \
  -H "Content-Type: application/json"
```

---

## 10. Rollback / cleanup

If a batch was ingested with bad data and the daily cron has not yet run:
```sql
-- Inspect the batch
SELECT id, exam_session, exam_year, question_number, verification_state
FROM question_bank
WHERE source_type = 'jee_archive'
  AND exam_session = 'JEE_MAIN_JAN_2024_SHIFT1'
ORDER BY question_number;

-- Soft-delete (preferred — RLS-safe and reversible)
UPDATE question_bank
SET is_active = false,
    deleted_at = now()
WHERE source_type = 'jee_archive'
  AND exam_session = 'JEE_MAIN_JAN_2024_SHIFT1';

-- Then re-ingest the cleaned-up JSONL. ON CONFLICT DO NOTHING means the
-- soft-deleted rows stay soft-deleted; new rows ingest fresh.
```

**Never `DELETE FROM question_bank`** without invoking the orchestrator —
P14 review chain mandates architect approval for destructive ops.

---

## 11. Deploy command (operator reference)

```bash
# From repo root, after PR-2 merges to main:
supabase functions deploy bulk-jee-neet-import --project-ref shktyoxqhundlvkiwguu
```

Verify deployment:
```bash
curl -X POST \
  "https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/bulk-jee-neet-import" \
  -H "Authorization: Bearer wrong-token" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -w '\nHTTP %{http_code}\n'
# Expected: HTTP 401, body {"error":"Unauthorized"}
```

---

## 12. References

- Architect roadmap: `docs/superpowers/plans/2026-05-19-jee-neet-scaling-roadmap.md` (PR-1..PR-7)
- AI content plan: `docs/superpowers/plans/2026-05-19-jee-neet-content-pipeline.md`
- REG-54 oracle: `supabase/functions/_shared/quiz-oracle.ts`, `src/__tests__/quiz-oracle.test.ts`
- Pack manifest types: `src/lib/rag/pack-manifest.ts`
- Reference Edge Function: `supabase/functions/bulk-question-gen/index.ts`
