import { describe, it, expect } from 'vitest';
import {
  adoptVoiceReplyLanguage,
  isSynthesizableVoiceLanguage,
  SYNTHESIZABLE_VOICE_LANGUAGES,
} from '@alfanumrik/lib/voice-reply-language';

/**
 * REG-107 — Voice 3 adaptive-language reply resolver.
 *
 * Pins the contract that:
 *   (1) the STT-detected language drives Foxy's spoken reply when it is one of
 *       the synthesizable languages ('en' | 'hi' | 'hinglish'), and
 *   (2) the 'unknown' sentinel (and any unexpected value) is NEVER forwarded to
 *       the Azure TTS endpoint — the current language is kept instead.
 *
 * A regression here either (a) lets 'unknown' reach the TTS synthesize call
 * (HTTP 400, broken audio) or (b) stops Voice 3 from adapting at all.
 */
describe('voice-reply-language (Voice 3, REG-107)', () => {
  describe('isSynthesizableVoiceLanguage', () => {
    it('accepts exactly the Azure TTS catalog languages', () => {
      expect(SYNTHESIZABLE_VOICE_LANGUAGES).toEqual(['en', 'hi', 'hinglish']);
      for (const lang of SYNTHESIZABLE_VOICE_LANGUAGES) {
        expect(isSynthesizableVoiceLanguage(lang)).toBe(true);
      }
    });

    it("rejects 'unknown' and unexpected values", () => {
      expect(isSynthesizableVoiceLanguage('unknown')).toBe(false);
      expect(isSynthesizableVoiceLanguage('')).toBe(false);
      expect(isSynthesizableVoiceLanguage('fr')).toBe(false);
      expect(isSynthesizableVoiceLanguage('EN')).toBe(false); // case-sensitive on purpose
    });
  });

  describe('adoptVoiceReplyLanguage', () => {
    it('adopts a concrete detected language regardless of current', () => {
      expect(adoptVoiceReplyLanguage('hi', 'en')).toBe('hi');
      expect(adoptVoiceReplyLanguage('en', 'hi')).toBe('en');
      expect(adoptVoiceReplyLanguage('hinglish', 'en')).toBe('hinglish');
    });

    it("keeps current when detected is 'unknown'", () => {
      expect(adoptVoiceReplyLanguage('unknown', 'hi')).toBe('hi');
      expect(adoptVoiceReplyLanguage('unknown', 'en')).toBe('en');
    });

    it('keeps current for empty / garbage detected values', () => {
      expect(adoptVoiceReplyLanguage('', 'en')).toBe('en');
      expect(adoptVoiceReplyLanguage('de', 'hinglish')).toBe('hinglish');
    });

    it('is idempotent when detected equals current', () => {
      expect(adoptVoiceReplyLanguage('hi', 'hi')).toBe('hi');
    });
  });
});
