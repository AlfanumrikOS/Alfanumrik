/**
 * OAuth2 Authorization Endpoint
 *
 * GET /api/oauth/authorize
 *
 * Apps redirect users here to request access. Validates the authorization
 * request parameters and returns app + scope information that powers the
 * consent screen UI.
 *
 * Query params:
 *   client_id          — registered OAuth app client ID (required)
 *   redirect_uri       — must match one of the app's registered redirect URIs (required)
 *   scope              — space-separated scope codes (required)
 *   school_id          — school granting access (required)
 *   state              — CSRF protection token (recommended, passed through)
 *   response_type      — must be "code" (required)
 *   code_challenge     — PKCE challenge (optional, for public clients)
 *   code_challenge_method — must be "S256" if code_challenge provided
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// OAuth2 error response helper — returns JSON with standard error codes
function oauthError(
  error: 'invalid_request' | 'invalid_client' | 'invalid_redirect_uri' | 'invalid_scope' | 'app_not_approved' | 'unsupported_response_type' | 'server_error',
  description: string,
  status: number = 400
) {
  return NextResponse.json(
    { success: false, error, error_description: description },
    { status }
  );
}

export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams;

    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    const scope = params.get('scope');
    const schoolId = params.get('school_id');
    const state = params.get('state');
    const responseType = params.get('response_type');
    const codeChallenge = params.get('code_challenge');
    const codeChallengeMethod = params.get('code_challenge_method');

    // ------------------------------------------------------------------
    // 1. Validate required parameters
    // ------------------------------------------------------------------

    if (!clientId) {
      return oauthError('invalid_request', 'Missing required parameter: client_id');
    }
    if (!redirectUri) {
      return oauthError('invalid_request', 'Missing required parameter: redirect_uri');
    }
    if (!scope) {
      return oauthError('invalid_request', 'Missing required parameter: scope');
    }
    if (!schoolId) {
      return oauthError('invalid_request', 'Missing required parameter: school_id');
    }
    if (responseType !== 'code') {
      return oauthError(
        'unsupported_response_type',
        'Only response_type=code is supported'
      );
    }

    // Validate PKCE method if challenge is provided
    if (codeChallenge && codeChallengeMethod !== 'S256') {
      return oauthError(
        'invalid_request',
        'code_challenge_method must be S256 when code_challenge is provided'
      );
    }

    // ------------------------------------------------------------------
    // 2. Look up oauth_app by client_id
    // ------------------------------------------------------------------

    const supabase = getSupabaseAdmin();

    const { data: app, error: appError } = await supabase
      .from('oauth_apps')
      .select('id, name, description, logo_url, homepage_url, privacy_policy_url, redirect_uris, requested_scopes, app_type, review_status, is_active')
      .eq('client_id', clientId)
      .single();

    if (appError || !app) {
      logger.warn('oauth_authorize_invalid_client', { client_id: clientId });
      return oauthError('invalid_client', 'Unknown or invalid client_id');
    }

    // Verify app is approved and active
    if (!app.is_active) {
      return oauthError('invalid_client', 'Application is not active');
    }
    if (app.review_status !== 'approved') {
      return oauthError(
        'app_not_approved',
        `Application review status is "${app.review_status}". Only approved apps can authorize.`
      );
    }

    // ------------------------------------------------------------------
    // 3. Verify redirect_uri is in the app's registered redirect URIs
    // ------------------------------------------------------------------

    const registeredUris: string[] = app.redirect_uris || [];
    if (!registeredUris.includes(redirectUri)) {
      logger.warn('oauth_authorize_invalid_redirect', {
        client_id: clientId,
        redirect_uri: redirectUri,
      });
      return oauthError(
        'invalid_redirect_uri',
        'redirect_uri does not match any registered redirect URIs for this application'
      );
    }

    // ------------------------------------------------------------------
    // 4. Validate requested scopes
    // ------------------------------------------------------------------

    const requestedScopes = scope.split(' ').filter(Boolean);
    if (requestedScopes.length === 0) {
      return oauthError('invalid_scope', 'At least one scope is required');
    }

    const { data: validScopes, error: scopeError } = await supabase
      .from('oauth_scopes')
      .select('code, display_name, display_name_hi, description, risk_level, is_active')
      .in('code', requestedScopes);

    if (scopeError) {
      logger.error('oauth_authorize_scope_lookup_failed', {
        error: scopeError,
        client_id: clientId,
      });
      return oauthError('server_error', 'Failed to validate scopes', 500);
    }

    const activeScopes = (validScopes || []).filter(s => s.is_active);
    const activeScopeCodes = activeScopes.map(s => s.code);
    const invalidScopes = requestedScopes.filter(s => !activeScopeCodes.includes(s));

    if (invalidScopes.length > 0) {
      return oauthError(
        'invalid_scope',
        `Unknown or inactive scopes: ${invalidScopes.join(', ')}`
      );
    }

    // ------------------------------------------------------------------
    // 5. Look up school info
    // ------------------------------------------------------------------

    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('id, name, logo_url')
      .eq('id', schoolId)
      .single();

    if (schoolError || !school) {
      return oauthError('invalid_request', 'Invalid school_id');
    }

    // ------------------------------------------------------------------
    // 6. Return authorization request data for the consent screen
    // ------------------------------------------------------------------

    return NextResponse.json({
      success: true,
      data: {
        app: {
          id: app.id,
          name: app.name,
          description: app.description,
          logo_url: app.logo_url,
          homepage_url: app.homepage_url,
          privacy_policy_url: app.privacy_policy_url,
          app_type: app.app_type,
        },
        scopes: activeScopes.map(s => ({
          code: s.code,
          display_name: s.display_name,
          display_name_hi: s.display_name_hi,
          description: s.description,
          risk_level: s.risk_level,
        })),
        school: {
          id: school.id,
          name: school.name,
          logo_url: school.logo_url,
        },
        // Pass through state for CSRF verification in the consent callback
        state: state || null,
        // Echo PKCE parameters so the consent UI can include them in the code request
        code_challenge: codeChallenge || null,
        code_challenge_method: codeChallenge ? 'S256' : null,
      },
    });
  } catch (err) {
    logger.error('oauth_authorize_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return oauthError('server_error', 'Internal server error', 500);
  }
}
