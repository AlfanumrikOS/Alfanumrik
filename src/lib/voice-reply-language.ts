// src/lib/voice-reply-language.ts
//
// Voice 3 (Adaptive language end-to-end) — pure helper.
//
// Background:
//   Voice 1a (STT, Whisper on Cloud Run) returns a `detected_language` on every
//   Python-routed transcription: 'en' | 'hi' | 'hinglish' | 'unknown'.
//   Voice 1b (TTS, Azure neural on Cloud Run) speaks in a `SynthesizeLanguage`:
//   'en' | 'hi' | 'hinglish' — note there is NO 'unknown' synthesize voice.
//
//   Voice 3 closes the loop: when a student SPEAKS in a language, Foxy's spoken
//   reply should match the language they actually used, independent of the
//   explicit LanguagePicker UI preference. `foxy/page.tsx` keeps a `voiceLangRef`
//   (separate from the `language` UI state) precisely so the spoken reply can be
//   adapted transiently without flipping the whole UI.
//
// This helper is the single decision point: given the STT-detected language and
// the language currently in effect for the spoken reply, decide which language
// the next TTS reply should use.
//
// Rules (P12-adjacent — we never feed an invalid language to the TTS endpoint):
//   1. If `detected` is a concrete, synthesizable language ('en' | 'hi' |
//      'hinglish') → adopt it.
//   2. If `detected` is 'unknown', empty, or anything unrecognised → keep the
//      current language unchanged (do NOT pass 'unknown' downstream; the Azure
//      TTS catalog has no 'unknown' voice and would 400).
//
// Pure + dependency-free so it is trivially unit-testable (REG-107) and carries
// no React / DOM coupling.

/** The set of languages the Azure TTS catalog can actually synthesize. */
export const SYNTHESIZABLE_VOICE_LANGUAGES = ['en', 'hi', 'hinglish'] as const;

export type SynthesizableVoiceLanguage = (typeof SYNTHESIZABLE_VOICE_LANGUAGES)[number];

/**
 * Narrowing type guard: is `lang` one of the languages the TTS endpoint can
 * actually speak? Rejects 'unknown', '', and any unexpected string.
 */
export function isSynthesizableVoiceLanguage(lang: string): lang is SynthesizableVoiceLanguage {
  return (SYNTHESIZABLE_VOICE_LANGUAGES as readonly string[]).includes(lang);
}

/**
 * Voice 3 reply-language resolver.
 *
 * @param detected  The STT-detected language from the Python transcribe call
 *                  ('en' | 'hi' | 'hinglish' | 'unknown' | anything).
 * @param current   The language currently driving the spoken reply
 *                  (typically `voiceLangRef.current`).
 * @returns         The language the next TTS reply should use. Adopts `detected`
 *                  only when it is synthesizable; otherwise returns `current`
 *                  unchanged so we never forward 'unknown' to the TTS endpoint.
 */
export function adoptVoiceReplyLanguage(detected: string, current: string): string {
  return isSynthesizableVoiceLanguage(detected) ? detected : current;
}
