import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

type EdgeFunctionManifest = {
  functions: Array<{
    name: string;
    deploy: boolean;
    requiredSecrets: string[];
  }>;
};

type SharedSecretReadiness = {
  id: string;
  status: string;
  sharedModule: string;
  consumerFunctions: string[];
  requiredSecrets: string[];
  activationProof: {
    operatorCommand: string;
    smokeCommand: string;
    fallbackMode: string;
  };
};

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '..', '..', rel), 'utf8')) as T;
}

const manifest = readJson<EdgeFunctionManifest>('scripts/edge-function-manifest.json');
const durableLimiterSource = fs.readFileSync(
  path.resolve(process.cwd(), '..', '..', 'supabase/functions/_shared/durable-rate-limiter.ts'),
  'utf8',
);
const parentPortalSource = fs.readFileSync(
  path.resolve(process.cwd(), '..', '..', 'supabase/functions/parent-portal/index.ts'),
  'utf8',
);

describe('RCA-08/RCA-09 Edge shared-secret activation readiness', () => {
  it('declares Upstash as required deployment secrets for parent-portal', () => {
    const parentPortal = manifest.functions.find((fn) => fn.name === 'parent-portal');

    expect(parentPortal).toBeDefined();
    expect(parentPortal?.deploy).toBe(true);
    expect(parentPortal?.requiredSecrets).toEqual(
      expect.arrayContaining([
        'SUPABASE_SERVICE_ROLE_KEY',
        'SUPABASE_URL',
        'UPSTASH_REDIS_REST_URL',
        'UPSTASH_REDIS_REST_TOKEN',
      ]),
    );
  });

  it('keeps a readiness artifact for shared Edge module secrets that direct index scans cannot see', () => {
    const artifactPath = path.resolve(
      process.cwd(),
      '..',
      '..',
      'scripts/edge-secret-activation-readiness.json',
    );
    expect(fs.existsSync(artifactPath)).toBe(true);

    const readiness = readJson<SharedSecretReadiness>('scripts/edge-secret-activation-readiness.json');

    expect(readiness).toMatchObject({
      id: 'RCA-08-RCA-09-edge-shared-secret-activation',
      status: 'operator-gated',
      sharedModule: 'supabase/functions/_shared/durable-rate-limiter.ts',
      consumerFunctions: ['parent-portal'],
      requiredSecrets: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
      activationProof: {
        fallbackMode: 'in-memory limiter only; not product-ready for cross-instance brute-force protection',
      },
    });

    expect(readiness.activationProof.operatorCommand).toContain('supabase secrets set');
    expect(readiness.activationProof.operatorCommand).toContain('UPSTASH_REDIS_REST_URL');
    expect(readiness.activationProof.operatorCommand).toContain('UPSTASH_REDIS_REST_TOKEN');
    expect(readiness.activationProof.smokeCommand).toContain('parent-portal');
  });

  it('pins the evidence trail from shared secret reads to the consuming Edge function', () => {
    expect(durableLimiterSource).toContain("Deno.env.get('UPSTASH_REDIS_REST_URL')");
    expect(durableLimiterSource).toContain("Deno.env.get('UPSTASH_REDIS_REST_TOKEN')");
    expect(parentPortalSource).toContain(
      "import { createDurableRateLimiter } from '../_shared/durable-rate-limiter.ts'",
    );
    expect(parentPortalSource).toContain(
      "createDurableRateLimiter(PARENT_LOGIN_IP_LIMIT, PARENT_LOGIN_IP_WINDOW_MS, 'rl:parent_login')",
    );
  });
});
