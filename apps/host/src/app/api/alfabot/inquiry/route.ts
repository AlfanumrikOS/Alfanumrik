/**
 * /api/alfabot/inquiry — Anonymous "Submit your query" contact form.
 *
 * Distinct from /api/alfabot/lead (DPDPA-style consent-gated lead capture).
 * This route is a basic contact form: visitor name (optional) + email +
 * question. We forward the inquiry to a hardcoded ops inbox via the
 * `alfabot-send-inquiry` Edge Function (Mailgun under the hood), persist a
 * single row in `alfabot_leads` for ops visibility, and audit-log the
 * dispatch without ever leaking PII into audit_logs.
 *
 * Anonymous (no `authorizeRequest`). Per-anon rate limit via the shared
 * lead bucket (3 inquiries / 24h / anon_id). The `alf_anon_id` cookie is
 * minted server-side if missing.
 *
 * Audit policy (P13):
 *   - audit_logs.details MAY include: anonId, sessionId, audience='inquiry',
 *     mailgunMessageId.
 *   - audit_logs.details MUST NEVER include: email, name, question text.
 *
 * Audience column on alfabot_leads: NOT NULL with no CHECK constraint
 * (verified in 20260529000000_alfabot_v1.sql lines 63-76) — we use the
 * literal string 'inquiry' so ops can filter inquiry rows separately
 * from parent/student/teacher/school leads.
 *
 * Owner: backend
 * Reviewers: architect (anon auth boundary), testing (10 scenarios).
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logAudit } from '@alfanumrik/lib/rbac';
import {
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_SECONDS,
  generateAnonId,
} from '@alfanumrik/lib/anon-id';
import { applyLimit } from '@/app/api/alfabot/limits';
import { getDenylistCache, setDenylistCache } from '@/app/api/alfabot/denylist-cache';
import type {
  AlfabotErrorResponse,
  AlfabotInquirySuccess,
} from '@alfanumrik/lib/alfabot/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const EDGE_FUNCTION_TIMEOUT_MS = 12_000; // 10s Mailgun + 2s buffer.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_NAME_LEN = 120;
const MAX_EMAIL_LEN = 254;
const MIN_QUESTION_LEN = 10;
const MAX_QUESTION_LEN = 2000;

const DENYLIST_TTL_MS = 60_000;

async function isDenylisted(anonId: string): Promise<boolean> {
  const cached = getDenylistCache('inquiry', anonId);
  if (cached) return cached.denied;
  try {
    const { data, error } = await supabaseAdmin
      .from('alfabot_denylist')
      .select('anon_id')
      .eq('anon_id', anonId)
      .maybeSingle();
    if (error) {
      logger.warn('alfabot.inquiry_denylist_lookup_failed', { error: error.message });
      return false; // Fail-open.
    }
    const denied = Boolean(data);
    setDenylistCache('inquiry', anonId, denied, DENYLIST_TTL_MS);
    return denied;
  } catch (err) {
    logger.warn('alfabot.inquiry_denylist_lookup_threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

interface ValidatedInquiry {
  name: string | null;
  email: string;
  question: string;
}

function validateBody(body: unknown): ValidatedInquiry | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body_must_be_object' };
  const b = body as Record<string, unknown>;

  // email
  if (typeof b.email !== 'string') return { error: 'email_required' };
  const email = b.email.trim();
  if (email.length === 0) return { error: 'email_required' };
  if (email.length > MAX_EMAIL_LEN) return { error: 'email_too_long' };
  if (!EMAIL_RE.test(email)) return { error: 'email_invalid' };

  // question
  if (typeof b.question !== 'string') return { error: 'question_required' };
  const question = b.question.trim();
  if (question.length < MIN_QUESTION_LEN) return { error: 'question_too_short' };
  if (question.length > MAX_QUESTION_LEN) return { error: 'question_too_long' };

  // name (optional)
  let name: string | null = null;
  if (b.name !== undefined && b.name !== null) {
    if (typeof b.name !== 'string') return { error: 'name_invalid' };
    const trimmed = b.name.trim();
    if (trimmed.length > MAX_NAME_LEN) return { error: 'name_too_long' };
    name = trimmed.length === 0 ? null : trimmed;
  }

  return { name, email: email.toLowerCase(), question };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function errorJson(
  payload: AlfabotErrorResponse,
  status: number,
  setCookieValue?: string,
): NextResponse {
  const res = NextResponse.json(payload, { status });
  if (setCookieValue) {
    res.cookies.set({
      name: ANON_ID_COOKIE,
      value: setCookieValue,
      maxAge: ANON_ID_MAX_AGE_SECONDS,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: false,
    });
  }
  return res;
}
// ─── Edge Function call ─────────────────────────────────────────────────────

interface EdgeFunctionPayload {
  name: string | null;
  email: string;
  question: string;
  sessionId: string | null;
  anonId: string;
}

interface EdgeFunctionResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  status?: number;
}

async function callInquiryEdgeFunction(
  payload: EdgeFunctionPayload,
): Promise<EdgeFunctionResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, error: 'config_missing' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EDGE_FUNCTION_TIMEOUT_MS);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/alfabot-send-inquiry`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    clearTimeout(timer);
    let body: { ok?: boolean; messageId?: string; error?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (!res.ok || body.ok !== true) {
      return {
        ok: false,
        status: res.status,
        error: body.error ?? `http_${res.status}`,
      };
    }
    return { ok: true, messageId: body.messageId ?? '', status: res.status };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort ? 'timeout' : err instanceof Error ? err.message : 'network_error',
    };
  }
}

// ─── POST handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Resolve anon_id (read cookie, mint if missing).
  const cookieStore = await cookies();
  let anonId = cookieStore.get(ANON_ID_COOKIE)?.value || null;
  const anonMinted = !anonId;
  if (!anonId) anonId = generateAnonId();
  const setCookieValue = anonMinted ? anonId : undefined;

  // 2. Parse + validate body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorJson(
      { error: 'invalid_input', detail: 'body_must_be_json' },
      400,
      setCookieValue,
    );
  }
  const validated = validateBody(raw);
  if ('error' in validated) {
    return errorJson(
      { error: 'invalid_input', detail: validated.error },
      400,
      setCookieValue,
    );
  }

  // 3. Denylist check.
  if (await isDenylisted(anonId)) {
    return errorJson({ error: 'denied' }, 403, setCookieValue);
  }

  // 4. Rate limit: 3 inquiries / anon / 24h (shares the lead bucket).
  const rl = await applyLimit('lead', anonId);
  if (!rl.allowed) {
    return errorJson(
      {
        error: 'rate_limited',
        scope: 'inquiry_day',
        resetAt: rl.resetMs ? new Date(rl.resetMs).toISOString() : undefined,
      },
      429,
      setCookieValue,
    );
  }

  // 5. Dispatch to the Edge Function.
  const edgeResult = await callInquiryEdgeFunction({
    name: validated.name,
    email: validated.email,
    question: validated.question,
    sessionId: null,
    anonId,
  });

  if (!edgeResult.ok) {
    logger.error('alfabot.inquiry_edge_function_failed', {
      reason: edgeResult.error,
      status: edgeResult.status ?? null,
      anonId,
    });
    try {
      await logAudit(null, {
        action: 'alfabot.inquiry_failed',
        resourceType: 'alfabot_inquiry',
        resourceId: anonId,
        details: {
          anonId,
          sessionId: null,
          audience: 'inquiry',
          reason: edgeResult.error ?? 'unknown',
          mailgunStatus: edgeResult.status ?? null,
          // NO email / name / question content (P13).
        },
        status: 'failure',
      });
    } catch {
      /* non-critical */
    }
    return errorJson(
      { error: 'mail_send_failed', detail: edgeResult.error },
      502,
      setCookieValue,
    );
  }

  // 6. Persist a row to alfabot_leads (ops visibility).
  //    Audience column is NOT NULL with no CHECK constraint — using the
  //    literal 'inquiry' so ops can filter inquiry rows.
  let leadRowId: string | null = null;
  try {
    const { data: leadRow, error: leadErr } = await supabaseAdmin
      .from('alfabot_leads')
      .insert({
        session_id: null,
        audience: 'inquiry',
        email: validated.email,
        phone: null,
        name: validated.name,
        role_or_designation: 'inquiry',
        school_name: null,
        consent_at: new Date().toISOString(),
        consent_text: 'Submitted via AlfaBot Send Query form on /welcome.',
      })
      .select('id')
      .single();
    if (leadErr) {
      logger.warn('alfabot.inquiry_lead_insert_failed', {
        error: leadErr.message,
        anonId,
      });
    } else if (leadRow) {
      leadRowId = leadRow.id as string;
    }
  } catch (err) {
    logger.warn('alfabot.inquiry_lead_insert_threw', {
      error: err instanceof Error ? err.message : String(err),
      anonId,
    });
  }

  // 7. Audit log — anonId + sessionId + audience + mailgunMessageId only.
  //    NO email / name / question content (P13).
  try {
    await logAudit(null, {
      action: 'alfabot.inquiry_submitted',
      resourceType: 'alfabot_inquiry',
      resourceId: leadRowId ?? anonId,
      details: {
        anonId,
        sessionId: null,
        audience: 'inquiry',
        mailgunMessageId: edgeResult.messageId ?? null,
      },
    });
  } catch {
    /* non-critical */
  }

  const payload: AlfabotInquirySuccess = {
    ok: true,
    messageId: edgeResult.messageId ?? '',
  };
  const res = NextResponse.json(payload, { status: 200 });
  if (setCookieValue) {
    res.cookies.set({
      name: ANON_ID_COOKIE,
      value: setCookieValue,
      maxAge: ANON_ID_MAX_AGE_SECONDS,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: false,
    });
  }
  return res;
}
