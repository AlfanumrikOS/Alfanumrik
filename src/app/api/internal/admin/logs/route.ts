import { NextRequest, NextResponse } from 'next/server';

function checkAuth(request: NextRequest): boolean {
  const adminKey = request.headers.get('x-admin-secret');
  const secretKey = process.env.SUPER_ADMIN_SECRET;
  return !!(secretKey && adminKey && adminKey === secretKey);
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, parseInt(params.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '25')));
    const offset = (page - 1) * limit;

    const res = await fetch(
      `${url}/rest/v1/audit_logs?select=id,auth_user_id,action,resource_type,resource_id,details,status,created_at&order=created_at.desc&offset=${offset}&limit=${limit}`,
      {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Prefer': 'count=exact',
        },
      }
    );

    const data = await res.json();
    const range = res.headers.get('content-range');
    const total = range ? parseInt(range.split('/')[1]) || 0 : 0;

    return NextResponse.json({ data, total, page, limit });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
