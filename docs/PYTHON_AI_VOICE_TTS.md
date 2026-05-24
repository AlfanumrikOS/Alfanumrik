# Python AI — Voice 1b (Azure Indian-Accent TTS)

> **Status (2026-05-24):** shipped service-side. Frontend wiring lands in
> Voice 2. Endpoint: `POST /v1/voice/synthesize` on the Python AI Cloud
> Run service (asia-south1). Companion of Voice 1a (`/v1/voice/transcribe`,
> OpenAI Whisper). Together they form the input + output halves of Foxy's
> voice loop.

## TL;DR

- Endpoint: `POST /v1/voice/synthesize` (student-JWT auth, JSON body, MP3 response).
- Provider: **Azure Cognitive Services Speech** (REST API direct, no SDK).
- Voices: Indian-accent neural voices only (`en-IN-*` and `hi-IN-*`).
- Cost: $16 / 1M chars (~₹0.40 per 300-char Foxy reply at USD_TO_INR=83).
- Free tier: 500K neural chars / month (handled at the Azure billing layer).
- Safety: text capped at 2000 chars per call; org-level daily INR budget
  guard caps runaway spend; SSML escaping prevents tag injection.

## Architecture decision: Azure REST API direct (no SDK)

We deliberately chose `httpx` against the Azure REST endpoint over the
`azure-cognitiveservices-speech` Python SDK. Reasons:

1. **Bundle size.** The SDK ships ~30 MiB of bundled native binaries
   (the C++ Speech SDK). Our deployable container is currently ~180 MiB;
   the SDK would push us toward 220 MiB and cold-start would grow
   noticeably.
2. **Retry conflict.** The SDK ships its own retry/backoff configuration
   that would conflict with our shared `@retry_with_backoff` decorator
   (which we reuse from the Whisper path). Going direct keeps the retry
   budget consistent across both voice endpoints.
3. **Surface size.** The REST API we need is one POST endpoint. Direct
   `httpx` mirrors the Whisper pattern exactly — easier to audit, easier
   to test (one respx mock instead of an SDK monkey-patch tree).
4. **No streaming today.** Azure offers an SSE-based streaming TTS variant.
   We don't need it for Voice 1b; the synchronous endpoint returns full
   audio in ~4s for a 300-char clip, well within the 30s Cloud Run budget.
   Voice 3 may revisit if real-time playback becomes a requirement.

## Voice catalog

```python
VOICE_CATALOG = {
    ("en", "female"): "en-IN-NeerjaNeural",
    ("en", "male"):   "en-IN-PrabhatNeural",
    ("hi", "female"): "hi-IN-SwaraNeural",
    ("hi", "male"):   "hi-IN-MadhurNeural",
    # Hinglish routes through the Hindi voices — they pronounce Latin
    # loanwords in natural Indian-English phonemes.
    ("hinglish", "female"): "hi-IN-SwaraNeural",
    ("hinglish", "male"):   "hi-IN-MadhurNeural",
}
```

Catalog lives in `python/services/ai/business/voice/tts.py`. **Adding a
voice = code change + PR**, not a config flag. This is intentional:
the catalog is the only layer between language/gender input and the
Azure voice id the SSML carries. An ops typo in a config field would
have shipped the wrong accent to students (direct CEO ask violation —
the entire feature is "Indian accent"). Code review is the gate.

To add a voice:

1. Edit `VOICE_CATALOG` in `tts.py`.
2. Update `python/tests/unit/test_voice_tts.py` (the
   `test_voice_catalog_*` tests pin the matrix).
3. Update REG-75 in `.claude/regression-catalog.md` if the addition
   changes the (language, gender) → voice contract.
4. Update this doc.

## HTTP contract

### Request

```http
POST /v1/voice/synthesize HTTP/1.1
Host: ai-services-<hash>-as.a.run.app
Authorization: Bearer <student-supabase-jwt>
Content-Type: application/json

{
  "text": "Photosynthesis is the process by which plants make food.",
  "language": "en",
  "gender": "female",
  "voice_override": "hi-IN-SwaraNeural"  // optional admin/testing escape hatch
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | string | yes | 1..2000 chars. SSML special chars (& < > " ') are escaped server-side. |
| `language` | enum | yes | `"en"` | `"hi"` | `"hinglish"`. |
| `gender` | enum | no (default `"female"`) | `"female"` | `"male"`. |
| `voice_override` | string | no | Full Azure voice id (`xx-XX-NameNeural`). Bypasses catalog. Rejected with 422 if it doesn't match the Azure neural-voice regex. |

### Response 200

- `Content-Type: audio/mpeg`
- Body: raw MP3 bytes (`audio-24khz-48kbitrate-mono-mp3` format).
- Headers:
  - `X-Voice-Used`: the Azure voice id we ended up calling.
  - `X-Cost-Inr`: estimated cost in INR (4 decimal places).
  - `X-Char-Count`: number of characters synthesized.
  - `X-Request-Id`: UUIDv4 for log correlation.

### Errors

All errors emit `SynthesizeError` shape under `HTTPException.detail`:

```json
{
  "error": "AZURE_TTS_ERROR",
  "detail": "Azure TTS synthesis failed (upstream status 503)",
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Status | `error` code | Trigger |
|---|---|---|
| 400 | (FastAPI default) | Malformed JSON. |
| 401 | `AUTH_FAILED` | Missing/invalid Authorization header. |
| 403 | `AUTH_FAILED` | Caller is not an active student. |
| 413 | `TEXT_TOO_LONG` | Defense-in-depth check (Pydantic also catches at 422). |
| 422 | (FastAPI Pydantic) | Body validation failed (e.g. text > 2000 chars, bad voice_override). |
| 429 | `BUDGET_EXCEEDED` | Daily INR budget reached. |
| 500 | `INTERNAL_ERROR` | Unhandled exception (no PII in message). |
| 502 | `AZURE_TTS_ERROR` | Azure returned 5xx/429 after 3 retries. |
| 503 | `SERVICE_MISCONFIGURED` | Azure key missing / auth (0/401/403). |

## Cost model

Microsoft Neural pricing (verified 2026-05-24 via Azure docs):

- **$16 per 1M characters** for standard neural voices (en-IN-* and
  hi-IN-* are all in this tier).
- **Free tier: first 500K chars / month** per Azure subscription.
  Handled at the Azure billing layer; we don't track it in-code.

| Scenario | Chars | USD | INR (USD_TO_INR=83) |
|---|---|---|---|
| One Foxy reply | 300 | $0.0048 | ₹0.40 |
| One full chat session (10 replies) | 3000 | $0.048 | ₹3.98 |
| Daily per-student worst case (50 replies) | 15000 | $0.24 | ₹19.92 |
| 1M chars (catalog reference) | 1,000,000 | $16.00 | ₹1,328.00 |

The per-call cost is logged via the repository writer
(`log_voice_synthesize_event`) into `ops_events.context.cost_inr` and the
super-admin dashboard surfaces it under the
`voice.synthesize.success` / `voice.synthesize.failure` categories.

**Runaway-spend guard:** the org-level daily INR budget cap in
`shared/budget_guard.py` (default ₹5000/day, env `DAILY_AI_BUDGET_INR_CAP`)
already gates voice spend alongside the other AI workloads. No
per-student rate limit yet — Voice 2 follow-up via Redis when client
wiring lands.

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `AZURE_SPEECH_KEY` | yes (for TTS) | empty | Empty → endpoint returns 503 per-request. Service still BOOTS. |
| `AZURE_SPEECH_REGION` | yes (for TTS) | `centralindia` | Co-locate with Cloud Run (asia-south1). |

Local dev: copy `python/.env.example` to `python/.env` and fill in your
own Azure key. Provision the resource in **Central India** region for
the lowest round-trip from our Mumbai Cloud Run. Recommended resource
name: `alfanumrik-speech-prod`.

Production: Cloud Run pulls the key from Secret Manager. Ops provisions:

```bash
gcloud secrets create azure-speech-key --replication-policy=automatic
echo -n "<your-key>" | gcloud secrets versions add azure-speech-key --data-file=-
gcloud secrets add-iam-policy-binding azure-speech-key \
  --member=serviceAccount:<runtime-sa>@<project>.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

The `python/deploy/service.yaml` manifest already declares the
`secretKeyRef` for `azure-speech-key`. The region (`centralindia`) is a
plain env value in the manifest, not a secret.

## Free-tier budget tracker (operator note)

Azure does not expose a usage API on the standard subscription — the
"500K free chars" cap is enforced silently at billing time. To track
voluntarily:

1. Sum `ops_events.context.char_count` where `category = 'voice.synthesize.success'`
   grouped by month (UTC).
2. When the rolling 30-day total approaches 500K, alert ops.
3. Beyond 500K/month, expect ~$16 per additional million chars.

A super-admin dashboard tile for this is a Voice 2 follow-up.

## Rollout plan

- **Voice 1b (this PR)** — service-side endpoint shipped. Behind no
  feature flag at the service boundary. Not reachable from any client
  yet, so the surface area is zero in practice.
- **Voice 2** — `src/lib/voice.ts` adds the TTS half. A new feature
  flag `ff_python_voice_tts_v1` gates the client; default OFF. Rollout
  follows the standard hash-bucket pattern (1% → 10% → 50% → 100%) over
  ~2 weeks. The Edge Function proxy is a no-op pass-through; the
  service-side endpoint is the single auth + telemetry surface.
- **Voice 3** — adaptive language detection closes the loop: Whisper
  detects the student's language, the chat layer responds in the same
  language, and the TTS request inherits it. Hinglish becomes
  first-class.

## Adding a feature flag (Voice 2 follow-up — not part of this PR)

When Voice 2 lands:

1. Add `ff_python_voice_tts_v1` migration with `enabled=false`.
2. Client checks via the standard feature-flag fetch in
   `src/lib/feature-flags.ts`.
3. Hash bucket on `student_id` for deterministic per-student rollout.
4. The Cloud Run endpoint stays gated by the same mechanism — Voice 2
   adds a single `is_flag_enabled('ff_python_voice_tts_v1', student_id)`
   check at the start of the route, before auth.

## PII safety

- The raw text is **never** logged — `ops_events.context.char_count`
  carries the length only.
- The Azure response audio bytes are **never** logged — we hand them
  straight to the HTTP response body.
- The Azure REST API can echo SSML in 4xx error bodies; the `tts.py`
  module deliberately logs only the status code and voice name, not
  the body.
- The retry decorator logs `fn.__qualname__` and the exception string;
  the latter could contain status text but never the SSML body (we
  intercept before `RuntimeError(body)` is constructed).

## Reference

- Implementation: `python/services/ai/business/voice/tts.py`,
  `python/services/ai/business/voice/synthesize_handler.py`,
  `python/services/ai/api/v1/voice.py` (route).
- Tests: `python/tests/unit/test_voice_tts.py`,
  `python/tests/unit/test_voice_synthesize_handler.py`,
  `python/tests/unit/test_voice_models.py` (SynthesizeRequest section),
  `python/tests/integration/test_voice_synthesize_endpoint.py`.
- Regression: REG-75 in `.claude/regression-catalog.md`.
- Sibling endpoint (STT): see `docs/PYTHON_AI_ARCHITECTURE.md` and
  `python/services/ai/business/voice/transcribe.py`.
