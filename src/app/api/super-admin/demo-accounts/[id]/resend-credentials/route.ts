import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl, isValidUUID } from '@/lib/admin-auth';
import { generateSecurePassword } from '@/lib/crypto/password';

/**
 * Phase F.4 (Super-Admin Production-Readiness Plan, 2026-05-17)
 *
 * POST /api/super-admin/demo-accounts/:id/resend-credentials
 *
 * Rotates the password on a demo account and returns the new password in the
 * JSON response so the operator can capture it. We deliberately do NOT email
 * the password — the only "user" of a demo account is the operator running a
 * sales walk-through; mailing it adds zero value and would surface a
 * deliverability dependency for a non-recipient flow.
 *
 * The original password is irretrievable (Supabase Auth stores only the hash);
 * this endpoint is the supported recovery path.
 *
 * Auth: super-admin only. Audit: yes (with rotated_at marker, no plaintext).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  // Phase G.1: rotating a demo account's password — admin level.
  // super_admin not required since the only downstream user is the operator.
  const auth = await authorizeAdmin(request, 'admin');
  if (!auth.authorized) return auth.response;

  try {
    const { id } = await Promise.resolve(params);
    if (!id || !isValidUUID(id)) {
      return NextResponse.json(
        { success: false, code: 'invalid_id', message: 'Valid demo account id is required' },
        { status: 400 },
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json(
        { success: false, code: 'config_missing', message: 'Server configuration error' },
        { status: 500 },
      );
    }

    // Look up the demo account
    const accountRes = await fetch(
      supabaseAdminUrl('demo_accounts', `select=id,auth_user_id,role,email&id=eq.${id}&limit=1`),
      { method: 'GET', headers: supabaseAdminHeaders() },
    );
    if (!accountRes.ok) {
      return NextResponse.json(
        { success: false, code: 'fetch_failed', message: 'Failed to look up demo account' },
        { status: 500 },
      );
    }
    const accountRows = await accountRes.json();
    if (!Array.isArray(accountRows) || accountRows.length === 0) {
      return NextResponse.json(
        { success: false, code: 'not_found', message: 'Demo account not found' },
        { status: 404 },
      );
    }
    const account = accountRows[0];

    const newPassword = generateSecurePassword('Demo');

    // Rotate via Supabase Admin API
    const updateRes = await fetch(`${url}/auth/v1/admin/users/${account.auth_user_id}`, {
      method: 'PUT',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: newPassword }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      return NextResponse.json(
        { success: false, code: 'rotate_failed', message: 'Failed to rotate password', details: err.slice(0, 280) },
        { status: 500 },
      );
    }

    const ipAddress = request.headers.get('x-forwarded-for') || undefined;
    await logAdminAudit(
      auth,
      'rotate_demo_account_password',
      'demo_accounts',
      id,
      // Never log the plaintext — only that a rotation happened.
      { role: account.role, email: account.email, rotated_at: new Date().toISOString() },
      ipAddress,
    );

    return NextResponse.json({
      success: true,
      data: {
        id,
        auth_user_id: account.auth_user_id,
        email: account.email,
        password: newPassword,
        role: account.role,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, code: 'internal_error', message: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
