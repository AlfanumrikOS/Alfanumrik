/**
 * POST /api/support/ticket — UNAUTHENTICATED support-ticket intake.
 *
 * Creates a support ticket. Allows unauthenticated (guest) submissions
 * but always resolves student_id from auth — never trusts client-provided student_id.
 * Replaces direct anon-client insert in help/page.tsx.
 *
 * ── Rate limiting (added 2026-08-11) ───────────────────────────────────────
 * This route takes NO auth and writes via the service-role client, and /contact
 * — the most-linked public marketing form on the site (12 entry points incl.
 * the pricing FAQ and the AlfaBot escape hatch) — now POSTs to it. That made it
 * an unthrottled anonymous insert path into `support_tickets`. It is now
 * limited on the same in-memory sliding-window store the authenticated plural
 * route uses (../tickets/route.ts:84-87), keyed on:
 *   - the authenticated user id when a Bearer token resolves (so students
 *     behind one school NAT don't consume each other's quota), else
 *   - the client IP (guests have no user id).
 *
 * ── Category (P-adjacent data-quality fix, 2026-08-11) ─────────────────────
 * This route used to carry its own inline enum
 * ['bug','content','payment','account','feature','other'], which disagreed with
 * SUPPORT_TICKET_CATEGORIES in @alfanumrik/lib/support/ticket-categories: it
 * accepted 'payment'/'feature' (not canonical) and rejected 'billing' and the
 * two dispute categories (canonical). Two intake routes were therefore writing
 * mutually-incompatible strings into the same free-TEXT `category` column and
 * every operator filter keyed on it under-counted. It now validates against the
 * canonical list PLUS the legacy aliases, and persists the NORMALISED canonical
 * value, so old clients keep working while the column converges.
 *
 * P13: the message body, email and phone are never logged — only category and
 * ids reach the logger.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { getStudentByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { logger } from '@alfanumrik/lib/logger';
import { validateBody } from '@alfanumrik/lib/validation';
import { checkRateLimit, type RateLimitStore } from '@alfanumrik/lib/rate-limiter';
import {
  SUPPORT_TICKET_CATEGORY_INPUTS,
  categoryRequiresReference,
  normalizeTicketCategory,
} from '@alfanumrik/lib/support/ticket-categories';

// ── Rate limiter: 5 submissions / hour / IP (or / user when authenticated) ──
// Tighter window than the authenticated route's 5-per-24h because this surface
// is anonymous; more permissive per-window because a genuine visitor may retry
// a failed submission. In-memory + per-instance — same trade-off (and same
// Upstash upgrade path) as every other limiter in the codebase.
const INTAKE_RATE_STORE: RateLimitStore = new Map();
const INTAKE_RATE_LIMIT = 5;
const INTAKE_RATE_WINDOW_MS = 60 * 60 * 1000;

const TicketBodySchema = z.object({
  // Canonical categories + legacy aliases ('payment' -> billing, 'feature' -> other).
  category: z.enum(SUPPORT_TICKET_CATEGORY_INPUTS),
  message: z.string().trim().min(10, 'message must be at least 10 characters').max(5000, 'message cannot exceed 5000 characters'),
  subject: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(254).optional(),
});

function err(message: string, status: number, code?: string) {
  return NextResponse.json(
    { success: false, error: message, ...(code ? { code } : {}) },
    { status },
  );
}

/** Client IP for rate-limit keying. Never logged (P13). */
function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try { rawBody = await request.json(); } catch { return err('Invalid request body', 400); }

  const validation = validateBody(TicketBodySchema, rawBody);
  if (!validation.success) return validation.error;
  const { category, subject, message, email } = validation.data;

  // Try to resolve authenticated student (optional — guests can also submit)
  let studentId: string | null = null;
  let studentName: string | null = null;
  let studentEmail: string | null = null;
  let authUserId: string | null = null;

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (user) {
      authUserId = user.id;
      const result = await getStudentByAuthUserId(user.id);
      if (result.ok && result.data) {
        studentId = result.data.id;
        studentName = result.data.name;
        studentEmail = result.data.email;
      }
    }
  }

  // Rate limit AFTER identity resolution so an authenticated caller is keyed on
  // their user id rather than a shared NAT IP, but BEFORE any write.
  const rateKey = authUserId ? `user:${authUserId}` : `ip:${clientIp(request)}`;
  const rl = checkRateLimit(
    INTAKE_RATE_STORE,
    `support-intake:${rateKey}`,
    INTAKE_RATE_LIMIT,
    INTAKE_RATE_WINDOW_MS,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Too many messages. Please try again later, or email support@alfanumrik.com.',
        code: 'RATE_LIMITED',
        retry_after_ms: rl.retryAfterMs,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  // Normalise legacy wire values onto the canonical enum before persisting.
  const canonicalCategory = normalizeTicketCategory(category);

  // The two dispute categories REQUIRE a structured trigger-record reference
  // (adaptive_interventions.id / monthly_synthesis_runs.id), which this
  // anonymous route has no field for and no way to authorize. Reject with a
  // pointer to the in-app form rather than persisting a reference-less dispute
  // that support can't action.
  if (categoryRequiresReference(canonicalCategory)) {
    return err(
      `Category "${canonicalCategory}" must be raised from your account so it can be linked to the record being disputed.`,
      400,
      'REFERENCE_REQUIRED',
    );
  }

  // Resolve email — authed student's email > body email (guest) > anonymous.
  // The schema already validates email format when supplied; no second check needed.
  const resolvedEmail = studentEmail ?? email ?? 'anonymous';

  const ua = request.headers.get('user-agent') ?? '';

  const { error } = await supabaseAdmin.from('support_tickets').insert({
    student_id: studentId,
    email: resolvedEmail,
    category: canonicalCategory,
    subject: subject || canonicalCategory,
    message,
    status: 'open',
    user_role: studentId ? 'student' : 'guest',
    user_name: studentName ?? 'Guest',
    device_info: ua.substring(0, 200),
  });

  if (error) {
    logger.error('support_ticket_insert_failed', {
      error: new Error(error.message),
      category: canonicalCategory,
    });
    return err('Failed to create ticket', 500);
  }

  return NextResponse.json({ success: true });
}
