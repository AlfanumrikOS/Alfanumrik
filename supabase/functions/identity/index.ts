/**
 * identity – Alfanumrik Edge Function (Microservice #1)
 *
 * Resolves a Supabase JWT → authenticated student identity + feature flags.
 * All other Edge Functions should call this instead of doing their own
 * auth.getUser() + student lookup, preventing N copies of the same auth logic.
 *
 * POST body:
 * (none — reads Authorization header only)
 *
 * Response (200):
 * {
 *   student_id:  string
 *   role:        'student' | 'teacher' | 'parent' | 'admin'
 *   grade:       string
 *   plan:        'free' | 'lite' | 'pro' | 'premium' | 'school'
 *   school_id:   string | null
 *   features:    Record<string, boolean>   // feature flags targeting this student
 * }
 *
 * Errors:
 *   401 — missing or invalid JWT
 *   403 — student account suspended
 *   404 — student record not found
 *
 * WHY as a microservice:
 *   - Removes N copies of auth resolution scattered across 26 edge functions
 *   - Single source of truth for feature flag evaluation
 *   - Cacheable at CDN edge: same token = same identity for TTL=30s
 *   - Can add rate-limit tokens, device fingerprinting here without touching other services
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return errorResponse('Method not allowed', 405, origin);
  }

  // ── 1. Resolve JWT ────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse('Missing Authorization header', 401, origin);
  }
  const jwt = authHeader.slice(7);

  // Use anon client with the user's JWT — auth.getUser() validates the token
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return errorResponse('Invalid or expired token', 401, origin);
  }

  // ── 2. Fetch student record (service role — fast, no RLS overhead) ────────
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const { data: student, error: studentError } = await admin
    .from('students')
    .select('id, grade, subscription_plan, school_id, account_status, institution_id')
    .eq('auth_id', user.id)
    .single();

  if (studentError || !student) {
    // May be a teacher or parent — check those tables
    const { data: teacher } = await admin
      .from('teachers')
      .select('id, school_id')
      .eq('auth_id', user.id)
      .single();

    if (teacher) {
      return jsonResponse({
        student_id: null,
        role: 'teacher',
        grade: null,
        plan: null,
        school_id: teacher.school_id,
        features: {},
      }, 200, {}, origin);
    }

    return errorResponse('Student record not found', 404, origin);
  }

  // ── 3. Guard suspended accounts ──────────────────────────────────────────
  if (student.account_status === 'suspended') {
    return errorResponse('Account suspended', 403, origin);
  }

  // ── 4. Evaluate feature flags ─────────────────────────────────────────────
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

    // Rollout percentage (deterministic hash — same student always gets same result)
    if (enabled && flag.rollout_percentage != null && flag.rollout_percentage < 100) {
      const hash = (flag.flag_name + student.id).split('').reduce(
        (acc: number, c: string) => acc + c.charCodeAt(0),
        0,
      );
      enabled = (hash % 100) < flag.rollout_percentage;
    }

    features[flag.flag_name] = enabled;
  }

  // ── 5. Return resolved identity ───────────────────────────────────────────
  return jsonResponse({
    student_id: student.id,
    role: 'student',
    grade: student.grade,
    plan: student.subscription_plan ?? 'free',
    school_id: student.school_id ?? null,
    features,
  }, 200, {
    // Short-lived cache: same JWT = same identity for 30s
    // Vary on Authorization so different tokens don't share cache
    'Cache-Control': 'private, max-age=30',
  }, origin);
});
