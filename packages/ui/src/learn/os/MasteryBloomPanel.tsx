'use client';

/**
 * MasteryBloomPanel — reuses the existing SubjectMasteryCard (Bloom heatmap +
 * velocity sparkline) for the Alfa OS Subjects hub (ff_subjects_os_v1, Tier 1).
 *
 * Reads EXISTING engine outputs only — getStudentProfiles (per-subject XP /
 * accuracy), getBloomProgression (Bloom mastery), getLearningVelocity — and
 * hands them to SubjectMasteryCard unchanged. No mastery / XP is computed here.
 *
 * States: loading (skeleton), error (distinct), empty (no profile for subject).
 */

import { useEffect, useState } from 'react';
import { Skeleton } from '@alfanumrik/ui/ui';
import SubjectMasteryCard from '@alfanumrik/ui/progress/SubjectMasteryCard';
import {
  getStudentProfiles,
  getBloomProgression,
  getLearningVelocity,
} from '@alfanumrik/lib/supabase';
import type {
  StudentLearningProfile,
  Subject,
  LearningVelocity,
  BloomLevel,
} from '@alfanumrik/lib/types';

interface MasteryBloomPanelProps {
  studentId: string;
  subjectCode: string;
  subjectMeta: Subject | undefined;
  isHi: boolean;
}

interface State {
  status: 'loading' | 'error' | 'ready';
  profile: StudentLearningProfile | null;
  bloomData: Array<{ bloom_level: BloomLevel; mastery: number }>;
  velocity: LearningVelocity | undefined;
}

export default function MasteryBloomPanel({
  studentId,
  subjectCode,
  subjectMeta,
  isHi,
}: MasteryBloomPanelProps) {
  const [state, setState] = useState<State>({
    status: 'loading',
    profile: null,
    bloomData: [],
    velocity: undefined,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    (async () => {
      try {
        const [profiles, bloom, velocity] = await Promise.all([
          getStudentProfiles(studentId),
          getBloomProgression(studentId, subjectCode),
          getLearningVelocity(studentId, subjectCode),
        ]);
        if (cancelled) return;
        const profile =
          (profiles as StudentLearningProfile[]).find((p) => p.subject === subjectCode) ?? null;
        setState({
          status: 'ready',
          profile,
          bloomData: (bloom as Array<{ bloom_level: BloomLevel; mastery: number }>) ?? [],
          velocity: (velocity as LearningVelocity[])?.[0],
        });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, status: 'error' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, subjectCode]);

  return (
    <section aria-label={isHi ? 'महारत और Bloom विश्लेषण' : 'Mastery & Bloom analysis'}>
      <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
        {isHi ? 'महारत' : 'Mastery'}
      </h2>

      {state.status === 'loading' ? (
        <Skeleton height={160} rounded="rounded-2xl" />
      ) : state.status === 'error' ? (
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--orange)' }}
          role="status"
        >
          {isHi
            ? 'महारत डेटा अभी लोड नहीं हो पाया।'
            : "Couldn't load mastery data right now."}
        </div>
      ) : !state.profile ? (
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
        >
          {isHi
            ? 'इस विषय का कोई डेटा नहीं — एक क्विज़ देकर शुरू करो।'
            : 'No data for this subject yet — take a quiz to begin.'}
        </div>
      ) : (
        <SubjectMasteryCard
          profile={state.profile}
          subjectMeta={subjectMeta}
          bloomData={state.bloomData}
          velocity={state.velocity}
          isHi={isHi}
        />
      )}
    </section>
  );
}
