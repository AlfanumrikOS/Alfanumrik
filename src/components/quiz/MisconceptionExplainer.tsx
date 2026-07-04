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
import { useAuth } from '@/lib/AuthContext';
import { Alert } from '@/components/ui/primitives';

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
    <Alert
      tone="warning"
      icon={<span>🎯</span>}
      title={isHi ? 'यहाँ अक्सर गलती होती है' : 'A common slip-up here'}
      className="mt-3"
      data-testid="misconception-explainer"
    >
      <p className="text-fluid-sm leading-relaxed text-foreground">{text}</p>
      <a
        href={`/foxy?mode=doubt&q=${encodeURIComponent(remediation.questionId)}`}
        className="mt-2 inline-block text-fluid-xs font-semibold text-primary underline"
      >
        {isHi ? 'फॉक्सी से और समझो →' : 'Ask Foxy to explain more →'}
      </a>
    </Alert>
  );
}
