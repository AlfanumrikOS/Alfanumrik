/**
 * REG-259d — tenant dynamic-manifest integrity pin.
 *
 * Production rewrites `/manifest.json` to this dynamic route
 * (`apps/host/src/proxy.ts`, `pathname === '/manifest.json'` rewrite), so the
 * static `public/manifest.json` pinned by REG-259c is NOT what clients
 * actually fetch — this route is. That rewrite is the reason this pin exists
 * at all, and it still holds.
 *
 * INVERTED 2026-08-09 (PWA integrity fix). This suite previously pinned
 * `display: standalone` + `orientation: portrait` on the premise that losing
 * them "degrades every future install to a browser-tab view". That premise was
 * false: no service worker is registered anywhere in the app
 * (`apps/host/public/sw.js` is a retirement tombstone with no fetch handler
 * that unregisters itself, and `ServiceWorkerCleanup` removes legacy
 * registrations), so there are no future installs to degrade. The manifest was
 * advertising an app-like install the product cannot deliver, and an app-window
 * display mode with zero offline capability is a chrome-less dead end — no
 * reload, no back — the first time a student's connection drops.
 *
 * So the pin is now the inverse: the manifest must stay metadata-only until a
 * real offline strategy ships. If someone restores `display: standalone`,
 * `orientation`, or `screenshots` without a service worker, these tests fail.
 * Both branches are covered because the default (B2C) and white-label school
 * manifests are built as different objects.
 *
 * The route reads tenant config exclusively from the `x-school-*` request
 * headers injected by the proxy, and imports nothing heavier than
 * `next/server`, so we invoke the real GET handler directly with crafted
 * headers — no mocks, no static-source scan needed.
 *
 * Runbook: docs/runbooks/pwa-stale-service-worker-recovery.md (section 8)
 * Catalog: .claude/regression-catalog.md → REG-259 (sub-row REG-259d)
 */

import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/school-config/manifest/route';

const TENANT_HEADERS: Record<string, string> = {
  'x-school-slug': 'dps-rkpuram',
  'x-school-name': encodeURIComponent('DPS RK Puram'),
  'x-school-primary-color': '#123456',
  'x-school-logo': 'https://cdn.example.com/schools/dps-rkpuram/logo.png',
};

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/school-config/manifest', { headers });
}

async function getManifest(headers: Record<string, string> = {}) {
  const res = await GET(makeRequest(headers));
  const manifest = (await res.json()) as Record<string, unknown>;
  return { res, manifest };
}

describe('GET /api/school-config/manifest — dynamic PWA manifest (REG-259d)', () => {
  // The honesty invariants must hold on BOTH branches of the route: the
  // default (B2C) manifest and the tenant-branded (white-label school)
  // manifest are built as different objects, so a regression can hit one
  // without the other.
  describe.each([
    ['default (B2C, no tenant headers)', {}],
    ['white-label school tenant', TENANT_HEADERS],
  ])('%s', (_label, headers: Record<string, string>) => {
    it('serves display: browser — metadata-only, never an app-window mode while no service worker exists', async () => {
      const { res, manifest } = await getManifest(headers);
      expect(res.status).toBe(200);
      expect(manifest.display).toBe('browser');
    });

    it('advertises no install-only fields (orientation, screenshots) the app cannot deliver', async () => {
      const { manifest } = await getManifest(headers);
      expect(manifest.orientation).toBeUndefined();
      expect(manifest.screenshots).toBeUndefined();
    });

    it('opens a returning user on /dashboard, not the marketing home, and keeps scope at /', async () => {
      const { manifest } = await getManifest(headers);
      expect(manifest.start_url).toBe('/dashboard');
      expect(manifest.scope).toBe('/');
    });

    it("pins id to '/' so the start_url change does not re-identify the app for existing home-screen shortcuts", async () => {
      const { manifest } = await getManifest(headers);
      expect(manifest.id).toBe('/');
    });

    it('serves a non-empty icons array with non-empty srcs (an icon-less manifest is broken metadata)', async () => {
      const { manifest } = await getManifest(headers);
      const icons = manifest.icons as Array<{ src: string; sizes: string }>;
      expect(Array.isArray(icons)).toBe(true);
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(typeof icon.src).toBe('string');
        expect(icon.src.length).toBeGreaterThan(0);
      }
    });

    it('responds with the manifest JSON content type', async () => {
      const { res } = await getManifest(headers);
      expect(res.headers.get('content-type')).toMatch(/^application\/manifest\+json/);
    });
  });

  // Branch-proving assertions: confirm the tenant-header variant above really
  // exercised the school-branded code path (and the bare variant the default
  // path), so the shared pins are not passing on the same branch twice.
  it('default path serves Alfanumrik branding and the standard public/ icons', async () => {
    const { manifest } = await getManifest();
    expect(manifest.name).toBe('Alfanumrik');
    const icons = manifest.icons as Array<{ src: string }>;
    expect(icons.map((i) => i.src)).toContain('/icon-512x512.svg');
  });

  it('tenant path serves school branding (name, theme_color, logo icons) — proving the branded branch is what the shared pins covered', async () => {
    const { manifest } = await getManifest(TENANT_HEADERS);
    expect(manifest.name).toBe('DPS RK Puram Learning');
    expect(manifest.short_name).toBe('DPS RK Puram');
    expect(manifest.theme_color).toBe('#123456');
    const icons = manifest.icons as Array<{ src: string }>;
    expect(icons.every((i) => i.src === TENANT_HEADERS['x-school-logo'])).toBe(true);
  });

  it('tenant slug without a logo still yields non-empty default icons (never an icon-less manifest)', async () => {
    const { manifest } = await getManifest({
      'x-school-slug': 'no-logo-school',
      'x-school-name': encodeURIComponent('No Logo School'),
    });
    expect(manifest.display).toBe('browser');
    expect(manifest.orientation).toBeUndefined();
    const icons = manifest.icons as Array<{ src: string }>;
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon.src.length).toBeGreaterThan(0);
  });
});
