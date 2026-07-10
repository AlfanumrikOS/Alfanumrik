import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

function source(rel: string): string {
  return readFileSync(repoPath(rel), 'utf8');
}

describe('incident ID propagation contract (RCA-23)', () => {
  it('proxy preserves one x-request-id across downstream request headers and response headers', () => {
    const proxy = source('apps/host/src/proxy.ts');

    expect(proxy).toMatch(
      /const requestId = request\.headers\.get\('x-request-id'\) \?\? crypto\.randomUUID\(\);/,
    );
    expect(proxy).toMatch(/requestHeaders\.set\('x-request-id', requestId\);/);
    expect(proxy).toMatch(
      /function addSecurityHeaders\([\s\S]*requestId = request\.headers\.get\('x-request-id'\) \?\? crypto\.randomUUID\(\)[\s\S]*\): NextResponse/,
    );
    expect(proxy).toMatch(/response\.headers\.set\('X-Request-Id', requestId\);/);
    expect(proxy).toMatch(/addSecurityHeaders\(response, request, requestId\)/);
  });

  it('documents the cross-surface incident spine from host route to Edge logs and operator lookup', () => {
    expect(existsSync(repoPath('scripts/incident-id-spine.json'))).toBe(true);

    const manifest = JSON.parse(source('scripts/incident-id-spine.json')) as {
      surfaces: Array<{
        id: string;
        kind: 'host_proxy' | 'host_route' | 'edge_function' | 'edge_shared' | 'ops_console';
        file: string;
        propagates: string;
        evidence: string[];
      }>;
    };

    const ids = new Set(manifest.surfaces.map((surface) => surface.id));
    for (const required of [
      'host-proxy-request-id',
      'board-score-host-route',
      'board-score-edge-function',
      'edge-audit-log-shared',
      'ops-event-related-lookup',
    ]) {
      expect(ids.has(required), `${required} missing from incident ID spine manifest`).toBe(true);
    }

    for (const surface of manifest.surfaces) {
      expect(surface.file).toMatch(/\S/);
      expect(surface.propagates).toMatch(/\S/);
      expect(surface.evidence.length).toBeGreaterThan(0);

      const fileSource = source(surface.file);
      for (const snippet of surface.evidence) {
        expect(fileSource, `${surface.id} missing evidence: ${snippet}`).toContain(snippet);
      }
    }
  });
});
