'use client';

/**
 * useSetup — thin write wrapper for the /onboarding v2 flow (SetupFlow.tsx).
 *
 * Every write here reuses an EXISTING, already-live mechanism — this hook
 * does not invent a new write path:
 *
 *   - saveGrade / finish: the same direct `students` table update that
 *     onboarding/page.tsx (v1) already performs at line ~109-124 — grade as
 *     a bare string (P5: never "Grade N", never parseInt), board, and the
 *     onboarding_completed flag. Confirmed this is the real, already-used
 *     write path (not a legacy dead end) by reading that file before writing
 *     this one.
 *
 *   - saveSubjects: PATCH /api/student/preferences with
 *     action: 'set_selected_subjects', which routes through the
 *     set_student_subjects RPC — the SAME governed path dashboard/page.tsx
 *     already uses. This is deliberately NOT a raw `students` table write:
 *     subject selection must pass grade/stream/plan/max-subjects governance
 *     server-side (see apps/host/src/app/api/student/preferences/route.ts),
 *     which a direct client update would bypass entirely.
 *
 *   - inviteGuardian: POST /api/students/[id]/invite-guardian — the existing,
 *     idempotent guardian-invite route (Track B, Feature 1 /
 *     createGuardianInvite). Reused as-is; this hook does not touch
 *     `parental_consent` or `guardian_student_links` directly.
 *
 * See SetupFlow.tsx's header comment for the full DPDP minor-gate reasoning
 * (why this reuses the signup-time is_minor/parent_consent_email signal
 * instead of inventing new age-detection logic).
 */

import { useCallback, useState } from 'react';
import { supabase } from '@alfanumrik/lib/supabase';
import { authHeader } from '@alfanumrik/lib/api/auth-header';

export interface SetupWriteResult {
  ok: boolean;
  error?: string;
}

export interface MinorSignal {
  isMinor: boolean;
  /** Parent/guardian email captured at signup, if any. Never re-derived here. */
  parentConsentEmail: string | null;
}

/**
 * Reads the signup-time minor signal from the CURRENT user's own auth
 * metadata (client-side `supabase.auth.getUser()` — no admin API needed,
 * a user always sees their own user_metadata). This is the exact same
 * `is_minor` / `parent_consent_email` pair AuthScreen.tsx writes at signup
 * (packages/ui/src/auth/AuthScreen.tsx) and
 * apps/host/src/app/api/auth/bootstrap/route.ts already reads server-side
 * to fire the one-time guardian invite. We do not invent a new signal.
 *
 * Fails closed to "not a minor" on any error — the hard legal gate already
 * happened at signup (the signup form blocks submission for the 10-12 age
 * range without a parent email + explicit consent checkbox); this read is a
 * best-effort surface of that decision, not the enforcement point itself.
 */
export async function getMinorSignal(): Promise<MinorSignal> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return { isMinor: false, parentConsentEmail: null };
    const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
    const isMinor = meta.is_minor === true || meta.is_minor === 'true';
    const parentConsentEmail =
      typeof meta.parent_consent_email === 'string' && meta.parent_consent_email.trim()
        ? meta.parent_consent_email.trim()
        : null;
    return { isMinor, parentConsentEmail };
  } catch {
    return { isMinor: false, parentConsentEmail: null };
  }
}

export function useSetup(studentId: string | undefined) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveGrade = useCallback(
    async (grade: string, board: string): Promise<SetupWriteResult> => {
      if (!studentId) return { ok: false, error: 'no_student' };
      setSaving(true);
      setError(null);
      const { error: err } = await supabase
        .from('students')
        .update({
          // P5: grade is a bare string "6".."12", never "Grade N", never parseInt.
          grade,
          board,
          updated_at: new Date().toISOString(),
        })
        .eq('id', studentId);
      setSaving(false);
      if (err) {
        setError(err.message);
        return { ok: false, error: err.message };
      }
      return { ok: true };
    },
    [studentId],
  );

  const saveSubjects = useCallback(
    async (subjects: string[], preferred: string): Promise<SetupWriteResult> => {
      if (!studentId) return { ok: false, error: 'no_student' };
      setSaving(true);
      setError(null);
      try {
        const res = await fetch('/api/student/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({
            action: 'set_selected_subjects',
            subjects,
            preferred_subject: preferred,
          }),
        });
        const body = await res.json().catch(() => ({}) as Record<string, unknown>);
        setSaving(false);
        if (!res.ok || body?.success === false) {
          const msg = String(body?.detail ?? body?.error ?? 'subjects_save_failed');
          setError(msg);
          return { ok: false, error: msg };
        }
        return { ok: true };
      } catch (e) {
        setSaving(false);
        const msg = e instanceof Error ? e.message : 'network_error';
        setError(msg);
        return { ok: false, error: msg };
      }
    },
    [studentId],
  );

  const inviteGuardian = useCallback(
    async (guardianEmail: string, locale: 'en' | 'hi'): Promise<SetupWriteResult> => {
      if (!studentId) return { ok: false, error: 'no_student' };
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/students/${studentId}/invite-guardian`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ guardian_email: guardianEmail, locale }),
        });
        const body = await res.json().catch(() => ({}) as Record<string, unknown>);
        setSaving(false);
        if (!res.ok || body?.success === false) {
          const msg = String(body?.error ?? 'invite_failed');
          setError(msg);
          return { ok: false, error: msg };
        }
        return { ok: true };
      } catch (e) {
        setSaving(false);
        const msg = e instanceof Error ? e.message : 'network_error';
        setError(msg);
        return { ok: false, error: msg };
      }
    },
    [studentId],
  );

  const finish = useCallback(async (): Promise<SetupWriteResult> => {
    if (!studentId) return { ok: false, error: 'no_student' };
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from('students')
      .update({ onboarding_completed: true, updated_at: new Date().toISOString() })
      .eq('id', studentId);
    setSaving(false);
    if (err) {
      setError(err.message);
      return { ok: false, error: err.message };
    }
    return { ok: true };
  }, [studentId]);

  return { saving, error, saveGrade, saveSubjects, inviteGuardian, finish };
}
