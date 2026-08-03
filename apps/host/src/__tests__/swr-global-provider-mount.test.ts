import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P0-2 (2026-08-03) — global SWR provider mount pin.
 *
 * DEFAULT_CONFIG in packages/lib/src/swr.tsx (bounded error retries, 10s
 * dedupe, revalidateOnFocus off — tuned for Indian mobile networks) was only
 * applied by the hooks defined in that file. Every other useSWR call site
 * silently inherited SWR library defaults (unbounded error retries,
 * revalidateOnFocus: true, 2s dedupe). Fix: packages/lib/src/SWRProvider.tsx
 * mounts <SWRConfig value={DEFAULT_CONFIG}> as the outermost client provider
 * in the root layout.
 *
 * Static-source pins (house pattern — see pwa-view-integrity.test.ts REG-259:
 * importing layout.tsx would drag globals.css + the full provider tree into a
 * unit test) so the provider cannot be silently unmounted or demoted.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = path.resolve(HERE, '..', '..'); // apps/host/
const REPO_ROOT = path.resolve(HOST_ROOT, '..', '..');

const layoutSource = readFileSync(path.resolve(HOST_ROOT, 'src/app/layout.tsx'), 'utf8');
const providerSource = readFileSync(
  path.resolve(REPO_ROOT, 'packages/lib/src/SWRProvider.tsx'),
  'utf8',
);
const swrSource = readFileSync(path.resolve(REPO_ROOT, 'packages/lib/src/swr.tsx'), 'utf8');

describe('global SWR provider mount (P0-2)', () => {
  it('root layout imports SWRProvider from @alfanumrik/lib', () => {
    expect(layoutSource).toMatch(
      /import\s*\{\s*SWRProvider\s*\}\s*from\s*'@alfanumrik\/lib\/SWRProvider'/,
    );
  });

  it('root layout mounts <SWRProvider> (open + close) in the JSX tree', () => {
    expect(layoutSource).toContain('<SWRProvider>');
    expect(layoutSource).toContain('</SWRProvider>');
  });

  it('SWRProvider is the outermost client provider (wraps TenantConfigProvider)', () => {
    const open = layoutSource.indexOf('<SWRProvider>');
    const tenantOpen = layoutSource.indexOf('<TenantConfigProvider>');
    const tenantClose = layoutSource.indexOf('</TenantConfigProvider>');
    const close = layoutSource.indexOf('</SWRProvider>');
    expect(open).toBeGreaterThan(-1);
    expect(tenantOpen).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(tenantClose);
  });

  it('SWRProvider mounts DEFAULT_CONFIG via <SWRConfig value={DEFAULT_CONFIG}>', () => {
    expect(providerSource).toMatch(/^'use client';/m);
    expect(providerSource).toMatch(/import\s*\{\s*SWRConfig\s*\}\s*from\s*'swr'/);
    expect(providerSource).toMatch(/import\s*\{\s*DEFAULT_CONFIG\s*\}\s*from\s*'\.\/swr'/);
    expect(providerSource).toMatch(/<SWRConfig\s+value=\{DEFAULT_CONFIG\}>/);
  });

  it('DEFAULT_CONFIG stays exported from packages/lib/src/swr.tsx', () => {
    expect(swrSource).toMatch(/export const DEFAULT_CONFIG:\s*SWRConfiguration\s*=/);
  });
});

/**
 * PROPOSED REGRESSION CATALOG ROW (orchestrator assigns the REG id):
 *   REG-xxx: swr_global_provider_mount
 *     asserts  | app/layout.tsx mounts <SWRProvider> as the outermost client
 *              | provider and SWRProvider wires DEFAULT_CONFIG into <SWRConfig>,
 *              | so no useSWR call site regresses to SWR library defaults.
 *     location | apps/host/src/__tests__/swr-global-provider-mount.test.ts
 *     invariant| P10-adjacent (network economy on Indian 4G)
 */
