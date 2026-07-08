/**
 * GET /api/parent/children/[student_id]/chat — parent reads child's Foxy chat.
 *
 * Phase 2 portal remediation (NEW feature, CEO-approved P13 exposure). Lets an
 * APPROVED guardian read their linked child's Foxy AI tutor transcript,
 * READ-ONLY and paginated. The parent /parent/support FAQ previously said
 * "chat transcripts are visible on the student's device... we're working on a
 * parent view" — this route is that parent view.
 *
 * DATA MODEL (confirmed against baseline_from_prod.sql):
 *   foxy_chat_messages(id, session_id, student_id, role, content, sources,
 *                      tokens_used, created_at)
 *     - role CHECK: 'user' | 'assistant'
 *     - student_id is a DIRECT FK to students(id) — no join through
 *       foxy_sessions is required to scope by child. session_id joins to
 *       foxy_sessions(id, student_id, ...) if session grouping is ever needed.
 *   If the architect's confirmed contract differs (e.g. the parent-readable
 *   surface routes through foxy_sessions instead), only the `.from(...)` /
 *   filter column below changes; the auth + pagination contract is stable.
 *
 * AUTH (defense in depth — TWO independent layers):
 *   1. APP LAYER:
 *      a. authorizeRequest(request, 'child.view_progress') — RBAC gate.
 *      b. canAccessStudent(authUserId, student_id) — the single cross-role
 *         data boundary; for a parent this requires an APPROVED/ACTIVE
 *         guardian_student_links row. No payload on any deny (P13).
 *   2. DB LAYER:
 *      The actual message read uses the RLS-SCOPED server client
 *      (createSupabaseServerClient — anon key + caller's session), NOT
 *      supabase-admin. The architect's new "approved guardian reads child
 *      Foxy chat" RLS policy on foxy_chat_messages enforces the boundary a
 *      second time at the database. If the policy is not yet deployed, the
 *      RLS read simply returns 0 rows for a guardian (fail-closed) — the
 *      route still behaves correctly, just empty, until the policy lands.
 *
 * Query params:
 *   limit   (optional) — 1..100, default 50. Page size.
 *   before  (optional) — ISO timestamp; return messages strictly OLDER than
 *                        this (keyset pagination, newest-first). Omit for the
 *                        latest page.
 *
 * Response contract (frontend Wave 2B):
 *   200 {
 *     success: true,
 *     data: {
 *       student_id: string,
 *       messages: Array<{
 *         id: string,
 *         role: 'user' | 'assistant',
 *         text: string,            // foxy_chat_messages.content
 *         created_at: string,      // ISO timestamp
 *         session_id: string,
 *       }>,                        // ordered NEWEST-first
 *       page: { limit: number, has_more: boolean, next_before: string | null },
 *     }
 *   }
 *   To page back in time, pass `next_before` as `before` on the next request.
 *
 * P13: returns ONLY the child's own messages (role + text + timestamp). No
 * other PII. No message text is ever logged. Paginated to avoid dumping the
 * full history in one response.
 */

import { NextResponse } from 'next/server';
import { authorizeRequest, canAccessStudent, logAudit } from '@alfanumrik/lib/rbac';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Build an RLS-scoped Supabase client for THIS request.
 *
 * Honors both auth transports the parent portal can use:
 *   - Authorization: Bearer <jwt>  → passed through as a global header so the
 *     anon client adopts the caller's identity (auth.uid() resolves).
 *   - Supabase session cookie       → read via next/headers cookies().
 * Either way the client is bound to the anon key, so RLS is ENFORCED (this is
 * deliberately NOT supabase-admin).
 */
async function createRlsScopedClient(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const authHeader = request.headers.get('Authorization');
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Read-only route — never mutate session cookies here.
      },
    },
    ...(authHeader
      ? { global: { headers: { Authorization: authHeader } } }
      : {}),
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ student_id: string }> },
) {
  try {
    // ── 1a. RBAC gate ────────────────────────────────────────────────
    const auth = await authorizeRequest(request, 'child.view_progress');
    if (!auth.authorized) return auth.errorResponse!;

    // ── 1b. Path param validation ────────────────────────────────────
    const { student_id: studentId } = await context.params;
    if (!studentId || !isValidUUID(studentId)) {
      return NextResponse.json(
        { success: false, error: 'Valid student_id is required' },
        { status: 400 },
      );
    }

    // ── 1c. Resource access boundary (the single data boundary) ──────
    const canAccess = await canAccessStudent(auth.userId!, studentId);
    if (!canAccess) {
      logAudit(auth.userId!, {
        action: 'parent.child_chat_viewed',
        resourceType: 'foxy_chat_messages',
        resourceId: studentId,
        status: 'denied',
        details: { reason: 'not_linked' },
      });
      // No payload on the deny path (P13).
      return NextResponse.json(
        { success: false, error: 'You are not linked to this student' },
        { status: 403 },
      );
    }

    // ── 2. Pagination params ─────────────────────────────────────────
    const url = new URL(request.url);
    const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const before = url.searchParams.get('before');
    let beforeIso: string | null = null;
    if (before) {
      const d = new Date(before);
      if (!isNaN(d.getTime())) beforeIso = d.toISOString();
    }

    // ── 3. RLS-scoped read (DB layer enforces the boundary too) ──────
    // Fetch limit+1 to detect whether another page exists, newest-first.
    const supabase = await createRlsScopedClient(request);

    let query = supabase
      .from('foxy_chat_messages')
      .select('id, session_id, role, content, created_at')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (beforeIso) {
      query = query.lt('created_at', beforeIso);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('parent_child_chat_read_failed', {
        route: 'parent/children/chat',
        error: new Error(error.message),
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load chat transcript' },
        { status: 500 },
      );
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const messages = pageRows.map((m) => ({
      id: m.id as string,
      role: m.role as 'user' | 'assistant',
      text: (m.content as string) ?? '',
      created_at: m.created_at as string,
      session_id: m.session_id as string,
    }));

    const nextBefore =
      hasMore && pageRows.length > 0
        ? (pageRows[pageRows.length - 1].created_at as string)
        : null;

    // Audit the successful view (fire-and-forget). P13: metadata only —
    // counts, not message text.
    logAudit(auth.userId!, {
      action: 'parent.child_chat_viewed',
      resourceType: 'foxy_chat_messages',
      resourceId: studentId,
      status: 'success',
      details: { message_count: messages.length },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          student_id: studentId,
          messages,
          page: {
            limit,
            has_more: hasMore,
            next_before: nextBefore,
          },
        },
      },
      {
        headers: {
          // Per-child PII — never cache the transcript in shared layers.
          'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        },
      },
    );
  } catch (err) {
    logger.error('parent_child_chat_failed', {
      route: 'parent/children/chat',
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
