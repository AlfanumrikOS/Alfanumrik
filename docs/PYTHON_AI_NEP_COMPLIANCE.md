# Python AI - nep-compliance port

Phase 2 continued - port of `supabase/functions/nep-compliance/index.ts` to
Python FastAPI on Cloud Run (Mumbai). NEP 2020 Holistic Progress Card
generator/retriever. Default OFF (zero AI calls; pure data aggregation).

## What's ported

- `auth.py`: apikey constant-time match via `hmac.compare_digest` against
  `SUPABASE_ANON_KEY`. 401 mismatch, 503 unconfigured.
- `mapping.py`: NEP 2020 competency thresholds (advanced 85, proficient 65,
  developing 40, beginning <40), NCF 2023 behavior-rating math (1-5 scale
  vs benchmarks), Indian academic-year + term boundaries (April-March),
  CBSE exam section structure.
- `models.py`: typed HPCReport with student / academic_year / term /
  class_percentile / bloom_distribution / competency_levels (NEP-mapped) /
  subject_performance / learning_behaviors (NCF 2023) /
  holistic_indicators / cbse_readiness / portfolio_highlights.
- `repository.py`: 5 reads (student / profiles / mastery+nested topics /
  quiz_sessions / cached report) + 1 upsert.
- `handler.py`: 12-step aggregation pipeline mirroring TS 137-380.

## Rollout

Default OFF. Standard 3-layer kill switch: `kill_switch` > `enabled` >
`rollout_pct`. Bump via SQL on `ff_python_nep_compliance_v1`. Edge function
falls through to legacy TS on any proxy failure.

## REG-101

See `.claude/regression-catalog.md` REG-101: pinned tests cover
NEP thresholds + behavior-rating math + term/academic-year boundaries.
