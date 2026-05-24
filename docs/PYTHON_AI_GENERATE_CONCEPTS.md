# Python AI — generate-concepts (Phase 2 continued)

> **Status (2026-05-24):** shipped service-side. Default OFF behind
> `ff_python_generate_concepts_v1`. Edge proxy block at the top of
> `supabase/functions/generate-concepts/index.ts` forwards to Cloud Run
> when the flag is bumped. Third function in the Phase 2 per-function
> ramp from TS Edge to Python AI Cloud Run; follows
> `ff_python_bulk_question_gen_v1` (PR #905) and
> `ff_python_generate_answers_v1` (Phase 2 Wave 1).

## TL;DR

- Endpoint: `POST /v1/generate-concepts` + `GET /v1/generate-concepts` on
  the Python AI Cloud Run service (asia-south1).
- Auth: `x-admin-key` constant-time compare vs `ADMIN_API_KEY` env (same
  posture as `generate-answers` and `bulk-question-gen`).
- Purpose: batch generate structured concept cards for NCERT chapters
  missing entries in `chapter_concepts`. Output is 3-6 concepts per
  chapter, each with title / learning_objective / explanation / example /
  difficulty / bloom_level / common_mistakes (P6 quality gate in
  `validator.py`).
- Provider: MoL `task_type='concept_explanation'` → OpenAI gpt-4o-mini
  primary, Anthropic Haiku fallback (matches TS routing).
- Time budget: 120s wall (matches TS `MAX_EXECUTION_MS`).
- Throttle: 500ms inter-chapter sleep (matches TS `INTER_CHAPTER_DELAY_MS`).

## Architecture mirror

```
            ┌─────────────────────────────────────────┐
            │  Admin CLI / super-admin batch action   │
            └────────────────┬────────────────────────┘
                             │ POST /functions/v1/generate-concepts
                             │ + x-admin-key
                             ▼
            ┌─────────────────────────────────────────┐
            │  Supabase Edge Function (TS, Phase 1A)  │
            │  ─── PROXY BLOCK (lines ~895-945) ───   │
            │  shouldProxyToPython(flag, request_id)  │
            └────────┬──────────────────────┬─────────┘
                     │ flag ON +            │ flag OFF OR
                     │ bucket < rollout_pct │ proxy failure
                     ▼                      ▼
   ┌────────────────────────┐   ┌─────────────────────────┐
   │  Python AI (Cloud Run) │   │  TS Phase 1A handler    │
   │  /v1/generate-concepts │   │  (handleGet/handlePost) │
   │  ─ verify_admin_key    │   │  ─ MoL via              │
   │  ─ budget_guard        │   │   ff_mol_admin_func..._v1│
   │  ─ fetch chapters      │   │  ─ legacy fallback path │
   │  ─ MoL: gpt-4o-mini    │   │   on flag OFF           │
   │  ─ parse + insert      │   └─────────────────────────┘
   └────────────────────────┘
               │
               ▼
   ┌────────────────────────┐
   │  Supabase Postgres     │
   │  - chapter_concepts    │
   │  - ops_events          │
   │  - mol_request_logs    │
   └────────────────────────┘
```

The Edge function is the canonical entry point — clients never call Cloud
Run directly. On any proxy failure (timeout, 5xx, Cloud Run hard down) the
TS path runs as the safety net.

## Rollout plan

Default OFF (rollout_pct=0). Ops bumps manually following the cadence in
`docs/PYTHON_AI_OPERATIONS.md` § "Rollout playbook for new function ports":

| Step | rollout_pct | Watch window | Watched metrics                                  |
|------|-------------|--------------|--------------------------------------------------|
| 1    | 10%         | 4-8 hours    | Cloud Run p95 latency, error rate, ops_events    |
| 2    | 25%         | 8-12 hours   | Same + parity vs TS path latency in same window  |
| 3    | 50%         | 12-24 hours  | Same + chapter_concepts insert volume parity     |
| 4    | 100%        | observe 48h  | Same. Hold here ≥7 days before retiring TS path. |

### Kill switches (3 layers)

1. **PYTHON_AI_BASE_URL empty** — the proxy helper short-circuits to
   `should_proxy=false` regardless of flag state. Architect's hard kill.
2. **metadata.kill_switch=true** — `shouldProxyToPython` reads the flag
   envelope and forces `should_proxy=false`. Ops's fast kill (5-min
   cache TTL).
3. **Proxy throws** — caller catches and falls through to the existing
   TS handler. Hard outage of Cloud Run never 502s the user.

## Calling from curl

```bash
# Status (GET)
curl -X GET \
  -H "x-admin-key: $ADMIN_API_KEY" \
  https://ai-services-xxxxx.a.run.app/v1/generate-concepts

# Batch generate (POST) — 5 chapters, math grade 10
curl -X POST \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"grade":"10","subject":"math","batch_size":5}' \
  https://ai-services-xxxxx.a.run.app/v1/generate-concepts

# Dry run — list candidate chapters without generating
curl -X POST \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"grade":"10","dry_run":true}' \
  https://ai-services-xxxxx.a.run.app/v1/generate-concepts
```

When the rollout flag is bumped, ops will call the SAME URL via the
Edge function (`https://<project>.supabase.co/functions/v1/generate-concepts`)
and the proxy forwards. Clients never need to know the Cloud Run URL.

## Response shape

### POST normal run

```json
{
  "success": true,
  "total_found": 5,
  "processed": 5,
  "succeeded": 4,
  "failed": 1,
  "skipped": 0,
  "errors": ["Grade 10 math Ch3: failed to parse Claude response"],
  "elapsed_ms": 38421,
  "remaining": 12,
  "dry_run": false
}
```

### POST dry run

```json
{
  "success": true,
  "total_found": 5,
  "processed": 0,
  "succeeded": 0,
  "failed": 0,
  "skipped": 0,
  "errors": [],
  "elapsed_ms": 240,
  "dry_run": true,
  "chapters": [
    {"grade": "10", "subject": "math", "chapter_number": 1, "chapter_title": "Real Numbers"}
  ]
}
```

### GET status

```json
{
  "total_chapters": 542,
  "with_concepts": 312,
  "without_concepts": 230,
  "coverage_percent": 58,
  "breakdown": {
    "Grade 10 - math": {"total": 15, "with_concepts": 12, "without_concepts": 3}
  }
}
```

### Error shapes

| Status | Code            | Cause                                                    |
|--------|-----------------|----------------------------------------------------------|
| 401    | AUTH_FAILED     | Missing or wrong `x-admin-key`                           |
| 422    | (Pydantic)      | Invalid body (extra fields, integer grade — P5 enforced) |
| 429    | BUDGET_EXCEEDED | Daily AI INR cap reached                                 |
| 500    | HANDLER_ERROR   | DB query failure                                         |
| 503    | AUTH_FAILED     | `ADMIN_API_KEY` env var missing (service misconfigured)  |

## P-invariants enforced

| Invariant | How                                                          |
|-----------|--------------------------------------------------------------|
| P5        | `GenerateConceptsRequest.grade` rejects non-string at the Pydantic field validator. `ConceptInsertRow.grade` is typed `str`. Pinned by REG-76. |
| P6        | `parse_concepts_response` enforces 3-6 concepts, required fields non-empty, bloom_level ∈ canonical 4 set, difficulty ∈ {1,2,3}. Pinned by REG-76. |
| P12       | All LLM output passes through `parse_concepts_response` before DB insert — no unfiltered text reaches `chapter_concepts`. CBSE-scope rails baked into `build_system_prompt`. |
| P13       | `ops_events.context` carries grade/subject/chapter_number/counters only — never concept text or NCERT chunks. Verified by `test_log_event_context_can_hold_only_safe_metadata`. |

## Telemetry

Per batch, the handler writes the following `ops_events` rows
(`source='generate-concepts'`, `subject_type='admin'`):

| Category                            | When                       | Severity |
|-------------------------------------|----------------------------|----------|
| `generate_concepts.batch.started`   | Once at the top of POST    | info     |
| `generate_concepts.chapter.success` | Per inserted chapter       | info     |
| `generate_concepts.chapter.failed`  | Per skipped / failed chapter | info   |
| `generate_concepts.batch.complete`  | Once at the bottom of POST | info     |

In addition, MoL writes one `mol_request_logs` row per LLM call (per
chapter, per provider attempt) — same shape as every other Python AI
caller. The super-admin MoL panel surfaces these unchanged.

## Out of scope

- Phase 2 of the port deliberately does NOT migrate the legacy
  Anthropic-direct fallback (`callClaudeLegacy`) — the rollback for the
  Python path is the per-function flag itself plus the proxy fallback.
  The TS path retains the legacy fallback for its own ramp.
- `temperature_override` is not exposed yet. TS has a TODO comment to
  surface it via `GenerateRequest.config`; Phase 3 will land it for both
  runtimes simultaneously.
