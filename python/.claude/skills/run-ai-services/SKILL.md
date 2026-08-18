---
name: run-ai-services
description: Build, run, test, and drive the Alfanumrik AI Services Python/FastAPI backend (python/). Use when asked to start the AI service, run its tests, lint/type-check it, or hit its HTTP endpoints (health, math verify, quiz generator, foxy tutor, etc).
---

FastAPI service (package `alfanumrik-ai-services`) — a Python port of the
Model Orchestration Layer, exposing 26 HTTP routes (health, `/v1/generate`,
`/v1/math/verify`, `/v1/quiz-generator`, `/v1/foxy-tutor`, voice, CME engine,
and more). It boots with **zero configuration** (no Supabase/API keys
required to start — only to reach "ready" or to actually call an LLM), which
makes it easy to drive locally. Agent path: run
`.claude/skills/run-ai-services/smoke.sh`, which launches the server in the
background, fires real HTTP requests at it, and shuts it down.

All paths below are relative to `python/` (this skill's unit root — **not**
the repo root, and **not** this skill directory).

## Prerequisites

Python 3.12 (pinned in `.python-version`; `pyproject.toml` allows 3.12–3.14).
No OS packages needed beyond Python itself — verified by launching and
driving the service in this container with nothing else installed.

## Setup

```bash
cd python
python3.12 -m venv .venv
# Windows:      .venv\Scripts\pip install -r requirements.txt -r requirements-dev.txt
# Linux/macOS:  .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
```

No `.env` file is required to launch or to run the smoke driver below — every
`Settings` field defaults to empty/local, and the service starts cleanly with
no config at all (see Gotchas). Copy `.env.example` to `.env` and fill in
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY` only if you need `/readyz` to report `"ready"` or need a
route to actually reach an LLM/Supabase.

## Build

No separate build step — it's plain Python, run directly via `uvicorn`.

## Run (agent path)

```bash
cd python
bash .claude/skills/run-ai-services/smoke.sh
```

This launches `uvicorn services.ai.api.main:app` on port 8080 in the
background, polls `GET /live` until it's up, then drives 7 real requests
through the running app and reports PASS/FAIL for each:

- `GET /live` → 200
- `GET /readyz` → 503 (honestly reports `degraded` when Supabase/provider
  keys are unconfigured — this is correct behavior, not a failure)
- `GET /docs`, `GET /openapi.json` → 200 (confirms all 26 routers wired
  and the OpenAPI schema builds cleanly across every Pydantic model)
- `POST /v1/math/verify` with no `Authorization` header → 401
- `POST /v1/math/verify` with a bearer token but no Supabase configured →
  503 (fail-closed auth posture, by design — see the module docstring in
  `services/ai/business/voice/auth.py`)
- `POST /v1/math/verify` with a malformed body → 422

It then prints the total route count and shuts the server down. Server logs
land at `${TMPDIR:-/tmp}/ai-services-smoke.log`. Override the port with
`PORT=8081 bash .claude/skills/run-ai-services/smoke.sh`.

To hit the running server directly instead of the canned checks (leave the
driver's own shutdown out — start it manually):

```bash
cd python
./.venv/Scripts/python.exe -m uvicorn services.ai.api.main:app --port 8080 --host 127.0.0.1 &
curl http://127.0.0.1:8080/live
curl http://127.0.0.1:8080/openapi.json | python -m json.tool
```

Swagger UI is at `http://127.0.0.1:8080/docs` if you want to poke the API
interactively (e.g. via a browser driver) instead of raw `curl`.

### Direct invocation (no server)

Most of the actual logic lives in `services/ai/business/*/handler.py` and
`services/ai/mol/`, callable without booting HTTP at all — the fastest path
for a PR that only touches business logic:

```bash
./.venv/Scripts/python.exe -c "
from services.ai.business.math.handler import verify_math
print(verify_math('1/2 + 3/4', '5/4', 'evaluate'))
"
# → is_correct=True confidence=1.0 computed='5/4' reason='value_match'
```

## Run (human path)

```bash
cd python
uvicorn services.ai.api.main:app --reload --port 8080
# Swagger UI: http://localhost:8080/docs
```

Blocks the terminal; `Ctrl-C` to stop. Use `--reload` only for interactive
dev — the smoke driver above deliberately omits it.

## Test

```bash
cd python
./.venv/Scripts/python.exe -m pytest -q
```

893 tests pass, ~4m15s, coverage gate is 58% (actual: ~61%). All HTTP calls
to Anthropic/OpenAI/Supabase are mocked via `respx` — the suite needs no
network and no `.env`.

```bash
./.venv/Scripts/python.exe -m ruff check .    # lint — clean
./.venv/Scripts/python.exe -m mypy services/  # type check — clean, 158 files
```

## Gotchas

- **The service starts with zero config, but silently.** `Settings` (in
  `services/ai/config.py`) defaults every secret to `""`; there's no error
  on missing `.env`, no crash — it just boots and `/readyz` reports
  `degraded`. If you expect a loud failure on missing config, you won't get
  one; check `/readyz`'s JSON body instead.
- **Auth-gated routes fail CLOSED, not open, when unconfigured.** A route
  like `/v1/math/verify` returns `503 {"error":"AUTH_FAILED","detail":"Supabase
  not configured"}` for *any* bearer token (even a garbage one) when
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are unset — it never lets an
  unverifiable token through. This is intentional (P12 in the project's
  product invariants), not a bug in the smoke driver.
- **On Windows, `$!` after `uvicorn ... &` is not reliable for killing the
  server.** The captured PID is the venv `python.exe` wrapper's shell PID,
  which doesn't always match what's actually bound to the port. The driver
  resolves the real owner via `Get-NetTCPConnection -LocalPort $PORT` in
  PowerShell and kills that PID instead. On Linux/macOS, `lsof -ti:$PORT |
  xargs -r kill` is more reliable and is what the driver falls back to when
  `lsof` is present.
- **`pytest`'s `pythonpath` config is order-sensitive.** `pyproject.toml`
  sets `pythonpath = [".", ".."]` — `.` (python/) must precede `..` (repo
  root) because both directories have a top-level `tests/` package; the
  wrong order resolves `import tests` to the wrong tree. Don't reorder it
  without checking `cbse_parser` (a repo-root package some handlers import)
  still resolves.
- **`README.md` in this directory undersells the current state.** It's
  labeled "Phase 0 foundation" with ~5 modules documented, but the service
  has grown to 26 routes / 158 source files / 893 tests. Don't take the
  README's directory listing as authoritative — it lists `v1/generate.py`
  as basically the only route; there are 25 more.

## Troubleshooting

- **`error while attempting to bind on address ... only one usage of each
  socket address is normally permitted`**: something is already listening
  on port 8080 (possibly a previous run you didn't clean up). Find and kill
  it: `powershell -c "Get-NetTCPConnection -LocalPort 8080 | Select -Expand
  OwningProcess"` then `powershell -c "Stop-Process -Id <pid> -Force"`, or
  just launch with `PORT=8081`.
- **`ModuleNotFoundError` for `cbse_parser` when running tests from outside
  `python/`**: pytest's `rootdir` must be `python/` for the `pythonpath =
  [".", ".."]` setting to put the repo root (where `cbse_parser` lives) on
  `sys.path` correctly. Always `cd python` before running `pytest`, don't
  invoke it from the repo root.
