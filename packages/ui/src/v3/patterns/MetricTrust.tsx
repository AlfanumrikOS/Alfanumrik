'use client';

import Link from 'next/link';

export interface MetricTrustProps {
  source: string;
  definition: string;
  /** Timestamp supplied by the source. Use null when the source exposes none. */
  freshness?: string | null;
  /** Time the browser received the response; never presented as source freshness. */
  retrievedAt?: string | null;
  evidenceHref?: string;
  evidenceLabel?: string;
  estimated?: boolean;
  locale?: 'en' | 'hi';
}

const LABELS = {
  en: { details: 'Data details', estimated: 'Estimated', source: 'Source', definition: 'Definition', freshness: 'Source freshness', retrieved: 'Retrieved', evidence: 'View supporting evidence', unavailable: 'Supporting evidence —' },
  hi: { details: 'डेटा विवरण', estimated: 'अनुमानित', source: 'स्रोत', definition: 'परिभाषा', freshness: 'स्रोत की ताज़गी', retrieved: 'प्राप्त समय', evidence: 'सहायक प्रमाण देखें', unavailable: 'सहायक प्रमाण —' },
} as const;

export function MetricTrust({
  source,
  definition,
  freshness,
  retrievedAt,
  evidenceHref,
  evidenceLabel,
  estimated = false,
  locale = 'en',
}: MetricTrustProps) {
  const labels = LABELS[locale];
  const resolvedEvidenceLabel = evidenceLabel ?? labels.evidence;
  return (
    <details className="v3-metric-trust">
      <summary>
        {labels.details}
        {estimated ? <span className="v3-metric-trust__estimate">{labels.estimated}</span> : null}
      </summary>
      <dl>
        <div><dt>{labels.source}</dt><dd>{source}</dd></div>
        <div><dt>{labels.definition}</dt><dd>{definition}</dd></div>
        {freshness !== undefined ? <div><dt>{labels.freshness}</dt><dd>{freshness ?? '—'}</dd></div> : null}
        {retrievedAt ? <div><dt>{labels.retrieved}</dt><dd>{retrievedAt}</dd></div> : null}
      </dl>
      {evidenceHref ? <Link href={evidenceHref}>{resolvedEvidenceLabel} →</Link> : <p>{labels.unavailable}</p>}
    </details>
  );
}
