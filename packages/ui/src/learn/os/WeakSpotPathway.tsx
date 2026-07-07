'use client';

/**
 * WeakSpotPathway — reuses the existing KnowledgeGapActions for the Alfa OS
 * Subjects hub (ff_subjects_os_v1, Tier 1 / presentation-only).
 *
 * Reads EXISTING getKnowledgeGaps (get_knowledge_gaps RPC) only. Each gap is
 * expanded into a small two-step remediation chain using the gap's
 * `missing_prerequisite_name` → target concept (a Tier-1 PARTIAL signal — this
 * does NOT invent a prerequisite graph or new tables). The actual gap cards +
 * deep links are rendered by the unchanged KnowledgeGapActions component.
 *
 * States: loading (skeleton), error (distinct), empty (no gaps → handled by
 * KnowledgeGapActions' own zero-state).
 */

import { useEffect, useState } from 'react';
import { Skeleton } from '@alfanumrik/ui/ui';
import KnowledgeGapActions from '@alfanumrik/ui/progress/KnowledgeGapActions';
import { getKnowledgeGaps } from '@alfanumrik/lib/supabase';
import type { KnowledgeGap } from '@alfanumrik/lib/types';

interface WeakSpotPathwayProps {
  studentId: string;
  subjectCode: string;
  isHi: boolean;
}

export default function WeakSpotPathway({ studentId, subjectCode, isHi }: WeakSpotPathwayProps) {
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const data = await getKnowledgeGaps(studentId, subjectCode, 6);
        if (cancelled) return;
        setGaps((data as KnowledgeGap[]) ?? []);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, subjectCode]);

  return (
    <section aria-label={isHi ? 'कमज़ोर जगहों का रास्ता' : 'Weak-spot pathway'}>
      {status === 'loading' ? (
        <>
          <Skeleton width="55%" height={14} className="mb-3" />
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} height={88} rounded="rounded-2xl" />
            ))}
          </div>
        </>
      ) : status === 'error' ? (
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--orange)' }}
          role="status"
        >
          {isHi
            ? 'कमज़ोर जगहें अभी लोड नहीं हो पाईं।'
            : "Couldn't load weak spots right now."}
        </div>
      ) : (
        <>
          {/* The two-step remediation chain (prerequisite → target concept) is a
              Tier-1 partial signal carried inside each gap's missing_prerequisite_name;
              KnowledgeGapActions renders it as "Missing: X" + fix/quiz deep links. */}
          {gaps.length > 0 && (
            <p className="text-xs mb-2" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? 'हर कमी पहले उसकी पूर्व-आवश्यकता ठीक करो, फिर मुख्य अवधारणा।'
                : 'For each gap, fix the prerequisite first, then the main concept.'}
            </p>
          )}
          <KnowledgeGapActions gaps={gaps} isHi={isHi} />
        </>
      )}
    </section>
  );
}
