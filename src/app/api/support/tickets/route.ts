/**
 * /api/support/tickets — end-user-facing support ticket API (Audit F22).
 *
 * POST: any authenticated student / teacher / parent creates a ticket.
 * GET:  authenticated user lists their own tickets (paginated).
 *
 * Auth (Phase 2 portal remediation):
 *   The route authorizes with `authorizeRequest(request, 'foxy.chat')` FIRST
 *   — 'foxy.chat' is held by student + teacher. The PARENT role does NOT hold
 *   'foxy.chat' (see migration 20260612123200_rbac_matrix_conformance.sql:
 *   parent grants are child-scoped). So when the foxy.chat check fails we fall
 *   back to `authorizeRequest(request, 'child.view_progress')`, which every
 *   guardian holds. This lets a logged-in guardian create AND list tickets
 *   without a schema change.
 *
 *   GUARDIAN OWNERSHIP MODEL (no schema change):
 *   `support_tickets` has no `created_by_user_id` / `auth_user_id` column —
 *   only a nullable `student_id`. To make guardian tickets persistable AND
 *   listable, a guardian's ticket is anchored to ONE of their linked
 *   children's `student_id` (the first active link) and tagged
 *   `user_role = 'parent'`. GET for a guardian then filters by
 *   `student_id IN (their linked children)` AND `user_role = 'parent'`, so a
 *   guardian never sees the child's own (`user_role='student'`) tickets, and a
 *   student never sees the parent's. Documented follow-up: add a dedicated
 *   `created_by_user_id` column so guardian tickets don't need a child anchor.
 *
 * Rate limit: 5 tickets per 24 hours per user (in-memory sliding window).
 *
 * Audit: every successful creation logs to ops_events for monitoring.
 *
 * P13: ticket message body, email, and phone are NEVER logged. Only ids,
 * role, and category/priority metadata reach the logger / ops events.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest, type AuthorizationResult } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getGuardianByAuthUserId } from '@/lib/domains/identity';
import { listChildrenForGuardian } from '@/lib/domains/relationship';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';
import { checkRateLimit, type RateLimitStore } from '@/lib/rate-limiter';

/**
 * Authorize a support-ticket request. Tries 'foxy.chat' (student/teacher),
 * then 'child.view_progress' (parent). Returns the first successful result,
 * or the foxy.chat error response when neither passes (so an unauthenticated
 * caller still gets a clean 401).
 */
async function authorizeTicketRequest(
  request: NextRequest,
): Promise<{ auth: AuthorizationResult; isGuardianPath: boolean }> {
  const foxy = await authorizeRequest(request, 'foxy.chat');
  if (foxy.authorized) return { auth: foxy, isGuardianPath: false };

  const parent = await authorizeRequest(request, 'child.view_progress');
  if (parent.authorized) return { auth: parent, isGuardianPath: true };

  // Neither permission held. Prefer the parent error when the caller IS
  // authenticated but unauthorized (403); otherwise the foxy 401.
  return {
    auth: foxy.userId ? parent : foxy,
    isGuardianPath: false,
  };
}

/**
 * Resolve the set of student_ids a guardian is linked to (active links only).
 * Returns [] when the caller is not a guardian or has no active links.
 */
async function resolveGuardianChildStudentIds(authUserId: string): Promise<string[]> {
  const guardianRes = await getGuardianByAuthUserId(authUserId);
  if (!guardianRes.ok || !guardianRes.data) return [];
  const childrenRes = await listChildrenForGuardian(authUserId);
  if (!childrenRes.ok) return [];
  return childrenRes.data.map((c) => c.studentId);
}

// ── Rate limiter: 5 tickets / 24h / user ──────────────────────────────
const TICKET_RATE_STORE: RateLimitStore = new Map();
const TICKET_RATE_LIMIT = 5;
const TICKET_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── Body schema ───────────────────────────────────────────────────────
const ALLOWED_CATEGORIES = ['bug', 'billing', 'content', 'account', 'other'] as const;
const ALLOWED_PRIORITIES = ['low', 'normal', 'high'] as const;

const ticketCreateSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z.enum(ALLOWED_CATEGORIES).optional(),
  priority: z.enum(ALLOWED_PRIORITIES).optional(),
});

function err(message: string, status: number, code?: string) {
  return NextResponse.json(
    { success: false, error: message, ...(code ? { code } : {}) },
    { status },
  );
}

// ── POST: create a ticket ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  // 1. Auth — student/teacher via foxy.chat, parent via child.view_progress
  const { auth, isGuardianPath } = await authorizeTicketRequest(request);
  if (!auth.authorized) return auth.errorResponse!;

  // 2. Rate limit per user
  const rateKey = auth.userId || 'anon';
  const rl = checkRateLimit(
    TICKET_RATE_STORE,
    `ticket:${rateKey}`,
    TICKET_RATE_LIMIT,
    TICKET_RATE_WINDOW_MS,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Too many tickets. You can create at most 5 tickets per day.',
        code: 'RATE_LIMITED',
        retry_after_ms: rl.retryAfterMs,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  // 3. Parse body
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err('Invalid JSON body', 400, 'INVALID_BODY');
  }

  const parsed = ticketCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const { subject, description, category, priority } = parsed.data;

  // 4. Resolve the anchor student_id + role.
  //    - student: auth.studentId (their own record)
  //    - parent : first linked child's student_id, so GET can list it back
  //    - teacher: null (no student anchor; listable only via super-admin)
  //    studentId is ALWAYS server-derived — never trusted from the client.
  let anchorStudentId: string | null = auth.studentId;
  let userRole = auth.roles?.[0] ?? 'unknown';

  if (isGuardianPath) {
    userRole = 'parent';
    const childIds = await resolveGuardianChildStudentIds(auth.userId!);
    if (childIds.length === 0) {
      return err(
        'No linked child found. Link a child to your account before contacting support.',
        403,
        'NO_LINKED_CHILD',
      );
    }
    anchorStudentId = childIds[0];
  }

  const ua = request.headers.get('user-agent') ?? '';
  const insertRow = {
    student_id: anchorStudentId, // student-self, parent's linked child, or null (teacher)
    email: 'authenticated@redacted', // PII redacted from logs (P13)
    user_role: userRole,
    category: category ?? 'other',
    priority: priority ?? 'normal',
    subject: subject.trim().slice(0, 200),
    message: description.trim().slice(0, 5000),
    status: 'open',
    device_info: ua.slice(0, 200),
  };

  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .insert(insertRow)
    .select('id, created_at')
    .single();

  if (error || !data) {
    logger.error('support_ticket_create_failed', {
      error: error ? new Error(error.message) : new Error('no data'),
      userId: auth.userId,
      category: insertRow.category,
    });
    return err('Failed to create ticket', 500, 'INSERT_FAILED');
  }

  // 5. Notify ops (fire-and-forget; logOpsEvent never throws)
  await logOpsEvent({
    category: 'support',
    source: 'api/support/tickets',
    severity: priority === 'high' ? 'warning' : 'info',
    subjectType: 'support_ticket',
    subjectId: data.id,
    message: `New support ticket: ${insertRow.category} (${insertRow.priority})`,
    context: {
      user_id: auth.userId,
      // anchor student_id (own / linked child) — a UUID, not PII
      student_id: anchorStudentId,
      role: insertRow.user_role,
      category: insertRow.category,
      priority: insertRow.priority,
    },
    requestId: request.headers.get('x-request-id') ?? undefined,
  });

  return NextResponse.json({
    success: true,
    ticket_id: data.id,
    created_at: data.created_at,
  });
}

// ── GET: list current user's tickets ──────────────────────────────────
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

export async function GET(request: NextRequest) {
  const { auth, isGuardianPath } = await authorizeTicketRequest(request);
  if (!auth.authorized) return auth.errorResponse!;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSizeRaw = parseInt(url.searchParams.get('page_size') ?? String(PAGE_SIZE_DEFAULT), 10);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, pageSizeRaw || PAGE_SIZE_DEFAULT));
  const offset = (page - 1) * pageSize;

  // Build the ticket query scoped to the caller:
  //   - parent : tickets anchored to their linked children + user_role='parent'
  //   - student: tickets anchored to their own student_id
  //   - teacher: no student anchor → empty list (needs created_by_user_id; TODO)
  let query = supabaseAdmin
    .from('support_tickets')
    .select('id, subject, category, priority, status, created_at, updated_at, resolved_at', {
      count: 'exact',
    });

  if (isGuardianPath) {
    const childIds = await resolveGuardianChildStudentIds(auth.userId!);
    if (childIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { tickets: [], total: 0, page, page_size: pageSize },
      });
    }
    // Only the guardian's OWN tickets (user_role='parent'), never the
    // child's own tickets — keeps the parent/student views isolated (P13).
    query = query.in('student_id', childIds).eq('user_role', 'parent');
  } else {
    if (!auth.studentId) {
      // Teacher / other non-student role — no listable anchor yet.
      return NextResponse.json({
        success: true,
        data: { tickets: [], total: 0, page, page_size: pageSize },
      });
    }
    query = query.eq('student_id', auth.studentId).eq('user_role', 'student');
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    logger.error('support_ticket_list_failed', {
      error: new Error(error.message),
      userId: auth.userId,
    });
    return err('Failed to list tickets', 500, 'LIST_FAILED');
  }

  return NextResponse.json({
    success: true,
    data: {
      tickets: data ?? [],
      total: count ?? data?.length ?? 0,
      page,
      page_size: pageSize,
    },
  });
}
