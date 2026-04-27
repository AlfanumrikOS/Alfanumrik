# RAG evaluation harness

Regression detector for the grounded-answer Edge Function. Runs a curated
set of gold queries against the live service and verifies the response
satisfies the expected scope, citations, and safety rails.

## What this is (and is not)

This is a **scaffold + minimum viable gold set** for catching grounding
regressions before students notice. Audit finding F8 flagged the absence of
any RAG eval as the single biggest red blocker in AI; this harness closes
that gap at MVP scope. Future iterations should grow the gold set, tighten
thresholds, and add rerank-quality and latency-SLO checks.

This is **not** a production-grade eval framework yet. See "Known gaps".

## How to run locally

```bash
# Required env (from .env.local or shell):
#   SUPABASE_URL                      # https://<project>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY         # service-role JWT
#
# Default threshold is 80% pass rate:
npm run eval:rag

# Stricter threshold (used by CI once we hit baseline):
npm run eval:rag:check
```

The runner:
1. Loads every `*.json` fixture under `eval/rag/fixtures/`.
2. Posts each query to `/functions/v1/grounded-answer` with `mode='strict'`.
3. Collects citations, abstain reason, latency.
4. Scores each result (see `scoring.ts`) and writes a JSON report to
   `eval/rag/reports/<ISO-timestamp>.json`.
5. Exits 0 if pass-rate ≥ threshold, 1 otherwise. Exit 2 = config error.

## How to add a query

Edit any fixture file (or add a new one — they're auto-discovered) under
`eval/rag/fixtures/`. Schema:

```json
{
  "id": "g9-math-pythagoras-001",
  "query": "State the Pythagoras theorem.",
  "grade": "9",
  "subject": "math",
  "expected": {
    "is_in_scope": true,
    "expected_chapter": "Triangles",
    "must_cite_chapter_numbers": [7],
    "forbidden_phrases": ["I don't know"]
  }
}
```

For out-of-scope queries set `is_in_scope: false` and add `abstain_phrases`.
The full schema is in `eval/rag/types.ts`.

## How to read the report

| Metric | Meaning |
|---|---|
| `pass_rate` | Fraction of gold queries that passed. Headline metric. |
| `in_scope.pass_rate` | Pass rate on queries that should produce an answer. Drops here mean grounding regressions. |
| `out_of_scope.pass_rate` | Pass rate on queries that should abstain. Drops here mean safety regressions (P12). |
| `mean_latency_ms` / `p95_latency_ms` | Performance signal. Not currently a hard gate. |
| `results[].fail_reason` | Triage hint per failure: `scope_mismatch:*`, `citation_mismatch`, `no_citations`, `forbidden_phrase`, or `runner_error:*`. |

A query passes overall iff:
- **In-scope**: response was non-abstain AND at least one citation matched
  the expected chapter (or any citation if `must_cite_chapter_numbers` is
  empty) AND no forbidden phrase appeared.
- **Out-of-scope**: response abstained.

## How CI uses it

`.github/workflows/rag-eval.yml`:
- Triggers: `workflow_dispatch`, nightly (22:00 UTC = 03:30 IST), and on
  PRs that touch `supabase/functions/grounded-answer/**` or
  `supabase/functions/_shared/retrieval.ts`.
- **Currently advisory** (`continue-on-error: true`) until we have 5
  consecutive runs at ≥95% pass rate, at which point the gate flips to
  blocking.
- Skips on forked PRs (no service-role secret available).
- Uploads the JSON report as a build artifact for forensics.

## Known gaps

1. **No rerank-quality eval.** We do not check whether Voyage rerank
   actually surfaces the most relevant chunk; only that *some* expected
   chapter is cited.
2. **No latency SLO eval.** We capture latency but do not gate on it.
3. **Chapter numbers are partly unverified.** Class 6 fixtures use chapter
   names without `must_cite_chapter_numbers` because the 2024 NCERT
   "Curiosity" edition reshuffled chapters; future iteration should
   verify against the deployed `chapters` table and tighten assertions.
4. **Gold set is small (30 queries).** Aim is 100+ across grades 6-12 for
   all four core subjects. Current set is representative but not complete.
5. **No prompt-injection coverage.** Out-of-scope set covers basic safety
   (PII, weapons, medical) but not adversarial jailbreaks.
6. **Service must be deployed.** The runner posts to the live Edge
   Function URL — there is no offline / mocked mode. For local testing,
   run `supabase functions serve grounded-answer --env-file .env.local`
   and point `SUPABASE_URL` at the local instance.
