/**
 * voice.ts — Browser-native voice input/output for Foxy AI Tutor
 *
 * Uses Web Speech API exclusively. Zero external dependencies, zero API cost.
 * All text still flows through the existing /api/foxy endpoint.
 *
 * Feature detection: isVoiceSupported() before any call.
 */

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
   SPEECH-TO-TEXT  (Voice Input)
   ══════════════════════════════════════════════════════════════ */

export interface ListenOptions {
  /** 'hi' | 'en' | 'hinglish' — mapped to BCP-47 for the browser */
  language: string;
  /** Called on every interim/final transcript update.
   *  isFinal=false → interim (grey preview); isFinal=true → committed text */
  onResult: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
  onEnd: () => void;
  /** Default false — stop after first utterance (tutoring UX) */
  continuous?: boolean;
}

export function startListening(options: ListenOptions): { stop: () => void } {
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

/* ══════════════════════════════════════════════════════════════
   TEXT-TO-SPEECH  (Voice Output)
   ══════════════════════════════════════════════════════════════ */

export interface SpeakOptions {
  language: string;
  /** 0.8–1.2 for natural speed. Default 0.9 */
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
}

/**
 * Speak text aloud using the browser's speechSynthesis.
 * Strips markdown, limits to 500 chars to avoid 2-minute speeches.
 * Returns { cancel } to stop playback early.
 */
export function speak(text: string, options: SpeakOptions): { cancel: () => void } {
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
