'use client';

/**
 * BoardSubjectPicker — the missing "choose your board subjects" surface.
 *
 * WHY THIS EXISTS (2026-08-24, CEO defect #6)
 *   `students.selected_subjects` is empty for 37 of the 38 active grade-10/12
 *   students in production. `getStudentBoardSubjects()` returns [] on an empty
 *   array and deliberately "never falls back to a broader set", so BoardScore™
 *   produces nothing for almost every board-grade student. The block is
 *   actionable — but there was NO live surface to act on:
 *     - `/onboarding` hard-redirects any student with `onboarding_completed`,
 *     - `/profile` edits `preferred_subject` (one subject) and grade, never
 *       the `selected_subjects` array,
 *     - `/me` → "Class & subjects" links straight back to `/profile`,
 *     - `packages/ui/src/subjects/ReselectBanner.tsx` and
 *       `packages/ui/src/onboarding/OnboardingFlow.tsx` both have zero live
 *       importers.
 *   So the CTA had nowhere to point. This component IS the destination.
 *
 * NOT A NEW MECHANISM. It composes two already-live pieces and adds none:
 *   - the picker UI is `packages/ui/src/onboarding/SubjectStep` verbatim
 *     (same `useAllowedSubjects()` grade/stream/plan-aware list),
 *   - the write is `useSetup(studentId).saveSubjects()`, i.e. PATCH
 *     /api/student/preferences `action: 'set_selected_subjects'` → the
 *     governed `set_student_subjects` RPC. No direct table write, so
 *     grade/stream/plan governance still runs server-side.
 *
 * Loaded via `next/dynamic` from BoardScoreWidget so none of this (nor
 * `useSetup`, nor `useAllowedSubjects`) lands in the dashboard's first-load
 * bundle — it is fetched only when a student actually taps the CTA (P10).
 *
 * P7: every string here is bilingual via the `isHi` prop.
 */

import { useState } from 'react';
import SubjectStep from '@alfanumrik/ui/onboarding/SubjectStep';
import { useSetup } from '@alfanumrik/lib/onboarding/use-setup';

interface BoardSubjectPickerProps {
  isHi: boolean;
  studentId: string;
  /** Fired after a successful save so the caller can revalidate its data. */
  onSaved: () => void;
  onCancel: () => void;
}

export default function BoardSubjectPicker({
  isHi,
  studentId,
  onSaved,
  onCancel,
}: BoardSubjectPickerProps) {
  const { saving, saveSubjects } = useSetup(studentId);
  const [picked, setPicked] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  const handleSave = async () => {
    if (picked.length === 0) return;
    setFailed(false);
    // `preferred_subject` is required by the route contract; the first pick is
    // the student's own choice of primary and is re-editable from /profile.
    const result = await saveSubjects(picked, picked[0]);
    if (result.ok) {
      onSaved();
      return;
    }
    setFailed(true);
  };

  return (
    <div data-testid="board-subject-picker">
      <SubjectStep
        value={picked}
        onChange={setPicked}
        onNext={() => void handleSave()}
        onBack={onCancel}
        isHi={isHi}
        maxSubjects={null}
      />

      {saving && (
        <p className="text-fluid-xs text-center mt-2" style={{ color: 'var(--text-3)' }} role="status">
          {isHi ? 'सहेजा जा रहा है…' : 'Saving…'}
        </p>
      )}

      {failed && (
        <p
          className="text-fluid-xs text-center mt-2"
          style={{ color: 'var(--danger, #DC2626)' }}
          role="alert"
          data-testid="board-subject-picker-error"
        >
          {isHi
            ? 'विषय सहेजे नहीं जा सके। कृपया पुनः प्रयास करें।'
            : 'Could not save your subjects. Please try again.'}
        </p>
      )}
    </div>
  );
}
