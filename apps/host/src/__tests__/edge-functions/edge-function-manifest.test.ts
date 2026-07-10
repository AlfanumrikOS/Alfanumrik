import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

interface EdgeFunctionManifestEntry {
  name: string;
  deploy: boolean;
  class: string;
  requiredSecrets: string[];
  healthCheck: string;
  owner: string;
}

function activeFunctionNames(): string[] {
  const root = repoPath('supabase/functions');
  return readdirSync(root)
    .filter((name) => !name.startsWith('_'))
    .filter((name) => statSync(join(root, name)).isDirectory())
    .filter((name) => existsSync(join(root, name, 'index.ts')))
    .sort();
}

function directEnvNames(functionName: string): string[] {
  const source = readFileSync(repoPath(`supabase/functions/${functionName}/index.ts`), 'utf8');
  const out = new Set<string>();
  const re = /Deno\.env\.get\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) out.add(match[1]);
  return [...out].sort();
}

describe('Supabase Edge Function deploy manifest (RCA-08)', () => {
  it('lists every active Edge Function with deploy, owner, secret, and health metadata', () => {
    expect(existsSync(repoPath('scripts/edge-function-manifest.json'))).toBe(true);

    const manifest = JSON.parse(
      readFileSync(repoPath('scripts/edge-function-manifest.json'), 'utf8'),
    ) as { functions: EdgeFunctionManifestEntry[] };

    const active = activeFunctionNames();
    const manifestNames = manifest.functions.map((entry) => entry.name).sort();

    expect(manifestNames).toEqual(active);

    for (const entry of manifest.functions) {
      expect(entry.deploy).toBe(true);
      expect(entry.class).toMatch(/\S/);
      expect(entry.owner).toMatch(/\S/);
      expect(entry.healthCheck).toMatch(/\S/);
      expect(Array.isArray(entry.requiredSecrets)).toBe(true);

      const declaredSecrets = new Set(entry.requiredSecrets);
      for (const envName of directEnvNames(entry.name)) {
        expect(
          declaredSecrets.has(envName),
          `${entry.name} reads ${envName} directly but does not declare it in scripts/edge-function-manifest.json`,
        ).toBe(true);
      }
    }
  });
});
