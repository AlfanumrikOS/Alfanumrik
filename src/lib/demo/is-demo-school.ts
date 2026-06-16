/**
 * ALFANUMRIK — Demo-school predicate (P11 sanctioned exception, server-gated)
 * ==========================================================================
 *
 * The school-admin billing route grants a COMPLIMENTARY (comp) entitlement —
 * status='active' with NO Razorpay charge — but ONLY for accounts flagged
 * `schools.is_demo = true`. That is the one sanctioned exception to P11's
 * "never grant plan access without verified payment" rule, and it exists solely
 * so sales/onboarding demo tenants can exercise the full paid surface without a
 * real card.
 *
 * THE GUARANTEE: this predicate resolves `is_demo` from the SERVER-RESOLVED
 * school id (the caller passes `auth.schoolId`, never a request-body value) by
 * reading `schools.is_demo` via the service-role admin client. A real school can
 * therefore NEVER reach the comp branch — even if it forges a body field — because
 * the only input that matters is its own authenticated school row.
 *
 * Fails CLOSED: any error, missing row, or missing/false flag returns `false`,
 * so the default outcome is the real-Razorpay path, never a free grant.
 *
 * Server-only. Uses `getSupabaseAdmin()` (bypasses RLS) — must never be imported
 * into client code.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * Returns true iff the school identified by `schoolId` is a demo tenant
 * (`schools.is_demo = true`). Returns false on any error, missing row, or a
 * null/false flag. NEVER trusts client input — the caller MUST pass the
 * server-resolved authenticated school id.
 *
 * @param schoolId - The server-resolved authenticated school id (auth.schoolId).
 */
export async function isDemoSchool(schoolId: string): Promise<boolean> {
  if (!schoolId) return false;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('schools')
      .select('is_demo')
      .eq('id', schoolId)
      .maybeSingle();

    if (error || !data) return false;
    return (data as { is_demo: boolean | null }).is_demo === true;
  } catch (err) {
    // Fail closed — on any error treat as NOT a demo school so the default
    // outcome is the real, payment-gated Razorpay path (P11-safe).
    logger.error('is_demo_school_lookup_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return false;
  }
}
