# Python AI - extract-ncert-questions port (Phase 2 stub)

Phase 2 STRUCTURAL port of supabase/functions/extract-ncert-questions/index.ts.

## What's ported

- auth.py: re-exports verify_admin_key from generate_answers (admin x-admin-key).
- models.py: typed ExtractRequest/Response/StatusResponse with P5 grade-string contract.
- repository.py: chapter discovery + coverage stats (reuses generate_concepts normalize helpers).
- handler.py: 4-step pipeline (auth -> discover chapters -> STUB -> summary).

## Phase 2 STUB behavior

The TS path uses MoL (task_type='quiz_generation') to extract questions from
each chapter's RAG content. The Python port STUBS this step - chapters are
marked 'skipped' with phase_2_stub=True. Phase 2.5 will wire MoL routing.

Default OFF means TS handles all extraction traffic; flag flip would result
in 0 extractions until Phase 2.5 wires the extractor.

## REG-105

See `.claude/regression-catalog.md` for the model contract pins.
