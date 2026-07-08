/**
 * voice.ts — Voice input/output for Foxy AI Tutor.
 *
 * Voice 2 (2026-05-24) ships flag-gated Cloud Run routing on top of the
 * existing browser Web Speech API. When `ff_python_voice_tts_v1` is enabled
 * for the student, mic/speaker traffic forwards to the Python FastAPI
 * service (Whisper STT + Azure neural Indian voices); otherwise the
 * browser Web Speech API continues to handle everything as before.
 *
 * Routing decision lives in `src/lib/voice-feature-flag.ts` and is computed
 * by the React component that owns the mic/speaker UI; this module receives
 * the decision via the `studentId` + `pythonEnabled` options (or just
 * `pythonRouter` callable). When those are omitted the legacy Web Speech
 * path runs — no behaviour change for callers that haven't upgraded.
 *
 * Public API is UNCHANGED (same function names, same return shapes). Voice 2
 * is purely additive: extra optional fields in ListenOptions / SpeakOptions.
 *
 * Safety net (NEVER violated):
 *   1. Python fetch fails for any reason (network, 4xx, 5xx, timeout, abort)
 *      → fall through to Web Speech with a console.warn (no transcript /
 *      audio in the log).
 *   2. No JWT → fall through to Web Speech immediately (no fetch attempt).
 *   3. Flag OFF / kill switch / bucket miss → Web Speech without ever
 *      contacting Cloud Run.
 *
 * Feature detection: isVoiceSupported() before any call.
 */

import {
  mimeToExtension,
  PythonVoiceError,
  synthesizePython,
  transcribePython,
  type DetectedLanguage,
  type SynthesizeLanguage,
} from './voice-python-client';

/* ══════════════════════════════════════════════════════════════
   INTERNAL TYPES  (SpeechRecognition not in default TS lib)
   ══════════════════════════════════════════════════════════════ */

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/* ══════════════════════════════════════════════════════════════
   LANGUAGE MAPPING
   'en' | 'hi' | 'hinglish' → BCP-47 code
   ══════════════════════════════════════════════════════════════ */

const LANG_MAP: Record<string, string> = {
  hi: 'hi-IN',
  en: 'en-IN',
  hinglish: 'hi-IN', // Hindi recognition handles mixed script best
};

function toBcp47(language: string): string {
  return LANG_MAP[language] ?? 'en-IN';
}

/** Map an arbitrary 'en' | 'hi' | 'hinglish'-ish string to the Python TTS enum. */
function toPythonLanguage(language: string): SynthesizeLanguage {
  if (language === 'hi') return 'hi';
  if (language === 'hinglish') return 'hinglish';
  return 'en';
}

/* ══════════════════════════════════════════════════════════════
   MARKDOWN STRIPPER  (clean text before TTS)
   ══════════════════════════════════════════════════════════════ */

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')          // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')             // inline code
    .replace(/#{1,6}\s+/gm, '')              // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')         // bold
    .replace(/\*(.+?)\*/g, '$1')             // italic
    .replace(/__(.+?)__/g, '$1')             // bold (alt)
    .replace(/_(.+?)_/g, '$1')              // italic (alt)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^[-*+]\s+/gm, '')              // unordered list bullets
    .replace(/^\d+\.\s+/gm, '')              // ordered list numbers
    .replace(/^>\s+/gm, '')                  // blockquotes
    .replace(/\n{3,}/g, '\n\n')              // collapse excessive newlines
    .trim();
}

/* ══════════════════════════════════════════════════════════════
   FEATURE DETECTION
   ══════════════════════════════════════════════════════════════ */

export function isVoiceSupported(): { stt: boolean; tts: boolean } {
  if (typeof window === 'undefined') return { stt: false, tts: false };
  const w = window as unknown as Record<string, unknown>;
  return {
    stt: !!(w.SpeechRecognition || w.webkitSpeechRecognition),
    tts: !!(window.speechSynthesis),
  };
}

/* ══════════════════════════════════════════════════════════════
   VOICE LIST
   ══════════════════════════════════════════════════════════════ */

/** Returns available TTS voices for the given language code ('hi', 'en', etc.) */
export function getVoicesForLanguage(lang: string): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  const prefix = toBcp47(lang).split('-')[0]; // 'hi' or 'en'
  return window.speechSynthesis.getVoices().filter(v => v.lang.startsWith(prefix));
}

/* ══════════════════════════════════════════════════════════════
   PYTHON ROUTING — opt-in extras on ListenOptions / SpeakOptions
   ══════════════════════════════════════════════════════════════ */

/**
 * Callback that returns a Supabase student JWT (or null if unavailable).
 * Async so the caller can pull from `supabase.auth.getSession()` lazily.
 * Returning null short-circuits Python routing to Web Speech.
 */
export type JwtProvider = () => Promise<string | null>;

interface PythonRoutingOptions {
  /**
   * Whether the per-student feature flag says this session should attempt
   * Python routing. Computed by the caller (typically via
   * `usePythonVoiceEnabled(studentId)` in src/lib/voice-feature-flag.ts).
   * When false or undefined → legacy Web Speech path runs immediately.
   */
  pythonEnabled?: boolean;
  /** Supplies the student JWT. Omitted or returning null → Web Speech. */
  getJwt?: JwtProvider;
}

/* ══════════════════════════════════════════════════════════════
   SPEECH-TO-TEXT  (Voice Input)
   ══════════════════════════════════════════════════════════════ */

export interface ListenOptions extends PythonRoutingOptions {
  /** 'hi' | 'en' | 'hinglish' — mapped to BCP-47 for the browser */
  language: string;
  /** Called on every interim/final transcript update.
   *  isFinal=false → interim (grey preview); isFinal=true → committed text */
  onResult: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  onEnd: () => void;
  /** Default false — stop after first utterance (tutoring UX) */
  continuous?: boolean;
  /** Optional callback fired after a Python transcript with the detected language. */
  onPythonResult?: (detected: DetectedLanguage) => void;
}

/**
 * Browser Web Speech API recognition path. Pulled out so the Python wrapper
 * can fall through to it on any failure without duplicating the recognition
 * setup. Returns the same `{ stop }` shape as `startListening`.
 */
function startListeningWebSpeech(options: ListenOptions): { stop: () => void } {
  const w = window as unknown as Record<string, unknown>;
  const SpeechRecognitionCtor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionInstance)
    | undefined;

  if (!SpeechRecognitionCtor) {
    options.onError('not_supported');
    return { stop: () => {} };
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = toBcp47(options.language);
  recognition.interimResults = true;
  recognition.continuous = options.continuous ?? false;

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let finalText = '';
    let interimText = '';
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalText += result[0].transcript;
      } else {
        interimText += result[0].transcript;
      }
    }
    if (finalText) {
      options.onResult(finalText.trim(), true);
    } else if (interimText) {
      options.onResult(interimText.trim(), false);
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    options.onError(event.error ?? 'recognition_error');
  };

  recognition.onend = () => {
    options.onEnd();
  };

  recognition.start();
  return { stop: () => recognition.stop() };
}

/**
 * Record a single utterance via MediaRecorder, returning the captured Blob.
 *
 * Voice 2 STT path. The MediaRecorder runs until stop() is called (caller
 * presses the mic button again) OR the AbortSignal fires (component unmount).
 * MimeType selection prefers audio/webm with Opus, the universal Chrome /
 * Firefox / Edge default and a Whisper-supported container.
 *
 * Returns a Promise that resolves with the recorded Blob when the recorder
 * stops. Rejects if microphone permission is denied or the recorder errors.
 */
function recordUtterance(args: {
  signal: AbortSignal;
  stopRef: { current: (() => void) | null };
}): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      reject(new Error('MediaRecorder unavailable'));
      return;
    }

    const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    const supportedMime =
      mimeCandidates.find(
        (mt) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mt),
      ) ?? '';

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        let stopped = false;
        const chunks: Blob[] = [];

        const recorder = supportedMime
          ? new MediaRecorder(stream, { mimeType: supportedMime })
          : new MediaRecorder(stream);

        const cleanup = () => {
          stream.getTracks().forEach((t) => t.stop());
        };

        recorder.addEventListener('dataavailable', (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        });

        recorder.addEventListener('error', (e) => {
          if (!stopped) {
            stopped = true;
            cleanup();
            reject(new Error(`MediaRecorder error: ${(e as ErrorEvent).message ?? 'unknown'}`));
          }
        });

        recorder.addEventListener('stop', () => {
          if (stopped) return;
          stopped = true;
          cleanup();
          const blob = new Blob(chunks, { type: recorder.mimeType || supportedMime || 'audio/webm' });
          resolve(blob);
        });

        // Hook up the external stop trigger so the caller can stop the
        // recorder via the returned `{ stop }` handle.
        args.stopRef.current = () => {
          try {
            if (recorder.state !== 'inactive') recorder.stop();
          } catch {
            // ignore — already stopped
          }
        };

        // External abort (component unmount) → bail without emitting a result.
        const onAbort = () => {
          if (stopped) return;
          stopped = true;
          try {
            if (recorder.state !== 'inactive') recorder.stop();
          } catch {
            // ignore
          }
          cleanup();
          reject(new DOMException('Aborted', 'AbortError'));
        };
        if (args.signal.aborted) {
          onAbort();
        } else {
          args.signal.addEventListener('abort', onAbort, { once: true });
        }

        recorder.start();
      })
      .catch((err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

/**
 * Voice 2 entry point. When `options.pythonEnabled` is true AND a JWT is
 * available, records the utterance via MediaRecorder + posts to Cloud Run
 * Whisper. On any failure falls through to the browser Web Speech path
 * (which becomes the implicit "Listening…" UX after a fallback).
 *
 * When `pythonEnabled` is false or undefined, runs the legacy Web Speech
 * path immediately. Public contract is identical to the pre-Voice-2
 * implementation for that case.
 */
export function startListening(options: ListenOptions): { stop: () => void } {
  if (typeof window === 'undefined') {
    options.onError('not_supported');
    return { stop: () => {} };
  }

  if (!options.pythonEnabled || !options.getJwt) {
    return startListeningWebSpeech(options);
  }

  // Python routing path. We record audio via MediaRecorder, then POST the
  // resulting blob to Cloud Run. The lifecycle is:
  //   1. stopRef.current = () => recorder.stop()  (set inside recordUtterance)
  //   2. The user clicks Stop → recorder.stop() → recordUtterance resolves
  //   3. We post to Cloud Run → emit final transcript via onResult(text, true)
  //   4. Emit onEnd()
  //
  // Aborting (component unmount) calls controller.abort() which cancels both
  // the recorder and any in-flight fetch.

  const controller = new AbortController();
  const stopRef: { current: (() => void) | null } = { current: null };
  let fellBackToWebSpeech = false;
  let webSpeechHandle: { stop: () => void } | null = null;

  // We swap `stop` to whichever path is active. The initial implementation
  // calls into the MediaRecorder lifecycle; after a fallback, it routes to
  // the Web Speech handle's stop.
  const handle: { stop: () => void } = {
    stop: () => {
      if (fellBackToWebSpeech && webSpeechHandle) {
        webSpeechHandle.stop();
        return;
      }
      // Trigger MediaRecorder stop so recordUtterance can resolve. Don't
      // abort yet — we want the blob to flush so the Python call still goes.
      stopRef.current?.();
    },
  };

  const fallback = (reason: unknown) => {
    fellBackToWebSpeech = true;
    // Log only the error class + status (no transcript, no audio bytes).
    if (reason instanceof PythonVoiceError) {
      console.warn(
        `[voice] Python STT failed (status=${reason.status} code=${reason.code}); falling back to Web Speech`,
      );
    } else if (reason instanceof Error) {
      console.warn(`[voice] Python STT failed (${reason.name}); falling back to Web Speech`);
    } else {
      console.warn('[voice] Python STT failed; falling back to Web Speech');
    }
    webSpeechHandle = startListeningWebSpeech(options);
    handle.stop = () => webSpeechHandle?.stop();
  };

  // Kick off the Python pipeline asynchronously. recordUtterance returns a
  // Promise; we don't await here because startListening must return the
  // handle synchronously for the existing UI.
  (async () => {
    let jwt: string | null = null;
    try {
      jwt = await options.getJwt?.() ?? null;
    } catch {
      jwt = null;
    }
    if (!jwt) {
      // No JWT → straight to Web Speech (no fetch attempt). The Python
      // routing decision is fail-safe by design.
      fallback(new Error('no JWT — falling back without contacting Cloud Run'));
      return;
    }

    let blob: Blob;
    try {
      blob = await recordUtterance({ signal: controller.signal, stopRef });
    } catch (err) {
      // Recording itself failed (mic denied, browser bug). Fall through
      // to Web Speech which will retry recognition via the browser API.
      // We can't fall back AFTER the user already pressed Stop because
      // the Web Speech recognizer would need a fresh mic prompt — at
      // this point we just emit error + end so the UI resets.
      const cause = err instanceof Error ? err.message : String(err);
      options.onError(`record_failed:${cause}`);
      options.onEnd();
      return;
    }

    if (controller.signal.aborted) {
      // Component unmounted — drop result silently.
      return;
    }

    try {
      const result = await transcribePython(blob, {
        jwt,
        languageHint: toPythonLanguage(options.language),
        signal: controller.signal,
      });
      // Mirror the Web Speech callback shape: emit a single final-text event.
      options.onResult(result.transcript, true);
      options.onPythonResult?.(result.detected_language);
      options.onEnd();
    } catch (err) {
      // P12 fallback safety net. We already have the audio blob, but the
      // Python call failed — fall through to Web Speech (the user will
      // be prompted to speak again, since the recording is consumed).
      fallback(err);
      // Don't emit onEnd here — Web Speech's onend handler will fire.
    }
  })();

  return {
    stop: () => {
      // Wrap so the latest `stop` impl wins (it gets swapped on fallback).
      handle.stop();
      // Once stopped, also abort the AbortSignal so any in-flight fetch
      // unwinds. We do this AFTER recorder.stop() so the blob can flush.
      controller.abort();
    },
  };
}

/* ══════════════════════════════════════════════════════════════
   TEXT-TO-SPEECH  (Voice Output)
   ══════════════════════════════════════════════════════════════ */

export interface SpeakOptions extends PythonRoutingOptions {
  language: string;
  /** 0.8–1.2 for natural speed. Default 0.9 */
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  /** Voice 2 — Azure neural voice gender. Default 'female'. Ignored on Web Speech path. */
  gender?: 'female' | 'male';
}

/**
 * Browser speechSynthesis path. Identical to the pre-Voice-2 `speak`. Pulled
 * out so the Python wrapper can fall through cleanly on any failure.
 */
function speakWebSpeech(text: string, options: SpeakOptions): { cancel: () => void } {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    options.onEnd?.();
    return { cancel: () => {} };
  }

  // Always cancel any current speech before starting new
  window.speechSynthesis.cancel();

  const clean = stripMarkdown(text).substring(0, 500);
  if (!clean.trim()) {
    options.onEnd?.();
    return { cancel: () => {} };
  }

  const utterance = new SpeechSynthesisUtterance(clean);
  const langCode = toBcp47(options.language);
  utterance.lang = langCode;
  utterance.rate = options.rate ?? 0.9;
  utterance.pitch = options.pitch ?? 1;

  // Pick best native voice — voices may load asynchronously
  const assignVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    const match =
      voices.find(v => v.lang === langCode) ??
      voices.find(v => v.lang.startsWith(langCode.split('-')[0]));
    if (match) utterance.voice = match;
  };

  if (window.speechSynthesis.getVoices().length > 0) {
    assignVoice();
  } else {
    window.speechSynthesis.addEventListener('voiceschanged', assignVoice, { once: true });
  }

  if (options.onEnd) utterance.onend = options.onEnd;

  window.speechSynthesis.speak(utterance);

  return { cancel: () => window.speechSynthesis.cancel() };
}

/**
 * Play an audio Blob through an Audio element. Returns a cancel handle that
 * pauses playback and releases the object URL. Voice 2 TTS playback helper.
 */
function playAudioBlob(blob: Blob, onEnd?: () => void): { cancel: () => void } {
  if (typeof window === 'undefined' || typeof URL === 'undefined' || typeof Audio === 'undefined') {
    onEnd?.();
    return { cancel: () => {} };
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  let cancelled = false;
  const cleanup = () => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore — already revoked
    }
  };
  audio.addEventListener(
    'ended',
    () => {
      if (cancelled) return;
      cleanup();
      onEnd?.();
    },
    { once: true },
  );
  audio.addEventListener(
    'error',
    () => {
      if (cancelled) return;
      cancelled = true;
      cleanup();
      onEnd?.();
    },
    { once: true },
  );
  // play() returns a Promise that may reject if autoplay is blocked; we
  // surface that to onEnd so the caller's UI doesn't hang.
  audio.play().catch(() => {
    if (cancelled) return;
    cancelled = true;
    cleanup();
    onEnd?.();
  });
  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      try {
        audio.pause();
      } catch {
        // ignore
      }
      cleanup();
    },
  };
}

/**
 * Speak text aloud. When `options.pythonEnabled` is true AND a JWT is
 * available, posts to Cloud Run Azure neural TTS; otherwise uses the
 * browser speechSynthesis. On any Python failure, falls back to Web Speech
 * with a console.warn (no PII).
 *
 * Public contract unchanged: returns `{ cancel: () => void }` synchronously.
 * Strips markdown, limits to 500 chars to avoid 2-minute speeches.
 */
export function speak(text: string, options: SpeakOptions): { cancel: () => void } {
  if (typeof window === 'undefined') {
    options.onEnd?.();
    return { cancel: () => {} };
  }

  if (!options.pythonEnabled || !options.getJwt) {
    return speakWebSpeech(text, options);
  }

  // Strip markdown + char-cap BEFORE we hit the Python service so we don't
  // pay for synthesizing 4000 chars of code fences. Mirrors the Web Speech
  // path's 500-char ceiling.
  const clean = stripMarkdown(text).substring(0, 500);
  if (!clean.trim()) {
    options.onEnd?.();
    return { cancel: () => {} };
  }

  // Also cancel any existing browser speechSynthesis utterance so a fallback
  // doesn't double-up audio with a queued utterance.
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  const controller = new AbortController();
  const handle: { cancel: () => void } = { cancel: () => controller.abort() };

  const fallback = (reason: unknown) => {
    if (reason instanceof PythonVoiceError) {
      console.warn(
        `[voice] Python TTS failed (status=${reason.status} code=${reason.code}); falling back to Web Speech`,
      );
    } else if (reason instanceof Error) {
      console.warn(`[voice] Python TTS failed (${reason.name}); falling back to Web Speech`);
    } else {
      console.warn('[voice] Python TTS failed; falling back to Web Speech');
    }
    const fbHandle = speakWebSpeech(text, options);
    handle.cancel = fbHandle.cancel;
  };

  (async () => {
    let jwt: string | null = null;
    try {
      jwt = await options.getJwt?.() ?? null;
    } catch {
      jwt = null;
    }
    if (!jwt) {
      fallback(new Error('no JWT — falling back without contacting Cloud Run'));
      return;
    }

    if (controller.signal.aborted) return;

    try {
      const result = await synthesizePython(
        {
          text: clean,
          language: toPythonLanguage(options.language),
          gender: options.gender ?? 'female',
        },
        { jwt, signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const playHandle = playAudioBlob(result.audio, options.onEnd);
      handle.cancel = () => {
        playHandle.cancel();
        controller.abort();
      };
    } catch (err) {
      if (controller.signal.aborted) {
        // Caller already cancelled; don't fall through to Web Speech.
        return;
      }
      fallback(err);
    }
  })();

  return {
    cancel: () => handle.cancel(),
  };
}

// ── Re-exports for tests / advanced consumers ──────────────────────────────
// Voice 2 callers may want to introspect the mime-detection logic. Exporting
// here keeps `voice.ts` the single import target for the consumer surface.
export { mimeToExtension };
export type { DetectedLanguage, SynthesizeLanguage };
