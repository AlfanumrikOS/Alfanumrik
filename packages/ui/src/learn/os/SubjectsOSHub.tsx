'use client';

/**
 * SubjectsOSHub — the per-subject "Alfa OS" Subjects experience
 * (ff_subjects_os_v1, Tier 1 / presentation-only).
 *
 * Rendered in place of the legacy chapter list inside /learn ONLY when the flag
 * is ON and a subject is selected. Composition over reuse — every section wraps
 * an EXISTING hook / RPC / component:
 *
 *   1. SubjectHeader      → useSubjectReadiness().summary
 *   2. NextStepCard       → useChapterReadiness().next_action
 *   3. SubjectSkillTree   → useSubjectReadiness().chapters (+ SkillTree/RoadmapNode)
 *   4. MasteryBloomPanel  → SubjectMasteryCard (getBloomProgression/velocity)
 *   5. WeakSpotPathway    → KnowledgeGapActions (getKnowledgeGaps)
 *   6. MomentumRail       → getLearningVelocity + ScoreCard
 *
 * No DB schema, no new RPC, no scoring/XP/mastery formula. Cosmic-LIGHT +
 * data-role="student" is activated via useCosmicLightSurface while mounted.
 * Bilingual via isHi.
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSubjectReadiness } from '@alfanumrik/lib/useSubjectReadiness';
import { useCosmicLightSurface } from '@alfanumrik/lib/use-cosmic-light-surface';
import { getChaptersForSubject } from '@alfanumrik/lib/supabase';
import { Skeleton } from '@alfanumrik/ui/ui';
import SubjectHeader from './SubjectHeader';
import type { Subject } from '@alfanumrik/lib/types';

// Heavy, below-the-fold sections are lazy-loaded so the flag-OFF path fetches
// none of this bundle and the flag-ON first paint stays light (P10).
const sectionLoading = () => <Skeleton height={140} rounded="rounded-2xl" />;
const NextStepCard = dynamic(() => import('./NextStepCard'), { ssr: false, loading: sectionLoading });
const SubjectSkillTree = dynamic(() => import('./SubjectSkillTree'), { ssr: false, loading: sectionLoading });
const MasteryBloomPanel = dynamic(() => import('./MasteryBloomPanel'), { ssr: false, loading: sectionLoading });
const WeakSpotPathway = dynamic(() => import('./WeakSpotPathway'), { ssr: false, loading: sectionLoading });
const MomentumRail = dynamic(() => import('./MomentumRail'), { ssr: false, loading: sectionLoading });

export interface SubjectsOSHubProps {
  studentId: string;
  /** Subject code, e.g. "mathematics". */
  subjectCode: string;
  grade: string;
  /**
   * Subject metadata for icon/name/color (from the page's subjects hook —
   * `useAllowedSubjects`, whose Subject shape uses `nameHi`).
   */
  subjectMeta:
    | { code: string; name: string; nameHi?: string | null; icon?: string; color?: string }
    | undefined;
  isHi: boolean;
}

export default function SubjectsOSHub({
  studentId,
  subjectCode,
  grade,
  subjectMeta,
  isHi,
}: SubjectsOSHubProps) {
  // Activate Cosmic-LIGHT + student palette while this hub is mounted. Restores
  // prior <html> attributes on unmount (and on flag-OFF this never mounts).
  useCosmicLightSurface(true);

  const { readiness, isLoading, error } = useSubjectReadiness(subjectCode);

  // Chapter titles come from the existing chapters fetch — used to label tree
  // nodes with real names rather than "Chapter N".
  const [chapterTitles, setChapterTitles] = useState<Record<number, string>>({});
  useEffect(() => {
    let cancelled = false;
    if (!subjectCode || !grade) return;
    getChaptersForSubject(subjectCode, grade)
      .then((rows) => {
        if (cancelled) return;
        const map: Record<number, string> = {};
        for (const r of rows) map[r.chapter_number] = r.title;
        setChapterTitles(map);
      })
      .catch(() => {
        /* non-fatal — tree falls back to "Chapter N" labels */
      });
    return () => {
      cancelled = true;
    };
  }, [subjectCode, grade]);

  const chapters = useMemo(() => readiness?.chapters ?? [], [readiness]);
  const subjectColor = subjectMeta?.color ?? 'var(--orange)';
  const subjectName = subjectMeta?.name ?? subjectCode;
  const subjectNameHi = subjectMeta?.nameHi ?? subjectName;

  // Shape the metadata into the `Subject` contract SubjectMasteryCard expects.
  const masterySubjectMeta: Subject | undefined = subjectMeta
    ? {
        id: subjectMeta.code,
        code: subjectMeta.code,
        name: subjectMeta.name,
        name_hi: subjectMeta.nameHi ?? null,
        icon: subjectMeta.icon ?? '📚',
        color: subjectMeta.color ?? 'var(--orange)',
        is_active: true,
        display_order: 0,
      }
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Subject header + overall readiness ring */}
      <SubjectHeader
        subjectName={isHi ? subjectNameHi : subjectName}
        subjectIcon={subjectMeta?.icon}
        subjectColor={subjectColor}
        summary={readiness?.summary ?? null}
        isLoading={isLoading}
        error={error}
        isHi={isHi}
      />

      {/* 2. Single primary CTA */}
      <NextStepCard
        subjectCode={subjectCode}
        subjectColor={subjectColor}
        chapters={chapters}
        summaryLoading={isLoading}
        summaryError={error}
        isHi={isHi}
      />

      {/* 3. Chapter skill tree */}
      <SubjectSkillTree
        subjectCode={subjectCode}
        chapterTitles={chapterTitles}
        chapters={chapters}
        isLoading={isLoading}
        error={error}
        isHi={isHi}
      />

      {/* 6. Momentum (placed above the heavier mastery/gap reads for fast value) */}
      <MomentumRail
        studentId={studentId}
        subjectCode={subjectCode}
        subjectName={subjectName}
        subjectNameHi={subjectNameHi}
        isHi={isHi}
      />

      {/* 4. Mastery + Bloom analysis */}
      <MasteryBloomPanel
        studentId={studentId}
        subjectCode={subjectCode}
        subjectMeta={masterySubjectMeta}
        isHi={isHi}
      />

      {/* 5. Weak-spot remediation pathway */}
      <WeakSpotPathway studentId={studentId} subjectCode={subjectCode} isHi={isHi} />
    </div>
  );
}
