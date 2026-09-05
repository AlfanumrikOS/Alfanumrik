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
 * These structural pins guard the installable manifest, the network-only
 * worker, and the mobile viewport. `/sw.js` remains a retirement tombstone;
 * the install worker is `/pwa-sw.js` and must not cache content.
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
const registrationPath = path.resolve(process.cwd(), '../../packages/lib/src/RegisterSW.tsx');

describe('PWA view integrity (REG-259)', () => {
  describe('public/manifest.json', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;

    it('declares standalone display and portrait orientation for installed app windows', () => {
      expect(manifest.display).toBe('standalone');
      expect(manifest.orientation).toBe('portrait');
    });

    it('opens a returning user on /dashboard rather than the marketing home, and keeps scope at /', () => {
      expect(manifest.start_url).toBe('/dashboard');
      expect(manifest.scope).toBe('/');
    });

    it("pins id to '/' so changing start_url does not re-identify the app for existing home-screen shortcuts", () => {
      expect(manifest.id).toBe('/');
    });
  });

  describe('PWA worker and root layout (static-source pins)', () => {
    const layoutSource = readFileSync(layoutPath, 'utf8');
    const workerSource = readFileSync(path.resolve(process.cwd(), 'public/pwa-sw.js'), 'utf8');
    const registrationSource = readFileSync(registrationPath, 'utf8');

    it('exports a viewport with device-width and initialScale 1', () => {
      expect(layoutSource).toMatch(/export const viewport:\s*Viewport\s*=\s*\{/);
      expect(layoutSource).toMatch(/width:\s*'device-width'/);
      expect(layoutSource).toMatch(/initialScale:\s*1\b/);
    });

    it('links /manifest.json, opts into iOS installation, and registers the dedicated worker', () => {
      expect(layoutSource).toMatch(/manifest:\s*'\/manifest\.json'/);
      expect(layoutSource).toMatch(/capable:\s*true/);
      expect(layoutSource).toMatch(/ServiceWorkerCleanup/);
      expect(registrationSource).toMatch(/NEXT_PUBLIC_PWA_ENABLED !== 'false'/);
      expect(registrationSource).toMatch(/!INSTALLABLE_PWA_ENABLED\) \{\s*void unregisterInstallablePwaWorker\(\);/);
      // Whitespace-tolerant between `serviceWorker` and `.register(`: the call is
      // formatted across lines (`void navigator.serviceWorker\n  .register(...)`),
      // and a contiguous pin breaks on a pure line-wrap while the registration is
      // still correct. Same `\s*` treatment the assertion above already uses.
      expect(registrationSource).toMatch(
        /serviceWorker\s*\.register\(INSTALLABLE_WORKER_PATH, \{ scope: '\/' \}\)/,
      );
    });

    it('uses a network-only install worker with no CacheStorage access', () => {
      expect(workerSource).toMatch(/addEventListener\('fetch'/);
      expect(workerSource).toMatch(/respondWith\(fetch\(event\.request\)\)/);
      expect(workerSource).not.toMatch(/caches\./);
    });
  });
});
