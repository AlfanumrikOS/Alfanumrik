/**
 * Browser-native voice helpers — unit tests.
 *
 * src/lib/voice.ts wraps the Web Speech API (STT) + speechSynthesis (TTS).
 * We mock the global `window.speechSynthesis` and SpeechRecognition constructor
 * to verify:
 *   - feature detection returns the right shape
 *   - language mapping ('hi' | 'en' | 'hinglish') → BCP-47
 *   - speak() strips markdown and respects 500-char cap
 *   - speak() no-ops cleanly when speechSynthesis is unavailable
 *   - voice-list helpers handle absent speechSynthesis without throwing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { isVoiceSupported, getVoicesForLanguage, speak, startListening } from '@/lib/voice';

// ── helpers ────────────────────────────────────────────────────────────────

interface FakeUtterance {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice: SpeechSynthesisVoice | null;
  onend: (() => void) | null;
}

function installSpeechSynthesis(voices: Array<Partial<SpeechSynthesisVoice>> = []) {
  const utterancesSpoken: FakeUtterance[] = [];
  const cancel = vi.fn();
  const speakSpy = vi.fn((u: FakeUtterance) => {
    utterancesSpoken.push(u);
    // Synchronous onend so onEnd callbacks fire deterministically.
    setTimeout(() => u.onend?.(), 0);
  });
  const synthesis = {
    speak: speakSpy,
    cancel,
    getVoices: () => voices as SpeechSynthesisVoice[],
    addEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'speechSynthesis', {
    value: synthesis,
    configurable: true,
    writable: true,
  });
  // Provide a minimal SpeechSynthesisUtterance shim (jsdom may not have one).
  class MockUtterance {
    text: string;
    lang = '';
    rate = 1;
    pitch = 1;
    voice: SpeechSynthesisVoice | null = null;
    onend: (() => void) | null = null;
    constructor(t: string) {
      this.text = t;
    }
  }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: MockUtterance as unknown as typeof SpeechSynthesisUtterance,
    configurable: true,
    writable: true,
  });
  return { utterancesSpoken, speakSpy, cancel, synthesis };
}

afterEach(() => {
  // Remove globals so other test files aren't polluted.
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
  delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  vi.restoreAllMocks();
});

// ── isVoiceSupported ───────────────────────────────────────────────────────

describe('isVoiceSupported', () => {
  it('returns false/false when neither STT nor TTS is present', () => {
    expect(isVoiceSupported()).toEqual({ stt: false, tts: false });
  });

  it('detects TTS when speechSynthesis is present', () => {
    installSpeechSynthesis();
    expect(isVoiceSupported().tts).toBe(true);
  });

  it('detects STT via webkitSpeechRecognition prefix', () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = function () {};
    expect(isVoiceSupported().stt).toBe(true);
  });

  it('detects STT via standard SpeechRecognition', () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = function () {};
    expect(isVoiceSupported().stt).toBe(true);
  });
});

// ── getVoicesForLanguage ───────────────────────────────────────────────────

describe('getVoicesForLanguage', () => {
  it('returns [] when speechSynthesis is unavailable', () => {
    expect(getVoicesForLanguage('en')).toEqual([]);
  });

  it('filters voices by BCP-47 language prefix', () => {
    installSpeechSynthesis([
      { name: 'Aditi', lang: 'hi-IN' } as SpeechSynthesisVoice,
      { name: 'Lekha', lang: 'hi-IN' } as SpeechSynthesisVoice,
      { name: 'Samantha', lang: 'en-US' } as SpeechSynthesisVoice,
      { name: 'Karen', lang: 'en-AU' } as SpeechSynthesisVoice,
    ]);

    const hiVoices = getVoicesForLanguage('hi');
    expect(hiVoices).toHaveLength(2);
    expect(hiVoices.every(v => v.lang.startsWith('hi'))).toBe(true);

    const enVoices = getVoicesForLanguage('en');
    expect(enVoices).toHaveLength(2);

    // Unknown language defaults to en-IN per LANG_MAP fallback → en* matches.
    const unknown = getVoicesForLanguage('xx');
    expect(unknown.every(v => v.lang.startsWith('en'))).toBe(true);
  });
});

// ── speak ──────────────────────────────────────────────────────────────────

describe('speak', () => {
  it('no-ops when speechSynthesis is unavailable and still calls onEnd', () => {
    const onEnd = vi.fn();
    const handle = speak('Hello', { language: 'en', onEnd });
    expect(onEnd).toHaveBeenCalledTimes(1);
    // cancel() must not throw.
    expect(() => handle.cancel()).not.toThrow();
  });

  it('strips markdown and limits to 500 chars before speaking', () => {
    const { utterancesSpoken } = installSpeechSynthesis();
    speak('# Heading\n**bold** and `code`', { language: 'en' });
    expect(utterancesSpoken).toHaveLength(1);
    const text = utterancesSpoken[0].text;
    expect(text).not.toContain('#');
    expect(text).not.toContain('**');
    expect(text).not.toContain('`');
    expect(text).toContain('Heading');
    expect(text).toContain('bold');
    expect(text).toContain('code');
  });

  it('truncates text longer than 500 chars', () => {
    const { utterancesSpoken } = installSpeechSynthesis();
    const long = 'a'.repeat(1000);
    speak(long, { language: 'en' });
    expect(utterancesSpoken[0].text.length).toBeLessThanOrEqual(500);
  });

  it('skips speaking when text is empty after stripping', () => {
    const { speakSpy } = installSpeechSynthesis();
    const onEnd = vi.fn();
    speak('   ', { language: 'en', onEnd });
    expect(speakSpy).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('maps "hi" to BCP-47 hi-IN on the utterance lang', () => {
    const { utterancesSpoken } = installSpeechSynthesis();
    speak('नमस्ते', { language: 'hi' });
    expect(utterancesSpoken[0].lang).toBe('hi-IN');
  });

  it('maps "hinglish" to hi-IN (Hindi recognition handles mixed script)', () => {
    const { utterancesSpoken } = installSpeechSynthesis();
    speak('Hello yaar', { language: 'hinglish' });
    expect(utterancesSpoken[0].lang).toBe('hi-IN');
  });

  it('falls back to en-IN for unknown languages', () => {
    const { utterancesSpoken } = installSpeechSynthesis();
    speak('hello', { language: 'klingon' });
    expect(utterancesSpoken[0].lang).toBe('en-IN');
  });

  it('applies default rate 0.9 and pitch 1 when not specified', () => {
    const { utterancesSpoken } = installSpeechSynthesis();
    speak('hello', { language: 'en' });
    expect(utterancesSpoken[0].rate).toBe(0.9);
    expect(utterancesSpoken[0].pitch).toBe(1);
  });

  it('applies caller-provided rate and pitch', () => {
    const { utterancesSpoken } = installSpeechSynthesis();
    speak('hello', { language: 'en', rate: 1.2, pitch: 0.8 });
    expect(utterancesSpoken[0].rate).toBe(1.2);
    expect(utterancesSpoken[0].pitch).toBe(0.8);
  });

  it('cancels the current utterance before speaking a new one', () => {
    const { cancel } = installSpeechSynthesis();
    speak('hello', { language: 'en' });
    expect(cancel).toHaveBeenCalled();
  });

  it('returns a cancel handle that calls speechSynthesis.cancel', () => {
    const { cancel } = installSpeechSynthesis();
    const handle = speak('hello', { language: 'en' });
    cancel.mockClear();
    handle.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

// ── startListening ─────────────────────────────────────────────────────────

describe('startListening', () => {
  it('reports not_supported when SpeechRecognition is missing', () => {
    const onError = vi.fn();
    const onResult = vi.fn();
    const onEnd = vi.fn();
    const handle = startListening({
      language: 'en',
      onError,
      onResult,
      onEnd,
    });
    expect(onError).toHaveBeenCalledWith('not_supported');
    // stop() must be safe to call.
    expect(() => handle.stop()).not.toThrow();
    expect(onResult).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('starts recognition with the right BCP-47 language and returns stop handle', () => {
    const startSpy = vi.fn();
    const stopSpy = vi.fn();
    interface FakeRec {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
      onerror: ((e: { error: string }) => void) | null;
      onend: (() => void) | null;
      start: typeof startSpy;
      stop: typeof stopSpy;
    }
    const created: FakeRec[] = [];
    class FakeRecognition implements FakeRec {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: FakeRec['onresult'] = null;
      onerror: FakeRec['onerror'] = null;
      onend: FakeRec['onend'] = null;
      start = startSpy;
      stop = stopSpy;
      constructor() {
        created.push(this);
      }
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;

    const onResult = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();
    const handle = startListening({
      language: 'hi',
      onResult,
      onError,
      onEnd,
      continuous: true,
    });

    expect(created).toHaveLength(1);
    expect(created[0].lang).toBe('hi-IN');
    expect(created[0].interimResults).toBe(true);
    expect(created[0].continuous).toBe(true);
    expect(startSpy).toHaveBeenCalledTimes(1);

    // Simulate a final transcript.
    const fakeResults = Object.assign([{ isFinal: true, length: 1, 0: { transcript: 'hello world ', confidence: 1 } }], { length: 1 });
    created[0].onresult?.({ results: fakeResults as never } as never);
    expect(onResult).toHaveBeenCalledWith('hello world', true);

    // Simulate an interim transcript.
    const interim = Object.assign([{ isFinal: false, length: 1, 0: { transcript: 'partial ', confidence: 0.5 } }], { length: 1 });
    created[0].onresult?.({ results: interim as never } as never);
    expect(onResult).toHaveBeenLastCalledWith('partial', false);

    // Simulate error + end.
    created[0].onerror?.({ error: 'no-speech' } as never);
    expect(onError).toHaveBeenCalledWith('no-speech');
    created[0].onend?.();
    expect(onEnd).toHaveBeenCalled();

    handle.stop();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
