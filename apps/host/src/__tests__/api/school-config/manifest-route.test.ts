/**
 * REG-259d — dynamic installable manifest integrity.
 *
 * Production rewrites `/manifest.json` to this tenant-aware route. It must
 * stay aligned with the static development fallback and advertise the
 * network-only `/pwa-sw.js` installation path without adding offline claims.
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
    it('serves standalone display and portrait orientation for installed app windows', async () => {
      const { res, manifest } = await getManifest(headers);
      expect(res.status).toBe(200);
      expect(manifest.display).toBe('standalone');
      expect(manifest.orientation).toBe('portrait');
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
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('portrait');
    const icons = manifest.icons as Array<{ src: string }>;
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon.src.length).toBeGreaterThan(0);
  });
});
