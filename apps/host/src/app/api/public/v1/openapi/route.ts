/**
 * GET /api/public/v1/openapi — serve the Public API v1 OpenAPI spec.
 * ============================================================================
 * Static, unauthenticated documentation endpoint (the spec describes the API
 * surface only — no secrets, no PII). Lets integrators load the machine-readable
 * contract directly. The canonical spec lives at docs/public-api/openapi.json
 * and is read from disk at request time (kept out of the bundle).
 */

import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolvePublicApiSpecPath(): string {
  const candidates = [
    path.join(process.cwd(), 'docs', 'public-api', 'openapi.json'),
    path.join(process.cwd(), '..', '..', 'docs', 'public-api', 'openapi.json'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export async function GET() {
  try {
    const specPath = resolvePublicApiSpecPath();
    const raw = await readFile(specPath, 'utf-8');
    return new NextResponse(raw, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    logger.error('public_api_openapi_serve_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/public/v1/openapi',
    });
    return NextResponse.json(
      { success: false, error: 'OpenAPI specification is unavailable' },
      { status: 500 },
    );
  }
}
