import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

describe('RCA-25 API request log telemetry source', () => {
  it('declares the api_request_logs table used by mobile legacy traffic verification', () => {
    const migration = readFileSync(
      repoPath('supabase/migrations/20260710010000_create_api_request_logs.sql'),
      'utf8',
    );

    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.api_request_logs/i);
    expect(migration).toContain('path text NOT NULL');
    expect(migration).toContain('rpc text');
    expect(migration).toContain('client text');
    expect(migration).toContain('occurred_at timestamptz');
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/api_request_logs_no_client_access/i);
  });

  it('records API requests from the host proxy as non-blocking telemetry', () => {
    const source = readFileSync(repoPath('apps/host/src/proxy.ts'), 'utf8');

    expect(source).toContain('recordApiRequestLog');
    expect(source).toContain('/rest/v1/api_request_logs');
    expect(source).toContain('x-client-platform');
    expect(source).toContain('user-agent');
  });
});
