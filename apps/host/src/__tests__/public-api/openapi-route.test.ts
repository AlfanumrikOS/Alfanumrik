import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET } from '@/app/api/public/v1/openapi/route';

function repoPath(rel: string): string {
  const cwd = process.cwd();
  const repoRoot = cwd.endsWith(`${path.sep}apps${path.sep}host`) ? path.resolve(cwd, '..', '..') : cwd;
  return path.resolve(repoRoot, rel);
}

describe('GET /api/public/v1/openapi', () => {
  it('serves the canonical public API spec from the host runtime cwd', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const spec = (await res.json()) as {
      openapi?: string;
      paths?: Record<string, unknown>;
    };

    expect(spec.openapi).toBe('3.0.3');
    expect(Object.keys(spec.paths ?? {}).sort()).toEqual([
      '/api/public/v1/classes',
      '/api/public/v1/marketplace/listings',
      '/api/public/v1/openapi',
      '/api/public/v1/reports',
      '/api/public/v1/students',
    ]);
  });

  it('serves the canonical public API spec when Next runs with apps/host as cwd', async () => {
    const hostCwd = process.cwd();
    expect(hostCwd.endsWith(`${path.sep}apps${path.sep}host`)).toBe(true);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(hostCwd);

    try {
      expect(process.cwd()).toBe(hostCwd);
      const res = await GET();

      expect(res.status).toBe(200);
      const spec = (await res.json()) as { paths?: Record<string, unknown> };
      expect(spec.paths).toHaveProperty('/api/public/v1/openapi');
    } finally {
      cwd.mockRestore();
    }
  });

  it('documents every public v1 route file in the canonical spec', () => {
    const apiRoot = path.resolve(process.cwd(), 'src/app/api/public/v1');
    const specPath = path.resolve(process.cwd(), '../../docs/public-api/openapi.json');
    const spec = JSON.parse(readFileSync(specPath, 'utf-8')) as {
      paths?: Record<string, unknown>;
    };

    const routePaths = [
      'classes',
      'marketplace/listings',
      'openapi',
      'reports',
      'students',
    ]
      .map((route) => {
        expect(existsSync(path.join(apiRoot, route, 'route.ts'))).toBe(true);
        return `/api/public/v1/${route}`;
      })
      .sort();

    expect(Object.keys(spec.paths ?? {}).sort()).toEqual(routePaths);
  });
});
