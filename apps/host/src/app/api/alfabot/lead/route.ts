/**
 * /api/alfabot/lead — Opt-in lead capture for AlfaBot visitors.
 *
 * Anonymous (no `authorizeRequest`). The visitor's anon_id cookie scopes
 * the session lookup, so a leaked sessionId from one anon cannot be paired
 * with a different anon's email.
 *
 * Audit policy (P13):
 *   - audit_logs.details MAY include: anonId, sessionId, audience, leadId.
 *   - audit_logs.details MUST NEVER include: email, phone, name, school_name.
 *
 * Webhook delivery: fire-and-forget. The Slack/CRM webhook URL is read from
 * `ALFABOT_LEAD_CAPTURE_WEBHOOK_URL`. On 2xx the row's webhook_delivered_at
 * is stamped. Failure is logged but does NOT fail the request — the lead is
 * already in alfabot_leads and ops can replay.
 *
 * Owner: backend
 * Reviewers: architect (anon auth boundary, DPDPA consent contract),
 *   testing (5 scenarios).
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { logAudit } from '@alfanumrik/lib/rbac';
import { ANON_ID_COOKIE } from '@alfanumrik/lib/anon-id';
import { applyLimit } from '@/app/api/alfabot/limits';
import type {
  AlfabotErrorResponse,
  AlfabotLeadRequest,
  AlfabotLeadResponse,
} from '@alfanumrik/lib/alfabot/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const WEBHOOK_TIMEOUT_MS = 5_000;

// RFC-5322 lite. Same shape used elsewhere in the codebase — covers 99% of
// real addresses without false positives on plus-tags, sub-domains, etc.
const EMAIL_RE =
  /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

// ─── Validation ─────────────────────────────────────────────────────────────

interface ValidatedLead {
  sessionId: string;
  email: string;
  phone: string | null;
  name: string | null;
  role_or_designation: string | null;
  school_name: string | null;
  consentText: string;
}

function validateLead(body: unknown): ValidatedLead | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body_must_be_object' };
  const b = body as Record<string, unknown>;

  if (typeof b.sessionId !== 'string') return { error: 'sessionId_required' };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.sessionId)) {
    return { error: 'sessionId_not_uuid' };
  }

  if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email.trim())) {
    return { error: 'email_invalid' };
  }
  if (b.consent !== true) return { error: 'consent_required' };
  if (typeof b.consentText !== 'string' || b.consentText.trim().length === 0) {
    return { error: 'consentText_required' };
  }

  const optString = (v: unknown, max = 200): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (t.length === 0) return null;
    return t.slice(0, max);
  };

  return {
    sessionId: b.sessionId,
    email: b.email.trim().toLowerCase(),
    phone: optString(b.phone, 32),
    name: optString(b.name, 120),
    role_or_designation: optString(b.role_or_designation, 120),
    school_name: optString(b.school_name, 200),
    consentText: b.consentText.trim().slice(0, 2000),
  };
}

function errorJson(payload: AlfabotErrorResponse, status: number): NextResponse {
  return NextResponse.json(payload, { status });
}

// ─── Webhook delivery (fire-and-forget) ────────────────────────────────────

async function deliverWebhook(args: {
  leadId: string;
  audience: string;
  sessionId: string;
}): Promise<boolean> {
  const url = process.env.ALFABOT_LEAD_CAPTURE_WEBHOOK_URL;
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Slack-friendly minimal payload. NO email / phone / name — the
        // operator opens the super-admin lead viewer (PR 4) to see PII.
        text: `New AlfaBot lead (${args.audience}). Lead ID: ${args.leadId}`,
        leadId: args.leadId,
        audience: args.audience,
        sessionId: args.sessionId,
      }),
    });
    clearTimeout(timer);
    return res.ok;
  } catch (err) {
    clearTimeout(timer);
    logger.warn('alfabot.lead_webhook_failed', {
      error: err instanceof Error ? err.message : String(err),
      leadId: args.leadId,
    });
    return false;
  }
}

// ─── POST handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Read anon_id cookie (do NOT mint here — lead capture only makes sense
  //    after the visitor has had a chat, which guarantees the cookie exists).
  const cookieStore = await cookies();
  const anonId = cookieStore.get(ANON_ID_COOKIE)?.value || null;
  if (!anonId) {
    // No prior session = no legitimate lead capture. 404 (not 403) so we
    // don't confirm the endpoint exists for scrapers.
    return errorJson({ error: 'not_found' }, 404);
  }

  // 2. Feature-flag — 404 when off.
  const enabled = await isFeatureEnabled('ff_alfabot_lead_capture_v1', { userId: anonId });
  if (!enabled) {
    return errorJson({ error: 'not_found' }, 404);
  }

  // 3. Parse + validate body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorJson({ error: 'invalid_input', detail: 'body_must_be_json' }, 400);
  }
  const validated = validateLead(raw);
  if ('error' in validated) {
    return errorJson({ error: 'invalid_input', detail: validated.error }, 400);
  }

  // 4. Look up the session — MUST belong to this anon.
  const { data: session, error: sessErr } = await supabaseAdmin
    .from('alfabot_sessions')
    .select('id, anon_id, audience')
    .eq('id', validated.sessionId)
    .maybeSingle();
  if (sessErr) {
    logger.error('alfabot.lead_session_lookup_failed', { error: sessErr.message });
    return errorJson({ error: 'upstream_failed' }, 500);
  }
  if (!session) {
    return errorJson({ error: 'invalid_input', detail: 'session_not_found' }, 400);
  }
  if (session.anon_id !== anonId) {
    // Cross-anon injection — 400 (not 403) so we don't confirm session
    // existence.
    logger.warn('alfabot.lead_cross_anon_attempt', { sessionId: validated.sessionId });
    return errorJson({ error: 'invalid_input', detail: 'session_not_found' }, 400);
  }

  const audience = session.audience as 'parent' | 'student' | 'teacher' | 'school';

  // 5. School audience requires school_name.
  if (audience === 'school' && !validated.school_name) {
    return errorJson({ error: 'invalid_input', detail: 'school_name_required' }, 400);
  }

  // 6. Rate limit: 3 leads per anon per 24h.
  const rl = await applyLimit('lead', anonId);
  if (!rl.allowed) {
    return errorJson(
      {
        error: 'rate_limited',
        scope: 'lead',
        resetAt: rl.resetMs ? new Date(rl.resetMs).toISOString() : undefined,
      },
      429,
    );
  }

  // 7. Insert the lead row.
  let leadId: string;
  try {
    const { data, error } = await supabaseAdmin
      .from('alfabot_leads')
      .insert({
        session_id: validated.sessionId,
        audience,
        email: validated.email,
        phone: validated.phone,
        name: validated.name,
        role_or_designation: validated.role_or_designation,
        school_name: validated.school_name,
        consent_at: new Date().toISOString(),
        consent_text: validated.consentText,
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(error?.message || 'insert_returned_no_row');
    }
    leadId = data.id as string;
  } catch (err) {
    logger.error('alfabot.lead_insert_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return errorJson({ error: 'upstream_failed' }, 500);
  }

  // 8. Webhook delivery (fire-and-forget but awaited so we can stamp the row).
  //    We do NOT block the response on a slow webhook — the 5s timeout in
  //    deliverWebhook() caps it, and any failure is logged + retryable.
  try {
    const delivered = await deliverWebhook({
      leadId,
      audience,
      sessionId: validated.sessionId,
    });
    if (delivered) {
      await supabaseAdmin
        .from('alfabot_leads')
        .update({ webhook_delivered_at: new Date().toISOString() })
        .eq('id', leadId);
    }
  } catch (err) {
    logger.warn('alfabot.lead_webhook_stamp_failed', {
      error: err instanceof Error ? err.message : String(err),
      leadId,
    });
  }

  // 9. Audit log — anon_id + session + audience + leadId only, NO PII (P13).
  try {
    await logAudit(null, {
      action: 'alfabot.lead_captured',
      resourceType: 'alfabot_lead',
      resourceId: leadId,
      details: {
        anonId,
        sessionId: validated.sessionId,
        audience,
        // No email / phone / name / school_name.
      },
    });
  } catch {
    /* non-critical */
  }

  const payload: AlfabotLeadResponse = { ok: true, leadId };
  return NextResponse.json(payload, { status: 200 });
}
