/**
 * posthog-autocapture-config — pins the autocapture privacy posture (P13).
 *
 * NEW CONTRACT (2026-07, EU analytics turn-on — branch
 * feat/instrument-b2c-funnel-analytics): autocapture is OFF everywhere. This
 * is a STRONGER P13 posture than the previous "autocapture ON + mask_all_text"
 * arrangement: for a minors' product (grades 6-12) we ship ZERO implicit
 * DOM/click capture — every event is an explicit, structured `track()` call we
 * control end-to-end. Because nothing is autocaptured, the old
 * `mask_all_text` / `mask_all_element_attributes` guards are moot and have been
 * removed; the honest new pin is `autocapture: false` plus the EU region wiring.
 *
 * When `NEXT_PUBLIC_POSTHOG_ENABLED === 'true'` and the key is set, the
 * PostHog browser SDK (packages/lib/src/posthog/client.ts) is initialized with:
 *   - autocapture: false                 — zero implicit DOM capture (P13)
 *   - api_host: '/ingest'                — same-origin reverse proxy → EU project
 *   - ui_host: 'https://eu.posthog.com'  — EU project 159341 deep-links resolve
 *   - person_profiles: 'identified_only' — no anonymous person rows
 *   - disable_session_recording: true    — recordings deferred
 *
 * If a future patch flips `autocapture` back to true (or repoints the host off
 * the EU proxy) this test fails so the reviewer is forced to re-do a P13 /
 * region audit.
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

  it('passes autocapture: false to posthog.init (P13 — zero implicit DOM capture for minors)', async () => {
    const { init } = await import('@alfanumrik/lib/posthog/client');
    await init();
    expect(initSpy).toHaveBeenCalledTimes(1);
    const [key, options] = initSpy.mock.calls[0]!;
    expect(key).toBe('phc_test_key');
    expect((options as { autocapture: boolean }).autocapture).toBe(false);
  });

  it('does NOT set mask_all_text (autocapture is off, so DOM masking is moot — the stronger posture is no capture at all)', async () => {
    const { init } = await import('@alfanumrik/lib/posthog/client');
    await init();
    const [, options] = initSpy.mock.calls[0]!;
    // The old contract guarded autocaptured text with mask_all_text. With
    // autocapture OFF there is nothing to mask, so the flag is intentionally
    // absent — asserting its absence keeps this pin honest rather than dropping
    // it silently.
    expect((options as Record<string, unknown>).mask_all_text).toBeUndefined();
    expect((options as { autocapture: boolean }).autocapture).toBe(false);
  });

  it('routes through the same-origin EU proxy: api_host === "/ingest" (US→EU host change)', async () => {
    const { init } = await import('@alfanumrik/lib/posthog/client');
    await init();
    const [, options] = initSpy.mock.calls[0]!;
    expect((options as { api_host: string }).api_host).toBe('/ingest');
  });

  it('points ui_host at the EU project (deep-links resolve): ui_host === "https://eu.posthog.com"', async () => {
    const { init } = await import('@alfanumrik/lib/posthog/client');
    await init();
    const [, options] = initSpy.mock.calls[0]!;
    expect((options as { ui_host: string }).ui_host).toBe('https://eu.posthog.com');
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
