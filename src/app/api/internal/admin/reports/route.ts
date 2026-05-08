import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret, logAdminAction } from '@/lib/admin-auth';

export const runtime = 'nodejs';

async function fetchAll(table: string, select: string, filter?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  let queryParams = `select=${select}&order=created_at.desc&limit=5000`;
  if (filter) queryParams += `&${filter}`;

  const res = await fetch(`${url}/rest/v1/${table}?${queryParams}`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
  });
  return res.json();
}

function toCsv(data: Record<string, unknown>[]): string {
  if (!data.length) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h];
      const str = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
      return `"${str.replace(/"/g, '""')}"`;
    }).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const params = new URL(request.url).searchParams;
    const type = params.get('type') || 'students';
    const format = params.get('format') || 'csv';
    const from = params.get('from');
    const to = params.get('to');

    let table: string;
    let select: string;
    let filter = '';

    switch (type) {
      case 'students':
        table = 'students';
        select = 'id,name,email,grade,board,xp_total,streak_days,is_active,account_status,subscription_plan,preferred_language,created_at';
        break;
      case 'teachers':
        table = 'teachers';
        select = 'id,name,email,school_name,is_active,created_at';
        break;
      case 'parents':
        table = 'guardians';
        select = 'id,name,email,phone,created_at';
        break;
      case 'quizzes':
        table = 'quiz_sessions';
        select = 'id,student_id,subject,grade,total_questions,correct_answers,score_percent,time_taken_seconds,is_completed,created_at';
        break;
      case 'chats':
        table = 'chat_sessions';
        select = 'id,student_id,subject,grade,message_count,is_active,created_at,updated_at';
        break;
      case 'audit':
        table = 'audit_logs';
        select = 'id,auth_user_id,action,resource_type,resource_id,status,ip_address,created_at';
        break;
      default:
        return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });
    }

    // Defense-in-depth: validate `from`/`to` as ISO-8601 dates before
    // interpolating into the PostgREST query string. Without this, an admin
    // (gated by SUPER_ADMIN_SECRET) could pass `from=...&select=other` and
    // override the column whitelist by appending a second `select=` param —
    // PostgREST honours the last occurrence and would emit columns that the
    // route explicitly didn't whitelist (e.g. join across `students` to pull
    // sensitive PII not in the per-type select clause). Tightens the attack
    // surface against a leaked / misused admin secret.
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
    if (from) {
      if (!ISO_DATE.test(from)) {
        return NextResponse.json({ error: 'from must be an ISO-8601 date' }, { status: 400 });
      }
      filter += `created_at=gte.${encodeURIComponent(from)}`;
    }
    if (to) {
      if (!ISO_DATE.test(to)) {
        return NextResponse.json({ error: 'to must be an ISO-8601 date' }, { status: 400 });
      }
      filter += `${filter ? '&' : ''}created_at=lte.${encodeURIComponent(to)}`;
    }

    const data = await fetchAll(table, select, filter || undefined);
    await logAdminAction({ action: 'download_report', entity_type: 'report', details: { type, format, count: data?.length }, ip });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `alfanumrik-${type}-${timestamp}`;

    if (format === 'json') {
      return new NextResponse(JSON.stringify({ report: type, generated_at: new Date().toISOString(), count: data.length, data }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}.json"`,
        },
      });
    }

    // CSV
    const csv = toCsv(data);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
