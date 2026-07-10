/**
 * /api/parent/consent — DPDP parental consent capture, revocation, list.
 *
 * Authenticated guardians can grant, revoke, and list consent rows for linked
 * children. Route-level code owns session/body validation and response mapping;
 * guardian resolution, ownership checks, DPDP row mutations, state events, and
 * audit rows live behind auth.uid()-anchored RPCs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';
import {
  CONSENT_SCOPES,
  CURRENT_CONSENT_VERSION,
  type ConsentScope,
} from '@alfanumrik/lib/dpdp/consent';

type ConsentRpcResult = {
  success?: boolean;
  error_code?: string;
  error?: string;
  consent_id?: string;
  consent_version?: string;
  items?: unknown[];
};

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function requestContext(request: NextRequest): { ipAddress: string | null; userAgent: string | null } {
  return {
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? null,
    userAgent: request.headers.get('user-agent'),
  };
}

function mapRpcError(result: ConsentRpcResult, fallback = 'Failed to process consent'): NextResponse {
  const message = result.error ?? fallback;
  switch (result.error_code) {
    case 'conflict':
      return err(message, 409);
    case 'invalid_input':
      return err(message, 400);
    case 'not_found':
      return err(message, 404);
    case 'no_guardian':
    case 'not_linked':
      return err(message, 403);
    case 'unauthorized':
      return err(message, 401);
    default:
      return err(fallback, 500);
  }
}

async function authenticatedClient(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: sessionError } = await supabase.auth.getUser();
  if (sessionError || !user) {
    return { ok: false, response: err('Unauthorized', 401) };
  }
  return { ok: true, supabase };
}

const PostBodySchema = z.object({
  studentId: z.string().refine(isValidUUID, 'studentId must be a valid UUID'),
  consentVersion: z.string().min(1).max(64).optional(),
  scopes: z.record(z.string(), z.boolean()),
  locale: z.enum(['en', 'hi']).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof PostBodySchema>;
  try {
    body = PostBodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }

  const cleanScopes: Partial<Record<ConsentScope, boolean>> = {};
  for (const [key, value] of Object.entries(body.scopes)) {
    if ((CONSENT_SCOPES as readonly string[]).includes(key)) {
      cleanScopes[key as ConsentScope] = value;
    }
  }

  if (cleanScopes.curriculum_access !== true) {
    return err('curriculum_access scope is required to proceed', 400);
  }

  const { ipAddress, userAgent } = requestContext(request);
  const consentVersion = body.consentVersion ?? CURRENT_CONSENT_VERSION;

  const { data, error } = await auth.supabase.rpc('parent_record_consent', {
    p_student_id: body.studentId,
    p_consent_version: consentVersion,
    p_scopes: cleanScopes,
    p_locale: body.locale ?? 'en',
    p_ip_address: ipAddress,
    p_user_agent: userAgent,
  });

  if (error) {
    logger.error('parent_consent_record_rpc_failed', {
      error: new Error(error.message),
      route: 'parent/consent',
    });
    return err('Failed to record consent', 500);
  }

  const result = (data ?? {}) as ConsentRpcResult;
  if (result.success !== true) {
    return mapRpcError(result, 'Failed to record consent');
  }

  return NextResponse.json({
    success: true,
    consentId: result.consent_id,
    consentVersion: result.consent_version ?? consentVersion,
  });
}

const DeleteBodySchema = z.object({
  studentId: z.string().refine(isValidUUID, 'studentId must be a valid UUID'),
});

export async function DELETE(request: NextRequest) {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof DeleteBodySchema>;
  try {
    body = DeleteBodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }

  const { ipAddress, userAgent } = requestContext(request);
  const { data, error } = await auth.supabase.rpc('parent_revoke_consent', {
    p_student_id: body.studentId,
    p_ip_address: ipAddress,
    p_user_agent: userAgent,
  });

  if (error) {
    logger.error('parent_consent_revoke_rpc_failed', {
      error: new Error(error.message),
      route: 'parent/consent',
    });
    return err('Failed to revoke consent', 500);
  }

  const result = (data ?? {}) as ConsentRpcResult;
  if (result.success !== true) {
    return mapRpcError(result, 'Failed to revoke consent');
  }

  return NextResponse.json({ success: true, consentId: result.consent_id });
}

export async function GET() {
  const auth = await authenticatedClient();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase.rpc('parent_list_active_consents');
  if (error) {
    logger.error('parent_consent_list_rpc_failed', {
      error: new Error(error.message),
      route: 'parent/consent',
    });
    return err('Failed to list consents', 500);
  }

  const result = (data ?? {}) as ConsentRpcResult;
  if (result.success !== true) {
    return mapRpcError(result, 'Failed to list consents');
  }

  return NextResponse.json({
    success: true,
    items: result.items ?? [],
    currentVersion: CURRENT_CONSENT_VERSION,
  });
}
