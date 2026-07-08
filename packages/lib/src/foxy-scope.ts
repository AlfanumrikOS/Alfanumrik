import { normalizePlanCode, planTier } from './plans';

export type FoxyPlanCode = 'free' | 'starter' | 'pro' | 'unlimited';

export interface FoxyEnrollmentSource {
  grade?: string | null;
  subscription_plan?: string | null;
  preferred_subject?: string | null;
}

export interface FoxyEnrollmentScope {
  grade: string | null;
  plan: FoxyPlanCode;
  tier: number;
  preferredSubject: string | null;
}

/**
 * Foxy enrollment scope
 *
 * Normalizes the student row into the canonical grade + plan surface Foxy
 * should use everywhere. Grade is enrolled-grade authoritative; plan is
 * normalized through the platform's canonical tier ladder.
 */
export function resolveFoxyEnrollmentScope(
  student: FoxyEnrollmentSource | null | undefined,
): FoxyEnrollmentScope {
  return {
    grade: normalizeEnrolledGrade(student?.grade ?? null),
    plan: normalizeFoxyPlanCode(student?.subscription_plan ?? null),
    tier: planTier(normalizeFoxyPlanCode(student?.subscription_plan ?? null)),
    preferredSubject: typeof student?.preferred_subject === 'string' && student.preferred_subject.trim()
      ? student.preferred_subject.trim()
      : null,
  };
}

export function normalizeEnrolledGrade(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/^Grade\s*/i, '').trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeFoxyPlanCode(value: string | null | undefined): FoxyPlanCode {
  const normalized = normalizePlanCode(value ?? null);
  return (normalized === 'free' || normalized === 'starter' || normalized === 'pro' || normalized === 'unlimited')
    ? normalized
    : 'free';
}
