/**
 * posthog-autocapture-config — pins the autocapture privacy posture (P13).
 *
 * When `NEXT_PUBLIC_POSTHOG_ENABLED === 'true'` and the key is set, the
 * PostHog browser SDK is initialized with autocapture ON. To keep the
 * autocaptured payload PII-free, the init options MUST include:
 *   - autocapture: true
 *   - mask_all_text: true
 *   - mask_all_element_attributes: true
 *
 * If a future patch flips `mask_all_text` to false (or removes it), this
 * test fails so the reviewer is forced to re-do a P13 audit. This is the
 * regression guard for the 2026-05-19 "enable autocapture" change.
 *
 * Strategy: mock posthog-js's `default.init`, drive `init()` in the
 * browser-shaped environment (vitest's JSDOM), and inspect the options
 * passed to the SDK.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// posthog-js is dynamically imported by init() — set up a fake module
// BEFORE the wrapper is imported so the dynamic import resolves to our spy.
const initSpy = vi.fn();
const captureSpy = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init: initSpy,
    capture: captureSpy,
    identify: vi.fn(),
    reset: vi.fn(),
  },
}));

describe('posthog/client.init — autocapture privacy posture (P13)', () => {
  const originalEnabled = process.env.NEXT_PUBLIC_POSTHOG_ENABLED;
  const originalKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  beforeEach(() => {
    initSpy.mockReset();
    captureSpy.mockReset();
    // Reset module state — init() caches the instance + promise globally.
    vi.resetModules();
    (process.env as Record<string, string>).NEXT_PUBLIC_POSTHOG_ENABLED = 'true';
    (process.env as Record<string, string>).NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
  });

  afterEach(() => {
    (process.env as Record<string, string>).NEXT_PUBLIC_POSTHOG_ENABLED =
      originalEnabled ?? '';
    (process.env as Record<string, string>).NEXT_PUBLIC_POSTHOG_KEY = originalKey ?? '';
    if (originalEnabled === undefined)
      delete (process.env as Record<string, string>).NEXT_PUBLIC_POSTHOG_ENABLED;
    if (originalKey === undefined)
      delete (process.env as Record<string, string>).NEXT_PUBLIC_POSTHOG_KEY;
  });

  it('passes autocapture: true to posthog.init', async () => {
    const { init } = await import('@alfanumrik/lib/posthog/client');
    await init();
    expect(initSpy).toHaveBeenCalledTimes(1);
    const [key, options] = initSpy.mock.calls[0]!;
    expect(key).toBe('phc_test_key');
    expect((options as { autocapture: boolean }).autocapture).toBe(true);
  });

  it('passes mask_all_text: true to posthog.init (P13)', async () => {
    const { init } = await import('@alfanumrik/lib/posthog/client');
    await init();
    const [, options] = initSpy.mock.calls[0]!;
    expect((options as { mask_all_text: boolean }).mask_all_text).toBe(true);
  });

  it('passes mask_all_element_attributes: true to posthog.init (P13)', async () => {
    const { init } = await import('@alfanumrik/lib/posthog/client');
    await init();
    const [, options] = initSpy.mock.calls[0]!;
    expect(
      (options as { mask_all_element_attributes: boolean })
        .mask_all_element_attributes,
    ).toBe(true);
  });

  it('keeps disable_session_recording: true (recordings deferred)', async () => {
    const { init } = await import('@alfanumrik/lib/posthog/client');
    await init();
    const [, options] = initSpy.mock.calls[0]!;
    expect(
      (options as { disable_session_recording: boolean })
        .disable_session_recording,
    ).toBe(true);
  });

  it('keeps person_profiles: identified_only (no anonymous person rows)', async () => {
    const { init } = await import('@alfanumrik/lib/posthog/client');
    await init();
    const [, options] = initSpy.mock.calls[0]!;
    expect((options as { person_profiles: string }).person_profiles).toBe(
      'identified_only',
    );
  });

  it('does not call posthog.init at all when NEXT_PUBLIC_POSTHOG_ENABLED is not "true"', async () => {
    (process.env as Record<string, string>).NEXT_PUBLIC_POSTHOG_ENABLED = 'false';
    const { init } = await import('@alfanumrik/lib/posthog/client');
    await init();
    expect(initSpy).not.toHaveBeenCalled();
  });
});
