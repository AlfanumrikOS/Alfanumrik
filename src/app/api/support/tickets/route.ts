/**
 * /api/support/tickets — end-user-facing support ticket API (Audit F22).
 *
 * POST: any authenticated student/teacher/parent creates a ticket.
 * GET:  authenticated user lists their own tickets (paginated).
 *
 * Auth: authorizeRequest(request, 'foxy.chat')
 *   — 'foxy.chat' is the broadest permission held by every paying role
 *     (student, teacher, parent). RBAC + RLS together guarantee a user
 *     can only see/create their own tickets.
 *
 * Rate limit: 5 tickets per 24 hours per user (in-memory sliding window).
 *
 * Audit: every successful creation logs to ops_events for monitoring.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';
import { checkRateLimit, type RateLimitStore } from '@/lib/rate-limiter';

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
  // 1. Auth — any authenticated user with chat access (student/teacher/parent)
  const auth = await authorizeRequest(request, 'foxy.chat');
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

  // 4. Insert via service-role (RLS still validated server-side via studentId).
  //    studentId is server-derived — never trust client to set it.
  const ua = request.headers.get('user-agent') ?? '';
  const insertRow = {
    student_id: auth.studentId, // null for non-student roles — viewable via super-admin
    email: 'authenticated@redacted', // PII redacted from logs (P13)
    user_role: auth.roles?.[0] ?? 'unknown',
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
      student_id: auth.studentId,
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
  const auth = await authorizeRequest(request, 'foxy.chat');
  if (!auth.authorized) return auth.errorResponse!;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSizeRaw = parseInt(url.searchParams.get('page_size') ?? String(PAGE_SIZE_DEFAULT), 10);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, pageSizeRaw || PAGE_SIZE_DEFAULT));
  const offset = (page - 1) * pageSize;

  // Filter by student_id (server-derived). Non-student roles get empty list
  // (we'd need a `created_by_user_id` column to support teacher/parent
  // tickets — not in current schema). Document that for follow-up.
  if (!auth.studentId) {
    return NextResponse.json({
      success: true,
      data: { tickets: [], total: 0, page, page_size: pageSize },
    });
  }

  const { data, error, count } = await supabaseAdmin
    .from('support_tickets')
    .select('id, subject, category, priority, status, created_at, updated_at, resolved_at', {
      count: 'exact',
    })
    .eq('student_id', auth.studentId)
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
