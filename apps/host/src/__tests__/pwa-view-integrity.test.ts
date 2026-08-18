import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REG-259 — mobile view integrity pins.
 *
 * Incident (reported 2026-07-16, root cause pre-2026-07-11 legacy v3 service
 * worker): installed PWAs rendered stale/broken "desktop-looking" views.
 * Runbook: docs/runbooks/pwa-stale-service-worker-recovery.md.
 *
 * These structural pins guard the two static inputs that decide how the app
 * renders on a phone:
 *  1. public/manifest.json — kept metadata-only (see below).
 *  2. The root layout's `viewport` export — `width: 'device-width'` +
 *     `initialScale: 1` (losing it reproduces the exact "desktop-looking
 *     page on mobile" symptom from the incident WITHOUT any service worker
 *     involved). This is the pin that actually addresses the incident symptom.
 *
 * INVERTED 2026-08-09 (PWA integrity fix). The manifest block previously
 * pinned `display: standalone` + `orientation: portrait` + `start_url: '/'`
 * because "losing either degrades every future install to a browser-tab view".
 * That premise was false: nothing in the app registers a service worker
 * (apps/host/public/sw.js is a retirement tombstone with no fetch handler that
 * unregisters itself), so there are no future installs, and an app-window
 * display mode with no offline capability is a chrome-less dead end the first
 * time a student's connection drops. The manifest is now metadata-only and
 * these pins hold it that way until a real offline strategy ships.
 *
 * Also note this static file is NOT what production serves: the middleware
 * rewrites /manifest.json to /api/school-config/manifest. The served route is
 * pinned separately by REG-259d
 * (src/__tests__/api/school-config/manifest-route.test.ts) — the two must stay
 * in sync, which is why both are asserted.
 *
 * NOTE: the layout pin is a static-source scan (house pattern — see the
 * daily-cron static-source contract canary, REG-118) rather than an import.
 * Importing apps/host/src/app/layout.tsx would drag globals.css, KaTeX CSS,
 * and the full provider tree (AuthProvider, SchoolProvider, ...) into a unit
 * test, which is exactly the heavy-mocking trap this pin avoids.
 */

const manifestPath = path.resolve(process.cwd(), 'public/manifest.json');
const layoutPath = path.resolve(process.cwd(), 'src/app/layout.tsx');

describe('PWA view integrity (REG-259)', () => {
  describe('public/manifest.json', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;

    it('declares display: browser — the app must not advertise an app-window mode it cannot back with a service worker', () => {
      expect(manifest.display).toBe('browser');
    });

    it('carries no install-only fields (orientation, screenshots) for an install that cannot happen', () => {
      expect(manifest.orientation).toBeUndefined();
      expect(manifest.screenshots).toBeUndefined();
    });

    it('opens a returning user on /dashboard rather than the marketing home, and keeps scope at /', () => {
      expect(manifest.start_url).toBe('/dashboard');
      expect(manifest.scope).toBe('/');
    });

    it("pins id to '/' so changing start_url does not re-identify the app for existing home-screen shortcuts", () => {
      expect(manifest.id).toBe('/');
    });
  });

  describe('root layout viewport export (static-source pin)', () => {
    const layoutSource = readFileSync(layoutPath, 'utf8');

    it('exports a viewport with device-width and initialScale 1', () => {
      expect(layoutSource).toMatch(/export const viewport:\s*Viewport\s*=\s*\{/);
      expect(layoutSource).toMatch(/width:\s*'device-width'/);
      expect(layoutSource).toMatch(/initialScale:\s*1\b/);
    });

    it('links /manifest.json from metadata so installs pick up the pinned manifest', () => {
      expect(layoutSource).toMatch(/manifest:\s*'\/manifest\.json'/);
    });
  });
});
