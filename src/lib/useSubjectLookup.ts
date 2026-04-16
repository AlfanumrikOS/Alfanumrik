// src/lib/useSubjectLookup.ts
'use client';
import { useMemo } from 'react';
import { useAllowedSubjects } from './useAllowedSubjects';
import type { Subject } from './subjects.types';

/**
 * Returns a stable function for resolving a subject by code.
 * Backed by {@link useAllowedSubjects}, so it honours grade/stream/plan gating
 * and the admin-curated master list. Foxy display components use this to render
 * subject name/icon/color without hardcoding the catalogue.
 */
export function useSubjectLookup(): (code: string) => Subject | null {
  const { subjects } = useAllowedSubjects();
  return useMemo(() => {
    const byCode = new Map<string, Subject>();
    for (const s of subjects) byCode.set(s.code, s);
    return (code: string) => byCode.get(code) ?? null;
  }, [subjects]);
}
