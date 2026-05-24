# Python AI — Voice 2 Frontend Wiring

**Owner:** ai-engineer. **Reviewers:** assessment (curriculum scope), ops (rollout control), architect (CORS / auth boundary).
**Status:** Shipped 2026-05-24. Default OFF (rollout_pct=0) on staging + production.

## What this is

Voice 2 is the LAST piece of the original "Indian-accent voice" ask:
students speak to Foxy (their AI tutor) in Hindi / English / Hinglish
and hear Foxy's responses in natural Indian-accent neural voices.

Voice 1a + 1b shipped the FastAPI backends on Google Cloud Run
(asia-south1 / Mumbai):

- `POST {base}/v1/voice/transcribe` — OpenAI Whisper STT (multipart audio in,
  `TranscribeResponse` JSON out)
- `POST {base}/v1/voice/synthesize` — Azure neural TTS (JSON in, `audio/mpeg` bytes out)

Both endpoints require a Supabase student JWT. CORS is configured for
`https://alfanumrik.com` + `https://www.alfanumrik.com`.

Voice 2 wires `src/lib/voice.ts` to call those endpoints behind a per-
student feature flag (`ff_python_voice_tts_v1`). When the flag is OFF for
the student (default until ops bumps the rollout), the browser Web Speech
API continues to serve mic + speaker traffic — exactly as it did before.

## Architecture

```
React component (e.g. ChatInput.tsx)
  │
  ├─ usePythonVoiceEnabled(studentId)  ◄── src/lib/voice-feature-flag.ts
  │     │
  │     ├─ SWR GET /api/feature-flags/voice
  │     │     │
  │     │     └─ src/app/api/feature-flags/voice/route.ts
  │     │           └─ reads feature_flags row via service-role REST
  │     │
  │     └─ decidePythonVoice(studentId, flagState)
  │           └─ studentId present + flag enabled + !kill_switch +
  │              hashStudentBucket(studentId) < rollout_pct  →  TRUE
  │
  ├─ calls startListening({ pythonEnabled, getJwt, ... })
  │     │
  │     └─ src/lib/voice.ts
  │           │
  │           ├─ pythonEnabled=false                      → Web Speech path
  │           ├─ pythonEnabled=true + getJwt() === null   → Web Speech path
  │           └─ pythonEnabled=true + JWT present
  │                 │
  │                 ├─ MediaRecorder records audio/webm
  │                 ├─ transcribePython(blob, { jwt })   ◄── src/lib/voice-python-client.ts
  │                 │     │
  │                 │     └─ POST {base}/v1/voice/transcribe
  │                 │           on success → onResult(transcript, true), onEnd()
  │                 │           on ANY error → console.warn + Web Speech fallback
  │                 │
  │
  └─ calls speak(text, { pythonEnabled, getJwt, gender, ... })
        │
        └─ src/lib/voice.ts
              │
              └─ analogous to startListening; on success plays the audio/mpeg
                 Blob through an HTMLAudioElement; on error falls back to
                 window.speechSynthesis.
```

## Files

| File | Purpose |
|---|---|
| `src/lib/voice.ts` | Public `startListening` + `speak` entry points. Same signatures as pre-Voice-2; new optional `pythonEnabled` + `getJwt` fields on the option object. When set, branches to the Python path with Web Speech as the safety-net fallback. |
| `src/lib/voice-python-client.ts` | Pure fetch wrappers around `/v1/voice/transcribe` + `/v1/voice/synthesize`. Throws `PythonVoiceError` on any non-2xx, network error, timeout, or abort. No retries — the wrapper short-circuits to the safety net at the first failure. |
| `src/lib/voice-feature-flag.ts` | SWR-backed `usePythonVoiceEnabled(studentId)` hook + `decidePythonVoice` pure function + `hashStudentBucket` (byte-for-byte port of `python-ai-proxy.ts:hashBucket`). |
| `src/app/api/feature-flags/voice/route.ts` | GET endpoint returning the full `{ enabled, killSwitch, rolloutPct }` envelope. 1-min edge cache. Safe-default `{false, false, 0}` on any read failure. |
| `supabase/migrations/20260603190000_python_voice_tts_flag.sql` | Seeds `ff_python_voice_tts_v1` (default OFF, rollout_pct=0). |

## Bucket math

We bucket by `student_id`, not request_id, so the same student gets a
consistent voice experience within a session. Different students roll
out independently.

```ts
function hashStudentBucket(studentId: string): number {
  let h = 0;
  for (let i = 0; i < studentId.length; i++) {
    h = ((h << 5) - h + studentId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

// Routed to Python iff:
//   studentId != null && flag.enabled && !flag.killSwitch
//   && hashStudentBucket(studentId) < flag.rolloutPct
```

This is the same xor-shift used by:
- `supabase/functions/_shared/python-ai-proxy.ts:hashBucket` (request_id bucketing for admin proxies)
- `supabase/functions/_shared/mol/feature-flag.ts:inRolloutBucket` (student_id bucketing for MoL)

The byte-for-byte parity is pinned by an inline re-implementation in
`src/__tests__/lib/voice-feature-flag.test.ts::hashStudentBucket`.

## How to bump rollout

Ops bumps `metadata.rollout_pct` in the feature_flags row via the
super-admin Feature Flags page (or via direct SQL):

```sql
UPDATE public.feature_flags
SET metadata = jsonb_set(metadata, '{rollout_pct}', '10'),
    rollout_percentage = 10,
    updated_at = NOW()
WHERE flag_name = 'ff_python_voice_tts_v1';
```

Recommended ramp:

| Step | rollout_pct | Soak | Watch |
|---|---|---|---|
| 1 | 10 | 24-48h | mol_request_logs.function='voice', voice fallback rate |
| 2 | 25 | 24-48h | as above + per-student CSAT (if collected) |
| 3 | 50 | 24-48h | as above |
| 4 | 100 | indefinite | as above |

Frontend cache: the `/api/feature-flags/voice` endpoint caches for 60s
on the Vercel edge, and SWR caches for 60s on the client (`dedupingInterval: 60_000`).
A bump propagates to all in-flight clients within 60-120s — acceptable
given the worst-case impact is a student staying on their current voice
provider for that window.

## How to kill switch

Set `metadata.kill_switch = true`:

```sql
UPDATE public.feature_flags
SET metadata = jsonb_set(metadata, '{kill_switch}', 'true'),
    updated_at = NOW()
WHERE flag_name = 'ff_python_voice_tts_v1';
```

This forces `decidePythonVoice` to return false for every student
regardless of rollout_pct, until the kill switch is flipped back. Cache
TTL is the same 60-120s. The Web Speech fallback path takes over.

For a SECONDS-level escape hatch (faster than cache TTL), set the
`NEXT_PUBLIC_PYTHON_AI_BASE_URL` env var to an empty string in Vercel —
the client falls back at the first fetch attempt because the URL is
empty. This requires a re-deploy on Vercel but is faster than waiting
for the cache to clear during a Cloud Run outage.

## Voice catalog

The server-side voice mapping in
`python/services/ai/business/voice/tts.py:VOICE_CATALOG` selects the
Azure neural voice from `{language, gender}`:

| language | gender | voice id (Azure) |
|---|---|---|
| en | female | en-IN-NeerjaNeural |
| en | male | en-IN-PrabhatNeural |
| hi | female | hi-IN-SwaraNeural |
| hi | male | hi-IN-MadhurNeural |
| hinglish | female | en-IN-NeerjaNeural (English voice with Hindi inserts) |
| hinglish | male | en-IN-PrabhatNeural (same) |

The selected voice id is returned in the `X-Voice-Used` response header
and surfaces as `PythonSynthesizeResult.voiceUsed` to the client.

## Known limitations

1. **No streaming.** Whisper API does not offer partial transcripts;
   Azure does support streaming TTS but the client API gets complex.
   Voice 3 (later) can add streaming for >500-char responses.
2. **No real-time interim transcripts on the Python path.** The browser
   Web Speech API emits interim transcripts as the user speaks
   (`onResult(text, false)`); the Whisper path waits for the recording
   to finish and emits a single final `onResult(text, true)`. This is a
   UX difference users in the rollout may notice.
3. **Fixed female default.** The TTS `gender` defaults to female server-
   side (most pleasant for the Foxy persona per UX research). A future
   PR can add a per-student voice preference UI.
4. **500-char cap on TTS.** Mirrors the legacy Web Speech path's 500-
   char ceiling. Long Foxy explanations are truncated to the first 500
   chars after markdown stripping. Voice 3 can lift this for streaming.
5. **MediaRecorder requires HTTPS.** Localhost works; non-HTTPS deploys
   would silently fall back to Web Speech because `getUserMedia` rejects.
   Vercel + Cloud Run are both HTTPS-only so this is only relevant for
   local dev.
6. **Cost.** Each STT call burns ~$0.006 per minute of audio + Cloud Run
   compute. Each TTS call burns ~$16 per 1M chars + Cloud Run. Daily
   per-student caps are NOT yet enforced client-side; the server emits
   `mol_request_logs` rows with per-call cost so ops can audit. A
   Phase 3 follow-up will add Redis-based daily caps if cost runs hot.

## Safety contract (DO NOT regress)

REG-77 in `.claude/regression-catalog.md` pins the user-visible safety
net. Any change that breaks one of the following is a release blocker:

1. **Python fetch failure (network, 4xx, 5xx, timeout, abort) → fall
   through to Web Speech.** Never surface a user-visible error from the
   Python call; only a `console.warn` with status + code (no transcript,
   no audio bytes, no JWT).
2. **No JWT → fall through immediately.** Don't attempt the Python
   fetch on an unauthenticated mic press.
3. **Flag OFF / kill switch / bucket miss → Web Speech without ever
   contacting Cloud Run.**
4. **Cache + flag fetch failure → safe default `{enabled: false,
   killSwitch: false, rolloutPct: 0}`.** Never accidentally enable on a
   transient flag-server outage (P12).
5. **The legacy Web Speech code path MUST stay in `src/lib/voice.ts`.**
   Even when the rollout hits 100% and stays stable, the Web Speech
   path is the safety net. Removal is a separate cleanup PR after a
   minimum 2-week soak at 100% (operator runbook to be drafted).

## Env vars

| Variable | Where | Default | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_PYTHON_AI_BASE_URL` | Vercel (client bundle) | `https://ai-services-518404877846.asia-south1.run.app` | Base URL for the Python AI service. Inlined into the client bundle at build time. |
| `PYTHON_AI_BASE_URL` | Supabase Edge Function secret | unset (proxy disabled until set) | Server-side proxy URL for the Edge Function path. NOT used by Voice 2 (which calls Cloud Run from the browser), but referenced for symmetry with the Phase 1+ admin proxies. |

## See also

- `docs/PYTHON_AI_OPERATIONS.md` — operational runbook for the Cloud Run service
- `docs/PYTHON_AI_LONG_TERM_VISION.md` — migration roadmap (Phases 1-6)
- `supabase/functions/_shared/python-ai-proxy.ts` — Edge Function proxy helper (sibling for admin functions)
- `python/services/ai/business/voice/` — server-side Whisper + Azure handlers
- `.claude/regression-catalog.md` REG-77 — fallback safety contract
