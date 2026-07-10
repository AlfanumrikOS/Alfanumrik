import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

const ACCESS_CATEGORIES = [
  'public',
  'auth',
  'student',
  'parent',
  'teacher',
  'school_admin',
  'super_admin',
  'internal_admin',
  'cron',
  'webhook',
  'public_api',
  'support',
  'oauth',
  'billing',
  'system',
] as const;

type AccessCategory = (typeof ACCESS_CATEGORIES)[number];

interface RouteAccessEntry {
  path: string;
  file: string;
  access: AccessCategory;
  owner: string;
  rationale: string;
  serviceRoleUse?: string;
}

function walkRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkRouteFiles(full));
    } else if (/^route\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function routePathFor(file: string): string {
  const apiRoot = repoPath('apps/host/src/app/api');
  const rel = relative(apiRoot, file).replace(/\\/g, '/');
  return `/api/${rel.replace(/\/route\.tsx?$/, '')}`;
}

function usesServiceRole(file: string): boolean {
  const source = readFileSync(file, 'utf8');
  return /@alfanumrik\/lib\/supabase-admin|\bsupabaseAdmin\b|\bgetSupabaseAdmin\s*\(/.test(source);
}

describe('API route access manifest (RCA-02)', () => {
  it('declares an access category for every API route handler', () => {
    expect(existsSync(repoPath('scripts/route-access-manifest.json'))).toBe(true);

    const manifest = JSON.parse(
      readFileSync(repoPath('scripts/route-access-manifest.json'), 'utf8'),
    ) as { routes: RouteAccessEntry[] };

    const routeFiles = walkRouteFiles(repoPath('apps/host/src/app/api')).sort();
    const expectedPaths = routeFiles.map(routePathFor).sort();
    const manifestPaths = manifest.routes.map((entry) => entry.path).sort();

    expect(manifestPaths).toEqual(expectedPaths);

    const byPath = new Map(manifest.routes.map((entry) => [entry.path, entry]));
    const validAccess = new Set<string>(ACCESS_CATEGORIES);

    for (const file of routeFiles) {
      const path = routePathFor(file);
      const entry = byPath.get(path);
      expect(entry, `${path} missing from route access manifest`).toBeDefined();
      expect(entry?.file).toBe(relative(repoPath('.'), file).replace(/\\/g, '/'));
      expect(validAccess.has(entry?.access ?? ''), `${path} has invalid access`).toBe(true);
      expect(entry?.owner).toMatch(/\S/);
      expect(entry?.rationale).toMatch(/\S/);

      if (usesServiceRole(file)) {
        expect(
          entry?.serviceRoleUse,
          `${path} uses the service-role/admin client and needs a manifest justification`,
        ).toMatch(/\S/);
      }
    }
  });
});
