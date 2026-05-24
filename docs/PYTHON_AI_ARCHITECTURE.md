# Python AI Services — Architecture

Owner: architect (infra/topology), ai-engineer (FastAPI + model code). Last updated: Phase 0.

Companion: `docs/PYTHON_AI_DEPLOY.md` (runbook), `docs/MOL_ARCHITECTURE.md` (the legacy MoL surface this Python service is porting).

---

## 1. Why Python, why Cloud Run

### Why Python
CEO directive (May 2026): consolidate AI/ML work in Python. The TS Edge Functions in `supabase/functions/` are mature, well-tested, and continue to serve production traffic, but every future ML experiment (model evaluation harnesses, RAG retrieval tuning, IRT calibration tooling, custom embeddings work) needs the Python ecosystem. Forking the runtime now — before the surface area grows — costs less than retrofitting Python later.

Alternatives considered and rejected:
- **Keep everything in Deno Edge Functions.** Cuts us off from `numpy`, `scipy`, `sklearn`, `sentence-transformers`, every modern eval harness. Edge runtime memory caps (~256 MiB) are also too tight for embedding-heavy workloads.
- **Vercel Python serverless.** Same `bom1` region, but cold starts >2 s, memory cap 3 GiB, and the bundle size limit (250 MB) is hostile to ML deps. Pricing also climbs steeply once we leave Hobby.
- **AWS Lambda Python.** Closer to Vercel's model. Requires a new IAM story and we'd lose region parity with Vercel/Supabase.
- **Self-managed Fly.io / Render / Railway.** All viable, but Cloud Run beats them on free-tier generosity, region parity, and GCP's better Secret Manager.

### Why Cloud Run
- Scales to zero — no idle cost (`min-instances=0`).
- `asia-south1` region matches Vercel `bom1` for in-region latency.
- Container model means the Python app is the same whether running locally (`docker run`), in CI (build job), or in prod.
- Workload Identity Federation gives GitHub Actions deploy access without long-lived JSON keys.
- Built-in streaming response support (FastAPI `StreamingResponse` works end-to-end), which we need for Foxy.

---

## 2. Topology

```
                ┌──────────────────────────────────────┐
                │   Student / Parent / Teacher (web)   │
                │   Student (mobile, Flutter)          │
                └──────────────────┬───────────────────┘
                                   │ HTTPS
                                   ▼
              ┌────────────────────────────────────────────┐
              │  Vercel (Next.js 16, bom1 / Mumbai)        │   unchanged
              │  • src/app/api/* business-logic routes     │
              │  • src/middleware.ts (rate limit, auth)    │
              └──────────────────┬─────────────────────────┘
                                 │ HTTPS server-side
                                 ▼
              ┌────────────────────────────────────────────┐
              │  Supabase Edge Functions (Deno, asia-east) │   PHASE 1A:
              │  • foxy-tutor (still in Deno today)        │   becomes a
              │  • ncert-solver, quiz-generator, etc.      │   ~30-line
              │  • bulk-question-gen                        │   thin proxy
              └──────────────────┬─────────────────────────┘   per surface
                                 │ HTTPS pass-through
                                 ▼
              ┌────────────────────────────────────────────┐
              │  Cloud Run: ai-services (asia-south1)      │   NEW
              │  FastAPI + uvicorn (Python 3.12)           │
              │                                            │
              │  Phase 1A (PoC):                           │
              │   POST /v1/bulk-question-gen               │
              │                                            │
              │  Phase 3 (cutover):                        │
              │   POST /v1/foxy-tutor    (streaming)       │
              │   POST /v1/ncert-solver                    │
              │   POST /v1/quiz-generator                  │
              │                                            │
              │  Phase 4:                                  │
              │   POST /v1/cme-engine                      │
              │                                            │
              │  Phase 5+:                                 │
              │   POST /v1/generate      (generic MoL)     │
              │                                            │
              │  Always:                                   │
              │   GET  /live                               │
              │   GET  /readyz                             │
              │   GET  /metrics                            │
              └─────────┬──────────────────────────────────┘
                        │ HTTPS (service-role JWT)
                        ▼
              ┌────────────────────────────────────────────┐
              │  Supabase Postgres                         │   unchanged
              │  • mol_request_logs                        │
              │  • feature_flags                            │
              │  • question_bank                            │
              │  • ai_tutor_logs                            │
              └────────────────────────────────────────────┘
```

Routing summary:
- **Web/mobile clients** keep calling Next.js + Supabase. No SDK change.
- **Supabase Edge Functions** stay live as the public AI endpoint URL. During cutover, each function body becomes a thin proxy that forwards to Cloud Run. After cutover, we may flatten the proxy by pointing clients at Cloud Run directly — that decision lives in Phase 6.
- **Cloud Run is internet-facing** with `--allow-unauthenticated` because the Edge proxy already validates the caller's Supabase JWT and forwards it; we re-validate inside FastAPI before doing any work.

> **Why `/live` instead of `/healthz`** (Cloud Run frontend interception, confirmed 2026-05-24). Cloud Run's frontend intercepts the path `/healthz` before it reaches the container — Google's frontend returns its own 404 HTML page for that exact URL. Verified by: an unknown path like `/foo` returns FastAPI's JSON 404, `/docs` works, `/openapi.json` shows `/healthz` IS registered on the FastAPI router, but external `curl /healthz` returns Google's HTML 404 instead of `{"status":"ok"}`. `/readyz` is not reserved by Cloud Run and works fine. We renamed the liveness endpoint to `/live` (Cloud Run does NOT reserve that path). The response shape and probe semantics are unchanged — only the URL string differs.

---

## 3. Cutover pattern — stable URLs via Edge proxy

Each Edge Function we move follows the same recipe. The contract that clients (web, mobile) hit does not change.

Before:
```ts
// supabase/functions/bulk-question-gen/index.ts (current)
serve(async (req) => {
  const body = await req.json()
  // ... 400 lines of generation logic ...
  return new Response(JSON.stringify(result), { ... })
})
```

After (Phase 1A bridge):
```ts
// supabase/functions/bulk-question-gen/index.ts (proxy)
const TARGET = Deno.env.get("PY_AI_SERVICE_URL")! + "/v1/bulk-question-gen"

serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? ""
  const requestId = req.headers.get("X-Request-Id") ?? crypto.randomUUID()
  const upstream = await fetch(TARGET, {
    method: "POST",
    headers: {
      "Content-Type": req.headers.get("Content-Type") ?? "application/json",
      "Authorization": auth,
      "X-Request-Id": requestId,
      "X-Forwarded-For": req.headers.get("X-Forwarded-For") ?? "",
    },
    body: req.body,
    // Critical: do NOT buffer the body. Pass through ReadableStream so
    // streaming endpoints (Foxy) keep working.
    duplex: "half",
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  })
})
```

Properties:
- Public URL unchanged (`https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/bulk-question-gen`).
- Auth contract unchanged (Supabase JWT forwarded; Cloud Run re-validates).
- Streaming works end-to-end via `ReadableStream` pass-through.
- Adds one network hop (~10–30 ms in-region). Acceptable for non-interactive surfaces; streaming surfaces should be measured under load before Phase 3.

Rollback during cutover is one Edge Function redeploy: restore the prior `index.ts` and the surface falls back to Deno.

---

## 4. Streaming

Foxy and other chat surfaces stream tokens. The pipeline that must remain unbuffered:

```
Anthropic / OpenAI streaming response
  → Python: FastAPI StreamingResponse(generator)
  → Cloud Run: HTTP/1.1 chunked transfer (gen2 execution env)
  → Edge proxy: pass-through fetch + ReadableStream body
  → Vercel Next.js route: pass-through (already streaming today)
  → Browser SSE consumer
```

Cloud Run gen2 (the default in our `python-ai-deploy.yml`) supports unbuffered streaming. Gen1 buffers responses up to 32 MiB before flushing — do not switch back to gen1.

The Edge proxy MUST use `duplex: "half"` on its `fetch()` and MUST NOT call `await upstream.text()` / `await upstream.json()` before returning. Returning `new Response(upstream.body, ...)` preserves the stream.

---

## 5. Secrets

Single source of truth: the existing Supabase Edge Function secrets. Each Cloud Run secret entry in GCP Secret Manager is populated from the matching Supabase secret value (see runbook §1.7).

| Secret | GCP Secret Manager name | Used by |
| --- | --- | --- |
| Anthropic API key | `anthropic-api-key` | All AI surfaces |
| OpenAI API key | `openai-api-key` | MoL routing (teaching tasks default) |
| Supabase service role JWT | `supabase-service-role-key` | Writing `mol_request_logs`, `ai_tutor_logs`, `question_bank` |
| Supabase project URL | `supabase-url` | postgrest client init |
| Sentry DSN | `sentry-dsn` | Error reporting |

Cloud Run injects these as env vars at container start time (NOT baked into the image). The `python/Dockerfile` deliberately does not `ENV ANTHROPIC_API_KEY=...` anything.

Rotation: update the GCP Secret Manager entry, redeploy the Cloud Run revision. The TS Edge functions must be rotated separately via `supabase secrets set` until cutover is complete — keep both in lockstep or telemetry will diverge.

---

## 6. Observability

| Signal | Source | Destination |
| --- | --- | --- |
| Application logs | `structlog` JSON to stdout | Google Cloud Logging (auto-parsed; filterable by field) |
| Errors / exceptions | `sentry-sdk[fastapi]` integration | Sentry (same project as Next.js app, `tags.service=ai-services`) |
| HTTP request/latency/concurrency | Cloud Run platform metrics | Cloud Monitoring (built-in graphs) |
| Token usage + INR cost per call | App writes `mol_request_logs` row | Supabase Postgres (super-admin dashboard reads `mol_health_24h` view) |
| Cold starts | Cloud Run platform metric | Cloud Monitoring |

Trace propagation: every request carries `X-Request-Id`. The Edge proxy generates/forwards it; FastAPI middleware reads it; `structlog` bound-context attaches it to every log line; the `mol_request_logs` row stores it. Joining a Sentry event → log line → DB row → super-admin dashboard works end-to-end via this single ID.

`mol_request_logs` row shape MUST match the existing TS schema (`supabase/functions/_shared/mol/telemetry.ts`). The super-admin dashboard already reads from `mol_health_24h`; any drift breaks it silently. ai-engineer owns the shape; architect signs off on schema changes (which would be a new migration, gated by review).

---

## 7. CI/CD pipeline

```
┌────────────────────────────────────────────────────────────┐
│ Developer pushes branch with python/** changes             │
└──────────────────────┬─────────────────────────────────────┘
                       ▼
            ┌─────────────────────┐
            │ PR opened           │
            └──────────┬──────────┘
                       ▼
            ┌─────────────────────────────────────┐
            │ Job: test                           │
            │  • ruff check + ruff format --check │
            │  • mypy services                    │
            │  • pytest --cov-fail-under=70       │
            └──────────┬──────────────────────────┘
                       │  green
                       ▼
            ┌─────────────────────┐
            │ PR merged to main   │
            └──────────┬──────────┘
                       ▼
            ┌─────────────────────────────────────┐
            │ Job: test (re-run on main)          │
            └──────────┬──────────────────────────┘
                       ▼
            ┌─────────────────────────────────────┐
            │ Job: build-and-push                 │
            │  • Auth via Workload Identity Fed   │
            │  • docker buildx → asia-south1 GAR  │
            │  • tag with short sha + 'latest'    │
            └──────────┬──────────────────────────┘
                       ▼
            ┌─────────────────────────────────────┐
            │ Job: deploy                         │
            │  • gcloud run deploy ai-services    │
            │  • runtime SA, secrets, env vars    │
            └──────────┬──────────────────────────┘
                       ▼
            ┌─────────────────────────────────────┐
            │ Job: post-deploy-smoke              │
            │  • GET /live    → 200               │
            │  • GET /readyz  → 200 (or 503)      │
            └─────────────────────────────────────┘
```

Manual staging deploy: `workflow_dispatch` with `target=staging` skips production and ships to `ai-services-staging` in the staging GCP project.

---

## 8. Future Phase guidance

| Phase | What it adds | Owner agents |
| --- | --- | --- |
| **0** (current) | Deploy pipeline, Dockerfile, GCP setup runbook, architecture doc. No traffic routed yet. | architect |
| **1A** (PoC) | First Python endpoint: `POST /v1/bulk-question-gen`. Edge function turns into proxy. Real production traffic on a low-stakes surface. | ai-engineer + architect |
| **1B** | Add `POST /v1/generate` — generic MoL endpoint mirroring the existing `generateResponse()` contract. Both runtimes coexist; feature-flag `ff_mol_runtime=python\|deno` decides per-request which executes. | ai-engineer + assessment |
| **2** | RAG retrieval moves to Python (`pgvector` query via asyncpg, Voyage reranker via httpx). Edge function calls Python for retrieval, still calls Anthropic itself for generation. Halfway state to validate latency and cost. | ai-engineer |
| **3** | Foxy-tutor, ncert-solver, quiz-generator cut over to Python end-to-end. Streaming validated under load. Edge functions remain as thin proxies. | ai-engineer + assessment + testing |
| **4** | cme-engine + IRT calibration job ports to Python. Nightly job moves from Vercel cron → Cloud Run Jobs (separate runtime, same image). | ai-engineer + assessment |
| **5** | Evaluation harness (`eval/`) gets a Python sibling that can run against the Cloud Run service in addition to Anthropic direct. Custom retrieval-quality metrics, IRT goodness-of-fit. | ai-engineer + assessment |
| **6** | Edge proxies can be removed for clients we control. Mobile and web call Cloud Run URLs directly (with auth header). Edge stays only for third-party integrations that hard-coded the Supabase URL. | architect + frontend + mobile |

Each phase has its own rollout plan; this document is the long-horizon map, not the per-phase runbook.

---

## 8a. Voice (Phase 2 — Voice 1a delivered 2026-05-24)

The Python service now hosts the platform's first voice capability: a
student-facing speech-to-text endpoint at `POST /v1/voice/transcribe`.

**Topology** — this is a NEW capability, not a TS port. Clients (the
Foxy web UI, mobile via `src/lib/voice.ts` once Voice 2 lands) call
Cloud Run directly OR via a future Supabase Edge proxy in the same
cutover pattern as bulk-question-gen.

**Endpoint contract:**
- Request: `POST /v1/voice/transcribe`
- Body: `multipart/form-data`
  - `audio` (file, required): one of webm / mp3 / wav / m4a / ogg / mpga / flac, ≤ 25 MiB
  - `language_hint` (form field, optional): `'en' | 'hi' | 'hinglish'`
- Auth: `Authorization: Bearer <Supabase student JWT>` — validated against
  the `students` table (NOT `admin_users`).
- Response (200): `TranscribeResponse { transcript, detected_language,
  duration_seconds, audio_format, cost_inr, request_id }`
- Errors emit a `TranscribeError { error, detail, request_id }` envelope
  under `HTTPException.detail`.

**Underlying model**: OpenAI Whisper `whisper-1` via
`https://api.openai.com/v1/audio/transcriptions`. Pricing $0.006/min →
₹0.498/min at USD→INR=83. Per-call INR cost computed from the
`duration` field of Whisper's `verbose_json` response and persisted to
ops_events for the super-admin voice dashboard.

**Hinglish detection (Phase 2 floor)**: Whisper returns iso-639-1 codes
(`en`, `hi`). When Whisper says `'hi'` AND the transcript is Latin-script-dominant
(≥3x more Latin than Devanagari letters), we tag the response
`detected_language='hinglish'` so the chat layer can decide how to
respond. This is a heuristic; Voice 3 will swap in a proper
language-id model.

**Robustness primitives reused:**
- `shared/retry.py` `@retry_with_backoff` on the Whisper HTTP call (3
  attempts, 1-8 s exponential backoff for 502/503/timeout).
- `shared/budget_guard.py` `check_daily_budget(scope='org')` short-circuits
  before the Whisper call when the daily INR cap is exhausted.

**No circuit breaker (yet)**: Whisper is a single-provider call. A naive
breaker would gate ALL transcription on the first run of transient
errors; the retry primitive already covers the common 502/503 patterns.
Phase 2.5 will revisit if production traffic shows sustained Whisper
instability.

**PII posture (P13)**: ops_events rows carry transcript LENGTH (not the
transcript), audio duration in seconds (not the raw bytes), and
student_id as a UUID (existing convention — UUIDs aren't PII per
codebase posture). Name / email / phone are never read from the
`students` row (we only select `id`, `grade`, `preferred_language`).

**CORS**: the existing FastAPI CORS middleware (`api/main.py`) allows
`Authorization`, `Content-Type`, `X-Request-Id` on POST/OPTIONS from the
configured `ALLOWED_ORIGINS` (`https://alfanumrik.com` +
`https://www.alfanumrik.com` in prod). Browser multipart uploads with
the bearer token preflight cleanly — verified during the Voice 1a PR.

**Tests**: 81 new tests (4 unit + 1 integration file) at 86–100%
coverage on each new module. Provider HTTP (`respx`), Supabase Auth
(`respx`), and `students` / `ops_events` table writes are all mocked —
no real Whisper or DB calls in the test suite.

**Voice phases (next)**:
- Voice 1b: TTS endpoint at `POST /v1/voice/synthesize` via Azure
  Speech (Indian-accent voices). Same `students`-table auth + budget
  guard + ops_events posture.
- Voice 2: Frontend integration — `src/lib/voice.ts` switches from
  Web-Speech-API STT to the Cloud Run Whisper endpoint; Foxy chat input
  receives transcripts via the existing `/api/foxy` route.
- Voice 3: Adaptive language end-to-end — student speaks Hindi →
  Whisper returns `hi` → Foxy responds in Hindi → TTS speaks Hindi.

---

## 9. Non-goals (Phase 0)

- No traffic routing changes. The Edge functions still run their current TS code.
- No data migration. Postgres schema is untouched.
- No new mobile or web SDK. Clients keep hitting the same Supabase URLs.
- No multi-region. `asia-south1` only; cross-region serving is a Phase 5+ concern.
- No GPU. CPU-only Cloud Run is sufficient for inference via Anthropic/OpenAI APIs; we are not running models locally.
