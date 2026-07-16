import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REG-259 — PWA mobile view integrity pins.
 *
 * Incident (reported 2026-07-16, root cause pre-2026-07-11 legacy v3 service
 * worker): installed PWAs rendered stale/broken "desktop-looking" views.
 * Runbook: docs/runbooks/pwa-stale-service-worker-recovery.md.
 *
 * These structural pins guard the two static inputs that decide how the
 * installed PWA renders on a phone:
 *  1. public/manifest.json — `display: standalone` + `orientation: portrait`
 *     (losing either degrades every future install to a browser-tab view).
 *  2. The root layout's `viewport` export — `width: 'device-width'` +
 *     `initialScale: 1` (losing it reproduces the exact "desktop-looking
 *     page on mobile" symptom from the incident WITHOUT any service worker
 *     involved).
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

    it('declares display: standalone so installs render app-like, not as a browser tab', () => {
      expect(manifest.display).toBe('standalone');
    });

    it('declares orientation: portrait for the phone-first student experience', () => {
      expect(manifest.orientation).toBe('portrait');
    });

    it('keeps start_url and scope at the root so the installed app opens the live shell', () => {
      expect(manifest.start_url).toBe('/');
      expect(manifest.scope).toBe('/');
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
