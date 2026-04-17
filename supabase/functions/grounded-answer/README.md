# grounded-answer Edge Function

CBSE-grounded AI response service. Phase 2 of the RAG Grounding Integrity project.

## Purpose

Single entry point for all AI-answering callers (Foxy, NCERT-solver,
quiz-generator, concept-engine, diagnostic). Guarantees:

- Every answer is grounded in NCERT `rag_content_chunks` for the student's
  grade + subject + chapter.
- Every call writes exactly one `grounded_ai_traces` row (grounded or abstain).
- Strict-mode answers pass a second-pass grounding check before leaving the
  service.
- Coverage, similarity, and grounding gates short-circuit into clean abstain
  responses with `suggested_alternatives` instead of hallucinating.
- Circuit breaker protects upstream APIs. In-memory cache short-circuits
  repeat queries.

See `docs/superpowers/specs/2026-04-17-rag-grounding-integrity-design.md`
§6 for the full request/response contract.

## Pipeline

```
POST /grounded-answer
  ├─ 1. Validate request shape (validators.ts)
  ├─ 2. Coverage precheck vs cbse_syllabus (coverage.ts)
  │     fail → abstain(chapter_not_ready) + suggested_alternatives
  ├─ 2b. Cache lookup (cache.ts) — only for non retrieve_only
  │     hit → return cached response (no trace write)
  ├─ 3. Feature flag gate (ff_grounded_ai_enabled)
  │     off → abstain(upstream_error)
  ├─ 4. Effective thresholds (strict=0.75, soft=0.55)
  ├─ 4b. Circuit breaker check (circuit.ts)
  │     open → abstain(circuit_open)
  ├─ 5. Voyage embedding (embedding.ts)
  │     null on failure; retrieval continues with keyword fallback
  ├─ 6. match_rag_chunks_ncert RPC + scope verification (retrieval.ts)
  ├─ 7. retrieve_only branch → citations + trace, no Claude
  ├─ 8. Build prompt from registered template (prompts/)
  ├─ 9. Call Claude Haiku with Sonnet fallback (claude.ts)
  │     {{INSUFFICIENT_CONTEXT}} → abstain(no_supporting_chunks)
  ├─ 10. Strict-mode grounding check (grounding-check.ts)
  │     fail → abstain(no_supporting_chunks)
  ├─ 11. Compute confidence (confidence.ts)
  │     < 0.75 in strict mode → abstain(low_similarity)
  ├─ 12. Extract [N] citations (citations.ts)
  ├─ 13. Write trace row (trace.ts)
  ├─ 14. Cache grounded response (cache.ts)
  └─ 15. Return GroundedResponse
```

## Deployment

```bash
supabase functions deploy grounded-answer
```

Runs in the Deno runtime. No `node_modules` — all imports are full URLs or
`./relative` paths.

## Required environment variables

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS for `cbse_syllabus`, RPCs, traces |
| `VOYAGE_API_KEY` | Voyage AI embeddings (falls back to keyword retrieval if missing) |
| `ANTHROPIC_API_KEY` | Claude Haiku / Sonnet |

Set via Supabase CLI:

```bash
supabase secrets set VOYAGE_API_KEY=...
supabase secrets set ANTHROPIC_API_KEY=...
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provisioned.
```

## Smoke tests

Replace `<PROJECT_REF>` and `<ANON_OR_SERVICE_JWT>` with values for the
target environment.

### Happy path (grounded)

```bash
curl -X POST \
  "https://<PROJECT_REF>.functions.supabase.co/grounded-answer" \
  -H "Authorization: Bearer <ANON_OR_SERVICE_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "caller": "foxy",
    "student_id": null,
    "query": "What is photosynthesis?",
    "scope": {
      "board": "CBSE",
      "grade": "10",
      "subject_code": "science",
      "chapter_number": 6,
      "chapter_title": "Life Processes"
    },
    "mode": "strict",
    "generation": {
      "model_preference": "auto",
      "max_tokens": 1024,
      "temperature": 0.3,
      "system_prompt_template": "foxy_tutor_v1",
      "template_variables": {}
    },
    "retrieval": { "match_count": 5 },
    "retrieve_only": false,
    "timeout_ms": 30000
  }'
```

Expected: `{ "grounded": true, "answer": "...", "citations": [...], "confidence": 0.8x, "trace_id": "..." }`.

### Chapter not ready

Point `scope.chapter_number` at a chapter whose `rag_status != 'ready'`.
Expected: `abstain_reason: "chapter_not_ready"` with `suggested_alternatives`.

### Retrieve-only (concept-engine)

Same body, set `retrieve_only: true`. Expected: `grounded: true` with
`answer: ""` and up to `match_count` citations. No Claude call, no
grounding check.

### Upstream error

Temporarily set an invalid `ANTHROPIC_API_KEY`. Expected:
`abstain_reason: "upstream_error"` (auth errors surface here). After 3
consecutive failures in 10s, subsequent requests return
`abstain_reason: "circuit_open"` for 30 seconds.

## Response shape

```typescript
// Success
{
  grounded: true,
  answer: string,
  citations: Citation[],     // { index, chunk_id, chapter_number, chapter_title, page_number, similarity, excerpt, media_url }
  confidence: number,        // 0..1
  trace_id: string,
  meta: { claude_model, tokens_used, latency_ms }
}

// Abstain
{
  grounded: false,
  abstain_reason: 'chapter_not_ready' | 'no_chunks_retrieved' | 'low_similarity'
                | 'no_supporting_chunks' | 'scope_mismatch' | 'upstream_error' | 'circuit_open',
  suggested_alternatives: SuggestedAlternative[],
  trace_id: string,
  meta: { latency_ms }
}
```

## Rollback

```bash
supabase functions delete grounded-answer
```

Callers (Foxy / NCERT-solver / quiz-generator / concept-engine) are wired
behind per-caller feature flags (`ff_grounded_ai_foxy`,
`ff_grounded_ai_ncert_solver`, etc.). Deleting the function returns 404 to
callers; they fall back to the legacy direct-Claude path. Flipping the
per-caller flags to `false` in `feature_flags` achieves the same effect
without removing the function.

The master kill switch `ff_grounded_ai_enabled` makes the service abstain
with `upstream_error` for every request until re-enabled. Use this for
fast-incident-response without a redeploy.

## Observability

Every request writes one `grounded_ai_traces` row (exception: cache hits).
Query recent abstains with:

```sql
SELECT caller, grade, subject_code, abstain_reason, query_preview, created_at
FROM grounded_ai_traces
WHERE grounded = false AND created_at > now() - interval '1 hour'
ORDER BY created_at DESC;
```

Aggregate success rate by caller:

```sql
SELECT caller,
       count(*) FILTER (WHERE grounded) * 1.0 / count(*) AS success_rate,
       count(*) AS total
FROM grounded_ai_traces
WHERE created_at > now() - interval '24 hours'
GROUP BY caller
ORDER BY success_rate;
```

## Testing

All tests are Deno-native. Run from the function root:

```bash
cd supabase/functions/grounded-answer
deno test --allow-all
```

Test files (in `__tests__/`):

| File | Coverage |
|---|---|
| `validation.test.ts` | Request shape validation |
| `coverage.test.ts` | Coverage precheck + alternatives |
| `embedding.test.ts` | Voyage call with timeout + retry |
| `retrieval.test.ts` | RPC + scope verification |
| `claude.test.ts` | Haiku/Sonnet routing |
| `grounding-check.test.ts` | Verdict parsing |
| `confidence.test.ts` | Spec §6.5 formula |
| `citations.test.ts` | [N] extraction |
| `trace.test.ts` | normalize/hash/redact + writeTrace |
| `circuit.test.ts` | 3-state breaker |
| `cache.test.ts` | LRU + TTL |
| `pipeline.test.ts` | Integration: coverage → Claude → trace |
| `e2e.test.ts` | All 7 response paths via handleRequest |

## References

- Spec: `docs/superpowers/specs/2026-04-17-rag-grounding-integrity-design.md`
- Plan: `docs/superpowers/plans/2026-04-17-rag-grounding-integrity.md`
- Config parity: `src/lib/grounding-config.ts` ↔ `./config.ts` (enforced by CI)
- Migration: `supabase/migrations/20260418100300_grounded_ai_traces.sql`
- Feature flags: `supabase/migrations/20260418100800_feature_flags.sql`