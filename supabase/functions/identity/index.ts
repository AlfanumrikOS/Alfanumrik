/**
 * Identity Service – Alfanumrik Edge Function
 *
 * Comprehensive identity management microservice providing:
 * - JWT → identity resolution (legacy endpoint)
 * - Profile retrieval by user ID
 * - Session management (2-device limit enforcement)
 * - Role and permission validation
 * - Onboarding status checks
 *
 * Endpoints:
 * - POST /resolve - Resolve JWT to identity (legacy)
 * - GET /profile/:userId - Get user profile
 * - GET /sessions - Get active sessions for authenticated user
 * - POST /sessions/validate - Validate session token
 * - GET /permissions - Get user permissions and roles
 * - GET /onboarding-status - Check onboarding completion
 */

import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  extractJWT,
  validateJWT,
  checkOperationRateLimit,
  getUserProfile,
  getActiveSessions,
  validateSession,
  getUserPermissions,
  getOnboardingStatus,
  createResponse,
  logIdentityEvent,
  generateRequestId,
  createAdminClient,
} from './utils.ts';
import type { IdentityRequest, IdentityResponse } from './types.ts';

Deno.serve(async (req: Request) => {
  const requestId = generateRequestId();
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  const url = new URL(req.url);
  const path = url.pathname.replace('/identity', ''); // Remove base path

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Route handling
    switch (`${req.method} ${path}`) {
      case 'POST /resolve':
        return await handleResolveIdentity(req, requestId, origin);

      case 'GET /profile/:userId':
        return await handleGetProfile(req, requestId, origin, path);

      case 'GET /sessions':
        return await handleGetSessions(req, requestId, origin);

      case 'POST /sessions/validate':
        return await handleValidateSession(req, requestId, origin);

      case 'GET /permissions':
        return await handleGetPermissions(req, requestId, origin);

      case 'GET /onboarding-status':
        return await handleGetOnboardingStatus(req, requestId, origin);

      default:
        return errorResponse('Endpoint not found', 404, origin);
    }
  } catch (err) {
    await logIdentityEvent(
      'identity',
      'identity-service',
      'error',
      `Unhandled error in ${req.method} ${path}`,
      { error: err.message, stack: err.stack },
      requestId
    );
    return errorResponse('Internal server error', 500, origin);
  }
});

/**
 * POST /resolve - Resolve JWT to identity (legacy endpoint)
 */
async function handleResolveIdentity(req: Request, requestId: string, origin: string | null): Promise<Response> {
  // Rate limiting
  const rateLimit = checkOperationRateLimit('general', req.headers.get('CF-Connecting-IP') || 'unknown');
  if (!rateLimit.allowed) {
    return errorResponse(rateLimit.error!, 429, origin);
  }

  // Extract and validate JWT
  const { jwt, error: jwtError } = extractJWT({ method: req.method, url: new URL(req.url), headers: req.headers });
  if (jwtError) {
    return errorResponse(jwtError, 401, origin);
  }

  const { user, error: validationError } = await validateJWT(jwt!);
  if (validationError) {
    return errorResponse(validationError, 401, origin);
  }

  // Get identity resolution (legacy logic)
  const identity = await resolveIdentity(user!.id);

  await logIdentityEvent(
    'identity',
    'resolve',
    'info',
    'Identity resolved',
    { user_id: user!.id, role: identity.role },
    requestId
  );

  return jsonResponse(identity, 200, {
    'Cache-Control': 'private, max-age=30',
  }, origin);
}

/**
 * GET /profile/:userId - Get user profile
 */
async function handleGetProfile(req: Request, requestId: string, origin: string | null, path: string): Promise<Response> {
  // Extract userId from path
  const userIdMatch = path.match(/^\/profile\/([^\/]+)$/);
  if (!userIdMatch) {
    return errorResponse('Invalid user ID', 400, origin);
  }
  const targetUserId = userIdMatch[1];

  // Authenticate requesting user
  const { jwt, error: jwtError } = extractJWT({ method: req.method, url: new URL(req.url), headers: req.headers });
  if (jwtError) {
    return errorResponse(jwtError, 401, origin);
  }

  const { user, error: validationError } = await validateJWT(jwt!);
  if (validationError) {
    return errorResponse(validationError, 401, origin);
  }

  // Rate limiting
  const rateLimit = checkOperationRateLimit('general', user!.id);
  if (!rateLimit.allowed) {
    return errorResponse(rateLimit.error!, 429, origin);
  }

  // Check if user can access this profile (own profile or admin)
  if (user!.id !== targetUserId) {
    const admin = createAdminClient();
    const { data: isAdmin } = await admin
      .from('admin_users')
      .select('id')
      .eq('auth_user_id', user!.id)
      .single();

    if (!isAdmin) {
      return errorResponse('Access denied', 403, origin);
    }
  }

  // Get profile
  const { profile, error } = await getUserProfile(targetUserId);
  if (error) {
    return errorResponse(error, 404, origin);
  }

  await logIdentityEvent(
    'identity',
    'get_profile',
    'info',
    'Profile retrieved',
    { target_user_id: targetUserId, requester_id: user!.id },
    requestId
  );

  return jsonResponse(createResponse(true, profile, undefined, requestId), 200, {}, origin);
}

/**
 * GET /sessions - Get active sessions for authenticated user
 */
async function handleGetSessions(req: Request, requestId: string, origin: string | null): Promise<Response> {
  // Authenticate user
  const { jwt, error: jwtError } = extractJWT({ method: req.method, url: new URL(req.url), headers: req.headers });
  if (jwtError) {
    return errorResponse(jwtError, 401, origin);
  }

  const { user, error: validationError } = await validateJWT(jwt!);
  if (validationError) {
    return errorResponse(validationError, 401, origin);
  }

  // Rate limiting
  const rateLimit = checkOperationRateLimit('general', user!.id);
  if (!rateLimit.allowed) {
    return errorResponse(rateLimit.error!, 429, origin);
  }

  // Get sessions
  const { sessions, error } = await getActiveSessions(user!.id);
  if (error) {
    return errorResponse(error, 500, origin);
  }

  await logIdentityEvent(
    'identity',
    'get_sessions',
    'info',
    'Sessions retrieved',
    { user_id: user!.id, session_count: sessions.length },
    requestId
  );

  return jsonResponse(createResponse(true, sessions, undefined, requestId), 200, {}, origin);
}

/**
 * POST /sessions/validate - Validate session token
 */
async function handleValidateSession(req: Request, requestId: string, origin: string | null): Promise<Response> {
  // Authenticate user
  const { jwt, error: jwtError } = extractJWT({ method: req.method, url: new URL(req.url), headers: req.headers });
  if (jwtError) {
    return errorResponse(jwtError, 401, origin);
  }

  const { user, error: validationError } = await validateJWT(jwt!);
  if (validationError) {
    return errorResponse(validationError, 401, origin);
  }

  // Parse request body
  let body: { session_token_hash?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400, origin);
  }

  if (!body.session_token_hash) {
    return errorResponse('Missing session_token_hash', 400, origin);
  }

  // Rate limiting
  const rateLimit = checkOperationRateLimit('general', user!.id);
  if (!rateLimit.allowed) {
    return errorResponse(rateLimit.error!, 429, origin);
  }

  // Validate session
  const { valid, error } = await validateSession(user!.id, body.session_token_hash);
  if (error) {
    return errorResponse(error, 400, origin);
  }

  await logIdentityEvent(
    'identity',
    'validate_session',
    'info',
    'Session validated',
    { user_id: user!.id, valid },
    requestId
  );

  return jsonResponse(createResponse(true, { valid }, undefined, requestId), 200, {}, origin);
}

/**
 * GET /permissions - Get user permissions and roles
 */
async function handleGetPermissions(req: Request, requestId: string, origin: string | null): Promise<Response> {
  // Authenticate user
  const { jwt, error: jwtError } = extractJWT({ method: req.method, url: new URL(req.url), headers: req.headers });
  if (jwtError) {
    return errorResponse(jwtError, 401, origin);
  }

  const { user, error: validationError } = await validateJWT(jwt!);
  if (validationError) {
    return errorResponse(validationError, 401, origin);
  }

  // Rate limiting
  const rateLimit = checkOperationRateLimit('general', user!.id);
  if (!rateLimit.allowed) {
    return errorResponse(rateLimit.error!, 429, origin);
  }

  // Get permissions
  const { permissions, error } = await getUserPermissions(user!.id);
  if (error) {
    return errorResponse(error, 500, origin);
  }

  await logIdentityEvent(
    'identity',
    'get_permissions',
    'info',
    'Permissions retrieved',
    { user_id: user!.id, permission_count: permissions?.permissions.length || 0 },
    requestId
  );

  return jsonResponse(createResponse(true, permissions, undefined, requestId), 200, {}, origin);
}

/**
 * GET /onboarding-status - Check onboarding completion
 */
async function handleGetOnboardingStatus(req: Request, requestId: string, origin: string | null): Promise<Response> {
  // Authenticate user
  const { jwt, error: jwtError } = extractJWT({ method: req.method, url: new URL(req.url), headers: req.headers });
  if (jwtError) {
    return errorResponse(jwtError, 401, origin);
  }

  const { user, error: validationError } = await validateJWT(jwt!);
  if (validationError) {
    return errorResponse(validationError, 401, origin);
  }

  // Rate limiting
  const rateLimit = checkOperationRateLimit('general', user!.id);
  if (!rateLimit.allowed) {
    return errorResponse(rateLimit.error!, 429, origin);
  }

  // Get onboarding status
  const { status, error } = await getOnboardingStatus(user!.id);
  if (error) {
    return errorResponse(error, 500, origin);
  }

  await logIdentityEvent(
    'identity',
    'get_onboarding_status',
    'info',
    'Onboarding status retrieved',
    { user_id: user!.id, step: status?.step },
    requestId
  );

  return jsonResponse(createResponse(true, status, undefined, requestId), 200, {}, origin);
}

/**
 * Legacy identity resolution logic (extracted from original function)
 */
async function resolveIdentity(authUserId: string): Promise<any> {
  const admin = createAdminClient();

  // Try student first
  const { data: student } = await admin
    .from('identity.students')
    .select('id, grade, subscription_plan, school_id, account_status, institution_id')
    .eq('auth_user_id', authUserId)
    .single();

  if (student) {
    if (student.account_status === 'suspended') {
      throw new Error('Account suspended');
    }

    const features = await evaluateFeatureFlags(student);
    return {
      student_id: student.id,
      role: 'student',
      grade: student.grade,
      plan: student.subscription_plan ?? 'free',
      school_id: student.school_id ?? null,
      features,
    };
  }

  // Try teacher
  const { data: teacher } = await admin
    .from('identity.teachers')
    .select('id, school_id')
    .eq('auth_user_id', authUserId)
    .single();

  if (teacher) {
    return {
      student_id: null,
      role: 'teacher',
      grade: null,
      plan: null,
      school_id: teacher.school_id,
      features: {},
    };
  }

  // Try admin
  const { data: adminUser } = await admin
    .from('admin_users')
    .select('id, admin_level')
    .eq('auth_user_id', authUserId)
    .single();

  if (adminUser) {
    return {
      student_id: null,
      role: adminUser.admin_level === 'super_admin' ? 'super_admin' : 'admin',
      grade: null,
      plan: null,
      school_id: null,
      features: {},
    };
  }

  throw new Error('User record not found');
}

/**
 * Evaluate feature flags for a student
 */
async function evaluateFeatureFlags(student: any): Promise<Record<string, boolean>> {
  const admin = createAdminClient();

  const { data: flags } = await admin
    .from('feature_flags')
    .select('flag_name, is_enabled, target_grades, target_plans, rollout_percentage, target_institutions')
    .eq('is_enabled', true);

  const features: Record<string, boolean> = {};
  for (const flag of (flags ?? [])) {
    let enabled = true;

    // Grade targeting
    if (flag.target_grades?.length && !flag.target_grades.includes(student.grade)) {
      enabled = false;
    }

    // Plan targeting
    if (enabled && flag.target_plans?.length && !flag.target_plans.includes(student.subscription_plan)) {
      enabled = false;
    }

    // Institution targeting
    if (enabled && flag.target_institutions?.length && student.institution_id) {
      if (!flag.target_institutions.includes(student.institution_id)) {
        enabled = false;
      }
    }

    // Rollout percentage
    if (enabled && flag.rollout_percentage != null && flag.rollout_percentage < 100) {
      const hash = (flag.flag_name + student.id).split('').reduce(
        (acc: number, c: string) => acc + c.charCodeAt(0),
        0,
      );
      enabled = (hash % 100) < flag.rollout_percentage;
    }

    features[flag.flag_name] = enabled;
  }

  return features;
}
