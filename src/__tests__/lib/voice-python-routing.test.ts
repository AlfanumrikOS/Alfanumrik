/**
 * voice-python-routing.test.ts — Voice 2 wrapper tests around src/lib/voice.ts.
 *
 * Asserts the flag-gated branch + fallback safety net. The existing
 * voice.test.ts file pins the Web Speech path; this file pins the new
 * Python routing + automatic Web-Speech fallback behaviour.
 *
 * The pinned contracts here are also the REG-77 enforcement points:
 *   - falls_back_to_web_speech_when_python_throws
 *   - falls_back_to_web_speech_when_flag_off
 *   - falls_back_to_web_speech_when_jwt_missing
 *   - speak_falls_back_to_web_speech_when_python_throws
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { speak, startListening } from '@/lib/voice';
import { PythonVoiceError } from '@/lib/voice-python-client';

// Mock the Python client surface so we can drive success / failure paths
// without booting fetch. The voice.ts wrapper imports these by name.
vi.mock('@/lib/voice-python-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/voice-python-client')>(
    '@/lib/voice-python-client',
  );
  return {
    ...actual,
    transcribePython: vi.fn(),
    synthesizePython: vi.fn(),
  };
});

import { synthesizePython, transcribePython } from '@/lib/voice-python-client';

const mockedTranscribe = vi.mocked(transcribePython);
const mockedSynthesize = vi.mocked(synthesizePython);

// ── Browser API shims ──────────────────────────────────────────────────────

interface FakeRecorder {
  state: string;
  start: () => void;
  stop: () => void;
  mimeType: string;
  addEventListener: (event: string, handler: (...args: unknown[]) => void) => void;
  dispatch: (event: string, payload?: unknown) => void;
}

const recorderHandlers: Map<FakeRecorder, Record<string, ((...args: unknown[]) => void)[]>> = new Map();
let lastRecorder: FakeRecorder | null = null;

function installMediaRecorder() {
  class FakeMediaRecorderImpl implements FakeRecorder {
    state = 'inactive';
    mimeType = 'audio/webm';
    constructor() {
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      recorderHandlers.set(this, handlers);
      lastRecorder = this;
    }
    static isTypeSupported(_: string) {
      return true;
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      // Fire dataavailable + stop synchronously to keep tests sequential.
      this.dispatch('dataavailable', { data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }) });
      this.dispatch('stop');
    }
    addEventListener(event: string, handler: (...args: unknown[]) => void) {
      const h = recorderHandlers.get(this)!;
      h[event] = h[event] ? [...h[event], handler] : [handler];
    }
    dispatch(event: string, payload?: unknown) {
      const h = recorderHandlers.get(this)?.[event] ?? [];
      h.forEach((fn) => fn(payload));
    }
  }
  // jsdom doesn't ship MediaRecorder.
  Object.defineProperty(window, 'MediaRecorder', {
    value: FakeMediaRecorderImpl,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
      }),
    },
    configurable: true,
    writable: true,
  });
}

function installSpeechRecognition() {
  const starts: Array<{ instance: unknown; lang: string }> = [];
  class FakeSpeechRecognition {
    lang = '';
    interimResults = false;
    continuous = false;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      starts.push({ instance: this, lang: this.lang });
      // No-op — tests drive the lifecycle manually if needed.
    }
    stop() {
      this.onend?.();
    }
  }
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeSpeechRecognition;
  return starts;
}

function installSpeechSynthesis() {
  const utterances: Array<{ text: string; lang: string; onend: (() => void) | null }> = [];
  const cancel = vi.fn();
  const speakSpy = vi.fn((u: { text: string; lang: string; onend: (() => void) | null }) => {
    utterances.push(u);
    setTimeout(() => u.onend?.(), 0);
  });
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
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      speak: speakSpy,
      cancel,
      getVoices: () => [],
      addEventListener: vi.fn(),
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: MockUtterance,
    configurable: true,
    writable: true,
  });
  return { utterances, speakSpy, cancel };
}

beforeEach(() => {
  installMediaRecorder();
  installSpeechRecognition();
  installSpeechSynthesis();
  recorderHandlers.clear();
  lastRecorder = null;
  mockedTranscribe.mockReset();
  mockedSynthesize.mockReset();
  // Audio constructor used by playAudioBlob — stub so .play() resolves and
  // the 'ended' handler fires after a tick.
  Object.defineProperty(window, 'Audio', {
    value: class FakeAudio {
      addEventListener(ev: string, handler: () => void) {
        if (ev === 'ended') setTimeout(handler, 0);
      }
      play() {
        return Promise.resolve();
      }
      pause() {}
    },
    configurable: true,
    writable: true,
  });
  // URL.createObjectURL doesn't exist in jsdom.
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test', configurable: true, writable: true });
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true, writable: true });
  }
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
  delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  delete (window as unknown as Record<string, unknown>).MediaRecorder;
  delete (window as unknown as Record<string, unknown>).Audio;
  vi.restoreAllMocks();
});

// ── startListening: Python success → returns transcript ────────────────────

describe('startListening — Python path', () => {
  it('returns the python transcript when the flag is on and the call succeeds', async () => {
    mockedTranscribe.mockResolvedValue({
      transcript: 'hello from python',
      detected_language: 'en',
      duration_seconds: 1,
      audio_format: 'webm',
      cost_inr: 0.01,
      request_id: 'r-1',
    });

    const onResult = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();
    const onPythonResult = vi.fn();

    startListening({
      language: 'en',
      pythonEnabled: true,
      getJwt: async () => 'jwt-abc',
      onResult,
      onError,
      onEnd,
      onPythonResult,
    });

    // Drive the MediaRecorder lifecycle: trigger stop on the recorder so the
    // record promise resolves with the captured blob.
    await new Promise((r) => setTimeout(r, 0));
    expect(lastRecorder).not.toBeNull();
    lastRecorder!.stop();
    await new Promise((r) => setTimeout(r, 0));

    // Now the transcribePython promise resolves on next microtask.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockedTranscribe).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith('hello from python', true);
    expect(onPythonResult).toHaveBeenCalledWith('en');
    expect(onEnd).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('falls_back_to_web_speech_when_python_throws — REG-77', async () => {
    mockedTranscribe.mockRejectedValue(
      new PythonVoiceError({ status: 503, code: 'CONFIG_ERROR', message: 'azure key missing' }),
    );
    const webSpeechStarts = installSpeechRecognition();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onResult = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();

    startListening({
      language: 'en',
      pythonEnabled: true,
      getJwt: async () => 'jwt-abc',
      onResult,
      onError,
      onEnd,
    });

    // Drive the MediaRecorder stop so the Python path attempts the fetch.
    await new Promise((r) => setTimeout(r, 0));
    expect(lastRecorder).not.toBeNull();
    lastRecorder!.stop();
    // Let transcribePython's rejected promise propagate + fallback fire.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Fallback: SpeechRecognition started. The Web Speech path runs.
    expect(webSpeechStarts.length).toBeGreaterThan(0);
    // We logged a warning — never the transcript or audio.
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('Python STT failed');
    expect(msg).not.toContain('jwt-abc');
  });

  it('falls_back_to_web_speech_when_flag_off — REG-77', () => {
    // pythonEnabled = false → no MediaRecorder, no fetch; SpeechRecognition runs.
    const webSpeechStarts = installSpeechRecognition();

    startListening({
      language: 'en',
      pythonEnabled: false,
      getJwt: async () => 'jwt-abc',
      onResult: vi.fn(),
      onError: vi.fn(),
      onEnd: vi.fn(),
    });

    expect(webSpeechStarts.length).toBe(1);
    expect(mockedTranscribe).not.toHaveBeenCalled();
  });

  it('falls_back_to_web_speech_when_jwt_missing', async () => {
    const webSpeechStarts = installSpeechRecognition();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    startListening({
      language: 'en',
      pythonEnabled: true,
      getJwt: async () => null, // no JWT → straight to fallback
      onResult: vi.fn(),
      onError: vi.fn(),
      onEnd: vi.fn(),
    });

    // Allow the async JWT lookup to settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockedTranscribe).not.toHaveBeenCalled();
    expect(webSpeechStarts.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
  });

  it('skips Python entirely when getJwt is omitted (legacy callers)', () => {
    const webSpeechStarts = installSpeechRecognition();

    startListening({
      language: 'en',
      pythonEnabled: true, // flag on but no getJwt → legacy path
      onResult: vi.fn(),
      onError: vi.fn(),
      onEnd: vi.fn(),
    });

    expect(mockedTranscribe).not.toHaveBeenCalled();
    expect(webSpeechStarts.length).toBe(1);
  });
});

// ── speak (TTS) — Python path + fallback ───────────────────────────────────

describe('speak — Python path', () => {
  it('plays the python audio blob when flag is on and call succeeds', async () => {
    const fakeBlob = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], { type: 'audio/mpeg' });
    mockedSynthesize.mockResolvedValue({
      audio: fakeBlob,
      voiceUsed: 'en-IN-NeerjaNeural',
      costInr: 0.01,
      requestId: 'tts-1',
    });

    const onEnd = vi.fn();
    speak('Hello world', {
      language: 'en',
      pythonEnabled: true,
      getJwt: async () => 'jwt',
      onEnd,
    });

    // Let synth resolve + playAudioBlob fire onEnd.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockedSynthesize).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalled();
  });

  it('speak_falls_back_to_web_speech_when_python_throws — REG-77', async () => {
    mockedSynthesize.mockRejectedValue(
      new PythonVoiceError({ status: 503, code: 'CONFIG_ERROR', message: 'azure unreachable' }),
    );
    const { speakSpy } = installSpeechSynthesis();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    speak('Hello world', {
      language: 'en',
      pythonEnabled: true,
      getJwt: async () => 'jwt',
      onEnd: vi.fn(),
    });

    // Let synth reject + fallback fire.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(speakSpy).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('Python TTS failed');
  });

  it('falls back to Web Speech immediately when JWT is missing', async () => {
    const { speakSpy } = installSpeechSynthesis();

    speak('hi', {
      language: 'en',
      pythonEnabled: true,
      getJwt: async () => null,
      onEnd: vi.fn(),
    });

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockedSynthesize).not.toHaveBeenCalled();
    expect(speakSpy).toHaveBeenCalled();
  });

  it('runs Web Speech directly when flag is off (no fetch, no fallback log)', () => {
    const { speakSpy } = installSpeechSynthesis();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    speak('hi', {
      language: 'en',
      pythonEnabled: false,
      getJwt: async () => 'jwt',
      onEnd: vi.fn(),
    });

    expect(mockedSynthesize).not.toHaveBeenCalled();
    expect(speakSpy).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
