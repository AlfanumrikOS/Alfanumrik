/**
 * Identity Service Utilities
 * Shared utility functions for the identity Edge Function
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logOpsEvent } from '../_shared/ops-events.ts';
import { checkRateLimit, RATE_LIMITS } from '../_shared/rate-limiter.ts';
import type {
  IdentityRequest,
  IdentityResponse,
  RateLimitConfig,
  UserProfile,
  SessionInfo,
  PermissionInfo,
  OnboardingStatus
} from './types.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

/**
 * Create service role Supabase client for admin operations
 */
export function createAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

/**
 * Create user client with JWT for user-scoped operations
 */
export function createUserClient(jwt: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

/**
 * Extract and validate JWT from request
 */
export function extractJWT(req: IdentityRequest): { jwt: string | null; error: string | null } {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { jwt: null, error: 'Missing or invalid Authorization header' };
  }
  const jwt = authHeader.slice(7);
  if (!jwt) {
    return { jwt: null, error: 'Empty JWT token' };
  }
  return { jwt, error: null };
}

/**
 * Validate JWT and get user info
 */
export async function validateJWT(jwt: string): Promise<{ user: any; error: string | null }> {
  try {
    const userClient = createUserClient(jwt);
    const { data: { user }, error } = await userClient.auth.getUser();

    if (error || !user) {
      return { user: null, error: 'Invalid or expired token' };
    }

    return { user, error: null };
  } catch (err) {
    return { user: null, error: `JWT validation failed: ${err.message}` };
  }
}

/**
 * Check rate limit for an operation
 */
export function checkOperationRateLimit(
  operation: keyof typeof RATE_LIMITS,
  identifier: string
): { allowed: boolean; error: string | null } {
  const config = RATE_LIMITS[operation];
  if (!config) {
    return { allowed: true, error: null };
  }

  const result = checkRateLimit(identifier, config);
  if (!result.allowed) {
    return {
      allowed: false,
      error: `Rate limit exceeded. Try again in ${Math.ceil(result.retryAfterMs / 1000)} seconds.`
    };
  }

  return { allowed: true, error: null };
}

/**
 * Get user profile by auth_user_id
 */
export async function getUserProfile(authUserId: string): Promise<{ profile: UserProfile | null; error: string | null }> {
  const admin = createAdminClient();

  // Try student table first
  let { data: profile, error } = await admin
    .from('identity.students')
    .select('id, auth_user_id, name, email, avatar_url, grade, subscription_plan, school_id, institution_id, account_status, created_at, updated_at')
    .eq('auth_user_id', authUserId)
    .single();

  if (profile) {
    return { profile: { ...profile, role: 'student' }, error: null };
  }

  // Try teacher table
  ({ data: profile, error } = await admin
    .from('identity.teachers')
    .select('id, auth_user_id, name, email, avatar_url, school_id, created_at, updated_at')
    .eq('auth_user_id', authUserId)
    .single());

  if (profile) {
    return { profile: { ...profile, role: 'teacher' }, error: null };
  }

  // Try guardian table
  ({ data: profile, error } = await admin
    .from('identity.guardians')
    .select('id, auth_user_id, name, email, avatar_url, created_at, updated_at')
    .eq('auth_user_id', authUserId)
    .single());

  if (profile) {
    return { profile: { ...profile, role: 'parent' }, error: null };
  }

  // Try admin table
  ({ data: profile, error } = await admin
    .from('admin_users')
    .select('id, auth_user_id, name, email, created_at, updated_at')
    .eq('auth_user_id', authUserId)
    .single());

  if (profile) {
    return { profile: { ...profile, role: 'admin' }, error: null };
  }

  return { profile: null, error: 'User profile not found' };
}

/**
 * Get active sessions for a user
 */
export async function getActiveSessions(authUserId: string): Promise<{ sessions: SessionInfo[]; error: string | null }> {
  const admin = createAdminClient();

  const { data: sessions, error } = await admin
    .from('identity.user_active_sessions')
    .select('id, session_token_hash, device_label, ip_address, user_agent, created_at, last_seen_at, is_active')
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .order('last_seen_at', { ascending: false });

  if (error) {
    return { sessions: [], error: `Failed to fetch sessions: ${error.message}` };
  }

  return { sessions: sessions || [], error: null };
}

/**
 * Validate a session token
 */
export async function validateSession(authUserId: string, sessionTokenHash: string): Promise<{ valid: boolean; error: string | null }> {
  const admin = createAdminClient();

  const { data: session, error } = await admin
    .from('identity.user_active_sessions')
    .select('id, is_active, revoked_at')
    .eq('auth_user_id', authUserId)
    .eq('session_token_hash', sessionTokenHash)
    .single();

  if (error || !session) {
    return { valid: false, error: 'Session not found' };
  }

  if (!session.is_active || session.revoked_at) {
    return { valid: false, error: 'Session is inactive or revoked' };
  }

  return { valid: true, error: null };
}

/**
 * Get user permissions and roles
 */
export async function getUserPermissions(authUserId: string): Promise<{ permissions: PermissionInfo | null; error: string | null }> {
  const admin = createAdminClient();

  const { data: result, error } = await admin.rpc('get_user_permissions', {
    p_auth_user_id: authUserId
  });

  if (error) {
    return { permissions: null, error: `Failed to fetch permissions: ${error.message}` };
  }

  return { permissions: result as PermissionInfo, error: null };
}

/**
 * Get onboarding status for a user
 */
export async function getOnboardingStatus(authUserId: string): Promise<{ status: OnboardingStatus | null; error: string | null }> {
  const admin = createAdminClient();

  const { data: status, error } = await admin
    .from('onboarding_state')
    .select('intended_role, step, profile_id, completed_at, error_message, error_step, retry_count, metadata')
    .eq('auth_user_id', authUserId)
    .single();

  if (error) {
    return { status: null, error: `Failed to fetch onboarding status: ${error.message}` };
  }

  return { status: status as OnboardingStatus, error: null };
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Log an operation event
 */
export async function logIdentityEvent(
  category: string,
  source: string,
  severity: 'info' | 'warning' | 'error' | 'critical',
  message: string,
  context: Record<string, unknown> = {},
  requestId?: string
): Promise<void> {
  await logOpsEvent({
    category,
    source,
    severity,
    message,
    context,
    requestId,
  });
}

/**
 * Create a standardized response
 */
export function createResponse(
  success: boolean,
  data?: unknown,
  error?: string,
  requestId?: string
): IdentityResponse {
  return {
    success,
    data,
    error,
    requestId: requestId || generateRequestId(),
  };
}