# Alfanumrik AI Services (Python)

Phase 0 foundation for the Python AI service. Mirrors the TypeScript
Model Orchestration Layer (MoL) at `supabase/functions/_shared/mol/`
byte-for-byte at the API contract level.

> **Status:** Phase 0 — framework + models + providers + telemetry.
> The TS MoL stays live during the transition. No Edge Function is being
> replaced by this code yet; Phase 1 ports the first real call site.

## Local development

```bash
cd python
python3.12 -m venv .venv
source .venv/bin/activate     # On Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
# Edit .env with your local Supabase + provider keys.

uvicorn services.ai.api.main:app --reload --port 8080
# Swagger UI: http://localhost:8080/docs
# Liveness:   http://localhost:8080/healthz
# Readiness:  http://localhost:8080/readyz
```

## Tests

```bash
pytest                                      # Full suite (unit + integration)
pytest tests/unit                           # Unit only
pytest tests/integration                    # Integration only
pytest --cov=services --cov-report=term-missing
```

All HTTP calls are mocked via `respx`; no test ever hits Anthropic, OpenAI
or Supabase.

## Lint + type check

```bash
ruff check .
ruff format .
mypy services/
```

## Directory layout

```
python/
├── services/ai/
│   ├── config.py                  Pydantic Settings (env-var loader)
│   ├── api/                       FastAPI app
│   │   ├── main.py                app factory + middleware
│   │   ├── health.py              /healthz + /readyz
│   │   └── v1/generate.py         POST /v1/generate
│   ├── mol/                       Model Orchestration Layer
│   │   ├── types.py               Pydantic models (mirrors types.ts)
│   │   ├── router.py              BASE_MATRIX + select_provider_chain
│   │   ├── cost.py                PRICING + compute_cost
│   │   ├── telemetry.py           record_mol_request (mol_request_logs row)
│   │   ├── feature_flag.py        feature_flags reader
│   │   ├── orchestrator.py        generate_response entry point
│   │   ├── errors.py              MolError + classify_error
│   │   └── providers/
│   │       ├── base.py            Abstract ModelProvider
│   │       ├── anthropic.py       Claude HTTP call
│   │       └── openai.py          OpenAI HTTP call
│   ├── observability/
│   │   ├── logger.py              structlog JSON-to-stdout + PII redactor
│   │   └── sentry.py              Sentry SDK init + before_send redactor
│   └── db/
│       └── supabase.py            async Supabase service-role client
├── tests/
│   ├── conftest.py                pytest fixtures
│   ├── unit/                      *.py — one file per module
│   └── integration/               FastAPI TestClient end-to-end
├── pyproject.toml                 dependencies + pytest + ruff + mypy
├── requirements.txt               runtime pins
├── requirements-dev.txt           dev pins
├── .env.example                   documented env vars
└── .python-version                3.12
```

## Constraints (Phase 0)

- All Anthropic + OpenAI HTTP calls go through `httpx` (async). No SDKs.
- Telemetry row shape matches `mol_request_logs` column-for-column so
  existing super-admin dashboards keep working post-cutover.
- PII redaction fires in both the logger AND Sentry `before_send` (P13).
- Grades are validated as strings "6".."12" (P5).
- Temperature is a first-class `provider.call(...)` parameter so future
  callers can pass `0` for deterministic verdicts (the gap the TS
  framework has today).

## What Phase 0 stubs

These functions in `services/ai/mol/orchestrator.py` are minimal placeholders
that Phase 1 will replace with full ports:

| Stub | TS source | Phase 1 plan |
|---|---|---|
| `classify_task_type` | `classifier.ts` | Port LLM-based classifier |
| `build_system_prompt` | `prompt-builder.ts` | Port Foxy persona templates |
| `build_simplify_prompt` | `prompt-builder.ts` | Port simplify template |
| `post_process` | `post-processor.ts` | Port response shaper |
| `get_routing_weights` | `feedback.ts` | Read `mol_routing_weights` table |

## What does NOT live here (yet)

- Dockerfile + .dockerignore — architect agent owns those.
- Deploy runbooks, monitoring dashboards — ops agent owns those.
- Cognitive engine port (BKT / IRT / error classification) — Phase 4.
- Eval suite — Phase 3.
