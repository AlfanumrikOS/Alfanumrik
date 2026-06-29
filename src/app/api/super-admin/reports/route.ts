import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl, type AdminLevel } from '../../../../lib/admin-auth';

async function fetchAll(table: string, select: string, filter?: string) {
  let queryParams = `select=${select}&order=created_at.desc&limit=5000`;
  if (filter) queryParams += `&${filter}`;

  const res = await fetch(supabaseAdminUrl(table, queryParams), {
    headers: supabaseAdminHeaders(),
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

/**
 * Per-type export config — table, column whitelist, demo filter, and the
 * MINIMUM admin tier required to run that export.
 *
 * SAO-1 / SAO-5 (2026-06-29, P9/P13/DPDP remediation):
 *   This route previously sat behind a single `authorizeAdmin(request,'support')`
 *   gate for ALL six report types. `support` is the FLOOR tier (any active
 *   admin_users row). Four of the six types egress personally-identifiable data
 *   — `students` (minors' name+email), `teachers` (name+email), `parents`
 *   (name+email+PHONE), `audit` (admin name+email in details) — at up to 5000
 *   rows. Mass minors'/parent PII export at the lowest admin tier is a P13/DPDP
 *   exposure.
 *
 *   Fix: gate each type at its own tier. The four PII types now require
 *   `super_admin` — intentionally the SAFEST default, consistent with the
 *   destructive-mutation / RBAC / provisioning set (see admin-auth.ts Phase G.1).
 *   The two UUID-only, non-PII types (`quizzes`, `chats`) keep the `support`
 *   floor. The per-type gate still runs BEFORE any data query for every type,
 *   and `type` is validated up front so an unknown type fails closed (400)
 *   without touching the DB or a gate.
 *
 *   Loosening is a one-line change: if the CEO chooses to let some staff retain
 *   PII export, drop the PII tier to `finance` or `admin` below. No migration,
 *   role, or permission code is involved.
 */
const REPORT_CONFIG: Record<
  string,
  { table: string; select: string; demoFilter: boolean; level: AdminLevel }
> = {
  students: {
    table: 'students',
    select: 'id,name,email,grade,board,xp_total,streak_days,is_active,account_status,subscription_plan,preferred_language,created_at',
    demoFilter: true,
    level: 'super_admin', // PII: minors' name+email
  },
  teachers: {
    table: 'teachers',
    select: 'id,name,email,school_name,is_active,created_at',
    demoFilter: true,
    level: 'super_admin', // PII: name+email
  },
  parents: {
    table: 'guardians',
    select: 'id,name,email,phone,created_at',
    demoFilter: true,
    level: 'super_admin', // PII: name+email+phone
  },
  quizzes: {
    table: 'quiz_sessions',
    select: 'id,student_id,subject,grade,total_questions,correct_answers,score_percent,time_taken_seconds,is_completed,created_at',
    demoFilter: false,
    level: 'support', // UUID-only, non-PII → keep the floor
  },
  chats: {
    table: 'chat_sessions',
    select: 'id,student_id,subject,grade,message_count,is_active,created_at,updated_at',
    demoFilter: false,
    level: 'support', // UUID-only, non-PII → keep the floor
  },
  audit: {
    table: 'admin_audit_log',
    select: 'id,admin_id,action,entity_type,entity_id,details,ip_address,created_at',
    demoFilter: false,
    level: 'super_admin', // PII: admin name+email surfaced in details
  },
};

export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams;
    const type = params.get('type') || 'students';
    const format = params.get('format') || 'csv';
    const from = params.get('from');
    const to = params.get('to');

    // SAO-1/SAO-5: validate `type` FIRST and fail closed on anything unknown,
    // BEFORE any auth gate or DB access — an unrecognised type must never slip
    // through to a query or inherit a lower tier.
    const config = REPORT_CONFIG[type];
    if (!config) {
      return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });
    }

    // SAO-1/SAO-5: per-type tier gate. PII exports require `super_admin`;
    // UUID-only exports keep the `support` floor. The gate always runs BEFORE
    // any data query.
    const auth = await authorizeAdmin(request, config.level);
    if (!auth.authorized) return auth.response;

    const { table, select } = config;
    let filter = '';
    if (config.demoFilter) {
      filter += `${filter ? '&' : ''}is_demo=eq.false`;
    }

    // Defense-in-depth: validate `from`/`to` as ISO-8601 dates before
    // interpolating into the PostgREST query string. Without this, an
    // admin could pass `from=2026-01-01&select=*,...` to override the
    // per-type select whitelist (PostgREST honours the LAST occurrence
    // of duplicate query params, so a sneaky second `select=` would win).
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
    if (from) {
      if (!ISO_DATE.test(from)) {
        return NextResponse.json({ error: 'from must be an ISO-8601 date' }, { status: 400 });
      }
      filter += `${filter ? '&' : ''}created_at=gte.${encodeURIComponent(from)}`;
    }
    if (to) {
      if (!ISO_DATE.test(to)) {
        return NextResponse.json({ error: 'to must be an ISO-8601 date' }, { status: 400 });
      }
      filter += `${filter ? '&' : ''}created_at=lte.${encodeURIComponent(to)}`;
    }

    const data = await fetchAll(table, select, filter || undefined);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `alfanumrik-${type}-${timestamp}`;

    // Audit log: track all data exports for compliance
    await logAdminAudit(auth, 'report.exported', 'reports', type, {
      format, row_count: Array.isArray(data) ? data.length : 0, from: from || null, to: to || null,
    });

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
