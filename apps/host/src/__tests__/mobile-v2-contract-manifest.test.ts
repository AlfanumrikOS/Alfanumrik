import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

interface MobileV2ContractEntry {
  path: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  operationId: string;
  hostRoute: string;
  dartApiFile: string;
  dartMethod: string;
  mobileOwner: string;
  productSurface: string;
  status: 'canonical' | 'generated' | 'compat';
  evidence: string[];
}

describe('mobile /v2 contract manifest (RCA-25)', () => {
  it('pins every OpenAPI /v2 operation to a host route and generated Dart client method', () => {
    expect(existsSync(repoPath('scripts/mobile-v2-contract-manifest.json'))).toBe(true);

    const openapi = JSON.parse(readFileSync(repoPath('openapi/v2.json'), 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const manifest = JSON.parse(
      readFileSync(repoPath('scripts/mobile-v2-contract-manifest.json'), 'utf8'),
    ) as { entries: MobileV2ContractEntry[] };

    const openapiOperations = Object.entries(openapi.paths)
      .flatMap(([path, methods]) =>
        Object.entries(methods).map(([method, operation]) => ({
          key: `${method.toLowerCase()} ${path}`,
          path,
          method: method.toLowerCase(),
          operationId: operation.operationId,
        })),
      )
      .filter((operation) => operation.path.startsWith('/v2/'));

    const manifestByKey = new Map(
      manifest.entries.map((entry) => [`${entry.method} ${entry.path}`, entry]),
    );

    for (const operation of openapiOperations) {
      const entry = manifestByKey.get(operation.key);
      expect(entry, `${operation.key} missing from mobile v2 manifest`).toBeDefined();
      expect(entry?.operationId).toBe(operation.operationId);
    }

    expect(manifest.entries).toHaveLength(openapiOperations.length);

    for (const entry of manifest.entries) {
      expect(entry.path).toMatch(/^\/v2\//);
      expect(entry.operationId).toMatch(/\S/);
      expect(entry.dartMethod).toMatch(/\S/);
      expect(entry.mobileOwner).toMatch(/\S/);
      expect(entry.productSurface).toMatch(/\S/);
      expect(existsSync(repoPath(entry.hostRoute)), `${entry.path} host route missing`).toBe(true);
      expect(existsSync(repoPath(entry.dartApiFile)), `${entry.path} Dart API missing`).toBe(true);

      const dartSource = readFileSync(repoPath(entry.dartApiFile), 'utf8');
      expect(dartSource, `${entry.path} missing Dart method ${entry.dartMethod}`).toContain(
        entry.dartMethod,
      );
      expect(dartSource, `${entry.path} missing generated path literal`).toContain(entry.path);

      for (const snippet of entry.evidence) {
        expect(dartSource, `${entry.path} missing evidence: ${snippet}`).toContain(snippet);
      }
    }
  });
});
