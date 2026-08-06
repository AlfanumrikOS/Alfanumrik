'use client';

/**
 * useHasUpcomingExam — the single source of truth for nav items carrying
 * `requiresUpcomingExam: true` (today: "Exam Sprint" → /exam-prep).
 *
 * WHY THIS EXISTS
 * ---------------
 * The gate used to be implemented twice, differently. `MobileBottomNav` derived
 * it from `student_exams` (default false, set true only when a future exam
 * row exists), while `DesktopSidebar.tsx:19` hard-coded
 * `const [hasUpcomingExam] = useState(true)` — never set, never derived. The
 * result was a viewport-dependent nav: "Exam Sprint" ALWAYS rendered on desktop
 * and was genuinely exam-gated on mobile, for the same student in the same
 * session. Both surfaces now call this hook, so the gate is one rule.
 *
 * Reads through the RLS-scoped browser client (`@alfanumrik/lib/supabase`) —
 * a student can only ever see their own `student_exams` rows (P8). No PII is
 * selected: `id` only (P13).
 *
 * Fail-soft: any missing student id, or a query that returns nothing, yields
 * `false` (item hidden). Nav chrome must never block on this.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@alfanumrik/lib/supabase';

// RCA W1: DesktopSidebar and MobileBottomNav are both mounted on every page via
// GlobalAppLayout, so this hook used to fire two identical queries per view.
// A module-scoped in-flight map coalesces concurrent callers for the same
// student into ONE query; the entry is removed once settled, so a later visit
// re-checks with fresh data (no stale nav gating across sessions).
const inFlightExamGates = new Map<string, Promise<boolean>>();

export function useHasUpcomingExam(studentId: string | null | undefined): boolean {
  const [hasUpcomingExam, setHasUpcomingExam] = useState(false);

  useEffect(() => {
    if (!studentId) {
      setHasUpcomingExam(false);
      return;
    }
    let cancelled = false;

    let pending = inFlightExamGates.get(studentId);
    if (!pending) {
      // supabase's thenable is a PromiseLike, not a Promise — normalize so the
      // shared `.finally` cleanup below type-checks.
      const gate = supabase
        .from('student_exams')
        .select('id')
        .eq('student_id', studentId)
        .gte('exam_date', new Date().toISOString())
        .limit(1)
        .then(({ data }) => (data?.length ?? 0) > 0);
      pending = Promise.resolve(gate).finally(() => {
        inFlightExamGates.delete(studentId);
      });
      inFlightExamGates.set(studentId, pending);
    }

    // .catch keeps the nav fail-soft: a rejected query must never throw or log
    // an unhandled rejection; it just hides the exam-gated item.
    pending
      .then((has) => {
        if (!cancelled) setHasUpcomingExam(has);
      })
      .catch(() => {
        if (!cancelled) setHasUpcomingExam(false);
      });

    return () => {
      cancelled = true;
    };
  }, [studentId]);

  return hasUpcomingExam;
}

export default useHasUpcomingExam;
