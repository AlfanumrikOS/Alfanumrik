'use client';

/**
 * Pedagogy v2 — Wave 1
 * MisconceptionExplainer
 *
 * After a wrong MCQ answer, fetches the curated remediation from
 * /api/learn/remediation. Renders nothing when no remediation exists (or
 * the flag is off) so the UI falls back to legacy generic "Incorrect"
 * feedback without flicker. Eedi-pattern: each distractor maps to a
 * specific misconception with a targeted micro-explanation.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';

interface Remediation {
  questionId: string;
  distractorIndex: number;
  remediationEn: string;
  remediationHi: string;
}

interface Props {
  questionId: string;
  distractorIndex: number;
}

export default function MisconceptionExplainer({ questionId, distractorIndex }: Props) {
  const { isHi } = useAuth();
  const [remediation, setRemediation] = useState<Remediation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/learn/remediation?questionId=${encodeURIComponent(questionId)}&distractorIndex=${distractorIndex}`,
          { credentials: 'same-origin' },
        );
        if (!res.ok) {
          if (!cancelled) setRemediation(null);
          return;
        }
        const data: Remediation | null = await res.json();
        if (!cancelled) setRemediation(data);
      } catch {
        if (!cancelled) setRemediation(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [questionId, distractorIndex]);

  if (loading) return null;
  if (!remediation) return null;

  const text = isHi
    ? (remediation.remediationHi || remediation.remediationEn)
    : remediation.remediationEn;
  if (!text) return null;

  return (
    <div
      className="rounded-2xl p-4 mt-3 border"
      style={{ background: 'rgba(245,166,35,0.06)', borderColor: 'rgba(245,166,35,0.25)' }}
      data-testid="misconception-explainer"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🎯</span>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#B45309' }}>
          {isHi ? 'यहाँ अक्सर गलती होती है' : 'A common slip-up here'}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-[var(--text-2)] mb-3">{text}</p>
      <a
        href={`/foxy?mode=doubt&q=${encodeURIComponent(remediation.questionId)}`}
        className="inline-block text-xs font-semibold underline"
        style={{ color: '#7C3AED' }}
      >
        {isHi ? 'फॉक्सी से और समझो →' : 'Ask Foxy to explain more →'}
      </a>
    </div>
  );
}
