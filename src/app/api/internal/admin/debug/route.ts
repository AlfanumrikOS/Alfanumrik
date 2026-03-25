import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/internal/admin/debug — Debug env vars (temporary)
 * Returns which env vars are set (NOT their values)
 */
export async function GET(request: NextRequest) {
  const adminKey = request.headers.get('x-admin-secret');
  const secretKey = process.env.SUPER_ADMIN_SECRET;

  // Check auth
  if (!secretKey || !adminKey || adminKey !== secretKey) {
    return NextResponse.json({
      error: 'Unauthorized',
      debug: {
        headerPresent: !!adminKey,
        headerName: 'x-admin-secret',
        envVarSet: !!secretKey,
        envVarName: 'SUPER_ADMIN_SECRET',
        envVarLength: secretKey?.length ?? 0,
        headerLength: adminKey?.length ?? 0,
        match: adminKey === secretKey,
      }
    }, { status: 401 });
  }

  // Auth passed — check other env vars
  return NextResponse.json({
    auth: 'OK',
    env: {
      SUPER_ADMIN_SECRET: !!process.env.SUPER_ADMIN_SECRET,
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY_LENGTH: process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0,
      SUPABASE_URL_VALUE: process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/\/(.{8}).*(@.*)/, '//$1...REDACTED$2') ?? 'NOT SET',
    }
  });
}
