/**
 * OAuth2 Token Endpoint
 *
 * POST /api/oauth/token
 *
 * Standard OAuth2 token endpoint supporting:
 *   - grant_type=authorization_code  (exchange code for tokens)
 *   - grant_type=refresh_token       (refresh an expired access token)
 *
 * Body (application/x-www-form-urlencoded or JSON):
 *   grant_type      — "authorization_code" or "refresh_token" (required)
 *   code            — authorization code (for authorization_code grant)
 *   client_id       — OAuth app client ID (required)
 *   client_secret   — OAuth app client secret (required for confidential clients)
 *   redirect_uri    — must match the one used in the authorize request
 *   code_verifier   — PKCE verifier (for public clients)
 *   refresh_token   — the refresh token to exchange (for refresh_token grant)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createHash, randomBytes } from 'crypto';
import { logger } from '@/lib/logger';

// OAuth2 error response per RFC 6749 Section 5.2
function tokenError(
  error: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type' | 'server_error',
  description: string,
  status: number = 400
) {
  return NextResponse.json(
    { error, error_description: description },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache',
      },
    }
  );
}

/** SHA-256 hash a string, return hex. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Generate a cryptographically random token. */
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** Parse body as form-encoded or JSON. */
async function parseBody(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const result: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
      result[key] = value;
    }
    return result;
  }

  // Default: JSON
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/** Validate client credentials (client_id + client_secret). */
async function validateClient(
  clientId: string,
  clientSecret: string
): Promise<{ valid: true; app: Record<string, unknown> } | { valid: false; error: string }> {
  const supabase = getSupabaseAdmin();

  const { data: app, error } = await supabase
    .from('oauth_apps')
    .select('id, name, client_secret_hash, redirect_uris, is_active, review_status')
    .eq('client_id', clientId)
    .single();

  if (error || !app) {
    return { valid: false, error: 'Unknown client_id' };
  }

  if (!app.is_active) {
    return { valid: false, error: 'Application is not active' };
  }

  if (app.review_status !== 'approved') {
    return { valid: false, error: 'Application is not approved' };
  }

  // Compare SHA-256 hash of provided secret against stored hash
  const providedHash = sha256(clientSecret);
  if (providedHash !== app.client_secret_hash) {
    return { valid: false, error: 'Invalid client_secret' };
  }

  return { valid: true, app };
}

// ──────────────────────────────────────────────────────────────────────────────
// grant_type=authorization_code
// ──────────────────────────────────────────────────────────────────────────────

async function handleAuthorizationCodeGrant(
  body: Record<string, string>
): Promise<NextResponse> {
  const { client_id, client_secret, code, redirect_uri, code_verifier } = body;

  if (!client_id || !client_secret) {
    return tokenError('invalid_client', 'client_id and client_secret are required');
  }
  if (!code) {
    return tokenError('invalid_request', 'Missing required parameter: code');
  }
  if (!redirect_uri) {
    return tokenError('invalid_request', 'Missing required parameter: redirect_uri');
  }

  // Validate client credentials
  const clientResult = await validateClient(client_id, client_secret);
  if (!clientResult.valid) {
    return tokenError('invalid_client', clientResult.error, 401);
  }

  // ---------------------------------------------------------------------------
  // Authorization code exchange placeholder
  //
  // The full code exchange flow requires:
  //   1. An oauth_authorization_codes table (not yet created)
  //   2. The consent screen UI to generate codes after user approval
  //   3. PKCE code_verifier validation against stored code_challenge
  //
  // For now, return a structured error indicating this flow is not yet wired.
  // The refresh_token grant below is fully functional for testing with
  // manually-issued tokens.
  // ---------------------------------------------------------------------------

  logger.info('oauth_token_code_exchange_attempted', { client_id });

  return tokenError(
    'invalid_grant',
    'Authorization code exchange is not yet available. The consent screen must be built to generate authorization codes. Use the /api/oauth/authorize endpoint to validate app parameters.',
  );

  // When the consent UI is ready, the flow will be:
  //   1. Look up code in oauth_authorization_codes
  //   2. Verify code is not expired (10 min TTL) and not already used
  //   3. Verify redirect_uri matches the one stored with the code
  //   4. If code_verifier provided, verify SHA256(code_verifier) === stored code_challenge
  //   5. Issue access_token + refresh_token
  //   6. Mark code as used
  //   7. Return tokens
}

// ──────────────────────────────────────────────────────────────────────────────
// grant_type=refresh_token
// ──────────────────────────────────────────────────────────────────────────────

async function handleRefreshTokenGrant(
  body: Record<string, string>
): Promise<NextResponse> {
  const { client_id, client_secret, refresh_token } = body;

  if (!client_id || !client_secret) {
    return tokenError('invalid_client', 'client_id and client_secret are required');
  }
  if (!refresh_token) {
    return tokenError('invalid_request', 'Missing required parameter: refresh_token');
  }

  // Validate client credentials
  const clientResult = await validateClient(client_id, client_secret);
  if (!clientResult.valid) {
    return tokenError('invalid_client', clientResult.error, 401);
  }

  const supabase = getSupabaseAdmin();
  const refreshTokenHash = sha256(refresh_token);

  // Look up the refresh token
  const { data: tokenRecord, error: tokenError_ } = await supabase
    .from('oauth_tokens')
    .select('id, app_id, school_id, user_id, scopes, refresh_token_expires_at, revoked_at')
    .eq('refresh_token_hash', refreshTokenHash)
    .is('revoked_at', null)
    .single();

  if (tokenError_ || !tokenRecord) {
    return tokenError('invalid_grant', 'Invalid or expired refresh token');
  }

  // Verify the token belongs to this app
  if (tokenRecord.app_id !== (clientResult.app as Record<string, unknown>).id) {
    logger.warn('oauth_token_refresh_app_mismatch', {
      client_id,
      token_app_id: tokenRecord.app_id,
    });
    return tokenError('invalid_grant', 'Refresh token does not belong to this client');
  }

  // Check refresh token expiry
  if (
    tokenRecord.refresh_token_expires_at &&
    new Date(tokenRecord.refresh_token_expires_at) < new Date()
  ) {
    return tokenError('invalid_grant', 'Refresh token has expired');
  }

  // Revoke the old token record (rotate)
  await supabase
    .from('oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenRecord.id);

  // Issue new tokens
  const newAccessToken = generateToken();
  const newRefreshToken = generateToken();
  const accessExpiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000); // 30 days

  const { error: insertError } = await supabase
    .from('oauth_tokens')
    .insert({
      app_id: tokenRecord.app_id,
      school_id: tokenRecord.school_id,
      user_id: tokenRecord.user_id,
      access_token_hash: sha256(newAccessToken),
      refresh_token_hash: sha256(newRefreshToken),
      scopes: tokenRecord.scopes,
      access_token_expires_at: accessExpiresAt.toISOString(),
      refresh_token_expires_at: refreshExpiresAt.toISOString(),
    });

  if (insertError) {
    logger.error('oauth_token_refresh_insert_failed', {
      error: insertError,
      client_id,
    });
    return tokenError('server_error', 'Failed to issue new tokens', 500);
  }

  logger.info('oauth_token_refreshed', {
    client_id,
    app_id: tokenRecord.app_id,
    school_id: tokenRecord.school_id,
  });

  return NextResponse.json(
    {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: (tokenRecord.scopes || []).join(' '),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache',
      },
    }
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main POST handler
// ──────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request);
    const grantType = body.grant_type;

    if (!grantType) {
      return tokenError('invalid_request', 'Missing required parameter: grant_type');
    }

    switch (grantType) {
      case 'authorization_code':
        return handleAuthorizationCodeGrant(body);

      case 'refresh_token':
        return handleRefreshTokenGrant(body);

      default:
        return tokenError(
          'unsupported_grant_type',
          `Unsupported grant_type: ${grantType}. Supported: authorization_code, refresh_token`
        );
    }
  } catch (err) {
    logger.error('oauth_token_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return tokenError('server_error', 'Internal server error', 500);
  }
}
