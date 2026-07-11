/**
 * voice-python-client.ts — Cloud Run STT + TTS HTTP client (Voice 2 frontend).
 *
 * Pure fetch wrappers around the FastAPI service hosted on Google Cloud Run
 * (asia-south1 / Mumbai). The Voice 1a/1b backends shipped:
 *
 *   POST {base}/v1/voice/transcribe   — multipart audio → transcript (Whisper)
 *   POST {base}/v1/voice/synthesize   — JSON text → audio/mpeg bytes (Azure)
 *
 * Both endpoints require a Supabase student JWT. Both have CORS configured
 * for https://alfanumrik.com + https://www.alfanumrik.com.
 *
 * The TS contract MUST stay in lock-step with the Pydantic models at
 * python/services/ai/business/voice/models.py — fields renamed on the
 * Python side break the frontend.
 *
 * Design constraints:
 *   - Pure functions. No React, no state, no SWR. Callers manage lifecycle.
 *   - Throws PythonVoiceError on any non-2xx; never silently returns a partial
 *     result. The Voice 2 fallback path in src/lib/voice.ts catches and falls
 *     through to the browser Web Speech API.
 *   - Hard timeouts: STT 30s, TTS 15s. Cloud Run ceiling is 300s but the
 *     frontend UX would feel broken much sooner — better to fail fast and
 *     let Web Speech take over.
 *   - No retries. Whisper + Azure are reliable; transient blips fall through
 *     to Web Speech rather than spinning the user on a busy "thinking…" state.
 *   - No PII in any thrown error message — only the HTTP status + machine
 *     error code parsed from the response envelope.
 *
 * Out of scope (Voice 3):
 *   - Streaming partial transcripts (Whisper API doesn't offer this)
 *   - Streaming TTS audio chunks (Azure supports it; client API is complex)
 *   - Per-utterance retry / backoff
 */

// Direct browser invocation is disabled by default. Cloud Run now requires a
// Google caller identity that must never be embedded in the public bundle.
// A future trusted proxy may provide a URL explicitly after it implements the
// two-token contract; there is deliberately no hardcoded production fallback.
export const PYTHON_AI_BASE_URL: string =
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PYTHON_AI_BASE_URL?.trim()) || '';

/** STT timeout — Whisper typically returns in 2-8s for ≤60s audio; 30s leaves headroom. */
const STT_TIMEOUT_MS = 30_000;

/** TTS timeout — Azure neural typically returns in 1-3s for ≤2000 chars; 15s leaves headroom. */
const TTS_TIMEOUT_MS = 15_000;

// ── Types (must match python/services/ai/business/voice/models.py) ─────────

/** Detected-language enum returned by the Whisper STT endpoint. */
export type DetectedLanguage = 'en' | 'hi' | 'hinglish' | 'unknown';

/** Supported language values for the TTS endpoint. (Server side restricts further per voice catalog.) */
export type SynthesizeLanguage = 'en' | 'hi' | 'hinglish';

/** Voice gender. Server defaults to female if omitted. */
export type SynthesizeGender = 'female' | 'male';

/**
 * Success envelope mirroring `TranscribeResponse` in
 * python/services/ai/business/voice/models.py. Field names MUST match.
 */
export interface PythonTranscribeResult {
  /** Whisper-transcribed text (trimmed). */
  transcript: string;
  /** Whisper-detected language, with the Hinglish heuristic applied server-side. */
  detected_language: DetectedLanguage;
  /** Audio duration in seconds (Whisper verbose_json), used for cost reconciliation. */
  duration_seconds: number;
  /** Container format the server received — echoed for debugging. */
  audio_format: string;
  /** Server-estimated INR cost for this STT call (audio_seconds × Whisper rate × FX). */
  cost_inr: number;
  /** UUIDv4 echoed for log correlation. */
  request_id: string;
}

/** Caller-controlled synthesize request body. */
export interface PythonSynthesizeOptions {
  /** Text to synthesize. 1-2000 chars; server rejects with 413 if too long. */
  text: string;
  /** Speech language — picks the corresponding voice from the server catalog. */
  language: SynthesizeLanguage;
  /** Optional gender preference. Server defaults to 'female' when omitted. */
  gender?: SynthesizeGender;
}

/** Synthesize success envelope — audio bytes plus header-derived metadata. */
export interface PythonSynthesizeResult {
  /** audio/mpeg bytes (MP3-encoded Azure neural speech). Play via Audio element. */
  audio: Blob;
  /** Azure voice id used (e.g. 'en-IN-NeerjaNeural'). Read from X-Voice-Used. */
  voiceUsed: string;
  /** Server-estimated INR cost for this TTS call. Read from X-Cost-Inr. */
  costInr: number;
  /** UUIDv4 echoed for log correlation. Read from X-Request-Id. */
  requestId: string;
}

/**
 * Error envelope. `.status` mirrors the HTTP status; `.code` is the machine-
 * readable identifier from the Python TranscribeError schema ('AUTH_FAILED',
 * 'PAYLOAD_TOO_LARGE', 'BUDGET_EXCEEDED', 'WHISPER_ERROR', ...).
 *
 * Network errors (fetch rejected before any response) → status = 0.
 * Abort → status = 0, code = 'ABORTED'.
 * Timeout → status = 0, code = 'TIMEOUT'.
 */
export class PythonVoiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(args: { status: number; code: string; message: string; requestId?: string | null }) {
    super(args.message);
    this.name = 'PythonVoiceError';
    this.status = args.status;
    this.code = args.code;
    this.requestId = args.requestId ?? null;
  }
}

function requirePythonAiBaseUrl(): string {
  // Keep the property access explicit so Next.js can inline NEXT_PUBLIC_* at
  // build time. Reading at call time also lets tests exercise disabled mode.
  const baseUrl =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PYTHON_AI_BASE_URL?.trim()) || '';
  if (!baseUrl) {
    throw new PythonVoiceError({
      status: 503,
      code: 'SERVICE_DISABLED',
      message: 'Python voice is disabled until a trusted identity proxy is configured',
    });
  }
  return baseUrl.replace(/\/$/, '');
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Race a Promise against an AbortController-driven timeout. Returns the
 * settled promise or throws a PythonVoiceError tagged TIMEOUT.
 */
function withTimeout<T>(
  exec: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Forward external aborts so callers can cancel via their own AbortSignal
  // (e.g. on component unmount). DOM AbortSignal lacks .addEventListener
  // typings in older lib.dom but is widely supported at runtime.
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return exec(controller.signal)
    .catch((err: unknown) => {
      if (err instanceof PythonVoiceError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Distinguish caller-aborted (externalSignal.aborted) from timer-fired.
        const code = externalSignal?.aborted ? 'ABORTED' : 'TIMEOUT';
        throw new PythonVoiceError({
          status: 0,
          code,
          message: `voice request ${code === 'TIMEOUT' ? 'timed out' : 'aborted'} after ${timeoutMs}ms`,
        });
      }
      throw new PythonVoiceError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => clearTimeout(timer));
}

/**
 * Parse a non-2xx response into a typed PythonVoiceError. Tolerates:
 *   - JSON body `{detail: {error, detail, request_id}}` (the Python contract)
 *   - JSON body `{error, detail, request_id}` (without the detail wrapper)
 *   - Plain text body (FastAPI / load-balancer fallback)
 *   - Empty body
 */
async function buildErrorFromResponse(res: Response): Promise<PythonVoiceError> {
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    // ignore — body read failure is non-fatal for the error path.
  }

  let code = 'UPSTREAM_ERROR';
  let detail = `voice endpoint returned HTTP ${res.status}`;
  let requestId: string | null = res.headers.get('x-request-id');

  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      const envelope =
        parsed && typeof parsed === 'object' && 'detail' in parsed && typeof parsed.detail === 'object'
          ? (parsed.detail as Record<string, unknown>)
          : parsed;
      if (envelope && typeof envelope === 'object') {
        if (typeof envelope.error === 'string') code = envelope.error;
        if (typeof envelope.detail === 'string') detail = envelope.detail;
        if (typeof envelope.request_id === 'string') requestId = envelope.request_id;
      }
    } catch {
      // Plain text body — keep the default code and use the first 200 chars
      // as the detail message. We deliberately never log the audio bytes /
      // transcript / student id; this path only sees the server's error text.
      detail = bodyText.slice(0, 200);
    }
  }

  return new PythonVoiceError({ status: res.status, code, message: detail, requestId });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Transcribe a recorded audio Blob via the Cloud Run Whisper endpoint.
 *
 * @param audioBlob Audio bytes recorded by MediaRecorder. The function infers
 *                  the container from blob.type (e.g. 'audio/webm') and
 *                  uploads under the matching filename so the server's
 *                  extension-based format detection works.
 * @param options.jwt Supabase student JWT (Authorization: Bearer ...).
 * @param options.languageHint Optional 'en' | 'hi' | 'hinglish' hint to bias
 *                  Whisper's auto-detect.
 * @param options.signal Optional AbortSignal for caller-driven cancellation.
 *
 * @throws PythonVoiceError on any non-2xx, network error, timeout, or abort.
 */
export async function transcribePython(
  audioBlob: Blob,
  options: { jwt: string; languageHint?: SynthesizeLanguage; signal?: AbortSignal },
): Promise<PythonTranscribeResult> {
  if (!options.jwt) {
    throw new PythonVoiceError({
      status: 401,
      code: 'AUTH_FAILED',
      message: 'no student JWT provided',
    });
  }

  // Pick a filename whose extension matches the blob type so the server's
  // _extract_audio_format() resolves to the same container the browser sent.
  // Falls back to 'webm' which is the documented Cloud Run default.
  const ext = mimeToExtension(audioBlob.type);
  const fileName = `voice.${ext}`;

  const formData = new FormData();
  formData.append('audio', audioBlob, fileName);
  if (options.languageHint) {
    formData.append('language_hint', options.languageHint);
  }

  const url = `${requirePythonAiBaseUrl()}/v1/voice/transcribe`;

  return withTimeout(
    async (signal) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          // Do NOT set Content-Type — the browser must set the multipart
          // boundary header automatically; manually setting it breaks parsing.
          Authorization: `Bearer ${options.jwt}`,
        },
        body: formData,
        signal,
      });

      if (!res.ok) {
        throw await buildErrorFromResponse(res);
      }

      // The response body must be JSON shaped like TranscribeResponse. A
      // shape-mismatch (e.g. server outage returning HTML) throws PARSE_ERROR
      // so the caller falls through to Web Speech rather than feeding garbage
      // into the chat.
      let json: unknown;
      try {
        json = await res.json();
      } catch (err) {
        throw new PythonVoiceError({
          status: res.status,
          code: 'PARSE_ERROR',
          message: 'voice transcribe response was not valid JSON',
          requestId: res.headers.get('x-request-id'),
        });
      }

      if (!json || typeof json !== 'object') {
        throw new PythonVoiceError({
          status: res.status,
          code: 'PARSE_ERROR',
          message: 'voice transcribe response missing envelope',
        });
      }

      const r = json as Record<string, unknown>;
      const transcript = typeof r.transcript === 'string' ? r.transcript : '';
      const detected: DetectedLanguage =
        r.detected_language === 'en' ||
        r.detected_language === 'hi' ||
        r.detected_language === 'hinglish' ||
        r.detected_language === 'unknown'
          ? r.detected_language
          : 'unknown';
      const duration = typeof r.duration_seconds === 'number' ? r.duration_seconds : 0;
      const audioFormat = typeof r.audio_format === 'string' ? r.audio_format : ext;
      const costInr = typeof r.cost_inr === 'number' ? r.cost_inr : 0;
      const requestId = typeof r.request_id === 'string' ? r.request_id : '';

      return {
        transcript,
        detected_language: detected,
        duration_seconds: duration,
        audio_format: audioFormat,
        cost_inr: costInr,
        request_id: requestId,
      };
    },
    STT_TIMEOUT_MS,
    options.signal,
  );
}

/**
 * Synthesize Indian-accent neural speech via the Cloud Run Azure TTS endpoint.
 *
 * Returns the audio/mpeg Blob ready to feed into an HTMLAudioElement.
 *
 * @throws PythonVoiceError on any non-2xx, network error, timeout, or abort.
 */
export async function synthesizePython(
  opts: PythonSynthesizeOptions,
  options: { jwt: string; signal?: AbortSignal },
): Promise<PythonSynthesizeResult> {
  if (!options.jwt) {
    throw new PythonVoiceError({
      status: 401,
      code: 'AUTH_FAILED',
      message: 'no student JWT provided',
    });
  }
  const trimmedText = (opts.text ?? '').trim();
  if (!trimmedText) {
    throw new PythonVoiceError({
      status: 400,
      code: 'EMPTY_TEXT',
      message: 'voice synthesize requires non-empty text',
    });
  }
  if (trimmedText.length > 2000) {
    // Mirror the server-side limit so we fail fast rather than burning a
    // round-trip on text that would be 413'd anyway. Server is authoritative.
    throw new PythonVoiceError({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: `voice synthesize text exceeds 2000-char limit (${trimmedText.length})`,
    });
  }

  const url = `${requirePythonAiBaseUrl()}/v1/voice/synthesize`;
  const body = JSON.stringify({
    text: trimmedText,
    language: opts.language,
    gender: opts.gender ?? 'female',
  });

  return withTimeout(
    async (signal) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.jwt}`,
          // Accept audio/mpeg explicitly so a misconfigured upstream that
          // tries to negotiate JSON falls into the error path.
          Accept: 'audio/mpeg, application/json',
        },
        body,
        signal,
      });

      if (!res.ok) {
        throw await buildErrorFromResponse(res);
      }

      const audio = await res.blob();
      // Sanity: empty body shouldn't happen on 200 but defensive checks keep
      // the safety-net Web Speech path triggerable rather than playing silence.
      if (audio.size === 0) {
        throw new PythonVoiceError({
          status: 502,
          code: 'EMPTY_AUDIO',
          message: 'voice synthesize returned a 200 with no audio bytes',
          requestId: res.headers.get('x-request-id'),
        });
      }

      const voiceUsed = res.headers.get('x-voice-used') ?? '';
      const costHeader = res.headers.get('x-cost-inr');
      const costInr = costHeader ? Number(costHeader) || 0 : 0;
      const requestId = res.headers.get('x-request-id') ?? '';

      return { audio, voiceUsed, costInr, requestId };
    },
    TTS_TIMEOUT_MS,
    options.signal,
  );
}

/**
 * Map a MediaRecorder mime type ('audio/webm;codecs=opus') to a Whisper-
 * supported container extension. Used to name the multipart filename so the
 * Cloud Run handler's extension-based format detection resolves correctly.
 */
export function mimeToExtension(mime: string): string {
  if (!mime) return 'webm';
  const base = mime.toLowerCase().split(';')[0].trim();
  switch (base) {
    case 'audio/webm':
      return 'webm';
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a':
      return 'm4a';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/flac':
      return 'flac';
    default:
      return 'webm';
  }
}
